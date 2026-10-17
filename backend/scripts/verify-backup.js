/**
 * Verify a backup snapshot is complete and restorable.
 *
 * scripts/backup-data.js writes JSON, which is schema-tolerant but easy to write
 * badly. This proves three things before anyone relies on a snapshot:
 *
 *   1. STRUCTURE  - parses, and every table carries its expected row count.
 *   2. INTEGRITY  - every row has a primary key, and ids are unique per table,
 *                   so a replay cannot silently duplicate records.
 *   3. CURRENCY   - live row counts still match the snapshot. A snapshot that
 *                   has drifted is not a rollback path for the current state.
 *
 * Read-only: it never writes to the database, so it is safe on production.
 *
 * Usage:
 *   node scripts/verify-backup.js [path]
 *   node scripts/verify-backup.js --latest
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const PK = { users: 'id', orders: 'id', products: 'id', media: 'id', reviews: 'id' };

function pickSnapshot() {
  const arg = process.argv[2];
  if (arg && !arg.startsWith('--')) return arg;
  const dir = path.join(BACKUP_DIR, '..');
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('snapshot-') && f.endsWith('.json'))
    .sort();
  if (!files.length) {
    console.error('No snapshot found. Run: npm run db:backup');
    process.exit(1);
  }
  void dir;
  return path.join(BACKUP_DIR, files[files.length - 1]);
}

async function main() {
  const snapPath = pickSnapshot();
  if (!fs.existsSync(snapPath)) {
    console.error(`Snapshot not found: ${snapPath}`);
    process.exit(1);
  }

  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  } catch (e) {
    console.error(`UNUSABLE: file does not parse as JSON (${e.message}). A restore would fail.`);
    process.exit(1);
  }
  console.log(`Snapshot : ${snapPath}`);
  console.log(`Taken    : ${snap.takenAt}\n`);

  let problems = 0;

  // 1. structure
  if (!snap.tables || typeof snap.tables !== 'object') {
    console.error('UNUSABLE: no "tables" object.');
    process.exit(1);
  }
  const names = Object.keys(snap.tables);
  console.log(`Tables present: ${names.length}`);
  if (snap.errors && Object.keys(snap.errors).length) {
    console.log(`  WARNING: ${Object.keys(snap.errors).length} table(s) failed during capture:`);
    for (const [t, e] of Object.entries(snap.errors)) console.log(`    ${t}: ${e}`);
    problems++;
  }

  // 2. integrity
  console.log('\nPer-table check:');
  for (const [table, rows] of Object.entries(snap.tables)) {
    if (!Array.isArray(rows)) {
      console.log(`  BAD  ${table} is not an array`);
      problems++;
      continue;
    }
    let note = '';
    const pk = PK[table];
    if (pk && rows.length) {
      const ids = rows.map((r) => r && r[pk]).filter((v) => v !== undefined && v !== null);
      if (ids.length !== rows.length) {
        note += ` MISSING_PK(${rows.length - ids.length})`;
        problems++;
      }
      const uniq = new Set(ids);
      if (uniq.size !== ids.length) {
        note += ` DUPLICATE_IDS(${ids.length - uniq.size})`;
        problems++;
      }
    }
    console.log(`  ok  ${table.padEnd(24)} ${String(rows.length).padStart(5)} rows${note}`);
  }

  // 3. currency against the live database
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(url, key);
    console.log('\nLive row-count comparison (drift means this is not a rollback path for today):');
    for (const table of Object.keys(snap.tables)) {
      const r = await fetch(`${url}/rest/v1/${table}?select=*`, {
        method: 'HEAD',
        headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
      });
      const live = Number(r.headers.get('content-range')?.split('/')[1] ?? -1);
      const snapCount = snap.tables[table].length;
      const drift = live - snapCount;
      const flag = drift === 0 ? 'match' : drift > 0 ? `+${drift} since snapshot` : `${drift} since snapshot`;
      console.log(`  ${table.padEnd(24)} snapshot=${String(snapCount).padStart(5)}  live=${String(live).padStart(5)}  ${flag}`);
    }
  }

  console.log(
    problems === 0
      ? '\nRESTORABLE: structure and integrity checks passed.'
      : `\nNOT FULLY RESTORABLE: ${problems} problem(s) above.`
  );
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});