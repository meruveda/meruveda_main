import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '../database/supabase';
import { assignInvoiceNumber, buildInvoiceNumber } from './invoiceService';

/**
 * Invoice numbering contract tests.
 *
 * The real atomicity lives in Postgres (assign_invoice_number() — row locks,
 * see backend/sql/migrations/2026-10-14_invoice_sequence.sql). These tests
 * mock the RPC with a fake that mirrors its semantics (idempotent per order,
 * one counter per FY) and assert the SERVICE layer:
 *   - 20 parallel assigns -> 20 unique, consecutive numbers (no dupes/gaps)
 *   - retries return the stored number and never consume a new one
 *   - format MV/<FY>/<6 digits>, <= 16 chars
 *
 * To verify the SQL itself against a real Postgres (NOT the production
 * Supabase — use `supabase start` locally or a scratch project):
 *   SELECT assign_invoice_number(gen_random_uuid());  -- expect exception
 *   -- with a test order row:
 *   SELECT p, assign_invoice_number(:order_id) FROM generate_series(1,20) p
 *     ORDER BY p;   -- run 20 of these concurrently via psql \! or pgbench;
 *   -- then: SELECT last_value FROM invoice_sequences;            -- >= 20
 *   --  and: SELECT invoice_number FROM orders WHERE ... — must be unique.
 */

function expectedFyLabel(now = new Date()): string {
  const startYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const yy = (y: number) => String(y % 100).padStart(2, '0');
  return `${yy(startYear)}-${yy(startYear + 1)}`;
}

test('20 parallel assigns -> unique consecutive numbers, idempotent retries', async (t) => {
  let counter = 0;
  const assigned = new Map<string, string>();

  // Fake mirroring the SQL function: per-order memo + one FY counter, with a
  // random delay to widen the race window between check and increment.
  t.mock.method(supabase, 'rpc', (async (fn: string, args: { p_order_id: string }) => {
    assert.equal(fn, 'assign_invoice_number');
    const existing = assigned.get(args.p_order_id);
    if (existing) return { data: existing, error: null };
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    counter += 1;
    const num = `MV/${expectedFyLabel()}/${String(counter).padStart(6, '0')}`;
    assigned.set(args.p_order_id, num);
    return { data: num, error: null };
  }) as any);

  const orders = Array.from({ length: 20 }, (_, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    order_number: `MV-${i}`,
  }));

  const results = await Promise.all(orders.map((o) => assignInvoiceNumber(o)));

  // Unique + consecutive 1..20
  assert.equal(new Set(results).size, 20);
  const seq = results.map((r) => Number(r.split('/')[2])).sort((a, b) => a - b);
  assert.deepEqual(seq, Array.from({ length: 20 }, (_, i) => i + 1));

  // Format: MV/<YY-YY>/<6 digits>, max 16 chars
  for (const r of results) {
    assert.match(r, /^MV\/\d{2}-\d{2}\/\d{6}$/);
    assert.ok(r.length <= 16, `${r} exceeds 16 chars`);
  }

  // Idempotent: re-assigning the same orders returns the same numbers and
  // never consumes a new counter value.
  const again = await Promise.all(orders.map((o) => assignInvoiceNumber(o)));
  assert.deepEqual(again, results);
  assert.equal(counter, 20);
});

test('assignInvoiceNumber reuses the number already persisted on the order', async (t) => {
  const rpcMock = t.mock.method(supabase, 'rpc', (async () => {
    throw new Error('RPC must not be called when invoice_number is set');
  }) as any);
  const num = await assignInvoiceNumber({
    id: 'x',
    invoice_number: 'MV/25-26/000042',
    order_number: 'MV-1',
  });
  assert.equal(num, 'MV/25-26/000042');
  assert.equal(rpcMock.mock.callCount(), 0);
});

test('falls back to legacy numbering when the RPC/migration is unavailable', async (t) => {
  t.mock.method(supabase, 'rpc', (async () => ({
    data: null,
    error: { message: 'function assign_invoice_number does not exist' },
  })) as any);
  const num = await assignInvoiceNumber({ id: 'y', order_number: 'MV-99' });
  assert.equal(num, buildInvoiceNumber('MV-99'));
  assert.equal(num, 'MW-INV-MV-99');
});
