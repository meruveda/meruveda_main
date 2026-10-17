/**
 * Restore table data from a backup snapshot.
 *
 * THE ROLLBACK PATH for the migration bundle. Requires no DDL access — it writes
 * through PostgREST like the rest of the app — but it DOES write to the live
 * database, so it is dry-run by default and needs an explicit --apply.
 *
 * Scope, deliberately narrow: this REPLAYS ROWS. It does not drop columns,
 * reset sequences or touch the schema. If a migration added a column, restoring
 * fills it with whatever the snapshot has (usually absent) — which is correct,
 * because a migration must never have destroyed a column that already held data.
 *
 * Upserts on primary key, so running it twice is idempotent.
 *
 * Usage:
 *   node scripts/restore-data.js                    dry run, shows the plan
 *   node scripts/restore-data.js --apply            actually write
 *   node scripts/restore-data.js --tables=orders    limit to some tables
 *   node scripts/restore-data.js <snapshot.json>
 *
 * Before using this on production: take a fresh snapshot (npm run db:backup),
 * and restore into a scratch project first if at all possible.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const PK = 'id';
const BATCH = 200;

/** Order matters where a FK exists, so children land after parents. */
const ORDER = [
  'users', 'products', 'categories', 'media', 'coupons', 'settings', 'banners', 'blogs', 'cms_pages',
  'orders', 'order_items', 'transactions', 'order_tracking_history', 'activity_logs',
  'cart_items', 'wishlist_items', 'support_tickets', 'reviews', 'notifications', 'user_addresses',
  'test_table', 'page_views', 'otps', 'whatsapp_message_log', 'review_requests',
];

function pickSnapshot() {
  const arg = process.argv[2];
  if (arg && !arg.startsWith('--')) return arg;
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('snapshot-') && f.endsWith('.json'))
    .sort();
  if (!files.length) {
    console.error('No snapshot found. Run: npm run db:backup');
    process.exit(1);
  }
  return path.join(BACKUP_DIR, files[files.length - 1]);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const onlyArg = (process.argv.find((a) => a.startsWith('--tables=')) || '').split('=')[1];
  const only = onlyArg ? onlyArg.split(',') : null;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY.');
    process.exit(1);
  }

  const snapPath = pickSnapshot();
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(url, key);

  const wanted = Object.keys(snap.tables).filter((t) => !only || only.includes(t));
  const tables = [...new Set([...ORDER.filter((t) => wanted.includes(t)), ...wanted])];

  console.log(`Snapshot : ${snapPath}`);
  console.log(`Taken    : ${snap.takenAt}`);
  console.log(`Mode     : ${apply ? 'APPLY — THIS WRITES TO THE LIVE DATABASE' : 'DRY RUN (nothing written)'}\n`);

  let total = 0;
  for (const table of tables) {
    const rows = snap.tables[table];
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`  skip   ${table.padEnd(24)} ${rows ? 0 : 'absent from snapshot'}`);
      continue;
    }
    const withPk = rows.filter((r) => r && r[PK] !== undefined && r[PK] !== null);
    const without = rows.length - withPk.length;
    if (without) {
      console.log(`  SKIP   ${table.padEnd(24)} ${without} row(s) have no '${PK}' — cannot upsert safely`);
      continue;
    }
    console.log(`  ${apply ? 'restore' : 'plan  '} ${table.padEnd(24)} ${withPk.length} row(s)` +
      (without ? `  (${without} skipped: no primary key)` : ''));
    total += withPk.length;

    if (!apply) continue;

    for (let i = 0; i < withPk.length; i += BATCH) {
      const { error } = await supabase.from(table).upsert(withPk.slice(i, i + BATCH), { onConflict: PK });
      if (error) {
        console.error(`\nABORTED on ${table} batch ${i / BATCH + 1}: ${error.message}`);
        console.error('Partial restore may have been written. Re-run the whole snapshot after fixing.');
        process.exit(1);
      }
    }
  }

  console.log(`\n${total} row(s) ${apply ? 'restored' : 'would be restored'}.`);
  if (!apply) {
    console.log('Nothing was written. Re-run with --apply to perform the restore.');
  } else {
    console.log('Verify with: npm run db:verify:backup');
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});