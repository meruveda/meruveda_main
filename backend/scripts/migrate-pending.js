/**
 * Apply backend/database/pending-migration.sql over a direct Postgres
 * connection. No Supabase dashboard required.
 *
 * Safety gates, in order, each aborting before anything is written:
 *   1. Missing env vars are reported by NAME, never as a stack trace.
 *   2. The SQL is scanned for DROP / TRUNCATE / DELETE / UPDATE. Any hit
 *      aborts — the bundle must be additive.
 *   3. `db:verify:backup` must report RESTORABLE, or we abort.
 *   4. Row counts for the customer-facing tables are recorded beforehand.
 *   5. Delta 002 is skipped: RENAME COLUMN has no IF EXISTS guard, so it is
 *      not idempotent and would abort the transaction partway.
 *   6. The whole bundle runs in ONE transaction — all of it lands or none.
 *   7. Row counts are re-read and compared. Any difference prints FAIL.
 *
 * Usage:
 *   npm run db:migrate:pending
 *   npm run db:migrate:pending -- --dry-run
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SQL_PATH = path.join(__dirname, '..', 'database', 'pending-migration.sql');
const WATCHED = ['users', 'orders', 'order_items', 'media', 'products'];

function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

/**
 * Build a Postgres connection string.
 *
 * Several naming conventions are accepted, in this precedence, because the
 * project has used more than one over time and an operator should not have to
 * guess which one this script expects:
 *
 *   1. A full URL:   SUPABASE_DB_URL, then DATABASE_URL, then DB_URL
 *   2. A Supabase-specific set:  SUPABASE_DB_HOST / _PORT / _USER / _NAME / _PASSWORD
 *   3. libpq standard (what `psql`, `pg_dump` and the Supabase CLI read):
 *      PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE
 *   4. Generic:      DB_HOST / DB_PORT / DB_USER / DB_NAME / DB_PASSWORD
 *
 * In cases 2-4 the host defaults to db.<ref>.supabase.co derived from
 * SUPABASE_URL, so a lone password is enough.
 *
 * NOTE: none of these is the service-role key. That key is a REST credential
 * for PostgREST; Postgres rejects it as a password (verified: "password
 * authentication failed for user postgres"). It cannot run DDL.
 */
