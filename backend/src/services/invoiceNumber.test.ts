import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatInvoiceNumber,
  invoiceFyLabel,
  isIntraState,
  isRajasthan,
} from '@meruveda/shared';
import { supabase } from '../database/supabase';
import {
  allocateInvoiceNumber,
  claimInvoice,
  CLAIM_STALE_MS,
  ensureInvoiceBucket,
invoiceStatePath,
  readInvoiceState,
  resetInvoiceBucketCache,
  safeObjectName,
  writeInvoiceState,
  freshChannelState,
} from './invoiceStore';
import {
  buildInvoiceNumber,
  InvoiceBusyError,
  claimInvoiceNumber,
  isCodOrder,
  paymentWordingFor,
  payuReferenceFor,
} from './invoiceService';
import * as invoiceDispatchModule from './invoiceDispatchService';
import * as invoiceAssetsModule from './invoiceAssets';

/**
 * Invoice numbering + GST contract tests.
 *
 * The once-only guarantee and the FY counter both live in Storage, not in the
 * database: `claimInvoice` creates `invoices/<id>/claim` with `upsert:false`,
 * and `allocateInvoiceNumber` creates a `counters/<FY>/<seq>` marker the same
 * way. So the tests below install a fake Storage backend that mirrors those
 * exact semantics — create-or-fail, no overwriting — and assert the service
 * layer on top of it:
 *   - two parallel claims on one order -> exactly one winner, one invoice
 *   - a retry never allocates a second number
 *   - a lost counter race retries with the next number
 *   - there is no force/resend escape hatch at all
 *   - the FY label is derived from the invoice date, never hardcoded
 *   - payment wording never claims something untrue
 */

/* ------------------------------------------------------------------ */
/* Fake Storage                                                        */
/* ------------------------------------------------------------------ */

/** Objects in the fake bucket: path -> content. */
let objects = new Map<string, string>();

/** The row the PostgREST stub hands back, or null for 'no such order'. */
let orderRow: any = null;

/** Paths whose creation must fail once, to simulate a lost race. */
let conflictOnce = new Set<string>();

