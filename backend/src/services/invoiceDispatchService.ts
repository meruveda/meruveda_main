import { supabase } from '../database/supabase';
import { config } from '../config/env';
import { hasColumn } from './schemaGuard';
import {
  claimInvoiceNumber,
  generateInvoicePdf,
  getOrderForInvoice,
  markInvoiceSent,
  releaseInvoiceClaim,
} from './invoiceService';
import { getInvoiceEmailTemplate, isEmailConfigured, sendEmailWithAttachments } from './emailService';
import {
  WHATSAPP_TEMPLATES,
  getLogEntry,
  isWhatsappConfigured,
  logMessage,
  normalizePhone,
  sendDocumentTemplateOnce,
  wasSent,
} from './whatsappService';
import { formatInvoiceAmount } from '@meruveda/shared';

const money = (v: unknown) => `Rs. ${formatInvoiceAmount(Number(v) || 0)}`;

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
/* Error bookkeeping                                                   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Status derivation for the admin Orders UI                          */
/* ------------------------------------------------------------------ */

export type InvoiceStatus = 'pending' | 'sent' | 'failed';

/**
 * Public snapshot used by the admin Orders UI.
 *
 * Read-only: it never triggers a send. The three states mirror the automated
 * pipeline exactly —
 *   sent    = a channel accepted the document (invoice_sent_at written on
 *             delivery, never on claim)
 *   failed  = every attempt failed and a reason is recorded; the cron sweep
 *             keeps retrying until MAX_INVOICE_ATTEMPTS
 *   pending = not yet delivered, no failure recorded; either the trigger has
 *             not fired or a retry is still in flight
 *
 * Works even when the invoice columns have not been created yet.
 */
export function deriveInvoiceStatus(order: {
  invoice_sent_at?: string | null;
  invoice_error?: string | null;
  invoice_attempts?: number | null;
  invoice_whatsapp_status?: string | null;
  invoice_email_status?: string | null;
}): {
  status: InvoiceStatus;
  sentAt: string | null;
  error: string | null;
  attempts: number;
  whatsappStatus: string | null;
  emailStatus: string | null;
} {
  const sentAt = order?.invoice_sent_at || null;
  const error = order?.invoice_error || null;
  const attempts = Number(order?.invoice_attempts || 0);
  const whatsappStatus = order?.invoice_whatsapp_status || null;
  const emailStatus = order?.invoice_email_status || null;
  if (sentAt) return { status: 'sent', sentAt, error: null, attempts, whatsappStatus, emailStatus };
  if (error) return { status: 'failed', sentAt, error, attempts, whatsappStatus, emailStatus };
  return { status: 'pending', sentAt: null, error: null, attempts, whatsappStatus, emailStatus };
}

/* ------------------------------------------------------------------ */
/* Storage — the invoice is written ONCE and never regenerated         */
/* ------------------------------------------------------------------ */

/**
 * Upload the PDF to the private Supabase bucket and persist its object path on
 * the order.
 *
 * The returned value is a STORAGE OBJECT PATH, not a signed URL: signed URLs
 * expire (7 days by default) and an invoice on a legal document must keep
 * resolving years later. A fresh signed URL is minted on demand by whoever
 * needs to open or forward the file.
 */
async function uploadInvoicePdf(
  orderId: string,
  orderNumber: string,
  invoiceNumber: string,
  pdf: Buffer
): Promise<string | null> {
  const bucket = config.invoiceStorageBucket;
  if (!bucket) return null;
  // Slashes in the invoice series would create extra folders; normalise them.
  const safeInvoice = invoiceNumber.replace(/[^A-Za-z0-9._-]+/g, '_');
  const objectPath = `${orderNumber}/Invoice-${safeInvoice}.pdf`;
  const uploadOpts = { contentType: 'application/pdf', cacheControl: '3600', upsert: true } as const;

  try {
    let { error } = await supabase.storage.from(bucket).upload(objectPath, pdf, uploadOpts);
    if (error && /bucket not found/i.test(error.message || '')) {
      const { error: createErr } = await supabase.storage.createBucket(bucket, {
        public: false,
        fileSizeLimit: 10 * 1024 * 1024,
      });
      if (createErr) {
        console.warn(`[Invoice] could not create private bucket "${bucket}":`, createErr.message);
        return null;
      }
      const retry = await supabase.storage.from(bucket).upload(objectPath, pdf, uploadOpts);
      error = retry.error;
    }
    if (error) {
      console.warn(`[Invoice] storage upload failed for ${orderNumber}:`, error.message);
      return null;
    }

    // Persist the path so GET /orders/:id/invoice can serve this exact file
    // forever instead of regenerating a second copy of the same invoice.
    if (await hasColumn('orders', 'invoice_url')) {
      await supabase.from('orders').update({ invoice_url: objectPath }).eq('id', orderId);
    }
    return objectPath;
  } catch (err: any) {
    console.warn(`[Invoice] storage upload failed for ${orderNumber}:`, err?.message || err);
    return null;
  }
}

