/**
 * Schema verification over PostgREST.
 *
 * Unlike scripts/migrate.js this needs no database password: it probes each
 * object through the REST client, using the same technique as
 * src/services/schemaGuard.ts (a select against the object succeeds only when
 * it exists). That makes it safe to run from anywhere, including CI.
 *
 * Usage:
 *   node scripts/verify-schema.js            verify the delta 005 objects
 *   node scripts/verify-schema.js --all      verify every delta object
 *
 * Exit code 0 when everything verified, 1 when anything is missing.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const checkAll = process.argv.includes('--all');

/** Objects introduced by database/deltas/005_otp_whatsapp_review_requests.sql */
const DELTA_005 = [
  { kind: 'table', name: 'otps' },
  { kind: 'table', name: 'whatsapp_message_log' },
  { kind: 'table', name: 'review_requests' },
  { kind: 'column', name: 'users.address' },
  { kind: 'column', name: 'users.last_login_at' },
];

const DELTA_010 = [
  { kind: 'column', name: 'orders.invoice_sent_at' },
  { kind: 'column', name: 'orders.invoice_error' },
  { kind: 'column', name: 'orders.shiprocket_push_status' },
  { kind: 'column', name: 'orders.shiprocket_push_error' },
  { kind: 'column', name: 'orders.shiprocket_pushed_at' },
  { kind: 'column', name: 'orders.shiprocket_push_started_at' },
];

async function probe(supabase, target) {
  const dot = target.name.indexOf('.');
  const table = dot === -1 ? target.name : target.name.slice(0, dot);
  const column = dot === -1 ? undefined : target.name.slice(dot + 1);
  const { error } = column
    ? await supabase.from(table).select(column).limit(1)
    : await supabase.from(table).select('*').limit(1);
  return !error;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY.');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const groups = checkAll
    ? [['delta 005', DELTA_005], ['delta 010', DELTA_010]]
    : [['delta 005', DELTA_005]];

  let missing = 0;
  for (const [label, targets] of groups) {
    console.log(`\n${label}`);
    for (const t of targets) {
      const ok = await probe(supabase, t);
      if (!ok) missing += 1;
      console.log(`  ${ok ? 'PRESENT' : 'MISSING'}  ${t.kind.padEnd(6)} ${t.name}`);
    }
  }

  console.log(`\n${missing === 0 ? 'All verified objects are present.' : `${missing} object(s) missing.`}`);
  if (missing > 0) {
    console.log('Apply the pending delta with: node scripts/migrate.js');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});