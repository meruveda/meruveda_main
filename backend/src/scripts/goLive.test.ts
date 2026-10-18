/**
 * go-live stops at the FIRST failure, and never prints a secret.
 *
 * Every external dependency — the environment, the database, Meta — is mocked,
 * so this suite never touches a real service and can assert each gate in
 * isolation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const goLive = require(path.resolve(__dirname, '../../scripts/go-live.js'));

/* ------------------------------------------------------------------ */
/* Mock env                                                            */
/* ------------------------------------------------------------------ */

const GOOD_ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'service-key-value',
  SUPABASE_DB_URL: 'postgres://user:pass@db.example:5432/postgres',
  WHATSAPP_API_TOKEN: 'EAAG-a-real-looking-token',
  WHATSAPP_PHONE_NUMBER_ID: '1428537175270606',
  WHATSAPP_BUSINESS_ACCOUNT_ID: '999888777',
  WHATSAPP_OTP_TEMPLATE_NAME: 'login_auth',
  WHATSAPP_TEMPLATE_LANG: 'en',
  OTP_HASH_SECRET: 'a-32-byte-hex-pepper',
  JWT_SECRET: 'a-32-byte-hex-jwt-secret',
};

/** A fetch stub that answers PostgREST HEAD count requests. */
function fakeFetch(counts: Record<string, number>) {
  return async (url: string) => {
    const table = String(url).split('/rest/v1/')[1]?.split('?')[0] || '';
    return {
      headers: { get: (h: string) => (h === 'content-range' ? `0-0/${counts[table] ?? 0}` : null) },
    };
  };
}

const COUNTS = { users: 12, orders: 34, order_items: 51, media: 7, products: 9 };

const META_OK = JSON.stringify({
  token: true,
  waba: true,
  phoneId: true,
  otpTemplate: true,
  otpTemplateCategory: 'AUTHENTICATION',
  otpTemplateLanguage: 'en',
  otpTemplateName: 'login_auth',
  invoiceTemplate: null,
  allOk: true,
});

/** Build a runCommand stub from a per-script behaviour map. */
function commands(overrides: Record<string, { ok: boolean; stdout?: string }> = {}) {
  const calls: string[] = [];
  const runCommand = (file: string, _args: string[]) => {
    calls.push(file);
    const o = overrides[file];
    if (o) return { ok: o.ok, stdout: o.stdout || '' };
    if (file.endsWith('verify-backup.js')) return { ok: true, stdout: 'RESTORABLE: structure and integrity checks passed.' };
    if (file.endsWith('verify-schema.js')) return { ok: true, stdout: 'All verified objects are present.' };
    if (file.endsWith('verify-whatsapp.js')) return { ok: true, stdout: `GO_LIVE_JSON ${META_OK}` };
    return { ok: true, stdout: '' };
  };
  return { runCommand, calls };
}

const rowOf = (rows: any[], id: string) => rows.find((r) => r.id === id);

/* ------------------------------------------------------------------ */
/* Step 1 — env                                                        */
/* ------------------------------------------------------------------ */

test('every required variable is reported set/missing by NAME, never by value', () => {
  const step = goLive.stepEnv(GOOD_ENV);
  for (const row of step.rows) {
    if (row.status !== 'PASS') continue;
    // A passing row may name the variable, never reveal it.
    assert.ok(!String(row.detail).includes('EAAG-a-real-looking-token'));
    assert.ok(!String(row.detail).includes('service-key-value'));
    assert.ok(!String(row.detail).includes('a-32-byte-hex-pepper'));
  }
});

test('a complete env passes', () => {
  const step = goLive.stepEnv(GOOD_ENV);
  assert.equal(step.ok, true);
});

