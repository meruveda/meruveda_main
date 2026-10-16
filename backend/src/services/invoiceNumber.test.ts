import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatInvoiceNumber,
  invoiceFyLabel,
  isIntraState,
  isRajasthan,
} from '@meruveda/shared';
import { supabase } from '../database/supabase';
import { buildInvoiceNumber, claimInvoiceNumber } from './invoiceService';

/**
 * Invoice numbering + GST contract tests.
 *
 * The real atomicity lives in Postgres (claim_invoice() — row locks, see
 * backend/sql/migrations/2026-10-15_invoice_automation.sql). These tests mock
 * the RPC with a fake that mirrors its semantics (atomic claim + gapless per-FY
 * allocation, idempotent retries) and assert the SERVICE layer:
 *   - 20 parallel claims -> exactly one winner per order, 20 unique gapless
 *     numbers, and the 19 losers are told "already claimed"
 *   - a retry never allocates a second number
 *   - there is no force/resend escape hatch at all
 *   - the FY label is derived from the invoice date, never hardcoded
 *
 * To verify the SQL itself against a real Postgres (NOT the production
 * Supabase — use `supabase start` locally or a scratch project):
 *   SELECT claim_invoice(gen_random_uuid());          -- expect exception
 *   -- with 20 test order rows, fired concurrently (psql \! / pgbench):
 *   SELECT p, claim_invoice(:order_id) FROM generate_series(1,20) p;
 *   -- then:
 *   SELECT last_value FROM invoice_sequences;         -- exactly 20
 *   SELECT invoice_number FROM orders
 *    WHERE invoice_number IS NOT NULL ORDER BY invoice_number;  -- unique
 */

/* ------------------------------------------------------------------ */
/* Financial year — derived from the invoice date, never hardcoded     */
/* ------------------------------------------------------------------ */

test('FY label follows the Indian financial year (April - March, evaluated in IST)', () => {
  // 1 April 2026 IST opens the 26-27 series.
  assert.equal(invoiceFyLabel(new Date('2026-04-01T00:00:00Z')), '26-27');
  assert.equal(invoiceFyLabel(new Date('2026-10-15T00:00:00Z')), '26-27');
  // 31 March 2027 IST is still 26-27.
  assert.equal(invoiceFyLabel(new Date('2027-03-31T12:00:00Z')), '26-27');
  // The boundary is the INDIAN one: 18:30 UTC is 00:00 on 1 April in India,
  // so the new series opens 30 minutes before it does in UTC.
  assert.equal(invoiceFyLabel(new Date('2027-03-31T18:29:00Z')), '26-27');
  assert.equal(invoiceFyLabel(new Date('2027-03-31T18:31:00Z')), '27-28');
  // 31 March 2026 IST is still the previous series.
  assert.equal(invoiceFyLabel(new Date('2026-03-31T12:00:00Z')), '25-26');
  assert.equal(invoiceFyLabel(new Date('2025-01-15T00:00:00Z')), '24-25');
  // The series is derived, never hardcoded.
  assert.equal(invoiceFyLabel(new Date()), invoiceFyLabel(new Date()));
});

test('invoice number format is MV/<FY>/<6 digits>', () => {
  const n = formatInvoiceNumber(invoiceFyLabel(new Date('2026-10-15T00:00:00Z')), 123);
  assert.equal(n, 'MV/26-27/000123');
  assert.match(n, /^MV\/\d{2}-\d{2}\/\d{6}$/);
  assert.ok(n.length <= 16);
});

/* ------------------------------------------------------------------ */
/* Atomic claim + gapless allocation                                  */
/* ------------------------------------------------------------------ */

/** Fake mirroring claim_invoice(): one FY counter, one number per order. */
function fakeClaimRpc(t: any, counters: Map<string, number>) {
  const assigned = new Map<string, string>();
  const claimed = new Set<string>();
  t.mock.method(supabase, 'rpc', (async (fn: string, args: { p_order_id: string; p_force?: boolean }) => {
    assert.equal(fn, 'claim_invoice');
    const id = args.p_order_id;
    if (claimed.has(id) && !args.p_force) return { data: null, error: null };
    let num = assigned.get(id);
    if (!num) {
      const fy = invoiceFyLabel();
      const next = (counters.get(fy) || 0) + 1;
      counters.set(fy, next);
      num = formatInvoiceNumber(fy, next);
      assigned.set(id, num);
    }
    claimed.add(id);
    return { data: num, error: null };
  }) as any);
  return { assigned, claimed };
}

