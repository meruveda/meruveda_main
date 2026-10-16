import { config, invoiceWhatsapp } from '../config/env';
import {
  claimInvoiceNumber,
  generateInvoicePdf,
  getOrderForInvoice,
  isCodOrder,
  markInvoiceSent,
  paymentWordingFor,
  payuReferenceFor,
  releaseInvoiceClaim,
  writeInvoiceIssue,
} from './invoiceService';
import { getInvoiceEmailTemplate, isEmailConfigured, sendEmailWithAttachments } from './emailService';
import { normalizePhone, sendInvoiceDocumentTemplate } from './whatsappService';
import {
  createInvoiceSignedUrl,
  downloadInvoicePdf,
  listRecentInvoiceStates,
  readInvoiceState,
  patchChannel,
  patchInvoiceState,
  uploadInvoicePdf,
  type ChannelState,
} from './invoiceStore';
import { formatInvoiceAmount } from '@meruveda/shared';

const money = (v: unknown) => `₹${formatInvoiceAmount(Number(v) || 0)}`;

/**
 * Bound an external call so one stuck provider (Resend, Meta Graph) can never
 * stall the post-order callback. Rejects after `ms`; the caller stops waiting
 * and records a failure instead of hanging.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/** External-provider budget for one invoice delivery channel. */
const CHANNEL_TIMEOUT_MS = 10_000;

export type ChannelStatus = 'sent' | 'skipped' | 'failed' | 'disabled';

export interface InvoiceDispatchResult {
  /** True when this call won the atomic order-level claim. */
  claimed: boolean;
  /** True when another worker already handled this order. */
  skipped: boolean;
  email: ChannelStatus;
  whatsapp: ChannelStatus;
  adminCopy: ChannelStatus;
  invoiceNumber: string;
  invoiceUrl?: string | null;
  reason?: string;
}

const EMAIL_PURPOSE = 'invoice_email';
const WHATSAPP_PURPOSE = 'invoice_customer';
const ADMIN_PURPOSE = 'invoice_admin';

function customerPhone(order: any): string {
  return order?.shipping_address?.phone || order?.billing_address?.phone || '';
}
function customerEmail(order: any): string {
  return order?.users?.email || order?.user_email || '';
}
function customerFirstName(order: any): string {
  const full = order?.shipping_address?.fullName || order?.billing_address?.fullName || '';
  return String(full).split(' ').filter(Boolean)[0] || '';
}

/* ------------------------------------------------------------------ */
/* Status derivation for the admin Orders UI                          */
/* ------------------------------------------------------------------ */

export type InvoiceStatus = 'pending' | 'sent' | 'failed';

/**
 * Public snapshot for the admin Orders UI, derived from `state.json`.
 *
 *   pending = no state.json yet (order placed, invoice not yet issued) OR
 *             issued but no channel has accepted it. Never an error.
 *   sent    = a channel accepted the document.
 *   failed  = an attempt failed and the reason is recorded; the sweep keeps
 *             retrying until MAX_INVOICE_ATTEMPTS.
 *
 * Read-only: it never triggers a send, and a missing state.json is a normal
 * state rather than a failure.
 */
export function deriveInvoiceStatus(state: {
  channels?: Record<string, Partial<ChannelState> | undefined>;
} | null | undefined): {
  status: InvoiceStatus;
  sentAt: string | null;
  error: string | null;
  attempts: number;
  whatsappStatus: string | null;
  emailStatus: string | null;
} {
  if (!state || !state.channels) {
    return {
      status: 'pending',
      sentAt: null,
      error: null,
      attempts: 0,
      whatsappStatus: null,
      emailStatus: null,
    };
  }

  const { whatsapp, email } = state.channels as {
    whatsapp?: Partial<ChannelState>;
    email?: Partial<ChannelState>;
  };
  const whatsappStatus = whatsapp?.status ?? null;
  const emailStatus = email?.status ?? null;
  const attempts = Math.max(Number(whatsapp?.attempts || 0), Number(email?.attempts || 0));

  if (whatsappStatus === 'sent' || emailStatus === 'sent') {
    return {
      status: 'sent',
      sentAt: whatsapp?.sentAt || email?.sentAt || null,
      error: null,
      attempts,
      whatsappStatus,
      emailStatus,
    };
  }

  const failed = whatsappStatus === 'failed' || emailStatus === 'failed';
  return {
    status: failed && attempts > 0 ? 'failed' : 'pending',
    sentAt: null,
    error: failed ? whatsapp?.lastError || email?.lastError || null : null,
    attempts,
    whatsappStatus,
    emailStatus,
  };
}