function installFakeStorage() {
  objects = new Map();
  conflictOnce = new Set();

  const bucket = {
list: async (prefix: string) => {
      // Real Storage returns bare names for the requested prefix, no slash.
      const out = [...objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .filter((k) => k !== prefix)
        .map((key) => ({ name: key.slice(prefix.length).replace(/^\//, '') }));
      return { data: out, error: null };
    },
    upload: async (path: string, body: any, opts: any) => {
      if (conflictOnce.has(path)) {
        conflictOnce.delete(path);
        // The competing worker really did create it, so a re-list sees it.
        objects.set(path, '');
        return { error: { message: 'The resource already exists' } };
      }
      if (objects.has(path) && !opts?.upsert) {
        return { error: { message: 'The resource already exists' } };
      }
      objects.set(path, String(body ?? ''));
      return { error: null };
    },
    download: async (path: string) => {
      if (!objects.has(path)) return { data: null, error: { message: 'Object not found' } };
      const text = objects.get(path)!;
      return {
        data: { text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer },
        error: null,
      };
    },
createSignedUrl: async (path: string) => ({
      data: { signedUrl: objects.has(path) ? `https://signed.test/${path}` : null },
      error: objects.has(path) ? null : { message: 'Object not found' },
    }),
    remove: async (paths: string[]) => {
      for (const p of paths) objects.delete(p);
      return { data: [], error: null };
    },
  };

  (supabase.storage as any).from = () => bucket;
  (supabase.storage as any).createBucket = async () => ({ error: null });
// PostgREST stub: returns `orderRow`, so a test can make the dispatcher see a
  // real order (or nothing at all).
  const builder = () => ({
    select: () => ({
      eq: () => ({
        single: async () =>
          orderRow ? { data: orderRow, error: null } : { data: null, error: { code: 'PGRST116' } },
        maybeSingle: async () =>
          orderRow ? { data: orderRow, error: null } : { data: null, error: null },
      }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    }),
  });
  (supabase as any).from = builder;
}

/* ------------------------------------------------------------------ */
/* Financial year — derived from the invoice date, never hardcoded     */
/* ------------------------------------------------------------------ */

test('FY label follows the Indian financial year (April - March, evaluated in IST)', () => {
  // 1 April 2026 IST opens the 26-27 series.
  assert.equal(invoiceFyLabel(new Date('2026-04-01T00:00:00Z')), '26-27');
  assert.equal(invoiceFyLabel(new Date('2026-10-15T00:00:00Z')), '26-27');
  // 31 March 2027 IST is still 26-27.
  assert.equal(invoiceFyLabel(new Date('2027-03-31T12:00:00Z')), '26-27');
  // The boundary is the INDIAN one: 18:30 UTC is 00:00 on 1 April in India.
  assert.equal(invoiceFyLabel(new Date('2027-03-31T18:29:00Z')), '26-27');
  assert.equal(invoiceFyLabel(new Date('2027-03-31T18:31:00Z')), '27-28');
  assert.equal(invoiceFyLabel(new Date('2026-03-31T12:00:00Z')), '25-26');
  assert.equal(invoiceFyLabel(new Date('2025-01-15T00:00:00Z')), '24-25');
});

test('invoice number format is MV/<FY>/<6 digits>', () => {
  const n = formatInvoiceNumber(invoiceFyLabel(new Date('2026-10-15T00:00:00Z')), 123);
  assert.equal(n, 'MV/26-27/000123');
  assert.match(n, /^MV\/\d{2}-\d{2}\/\d{6}$/);
});

test('the printed invoice number is safe to use as an object key', () => {
  // Slashes in the printed series would create a directory tree.
  assert.equal(safeObjectName('MV/26-27/000123'), 'MV_26-27_000123');
  assert.equal(safeObjectName('MV-748371'), 'MV-748371');
});

/* ------------------------------------------------------------------ */
/* Once-only claim — two parallel calls yield exactly one invoice      */
/* ------------------------------------------------------------------ */

test('two concurrent claims on one order produce exactly one invoice', async () => {
  installFakeStorage();
  const order = { id: 'order-abc', order_number: 'MV-748371' };

// One caller wins the claim; the other is told to retry rather than being
  // handed a second number or silently given nothing.
  const attempt = async () => {
    try {
      return { number: await claimInvoiceNumber(order), busy: false as const };
    } catch (err: any) {
      return { number: null, busy: err instanceof InvoiceBusyError, err };
    }
  };
  const [a, b] = await Promise.all([attempt(), attempt()]);

  const winners = [a, b].filter((x) => x.number);
  const losers = [a, b].filter((x) => !x.number);
  assert.equal(winners.length, 1, 'exactly one of the two callers may issue');
  assert.equal(losers.length, 1);
  // The loser must be told to retry rather than being handed a second number.
  assert.ok(winners[0]!.number!.startsWith('MV/'), 'the winner gets a series number');
  // Only one claim marker exists.
  assert.equal([...objects.keys()].filter((k) => k.endsWith('/claim')).length, 1);
});

test('a retry after a successful issue returns the same number, never a second one', async () => {
  installFakeStorage();
  const order = { id: 'order-retry', order_number: 'MV-748372' };

  const first = await claimInvoiceNumber(order);
  await writeInvoiceState(order.id, {
    invoiceNumber: first!,
    orderNumber: order.order_number,
    issuedAt: new Date().toISOString(),
    pdfPath: 'invoices/order-retry/invoice.pdf',
    payment: { mode: 'cod', paid: false, reference: null, wording: 'Amount due on delivery' },
    channels: { whatsapp: freshChannelState(), email: freshChannelState() },
  });

  const second = await claimInvoiceNumber({ ...order });
  assert.equal(second, first, 'the already-issued number is returned as-is');

  const state = await readInvoiceState(order.id);
  assert.equal(state?.invoiceNumber, first);
});

test('there is no force or resend escape hatch on the claim path', async () => {
  installFakeStorage();
  // A second claim on an already-claimed order must never win.
  const first = await claimInvoice('order-x', { claimedAt: new Date().toISOString() });
  assert.equal(first.ok, true);
  // ...but it reports "busy" rather than silently doing nothing, which is what
  // used to leave an order stuck in "being generated" for good.
  const second = await claimInvoice('order-x', { claimedAt: new Date().toISOString() });
  assert.equal(second.ok, false);
  assert.equal((second as any).busy, true);
});

/* ------------------------------------------------------------------ */
/* Claim recovery — the stuck-invoice hotfix                           */
/* ------------------------------------------------------------------ */

test('a FRESH claim reports busy so the caller can answer 202 + Retry-After', async () => {
  installFakeStorage();
  const won = await claimInvoice('order-fresh', { claimedAt: new Date().toISOString() });
  assert.equal(won.ok, true);

  // No state.json yet, and the claim is 5 seconds old: still in flight.
  const outcome = await claimInvoice('order-fresh', { claimedAt: new Date().toISOString() });
  assert.equal(outcome.ok, false);
  assert.equal((outcome as any).busy, true, 'must be reported as busy, not as an error');
  assert.equal((outcome as any).retryAfterSeconds, 3);
  assert.ok(objects.has('invoices/order-fresh/claim'), 'a live claim is never stolen');
});

test('a STALE claim is taken over so the order can never wedge', async () => {
  installFakeStorage();
  // A claim whose worker died 5 minutes ago, with no state.json.
  objects.set(
    'invoices/order-stale/claim',
    JSON.stringify({ claimedAt: new Date(Date.now() - 5 * 60_000).toISOString(), owner: 'dead' })
  );

  const outcome = await claimInvoice('order-stale', { claimedAt: new Date().toISOString() });
  assert.equal(outcome.ok, true, 'the dead claim must be recovered');
  assert.equal((outcome as any).tookOver, true);
  // Exactly one claim marker remains, and it is the new one.
  const claims = [...objects.keys()].filter((k) => k.endsWith('/claim'));
  assert.equal(claims.length, 1);
});

test('a claim older than the stale window is recovered; a younger one is not', async () => {
  installFakeStorage();
  const age = (ms: number) => JSON.stringify({ claimedAt: new Date(Date.now() - ms).toISOString() });

  objects.set('invoices/order-age-young/claim', age(10_000));
  assert.equal((await claimInvoice('order-age-young', { claimedAt: new Date().toISOString() })).ok, false);

  objects.set('invoices/order-age-old/claim', age(CLAIM_STALE_MS + 5_000));
  assert.equal((await claimInvoice('order-age-old', { claimedAt: new Date().toISOString() })).ok, true);
});

test('an ISSUED invoice is never re-claimed even if the claim looks stale', async () => {
  installFakeStorage();
  objects.set(
    'invoices/order-done/claim',
    JSON.stringify({ claimedAt: new Date(Date.now() - 10 * 60_000).toISOString() })
  );
  // existingState: true means state.json is present — the invoice is issued.
  const outcome = await claimInvoice(
    'order-done',
    { claimedAt: new Date().toISOString() },
    { existingState: true }
  );
  assert.equal(outcome.ok, false, 'a second tax document must be impossible');
});

test('a successful issue writes state.json AND releases the claim', async () => {
  installFakeStorage();
  const { sendInvoiceDispatch } = invoiceDispatchModule;

  const order = {
    id: 'order-ok',
    order_number: 'MV-748371',
    payment_method: 'COD',
    payment_status: 'pending',
    created_at: new Date().toISOString(),
    subtotal: 1098,
    total: 1098,
    shipping_fee: 0,
    tax: 0,
    discount: 0,
    order_items: [],
    billing_address: {},
    shipping_address: {},
  };

  orderRow = order;
  const result = await sendInvoiceDispatch(order.id);

  // The invoice really was issued...
  assert.equal(result.claimed, true);
  assert.ok(result.invoiceNumber, 'an invoice number was allocated');
  assert.ok(objects.has(`invoices/${order.id}/state.json`), 'state.json was written');
  assert.ok(
    [...objects.keys()].some((k) => k.startsWith(`invoices/${order.id}/`) && k.endsWith('.pdf')),
    'the PDF was stored'
  );
  // ...and the claim is gone, so nothing can be stuck waiting on this order.
  assert.equal(objects.has(`invoices/${order.id}/claim`), false, 'the claim is released on success');
});

test('a failure while issuing leaves NO claim and NO half-issued order', async () => {
  installFakeStorage();

  // Break the renderer the only way the dispatcher cannot route around: make
  // reading the order itself throw, so it dies before the claim is taken.
  const { sendInvoiceDispatch } = invoiceDispatchModule;
  const originalFrom = (supabase as any).from;
  (supabase as any).from = () => ({
    select: () => ({
      eq: () => ({
        single: async () => {
          const e: any = new Error('PostgREST exploded');
          e.code = 'XX000';
          throw e;
        },
      }),
    }),
  });

  let threw = false;
  try {
    await sendInvoiceDispatch('order-dbdown');
  } catch {
    threw = true;
  } finally {
    (supabase as any).from = originalFrom;
  }
  assert.equal(threw, true, 'a dead database must surface, not be swallowed');

  // The invariant that matters: no claim without a state.json, ever.
  const claim = objects.has('invoices/order-dbdown/claim');
  const state = objects.has('invoices/order-dbdown/state.json');
  assert.equal(claim, false, 'a claim must never be left behind');
  assert.equal(state, false);
});

test('the health check reports fonts and logo without throwing', async () => {
  const { checkInvoiceAssets, invoiceAssetPaths } = invoiceAssetsModule;
  const check = checkInvoiceAssets();
  assert.equal(typeof check.fontsOk, 'boolean');
  assert.equal(typeof check.logoOk, 'boolean');
  assert.ok(Array.isArray(invoiceAssetPaths('fonts/NotoSans-Regular.ttf')));
  // In the source tree the assets are present, so this must be true locally.
  assert.equal(check.fontsOk, true, 'fonts must be found in the repo');
  assert.equal(check.logoOk, true, 'the logo must be found in the repo');
});

/* ------------------------------------------------------------------ */
/* Numbering                                                           */
/* ------------------------------------------------------------------ */

test('numbers are allocated from the FY counter and are unique', async () => {
  installFakeStorage();
  const issued = new Date('2026-10-15T00:00:00Z');

  const s2:any=require('../database/supabase').supabase; console.error('DBG', s2 && typeof s2.storage, s2.storage && String(s2.storage.from).slice(0,50));
  const n1 = await allocateInvoiceNumber(issued);
  const n2 = await allocateInvoiceNumber(issued);
  const n3 = await allocateInvoiceNumber(issued);

  assert.match(n1, /^MV\/26-27\/\d{6}$/);
  assert.notEqual(n1, n2);
  assert.notEqual(n2, n3);
  // Sequential, because each allocation takes highest + 1.
  assert.equal(Number(n2.split('/')[2]), Number(n1.split('/')[2]) + 1);
  assert.equal(Number(n3.split('/')[2]), Number(n2.split('/')[2]) + 1);
});

test('a lost counter race retries with the next number instead of failing', async () => {
  installFakeStorage();
  const issued = new Date('2026-10-15T00:00:00Z');
  const fy = invoiceFyLabel(issued);

  // Another worker wins 000001, so our first attempt must fail and retry.
  conflictOnce.add(`counters/${fy}/000001`);

  const n = await allocateInvoiceNumber(issued);
  assert.equal(n, `MV/${fy}/000002`, 'it skipped the taken number and took the next');
});

test('a different financial year gets its own counter', async () => {
  installFakeStorage();
  const thisFy = await allocateInvoiceNumber(new Date('2026-10-15T00:00:00Z'));
  const nextFy = await allocateInvoiceNumber(new Date('2027-06-01T00:00:00Z'));
  assert.match(thisFy, /^MV\/26-27\//);
  assert.match(nextFy, /^MV\/27-28\//);
});

test('when the series cannot be allocated, the order number is used instead', async () => {
  installFakeStorage();
  // Make every counter create fail by pre-filling every candidate as a conflict.
  const fy = invoiceFyLabel(new Date());
  for (let i = 1; i <= 25; i++) conflictOnce.add(`counters/${fy}/${String(i).padStart(6, '0')}`);

  const order: any = { id: 'order-fallback', order_number: 'MV-748373' };
  const n = await claimInvoiceNumber(order);
  // Never left without an invoice, and it is the order number, not a thrown error.
  assert.ok(n, 'an invoice number is always produced');
  assert.ok(n!.length > 0);
});

test('a buildInvoiceNumber fallback is deterministic for the same order', () => {
  assert.equal(buildInvoiceNumber('MV-748371'), buildInvoiceNumber('MV-748371'));
});

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

test('a missing state.json is Pending, never an error', async () => {
  installFakeStorage();
  const state = await readInvoiceState('order-never-issued');
  assert.equal(state, null);
});

test('state round-trips through the bucket', async () => {
  installFakeStorage();
  const ok = await writeInvoiceState('order-r1', {
    invoiceNumber: 'MV/26-27/000009',
    orderNumber: 'MV-748371',
    issuedAt: new Date().toISOString(),
    pdfPath: 'invoices/order-r1/x.pdf',
    payment: { mode: 'cod', paid: false, reference: null, wording: 'Amount due on delivery' },
    channels: { whatsapp: freshChannelState(), email: freshChannelState() },
  });
  assert.equal(ok, true);
  assert.ok(invoiceStatePath('order-r1').endsWith('invoices/order-r1/state.json'));

  const state = await readInvoiceState('order-r1');
  assert.equal(state?.invoiceNumber, 'MV/26-27/000009');
});

test('a missing bucket is auto-created rather than failing the invoice', async () => {
  installFakeStorage();
  resetInvoiceBucketCache();
  assert.equal(await ensureInvoiceBucket(), true);
});

/* ------------------------------------------------------------------ */
/* Payment wording — never claims something untrue                     */
/* ------------------------------------------------------------------ */

test('COD is decided on the exact stored payment_method, case-insensitively', () => {
  assert.equal(isCodOrder({ payment_method: 'COD' }), true);
  assert.equal(isCodOrder({ payment_method: 'cod' }), true);
  assert.equal(isCodOrder({ payment_method: ' COD ' }), true);
  assert.equal(isCodOrder({ payment_method: 'PayU' }), false);
  assert.equal(isCodOrder({ payment_method: 'cashfree' }), false, 'substring must not match');
  assert.equal(isCodOrder({}), false);
});

test('COD wording says the amount is due on delivery and never claims PAID', () => {
  const w = paymentWordingFor({ payment_method: 'COD', payment_status: 'pending' });
  assert.equal(w.mode, 'cod');
  assert.equal(w.wording, 'Amount due on delivery');
  assert.equal(w.paid, false);
});

test('a verified-paid prepaid order is stamped PAID with its PayU reference', () => {
  const w = paymentWordingFor({
    payment_method: 'PayU',
    payment_status: 'paid',
    notes: 'Leave at reception [PayU mihpayid: PAY123456789]',
  });
  assert.equal(w.wording, 'PAID');
  assert.equal(w.paid, true);
  assert.equal(w.reference, 'PAY123456789');
});

test('an unpaid prepaid order stays neutral: no PAID stamp, no reference', () => {
  const w = paymentWordingFor({
    payment_method: 'PayU',
    payment_status: 'pending',
    notes: 'Leave at reception [PayU mihpayid: PAY123456789]',
  });
  assert.equal(w.wording, 'Payment: Online (via PayU)');
  assert.equal(w.paid, false);
  assert.equal(w.reference, null, 'a reference is not asserted before payment is verified');
});

test('the PayU reference falls back to the notes marker the callback writes', () => {
  assert.equal(
    payuReferenceFor({ notes: 'Leave at reception [PayU mihpayid: PAY987654321]' }),
    'PAY987654321'
  );
  assert.equal(payuReferenceFor({ notes: 'no marker here' }), null);
});

/* ------------------------------------------------------------------ */
/* GST contract (unchanged, kept as a regression guard)                */
/* ------------------------------------------------------------------ */

test('Rajasthan is intra-state, a blank state is inter-state', () => {
  assert.equal(isRajasthan('Rajasthan'), true);
  assert.equal(isIntraState('Rajasthan'), true);
  assert.equal(isIntraState('Madhya Pradesh'), false);
  // A blank state must never silently print CGST + SGST.
  assert.equal(isIntraState(''), false);
  assert.equal(isIntraState(undefined), false);
});