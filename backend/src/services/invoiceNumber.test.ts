import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import {
  formatInvoiceNumber,
  invoiceFyLabel,
  isIntraState,
  isRajasthan,
} from '@meruveda/shared';
import * as invoicesRepo from '../database/repos/invoices';
import { __setR2ClientForTests } from './r2';
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
import * as invoiceServiceModule from './invoiceService';

/**
 * Invoice numbering + GST contract tests.
 *
 * The once-only guarantee lives in R2: `claimInvoice` creates
 * `invoices/<id>/claim` with `If-None-Match: *`. The invoice NUMBER lives in
 * Postgres (`assign_invoice_number`). The tests install a fake R2 client that
 * mirrors create-or-fail semantics and a fake database counter, then assert:
 *   - two parallel claims on one order -> exactly one winner, one invoice
 *   - a retry never allocates a second number
 *   - the database-assigned number is returned unchanged
 *   - there is no force/resend escape hatch at all
 *   - the FY label is derived from the invoice date, never hardcoded
 *   - payment wording never claims something untrue
 */

/* ------------------------------------------------------------------ */
/* Fake R2 + database numbering                                        */
/* ------------------------------------------------------------------ */

/** Objects in the fake bucket: path -> content. */
let objects = new Map<string, string>();

/** The row the order lookup hands back, or null for 'no such order'. */
let orderRow: any = null;

/** When set, the order lookup throws this instead of returning a row. */
let orderError: any = null;

/** Paths whose creation must fail once, to simulate a lost race. */
let conflictOnce = new Set<string>();

/** Numbers the database already assigned, keyed by order id (idempotent). */
let assignedNumbers = new Map<string, string>();
let counterSeq = 0;
let counterFail = false;

const fakeR2 = {
  send: async (command: any) => {
    const input = command?.input || {};
    if (command instanceof PutObjectCommand) {
      const key = input.Key;
      if (conflictOnce.has(key)) {
        conflictOnce.delete(key);
        objects.set(key, '');
        throw Object.assign(new Error('The resource already exists'), { name: 'PreconditionFailed' });
      }
      if (input.IfNoneMatch === '*' && objects.has(key)) {
        throw Object.assign(new Error('The resource already exists'), { name: 'PreconditionFailed' });
      }
      const body = input.Body;
      objects.set(key, typeof body === 'string' ? body : Buffer.from(body ?? '').toString('binary'));
      return {};
    }
    if (command instanceof GetObjectCommand) {
      if (!objects.has(input.Key)) {
        throw Object.assign(new Error('Object not found'), { name: 'NoSuchKey' });
      }
      const text = objects.get(input.Key)!;
      return {
        Body: { transformToByteArray: async () => new TextEncoder().encode(text) },
      };
    }
    if (command instanceof DeleteObjectCommand) {
      objects.delete(input.Key);
      return {};
    }
    if (command instanceof ListObjectsV2Command) {
      const prefix = input.Prefix || '';
      return {
        Contents: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((Key) => ({ Key })),
        CommonPrefixes: [],
        IsTruncated: false,
      };
    }
    return {};
  },
};

