import { config } from '../config/env';
import { supabase } from '../database/supabase';
import { hasColumn } from './schemaGuard';
import { buildInvoiceNumber, generateInvoicePdf, getOrderForInvoice } from './invoiceService';
import { getInvoiceEmailTemplate, isEmailConfigured, sendEmailWithAttachments } from './emailService';
import {
  WHATSAPP_TEMPLATES,
  getLogEntry,
  isWhatsappConfigured,
  logMessage,
  normalizePhone,
  sendDocumentOnce,
  wasSent,
} from './whatsappService';

const money = (v: any) => `Rs. ${Number(v || 0).toFixed(2)}`;

/**
 * Bound an external call so one stuck provider (Resend, Meta Graph) can never
 * stall the whole post-order callback. Rejects after `ms`; the underlying
 * request is left to finish or time out on its own — the caller just stops
 * waiting and records a failure instead of hanging.
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
  /** True when this call took the order-level claim (or there was no claim column). */
  claimed: boolean;
  /** True when another worker already sent the invoice for this order. */
  skipped: boolean;
  email: ChannelStatus;
  whatsapp: ChannelStatus;
  adminCopy: ChannelStatus;
  invoiceNumber: string;
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
/* Status bookkeeping (every write is guarded by hasColumn)            */
/* ------------------------------------------------------------------ */

/** Atomically claim the order for invoicing. Returns false when already claimed. */
async function claimInvoice(orderId: string): Promise<boolean | 'no-column'> {
  if (!(await hasColumn('orders', 'invoice_sent_at'))) return 'no-column';
  try {
    const { data, error } = await supabase
      .from('orders')
      .update({ invoice_sent_at: new Date().toISOString() })
      .eq('id', orderId)
      .is('invoice_sent_at', null)
      .select('id');
    if (error) {
      console.error('[Invoice] claim failed:', error.message);
      // Degrade to "claimed" so a transient error never blocks a real send;
      // the per-channel message log still dedupes.
      return true;
    }
    return Boolean(data && data.length > 0);
  } catch (err: any) {
    console.error('[Invoice] claim failed:', err?.message || err);
    return true;
  }
}

async function releaseClaim(orderId: string, reason: string): Promise<void> {
  try {
    if (await hasColumn('orders', 'invoice_sent_at')) {
      await supabase.from('orders').update({ invoice_sent_at: null }).eq('id', orderId);
    }
    if (await hasColumn('orders', 'invoice_error')) {
      await supabase.from('orders').update({ invoice_error: reason.slice(0, 500) }).eq('id', orderId);
    }
  } catch (err: any) {
    console.error('[Invoice] failed to release claim:', err?.message || err);
  }
}

async function recordError(orderId: string, reason: string): Promise<void> {
  try {
    if (await hasColumn('orders', 'invoice_error')) {
      await supabase.from('orders').update({ invoice_error: reason.slice(0, 500) }).eq('id', orderId);
    }
  } catch (err: any) {
    console.error('[Invoice] failed to record error:', err?.message || err);
  }
}

async function clearError(orderId: string): Promise<void> {
  try {
    if (await hasColumn('orders', 'invoice_error')) {
      await supabase.from('orders').update({ invoice_error: null }).eq('id', orderId);
    }
  } catch (err: any) {
    console.error('[Invoice] failed to clear error:', err?.message || err);
  }
}

/**
 * Public snapshot used by the admin Orders UI.
 * Works even when delta 010 has not been applied (both columns absent).
 */
export function deriveInvoiceStatus(order: {
  invoice_sent_at?: string | null;
  invoice_error?: string | null;
}): { status: 'sent' | 'failed' | 'not_sent'; sentAt: string | null; error: string | null } {
  const sentAt = order?.invoice_sent_at || null;
  const error = order?.invoice_error || null;
  if (sentAt && !error) return { status: 'sent', sentAt, error: null };
  if (error) return { status: 'failed', sentAt, error };
  if (sentAt) return { status: 'sent', sentAt, error: null };
  return { status: 'not_sent', sentAt: null, error: null };
}

/* ------------------------------------------------------------------ */
/* Storage mirror (private bucket + 7-day signed URL)                  */
/* ------------------------------------------------------------------ */

