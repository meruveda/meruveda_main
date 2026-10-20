/**
 * The automation state machine.
 *
 * These tests pin the admin-facing labels, because the whole point of the
 * pipeline is that a store owner can tell, at a glance, exactly where an
 * order stands: queued, pushing, pushed, AWB assigned, failed (with the retry
 * schedule), skipped, awaiting payment, or simply placed before automation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOMATION_GO_LIVE,
  MAX_PUSH_ATTEMPTS,
  PUSH_BACKOFF_MINUTES,
  fulfillmentState,
  invoiceState,
  isPreAutomationOrder,
  nextAttemptAt,
  paymentState,
  phoneVerifiedBadge,
  shiprocketState,
  shortReason,
} from './shiprocketAutomation';

const NOW = new Date('2026-10-20T12:00:00.000Z');

function order(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    order_number: 'MV-123456',
    created_at: '2026-10-20T10:00:00.000Z',
    status: 'pending',
    payment_method: 'Cash On Delivery',
    payment_status: 'pending',
    ...overrides,
  };
}

/* --- fulfilment ---------------------------------------------------- */

test('fulfilment maps onto the statuses the orders table already uses', () => {
  assert.equal(fulfillmentState(order({ status: 'pending' })).label, 'Pending');
  assert.equal(fulfillmentState(order({ status: 'processing' })).label, 'Processing');
  assert.equal(fulfillmentState(order({ status: 'shipped' })).label, 'Shipped');
  assert.equal(fulfillmentState(order({ status: 'delivered' })).label, 'Delivered');
  assert.equal(fulfillmentState(order({ status: 'cancelled' })).label, 'Cancelled');
  assert.equal(fulfillmentState(order({ status: 'returned' })).label, 'Returned');
});

/* --- payment ------------------------------------------------------- */

test('cash on delivery is "to collect" until the parcel is delivered', () => {
  const cod = order({ payment_method: 'Cash On Delivery' });
  assert.equal(paymentState(cod).label, 'Cash on delivery · To collect');
  assert.equal(paymentState({ ...cod, status: 'delivered' }).label, 'Cash on delivery · Collected');
});

test('prepaid follows the recorded payment status', () => {
  const prepaid = order({ payment_method: 'PayOnline (via PayU)' });
  assert.equal(paymentState({ ...prepaid, payment_status: 'paid' }).label, 'Paid');
  assert.equal(paymentState({ ...prepaid, payment_status: 'pending' }).label, 'Payment pending');
  assert.equal(paymentState({ ...prepaid, payment_status: 'failed' }).label, 'Payment failed');
});

/* --- shiprocket ---------------------------------------------------- */

test('a prepaid order that has not been paid yet is "Awaiting payment"', () => {
  const state = shiprocketState(
    order({ payment_method: 'PayOnline (via PayU)', payment_status: 'pending' }),
  );
  assert.equal(state.label, 'Awaiting payment');
  assert.equal(state.tone, 'muted');
});

test('a paid order waiting for its turn is "Queued"', () => {
  const state = shiprocketState(
    order({ payment_method: 'PayOnline (via PayU)', payment_status: 'paid' }),
  );
  assert.equal(state.label, 'Queued');
});

test('an in-flight push is "Pushing..."', () => {
  const state = shiprocketState(order({ shiprocket_push_status: 'in_progress' }));
  assert.equal(state.label, 'Pushing...');
});

test('a pushed order shows the Shiprocket id', () => {
  const state = shiprocketState(order({ shiprocket_order_id: '1657195972' }));
  assert.equal(state.label, 'Pushed #1657195972');
  assert.equal(state.tone, 'ok');
});

test('an AWB shows the tracking number and the courier', () => {
  const state = shiprocketState(
    order({ shiprocket_order_id: '1657195972', awb_code: 'AB123456789', courier_name: 'Delhivery' }),
  );
  assert.equal(state.label, 'AWB AB123456789 · Delhivery');
});

test('a failure shows the reason, the attempt count and the next retry', () => {
  const next = '2026-10-20T12:15:00.000Z';
  const state = shiprocketState(
    order({
      shiprocket_push_status: 'failed',
      shiprocket_push_error: 'Shiprocket API Error [400]: {"message":"pincode invalid"}',
      shiprocket_push_attempts: 3,
      shiprocket_push_next_attempt_at: next,
    }),
  );
  assert.match(state.label, /^Failed /);
  assert.match(state.label, /Attempt 3\/8/);
  assert.ok(state.label.includes(next), 'the next retry time is shown');
  assert.equal(state.tone, 'error');
});

test('a deliberate skip is final and is shown with its reason', () => {
  const state = shiprocketState(
    order({
      shiprocket_push_skipped: true,
      shiprocket_push_skipped_reason: 'no Indian delivery contact',
    }),
  );
  assert.equal(state.label, 'Skipped – no Indian delivery contact');
  assert.equal(state.skipped, true);
});

