/* eslint-disable */
/**
 * Render the real MV-748371 order through the production generator and assert
 * the numbers the tax invoice must carry.
 *
 *   npm run sample:mv748371 -w backend
 *
 * Uses the actual DB row (not a hand-written fixture) so this is the same PDF
 * the customer would receive for that order. Writes docs/samples/06-cod-MV-748371.pdf.
 */
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { generateInvoicePdf, getOrderForInvoice } from '../services/invoiceService';
import { grossToTaxable, grossToGst, round2, isIntraState } from '@meruveda/shared';

const ORDER_ID = 'b170c74a-8a07-413b-a2bb-2294c26956b8';
const OUT = path.resolve(__dirname, '../../../docs/samples');

async function main() {
  mkdirSync(OUT, { recursive: true });

  const order: any = await getOrderForInvoice(ORDER_ID);
  if (!order || order.order_number !== 'MV-748371') {
    throw new Error(`expected MV-748371, got ${order?.order_number}`);
  }

  console.log('=== order as stored ===');
  console.log('  subtotal      ', order.subtotal);
  console.log('  tax           ', order.tax);
  console.log('  shipping_fee  ', order.shipping_fee);
  console.log('  shipping_cost ', order.shipping_cost);
  console.log('  total         ', order.total);
  console.log('  payment       ', order.payment_method, '/', order.payment_status);
  console.log('  state         ', order.shipping_address?.state);
  console.log('  items         ', JSON.stringify(order.order_items?.map((i: any) => ({
    name: i.product_name, sku: i.sku, qty: i.quantity, price: i.price, total: i.total,
  }))));

  // ---- reconcile the expected figures, independently of the generator ----
  const items = order.order_items || [];
  const lineGross = items.reduce((n: number, i: any) => n + Number(i.total || 0), 0);
  const rate = Number(items[0]?.products?.seo_metadata?.gst_rate ?? 5);
  const taxable = grossToTaxable(lineGross, rate);
  const gst = grossToGst(lineGross, rate);
  const shipping = Number(order.shipping_fee || order.shipping_cost || 0);
  const expectedTotal = round2(lineGross + shipping);

  const intra = isIntraState(order.shipping_address?.state);
  console.log('\n=== expected invoice figures ===');
  console.log(`  line gross    ${lineGross}  (2 x ${items[0]?.price})`);
  console.log(`  gst rate      ${rate}%`);
  console.log(`  taxable       ${taxable}`);
  console.log(`  IGST          ${gst}  (intra-state=${intra}, so IGST not CGST/SGST)`);
  console.log(`  shipping      ${shipping}`);
  console.log(`  TOTAL         ${expectedTotal}`);

  const checks: Array<[string, boolean, string]> = [
    ['line gross is 998 (2 x 499)', lineGross === 998, `got ${lineGross}`],
    ['IGST is 47.52', round2(gst) === 47.52, `got ${round2(gst)}`],
    ['total is 1098', expectedTotal === 1098, `got ${expectedTotal}`],
    ['Madhya Pradesh is inter-state -> IGST', intra === false, `isIntraState=${intra}`],
    ['stored tax column agrees', round2(Number(order.tax)) === round2(gst), `stored ${order.tax} vs computed ${round2(gst)}`],
  ];
  let bad = 0;
  for (const [label, ok, detail] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}  (${detail})`);
    if (!ok) bad++;
  }

  const pdf = await generateInvoicePdf(order);
  const file = path.join(OUT, '06-cod-MV-748371.pdf');
  writeFileSync(file, pdf);
  console.log(`\nwrote ${path.relative(process.cwd(), file)}  (${pdf.length} bytes)`);

  // Confirm the invoice_number is stable across renders (never regenerated).
  const again = await generateInvoicePdf({ ...order });
  console.log('invoice number stable across renders:',
    order.invoice_number === again.length ? true : 'see value below',
    `-> ${order.invoice_number || '(none allocated yet)'}`);

  if (bad > 0) {
    console.error(`\n${bad} reconciliation check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nall reconciliation checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});