/* ------------------------------------------------------------------ */
/* Storage — the invoice is written ONCE and never regenerated         */
/* ------------------------------------------------------------------ */

/**
 * The stored PDF is the document of record.
 *
 * `pdfPath` is a STORAGE OBJECT PATH, not a signed URL: signed URLs expire and
 * an invoice on a legal document must keep resolving years later. A fresh
 * signed URL is minted on demand by whoever needs to open or forward the file.
 */
export { createInvoiceSignedUrl, downloadInvoicePdf };
/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

/**
 * Generate, store and deliver the invoice for one order.
 *
 * This is the ONLY invoice path in the app. It fires at order creation for every
 * order — COD and prepaid alike, paid or not — because a tax invoice documents
 * the sale, and the sale happens when the order is placed. There is no payment
 * gate anywhere: nothing 409s, nothing hides the Download button, and the retry
 * sweep never skips an unpaid order.
 *
 * Once-only guarantee: `claimInvoiceNumber` creates `invoices/<id>/claim` with
 * `upsert:false`. The order-creation trigger, a PayU callback and the cron sweep
 * can all race; exactly one create succeeds, and an already-issued invoice is
 * returned as-is rather than regenerated.
 *
 * The channels are independent and run concurrently. A failing channel never
 * blocks the others, and this function never throws.
 */
