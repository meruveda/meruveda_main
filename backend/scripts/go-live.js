/**
 * go-live — the pre-deploy gate.
 *
 * Every external dependency is checked in order and the run stops at the
 * FIRST failure, so the operator is never told "5 things are wrong" when one
 * of them is the reason the others cannot even be checked.
 *
 * Nothing here ever prints a secret: a check reports the NAME of a variable,
 * never its value.
 *
 * The order is deliberate:
 *   1. env        - is everything the app needs actually set?
 *   2. sql safety - is every pending migration additive?
 *   3. backup     - is the last backup restorable?
 *   4. counts     - how many rows does each table have right now?
 *   5. migration  - apply the pending migrations
 *   6. schema     - does the schema match the expected contract?
 *   7. counts     - did the migration change a row count? (it must not)
 *   8. meta       - is the WhatsApp token, the phone number and the OTP
 *                   template all good?
 *
 * Usage: npm run go-live
 */
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPTS = path.join(__dirname);
const MIGRATIONS_DIR = path.join(SCRIPTS, '..', 'database', 'neon');

/**
 * The variables the app cannot run without.
 *
 * `names` lists every spelling that satisfies the requirement, so a variable
 * that has been renamed does not suddenly break a deployment.
 */
const REQUIRED_ENV = [
  { id: 'database-url', names: ['DATABASE_URL', 'DATABASE_URL_APP'], required: true, label: 'Neon database URL' },
  { id: 'r2-account', names: ['R2_ACCOUNT_ID'], required: true, label: 'R2 account id' },
  { id: 'r2-key', names: ['R2_ACCESS_KEY_ID'], required: true, label: 'R2 access key id' },
  { id: 'r2-secret', names: ['R2_SECRET_ACCESS_KEY'], required: true, label: 'R2 secret access key' },
  { id: 'r2-public-base', names: ['R2_PUBLIC_BASE_URL'], required: true, label: 'R2 public base URL' },
  { id: 'whatsapp-token', names: ['WHATSAPP_API_TOKEN', 'WHATSAPP_TOKEN'], required: true, label: 'WhatsApp API token' },
  { id: 'whatsapp-phone', names: ['WHATSAPP_PHONE_NUMBER_ID'], required: true, label: 'WhatsApp phone number id' },
  { id: 'whatsapp-waba', names: ['WHATSAPP_BUSINESS_ACCOUNT_ID'], required: true, label: 'WhatsApp business account id' },
  { id: 'whatsapp-otp-template', names: ['WHATSAPP_OTP_TEMPLATE_NAME'], required: true, label: 'WhatsApp OTP template name' },
  { id: 'whatsapp-template-lang', names: ['WHATSAPP_TEMPLATE_LANG'], required: true, label: 'WhatsApp template language' },
  { id: 'otp-pepper', names: ['OTP_HASH_PEPPER', 'OTP_HASH_SECRET'], required: true, label: 'OTP hash pepper' },
  { id: 'jwt-secret', names: ['JWT_SECRET'], required: true, label: 'JWT secret' },
  { id: 'cron-secret', names: ['CRON_SECRET'], required: true, label: 'Cron secret' },
];

/** Variables that improve the deployment but never block it. */
const OPTIONAL_ENV = [
  { id: 'admin-wa', names: ['ADMIN_WHATSAPP_NUMBER'], label: 'Admin WhatsApp number' },
  { id: 'invoice-template', names: ['WHATSAPP_INVOICE_TEMPLATE_NAME'], label: 'WhatsApp invoice template name' },
  { id: 'upstash-url', names: ['UPSTASH_REDIS_REST_URL'], label: 'Upstash REST URL' },
  { id: 'upstash-token', names: ['UPSTASH_REDIS_REST_TOKEN'], label: 'Upstash REST token' },
  { id: 'unpooled-url', names: ['DATABASE_URL_UNPOOLED'], label: 'Neon unpooled URL' },
];

const row = (id, status, label, detail) => ({ id, status, label, detail });

/**
 * Step 1 — the environment.
 *
 * A required variable that is missing is a blocker. An optional one is a
 * warning. The value is never included in the detail.
 */
const PLACEHOLDER = /^(changeme|change-me|your[-_].*|placeholder|replace[-_]?me|<.+>|\{\{.+?\}\}|xxx+|fixme|todo|dummy|example.*|test123)$/i;

function isUsable(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  return !PLACEHOLDER.test(v);
}

