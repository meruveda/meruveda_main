import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOrderQualifying,
  orderRevenue,
  buildRevenueSeries,
  buildSalesSeries,
  buildOrdersSeries,
  istDayKey,
} from './analyticsController';

/**
 * Revenue eligibility and the dashboard series.
 *
 * THE BUG THIS LOCKS DOWN: the qualifier used to require a COD order to be
 * `delivered` (and a prepaid order to be `paid`). Every recent order in the
 * live table is a COD order that is still `pending`, so the Revenue Performance
 * chart was 0 for every single day even though the orders were right there -
 * `ordersGraph`, which counts all orders, was correct the whole time.
 *
 * THE RULE NOW: an order counts unless it was CANCELLED or FAILED. The
 * revenue is the order total, the days are grouped in Asia/Kolkata, and the
 * empty days are present with 0.
 *
 * The values used here are copied verbatim from the live `orders` table:
 * payment_method is 'Cash On Delivery' or 'PayOnline (via PayU)',
 * payment_status is 'paid' or 'pending', status is 'pending' or 'delivered'.
 */

// Exactly as stored in the database.
const COD = 'Cash On Delivery';
const PREPAID = 'PayOnline (via PayU)';

const order = (over: Record<string, any> = {}) => ({
  payment_method: COD,
  payment_status: 'pending',
  status: 'pending',
  subtotal: 1000,
  discount: 0,
  tax: 180,
  total: 1180,
  ...over,
});

// --- the rule --------------------------------------------------------------

test('a COD order counts as soon as it is placed', () => {
  assert.equal(isOrderQualifying(order()), true);
});

test('a COD order counts whatever state it is in', () => {
  for (const s of ['pending', 'processing', 'shipped', 'delivered', 'confirmed', '']) {
    assert.equal(isOrderQualifying(order({ status: s })), true, `status "${s}" should count`);
  }
});

test('the status comparison tolerates any casing', () => {
  for (const s of ['Cancelled', 'CANCELLED', 'cancelled']) {
    assert.equal(isOrderQualifying(order({ status: s })), false, `status "${s}" must not count`);
  }
});

test('a cancelled order never counts', () => {
  for (const s of ['cancelled', 'canceled', 'failed']) {
    assert.equal(isOrderQualifying(order({ status: s })), false, `status "${s}" must not count`);
  }
});

test('a failed payment never counts, whatever the status says', () => {
  for (const ps of ['failed', 'FAILED', 'cancelled']) {
    assert.equal(
      isOrderQualifying(order({ payment_method: PREPAID, payment_status: ps, status: 'delivered' })),
      false,
      `payment_status "${ps}" must not count`
    );
  }
});

test('a prepaid order counts whether it is paid or not', () => {
  for (const ps of ['paid', 'pending']) {
    assert.equal(
      isOrderQualifying(order({ payment_method: PREPAID, payment_status: ps, status: 'pending' })),
      true,
      `prepaid with payment_status "${ps}" is a real order and counts`
    );
  }
});

test('missing fields do not throw', () => {
  assert.equal(isOrderQualifying({}), true);
  assert.equal(isOrderQualifying({ status: null, payment_status: null, payment_method: null }), true);
});

// --- revenue arithmetic ----------------------------------------------------

test('revenue is the order total', () => {
  assert.equal(orderRevenue({ total: 1180, subtotal: 1000, discount: 0, tax: 180 }), 1180);
  assert.equal(orderRevenue({ total: '475.24' }), 475.24);
});

test('a missing total falls back to the subtotal arithmetic', () => {
  assert.equal(orderRevenue({}), 0);
  assert.equal(orderRevenue({ subtotal: 475.24 }), 475.24);
  assert.equal(orderRevenue({ subtotal: '475.24', discount: null, tax: undefined }), 475.24);
});

// --- no double counting ----------------------------------------------------

test('an order is counted at most once', () => {
  const list = [order({ status: 'delivered' }), order({ payment_method: PREPAID, payment_status: 'paid' })];
  const qualifying = list.filter(isOrderQualifying);
  assert.equal(qualifying.length, 2);
  assert.equal(new Set(qualifying).size, 2, 'no order appears twice');
});