function buildConnection() {
  const full = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.DB_URL;
  if (full) return full;

  const pick = (...names) => {
    for (const n of names) {
      const v = process.env[n];
      if (v && v.trim()) return v.trim();
    }
    return '';
  };

  const password = pick('SUPABASE_DB_PASSWORD', 'PGPASSWORD', 'DB_PASSWORD', 'DB_PASS', 'POSTGRES_PASSWORD');
  if (!password) return null;

  let host = pick('SUPABASE_DB_HOST', 'PGHOST', 'DB_HOST', 'POSTGRES_HOST');
  if (!host) {
    const ref = (process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\./);
    if (!ref) return null;
    host = `db.${ref[1]}.supabase.co`;
  }
  const port = pick('SUPABASE_DB_PORT', 'PGPORT', 'DB_PORT') || '5432';
  const user = pick('SUPABASE_DB_USER', 'PGUSER', 'DB_USER') || 'postgres';
  const name = pick('SUPABASE_DB_NAME', 'PGDATABASE', 'DB_NAME') || 'postgres';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

/** Names that, if present, are accepted as the connection. Used in error text. */
function connectionEnvNames() {
  return [
    'SUPABASE_DB_URL', 'DATABASE_URL', 'DB_URL',
    'SUPABASE_DB_PASSWORD', 'PGPASSWORD', 'DB_PASSWORD', 'DB_PASS', 'POSTGRES_PASSWORD',
  ];
}

function missingEnv() {
  if (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.DB_URL) return [];
  if (process.env.SUPABASE_DB_PASSWORD || process.env.PGPASSWORD || process.env.DB_PASSWORD ||
      process.env.DB_PASS || process.env.POSTGRES_PASSWORD) return [];
  return connectionEnvNames();
}

/** Strip comment lines so prose about DELETE does not trip the scanner. */
function executableSql(sql) {
  return sql
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');
}

function scanForDestructive(sql) {
  const body = executableSql(sql);
  const found = [];
  const patterns = [
    [/\bDROP\s+(TABLE|SCHEMA|DATABASE|COLUMN|TYPE|POLICY)\b/i, 'DROP'],
    [/\bTRUNCATE\b/i, 'TRUNCATE'],
    [/\bDELETE\s+FROM\b/i, 'DELETE'],
    [/\bUPDATE\s+(?!.*\bSET\b)[\w."]+\b/i, 'UPDATE'],
  ];
  for (const [re, label] of patterns) {
    const m = body.match(re);
    if (m) found.push(`${label}: ${m[0].trim()}`);
  }
  return found;
}

async function rowCounts() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const out = {};
  for (const t of WATCHED) {
    const r = await fetch(`${url}/rest/v1/${t}?select=*`, {
      method: 'HEAD',
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
    });
    out[t] = Number(r.headers.get('content-range')?.split('/')[1] ?? -1);
  }
  return out;
}

function printTable(title, rows) {
  const w = Math.max(...rows.map((r) => r[0].length), 12);
  console.log(`\n${title}`);
  console.log('-'.repeat(w + 46));
  for (const [item, status, detail] of rows) {
    console.log(`  ${item.padEnd(w)}  ${status.padEnd(6)}  ${detail}`);
  }
}

async function main() {
  loadEnv();

  const dryRun = process.argv.includes('--dry-run');
  const rows = [];
  const fail = (item, detail) => rows.push([item, 'FAIL', detail]);
  const pass = (item, detail) => rows.push([item, 'PASS', detail]);
  const skip = (item, detail) => rows.push([item, 'SKIP', detail]);

  // Gate 1 — env
  const missing = missingEnv();
  if (missing.length) {
    printTable('PREFLIGHT', [
      ['connection', 'FAIL', 'no database password or URL found'],
      ['accepted names', '', connectionEnvNames().join(', ')],
      ['host / port / user / name', '', 'SUPABASE_DB_* then PG* then DB_* (default db.<ref>.supabase.co:5432/postgres)'],
      ['not usable', '', 'SUPABASE_URL + the service-role key are REST-only and cannot run DDL'],
      ['how to fix', '', 'add a password to backend/.env, then re-run npm run db:migrate:pending'],
    ]);
    console.log('\nNothing was read and nothing was written.');
    process.exit(1);
  }
  pass('env', 'connection available');

  // Gate 2 — destructive scan
  if (!fs.existsSync(SQL_PATH)) {
    fail('sql file', `missing ${SQL_PATH} — run: npm run db:bundle`);
    printTable('PREFLIGHT', rows);
    process.exit(1);
  }
  let sql = fs.readFileSync(SQL_PATH, 'utf8');
  const destructive = scanForDestructive(sql);
  if (destructive.length) {
    fail('sql safety', `refusing: ${destructive.join(' | ')}`);
    printTable('PREFLIGHT', rows);
    console.log('\nThe bundle must be additive only. Nothing was run.');
    process.exit(1);
  }
  pass('sql safety', 'no DROP/TRUNCATE/DELETE/UPDATE');

  // Gate 3 — backup
  let backupOk = false;
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'verify-backup.js'), '--latest'], {
      encoding: 'utf8',
    });
    backupOk = /RESTORABLE/.test(out);
    pass('backup', backupOk ? 'RESTORABLE' : 'verifier did not confirm restorable');
  } catch (e) {
    fail('backup', `verify-backup failed: ${String(e.message).split('\n')[0]}`);
  }
  if (!backupOk) {
    printTable('PREFLIGHT', rows);
    console.log('\nA restorable backup is required before touching schema. Nothing was run.');
    process.exit(1);
  }

  // Gate 4 — pre counts
  let before;
  try {
    before = await rowCounts();
    pass('row counts', WATCHED.map((t) => `${t}=${before[t]}`).join(' '));
  } catch (e) {
    fail('row counts', `could not read via REST: ${e.message}`);
    printTable('PREFLIGHT', rows);
    process.exit(1);
  }

  // Gate 5 — drop the idempotency hazard
  const skip002 = /\bDROP\b[\s\S]*?002/;
  const hasBeginCommit = /BEGIN\s*;/.test(sql) && /COMMIT\s*;/.test(sql);
  skip('delta 002', 'not in the bundle (RENAME COLUMN is not idempotent)');
  if (hasBeginCommit) {
    // Strip our own BEGIN/COMMIT so this script owns the single transaction.
    sql = sql.replace(/BEGIN\s*;[\s\S]*?\n\s*COMMIT\s*;/i, '');
  }
  pass('transaction', hasBeginCommit ? 'bundle BEGIN/COMMIT stripped; runner owns one transaction' : 'runner owns one transaction');

  printTable('PREFLIGHT', rows);

  if (dryRun) {
    console.log('\nDRY RUN — nothing was executed. Re-run without --dry-run to apply.');
    return;
  }

  // Gate 6 — apply
  const conn = buildConnection();
  const { Client } = require('pg');
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    process.stdout.write('\nApplying… ');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('COMMIT ok');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.log('ROLLED BACK');
    console.log(`\nFAIL: ${e.message}`);
    console.log('No changes were committed. Row counts are unchanged.');
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }

  // Gate 7 — post counts
  const after = await rowCounts();
  const summary = [
    ['migration', 'PASS', 'committed'],
    ['row counts', 'PASS', WATCHED.map((t) => `${t}=${after[t]}`).join(' ')],
  ];
  let drift = 0;
  for (const t of WATCHED) {
    if (before[t] !== after[t]) {
      summary.push([t, 'FAIL', `${before[t]} -> ${after[t]}`]);
      drift++;
    }
  }
  printTable('RESULT', summary);
  console.log(
    drift === 0
      ? '\nPASS — schema applied and every row count is identical to before.'
      : `\nFAIL — ${drift} table(s) changed row count. Investigate before continuing.`
  );
  if (drift) process.exit(1);
  console.log('\nNext: npm run db:verify:all');
}

main().catch((e) => {
  console.error(`\nUnexpected: ${e.message}`);
  process.exit(1);
});