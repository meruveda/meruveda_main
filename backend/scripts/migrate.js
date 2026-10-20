/**
 * Neon migration runner — the ONE path that changes the schema.
 *
 * Reads backend/database/neon/*.sql in filename order. Each file runs inside
 * its own transaction against DATABASE_URL_UNPOOLED (migrations never go
 * through the pooled endpoint), and is recorded in public._migrations with a
 * sha256 checksum:
 *
 *   - applied + same checksum  -> no-op (safe re-run)
 *   - applied + new checksum   -> DRIFT: fail loudly instead of re-applying
 *   - not applied              -> run it
 *
 * Every file must be additive and idempotent (IF NOT EXISTS / OR REPLACE) so a
 * hand-applied schema baselines cleanly. The connection string is never
 * printed: only host and database name are shown.
 *
 * Connection: DATABASE_URL_UNPOOLED, falling back to DATABASE_URL.
 *
 * Usage:
 *   node scripts/migrate.js --dry-run   list pending, execute nothing
 *   node scripts/migrate.js             apply every pending migration
 *   node scripts/migrate.js --only=002  apply a single migration (by prefix)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'database', 'neon');
const MIGRATIONS_TABLE = 'public._migrations';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const onlyArg = argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.split('=')[1] : null;

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

function buildConnection() {
  const unpooled = (process.env.DATABASE_URL_UNPOOLED || '').trim();
  const pooled = (process.env.DATABASE_URL || '').trim();
  const url = unpooled || pooled;
  if (!url) {
    console.error('Missing DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL in backend/.env');
    process.exit(1);
  }
  if (!unpooled && url.includes('-pooler')) {
    console.warn('WARNING: only a pooled DATABASE_URL is set; migrations should use the unpooled endpoint.');
  }
  return url;
}

/** host/database only — never the credentials. */
function describe(connString) {
  try {
    const u = new URL(connString);
    return `${u.host}/${u.pathname.slice(1)}`;
  } catch {
    return '(unparseable connection string)';
  }
}

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`No migrations directory at ${path.relative(process.cwd(), MIGRATIONS_DIR)}`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((name) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
    return {
      name,
      sql,
      // The checksum is taken over the raw file (drift detection), but the
      // runner owns the transaction, so a file's own BEGIN/COMMIT wrapper is
      // stripped before execution — nested BEGIN only produces warnings and
      // would commit before the _migrations row is written.
      runnableSql: sql.replace(/^\s*BEGIN\s*;?/i, '').replace(/\bCOMMIT\s*;?\s*$/i, ''),
      checksum: crypto.createHash('sha256').update(sql).digest('hex'),
    };
  });
}

/** Additive-only guard: a migration may never drop or truncate anything. */
const DESTRUCTIVE = /^\s*(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE|DELETE\s+FROM)\b/im;
function assertAdditive(migration) {
  if (DESTRUCTIVE.test(migration.sql)) {
    console.error(`REFUSING ${migration.name}: destructive statement found (DROP/TRUNCATE/DELETE FROM).`);
    console.error('Migrations here are additive only.');
    process.exit(1);
  }
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name        TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      duration_ms INTEGER NOT NULL DEFAULT 0
    )`);
}

async function readApplied(client) {
  const { rows } = await client.query(`SELECT name, checksum FROM ${MIGRATIONS_TABLE}`);
  const map = new Map();
  for (const r of rows) map.set(r.name, r.checksum);
  return map;
}

function classifyConnectionError(err) {
  const code = err?.code;
  if (code === '28P01' || code === '28000') return 'authentication failed — check the password in backend/.env';
  if (code === '3D000') return 'database does not exist';
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') return 'could not reach the host';
  if (code === '57P03') return 'the database is starting up, retry in a few seconds';
  return err?.message || String(err);
}

async function main() {
  loadDotEnv();
  const { Client } = require('pg');
  const conn = buildConnection();
  const migrations = listMigrations().filter((m) => !only || m.name.startsWith(only));
  migrations.forEach(assertAdditive);

  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  console.log(`Neon migrations -> ${describe(conn)} (dir: database/neon)`);

  try {
    await client.connect();
    await ensureMigrationsTable(client);
    const applied = await readApplied(client);

    const pending = [];
    for (const migration of migrations) {
      const recorded = applied.get(migration.name);
      if (recorded === undefined) {
        pending.push(migration);
      } else if (recorded !== migration.checksum) {
        console.error(`DRIFT: ${migration.name} was applied with a different checksum.`);
        console.error('Never edit an applied migration — add a new file instead.');
        process.exit(2);
      }
    }

    if (pending.length === 0) {
      console.log(`Nothing to do: ${migrations.length} migration(s) already applied.`);
      return;
    }

    for (const migration of pending) {
      if (dryRun) {
        console.log(`  would apply ${migration.name}`);
        continue;
      }
      const started = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(migration.runnableSql);
        const duration = Date.now() - started;
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (name, checksum, duration_ms) VALUES ($1, $2, $3)`,
          [migration.name, migration.checksum, duration],
        );
        await client.query('COMMIT');
        console.log(`  applied ${migration.name} (${duration}ms)`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        console.error(`  FAILED ${migration.name}: ${classifyConnectionError(err)}`);
        process.exit(1);
      }
    }

    if (dryRun) console.log(`${pending.length} migration(s) pending (dry run, nothing executed).`);
    else console.log(`Done: ${pending.length} migration(s) applied.`);
  } catch (err) {
    console.error(`Migration run failed: ${classifyConnectionError(err)}`);
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main();
