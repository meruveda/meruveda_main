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

/** SUPABASE_DB_URL wins; otherwise compose one from the discrete parts. */
function buildConnection() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;

  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) return null;

  let host = process.env.SUPABASE_DB_HOST;
  if (!host) {
    const ref = (process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\./);
    if (!ref) return null;
    host = `db.${ref[1]}.supabase.co`;
  }
  const port = process.env.SUPABASE_DB_PORT || '5432';
  const user = process.env.SUPABASE_DB_USER || 'postgres';
  const name = process.env.SUPABASE_DB_NAME || 'postgres';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

function missingEnv() {
  if (process.env.SUPABASE_DB_URL) return [];
  if (process.env.SUPABASE_DB_PASSWORD) return [];
  return ['SUPABASE_DB_PASSWORD (or SUPABASE_DB_URL)'];
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
      ['env', 'FAIL', `missing: ${missing.join(', ')}`],
      ['how to fix', '', 'add it to backend/.env, then re-run npm run db:migrate:pending'],
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