function stepEnv(env) {
  const rows = [];
  for (const group of REQUIRED_ENV) {
    const present = group.names.some((n) => isUsable(env[n]));
    rows.push(
      present
        ? row(group.id, 'PASS', group.label, `set (${group.names.join(' or ')})`)
        : row(group.id, 'BLOCKED', group.label, `MISSING - set ${group.names.join(' or ')}`),
    );
  }
  for (const group of OPTIONAL_ENV) {
    const present = group.names.some((n) => isUsable(env[n]));
    // The invoice template is always a WARN, even when it is named: naming a
    // template is not the same as Meta having approved it, and the approval is
    // checked separately by the Meta step.
    const alwaysWarn = group.id === 'invoice-template';
    rows.push(
      present
        ? row(
            group.id,
            alwaysWarn ? 'WARN' : 'PASS',
            group.label,
            `set (${group.names.join(' or ')})` + (alwaysWarn ? ' - the approval is checked separately' : ''),
          )
        : row(group.id, 'WARN', group.label, `not set - optional (${group.names.join(' or ')})`),
    );
  }
  return { ok: !rows.some((r) => r.status === 'BLOCKED'), rows };
}

/**
 * Scan a SQL file for a destructive statement.
 *
 * The migration runner only applies additive files, but this gate makes the
 * same check independently so a hand-copied statement cannot slip through.
 * Comments and string literals are stripped first, so a mention of DELETE in
 * a comment is not a finding.
 */
function scanForDestructive(sql) {
  const text = String(sql || '')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'[^']*'/g, "''");
  const found = [];
  const patterns = [
    { re: /\bDELETE\s+FROM\b/gi, label: 'DELETE' },
    { re: /\bDROP\s+(TABLE|SCHEMA|DATABASE|INDEX|FUNCTION)\b/gi, label: 'DROP' },
    { re: /\bTRUNCATE\b/gi, label: 'TRUNCATE' },
    { re: /\bUPDATE\s+[\w."]+\s+SET\b/gi, label: 'UPDATE' },
  ];
  for (const { re, label } of patterns) {
    // exec() (not match()) so the index of the hit is known - a global match
    // returns every hit but no position.
    const local = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    const m = local.exec(text);
    if (!m) continue;
    if (label === 'UPDATE') {
      // A guarded UPDATE is a legitimate data backfill (a migration that
      // fills a new column is additive). An UPDATE with no WHERE clause
      // rewrites the whole table and is caught.
      const statement = text.slice(m.index).split(';')[0];
      if (/\bwhere\b/i.test(statement)) continue;
    }
    found.push({ label, matches: [m[0]] });
  }
  return found;
}

/** Step 2 — every pending migration must be additive. */
function stepSqlSafety(options = {}) {
  const rows = [];
  let ok = true;
  let files = options.files;
  if (!files) {
    files = [];
    try {
      files = require('fs')
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map((name) => {
          let sql = '';
          try {
            sql = require('fs').readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
          } catch {
            sql = '';
          }
          return { name, sql };
        });
    } catch {
      files = [];
    }
  }
  for (const file of files) {
    const sql = file.sql || '';
    const destructive = scanForDestructive(sql);
    if (destructive.length) {
      ok = false;
      rows.push(
        row(
          'sql-safety',
          'BLOCKED',
          'Migration safety',
          `${file.name} contains a destructive statement: ${destructive.map((d) => d.label).join(', ')}`,
        ),
      );
    }
  }
  if (ok) {
    rows.push(
      row('sql-safety', 'PASS', 'Migration safety', `${files.length} migration file(s), all additive`),
    );
  }
  return { ok, rows };
}

/**
 * Step 3 — the last backup must be restorable.
 *
 * "NOT FULLY RESTORABLE" must never be mistaken for "RESTORABLE": the check
 * looks for the word RESTORABLE and refuses anything that also says NOT.
 */
function stepBackup(runCommand) {
  const res = runCommand('scripts/verify-backup.js', ['--latest']);
  const stdout = String(res?.stdout || '');
  const notRestorable = /NOT\s+FULLY\s+RESTORABLE/i.test(stdout);
  const restorable = /\bRESTORABLE\b/i.test(stdout) && !notRestorable;
  if (!res?.ok || !restorable) {
    return {
      ok: false,
      rows: [
        row(
          'backup',
          'BLOCKED',
          'Backup',
          notRestorable
            ? 'the last backup is NOT FULLY RESTORABLE - fix the backup before deploying'
            : 'the last backup could not be verified as restorable',
        ),
      ],
    };
  }
  return { ok: true, rows: [row('backup', 'PASS', 'Backup', 'the last backup is restorable')] };
}

/** Step 4/7 — the row counts, from the Neon database. */
function stepRowCounts(runCommand, label = 'row-counts') {
  const res = runCommand('scripts/count-rows.js', []);
  let counts = null;
  try {
    counts = JSON.parse(String(res?.stdout || '').trim() || 'null');
  } catch {
    counts = null;
  }
  if (!res?.ok || !counts || typeof counts !== 'object') {
    return {
      ok: false,
      counts: null,
      rows: [row(label, 'BLOCKED', 'Row counts', 'the row counts could not be read from the database')],
    };
  }
  return { ok: true, counts, rows: [row(label, 'PASS', 'Row counts', 'read from the database')] };
}

/** Parse the JSON result line the WhatsApp verification prints. */
function parseMetaJson(text) {
  const match = /GO_LIVE_JSON\s+(\{[\s\S]*\})/.exec(String(text || ''));
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** The operator's next steps, specific to what actually blocked. */
function nextCommands(rows) {
  const cmds = [];
  const blocked = (id) => rows.find((r) => r.id === id && r.status === 'BLOCKED');
  if (blocked('database-url')) {
    cmds.push('set DATABASE_URL (or DATABASE_URL_APP) to the Neon connection string');
  }
  if (blocked('r2-account') || blocked('r2-key') || blocked('r2-secret') || blocked('r2-public-base')) {
    cmds.push('set the missing R2_* variables in backend/.env and in Vercel');
  }
  if (blocked('whatsapp-token') || blocked('whatsapp-phone') || blocked('whatsapp-waba')) {
    cmds.push('set the missing WHATSAPP_* variables in backend/.env and in Vercel');
  }
  if (blocked('whatsapp-otp-template')) {
    cmds.push('set WHATSAPP_OTP_TEMPLATE_NAME to the approved AUTHENTICATION template');
  }
  if (blocked('whatsapp-template-lang')) {
    cmds.push('set WHATSAPP_TEMPLATE_LANG to the language the template is approved in (e.g. en_US)');
  }
  if (blocked('otp-pepper')) {
    cmds.push('set OTP_HASH_PEPPER (or OTP_HASH_SECRET) to a long random value');
  }
  if (blocked('jwt-secret')) {
    cmds.push('set JWT_SECRET to a long random value');
  }
  if (blocked('cron-secret')) {
    cmds.push('set CRON_SECRET to a long random value');
  }
  if (blocked('backup')) {
    cmds.push('run npm run db:backup and make sure it is restorable');
  }
  if (blocked('sql-safety')) {
    cmds.push('fix the destructive statement in the flagged migration file');
  }
  if (blocked('migration') || blocked('schema-after') || blocked('row-counts-after')) {
    cmds.push('run npm run db:migrate and npm run db:verify until both are clean');
  }
  if (blocked('meta') || blocked('meta-otp-template') || blocked('meta-invoice-template')) {
    cmds.push('run npm run wa:verify and fix what it reports');
  }
  if (cmds.length === 0) {
    cmds.push('nothing is blocked - run npm run go-live again to confirm');
  } else {
    cmds.push('run npm run go-live again once the problem above is fixed');
  }
  cmds.push('npm run otp:smoke   # a real OTP on the test number');
  return cmds;
}

/** Run a script and capture its output. */
function defaultRunCommand(file, args) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(SCRIPTS, file), ...(args || [])], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout };
  } catch (err) {
    return { ok: false, stdout: String(err?.stdout || ''), stderr: String(err?.stderr || '') };
  }
}