async function mirrorPdfToStorage(orderNumber: string, pdf: Buffer): Promise<string | null> {
  const bucket = config.invoiceStorageBucket;
  if (!bucket) return null;
  const objectPath = `${orderNumber}/Invoice-${orderNumber}.pdf`;
  const uploadOpts = {
    contentType: 'application/pdf',
    cacheControl: '3600',
    upsert: true,
  } as const;

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
      console.warn(`[Invoice] storage mirror skipped for ${orderNumber}:`, error.message);
      return null;
    }

    const { data, error: signErr } = await supabase.storage
      .from(bucket)
      .createSignedUrl(objectPath, config.invoiceSignedUrlExpirySeconds);
    if (signErr || !data?.signedUrl) {
      console.warn(`[Invoice] signed URL failed for ${orderNumber}:`, signErr?.message || 'no url');
      return null;
    }
    return data.signedUrl;
  } catch (err: any) {
    console.warn(`[Invoice] storage mirror failed for ${orderNumber}:`, err?.message || err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

/**
 * Generate + deliver the invoice for one order.
 *
 * Idempotency, in order of strength:
 *   1. Atomic `UPDATE orders SET invoice_sent_at = now() WHERE invoice_sent_at
 *      IS NULL` — exactly one of N parallel PayU webhooks can win (delta 010).
 *   2. `whatsapp_message_log` UNIQUE(purpose, reference_id) per channel, which
 *      still dedupes when delta 010 has not been applied.
 *
 * The two channels are independent: if only a phone exists the WhatsApp copy
 * goes out, if only an email exists the mail goes out, and if neither exists
 * the failure reason is recorded on the order.
 */
export async function sendInvoiceDispatch(
  orderId: string,
  options: { force?: boolean } = {}
): Promise<InvoiceDispatchResult> {
  const force = options.force === true;
  const order: any = await getOrderForInvoice(orderId);
  const invoiceNumber = buildInvoiceNumber(order.order_number);

  const result: InvoiceDispatchResult = {
    claimed: true,
    skipped: false,
    email: 'disabled',
    whatsapp: 'disabled',
    adminCopy: 'disabled',
    invoiceNumber,
  };

  /* ---- 1. order-level atomic claim ---- */
  if (!force) {
    const claim = await claimInvoice(orderId);
    if (claim === 'no-column') {
      // Delta 010 not applied: there is no atomic invoice_sent_at claim. The
      // whatsapp_message_log fallback below is check-then-act (read the log, then
      // send), which is NOT race-safe — two parallel PayU webhooks could both see
      // "not sent" and both dispatch. Rather than risk a duplicate invoice, skip
      // the AUTO send until the column exists. force=true (admin Resend button)
      // bypasses this whole block and still works.
      const reason = 'auto-send skipped: needs delta 010 (orders.invoice_sent_at)';
      console.warn(`[Invoice] ${reason} — order ${orderId}`);
      result.skipped = true;
      result.claimed = false;
      result.reason = reason;
      result.email = 'skipped';
      result.whatsapp = 'skipped';
      return result;
    } else if (claim === false) {
      result.skipped = true;
      result.claimed = false;
      result.email = 'skipped';
      result.whatsapp = 'skipped';
      return result;
    } else {
      result.claimed = true;
    }
  }

  /* ---- 2. PDF ---- */
  let pdf: Buffer;
  try {
    pdf = await generateInvoicePdf(order);
  } catch (err: any) {
    const reason = `PDF generation failed: ${err?.message || err}`;
    if (!force && result.claimed) await releaseClaim(orderId, reason);
    else await recordError(orderId, reason);
    result.reason = reason;
    return result;
  }

  const filename = `Invoice-${order.order_number}.pdf`;

  // Storage mirror starts now and runs concurrently with the three delivery
  // channels below. Each channel awaits this same shared promise for the signed
  // URL (embedded in the message when available); a slow/failed storage call only
  // omits the link — it never blocks or fails a delivery.
  const signedUrlPromise = mirrorPdfToStorage(order.order_number, pdf).catch(() => null);

  /* ---- 3. email channel (parallel) ---- */
  const runEmailChannel = async (): Promise<ChannelStatus> => {
    const toEmail = customerEmail(order);
    const emailRef = `${EMAIL_PURPOSE}:${orderId}`;
    if (!toEmail) return 'disabled';
    if (!isEmailConfigured()) {
      console.warn('[Invoice] no customer email on the order / Resend not configured — skipping email.');
      return 'disabled';
    }
    if (!force && (await wasSent(EMAIL_PURPOSE, emailRef))) return 'skipped';

    const signedUrl = await signedUrlPromise;
    const subject = `Your MeruVeda order #${order.order_number} invoice`;
    const html = getInvoiceEmailTemplate({
      firstName: customerFirstName(order),
      orderNumber: order.order_number,
      invoiceNumber,
      total: money(order.total),
      signedUrl,
    });
    const delivered = await withTimeout(
      sendEmailWithAttachments({
        to: toEmail,
        subject,
        html,
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
      referenceId: force ? `${emailRef}:resent:${Date.now()}` : emailRef,
      status: delivered ? 'sent' : 'failed',
      error: delivered ? undefined : 'Email delivery failed (Resend rejected, API key missing, or timed out)',
      payload: { order_number: order.order_number, invoice_number: invoiceNumber },
    });
    return delivered ? 'sent' : 'failed';
  };

  /* ---- 4. WhatsApp channel — document first, approved template as fallback (parallel) ---- */
  const runWhatsappChannel = async (): Promise<ChannelStatus> => {
    const phone = customerPhone(order);
    if (!phone) return 'disabled';
    if (!isWhatsappConfigured()) return 'disabled';

    const signedUrl = await signedUrlPromise;
    const whatsRef = force
      ? `${WHATSAPP_PURPOSE}:${orderId}:resent:${Date.now()}`
      : `${WHATSAPP_PURPOSE}:${orderId}`;
    const delivered = await withTimeout(
      sendDocumentOnce({
        to: phone,
        purpose: WHATSAPP_PURPOSE,
        referenceId: whatsRef,
        base64: pdf.toString('base64'),
        filename,
        caption:
          `Tax invoice ${invoiceNumber} for MeruVeda order ${order.order_number} — ${money(order.total)}` +
          (signedUrl ? `\nOpen (7 days): ${signedUrl}` : ''),
        fallback: {
          template: WHATSAPP_TEMPLATES.INVOICE_SHARED,
          params: [order.order_number, money(order.total)],
        },
        payload: { order_number: order.order_number, invoice_number: invoiceNumber, resent: force },
      }),
      CHANNEL_TIMEOUT_MS,
      'whatsapp send'
    ).catch((err: any) => {
      console.error('[Invoice] whatsapp send failed:', err?.message || err);
      return false;
    });
    return delivered ? 'sent' : 'failed';
  };

  /* ---- 5. copy to the store owner — best effort, never blocks success (parallel) ---- */
  const runAdminCopyChannel = async (): Promise<ChannelStatus> => {
    const adminPhone = normalizePhone(config.adminWhatsappNumber);
    if (!adminPhone || !isWhatsappConfigured()) return 'disabled';

    const signedUrl = await signedUrlPromise;
    const delivered = await withTimeout(
      sendDocumentOnce({
        to: adminPhone,
        purpose: ADMIN_PURPOSE,
        referenceId: force
          ? `${ADMIN_PURPOSE}:${orderId}:resent:${Date.now()}`
          : `${ADMIN_PURPOSE}:${orderId}`,
        base64: pdf.toString('base64'),
        filename,
        caption: `Invoice ${invoiceNumber} — order ${order.order_number} — ${money(order.total)}` +
          (signedUrl ? `\nOpen (7 days): ${signedUrl}` : ''),
        fallback: {
          template: WHATSAPP_TEMPLATES.INVOICE_SHARED,
          params: [order.order_number, money(order.total)],
        },
        payload: { order_number: order.order_number, recipient: 'admin', resent: force },
      }),
      CHANNEL_TIMEOUT_MS,
      'admin whatsapp copy'
    ).catch((err: any) => {
      console.error('[Invoice] admin copy failed:', err?.message || err);
      return false;
    });
    return delivered ? 'sent' : 'failed';
  };

  // Run the three delivery channels (and the storage mirror they share) together.
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

  /* ---- 6. finalise ---- */
  const anyDelivered = result.email === 'sent' || result.whatsapp === 'sent';
  const anyChannelTried = result.email !== 'disabled' || result.whatsapp !== 'disabled';

  if (anyDelivered) {
    await clearError(orderId);
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
  if (!force && result.claimed) {
    // Release the claim so the daily retry cron can pick it up again.
    await releaseClaim(orderId, reason);
  } else {
    await recordError(orderId, reason);
  }
  return result;
}

/** Convenience wrapper used by postOrderConfirmed. Never throws. */
export async function sendInvoiceAuto(orderId: string): Promise<InvoiceDispatchResult> {
  return sendInvoiceDispatch(orderId, { force: false });
}

/**
 * Admin/owner "Resend invoice" — bypasses the order-level claim and the
 * per-channel dedupe so the customer really receives it again. The message log
 * keeps a separate `*:resent:<ts>` reference and `resent: true` payload.
 */
export async function resendInvoiceDispatch(orderId: string): Promise<InvoiceDispatchResult> {
  return sendInvoiceDispatch(orderId, { force: true });
}

/**
 * Read the delivery outcome straight from the message log — used by the daily
 * retry cron to decide whether an order still needs an invoice.
 */
export async function invoiceAlreadyLogged(orderId: string): Promise<boolean> {
  const w = await getLogEntry(WHATSAPP_PURPOSE, `${WHATSAPP_PURPOSE}:${orderId}`);
  const e = await getLogEntry(EMAIL_PURPOSE, `${EMAIL_PURPOSE}:${orderId}`);
  return Boolean((w && w.status === 'sent') || (e && e.status === 'sent'));
}

/**
 * Daily retry sweep for invoices that never went out (channel outage, missing
 * email at the time, Resend quota, WhatsApp template rejection...).
 *
 * Only the last 14 days are considered and a 10-minute minimum age is enforced
 * so the sweep can never race the live post-confirmation dispatch.
 */
export async function retryPendingInvoices(limit = 15): Promise<
  Array<{ orderId: string; orderNumber: string; ok: boolean; skipped?: boolean; error?: string }>
> {
  const now = Date.now();
  const tooYoung = new Date(now - 10 * 60 * 1000).toISOString();
  const tooOld = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

  const hasSentAt = await hasColumn('orders', 'invoice_sent_at');
  const hasErrorCol = await hasColumn('orders', 'invoice_error');
  const selectCols = [
    'id',
    'order_number',
    'status',
    'payment_status',
    'payment_method',
    'created_at',
    hasSentAt ? 'invoice_sent_at' : '',
    hasErrorCol ? 'invoice_error' : '',
  ]
    .filter(Boolean)
    .join(', ');

  let query = supabase
    .from('orders')
    .select(selectCols)
    .lt('created_at', tooYoung)
    .gt('created_at', tooOld)
    .in('status', ['processing', 'confirmed', 'pending', 'packed', 'shipped'])
    .order('created_at', { ascending: true })
    .limit(limit);
  if (hasSentAt) query = query.is('invoice_sent_at', null);

  const { data: rows, error } = await query;
  if (error) {
    console.error('[Invoice] retry sweep query failed:', error.message);
    return [];
  }

  const results: Array<{ orderId: string; orderNumber: string; ok: boolean; skipped?: boolean; error?: string }> = [];
  for (const row of (rows || []) as any[]) {
    // Never ship an invoice for an order that has not been paid (COD excepted).
    const method = String(row.payment_method || '').toUpperCase();
    const isCOD = method.includes('COD') || method.includes('CASH');
    if (!isCOD && row.payment_status !== 'paid') continue;
    if (await invoiceAlreadyLogged(row.id)) {
      results.push({ orderId: row.id, orderNumber: row.order_number, ok: true, skipped: true });
      continue;
    }
    try {
      const dispatch = await sendInvoiceDispatch(row.id, { force: false });
      results.push({
        orderId: row.id,
        orderNumber: row.order_number,
        ok: !dispatch.reason,
        skipped: dispatch.skipped,
        error: dispatch.reason,
      });
    } catch (err: any) {
      results.push({ orderId: row.id, orderNumber: row.order_number, ok: false, error: err?.message || 'send failed' });
    }
  }
  return results;
}

export const invoiceDispatchService = {
  sendInvoiceDispatch,
  sendInvoiceAuto,
  resendInvoiceDispatch,
  deriveInvoiceStatus,
  invoiceAlreadyLogged,
  retryPendingInvoices,
};