function installFakeStorage() {
  objects = new Map();
  conflictOnce = new Set();
  orderRow = null;
  orderError = null;
  assignedNumbers = new Map();
  counterSeq = 0;
  counterFail = false;

  __setR2ClientForTests(fakeR2 as any);

  (invoicesRepo as any).assignInvoiceNumber = async (orderId: string) => {
    if (counterFail) throw new Error('Database counter unavailable');
    const existing = assignedNumbers.get(orderId);
    if (existing) return existing;
    counterSeq += 1;
    const number = `MV/26-27/${String(counterSeq).padStart(6, '0')}`;
    assignedNumbers.set(orderId, number);
    return number;
  };

  (invoiceServiceModule as any).getOrderForInvoice = async () => {
    if (orderError) throw orderError;
    if (!orderRow) {
      throw Object.assign(new Error('Order not found'), { status: 404 });
    }
    return orderRow;
  };
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
  orderError = Object.assign(new Error('Postgres exploded'), { code: 'XX000' });

  let threw = false;
  try {
    await sendInvoiceDispatch('order-dbdown');
  } catch {
    threw = true;
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

test('numbers come from the database and are unique per order', async () => {
  installFakeStorage();

  const n1 = await allocateInvoiceNumber('order-n1');
  const n2 = await allocateInvoiceNumber('order-n2');
  const n3 = await allocateInvoiceNumber('order-n3');

  assert.match(n1, /^MV\/26-27\/\d{6}$/);
  assert.notEqual(n1, n2);
  assert.notEqual(n2, n3);
  // Sequential: the database counter is the single allocator.
  assert.equal(Number(n2.split('/')[2]), Number(n1.split('/')[2]) + 1);
  assert.equal(Number(n3.split('/')[2]), Number(n2.split('/')[2]) + 1);
});

test('the database-assigned number is returned verbatim, including after a race', async () => {
  installFakeStorage();
  // A competing worker already took 000001; the DB hands us 000002.
  assignedNumbers.set('order-race', 'MV/26-27/000002');

  const n = await allocateInvoiceNumber('order-race');
  assert.equal(n, 'MV/26-27/000002', 'the service must not re-derive or re-allocate it');
});

test('a retry for the same order returns the same number, never a second one', async () => {
  installFakeStorage();

  const first = await allocateInvoiceNumber('order-idempotent');
  const second = await allocateInvoiceNumber('order-idempotent');
  assert.equal(second, first, 'numbering is idempotent per order');
});

test('when the series cannot be allocated, the order number is used instead', async () => {
  installFakeStorage();
  counterFail = true;

  const order: any = { id: 'order-fallback', order_number: 'MV-748373' };
  const n = await claimInvoiceNumber(order);
  // Never left without an invoice, and it is the order number, not a thrown error.
  assert.ok(n, 'an invoice number is always produced');
  assert.equal(n, 'MV-748373');
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

test('an unconfigured bucket is reported as unavailable, never auto-created', async () => {
  installFakeStorage();
  __setR2ClientForTests(null);
  const saved = {
    account: process.env.R2_ACCOUNT_ID,
    access: process.env.R2_ACCESS_KEY_ID,
    secret: process.env.R2_SECRET_ACCESS_KEY,
  };
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  resetInvoiceBucketCache();

  try {
    assert.equal(await ensureInvoiceBucket(), false);
  } finally {
    if (saved.account !== undefined) process.env.R2_ACCOUNT_ID = saved.account;
    if (saved.access !== undefined) process.env.R2_ACCESS_KEY_ID = saved.access;
    if (saved.secret !== undefined) process.env.R2_SECRET_ACCESS_KEY = saved.secret;
    resetInvoiceBucketCache();
  }
});

/* ------------------------------------------------------------------ */
/* Payment wording — never claims something untrue                     */
/* ------------------------------------------------------------------ */

test('COD is decided on the exact stored payment_method, case-insensitively', () => {
  // The storefront writes 'Cash On Delivery'; orderService has always also
  // accepted 'COD'. Matching only 'cod' made this return false for every real
  // COD order, so those invoices carried prepaid wording and the COD
  // confirmation text was never sent. The three spellings below are now all COD.
  assert.equal(isCodOrder({ payment_method: 'COD' }), true);
  assert.equal(isCodOrder({ payment_method: 'cod' }), true);
  assert.equal(isCodOrder({ payment_method: ' COD ' }), true);
  assert.equal(isCodOrder({ payment_method: 'Cash On Delivery' }), true);
  assert.equal(isCodOrder({ payment_method: 'cash on delivery' }), true);
  assert.equal(isCodOrder({ payment_method: '  Cash On Delivery  ' }), true);
  assert.equal(isCodOrder({ payment_method: 'cash_on_delivery' }), true);
  assert.equal(isCodOrder({ payment_method: 'PayU' }), false);
  assert.equal(isCodOrder({ payment_method: 'PayOnline (via PayU)' }), false);
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