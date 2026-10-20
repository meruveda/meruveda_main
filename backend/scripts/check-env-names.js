/**
 * The pre-deploy environment gate.
 *
 * Two questions, answered before anything is deployed:
 *   1. Is every variable the app needs DOCUMENTED in backend/.env.example?
 *      A variable that exists in the code but not in the template is one
 *      nobody will ever fill in.
 *   2. Is any variable that no longer exists STILL there? A leftover secret
 *      in the template is a secret waiting to be copied somewhere it does
 *      not belong.
 *
 * Usage: node scripts/check-env-names.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXAMPLE = path.join(ROOT, '.env.example');

/** The variables the app cannot run without. */
const REQUIRED = [
  'DATABASE_URL',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_PUBLIC_BASE_URL',
  'R2_BUCKET_MEDIA',
  'R2_BUCKET_INVOICES',
  'JWT_SECRET',
  'OTP_HASH_PEPPER',
  'CRON_SECRET',
  'WHATSAPP_API_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_OTP_TEMPLATE_NAME',
  'WHATSAPP_TEMPLATE_LANG',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'PAYU_MERCHANT_KEY',
  'PAYU_SALT',
];

/** Variables that must not exist any more. */
const FORBIDDEN = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_DB_URL',
];

function main() {
  if (!fs.existsSync(EXAMPLE)) {
    console.error(`MISSING: ${path.relative(process.cwd(), EXAMPLE)} does not exist.`);
    process.exit(1);
  }
  const text = fs.readFileSync(EXAMPLE, 'utf8');
  const documented = new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split('=')[0].trim())
      .filter(Boolean),
  );

  const missing = REQUIRED.filter((name) => !documented.has(name));
  const leftover = FORBIDDEN.filter((name) => documented.has(name));

  let ok = true;
  if (missing.length) {
    console.error('MISSING from backend/.env.example:');
    for (const name of missing) console.error(`  - ${name}`);
    ok = false;
  }
  if (leftover.length) {
    console.error('STILL in backend/.env.example but no longer used:');
    for (const name of leftover) console.error(`  - ${name}`);
    ok = false;
  }

  // A blank value in the template is CORRECT - that is what a template is
  // for. What matters is that the variable is named at all, so an operator
  // knows it has to be filled in.

  if (!ok) {
    console.error('\nThe environment template is not deployable as it stands.');
    process.exit(1);
  }
  console.log(
    `env names OK: ${REQUIRED.length} required variable(s) documented, ${FORBIDDEN.length} retired variable(s) absent.`,
  );
}

main();
