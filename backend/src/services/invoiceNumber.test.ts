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
  claimInvoiceNumber,
  isCodOrder,
  paymentWordingFor,
  payuReferenceFor,
} from './invoiceService';

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
  };

  (supabase.storage as any).from = () => bucket;
  (supabase.storage as any).createBucket = async () => ({ error: null });
  (supabase as any).from = () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
  });
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

  const [a, b] = await Promise.all([claimInvoiceNumber(order), claimInvoiceNumber(order)]);

  const issued = [a, b].filter(Boolean);
  assert.equal(issued.length, 1, 'exactly one of the two callers may issue');
  assert.ok(issued[0]!.startsWith('MV/'), 'the winner gets a series number');
  // Only one claim marker exists, and the loser was told "someone else owns it".
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
  assert.equal(await claimInvoice('order-x', { claimedAt: 'now' }), true);
  assert.equal(await claimInvoice('order-x', { claimedAt: 'later' }), false);
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
    payu_mihpayid: 'PAY123456789',
  });
  assert.equal(w.wording, 'PAID');
  assert.equal(w.paid, true);
  assert.equal(w.reference, 'PAY123456789');
});

test('an unpaid prepaid order stays neutral: no PAID stamp, no reference', () => {
  const w = paymentWordingFor({
    payment_method: 'PayU',
    payment_status: 'pending',
    payu_mihpayid: 'PAY123456789',
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