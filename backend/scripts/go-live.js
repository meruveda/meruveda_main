/**
 * go-live — one command that finishes every setup gate and says exactly what
 * is left.
 *
 * Runs, in order, stopping at the FIRST failure:
 *
 *   1. ENV      every required variable reported as set / missing by NAME only.
 *               Optional ones are warned about. Missing required -> stop.
 *   2. BACKUP   the latest snapshot must report RESTORABLE, else stop.
 *   3. MIGRATE  verify the schema first; if it is already applied this is a
 *               clean no-op. Otherwise re-scan the bundle SQL for
 *               DROP / TRUNCATE / DELETE / UPDATE, record row counts, run the
 *               migration ONCE in a single transaction (no retry), re-verify,
 *               and require identical row counts.
 *   4. META     token valid, WABA assigned, phone id resolves, the OTP
 *               template is APPROVED / AUTHENTICATION / the exact language from
 *               env, and the invoice template too when the invoice flag is on.
 *   5. TABLE    one PASS / BLOCKED row per item, what is missing, and the exact
 *               next commands.
 *
 * Safety:
 *   - No secret value is ever printed. Only variable NAMES and set/missing.
 *   - It never sends a WhatsApp message. `wa:verify` is run without --send, and
 *     --send is only ever a manual, typed command.
 *   - Safe to run twice: step 3 skips cleanly when the schema is already applied.
 *
 * Usage:  npm run go-live
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BACKEND_DIR = path.resolve(__dirname, '..');
const BUNDLE_PATH = path.join(BACKEND_DIR, 'database', 'pending-migration.sql');

/** Tables whose row counts must be identical before and after the migration. */
const WATCHED_TABLES = ['users', 'orders', 'order_items', 'media', 'products'];

/**
 * Required variables. `names` is the accepted spellings, first non-empty wins —
 * this is a declaration, not a lookup, so nothing here can print a value.
 */
const REQUIRED_ENV = [
  {
    id: 'db-url',
    label: 'Postgres connection for migrations',
    names: [
      'SUPABASE_DB_URL', 'DATABASE_URL', 'DB_URL',
      'SUPABASE_DB_PASSWORD', 'DB_PASSWORD', 'PGPASSWORD', 'POSTGRES_PASSWORD', 'DB_PASS',
    ],
  },
  { id: 'wa-token', label: 'WhatsApp Cloud API token', names: ['WHATSAPP_API_TOKEN', 'WHATSAPP_TOKEN'] },
  { id: 'wa-phone', label: 'WhatsApp phone number ID', names: ['WHATSAPP_PHONE_NUMBER_ID'] },
  { id: 'wa-waba', label: 'WhatsApp Business Account ID', names: ['WHATSAPP_BUSINESS_ACCOUNT_ID'] },
  { id: 'wa-otp-template', label: 'OTP template name', names: ['WHATSAPP_OTP_TEMPLATE_NAME'] },
  { id: 'wa-lang', label: 'WhatsApp template language', names: ['WHATSAPP_TEMPLATE_LANG'] },
  { id: 'otp-secret', label: 'OTP hash secret', names: ['OTP_HASH_SECRET', 'OTP_HASH_PEPPER'] },
  { id: 'jwt-secret', label: 'JWT secret', names: ['JWT_SECRET'] },
];

/** Optional variables. Missing ones are a WARNING, never a stop. */
const OPTIONAL_ENV = [
  { id: 'admin-wa', label: 'Admin WhatsApp number (invoice copy)', names: ['ADMIN_WHATSAPP_NUMBER'] },
  {
    id: 'invoice-template',
    label: 'Invoice template name',
    names: ['WHATSAPP_INVOICE_TEMPLATE_NAME', 'INVOICE_WA_TEMPLATE_NAME'],
    // Required once the invoice flag is on.
    requiredWhenInvoiceOn: true,
  },
  { id: 'otp-enabled', label: 'Enable OTP endpoints (OTP_ENABLED)', names: ['OTP_ENABLED'] },
];

/* ------------------------------------------------------------------ */
/* Pure helpers (exported so they can be unit-tested directly)          */
/* ------------------------------------------------------------------ */

/** Strip full-line `--` comments so prose about DELETE does not trip the scan. */
function executableSql(sql) {
  return String(sql)
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');
}

/**
 * Scan the bundle for anything destructive.
 *
 * Delta 002 is excluded by contract: `ALTER TABLE ... RENAME COLUMN` has no
 * `IF EXISTS` guard, so it is not idempotent and would abort a run partway.
 */
