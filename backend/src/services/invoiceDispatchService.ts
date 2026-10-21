import { config, invoiceWhatsapp } from '../config/env';
import {
  InvoiceBusyError,
  InvoiceIssueError,
  claimInvoiceNumber,
  generateInvoicePdf,
  getOrderForInvoice,
  isCodOrder,
  markInvoiceSent,
  releaseInvoiceClaim as _release,
  paymentWordingFor,
  payuReferenceFor,
  releaseInvoiceClaim,
  writeInvoiceIssue,
} from './invoiceService';
import { getInvoiceEmailTemplate, isEmailConfigured, sendEmailWithAttachments } from './emailService';
import { normalizePhone, sendInvoiceTemplate, logMessage } from './whatsappService';
import { getInvoiceTemplate } from './whatsappTemplateResolver';
import {
  createInvoiceSignedUrl,
  deleteInvoiceClaim,
  downloadInvoicePdf,
  listRecentInvoiceStates,
  readInvoiceState,
  patchChannel,
  patchInvoiceState,
  uploadInvoicePdf,
  type ChannelState,
} from './invoiceStore';
import { formatInvoiceAmount } from '@meruveda/shared';
import * as ordersRepo from '../database/repos/orders';
import { hasColumn } from './schemaGuard';
import { recordTimelineEvent } from './shiprocketAutomation';

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
  /** Which step failed, for the log line and the customer message. */
  step?: string;
  /** True when another worker is mid-issue: reply 202, not an error. */
  busy?: boolean;
  retryAfterSeconds?: number;
}

const EMAIL_PURPOSE = 'invoice_email';
const WHATSAPP_PURPOSE = 'invoice_customer';
const ADMIN_PURPOSE = 'invoice_admin';

function customerPhone(order: any): string {
  return order?.delivery_phone || order?.shipping_address?.phone || order?.billing_address?.phone || '';
}
function customerEmail(order: any): string {
  // The email the customer gave at the checkout comes first: it is the
  // address they expect the confirmation and the invoice at. The account's
  // email is the fallback for the older orders.
  return order?.email || order?.users?.email || order?.user_email || '';
}
function customerFirstName(order: any): string {
  const full = order?.shipping_address?.fullName || order?.billing_address?.fullName || '';
  return String(full).split(' ').filter(Boolean)[0] || '';
}

/* ------------------------------------------------------------------ */
/* WhatsApp invoice delivery — behind WHATSAPP_INVOICE_ENABLED          */
/* ------------------------------------------------------------------ */

/**
 * Is WhatsApp invoice delivery switched on?
 *
 * WHATSAPP_INVOICE_ENABLED defaults to false, and false means the WhatsApp
 * channel is inert: no template is looked at, no attempt is consumed, no
 * failure is recorded, and the rest of the order flow is byte-for-byte what it
 * was before this feature existed.
 */
export function whatsappInvoiceEnabled(): boolean {
  return invoiceWhatsapp.enabled === true;
}

/**
 * Record one delivery attempt in `whatsapp_message_log`.
 *
 * Every attempt is logged, sent or failed, so "the invoice never arrived" is
 * always answerable from the database. Never throws and never blocks the caller:
 * the log is bookkeeping, not delivery.
 */
async function logInvoiceAttempt(entry: {
  orderId: string;
  referenceId: string;
  recipient: string;
  status: 'sent' | 'failed';
  error?: string;
  invoiceNumber: string;
  mode: 'document' | 'link';
}): Promise<void> {
  try {
    await logMessage({
      recipient: entry.recipient,
      templateName: invoiceWhatsapp.templateName,
      messageType: entry.mode === 'link' ? 'template_link' : 'template_document',
      purpose: entry.referenceId.endsWith(':admin') ? ADMIN_PURPOSE : WHATSAPP_PURPOSE,
      referenceId: entry.referenceId,
      status: entry.status,
      error: entry.error,
      // Order id and invoice number only. No signed URL, no phone number.
      payload: { orderId: entry.orderId, invoiceNumber: entry.invoiceNumber, mode: entry.mode },
    });
  } catch (err: any) {
    console.error('[Invoice] could not write the WhatsApp message log:', err?.message || err);
  }
}

/* ------------------------------------------------------------------ */
/* Status derivation for the admin Orders UI                          */
/* ------------------------------------------------------------------ */