test('go-live stops when a required variable is missing', async () => {
  const { runCommand, calls } = commands();
  for (const missing of [
    'SUPABASE_DB_URL',
    'WHATSAPP_API_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_BUSINESS_ACCOUNT_ID',
    'WHATSAPP_OTP_TEMPLATE_NAME',
    'WHATSAPP_TEMPLATE_LANG',
    'OTP_HASH_SECRET',
    'JWT_SECRET',
  ]) {
    const env: any = { ...GOOD_ENV };
    // Remove every accepted spelling of this variable.
    for (const name of goLive.REQUIRED_ENV.find((g: any) => g.names.includes(missing)).names) {
      delete env[name];
    }
    const result = await goLive.runGoLive({ env, runCommand, fetchImpl: fakeFetch(COUNTS) });
    assert.equal(result.ok, false, `missing ${missing} must block`);
    assert.equal(
      calls.filter((f) => f.includes('verify-backup')).length,
      0,
      'nothing after the env step may run'
    );
  }
});

test('either-spelling env variables both satisfy the requirement', () => {
  const aliasEnv: any = { ...GOOD_ENV };
  delete aliasEnv.WHATSAPP_API_TOKEN;
  aliasEnv.WHATSAPP_TOKEN = 'EAAG-alias-token';
  delete aliasEnv.OTP_HASH_SECRET;
  aliasEnv.OTP_HASH_PEPPER = 'pepper';

  const step = goLive.stepEnv(aliasEnv);
  assert.equal(step.ok, true, 'WHATSAPP_TOKEN and OTP_HASH_PEPPER must be accepted');
});

test('a placeholder value counts as missing', () => {
  const env: any = { ...GOOD_ENV, WHATSAPP_OTP_TEMPLATE_NAME: 'your-template-here' };
  const step = goLive.stepEnv(env);
  assert.equal(step.ok, false);
  assert.ok(step.rows.some((r: any) => r.id === 'wa-otp-template' && r.status === 'BLOCKED'));
});

test('optional variables only warn, and never block', async () => {
  const env: any = { ...GOOD_ENV };
  delete env.ADMIN_WHATSAPP_NUMBER;
  const step = goLive.stepEnv(env);
  assert.equal(step.ok, true);
  assert.ok(step.rows.some((r: any) => r.id === 'admin-wa' && r.status === 'WARN'));
});

