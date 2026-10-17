import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOrderQualifying, orderRevenue } from './analyticsController';

/**
 * Revenue eligibility.
 *
 * The regression these lock down is concrete: `orders.status` stores 'delivered'
 * (lower-case) in Postgres, and the qualifier used to compare against
 * 'Delivered', so no COD order could ever be counted and the admin revenue
 * total silently omitted every cash sale.
 *
 * The values used here are copied verbatim from the live `orders` table, not
 * invented: payment_method is 'Cash On Delivery' or 'PayOnline (via PayU)',
 * payment_status is 'paid' or 'pending', status is 'delivered' or 'pending'.
 */

// Exactly as stored in Supabase.
const COD = 'Cash On Delivery';
const PREPAID = 'PayOnline (via PayU)';

const order = (over: Record<string, any> = {}) => ({
  payment_method: COD,
  payment_status: 'pending',
  status: 'pending',
  subtotal: 1000,
  discount: 0,
  tax: 180,
  ...over,
});

// --- COD ------------------------------------------------------------------

test('COD is excluded until it is delivered', () => {
  assert.equal(isOrderQualifying(order()), false);
});

test('COD counts once delivered — the case that was silently dropped', () => {
  assert.equal(isOrderQualifying(order({ status: 'delivered' })), true);
});

test('COD also matches if the casing ever changes upstream', () => {
  for (const s of ['Delivered', 'DELIVERED', 'delivered']) {
    assert.equal(isOrderQualifying(order({ status: s })), true, `status "${s}" should qualify`);
  }
});

test('COD in other states never counts', () => {
  for (const s of ['pending', 'processing', 'cancelled', 'payment_failed', 'shipped', '']) {
    assert.equal(isOrderQualifying(order({ status: s })), false, `status "${s}" must not qualify`);
  }
});

test('COD is not gated on payment_status — cash has none until delivery', () => {
  // A COD order that somehow shows payment_status=paid is still only counted
  // when delivered, so a premature flag cannot inflate revenue.
  assert.equal(isOrderQualifying(order({ status: 'pending', payment_status: 'paid' })), false);
  assert.equal(isOrderQualifying(order({ status: 'delivered', payment_status: 'pending' })), true);
});

test('COD detected by the COD shorthand as well as the full label', () => {
  assert.equal(isOrderQualifying(order({ payment_method: 'COD', status: 'delivered' })), true);
  assert.equal(isOrderQualifying(order({ payment_method: 'cod', status: 'delivered' })), true);
});

// --- prepaid --------------------------------------------------------------

test('prepaid counts as soon as it is paid, whatever the delivery state', () => {
  for (const s of ['pending', 'processing', 'delivered', 'shipped', 'cancelled']) {
    assert.equal(
      isOrderQualifying(order({ payment_method: PREPAID, payment_status: 'paid', status: s })),
      true,
      `paid prepaid should count even when status is "${s}"`
    );
  }
});

test('unpaid prepaid never counts', () => {
  for (const ps of ['pending', 'failed', '', null, undefined]) {
    assert.equal(
      isOrderQualifying(order({ payment_method: PREPAID, payment_status: ps, status: 'delivered' })),
      false,
      `payment_status "${ps}" must not qualify`
    );
  }
});

test('the prepaid rule is unchanged: payment_status drives it, not status', () => {
  assert.equal(isOrderQualifying(order({ payment_method: PREPAID, payment_status: 'paid', status: 'pending' })), true);
  assert.equal(isOrderQualifying(order({ payment_method: PREPAID, payment_status: 'pending', status: 'delivered' })), false);
});

test('payment_status comparison tolerates casing without changing the rule', () => {
  assert.equal(isOrderQualifying(order({ payment_method: PREPAID, payment_status: 'PAID' })), true);
  assert.equal(isOrderQualifying(order({ payment_method: PREPAID, payment_status: 'paid' })), true);
});

// --- no double counting, no null crashes ---------------------------------

test('an order is counted at most once', () => {
  const list = [order({ status: 'delivered' }), order({ payment_method: PREPAID, payment_status: 'paid' })];
  const qualifying = list.filter(isOrderQualifying);
  assert.equal(qualifying.length, 2);
  assert.equal(new Set(qualifying).size, 2, 'no order appears twice');
});

test('cancelled and failed orders are excluded regardless of method', () => {
  assert.equal(isOrderQualifying(order({ status: 'cancelled', payment_status: 'paid' })), false);
  assert.equal(isOrderQualifying(order({ payment_method: PREPAID, payment_status: 'failed' })), false);
});

test('missing fields do not throw', () => {
  assert.equal(isOrderQualifying({}), false);
  assert.equal(isOrderQualifying({ status: null, payment_status: null, payment_method: null }), false);
});

// --- revenue arithmetic ---------------------------------------------------

test('revenue is subtotal - discount - tax, excluding shipping', () => {
  assert.equal(orderRevenue({ subtotal: 1000, discount: 100, tax: 180 }), 720);
  assert.equal(orderRevenue({ subtotal: 500, discount: 0, tax: 90 }), 410);
  assert.equal(orderRevenue({ subtotal: 500, discount: 0, tax: 0, shipping_fee: 99 }), 500);
});

test('missing numeric fields are treated as zero', () => {
  assert.equal(orderRevenue({}), 0);
  assert.equal(orderRevenue({ subtotal: 475.24 }), 475.24);
  assert.equal(orderRevenue({ subtotal: '475.24', discount: null, tax: undefined }), 475.24);
});

// --- combined totals ------------------------------------------------------

test('COD and prepaid are summed together without double counting', () => {
  const orders = [
    order({ status: 'delivered', subtotal: 400, tax: 0 }),                                  // COD  -> 400
    order({ status: 'pending', subtotal: 500, tax: 0 }),                                    // COD, undelivered -> out
    order({ payment_method: PREPAID, payment_status: 'paid', status: 'pending', subtotal: 300, tax: 0 }), // -> 300
    order({ payment_method: PREPAID, payment_status: 'pending', status: 'delivered', subtotal: 900, tax: 0 }), // unpaid -> out
  ];
  const total = orders.filter(isOrderQualifying).reduce((s, o) => s + orderRevenue(o), 0);
  assert.equal(total, 700);
});

test('date filtering operates on the already-qualified set, so COD is included', () => {
  const orders = [
    order({ status: 'delivered', subtotal: 400, tax: 0, created_at: new Date().toISOString() }),
    order({ status: 'delivered', subtotal: 999, tax: 0, created_at: '2000-01-01T00:00:00.000Z' }),
  ];
  const today = new Date();
  const todayRevenue = orders
    .filter(isOrderQualifying)
    .filter((o) => new Date(o.created_at).toDateString() === today.toDateString())
    .reduce((s, o) => s + orderRevenue(o), 0);
  assert.equal(todayRevenue, 400, "today's COD order is inside the date-filtered total");
});