test('COD and prepaid are summed together without double counting', () => {
  const orders = [
    order({ status: 'pending', total: 400, tax: 0 }),                                       // COD -> 400
    order({ status: 'cancelled', total: 500, tax: 0 }),                                     // cancelled -> out
    order({ payment_method: PREPAID, payment_status: 'paid', status: 'pending', total: 300, tax: 0 }),   // -> 300
    order({ payment_method: PREPAID, payment_status: 'failed', status: 'delivered', total: 900, tax: 0 }), // failed -> out
  ];
  const total = orders.filter(isOrderQualifying).reduce((s, o) => s + orderRevenue(o), 0);
  assert.equal(total, 700);
});

// --- the timezone ----------------------------------------------------------

test('a late-evening UTC order belongs to the next day in India', () => {
  // 19:15 UTC on the 20th is 00:45 on the 21st in Asia/Kolkata.
  assert.equal(istDayKey('2026-10-20T19:15:49.585Z'), '2026-10-21');
  // 18:30 UTC is exactly midnight in India, so it is the 21st there too.
  assert.equal(istDayKey('2026-10-20T18:30:00.000Z'), '2026-10-21');
  // 20:00 UTC on the 20th is 01:30 on the 21st.
  assert.equal(istDayKey('2026-10-20T20:00:00.000Z'), '2026-10-21');
  // Midday UTC on the 20th is still the 20th in India.
  assert.equal(istDayKey('2026-10-20T12:00:00.000Z'), '2026-10-20');
});

// --- the weekly series -----------------------------------------------------

test('the weekly series sums a COD and a paid order and leaves out the cancelled one', () => {
  const now = new Date('2026-10-21T12:00:00.000Z');
  const orders = [
    // A COD order placed today, in India time.
    order({ status: 'pending', total: 1647, tax: 0, created_at: '2026-10-21T04:00:00.000Z' }),
    // A paid order placed today.
    order({ payment_method: PREPAID, payment_status: 'paid', status: 'delivered', total: 499, tax: 0, created_at: '2026-10-21T05:00:00.000Z' }),
    // A cancelled order placed today - it must not be counted.
    order({ status: 'cancelled', payment_status: 'paid', total: 9999, tax: 0, created_at: '2026-10-21T06:00:00.000Z' }),
    // An order from last week - outside the window.
    order({ status: 'pending', total: 5000, tax: 0, created_at: '2026-10-10T05:00:00.000Z' }),
  ];

  const series = buildRevenueSeries(orders, now);
  assert.equal(series.length, 7, 'every day is present');

  const today = series[series.length - 1];
  assert.equal(today.revenue, 2146, 'the COD order and the paid order are summed, the cancelled one is not');
  assert.equal(today.orders, 2);

  const total = series.reduce((s, d) => s + d.revenue, 0);
  assert.equal(total, 2146, 'the whole week sums to the same figure');

  // The empty days are present with 0.
  for (const day of series.slice(0, -1)) {
    assert.equal(day.revenue, 0);
    assert.equal(day.orders, 0);
  }
});

test('the monthly series follows the same rule', () => {
  const now = new Date('2026-10-21T12:00:00.000Z');
  const orders = [
    order({ status: 'pending', total: 100, tax: 0, created_at: '2026-10-05T05:00:00.000Z' }),
    order({ status: 'cancelled', total: 700, tax: 0, created_at: '2026-10-06T05:00:00.000Z' }),
  ];
  const series = buildSalesSeries(orders, now);
  assert.equal(series.length, 6);
  const october = series[series.length - 1];
  assert.equal(october.month, 'Oct 26');
  assert.equal(october.sales, 100, 'the cancelled order is left out');
});

test('the order count series counts every order, cancelled ones included', () => {
  const now = new Date('2026-10-21T12:00:00.000Z');
  const orders = [
    order({ status: 'pending', created_at: '2026-10-21T04:00:00.000Z' }),
    order({ status: 'cancelled', created_at: '2026-10-21T06:00:00.000Z' }),
  ];
  const series = buildOrdersSeries(orders, now);
  assert.equal(series[series.length - 1].orders, 2, 'both orders are counted as orders placed');
});