/** Mint a time-limited public-ish link for a stored invoice. */
export async function createInvoiceSignedUrl(objectPath: string): Promise<string | null> {
  if (!objectPath || !config.invoiceStorageBucket) return null;
  // An absolute URL was stored by an older build — pass it through.
  if (/^https?:\/\//i.test(objectPath)) return objectPath;
  const { data, error } = await supabase.storage
    .from(config.invoiceStorageBucket)
    .createSignedUrl(objectPath, config.invoiceSignedUrlExpirySeconds);
  if (error || !data?.signedUrl) {
    console.warn('[Invoice] signed URL failed:', error?.message || 'no url');
    return null;
  }
  return data.signedUrl;
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

/**
 * Generate + deliver the invoice for one order. This is the ONLY invoice path
 * in the app — the legacy WhatsApp-only branch was removed.
 *
 * Idempotency is a single atomic Postgres step: `claim_invoice()` claims the
 * order AND allocates the FY-series number in one transaction. A parallel PayU
 * callback that loses the race gets NULL back and stops; it never allocates a
 * second number and never sends a second invoice.
 *
 * The three delivery channels are independent and run concurrently. A failing
 * channel never blocks the others, and nothing here can fail the order flow:
 * this function never throws.
 */
export async function sendInvoiceDispatch(orderId: string): Promise<InvoiceDispatchResult> {
  const order: any = await getOrderForInvoice(orderId);

  const result: InvoiceDispatchResult = {
    claimed: false,
    skipped: false,
    email: 'disabled',
    whatsapp: 'disabled',
    adminCopy: 'disabled',
    invoiceNumber: order.invoice_number || '',
  };

  /* ---- 1. atomic claim + number allocation (one transaction) ---- */
  // Returns null when another worker already owns this order. There is no
  // "force" path on purpose: the once-only guarantee has exactly one escape
  // hatch (a failed claim is released and retried), never a manual override
  // that would mint a second tax document.
  const invoiceNumber = await claimInvoiceNumber(order);
  if (!invoiceNumber) {
    // Someone else already claimed this order. Nothing to do.
    result.skipped = true;
    result.invoiceNumber = order.invoice_number || '';
    return result;
  }
  result.claimed = true;
  result.invoiceNumber = invoiceNumber;

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

  const filename = `Invoice-${order.order_number}-${invoiceNumber.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`;

  /* ---- 3. upload once (concurrent with delivery) ---- */
  const storagePromise = uploadInvoicePdf(order.id, order.order_number, invoiceNumber, pdf)
    .then((p) => {
      if (p) result.invoiceUrl = p;
      return p;
    })
    .catch(() => null);

  const signedUrlPromise = storagePromise.then((p) => (p ? createInvoiceSignedUrl(p) : null)).catch(() => null);

  /* ---- 4. email channel ---- */
  const runEmailChannel = async (): Promise<ChannelStatus> => {
    const toEmail = customerEmail(order);
    const emailRef = `${EMAIL_PURPOSE}:${orderId}`;
    if (!toEmail) return 'disabled';
    if (!isEmailConfigured()) {
      console.warn('[Invoice] no customer email on the order / Resend not configured — skipping email.');
      return 'disabled';
    }
    if (await wasSent(EMAIL_PURPOSE, emailRef)) return 'skipped';

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
    await logMessage({
      recipient: toEmail,
      messageType: delivered ? 'email' : 'failed',
      purpose: EMAIL_PURPOSE,
      referenceId: emailRef,
      status: delivered ? 'sent' : 'failed',
      error: delivered ? undefined : 'Email delivery failed (Resend rejected, API key missing, or timed out)',
      payload: { order_number: order.order_number, invoice_number: invoiceNumber },
    });
    return delivered ? 'sent' : 'failed';
  };

  /* ---- 5. WhatsApp channel — APPROVED TEMPLATE with a document header ---- */
  // Outside the 24h customer-service window Meta only accepts a template
  // message. A free-form `type: document` send is rejected with error 131047,
  // so the PDF must be sent as a template whose first component is a document
  // header. See WHATSAPP_INVOICE_TEMPLATE below.
  const runWhatsappChannel = async (): Promise<ChannelStatus> => {
    const phone = customerPhone(order);
    if (!phone) return 'disabled';
    if (!isWhatsappConfigured()) return 'disabled';

    const signedUrl = await signedUrlPromise;
    const whatsRef = `${WHATSAPP_PURPOSE}:${orderId}`;
    const delivered = await withTimeout(
      sendDocumentTemplateOnce({
        to: phone,
        purpose: WHATSAPP_PURPOSE,
        referenceId: whatsRef,
        base64: pdf.toString('base64'),
        filename,
        invoiceNumber,
        orderNumber: order.order_number,
        total: money(order.total),
        signedUrl,
        payload: { order_number: order.order_number, invoice_number: invoiceNumber },
      }),
      CHANNEL_TIMEOUT_MS,
      'whatsapp send'
    ).catch((err: any) => {
      console.error('[Invoice] whatsapp send failed:', err?.message || err);
      return false;
    });
    return delivered ? 'sent' : 'failed';
  };

  /* ---- 6. copy to the store owner — best effort ---- */
  const runAdminCopyChannel = async (): Promise<ChannelStatus> => {
    const adminPhone = normalizePhone(config.adminWhatsappNumber);
    if (!adminPhone || !isWhatsappConfigured()) return 'disabled';

    const whatsRef = `${ADMIN_PURPOSE}:${orderId}`;
    const delivered = await withTimeout(
      sendDocumentTemplateOnce({
        to: adminPhone,
        purpose: ADMIN_PURPOSE,
        referenceId: whatsRef,
        base64: pdf.toString('base64'),
        filename,
        invoiceNumber,
        orderNumber: order.order_number,
        total: money(order.total),
        signedUrl: null,
        payload: { order_number: order.order_number, invoice_number: invoiceNumber, recipient: 'admin' },
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
  result.whatsapp = whatsappOutcome.status === 'fulfilled' ? whatsappOutcome.value : 'failed';
  result.adminCopy = adminOutcome.status === 'fulfilled' ? adminOutcome.value : 'disabled';
  result.invoiceUrl = result.invoiceUrl || order.invoice_url || null;

  /* ---- 7. finalise ---- */
  const anyDelivered = result.email === 'sent' || result.whatsapp === 'sent';
  const anyChannelTried = result.email !== 'disabled' || result.whatsapp !== 'disabled';

  if (anyDelivered) {
    // The claim is still held (the order IS invoiced); only the failure reason
    // is cleared. invoice_sent_at is written HERE and nowhere else, so it means
    // "a channel accepted the document", not "some worker touched this row".
    await markInvoiceSent(orderId, {
      whatsapp: result.whatsapp === 'disabled' ? null : result.whatsapp,
      email: result.email === 'disabled' ? null : result.email,
    });
    return result;
  }

  const reason = !anyChannelTried
    ? 'No delivery channel: customer has no email on the order and WhatsApp is not configured / has no phone number.'
    : result.email === 'failed' && result.whatsapp === 'failed'
    ? 'Both email and WhatsApp delivery failed.'
    : result.email === 'failed'
    ? 'Email delivery failed.'
    : 'WhatsApp delivery failed.';

  result.reason = reason;
  // Release the claim so the retry sweep can try again. The invoice NUMBER is
  // kept — an issued GST number is never reused.
  await releaseInvoiceClaim(orderId, reason);
  return result;
}

/** Convenience wrapper used by postOrderConfirmed. Never throws. */
export async function sendInvoiceAuto(orderId: string): Promise<InvoiceDispatchResult> {
  return sendInvoiceDispatch(orderId);
}

/** True when a delivery for this order is already recorded as sent. */
export async function invoiceAlreadyLogged(orderId: string): Promise<boolean> {
  const w = await getLogEntry(WHATSAPP_PURPOSE, `${WHATSAPP_PURPOSE}:${orderId}`);
  const e = await getLogEntry(EMAIL_PURPOSE, `${EMAIL_PURPOSE}:${orderId}`);
  return Boolean((w && w.status === 'sent') || (e && e.status === 'sent'));
}

/** Hard cap on delivery attempts per order. After this the order is left alone. */
export const MAX_INVOICE_ATTEMPTS = 5;

/**
 * Gap between the first retry and the next, in minutes: 2, 4, 8, 16.
 *
 * The cron runs every 2 minutes; the backoff keeps a genuinely broken order
 * (bad phone number, revoked Meta token) from burning all five attempts inside
 * ten minutes, while a transient blip is still retried within the half hour the
 * merchant is willing to wait.
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
 * Retry sweep for invoices that never went out (WhatsApp outage, missing email,
 * provider quota, template rejection).
 *
 * Only orders that are genuinely billable are considered: paid prepaid orders
 * and COD orders (unpaid until delivery). An unpaid prepaid checkout is skipped
 * so no invoice can ever precede a verified payment.
 *
 * Bounded by MAX_INVOICE_ATTEMPTS and by a per-attempt backoff, so the sweep is
 * safe to run every two minutes without hammering a failing provider.
 */
export async function retryPendingInvoices(limit = 25): Promise<InvoiceRetryRow[]> {
  const hasSentAt = await hasColumn('orders', 'invoice_sent_at');
  const hasErrorCol = await hasColumn('orders', 'invoice_error');
  const hasAttempts = await hasColumn('orders', 'invoice_attempts');
  const hasLastAttempt = await hasColumn('orders', 'invoice_last_attempt_at');
  if (!hasSentAt) {
    console.error(
      '[Invoice] retry sweep aborted: orders.invoice_sent_at does not exist — apply ' +
        'backend/sql/migrations/2026-10-15_invoice_automation.sql'
    );
    return [];
  }

  // Oldest-first within the retry window; 7 days is enough for a provider
  // outage to be resolved, and older failures need manual attention anyway.
  const tooOld = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const selectCols = [
    'id', 'order_number', 'status', 'payment_status', 'payment_method', 'created_at',
    'invoice_sent_at',
    hasErrorCol ? 'invoice_error' : '',
    hasAttempts ? 'invoice_attempts' : '',
    hasLastAttempt ? 'invoice_last_attempt_at' : '',
  ]
    .filter(Boolean)
    .join(', ');

  const { data: rows, error } = await supabase
    .from('orders')
    .select(selectCols)
    .is('invoice_sent_at', null)
    .gt('created_at', tooOld)
    .in('status', ['pending', 'processing', 'confirmed', 'packed', 'shipped'])
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[Invoice] retry sweep query failed:', error.message);
    return [];
  }

  const results: InvoiceRetryRow[] = [];
  for (const row of (rows || []) as any[]) {
    const orderNumber = row.order_number;
    const orderId = row.id;

    // Never ship an invoice for an order that has not been paid (COD excepted).
    const method = String(row.payment_method || '').toUpperCase();
    const isCOD = method.includes('COD') || method.includes('CASH');
    if (!isCOD && row.payment_status !== 'paid') continue;

    // Attempt cap: stop retrying, leave the failure recorded for a human.
    const attempts = hasAttempts ? Number(row.invoice_attempts || 0) : 0;
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
    if (hasLastAttempt && row.invoice_last_attempt_at) {
      const delay = RETRY_BACKOFF_MINUTES[Math.min(attempts, RETRY_BACKOFF_MINUTES.length - 1)];
      const nextEligible = new Date(row.invoice_last_attempt_at).getTime() + delay * 60_000;
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

    // Belt-and-braces: the channel log is the real once-only guard. It did not
    // exist in production, which is how repeat sends slipped through before.
    if (await invoiceAlreadyLogged(orderId)) {
      results.push({ orderId, orderNumber, ok: true, skipped: true, error: 'already logged as sent' });
      continue;
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
      results.push({
        orderId,
        orderNumber,
        ok: false,
        error: err?.message || 'send failed',
      });
    }
  }
  return results;
}

export const WHATSAPP_INVOICE_TEMPLATE = WHATSAPP_TEMPLATES.INVOICE_WITH_DOCUMENT;

export const invoiceDispatchService = {
  sendInvoiceDispatch,
  sendInvoiceAuto,
  deriveInvoiceStatus,
  invoiceAlreadyLogged,
  retryPendingInvoices,
  createInvoiceSignedUrl,
  MAX_INVOICE_ATTEMPTS,
  WHATSAPP_INVOICE_TEMPLATE,
};