function scanForDestructive(sql) {
  const body = executableSql(sql);
  const patterns = [
    [/\bDROP\s+(TABLE|SCHEMA|DATABASE|COLUMN|TYPE|POLICY|INDEX|FUNCTION|TRIGGER)\b/i, 'DROP'],
    [/\bTRUNCATE\b/i, 'TRUNCATE'],
    [/\bDELETE\s+FROM\b/i, 'DELETE'],
    [/\bUPDATE\s+[\w."]+\s+SET\b/i, 'UPDATE'],
  ];
  const found = [];
  for (const [re, label] of patterns) {
    const m = body.match(re);
    if (m) found.push(`${label}: ${m[0].trim()}`);
  }
  return found;
}

/**
 * Resolve a variable group against an environment object.
 * Returns { set, name } — the VALUE is never returned or logged.
 */
function checkEnvGroup(group, env) {
  for (const name of group.names) {
    const raw = env[name];
    if (raw === undefined) continue;
    const value = String(raw).trim();
    if (!value) continue;
    if (/^(your-|<|placeholder)/i.test(value) || value === 'PLACEHOLDER_TOKEN') continue;
    return { set: true, name };
  }
  return { set: false, name: group.names[0] };
}

/** Every required group resolved against `env`, in declaration order. */
function checkRequiredEnv(env) {
  return REQUIRED_ENV.map((g) => ({ ...g, ...checkEnvGroup(g, env) }));
}

function checkOptionalEnv(env, invoiceEnabled) {
  return OPTIONAL_ENV.map((g) => {
    const resolved = checkEnvGroup(g, env);
    const optional = !(g.requiredWhenInvoiceOn && invoiceEnabled);
    return { ...g, ...resolved, optional };
  });
}

/** Parse the single GO_LIVE_JSON line emitted by verify-whatsapp.js. */
function parseMetaJson(stdout) {
  const m = String(stdout).match(/GO_LIVE_JSON\s+(\{[^\n]*\})/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

/** Step 1 — env. Stops when a required variable is missing. */
function stepEnv(env) {
  const invoiceEnabled = env.WHATSAPP_INVOICE_ENABLED === 'true';
  const required = checkRequiredEnv(env).map((g) => ({
    id: g.id,
    label: g.label,
    status: g.set ? 'PASS' : 'BLOCKED',
    detail: g.set ? `set (${g.name})` : `missing — set ${g.names.join(' or ')}`,
  }));
  const optional = checkOptionalEnv(env, invoiceEnabled).map((g) => ({
    id: g.id,
    label: g.label,
    status: 'WARN',
    detail: g.set
      ? `set (${g.name})`
      : `not set${g.optional ? ' — optional' : ' — required because WHATSAPP_INVOICE_ENABLED=true'}`,
  }));

  const rows = [...required, ...optional];
  const blocked = required.filter((r) => r.status === 'BLOCKED');
  return {
    rows,
    ok: blocked.length === 0,
    blockedOn: blocked.map((b) => b.label),
  };
}

/** Step 2 — backup must be RESTORABLE. */
function stepBackup(runCommand) {
  const res = runCommand('scripts/verify-backup.js', ['--latest']);
  const out = res.stdout || '';
  // "NOT FULLY RESTORABLE" also contains "RESTORABLE", so check the negative too.
  const restorable = res.ok && /RESTORABLE/.test(out) && !/NOT FULLY RESTORABLE/.test(out);
  return {
    rows: [
      {
        id: 'backup',
        label: 'Latest backup is restorable',
        status: restorable ? 'PASS' : 'BLOCKED',
        detail: restorable
          ? 'RESTORABLE'
          : 'not restorable — run: npm run db:backup  (then re-run go-live)',
      },
    ],
    ok: restorable,
    blockedOn: restorable ? [] : ['a restorable backup'],
  };
}

/** Read exact row counts through PostgREST (HEAD + Prefer: count=exact). */
async function readRowCounts(env, fetchImpl) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL + SUPABASE_SERVICE_KEY are required to count rows');

  const out = {};
  for (const table of WATCHED_TABLES) {
    const res = await fetchImpl(`${url}/rest/v1/${table}?select=*`, {
      method: 'HEAD',
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
    });
    const total = res.headers?.get?.('content-range')?.split('/')[1];
    const n = Number(total);
    if (!Number.isFinite(n)) throw new Error(`could not read the row count for ${table}`);
    out[table] = n;
  }
  return out;
}

/**
 * Step 3 — migration.
 *
 * Already applied -> a clean, reported skip, and nothing is executed. That is
 * what makes `go-live` safe to run twice.
 */
async function stepMigrate(runCommand, env, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const readBundle = deps.readBundle || (() => fs.readFileSync(BUNDLE_PATH, 'utf8'));

  // Has the schema already landed?
  const verify = runCommand('scripts/verify-schema.js', ['--all']);
  if (verify.ok) {
    return {
      rows: [
        {
          id: 'schema',
          label: 'Schema already applied',
          status: 'PASS',
          detail: 'every delta 005/010 object is present — nothing to migrate',
        },
        {
          id: 'migration',
          label: 'Pending migration bundle',
          status: 'PASS',
          detail: 'skipped, the schema is already current',
        },
      ],
      ok: true,
      blockedOn: [],
    };
  }

  // Re-scan the bundle here as well as inside db:migrate:pending: defence in
  // depth, and so go-live stops BEFORE touching the database.
  let sql;
  try {
    sql = readBundle();
  } catch (err) {
    return {
      rows: [{
        id: 'sql-safety',
        label: 'Migration bundle is additive only',
        status: 'BLOCKED',
        detail: `could not read database/pending-migration.sql (${err.message})`,
      }],
      ok: false,
      blockedOn: ['the migration bundle'],
    };
  }

  const destructive = scanForDestructive(sql);
  if (destructive.length) {
    return {
      rows: [{
        id: 'sql-safety',
        label: 'Migration bundle is additive only',
        status: 'BLOCKED',
        detail: `refusing to run, found ${destructive.join(' | ')}`,
      }],
      ok: false,
      blockedOn: ['a destructive statement in the migration bundle'],
    };
  }

  // Row counts before anything is written.
  let before;
  try {
    before = await readRowCounts(env, fetchImpl);
  } catch (err) {
    return {
      rows: [{
        id: 'row-counts',
        label: 'Record row counts before migrating',
        status: 'BLOCKED',
        detail: err.message,
      }],
      ok: false,
      blockedOn: ['readable row counts'],
    };
  }

  // Run it ONCE. No retry: a migration that fails has already rolled back.
  const applied = runCommand('scripts/migrate-pending.js', []);
  if (!applied.ok) {
    return {
      rows: [
        { id: 'sql-safety', label: 'Migration bundle is additive only', status: 'PASS', detail: 'no DROP / TRUNCATE / DELETE / UPDATE (delta 002 excluded)' },
        {
          id: 'row-counts',
          label: 'Record row counts before migrating',
          status: 'PASS',
          detail: WATCHED_TABLES.map((t) => `${t}=${before[t]}`).join(' '),
        },
        {
          id: 'migration',
          label: 'Apply pending migration (one transaction, no retry)',
          status: 'BLOCKED',
          detail: 'failed and rolled back — no changes were committed',
        },
      ],
      ok: false,
      blockedOn: ['a successful migration'],
    };
  }

  const verifyAfter = runCommand('scripts/verify-schema.js', ['--all']);

  let after;
  try {
    after = await readRowCounts(env, fetchImpl);
  } catch (err) {
    return {
      rows: [
        { id: 'sql-safety', label: 'Migration bundle is additive only', status: 'PASS', detail: 'no DROP / TRUNCATE / DELETE / UPDATE (delta 002 excluded)' },
        { id: 'row-counts', label: 'Record row counts before migrating', status: 'PASS', detail: WATCHED_TABLES.map((t) => `${t}=${before[t]}`).join(' ') },
        { id: 'migration', label: 'Apply pending migration (one transaction, no retry)', status: 'PASS', detail: 'committed' },
        { id: 'row-counts-after', label: 'Row counts unchanged after migrating', status: 'BLOCKED', detail: err.message },
      ],
      ok: false,
      blockedOn: ['verifiable row counts after the migration'],
    };
  }

  const drift = WATCHED_TABLES.filter((t) => before[t] !== after[t]);
  const countsOk = drift.length === 0;

  return {
    rows: [
      { id: 'sql-safety', label: 'Migration bundle is additive only', status: 'PASS', detail: 'no DROP / TRUNCATE / DELETE / UPDATE (delta 002 excluded)' },
      { id: 'row-counts', label: 'Record row counts before migrating', status: 'PASS', detail: WATCHED_TABLES.map((t) => `${t}=${before[t]}`).join(' ') },
      { id: 'migration', label: 'Apply pending migration (one transaction, no retry)', status: applied.ok ? 'PASS' : 'BLOCKED', detail: applied.ok ? 'committed' : 'failed' },
      { id: 'schema-after', label: 'Schema verification (db:verify:all)', status: verifyAfter.ok ? 'PASS' : 'BLOCKED', detail: verifyAfter.ok ? 'all objects present' : 'objects still missing' },
      {
        id: 'row-counts-after',
        label: 'Row counts unchanged after migrating',
        status: countsOk ? 'PASS' : 'BLOCKED',
        detail: countsOk
          ? WATCHED_TABLES.map((t) => `${t}=${after[t]}`).join(' ')
          : `drifted: ${drift.map((t) => `${t} ${before[t]} -> ${after[t]}`).join(', ')}`,
      },
    ],
    ok: applied.ok && verifyAfter.ok && countsOk,
    blockedOn: countsOk ? [] : ['unchanged row counts'],
  };
}

/**
 * Step 4 — Meta.
 *
 * Runs `verify-whatsapp.js` WITHOUT --send, so this step never delivers a
 * message. Only booleans and template NAMES come back.
 */
function stepMeta(runCommand) {
  const res = runCommand('scripts/verify-whatsapp.js', []);
  const meta = parseMetaJson(res.stdout || '');
  if (!meta) {
    return {
      rows: [{
        id: 'meta',
        label: 'Meta credentials, phone id and templates',
        status: 'BLOCKED',
        detail: 'wa:verify produced no result — run: npm run wa:verify',
      }],
      ok: false,
      blockedOn: ['a readable wa:verify result'],
    };
  }

  const rows = [
    { id: 'meta-token', label: 'WhatsApp token accepted by Meta', status: meta.token ? 'PASS' : 'BLOCKED', detail: meta.token ? 'valid' : 'token rejected by Graph' },
    { id: 'meta-waba', label: 'WABA assigned to the system user', status: meta.waba ? 'PASS' : 'BLOCKED', detail: meta.waba ? 'assigned' : 'no WABA assigned / not set' },
    { id: 'meta-phone', label: 'Phone number ID resolves', status: meta.phoneId ? 'PASS' : 'BLOCKED', detail: meta.phoneId ? 'resolves' : 'id is wrong, or the system user cannot see it' },
    {
      id: 'meta-otp-template',
      label: 'OTP template approved (AUTHENTICATION)',
      status: meta.otpTemplate ? 'PASS' : 'BLOCKED',
      detail: meta.otpTemplate
        ? `"${meta.otpTemplateName}" approved, category AUTHENTICATION, language ${meta.otpTemplateLanguage}`
        : `"${meta.otpTemplateName || '(unset)'}" is not approved as an AUTHENTICATION template in language ${meta.otpTemplateLanguage || '(unset)'}`,
    },
  ];

  if (meta.invoiceTemplate !== null && meta.invoiceTemplate !== undefined) {
    rows.push({
      id: 'meta-invoice-template',
      label: 'Invoice template approved (UTILITY)',
      status: meta.invoiceTemplate ? 'PASS' : 'BLOCKED',
      detail: meta.invoiceTemplate
        ? `"${meta.invoiceTemplateName}" approved`
        : `"${meta.invoiceTemplateName || '(unset)'}" is not approved (needed because WHATSAPP_INVOICE_ENABLED=true)`,
    });
  }

  const blockedOn = rows.filter((r) => r.status === 'BLOCKED').map((r) => r.label);
  return { rows, ok: blockedOn.length === 0, blockedOn };
}

/* ------------------------------------------------------------------ */
/* Orchestration + table                                                */
/* ------------------------------------------------------------------ */

/** The exact next commands for whatever is still blocked. */
function nextCommands(rows) {
  const ids = new Set(rows.filter((r) => r.status === 'BLOCKED').map((r) => r.id));
  const cmds = [];
  if (ids.has('db-url')) cmds.push('set one of: ' + REQUIRED_ENV[0].names.join(' / ') + '  in backend/.env');
  if (ids.has('wa-token')) cmds.push('set WHATSAPP_API_TOKEN (or WHATSAPP_TOKEN) in backend/.env');
  if (ids.has('wa-phone')) cmds.push('set WHATSAPP_PHONE_NUMBER_ID in backend/.env');
  if (ids.has('wa-waba')) cmds.push('set WHATSAPP_BUSINESS_ACCOUNT_ID in backend/.env');
  if (ids.has('wa-otp-template')) cmds.push('set WHATSAPP_OTP_TEMPLATE_NAME to the exact approved template name');
  if (ids.has('wa-lang')) cmds.push('set WHATSAPP_TEMPLATE_LANG to the template language (e.g. en)');
  if (ids.has('otp-secret')) cmds.push('set OTP_HASH_SECRET (or OTP_HASH_PEPPER) — generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  if (ids.has('jwt-secret')) cmds.push('set JWT_SECRET — generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  if (ids.has('invoice-template')) cmds.push('set WHATSAPP_INVOICE_TEMPLATE_NAME, or set WHATSAPP_INVOICE_ENABLED=false to turn invoice delivery off');
  if (ids.has('backup')) cmds.push('npm run db:backup');
  if (ids.has('sql-safety')) cmds.push('edit backend/database/pending-migration.sql — it must be additive only');
  if (ids.has('row-counts') || ids.has('row-counts-after')) cmds.push('check SUPABASE_URL + SUPABASE_SERVICE_KEY in backend/.env');
  if (ids.has('migration')) cmds.push('npm run db:migrate:pending -- --dry-run   # then re-run go-live');
  if (ids.has('schema-after')) cmds.push('npm run db:verify:all');
  if (ids.has('meta-waba')) cmds.push('Meta → Business Settings → Users → System Users → Assign Assets → WhatsApp Business Account');
  if (ids.has('meta-otp-template') || ids.has('meta-invoice-template')) cmds.push('Meta → WhatsApp Manager → Message Templates — copy the exact approved name and category');
  if (ids.has('meta')) cmds.push('npm run wa:verify');
  cmds.push('npm run go-live                      # re-run; it is safe to run twice');
  cmds.push('npm run otp:smoke -- +91XXXXXXXXXX    # the one manual step: type the real code');
  return cmds;
}

function printTable(rows, ok) {
  const w = Math.max(...rows.map((r) => r.label.length), 'CHECK'.length);
  console.log('\nGO-LIVE');
  console.log('='.repeat(w + 60));
  console.log(`  ${'CHECK'.padEnd(w)}  ${'STATUS'.padEnd(8)}  DETAIL`);
  console.log('-'.repeat(w + 60));
  for (const r of rows) {
    console.log(`  ${r.label.padEnd(w)}  ${r.status.padEnd(8)}  ${r.detail}`);
  }
  console.log('='.repeat(w + 60));

  if (ok) {
    console.log('\nAll gates PASS. Everything below is done for you:');
    console.log('  npm run build          # optional, if you changed anything');
    console.log('  npm run otp:smoke -- +91XXXXXXXXXX');
    console.log('                           <- the ONE manual step. It sends a real code');
    console.log('                              and waits for you to type it. Until it passes,');
    console.log('                              nothing here proves a WhatsApp message arrives.');
    return;
  }

  console.log('\nBLOCKED. Do exactly this, in order:');
  nextCommands(rows).forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
}

/**
 * Run every gate in order, stopping at the first failure.
 * Returns { ok, rows } — no secret value is ever placed in either.
 */
async function runGoLive(options = {}) {
  const env = options.env || {};
  const rows = [];
  const runCommand =
    options.runCommand ||
    ((file, args) => {
      try {
        const stdout = execFileSync(process.execPath, [path.join(BACKEND_DIR, file), ...args], {
          encoding: 'utf8',
          cwd: BACKEND_DIR,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { ok: true, stdout: `${stdout || ''}` };
      } catch (e) {
        return {
          ok: false,
          stdout: `${e.stdout || ''}${e.stderr || ''}`,
        };
      }
    });

  // 1. env
  const envStep = stepEnv(env);
  rows.push(...envStep.rows);
  if (!envStep.ok) return { ok: false, rows };

  // 2. backup
  const backupStep = stepBackup(runCommand);
  rows.push(...backupStep.rows);
  if (!backupStep.ok) return { ok: false, rows };

  // 3. migration
  const migrateStep = await stepMigrate(runCommand, env, options);
  rows.push(...migrateStep.rows);
  if (!migrateStep.ok) return { ok: false, rows };

  // 4. meta
  const metaStep = stepMeta(runCommand);
  rows.push(...metaStep.rows);
  return { ok: metaStep.ok, rows };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

async function main() {
  try {
    require('dotenv').config({ path: path.join(BACKEND_DIR, '.env') });
  } catch {
    // No .env is a legitimate state — step 1 reports every variable missing.
  }

  console.log('go-live — one command, every gate, no secrets printed.');
  console.log('No WhatsApp message is sent by this command.\n');

  const { ok, rows } = await runGoLive({ env: process.env });
  printTable(rows, ok);
  process.exit(ok ? 0 : 1);
}

module.exports = {
  REQUIRED_ENV,
  OPTIONAL_ENV,
  WATCHED_TABLES,
  runGoLive,
  stepEnv,
  stepBackup,
  stepMigrate,
  stepMeta,
  checkEnvGroup,
  checkRequiredEnv,
  scanForDestructive,
  parseMetaJson,
  nextCommands,
  executableSql,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}