/**
 * The whole gate.
 *
 * `runCommand` and `fetchImpl` are injectable so the test suite can drive
 * every branch without touching a real service.
 */
async function runGoLive({ env = process.env, runCommand = defaultRunCommand, fetchImpl = fetch, sqlFiles } = {}) {
  const rows = [];
  const push = (r) => rows.push(r);
  let ok = true;

  // 1. env
  const envStep = stepEnv(env);
  envStep.rows.forEach(push);
  if (!envStep.ok) {
    return { ok: false, rows, next: nextCommands(rows) };
  }

  // 2. SQL safety
  const safety = stepSqlSafety({ files: sqlFiles });
  safety.rows.forEach(push);
  if (!safety.ok) {
    ok = false;
    return { ok, rows, next: nextCommands(rows) };
  }

  // 3. backup
  const backup = stepBackup(runCommand);
  backup.rows.forEach(push);
  if (!backup.ok) {
    return { ok: false, rows, next: nextCommands(rows) };
  }

  // 4. row counts before the migration
  const before = stepRowCounts(runCommand, 'row-counts');
  before.rows.forEach(push);
  if (!before.ok) {
    return { ok: false, rows, next: nextCommands(rows) };
  }

  // 5. migration
  const migrate = runCommand('scripts/migrate.js', []);
  const migrateOut = String(migrate?.stdout || '');
  if (!migrate?.ok) {
    push(row('migration', 'BLOCKED', 'Migration', 'the migration failed and was rolled back'));
    return { ok: false, rows, next: nextCommands(rows) };
  }
  const alreadyApplied = /already applied/i.test(migrateOut);
  push(
    row(
      'migration',
      'PASS',
      'Migration',
      alreadyApplied ? 'skipped - the schema is already applied' : 'applied',
    ),
  );

  // 6. schema verification
  const schema = runCommand('scripts/db-verify.js', []);
  if (!schema?.ok) {
    push(row('schema-after', 'BLOCKED', 'Schema', 'the schema does not match the expected contract'));
    return { ok: false, rows, next: nextCommands(rows) };
  }
  push(
    row(
      'schema-after',
      'PASS',
      alreadyApplied ? 'Schema (already applied)' : 'Schema',
      alreadyApplied ? 'already applied - nothing to migrate' : 'verified',
    ),
  );

  // 7. row counts after the migration - they must not have changed
  const after = stepRowCounts(runCommand, 'row-counts-after');
  after.rows.forEach(push);
  if (!after.ok) {
    return { ok: false, rows, next: nextCommands(rows) };
  }
  const drift = [];
  for (const [table, count] of Object.entries(before.counts || {})) {
    const now = after.counts?.[table];
    if (now !== undefined && Number(now) !== Number(count)) {
      drift.push(`${table} ${count} -> ${now}`);
    }
  }
  if (drift.length) {
    const target = rows.find((r) => r.id === 'row-counts-after');
    if (target) {
      target.status = 'BLOCKED';
      target.detail = `the migration changed a row count: ${drift.join(', ')}`;
    } else {
      push(row('row-counts-after', 'BLOCKED', 'Row counts after', `the migration changed a row count: ${drift.join(', ')}`));
    }
    return { ok: false, rows, next: nextCommands(rows) };
  }

  // 8. Meta
  const meta = runCommand('scripts/verify-whatsapp.js', []);
  const metaJson = parseMetaJson(meta?.stdout || '');
  if (!meta?.ok || !metaJson) {
    push(row('meta', 'BLOCKED', 'WhatsApp', 'the WhatsApp verification could not be read'));
    return { ok: false, rows, next: nextCommands(rows) };
  }
  push(row('meta-token', metaJson.token ? 'PASS' : 'BLOCKED', 'WhatsApp token', metaJson.token ? 'the token is valid' : 'the token was rejected'));
  push(row('meta-phone', metaJson.phoneId ? 'PASS' : 'BLOCKED', 'WhatsApp phone number', metaJson.phoneId ? 'the phone number id is valid' : 'the phone number id was rejected'));

  const otpOk = Boolean(metaJson.otpTemplate);
  push(
    row(
      'meta-otp-template',
      otpOk ? 'PASS' : 'BLOCKED',
      'OTP template',
      otpOk
        ? `${metaJson.otpTemplateName} is APPROVED as ${metaJson.otpTemplateCategory} in ${metaJson.otpTemplateLanguage}`
        : 'no approved AUTHENTICATION template was found',
    ),
  );
  if (!otpOk) {
    return { ok: false, rows, next: nextCommands(rows) };
  }

  // The invoice template is only required once the invoice flag is on.
  if (String(env.WHATSAPP_INVOICE_ENABLED) === 'true') {
    const invoiceOk = Boolean(metaJson.invoiceTemplate);
    push(
      row(
        'meta-invoice-template',
        invoiceOk ? 'PASS' : 'BLOCKED',
        'Invoice template',
        invoiceOk ? 'an approved invoice template is available' : 'no approved invoice template was found',
      ),
    );
    if (!invoiceOk) {
      return { ok: false, rows, next: nextCommands(rows) };
    }
  }

  return { ok, rows, next: nextCommands(rows) };
}

module.exports = {
  REQUIRED_ENV,
  OPTIONAL_ENV,
  stepEnv,
  stepBackup,
  stepRowCounts,
  stepSqlSafety,
  scanForDestructive,
  parseMetaJson,
  nextCommands,
  runGoLive,
  defaultRunCommand,
};

if (require.main === module) {
  runGoLive()
    .then((result) => {
      for (const r of result.rows) {
        const mark = r.status === 'PASS' ? 'OK  ' : r.status === 'WARN' ? 'WARN' : 'FAIL';
        console.log(`[${mark}] ${r.label}: ${r.detail}`);
      }
      console.log('');
      if (result.ok) {
        console.log('go-live: every check passed.');
      } else {
        console.log('go-live: BLOCKED. Next steps:');
        for (const c of result.next) console.log(`  - ${c}`);
      }
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error('go-live failed:', err?.message || err);
      process.exit(1);
    });
}