export type InvoiceStatus = 'pending' | 'sent' | 'failed' | 'awaiting_template';

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

  // Waiting for Meta to approve the template: not a failure, and the attempt
  // budget is untouched.
  if (whatsappStatus === 'awaiting_template') {
    return {
      status: 'awaiting_template',
      sentAt: null,
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

/**
 * Record that the invoice for an order has been generated.
 *
 * The invoice number is written by the database function; this only stamps
 * the generation time so the admin can tell "Generated" from "Not generated",
 * and so the backlog sweep can find invoices that were made but never sent.
 */
async function recordInvoiceGenerated(orderId: string, invoiceNumber: string): Promise<void> {
  try {
    const patch: Record<string, any> = {};
    const alreadyGenerated = await ordersRepo.getOrderRow(orderId);
    const firstTime = !alreadyGenerated?.invoice_generated_at;
    if (await hasColumn('orders', 'invoice_generated_at')) {
      patch.invoice_generated_at = alreadyGenerated?.invoice_generated_at || new Date().toISOString();
    }
    if (await hasColumn('orders', 'invoice_number')) {
      patch.invoice_number = invoiceNumber;
    }
    if (Object.keys(patch).length === 0) return;
    await ordersRepo.updateOrderById(orderId, patch);
    // The timeline event belongs to the moment the invoice was MADE, not to
    // every later attempt to deliver it.
    if (firstTime) {
      await recordTimelineEvent(orderId, 'Invoice generated', { invoice_number: invoiceNumber });
    }
  } catch (err: any) {
    console.error('[invoice] could not stamp the generated invoice:', err?.message || err);
  }
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

  /* ---- 1. atomic claim + number allocation ---- */
  // Throws InvoiceBusyError when another worker is mid-flight, and
  // InvoiceIssueError when storage is unavailable. Both are handled by the
  // caller's catch, which releases the claim so a failure can never wedge the
  // order in "being generated".
  let invoiceNumber: string;
  try {
    invoiceNumber = await claimInvoiceNumber(order);
  } catch (err: any) {
    if (err instanceof InvoiceBusyError) {
      result.skipped = true;
      result.busy = true;
      result.retryAfterSeconds = err.retryAfterSeconds;
      return result;
    }
    throw err;
  }
  result.claimed = true;
  result.invoiceNumber = invoiceNumber;

  // Freeze the invoice identity + payment wording so a later payment update
  // cannot rewrite what the customer was told on a document they already hold.
  try {
    const written = await writeInvoiceIssue(orderId, invoiceNumber, order);
    if (!written) {
      throw new InvoiceIssueError('state-write', 'Could not save the invoice record in storage.');
    }
  } catch (err: any) {
    console.error(`[invoice] step=state-write order=${orderId}`, err?.stack || err);
    await deleteInvoiceClaim(orderId);
    throw new InvoiceIssueError('state-write', err?.reason || 'Could not save the invoice record.');
  }

  /* ---- 2. render the PDF ---- */
  let pdf: Buffer;
  try {
    pdf = await generateInvoicePdf(order);
  } catch (err: any) {
    const reason = err?.reason || err?.message || 'PDF rendering failed';
    console.error(`[invoice] step=pdf-render order=${orderId} reason=${reason}`, err?.stack || err);
    // The claim MUST go: leaving it behind is exactly what strands the order.
    await deleteInvoiceClaim(orderId);
    result.reason = reason;
    result.step = 'pdf-render';
    return result;
  }

  const filename = `Invoice-${invoiceNumber.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`;

  // The invoice now exists: stamp the order so the admin can see "Generated"
  // even before the WhatsApp channel has done anything.
  await recordInvoiceGenerated(orderId, invoiceNumber);

  /* ---- 3. store once (concurrent with delivery) ---- */
  const storagePromise = uploadInvoicePdf(orderId, invoiceNumber, pdf)
    .then(async (path) => {
      if (path) {
        result.invoiceUrl = path;
        await patchInvoiceState(orderId, { pdfPath: path });
      }
      return path;
    })
    .catch((err: any) => {
      console.error(`[invoice] step=storage-upload order=${orderId}`, err?.stack || err);
      return null;
    });

  const signedUrlPromise = storagePromise
    .then((p) => (p ? createInvoiceSignedUrl(p) : null))
    .catch(() => null);

  // The PDF is already issued and state.json exists, so the claim has done its
  // job. Release it now: from this point on the order is invoiced and a later
  // request reads state.json instead of trying to claim.
  await deleteInvoiceClaim(orderId);

  const payment = paymentWordingFor(order);
  const reference = payuReferenceFor(order);
  const custName = customerFirstName(order) || 'there';

  /* ---- 4. email channel ---- */
  // Runs only when the repository already has an email provider configured.
  // No provider is added here just to have one.
  const runEmailChannel = async (): Promise<ChannelStatus> => {
    const toEmail = customerEmail(order);
    if (!toEmail) return 'disabled';
    if (!isEmailConfigured()) {
      // Loud, but never fatal: the order is placed and the invoice is issued.
      console.warn(
        `[Invoice] no email provider is configured (RESEND_API_KEY missing) - order ${order.order_number} ` +
          'will NOT be emailed. The customer still gets the invoice on WhatsApp and can download it.',
      );
      return 'disabled';
    }

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

  /* ---- 5. WhatsApp channel — approved template, gated by the flag ---- */
  // Outside the 24h customer-service window Meta only accepts a template
  // message, so the PDF is attached (document mode) or handed over as a signed
  // link (link mode).
  //
  // If the flag is off this returns 'disabled' immediately: no template is
  // looked at, no attempt is consumed and no failure state is written. The
  // invoice is still issued and downloadable.
  const runWhatsappChannel = async (): Promise<ChannelStatus> => {
    const phone = customerPhone(order);
    if (!phone) return 'disabled';
    if (!whatsappInvoiceEnabled()) return 'disabled';
    if (!invoiceWhatsapp.configured) {
      // Not an error and not a failure — the slot is simply empty.
      await patchChannel(orderId, 'whatsapp', { status: 'not_configured' });
      return 'skipped';
    }

    const existing = await readInvoiceState(orderId);
    // Idempotency: one order sends one invoice. The sent flag + timestamp in
    // state.json is the record; a second trigger reads it and does nothing.
    if (existing?.channels?.whatsapp?.status === 'sent') return 'skipped';

    // Is there an approved invoice template at all?
    //
    // Meta reviews templates asynchronously, so this is a normal, expected
    // state - not a failure. The invoice is still generated and the customer
    // can still download it; the backlog sweep sends it the moment the
    // template is approved. Attempting a send here would burn an attempt and
    // record a scary error for something that is simply waiting.
    const { template: invoiceTemplate, reason: templateReason } = await getInvoiceTemplate();
    if (!invoiceTemplate) {
      await patchChannel(orderId, 'whatsapp', {
        status: 'awaiting_template',
        lastError: null,
        lastAttemptAt: null,
      });
      console.log(
        `[Invoice] order ${order.order_number}: invoice ${invoiceNumber} is waiting for an approved ` +
          `WhatsApp template (${templateReason || 'no approved UTILITY template'}).`,
      );
      return 'skipped';
    }

    const signedUrl = await signedUrlPromise;
    const mode = invoiceWhatsapp.mode === 'link' ? 'link' : 'document';
    const delivered = await withTimeout(
      sendInvoiceTemplate({
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

    await logInvoiceAttempt({
      orderId,
      referenceId: orderId,
      recipient: phone,
      status: delivered ? 'sent' : 'failed',
      error: delivered ? undefined : 'Meta rejected the invoice template message',
      invoiceNumber,
      mode,
    });

    return delivered ? 'sent' : 'failed';
  };

  /* ---- 6. copy to the store owner — best effort ---- */
  const runAdminCopyChannel = async (): Promise<ChannelStatus> => {
    const adminPhone = normalizePhone(config.adminWhatsappNumber);
    if (!adminPhone || !whatsappInvoiceEnabled() || !invoiceWhatsapp.configured) return 'disabled';

    // The store's own number IS the sending number when the admin number is
    // the business line. Meta rejects a message from a number to itself
    // (error 100), so that copy is skipped rather than attempted. The store
    // owner still sees the invoice in the admin panel.
    if (adminPhone === normalizePhone(config.whatsappPhoneNumberId)) {
      console.log(
        '[Invoice] the admin WhatsApp number is the sending number - the copy to the store owner is skipped.',
      );
      return 'skipped';
    }

    const signedUrl = await signedUrlPromise;
    const mode = invoiceWhatsapp.mode === 'link' ? 'link' : 'document';
    const delivered = await withTimeout(
      sendInvoiceTemplate({
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

    await logInvoiceAttempt({
      orderId,
      referenceId: `${orderId}:admin`,
      recipient: adminPhone,
      status: delivered ? 'sent' : 'failed',
      error: delivered ? undefined : 'Meta rejected the invoice template message',
      invoiceNumber,
      mode,
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
  // Without the flag, or without the Meta slot, there is nothing to sweep
  // toward. Returning quietly is the correct behaviour, not a failure.
  if (!whatsappInvoiceEnabled()) return [];
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

    // Waiting for Meta to approve the template. This is not a failure and it
    // must not consume an attempt - BUT only while the template really is
    // still unapproved. The moment it is approved, the invoice has to go out,
    // so the backlog is picked up.
    if (channel?.status === 'awaiting_template') {
      const { template: invoiceTemplate } = await getInvoiceTemplate();
      if (!invoiceTemplate) {
        results.push({
          orderId,
          orderNumber,
          ok: true,
          skipped: true,
          error: 'awaiting an approved WhatsApp template',
        });
        continue;
      }
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
  whatsappInvoiceEnabled,
  MAX_INVOICE_ATTEMPTS,
};