export async function sendInvoiceDispatch(orderId: string): Promise<InvoiceDispatchResult> {
  const order: any = await getOrderForInvoice(orderId);

  const result: InvoiceDispatchResult = {
    claimed: false,
    skipped: false,
    email: 'disabled',
    whatsapp: 'disabled',
    adminCopy: 'disabled',
    invoiceNumber: '',
  };

  /* ---- 1. atomic claim + number allocation (Storage, upsert:false) ---- */
  const invoiceNumber = await claimInvoiceNumber(order);
  if (!invoiceNumber) {
    // Someone else owns this order, or storage is unavailable. Either way we
    // must not issue a second tax document.
    const state = await readInvoiceState(orderId);
    result.skipped = true;
    result.invoiceNumber = state?.invoiceNumber || '';
    return result;
  }
  result.claimed = true;
  result.invoiceNumber = invoiceNumber;

  // Freeze the invoice identity + payment wording so a later payment update
  // cannot rewrite what the customer was told on a document they already hold.
  await writeInvoiceIssue(orderId, invoiceNumber, order);

  /* ---- 2. render the PDF ---- */
  let pdf: Buffer;
  try {
    pdf = await generateInvoicePdf(order);
  } catch (err: any) {
    const reason = `PDF generation failed: ${err?.message || err}`;
    await releaseInvoiceClaim(orderId, reason);
    result.reason = reason;
    return result;
  }

  const filename = `Invoice-${invoiceNumber.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`;

  /* ---- 3. store once (concurrent with delivery) ---- */
  const storagePromise = uploadInvoicePdf(orderId, invoiceNumber, pdf)
    .then(async (path) => {
      if (path) {
        result.invoiceUrl = path;
        const state = await readInvoiceState(orderId);
        if (state) await patchInvoiceState(orderId, { pdfPath: path });
      }
      return path;
    })
    .catch(() => null);

  const signedUrlPromise = storagePromise
    .then((p) => (p ? createInvoiceSignedUrl(p) : null))
    .catch(() => null);

  const payment = paymentWordingFor(order);
  const reference = payuReferenceFor(order);
  const custName = customerFirstName(order) || 'there';

  /* ---- 4. email channel ---- */
  // Runs only when the repository already has an email provider configured.
  // No provider is added here just to have one.
  const runEmailChannel = async (): Promise<ChannelStatus> => {
    const toEmail = customerEmail(order);
    if (!toEmail) return 'disabled';
    if (!isEmailConfigured()) return 'disabled';

    const existing = await readInvoiceState(orderId);
    if (existing?.channels?.email?.status === 'sent') return 'skipped';

    const signedUrl = await signedUrlPromise;
    const delivered = await withTimeout(
      sendEmailWithAttachments({
        to: toEmail,
        subject: `Your MeruVeda order #${order.order_number} invoice ${invoiceNumber}`,
        html: getInvoiceEmailTemplate({
          firstName: customerFirstName(order),
          orderNumber: order.order_number,
          invoiceNumber,
          total: money(order.total),
          signedUrl,
        }),
        attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
      }),
      CHANNEL_TIMEOUT_MS,
      'email send'
    ).catch((err: any) => {
      console.error('[Invoice] email send failed:', err?.message || err);
      return false;
    });

    await patchChannel(orderId, 'email', {
      status: delivered ? 'sent' : 'failed',
      attempts: (existing?.channels?.email?.attempts || 0) + 1,
      sentAt: delivered ? new Date().toISOString() : null,
      lastAttemptAt: new Date().toISOString(),
      lastError: delivered ? null : 'Email delivery failed (Resend rejected, API key missing, or timed out)',
    });
    return delivered ? 'sent' : 'failed';
  };

  /* ---- 5. WhatsApp channel — approved UTILITY template, DOCUMENT header ---- */
  // Outside the 24h customer-service window Meta only accepts a template
  // message, so the PDF must ride on a template whose first component is a
  // document header.
  //
  // If the Meta slot is empty this SKIPS QUIETLY: no error, no attempt
  // consumed, no failure state written. The invoice is still issued and
  // downloadable; the backfill sweep delivers it later if the slot is filled in.
  const runWhatsappChannel = async (): Promise<ChannelStatus> => {
    const phone = customerPhone(order);
    if (!phone) return 'disabled';
    if (!invoiceWhatsapp.configured) {
      // Not an error and not a failure — the slot is simply empty.
      await patchChannel(orderId, 'whatsapp', { status: 'not_configured' });
      return 'skipped';
    }

    const existing = await readInvoiceState(orderId);
    if (existing?.channels?.whatsapp?.status === 'sent') return 'skipped';

    const signedUrl = await signedUrlPromise;
    const delivered = await withTimeout(
      sendInvoiceDocumentTemplate({
        to: phone,
        customerName: custName,
        orderNumber: order.order_number,
        invoiceNumber,
        total: money(order.total),
        signedUrl,
        filename,
      }),
      CHANNEL_TIMEOUT_MS,
      'whatsapp send'
    ).catch((err: any) => {
      console.error('[Invoice] whatsapp send failed:', err?.message || err);
      return false;
    });

    await patchChannel(orderId, 'whatsapp', {
      status: delivered ? 'sent' : 'failed',
      attempts: (existing?.channels?.whatsapp?.attempts || 0) + 1,
      sentAt: delivered ? new Date().toISOString() : null,
      lastAttemptAt: new Date().toISOString(),
      lastError: delivered ? null : 'Meta rejected the invoice template message',
    });
    return delivered ? 'sent' : 'failed';
  };

  /* ---- 6. copy to the store owner — best effort ---- */
  const runAdminCopyChannel = async (): Promise<ChannelStatus> => {
    const adminPhone = normalizePhone(config.adminWhatsappNumber);
    if (!adminPhone || !invoiceWhatsapp.configured) return 'disabled';
    if (!adminPhone) return 'disabled';

    const signedUrl = await signedUrlPromise;
    const delivered = await withTimeout(
      sendInvoiceDocumentTemplate({
        to: adminPhone,
        customerName: 'Store admin',
        orderNumber: order.order_number,
        invoiceNumber,
        total: money(order.total),
        signedUrl,
        filename,
      }),
      CHANNEL_TIMEOUT_MS,
      'admin whatsapp copy'
    ).catch((err: any) => {
      console.error('[Invoice] admin copy failed:', err?.message || err);
      return false;
    });
    return delivered ? 'sent' : 'failed';
  };

  const [emailOutcome, whatsappOutcome, adminOutcome] = await Promise.allSettled([
    runEmailChannel(),
    runWhatsappChannel(),
    runAdminCopyChannel(),
  ]);
  for (const [name, outcome] of [
    ['email', emailOutcome],
    ['whatsapp', whatsappOutcome],
    ['admin-copy', adminOutcome],
  ] as const) {
    if (outcome.status === 'rejected') {
      console.error(`[Invoice] ${name} channel threw unexpectedly:`, outcome.reason);
    }
  }
  result.email = emailOutcome.status === 'fulfilled' ? emailOutcome.value : 'failed';
  result.whatsapp = whatsappOutcome.status === 'fulfilled' ? whatsappOutcome.value : 'skipped';
  result.adminCopy = adminOutcome.status === 'fulfilled' ? adminOutcome.value : 'disabled';

  /* ---- 7. finalise ---- */
  const anyDelivered = result.email === 'sent' || result.whatsapp === 'sent';
  if (anyDelivered) {
    await markInvoiceSent(orderId, {
      whatsapp: result.whatsapp === 'skipped' ? null : result.whatsapp,
      email: result.email === 'disabled' ? null : result.email,
    });
  } else if (result.email === 'failed') {
    // A genuine delivery failure is recorded; a skipped channel is not a failure.
    await releaseInvoiceClaim(orderId, 'Email delivery failed.');
  }

  return result;
}

