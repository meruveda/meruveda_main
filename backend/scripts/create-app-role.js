/**
 * One-time (repeatable) setup of the least-privilege runtime role.
 *
 *   meruveda_app   -> SELECT / INSERT / UPDATE / DELETE + sequences + function
 *                     EXECUTE. No DDL, no CREATEROLE, no BYPASSRLS, not superuser.
 *                     Used by the API at runtime (DATABASE_URL_APP).
 *   owner          -> DATABASE_URL_UNPOOLED, migrations only.
 *
 * The generated password is written to backend/.env (gitignored) and NEVER
 * printed, logged or committed. Run:
 *
 *   node scripts/create-app-role.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENV_PATH = path.join(__dirname, '..', '.env');
const ROLE = 'meruveda_app';

function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return new Map();
  const map = new Map();
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function upsertEnv(name, value) {
  const lines = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)
    : [];
  const idx = lines.findIndex((l) => l.startsWith(`${name}=`));
  const line = `${name}=${value}`;
  if (idx >= 0) lines[idx] = line;
  else {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(line, '');
  }
  fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf8');
}

async function main() {
  const env = readEnvFile();
  const ownerUrl = (env.get('DATABASE_URL_UNPOOLED') || env.get('DATABASE_URL') || '').trim();
  if (!ownerUrl) {
    console.error('Missing DATABASE_URL_UNPOOLED / DATABASE_URL in backend/.env');
    process.exit(1);
  }
  if (ownerUrl.includes('-pooler')) {
    console.warn('WARNING: owner URL looks pooled; migrations should use the unpooled endpoint.');
  }

  // Reuse the password already in .env on re-runs, otherwise mint a new one.
  // base64url => URL-safe, no quoting needed inside the connection string.
  const existing = (env.get('DATABASE_URL_APP') || '').trim();
  let password;
  if (existing) {
    try {
      password = decodeURIComponent(new URL(existing).password);
    } catch {
      password = null;
    }
  }
  if (!password) password = crypto.randomBytes(24).toString('base64url');

  const { Client } = require('pg');
  const client = new Client({ connectionString: ownerUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    // Role (idempotent) + password sync.
    await client.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
           CREATE ROLE ${ROLE} LOGIN PASSWORD '${password}';
         ELSE
           ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password}';
         END IF;
       END $$;`,
    );

    const dbName = new URL(ownerUrl).pathname.slice(1);

    const statements = [
      `GRANT CONNECT ON DATABASE ${client.database || dbName} TO ${ROLE};`,
      `GRANT USAGE ON SCHEMA public TO ${ROLE};`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE};`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE};`,
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${ROLE};`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE};`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE};`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${ROLE};`,
      // NOTE: the attributes below are the defaults for a CREATE ROLE and Neon
      // forbids `ALTER ROLE ... NOSUPERUSER` ("permission denied to alter
      // role"), so they are verified rather than re-stated.
    ];
    for (const sql of statements) await client.query(sql);

    const privileges = await client.query(
      `SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
         FROM pg_roles WHERE rolname = $1`,
      [ROLE],
    );
    const tableGrants = await client.query(
      `SELECT has_table_privilege($1, 'orders', 'INSERT') AS can_insert,
              has_table_privilege($1, 'orders', 'TRUNCATE') AS can_truncate`,
      [ROLE],
    );

    const host = new URL(ownerUrl).host;
    const appUrl = `postgresql://${ROLE}:${encodeURIComponent(password)}@${host}/${dbName}?sslmode=require&channel_binding=require`;
    upsertEnv('DATABASE_URL_APP', appUrl);

    const r = privileges.rows[0];
    console.log(`role ${ROLE}: superuser=${r.rolsuper} createrole=${r.rolcreaterole} createdb=${r.rolcreatedb} bypassrls=${r.rolbypassrls}`);
    console.log(`orders INSERT=${tableGrants.rows[0].can_insert} TRUNCATE=${tableGrants.rows[0].can_truncate} (TRUNCATE must be false)`);
    if (r.rolsuper || r.rolcreaterole || r.rolcreatedb || r.rolbypassrls) {
      console.error('REFUSING: the runtime role has elevated attributes. Recreate it.');
      process.exit(1);
    }
    if (!tableGrants.rows[0].can_insert || tableGrants.rows[0].can_truncate) {
      console.error('REFUSING: unexpected table privileges on meruveda_app.');
      process.exit(1);
    }
    console.log(`backend/.env updated with DATABASE_URL_APP (value not shown).`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(`create-app-role failed: ${err?.message || err}`);
  process.exit(1);
});