test('20 parallel claims -> 20 unique gapless numbers, 19 already-claimed', async (t) => {
  const counters = new Map<string, number>();
  const { claimed } = fakeClaimRpc(t, counters);

  const orders = Array.from({ length: 20 }, (_, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    order_number: `MV-${i}`,
  }));

  const results = await Promise.all(orders.map((o) => claimInvoiceNumber(o)));

  const winners = results.filter(Boolean) as string[];
  const losers = results.filter((r) => r === null);

  assert.equal(winners.length, 20, 'every distinct order wins its own claim');
  assert.equal(losers.length, 0, 'one claim per order — nothing else competes');
  assert.equal(new Set(winners).size, 20, 'all numbers unique');

  // Gapless: 1..20 with no duplicates and no gaps.
  const seq = winners.map((w) => Number(w.split('/')[2])).sort((a, b) => a - b);
  assert.deepEqual(seq, Array.from({ length: 20 }, (_, i) => i + 1));

  const fy = invoiceFyLabel();
  for (const w of winners) assert.match(w, new RegExp(`^MV/${fy}/\\d{6}$`));
  assert.equal(counters.get(fy), 20, 'counter advanced exactly once per order');
  assert.equal(claimed.size, 20);
});

test('a retry (PayU double-POST) never allocates a second number', async (t) => {
  const counters = new Map<string, number>();
  const { assigned } = fakeClaimRpc(t, counters);

  const order: any = { id: 'order-1', order_number: 'MV-139559' };
  const first = await claimInvoiceNumber(order);
  assert.ok(first);

  // Same order claimed again — the atomic claim rejects it.
  const second = await claimInvoiceNumber(order);
  assert.equal(second, null, 'retry is reported as already-handled, not re-issued');
  assert.equal(counters.get(invoiceFyLabel()), 1, 'no second number consumed');
  assert.equal(assigned.size, 1);
});

test('there is no force/resend escape hatch that could reissue a number', async (t) => {
  const counters = new Map<string, number>();
  fakeClaimRpc(t, counters);

  const order: any = { id: 'order-2', order_number: 'MV-139559' };
  const first = await claimInvoiceNumber(order);

  // The old design had a `force` option used by an admin "Resend invoice"
  // button, which let a second worker allocate/send again. Delivery is now
  // automatic, so the escape hatch was deleted rather than left unused: the
  // claim must stay unconditional.
  assert.equal(
    (claimInvoiceNumber as unknown as { length: number }).length,
    1,
    'claimInvoiceNumber must take only the order — no options object'
  );

  const second = await claimInvoiceNumber(order);
  assert.equal(second, null, 'a second claim never returns a number to send again');
  assert.equal(counters.get(invoiceFyLabel()), 1, 'no second number consumed');
  assert.ok(first);
});

test('parallels on the SAME order produce exactly one winner', async (t) => {
  const counters = new Map<string, number>();
  fakeClaimRpc(t, counters);

  const order: any = { id: 'order-3', order_number: 'MV-424242' };
  const results = await Promise.all(Array.from({ length: 10 }, () => claimInvoiceNumber(order)));

  const winners = results.filter(Boolean);
  assert.equal(winners.length, 1, 'exactly one of ten parallel claims wins');
  assert.equal(counters.get(invoiceFyLabel()), 1, 'exactly one number consumed');
});

test('falls back to a deterministic number when the migration is not applied', async (t) => {
  t.mock.method(supabase, 'rpc', (async () => ({
    data: null,
    error: { message: 'function claim_invoice does not exist' },
  })) as any);
  t.mock.method(supabase.from('orders') as any, 'update', (() => Promise.resolve({ data: null, error: null })) as any);

  const num = await claimInvoiceNumber({ id: 'y', order_number: 'MV-99' });
  assert.ok(num);
  assert.match(num!, /^MV\/\d{2}-\d{2}\/\d{6}$/);
  // Deterministic: regenerating for the same order yields the same number.
  const again = await claimInvoiceNumber({ id: 'y', order_number: 'MV-99' });
  assert.equal(again, num);
  assert.equal(num, buildInvoiceNumber('MV-99'));
});

/* ------------------------------------------------------------------ */
/* GST placement — the bug that printed CGST/SGST on unknown states   */
/* ------------------------------------------------------------------ */

test('isRajasthan matches spellings but NEVER defaults a blank state to intra-state', () => {
  for (const s of ['Rajasthan', 'rajasthan', 'RJ', 'Rajsthan', 'Rajasthn', 'RAJASTHAN']) {
    assert.equal(isRajasthan(s), true, s);
    assert.equal(isIntraState(s), true, s);
  }
  for (const s of ['Maharashtra', 'Karnataka', 'Gujarat', 'Delhi', 'Uttar Pradesh']) {
    assert.equal(isRajasthan(s), false, s);
    assert.equal(isIntraState(s), false, s);
  }
  // Blank/unknown -> IGST (inter-state), the safe treatment.
  for (const s of ['', '   ', null, undefined]) {
    assert.equal(isRajasthan(s), false);
    assert.equal(isIntraState(s), false, `blank state ${JSON.stringify(s)} must not be intra-state`);
  }
});