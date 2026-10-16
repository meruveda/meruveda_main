/* eslint-disable */
// Ad-hoc read-only trace of one order.  node --require ts-node/register/transpile-only --require ./src/testEnvSetup.ts src/scripts/traceOrder.ts <order-id>
import { supabase } from '../database/supabase';

const ORDER_ID = process.argv[2];

async function main() {
  console.log('=== order row ===');
  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', ORDER_ID)
    .maybeSingle();
  if (error) {
    console.log('select error:', error.message);
    return;
  }
  if (!order) {
    console.log('NO ROW for', ORDER_ID);
    return;
  }
  for (const k of [
    'id', 'order_number', 'user_id', 'status', 'payment_method', 'payment_status',
    'total', 'invoice_number', 'invoice_url', 'invoice_sent_at', 'invoice_error',
    'invoice_allocated_at', 'payu_mihpayid', 'created_at', 'shiprocket_push_status',
    'shiprocket_push_error',
  ]) {
    console.log(`  ${k.padEnd(24)} ${JSON.stringify((order as any)[k])}`);
  }
  console.log('  shipping_address.state    ', JSON.stringify((order as any).shipping_address?.state));
  console.log('  columns present:', Object.keys(order).sort().join(', '));

  console.log('\n=== lookups by ORDER NUMBER ===');
  const byNumber = await supabase.from('orders').select('id').eq('order_number', order.order_number).maybeSingle();
  console.log('  by order_number:', byNumber.error ? byNumber.error.message : JSON.stringify(byNumber.data));

  console.log('\n=== related tables ===');
  for (const t of ['whatsapp_message_log', 'transactions', 'order_items', 'invoice_sequences']) {
    const { data, error: e } = await supabase.from(t).select('*').limit(5);
    if (e) {
      console.log(`  ${t}: ERROR ${e.message}`);
      continue;
    }
    console.log(`  ${t}: ${Array.isArray(data) ? data.length : '?'} row(s) (first 5 of table)`);
    if (Array.isArray(data)) {
      for (const r of data) console.log('    ', JSON.stringify(r).slice(0, 300));
    }
  }

  console.log('\n=== invoice_sequences rows ===');
  const seq = await supabase.from('invoice_sequences').select('*').limit(10);
  console.log(seq.error ? seq.error.message : JSON.stringify(seq.data, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });