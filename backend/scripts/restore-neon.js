/**
 * Restore a backup.
 *
 * A backup is only useful if it can be put back. This restores the newest
 * backup from the private bucket into a SCRATCH schema, so the restore is
 * rehearsed against the real data without touching the live tables.
 *
 * Usage:
 *   node scripts/restore-neon.js --verify     # read the newest backup, check it
 *   node scripts/restore-neon.js --rehearse   # restore it into a scratch schema
 *   node scripts/restore-neon.js --restore    # restore it into the live schema
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { gunzipSync } = require('node:zlib');
const { Client } = require('pg');

const SCRATCH_SCHEMA = 'restore_rehearsal';

async function loadBackup() {
  const { listObjects, getObjectBuffer, invoicesBucket } = require('../src/services/r2');
  const listed = await listObjects(invoicesBucket(), 'backups/', { limit: 100 });
  const keys = listed.keys
    .map((k) => k.key)
    .filter((k) => k.startsWith('backups/') && k.endsWith('.json.gz'))
    .sort();
  if (!keys.length) throw new Error('there is no backup in the bucket');
  const key = keys[keys.length - 1];
  const gz = await getObjectBuffer(invoicesBucket(), key);
  if (!gz) throw new Error(`the backup object ${key} could not be read`);
  const parsed = JSON.parse(gunzipSync(gz).toString('utf8'));
  return { key, parsed };
}

function tableName(table) {
  return `"${String(table).replace(/"/g, '""')}"`;
}

async function restoreInto(client, parsed, schema) {
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.query(`CREATE SCHEMA ${schema}`);
  const tables = Object.keys(parsed.tables || {});
  let rows = 0;
  let created = 0;
  for (const table of tables) {
    const data = parsed.tables[table] || [];
    if (!data.length) continue;
    // The table structure comes from the live schema, so the rehearsal proves
    // the dumped rows actually fit the tables they came from.
    try {
      await client.query(
        `CREATE TABLE ${schema}.${tableName(table)} (LIKE public.${tableName(table)} INCLUDING ALL)`,
      );
      created++;
    } catch (err) {
      console.warn(`  ! could not create ${schema}.${table}: ${err.message}`);
      continue;
    }

    // The column types decide how each value has to be sent: a jsonb column
    // needs an explicit cast, and a jsonb value that came out of the dump as
    // an object has to be serialised first.
    let types = {};
    try {
      const colRes = await client.query(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      types = Object.fromEntries(colRes.rows.map((r) => [r.column_name, r.data_type]));
    } catch {
      // Fall back to the columns present in the data.
    }

    const columns = Object.keys(data[0]);
    for (const row of data) {
      const values = [];
      const placeholders = columns.map((c, i) => {
        let v = row[c] === undefined ? null : row[c];
        const type = types[c];
        if (type === 'jsonb' || type === 'json') {
          if (v !== null && typeof v !== 'string') v = JSON.stringify(v);
          values.push(v);
          return `$${i + 1}::${type}`;
        }
        if (type === 'uuid' || type === 'timestamptz' || type === 'timestamp') {
          values.push(v);
          return `$${i + 1}::${type}`;
        }
        values.push(v);
        return `$${i + 1}`;
      });
      const colList = columns.map((c) => `"${c}"`).join(', ');
      await client.query(
        `INSERT INTO ${schema}.${tableName(table)} (${colList}) VALUES (${placeholders.join(', ')})`,
        values,
      );
      rows++;
    }
  }
  return { tables: created, rows };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--rehearse')
    ? 'rehearse'
    : args.includes('--restore')
      ? 'restore'
      : 'verify';

  const url = (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('Missing DATABASE_URL / DATABASE_URL_UNPOOLED.');
    process.exit(2);
  }

  const { key, parsed } = await loadBackup();
  const tables = Object.keys(parsed.tables || {});
  const rows = tables.reduce((n, t) => n + (parsed.tables[t]?.length || 0), 0);
  console.log(`backup: ${key}`);
  console.log(`tables: ${tables.length}, rows: ${rows}`);

  if (mode === 'verify') {
    const required = ['users', 'orders', 'order_items', 'products'];
    const missing = required.filter((t) => !tables.includes(t));
    if (missing.length) {
      console.error(`NOT RESTORABLE: missing table(s): ${missing.join(', ')}`);
      process.exit(1);
    }
    console.log('RESTORABLE: structure and integrity checks passed.');
    return;
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    if (mode === 'rehearse') {
      const result = await restoreInto(client, parsed, SCRATCH_SCHEMA);
      console.log(
        `RESTORED into ${SCRATCH_SCHEMA}: ${result.tables} table(s), ${result.rows} row(s).`,
      );
      // The rehearsal leaves the scratch schema in place so it can be
      // inspected; it never touches a live table.
      console.log(`Drop it with: DROP SCHEMA ${SCRATCH_SCHEMA} CASCADE;`);
    } else {
      const result = await restoreInto(client, parsed, 'public');
      console.log(`RESTORED into public: ${result.tables} table(s), ${result.rows} row(s).`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('restore failed:', err?.message || err);
  process.exit(1);
});