test('an order placed before the automation is never auto-processed', () => {
  const old = order({ created_at: '2026-08-01T10:00:00.000Z' });
  assert.equal(isPreAutomationOrder(old), true);
  assert.equal(shiprocketState(old).label, 'Placed before automation');
  assert.equal(shiprocketState(old).tone, 'muted');
});

test('a cancelled order says so, not "failed"', () => {
  const state = shiprocketState(order({ status: 'cancelled' }));
  assert.equal(state.label, 'Cancelled');
});

/* --- invoice ------------------------------------------------------- */

test('an invoice that does not exist yet is "Not generated"', () => {
  const state = invoiceState(order());
  assert.equal(state.label, 'Not generated');
});

test('a generated invoice shows its number', () => {
  const state = invoiceState(order({ invoice_number: 'MV/26-27/000123' }));
  assert.equal(state.label, 'Generated · MV/26-27/000123');
});

test('a sent invoice shows when it went out', () => {
  const state = invoiceState(
    order({ invoice_number: 'MV/26-27/000123', invoice_sent_at: '2026-10-20T11:22:33.000Z' }),
  );
  assert.match(state.label, /^Sent on WhatsApp · 2026-10-20 11:22/);
  assert.equal(state.tone, 'ok');
});

test('a generated invoice waiting for a template says exactly that', () => {
  const state = invoiceState(
    order({ invoice_number: 'MV/26-27/000123' }),
    { whatsappTemplateReady: false },
  );
  assert.match(state.label, /awaiting WhatsApp template/i);
  assert.equal(state.tone, 'warn');
});

test('a failed invoice shows the reason', () => {
  const state = invoiceState(
    order({ invoice_number: 'MV/26-27/000123', invoice_error: 'Meta rejected the invoice template message' }),
  );
  assert.match(state.label, /^Failed /);
  assert.equal(state.tone, 'error');
});

/* --- phone badge --------------------------------------------------- */

test('the unverified badge only shows when the phone was not proven', () => {
  assert.equal(phoneVerifiedBadge(order({ phone_verified: true })).show, false);
  assert.equal(phoneVerifiedBadge(order({ phone_verified: false })).show, true);
  assert.equal(phoneVerifiedBadge(order({ phone_verified: false })).label, 'Phone unverified');
  // An order from before phone verification existed is not flagged.
  assert.equal(phoneVerifiedBadge(order({ created_at: '2026-08-01T10:00:00.000Z' })).show, false);
});

/* --- backoff ------------------------------------------------------- */

test('the retry schedule is immediate, 5m, 15m, 1h, 6h, 24h', () => {
  assert.deepEqual(PUSH_BACKOFF_MINUTES, [0, 5, 15, 60, 360, 1440]);
});

test('the next attempt is scheduled on the backoff curve', () => {
  assert.equal(nextAttemptAt(0, NOW), NOW.toISOString());
  assert.equal(nextAttemptAt(1, NOW), new Date(NOW.getTime() + 5 * 60_000).toISOString());
  assert.equal(nextAttemptAt(2, NOW), new Date(NOW.getTime() + 15 * 60_000).toISOString());
  assert.equal(nextAttemptAt(3, NOW), new Date(NOW.getTime() + 60 * 60_000).toISOString());
  assert.equal(nextAttemptAt(4, NOW), new Date(NOW.getTime() + 360 * 60_000).toISOString());
  assert.equal(nextAttemptAt(5, NOW), new Date(NOW.getTime() + 1440 * 60_000).toISOString());
});

test('the schedule stops after the maximum number of attempts', () => {
  assert.equal(MAX_PUSH_ATTEMPTS, 8);
  assert.equal(nextAttemptAt(MAX_PUSH_ATTEMPTS, NOW), null);
  assert.equal(nextAttemptAt(MAX_PUSH_ATTEMPTS + 5, NOW), null);
});

/* --- helpers ------------------------------------------------------- */

test('the failure reason is shortened to a single readable line', () => {
  assert.equal(shortReason('Error: boom'), 'boom');
  assert.equal(shortReason('first line\nsecond line'), 'first line');
  assert.equal(shortReason(''), 'Unknown error');
  assert.ok(shortReason('x'.repeat(500)).length <= 120);
});

test('the go-live boundary is a fixed, documented instant', () => {
  assert.equal(AUTOMATION_GO_LIVE, '2026-10-17T00:00:00.000Z');
  assert.equal(isPreAutomationOrder(order({ created_at: '2026-10-16T23:59:59.000Z' })), true);
  assert.equal(isPreAutomationOrder(order({ created_at: '2026-10-17T00:00:01.000Z' })), false);
});
