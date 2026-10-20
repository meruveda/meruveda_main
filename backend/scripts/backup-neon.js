/**
 * Neon-native backup: dumps the tables that the automation pipeline touches to
 * a timestamped JSON file in backend/backups/.
 *
 * The old backup script spoke to the previous provider; this one speaks to Neon directly,
 * so a backup can always be taken regardless of which storage provider is in
 * use.
 *
 * Usage:
 *   node scripts/backup-neon.js                 # dump the core tables
 *   node scripts/backup-neon.js --tables=orders,order_items
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const DEFAULT_TABLES = [
  'orders',
  'order_items',
  'order_tracking_history',
  'transactions',
  'products',
  'users',
  'coupons',
  'settings',
  'banners',
  'categories',
  'blogs',
  'media',
];

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    const quoted = value.match(/^(['"])(.*)\1$/);
    if (quoted) value = quoted[2];
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

async function main() {
  loadDotEnv();
  const url = (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('Missing DATABASE_URL / DATABASE_URL_UNPOOLED in backend/.env');
    process.exit(1);
  }

  const argv = process.argv.slice(2);
  const tablesArg = argv.find((a) => a.startsWith('--tables='));
  const tables = tablesArg
    ? tablesArg.split('=')[1].split(',').map((t) => t.trim()).filter(Boolean)
    : DEFAULT_TABLES;

  const client = new Client({ connectionString: url });
  await client.connect();

  const out = { created_at: new Date().toISOString(), tables: {} };
  for (const table of tables) {
    try {
      const res = await client.query(`SELECT * FROM "${table}"`);
      out.tables[table] = res.rows;
      console.log(`  ${table.padEnd(26)} ${res.rows.length} row(s)`);
    } catch (err) {
      console.warn(`  ${table.padEnd(26)} SKIPPED (${err.message})`);
    }
  }
  await client.end();

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `neon-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nBackup written: ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});
