/**
 * COD detection against the value the storefront actually stores.
 *
 * The bug: `isCodOrder` matched only the literal 'cod', but the storefront
 * writes 'Cash On Delivery'. In production that made COD detection false for
 * every real COD order, which meant:
 *
 *   - the invoice's stored payment record said "Payment: Online (via PayU)"
 *     for a cash order, and
 *   - the COD order-confirmation WhatsApp text was never sent
 *     (ordersController.createOrder gates it on isCodOrder).
 *
 * PayU must be entirely unaffected: its stored value is
 * 'PayOnline (via PayU)' and must stay non-COD, paid or not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isCodOrder as invoiceIsCodOrder, paymentWordingFor, payuReferenceFor } from './invoiceService';
import { isCodOrder as postOrderIsCodOrder } from './postOrderConfirmed';

/** Every COD spelling the two helpers must agree on. */
const COD_SPELLINGS = ['cod', 'COD', ' COD ', 'Cash On Delivery', 'cash on delivery', '  Cash On Delivery  ', 'cash_on_delivery', 'CASH_ON_DELIVERY'];

/** Values that must never be COD. */
const NOT_COD = [
  'PayOnline (via PayU)',
  'PayU',
  'payu',
  'Prepaid',
  'online',
  'upi',
  'cashfree',
  'Cashfree',
  'codonline',
  '',
  null,
  undefined,
];

/* ------------------------------------------------------------------ */
/* One test per COD spelling                                           */
/* ------------------------------------------------------------------ */

for (const spelling of COD_SPELLINGS) {
  test(`'${spelling}' is COD`, () => {
    assert.equal(invoiceIsCodOrder({ payment_method: spelling }), true);
    assert.equal(postOrderIsCodOrder({ payment_method: spelling }), true);
  });
}

for (const value of NOT_COD) {
  test(`${JSON.stringify(value)} is not COD`, () => {
    assert.equal(invoiceIsCodOrder({ payment_method: value as any }), false);
    assert.equal(postOrderIsCodOrder({ payment_method: value as any }), false);
  });
}

test('the two helpers agree on every spelling — they are used interchangeably', () => {
  for (const value of [...COD_SPELLINGS, ...NOT_COD]) {
    assert.equal(
      invoiceIsCodOrder({ payment_method: value as any }),
      postOrderIsCodOrder({ payment_method: value as any }),
      `helpers disagree on ${JSON.stringify(value)}`
    );
  }
});

/* ------------------------------------------------------------------ */
/* The wording a COD invoice now records                               */
/* ------------------------------------------------------------------ */

test('a real COD order now records cash-on-delivery wording, not prepaid', () => {
  const w = paymentWordingFor({ payment_method: 'Cash On Delivery', payment_status: 'pending' });
  assert.equal(w.mode, 'cod');
  assert.equal(w.wording, 'Amount due on delivery');
  assert.equal(w.paid, false, 'a COD order is never stamped paid');
  assert.equal(w.reference, null, 'a COD order has no gateway reference');
});

test('every COD spelling produces that same wording', () => {
  for (const spelling of COD_SPELLINGS) {
    const w = paymentWordingFor({ payment_method: spelling, payment_status: 'pending' });
    assert.equal(w.mode, 'cod', `wrong mode for ${JSON.stringify(spelling)}`);
    assert.equal(w.wording, 'Amount due on delivery');
  }
});

test('a COD order later marked paid is still worded as due on delivery, never PAID', () => {
  // The tax invoice may only state a payment fact that was true when issued.
  const w = paymentWordingFor({ payment_method: 'Cash On Delivery', payment_status: 'paid' });
  assert.equal(w.mode, 'cod');
  assert.equal(w.wording, 'Amount due on delivery');
  assert.equal(w.paid, false);
});

/* ------------------------------------------------------------------ */
/* PayU is unaffected                                                  */
/* ------------------------------------------------------------------ */

test('the exact PayU value the callback writes is still not COD', () => {
  // payuController forces this literal onto the order row.
  assert.equal(invoiceIsCodOrder({ payment_method: 'PayOnline (via PayU)' }), false);
  assert.equal(postOrderIsCodOrder({ payment_method: 'PayOnline (via PayU)' }), false);
});

test('a paid PayU order is still stamped PAID with its reference', () => {
  const w = paymentWordingFor({
    payment_method: 'PayOnline (via PayU)',
    payment_status: 'paid',
    notes: 'Leave at reception [PayU mihpayid: 29972971247]',
  });
  assert.equal(w.mode, 'prepaid');
  assert.equal(w.wording, 'PAID');
  assert.equal(w.paid, true);
  assert.equal(w.reference, '29972971247');
  assert.equal(payuReferenceFor({ notes: 'Leave at reception [PayU mihpayid: 29972971247]' }), '29972971247');
});

test('an unpaid PayU order is still worded neutrally', () => {
  const w = paymentWordingFor({
    payment_method: 'PayOnline (via PayU)',
    payment_status: 'pending',
    notes: 'Leave at reception [PayU mihpayid: 29972971247]',
  });
  assert.equal(w.mode, 'prepaid');
  assert.equal(w.wording, 'Payment: Online (via PayU)');
  assert.equal(w.paid, false);
  assert.equal(w.reference, null);
});

/* ------------------------------------------------------------------ */
/* The confirmation text trigger                                       */
/* ------------------------------------------------------------------ */

/**
 * ordersController.createOrder sends the COD confirmation text when
 * isCodOrder(order) is true. Re-read the controller source so this test fails
 * if that gate is ever changed.
 */
test('the COD confirmation text gate in ordersController now fires for real COD orders', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(
    path.resolve(__dirname, '../controllers/ordersController.ts'),
    'utf8'
  );
  assert.ok(
    /if\s*\(isCodOrder\(data\)\)/.test(source),
    'the COD confirmation text must still be gated on isCodOrder(data)'
  );
  // It must use the postOrderConfirmed helper (the fixed one), not a local
  // copy of the old exact match.
  assert.ok(
    /import\s*\{[^}]*isCodOrder[^}]*\}\s*from\s*'\.\.\/services\/postOrderConfirmed'/.test(source),
    'ordersController must import isCodOrder from postOrderConfirmed'
  );

  // And the imported helper must say yes to the value the storefront writes.
  assert.equal(postOrderIsCodOrder({ payment_method: 'Cash On Delivery' }), true);
});