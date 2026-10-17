/**
 * Delta migration runner.
 *
 * The Supabase REST client (@supabase/supabase-js) can only read and write rows
 * through PostgREST. It cannot run DDL - this project exposes zero SQL-executing
 * RPCs, so `CREATE TABLE` is impossible over REST. Applying
 * database/deltas/*.sql therefore needs a direct Postgres connection.
 *
 * Design:
 *   - Migrations run in filename order (001, 002, ... 010).
 *   - Each runs inside its own transaction, so a failure leaves nothing behind.
 *   - Applied files are recorded in public._migrations with a sha256 checksum;
 *     re-running is a no-op, and an edited file is reported as drift rather
 *     than silently re-applied.
 *   - The connection string is never logged. Only host and database are shown.
 *
 * Connection (in order of precedence):
 *   DATABASE_URL                  full postgres:// connection string
 *   SUPABASE_DB_HOST + SUPABASE_DB_PASSWORD + SUPABASE_URL
 *                                 host defaults to db.<ref>.supabase.co
 *
 * Usage:
 *   node scripts/migrate.js --dry-run     list pending, execute nothing
 *   node scripts/migrate.js               apply every pending delta
 *   node scripts/migrate.js --only=005    apply a single delta by number
 *   node scripts/migrate.js --baseline    record already-satisfied deltas
 *
 * --baseline exists because _migrations starts empty on a database that was
 * migrated by hand through the SQL editor. Without it the runner would treat
 * 001-004 and 007 as pending and re-run them; 002 in particular is NOT
 * idempotent (ALTER TABLE ... RENAME COLUMN has no IF EXISTS guard) and would
 * abort the whole run. Baseline probes each delta's objects over PostgREST and
 * records the delta as applied when they are all already present.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DELTAS_DIR = path.join(__dirname, '..', 'database', 'deltas');
const MIGRATIONS_TABLE = 'public._migrations';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const baseline = argv.includes('--baseline');
const onlyArg = argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.split('=')[1] : null;

/**
 * Objects each delta is expected to create, mirroring the statements in the
 * SQL itself. Baseline uses this to decide whether a delta is already applied.
 */
const INVENTORY = {
  '001_shiprocket_migration.sql': [
    'products.weight', 'products.length', 'products.breadth', 'products.height', 'products.hsn',
    'orders.shiprocket_order_id', 'orders.shipment_id', 'orders.awb_code', 'orders.courier_name',
    'orders.tracking_url', 'orders.tracking_status', 'orders.pickup_location', 'orders.shipping_cost',
    'orders.estimated_delivery', 'orders.manifest_url', 'orders.label_url', 'orders.invoice_url',
    'orders.last_tracking_sync',
  ],
  '002_media_migration.sql': [
    'media.public_url', 'media.bucket', 'media.size', 'media.mime_type', 'media.storage_path',
  ],
  '003_missing_tables_and_transactions.sql': [
    'cms_pages', 'activity_logs', 'support_tickets', 'transactions', 'order_tracking_history',
  ],
  '004_banners_migration.sql': ['banners'],
  '005_otp_whatsapp_review_requests.sql': [
    'otps', 'whatsapp_message_log', 'review_requests', 'users.address', 'users.last_login_at',
  ],
  '006_missing_columns.sql': ['orders.delivered_at', 'reviews.is_featured', 'reviews.reply'],
  '007_mobile_auth.sql': ['users.reset_password_token', 'users.reset_password_expires'],
  '008_reviews_is_featured.sql': ['reviews.is_featured', 'reviews.reply'],
  '009_page_views.sql': ['page_views', 'users.phone_verified'],
  '010_auto_invoice_shiprocket.sql': [
    'orders.invoice_sent_at', 'orders.invoice_error', 'orders.shiprocket_push_status',
    'orders.shiprocket_push_error', 'orders.shiprocket_pushed_at', 'orders.shiprocket_push_started_at',
  ],
};

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