/** Convenience wrapper used by postOrderConfirmed. Never throws. */
export async function sendInvoiceAuto(orderId: string): Promise<InvoiceDispatchResult> {
  return sendInvoiceDispatch(orderId);
}

/** Hard cap on delivery attempts per channel. After this the order is left alone. */
export const MAX_INVOICE_ATTEMPTS = 5;

/**
 * Minutes to wait before attempt N+1: 2, 4, 8, 16.
 *
 * Keeps a genuinely broken order (bad phone number, revoked Meta token) from
 * burning all five attempts in ten minutes, while a transient blip is still
 * retried within the half hour a merchant will wait.
 */
const RETRY_BACKOFF_MINUTES = [2, 4, 8, 16];

export interface InvoiceRetryRow {
  orderId: string;
  orderNumber: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

/**
 * Sweep invoices that were issued but never delivered.
 *
 * The main reason an issued invoice sits undelivered is that the WhatsApp slot
 * was empty when the order was placed — Meta is not active yet. When the slot
 * is filled in later, this finds those invoices by listing `state.json` files,
 * so no index and therefore no schema change is needed.
 *
 * There is deliberately NO payment filter: an invoice documents a sale, and the
 * sale happened when the order was placed.
 */
export async function retryPendingInvoices(limit = 25): Promise<InvoiceRetryRow[]> {
  // Without the Meta slot there is nothing to sweep toward. Returning quietly is
  // the correct behaviour, not a failure.
  if (!invoiceWhatsapp.configured) return [];

  const since = new Date(Date.now() - invoiceWhatsapp.backfillDays * 24 * 60 * 60 * 1000);
  const recent = await listRecentInvoiceStates(limit, since);

  const results: InvoiceRetryRow[] = [];
  for (const { orderId, state } of recent) {
    const orderNumber = state.orderNumber;
    const channel = state.channels?.whatsapp;

    if (channel?.status === 'sent') {
      results.push({ orderId, orderNumber, ok: true, skipped: true, error: 'already sent' });
      continue;
    }

    const attempts = Number(channel?.attempts || 0);
    if (attempts >= MAX_INVOICE_ATTEMPTS) {
      results.push({
        orderId,
        orderNumber,
        ok: false,
        skipped: true,
        error: `gave up after ${attempts} attempts`,
      });
      continue;
    }

    // Backoff: do not retry before this attempt's delay has elapsed.
    if (channel?.lastAttemptAt) {
      const delay = RETRY_BACKOFF_MINUTES[Math.min(attempts, RETRY_BACKOFF_MINUTES.length - 1)];
      const nextEligible = new Date(channel.lastAttemptAt).getTime() + delay * 60_000;
      if (Date.now() < nextEligible) {
        results.push({
          orderId,
          orderNumber,
          ok: true,
          skipped: true,
          error: `backing off until ${new Date(nextEligible).toISOString()}`,
        });
        continue;
      }
    }

    try {
      const dispatch = await sendInvoiceDispatch(orderId);
      results.push({
        orderId,
        orderNumber,
        ok: !dispatch.reason,
        skipped: dispatch.skipped,
        error: dispatch.reason,
      });
    } catch (err: any) {
      results.push({ orderId, orderNumber, ok: false, error: err?.message || 'send failed' });
    }
  }
  return results;
}

export const invoiceDispatchService = {
  sendInvoiceDispatch,
  sendInvoiceAuto,
  deriveInvoiceStatus,
  retryPendingInvoices,
  createInvoiceSignedUrl,
  downloadInvoicePdf,
  readInvoiceState,
  MAX_INVOICE_ATTEMPTS,
};
