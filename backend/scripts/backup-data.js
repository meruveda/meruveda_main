/**
 * Data backup over PostgREST.
 *
 * Supabase's hosted backups live behind the dashboard, which this environment
 * has no access to. This produces an independent, restorable snapshot of every
 * table the service-role key can read, so a failed migration can be rolled
 * back at the data level without relying on a provider-side backup existing.
 *
 * JSON, not SQL: it is schema-tolerant (a table that gains a column does not
 * invalidate an old snapshot) and needs no DDL access to restore into.
 *
 * Reads only. Writes nothing to the database.
 *
 * Usage:
 *   node scripts/backup-data.js                  -> backend/backups/<ts>.json
 *   node scripts/backup-data.js --out=path.json
 *   node scripts/backup-data.js --tables=users,orders
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const PAGE = 1000;

async function fetchAll(supabase, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + PAGE - 1);
    if (error) return { error: error.message };
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return { rows };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY.');
    process.exit(1);
  }
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(url, key);

  const only = (process.argv.find((a) => a.startsWith('--tables=')) || '').split('=')[1];
  const tables = only ? only.split(',') : null;

  // Discover every exposed table from the OpenAPI spec rather than hardcoding a
  // list, so new tables are backed up automatically.
  let discovered = tables;
  if (!discovered) {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
    });
    const spec = await res.json().catch(() => null);
    discovered = spec?.paths
      ? Object.keys(spec.paths).filter((p) => !p.startsWith('/rpc/') && p !== '/').map((p) => p.slice(1))
      : [];
  }

  const snapshot = {
    takenAt: new Date().toISOString(),
    source: url.replace(/https:\/\/([^.]+)\..*/, 'https://$1.supabase.co'),
    tables: {},
    errors: {},
  };

  let total = 0;
  for (const table of discovered) {
    const { rows, error } = await fetchAll(supabase, table);
    if (error) {
      snapshot.errors[table] = error;
      console.log(`  ERROR    ${table.padEnd(24)} ${error}`);
      continue;
    }
    snapshot.tables[table] = rows;
    total += rows.length;
    console.log(`  ok       ${table.padEnd(24)} ${rows.length} row(s)`);
  }

  const outArg = (process.argv.find((a) => a.startsWith('--out=')) || '').split('=')[1];
  const stamp = snapshot.takenAt.replace(/[:.]/g, '-');
  const outPath = outArg || path.join(__dirname, '..', 'backups', `snapshot-${stamp}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

  console.log(`\n${Object.keys(snapshot.tables).length} table(s), ${total} row(s) captured.`);
  console.log(`Written: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
  if (Object.keys(snapshot.errors).length) {
    console.log(`WARNING: ${Object.keys(snapshot.errors).length} table(s) failed — not in this snapshot.`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});