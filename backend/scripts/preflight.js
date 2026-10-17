/**
 * One table, every gate, in the order they must pass.
 *
 * Runs the checks that do not need a human and reports each as PASS / FAIL /
 * BLOCKED with exactly what is missing. Nothing here writes to the database, so
 * it is safe to run repeatedly, and safe on production.
 *
 * Usage: npm run preflight
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rows = [];
const add = (item, status, detail) => rows.push([item, status, detail]);
const V = (name) => {
  const v = process.env[name];
  if (v === undefined) return { state: 'BLOCKED', why: `not set` };
  if (v.trim() === '') return { state: 'BLOCKED', why: 'set but empty' };
  if (/^(your-|<|placeholder)/i.test(v.trim())) return { state: 'BLOCKED', why: 'still a placeholder' };
  return { state: 'PASS', why: `set (${v.trim().length} chars)` };
};

function runScript(file, args = []) {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, file), ...args], { encoding: 'utf8' });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

// --- 1. env ---------------------------------------------------------------
const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  'DB_URL',
  'PGPASSWORD',
  'PGHOST',
  'DB_PASSWORD',
  'JWT_SECRET',
  'OTP_HASH_SECRET',
  'OTP_HASH_PEPPER',
  'WHATSAPP_TOKEN',
  'WHATSAPP_API_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_OTP_TEMPLATE_NAME',
  'WHATSAPP_TEMPLATE_LANG',
];
for (const n of required) {
  const r = V(n);
  add(`env ${n}`, r.state, r.why);
}

// --- 2. bundle ------------------------------------------------------------
const bundle = path.join(__dirname, '..', 'database', 'pending-migration.sql');
if (!fs.existsSync(bundle)) add('migration bundle', 'FAIL', 'missing — run npm run db:bundle');
else {
  const sql = fs.readFileSync(bundle, 'utf8');
  const body = sql.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
  const bad = body.match(/\b(DROP\s+(TABLE|SCHEMA|DATABASE|COLUMN|TYPE|POLICY)|TRUNCATE|DELETE\s+FROM)\b/i);
  add('migration bundle', bad ? 'FAIL' : 'PASS', bad ? `contains ${bad[0].trim()}` : 'present and additive-only');
}

// --- 3. backup ------------------------------------------------------------
const bk = runScript('verify-backup.js', ['--latest']);
add('backup', bk.ok && /RESTORABLE/.test(bk.out) ? 'PASS' : 'FAIL',
  bk.ok && /RESTORABLE/.test(bk.out) ? 'restorable' : 'not restorable — run npm run db:backup');

// --- 4. schema ------------------------------------------------------------
const sc = runScript('verify-schema.js', ['--all']);
const missingCount = (sc.out.match(/MISSING/g) || []).length;
add('schema', missingCount === 0 ? 'PASS' : 'BLOCKED',
  missingCount === 0 ? 'all objects present' : `${missingCount} object(s) missing — run npm run db:migrate:pending`);

// --- 5. Meta --------------------------------------------------------------
const wa = runScript('verify-whatsapp.js');
const phoneOk = /Phone number ID resolves\s+display=/.test(wa.out);
// The verifier prints the label `Template "x" is APPROVED` whether it passed or
// not, so match the OK marker on the SAME line rather than the words alone.
const templateOk = /OK\s+Template\s+"[^"]+"\s+is APPROVED/.test(wa.out);
const waOk = /Token accepted/.test(wa.out) && phoneOk;
add('meta token', /Token accepted/.test(wa.out) ? 'PASS' : 'FAIL',
  /Token accepted/.test(wa.out) ? 'valid' : 'rejected or missing');
add('meta phone id', phoneOk ? 'PASS' : 'BLOCKED',
  phoneOk ? 'resolves to a real number' : 'does not resolve for this token');
add('meta template', templateOk ? 'PASS' : 'BLOCKED',
  templateOk ? 'approved' : 'not confirmed approved — check WHATSAPP_OTP_TEMPLATE_NAME and WHATSAPP_BUSINESS_ACCOUNT_ID');

// --- 6. review fixtures ---------------------------------------------------
const reviews = path.join(__dirname, '..', '..', 'frontend', 'src', 'data', 'reviews.json');
if (!fs.existsSync(reviews)) add('static reviews', 'BLOCKED', 'frontend/src/data/reviews.json missing');
else {
  const f = JSON.parse(fs.readFileSync(reviews, 'utf8'));
  const ph = (f.reviews || []).filter((r) => r.placeholder).length;
  add('static reviews', ph ? 'BLOCKED' : 'PASS',
    ph ? `${ph} placeholder(s) — a PRODUCTION BUILD WILL FAIL until removed` : `${(f.reviews || []).length} real entr(y|ies)`);
}

// --- output ---------------------------------------------------------------
const w = Math.max(...rows.map((r) => r[0].length));
console.log('\nMERUVEDA PREFLIGHT');
console.log('='.repeat(w + 52));
console.log(`  ${'CHECK'.padEnd(w)}  ${'STATUS'.padEnd(8)}  DETAIL`);
console.log('-'.repeat(w + 52));
for (const [i, s, d] of rows) console.log(`  ${i.padEnd(w)}  ${s.padEnd(8)}  ${d}`);

const failed = rows.filter((r) => r[1] === 'FAIL');
const blocked = rows.filter((r) => r[1] === 'BLOCKED');
console.log('='.repeat(w + 52));
console.log(`\n${failed.length} FAILED, ${blocked.length} BLOCKED, ${rows.length - failed.length - blocked.length} passed.`);
if (blocked.length) {
  console.log('\nOrder to fix these in:');
  console.log('  1. npm run db:migrate:pending   (needs SUPABASE_DB_PASSWORD or SUPABASE_DB_URL)');
  console.log('  2. npm run wa:verify            (needs a valid token + correct phone id)');
  console.log('  3. npm run otp:smoke -- <number>');
}
process.exit(failed.length ? 1 : 0);