function buildConnection() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) return null;

  let host = process.env.SUPABASE_DB_HOST;
  if (!host) {
    const ref = (process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
    if (!ref) return null;
    host = `db.${ref[1]}.supabase.co`;
  }
  const user = process.env.SUPABASE_DB_USER || 'postgres';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:5432/postgres`;
}

/** Never print the password: show only host + database. */
function describe(connString) {
  try {
    const u = new URL(connString);
    return `${u.hostname}:${u.port || 5432}/${u.pathname.replace(/^\//, '')}`;
  } catch {
    return '(unparseable connection string)';
  }
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      filename    TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function readApplied(client) {
  const { rows } = await client.query(`SELECT filename, checksum FROM ${MIGRATIONS_TABLE}`);
  return new Map(rows.map((r) => [r.filename, r.checksum]));
}

function listDeltas() {
  return fs
    .readdirSync(DELTAS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .filter((f) => (only ? f.startsWith(`${only}_`) : true))
    .map((filename) => {
      const sql = fs.readFileSync(path.join(DELTAS_DIR, filename), 'utf8');
      return { filename, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
    });
}

/**
 * Safety gate: refuse to run a migration that contains a destructive verb.
 * Every checked-in delta is additive; this catches a bad local edit before it
 * reaches production data rather than after.
 */
const DESTRUCTIVE = /^\s*(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE|DELETE\s+FROM)\b/im;
function assertAdditive(delta) {
  const hit = delta.sql.match(DESTRUCTIVE);
  if (hit) {
    throw new Error(
      `${delta.filename} contains a destructive statement (${hit[0].trim()}). Refusing to run it.`
    );
  }
}

/**
 * Baseline: record deltas whose objects are all already present.
 * Runs over PostgREST, so it works before any direct connection exists.
 */
async function runBaseline() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY are required to baseline.');
    process.exit(1);
  }
  const H = { apikey: key, Authorization: `Bearer ${key}` };
  const present = async (name) => {
    const dot = name.indexOf('.');
    if (dot === -1) return (await fetch(`${url}/rest/v1/${name}?select=*&limit=1`, { headers: H })).ok;
    const t = name.slice(0, dot);
    const c = name.slice(dot + 1);
    return (await fetch(`${url}/rest/v1/${t}?select=${encodeURIComponent(c)}&limit=1`, { headers: H })).ok;
  };

  const conn = buildConnection();
  if (conn) {
    const { Client } = require('pg');
    const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      await ensureMigrationsTable(client);
      for (const delta of listDeltas()) {
        const objects = INVENTORY[delta.filename];
        if (!objects) {
          console.log(`  no inventory  ${delta.filename} - cannot baseline, skipping`);
          continue;
        }
        const missing = [];
        for (const o of objects) if (!(await present(o))) missing.push(o);
        if (missing.length === 0) {
          await client.query(
            `INSERT INTO ${MIGRATIONS_TABLE} (filename, checksum) VALUES ($1, $2)
             ON CONFLICT (filename) DO NOTHING`,
            [delta.filename, delta.checksum]
          );
          console.log(`  baselined  ${delta.filename} (all ${objects.length} objects present)`);
        } else {
          console.log(`  pending    ${delta.filename}  missing: ${missing.join(', ')}`);
        }
      }
    } finally {
      await client.end().catch(() => {});
    }
  } else {
    console.log('No direct connection yet - reporting what baseline WOULD record:\n');
    for (const delta of listDeltas()) {
      const objects = INVENTORY[delta.filename];
      if (!objects) { console.log(`  no inventory  ${delta.filename}`); continue; }
      const missing = [];
      for (const o of objects) if (!(await present(o))) missing.push(o);
      console.log(
        missing.length === 0
          ? `  would baseline  ${delta.filename}`
          : `  would stay pending  ${delta.filename}  missing: ${missing.join(', ')}`
      );
    }
  }
}

async function main() {
  loadDotEnv();

  if (baseline) {
    await runBaseline();
    return;
  }

  const conn = buildConnection();
  if (!conn) {
    console.error(
      [
        'No Postgres connection available.',
        '',
        'PostgREST cannot run DDL, so a direct connection is required. Set ONE of:',
        '  DATABASE_URL                 postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres',
        '  SUPABASE_DB_PASSWORD         the project database password',
        '  (+ optional SUPABASE_DB_HOST, defaults to db.<ref>.supabase.co)',
        '',
        'The password is in Supabase -> Project Settings -> Database, or in the',
        'original project-setup email. Do not paste it into chat.',
      ].join('\n')
    );
    process.exit(1);
  }

  const { Client } = require('pg');
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

  console.log(`Target      : ${describe(conn)}`);
  console.log(`Mode        : ${dryRun ? 'DRY RUN (nothing will be executed)' : 'APPLY'}`);
  console.log(`Delta dir   : ${DELTAS_DIR}\n`);

  try {
    await client.connect();
    await ensureMigrationsTable(client);
    const applied = await readApplied(client);
    const deltas = listDeltas();

    let pending = 0;
    for (const delta of deltas) {
      const prior = applied.get(delta.filename);
      if (prior === delta.checksum) {
        console.log(`  skip     ${delta.filename} (already applied)`);
        continue;
      }
      if (prior !== undefined) {
        console.log(
          `  DRIFT    ${delta.filename} was applied but the file has changed since.`
        );
        console.log('           Refusing to re-apply. Resolve the difference manually.');
        process.exitCode = 1;
        continue;
      }
      pending += 1;
      if (dryRun) {
        console.log(`  pending  ${delta.filename}`);
        continue;
      }

      assertAdditive(delta);
      process.stdout.write(`  apply    ${delta.filename} ... `);
      try {
        await client.query('BEGIN');
        await client.query(delta.sql);
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (filename, checksum) VALUES ($1, $2)
           ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
          [delta.filename, delta.checksum]
        );
        await client.query('COMMIT');
        console.log('ok');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log('FAILED');
        console.error(`\n${err.message}\n`);
        console.error('Rolled back. No changes were applied.');
        process.exit(1);
      }
    }

    console.log(
      `\n${dryRun ? `${pending} delta(s) pending.` : pending === 0 ? 'Nothing to apply.' : `${pending} delta(s) applied.`}`
    );
    if (!dryRun && pending > 0) console.log('Run: node scripts/verify-schema.js to confirm the objects exist.');
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});