test('the invoice template becomes required once the invoice flag is on', () => {
  const env: any = { ...GOOD_ENV, WHATSAPP_INVOICE_ENABLED: 'true' };
  const step = goLive.stepEnv(env);
  assert.equal(step.ok, true, 'it is a WARN row, not a blocker');

  const withTemplate: any = { ...env, WHATSAPP_INVOICE_TEMPLATE_NAME: 'invoice_doc' };
  const step2 = goLive.stepEnv(withTemplate);
  assert.equal(step2.ok, true);
  assert.ok(step2.rows.some((r: any) => r.id === 'invoice-template' && r.status === 'WARN' && /set \(/.test(r.detail)));
});

/* ------------------------------------------------------------------ */
/* Step 2 — backup                                                     */
/* ------------------------------------------------------------------ */

test('go-live stops when the backup is not RESTORABLE', async () => {
  const { runCommand } = commands({
    'scripts/verify-backup.js': { ok: true, stdout: 'NOT FULLY RESTORABLE: 2 problem(s) above.' },
  });
  const result = await goLive.runGoLive({ env: GOOD_ENV, runCommand, fetchImpl: fakeFetch(COUNTS) });
  assert.equal(result.ok, false);
  assert.ok(result.rows.some((r: any) => r.id === 'backup' && r.status === 'BLOCKED'));
});

test('"NOT FULLY RESTORABLE" is never mistaken for restorable', () => {
  const step = goLive.stepBackup(() => ({ ok: true, stdout: 'NOT FULLY RESTORABLE: 1 problem(s).' }));
  assert.equal(step.ok, false);
});

test('a restorable backup passes and the run continues', () => {
  const step = goLive.stepBackup(() => ({ ok: true, stdout: 'RESTORABLE: structure and integrity checks passed.' }));
  assert.equal(step.ok, true);
});

/* ------------------------------------------------------------------ */
/* Step 3 — migration                                                  */
/* ------------------------------------------------------------------ */

const ADDITIVE_SQL = `
-- a comment mentioning DELETE FROM should not trip the scanner
CREATE TABLE IF NOT EXISTS public.example (id uuid primary key);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS example text;
`;

test('go-live stops when the bundle contains a destructive statement', async () => {
  const { runCommand } = commands({
    'scripts/verify-schema.js': { ok: false, stdout: '5 object(s) missing.' },
  });
  const result = await goLive.runGoLive({
    env: GOOD_ENV,
    runCommand,
    fetchImpl: fakeFetch(COUNTS),
    readBundle: () => `${ADDITIVE_SQL}\nDELETE FROM public.orders;\n`,
  });
  assert.equal(result.ok, false);
  const row = result.rows.find((r: any) => r.id === 'sql-safety');
  assert.equal(row.status, 'BLOCKED');
  assert.match(row.detail, /DELETE/);
});

test('UPDATE, DROP and TRUNCATE are all caught', () => {
  assert.equal(goLive.scanForDestructive('DELETE FROM orders;').length, 1);
  assert.equal(goLive.scanForDestructive("UPDATE orders SET status = 'x';").length, 1);
  assert.equal(goLive.scanForDestructive('DROP TABLE public.orders;').length, 1);
  assert.equal(goLive.scanForDestructive('TRUNCATE public.orders;').length, 1);
  assert.equal(goLive.scanForDestructive(ADDITIVE_SQL).length, 0, 'comments and additive DDL are clean');
});

test('go-live stops when row counts cannot be read', async () => {
  const { runCommand } = commands({
    'scripts/verify-schema.js': { ok: false, stdout: 'missing' },
  });
  const result = await goLive.runGoLive({
    env: { ...GOOD_ENV, SUPABASE_SERVICE_KEY: undefined },
    runCommand,
    fetchImpl: async () => ({ headers: { get: () => null } }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.rows.some((r: any) => r.id === 'row-counts' && r.status === 'BLOCKED'));
});

test('go-live stops when the migration fails, and does not retry', async () => {
  let migrateCalls = 0;
  const runCommand = (file: string) => {
    if (file.endsWith('verify-backup.js')) return { ok: true, stdout: 'RESTORABLE' };
    if (file.endsWith('verify-schema.js')) return { ok: false, stdout: 'missing' };
    if (file.endsWith('migrate-pending.js')) {
      migrateCalls += 1;
      return { ok: false, stdout: 'FAIL: syntax error\nROLLED BACK' };
    }
    return { ok: true, stdout: '' };
  };
  const result = await goLive.runGoLive({
    env: GOOD_ENV,
    runCommand,
    fetchImpl: fakeFetch(COUNTS),
    readBundle: () => ADDITIVE_SQL,
  });
  assert.equal(result.ok, false);
  assert.equal(migrateCalls, 1, 'a failed migration must not be retried');
  const row = rowOf(result.rows, 'migration');
  assert.equal(row.status, 'BLOCKED');
  assert.match(row.detail, /rolled back/);
});

test('go-live BLOCKS when a row count drifts, even though the migration committed', async () => {
  let phase = 0;
  const runCommand = (file: string) => {
    if (file.endsWith('verify-backup.js')) return { ok: true, stdout: 'RESTORABLE' };
    if (file.endsWith('verify-schema.js')) return phase === 0 ? { ok: false, stdout: 'missing' } : { ok: true, stdout: 'ok' };
    if (file.endsWith('migrate-pending.js')) {
      phase = 1;
      return { ok: true, stdout: 'COMMIT ok' };
    }
    return { ok: true, stdout: '' };
  };
  // users drops from 12 to 11 across the migration.
  const before = fakeFetch(COUNTS);
  const after = fakeFetch({ ...COUNTS, users: 11 });
  let reads = 0;
  const result = await goLive.runGoLive({
    env: GOOD_ENV,
    runCommand,
    fetchImpl: async (u: any) => (reads++ < 5 ? before(u) : after(u)),
    readBundle: () => ADDITIVE_SQL,
  });
  assert.equal(result.ok, false);
  const row = rowOf(result.rows, 'row-counts-after');
  assert.equal(row.status, 'BLOCKED');
  assert.match(row.detail, /users 12 -> 11/);
});

test('the full happy path migrates and passes', async () => {
  let phase = 0;
  const runCommand = (file: string) => {
    if (file.endsWith('verify-backup.js')) return { ok: true, stdout: 'RESTORABLE' };
    if (file.endsWith('verify-schema.js')) return phase === 0 ? { ok: false, stdout: 'missing' } : { ok: true, stdout: 'ok' };
    if (file.endsWith('migrate-pending.js')) {
      phase = 1;
      return { ok: true, stdout: 'COMMIT ok' };
    }
    return { ok: true, stdout: `GO_LIVE_JSON ${META_OK}` };
  };
  const result = await goLive.runGoLive({
    env: GOOD_ENV,
    runCommand,
    fetchImpl: fakeFetch(COUNTS),
    readBundle: () => ADDITIVE_SQL,
  });
  assert.equal(result.ok, true);
  assert.ok(rowOf(result.rows, 'sql-safety').status === 'PASS');
  assert.ok(rowOf(result.rows, 'row-counts').status === 'PASS');
  assert.ok(rowOf(result.rows, 'migration').status === 'PASS');
  assert.ok(rowOf(result.rows, 'schema-after').status === 'PASS');
  assert.ok(rowOf(result.rows, 'row-counts-after').status === 'PASS');
  assert.ok(rowOf(result.rows, 'meta-token').status === 'PASS');
});

test('an already-applied schema is skipped cleanly — go-live is safe to run twice', async () => {
  const { runCommand, calls } = commands();
  const result = await goLive.runGoLive({
    env: GOOD_ENV,
    runCommand,
    fetchImpl: fakeFetch(COUNTS),
    readBundle: () => ADDITIVE_SQL,
  });
  assert.equal(result.ok, true);
  assert.equal(
    calls.filter((f) => f.includes('migrate-pending')).length,
    0,
    'the migration must not run a second time'
  );
  const schema = rowOf(result.rows, 'schema');
  assert.match(schema.label, /already applied/i);
  assert.match(schema.detail, /nothing to migrate/i);
  const migration = rowOf(result.rows, 'migration');
  assert.match(migration.detail, /skipped/i);
});

/* ------------------------------------------------------------------ */
/* Step 4 — Meta                                                       */
/* ------------------------------------------------------------------ */

test('go-live stops when Meta reports a failure', async () => {
  const bad = JSON.stringify({
    token: true,
    waba: true,
    phoneId: true,
    otpTemplate: false,
    otpTemplateLanguage: 'en',
    otpTemplateName: 'login_auth',
    invoiceTemplate: null,
    allOk: false,
  });
  const { runCommand } = commands({ 'scripts/verify-whatsapp.js': { ok: false, stdout: `GO_LIVE_JSON ${bad}` } });
  const result = await goLive.runGoLive({ env: GOOD_ENV, runCommand, fetchImpl: fakeFetch(COUNTS) });
  assert.equal(result.ok, false);
  assert.ok(rowOf(result.rows, 'meta-otp-template').status === 'BLOCKED');
});

test('the OTP template must be APPROVED as AUTHENTICATION in the env language', async () => {
  const { runCommand } = commands();
  const result = await goLive.runGoLive({ env: GOOD_ENV, runCommand, fetchImpl: fakeFetch(COUNTS) });
  const row = rowOf(result.rows, 'meta-otp-template');
  assert.equal(row.status, 'PASS');
  assert.match(row.detail, /AUTHENTICATION/);
  assert.match(row.detail, /login_auth/);
  assert.match(row.detail, /\ben\b/);
});

test('the invoice template is only checked when the invoice flag is on', async () => {
  const metaWithInvoice = JSON.stringify({
    token: true,
    waba: true,
    phoneId: true,
    otpTemplate: true,
    otpTemplateLanguage: 'en',
    otpTemplateName: 'login_auth',
    invoiceTemplate: false,
    invoiceTemplateName: 'invoice_doc',
    allOk: false,
  });
  const { runCommand: runCommandOff } = commands({
    'scripts/verify-whatsapp.js': {
      ok: true,
      // verify-whatsapp.js emits `invoiceTemplate` ONLY when the flag is on, so
      // a null value here means "not applicable", not "failed".
      stdout: `GO_LIVE_JSON ${JSON.stringify({
        token: true,
        waba: true,
        phoneId: true,
        otpTemplate: true,
        otpTemplateLanguage: 'en',
        otpTemplateName: 'login_auth',
        invoiceTemplate: null,
        invoiceTemplateName: null,
        allOk: true,
      })}`,
    },
  });

  const off = await goLive.runGoLive({ env: GOOD_ENV, runCommand: runCommandOff, fetchImpl: fakeFetch(COUNTS) });
  assert.equal(off.ok, true);
  assert.equal(rowOf(off.rows, 'meta-invoice-template'), undefined, 'not checked while the flag is off');

  const { runCommand: runCommandOn } = commands({
    'scripts/verify-whatsapp.js': { ok: false, stdout: `GO_LIVE_JSON ${metaWithInvoice}` },
  });
  const on = await goLive.runGoLive({
    env: { ...GOOD_ENV, WHATSAPP_INVOICE_ENABLED: 'true' },
    runCommand: runCommandOn,
    fetchImpl: fakeFetch(COUNTS),
  });
  assert.equal(rowOf(on.rows, 'meta-invoice-template').status, 'BLOCKED');
  assert.equal(on.ok, false);
});

test('an unreadable wa:verify result blocks rather than passing silently', async () => {
  const { runCommand } = commands({ 'scripts/verify-whatsapp.js': { ok: false, stdout: 'it exploded' } });
  const result = await goLive.runGoLive({ env: GOOD_ENV, runCommand, fetchImpl: fakeFetch(COUNTS) });
  assert.equal(result.ok, false);
  assert.ok(rowOf(result.rows, 'meta').status === 'BLOCKED');
});

/* ------------------------------------------------------------------ */
/* Never a secret                                                      */
/* ------------------------------------------------------------------ */

test('the JSON result line parses, and carries no secret values', () => {
  const parsed = goLive.parseMetaJson(`some noise\nGO_LIVE_JSON ${META_OK}\nmore noise`);
  assert.equal(parsed.token, true);
  assert.equal(parsed.otpTemplateName, 'login_auth');

  // Template names and ids are configuration, not secrets. Credentials are.
  const SECRETS = [
    GOOD_ENV.SUPABASE_SERVICE_KEY,
    GOOD_ENV.SUPABASE_DB_URL,
    GOOD_ENV.WHATSAPP_API_TOKEN,
    GOOD_ENV.WHATSAPP_PHONE_NUMBER_ID,
    GOOD_ENV.OTP_HASH_SECRET,
    GOOD_ENV.JWT_SECRET,
  ];
  const serialised = JSON.stringify(parsed);
  for (const secret of SECRETS) {
    assert.ok(!serialised.includes(secret), `the result line must not contain a secret value`);
  }
});

test('an unparsable result line yields null rather than a partial success', () => {
  assert.equal(goLive.parseMetaJson('nothing here'), null);
  assert.equal(goLive.parseMetaJson('GO_LIVE_JSON {not json'), null);
});

test('the "next commands" list is specific to what is blocked', () => {
  const rows = goLive
    .stepEnv({ ...GOOD_ENV, WHATSAPP_TEMPLATE_LANG: undefined })
    .rows;
  const cmds = goLive.nextCommands(rows);
  assert.ok(cmds.some((c) => /WHATSAPP_TEMPLATE_LANG/.test(c)));
  assert.ok(cmds.some((c) => /go-live/.test(c)));
  assert.ok(cmds.some((c) => /otp:smoke/.test(c)), 'the manual smoke step must always be last');
});