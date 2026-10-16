/* eslint-disable */
// Which schema objects the invoice code needs, and do they exist?
//   node --require ts-node/register/transpile-only --require ./src/testEnvSetup.ts src/scripts/auditSchema.ts
import { supabase } from '../database/supabase';

const COLUMNS = [
  'invoice_url', 'invoice_number', 'invoice_sent_at', 'invoice_error',
  'invoice_allocated_at', 'payu_mihpayid',
  'shiprocket_push_status', 'shiprocket_push_error', 'shiprocket_pushed_at',
];
const TABLES = ['invoice_sequences', 'whatsapp_message_log', 'analytics_events'];
const RPCS = ['claim_invoice', 'release_invoice_claim', 'set_invoice_url', 'assign_invoice_number'];

async function main() {
  console.log('=== orders columns ===');
  for (const c of COLUMNS) {
    const { error } = await supabase.from('orders').select(c).limit(1);
    console.log(`  orders.${c.padEnd(26)} ${error ? `MISSING (${error.code})` : 'ok'}`);
  }

  console.log('\n=== tables ===');
  for (const t of TABLES) {
    const { error } = await supabase.from(t).select('*').limit(1);
    console.log(`  ${t.padEnd(26)} ${error ? `MISSING (${error.code})` : 'ok'}`);
  }

  console.log('\n=== rpc functions ===');
  for (const f of RPCS) {
    const { error } = await supabase.rpc(f as any, f === 'claim_invoice' ? { p_order_id: '00000000-0000-0000-0000-000000000000' } : {});
    console.log(`  ${f.padEnd(26)} ${error ? `MISSING (${error.code}: ${String(error.message).slice(0, 60)})` : 'ok'}`);
  }

  console.log('\n=== recent orders: any invoice number ever assigned? ===');
  const { data } = await supabase
    .from('orders')
    .select('order_number, status, payment_method, payment_status, invoice_url, created_at')
    .order('created_at', { ascending: false })
    .limit(8);
  for (const o of data || []) {
    console.log(`  ${o.order_number} ${String(o.created_at).slice(0, 16)} ${o.payment_method} / ${o.payment_status} status=${o.status} invoice_url=${JSON.stringify(o.invoice_url)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });