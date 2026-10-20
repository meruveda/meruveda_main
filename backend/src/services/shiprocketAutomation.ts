/**
 * Shiprocket + invoice automation state.
 *
 * One place that answers "what is happening to this order?" so the admin
 * order list, the admin order detail, the customer tracking page and the
 * sweep all agree. The labels are deliberately free of the word "Pending"
 * outside the fulfilment column, where it is the actual lifecycle state.
 */
import { config } from '../config/env';
import * as ordersRepo from '../database/repos/orders';
import * as trackingRepo from '../database/repos/tracking';
import { hasColumn } from './schemaGuard';
import { normalizePhone } from './whatsappService';
import { shiprocketTrackingService } from './shiprocket/tracking.service';
import { shiprocketWebhookService } from './shiprocket/webhook.service';
import { sendText } from './whatsappService';

/**
 * Orders created before the automation went live are shown as
 * "Placed before automation" and are never auto-pushed or auto-invoiced:
 * retro-firing shipments and tax invoices for historical orders would be
 * wrong, and the store owner can still act on them by hand.
 */
export const AUTOMATION_GO_LIVE = '2026-10-17T00:00:00.000Z';

/** Push attempt schedule: immediate, 5m, 15m, 1h, 6h, 24h. */
export const PUSH_BACKOFF_MINUTES = [0, 5, 15, 60, 360, 1440];
export const MAX_PUSH_ATTEMPTS = 8;

/** Short, human-readable reason for a push failure. */
export function shortReason(reason?: string | null): string {
  const text = String(reason || '').trim();
  if (!text) return 'Unknown error';
  // Meta/Shiprocket messages can be long; the admin only needs the gist.
  const firstLine = text.split('\n')[0].replace(/^Error:\s*/i, '').trim();
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

export interface ShiprocketState {
  label: string;
  tone: 'ok' | 'warn' | 'error' | 'muted' | 'info';
  /** Attempt number for the "Attempt n/8" suffix. */
  attempt?: number;
  maxAttempts?: number;
  /** ISO timestamp of the next automatic retry, when one is scheduled. */
  nextAttemptAt?: string | null;
  /** True when the order will never be pushed (deliberate skip). */
  skipped?: boolean;
  reason?: string;
}

export interface InvoiceState {
  label: string;
  tone: 'ok' | 'warn' | 'error' | 'muted' | 'info';
  invoiceNumber?: string | null;
  sentAt?: string | null;
  error?: string | null;
}

export interface PaymentState {
  label: string;
  tone: 'ok' | 'warn' | 'error' | 'muted' | 'info';
}

/** True when the order predates the automation and must not be auto-processed. */
export function isPreAutomationOrder(order: any): boolean {
  if (!order) return false;
  const createdAt = order.created_at ? new Date(order.created_at).getTime() : NaN;
  if (Number.isNaN(createdAt)) return false;
  return createdAt < new Date(AUTOMATION_GO_LIVE).getTime();
}

/**
 * The fulfilment label.
 *
 * The value is always one of the statuses the orders table already uses, so
 * nothing new has to be added to the column's domain.
 */
export function fulfillmentState(order: any): { label: string; tone: ShiprocketState['tone'] } {
  const status = String(order?.status || '').trim().toLowerCase();
  switch (status) {
    case 'pending':
      return { label: 'Pending', tone: 'warn' };
    case 'processing':
      return { label: 'Processing', tone: 'info' };
    case 'shipped':
      return { label: 'Shipped', tone: 'info' };
    case 'delivered':
      return { label: 'Delivered', tone: 'ok' };
    case 'cancelled':
    case 'canceled':
      return { label: 'Cancelled', tone: 'muted' };
    case 'returned':
      return { label: 'Returned', tone: 'muted' };
    default:
      return { label: status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown', tone: 'muted' };
  }
}

/**
 * The payment label.
 *
 * Cash on delivery is "To collect" until the parcel is delivered, and only
 * becomes "Collected" afterwards. Prepaid orders follow the recorded
 * payment_status.
 */
export function paymentState(order: any): PaymentState {
  const method = String(order?.payment_method || '').trim().toLowerCase();
  const isCod = method.includes('cod') || method.includes('cash');
  if (isCod) {
    const status = String(order?.status || '').trim().toLowerCase();
    if (status === 'delivered') return { label: 'Cash on delivery · Collected', tone: 'ok' };
    return { label: 'Cash on delivery · To collect', tone: 'warn' };
  }
  const status = String(order?.payment_status || '').trim().toLowerCase();
  if (status === 'paid') return { label: 'Paid', tone: 'ok' };
  if (status === 'failed') return { label: 'Payment failed', tone: 'error' };
  return { label: 'Payment pending', tone: 'warn' };
}

/**
 * The Shiprocket label.
 *
 * Covers every state the pipeline can be in, from "we are waiting for the
 * customer to pay" through to a delivered AWB.
 */
export function shiprocketState(order: any): ShiprocketState {
  const attempt = Number(order?.shiprocket_push_attempts || 0);

  if (isPreAutomationOrder(order)) {
    return { label: 'Placed before automation', tone: 'muted' };
  }

  // A deliberate skip is final and is never retried.
  if (order?.shiprocket_push_skipped) {
    return {
      label: `Skipped – ${order.shiprocket_push_skipped_reason || 'no Indian delivery contact'}`,
      tone: 'muted',
      skipped: true,
      reason: order.shiprocket_push_skipped_reason,
    };
  }

  const fulfilment = String(order?.status || '').trim().toLowerCase();
  if (fulfilment === 'cancelled' || fulfilment === 'canceled') {
    return { label: 'Cancelled', tone: 'muted' };
  }

  // An AWB is the strongest signal that the parcel is out.
  if (order?.awb_code) {
    const courier = order?.courier_name ? ` · ${order.courier_name}` : '';
    return { label: `AWB ${order.awb_code}${courier}`, tone: 'ok' };
  }

  if (order?.shiprocket_order_id) {
    return { label: `Pushed #${order.shiprocket_order_id}`, tone: 'ok' };
  }

  const pushStatus = String(order?.shiprocket_push_status || '').trim().toLowerCase();

  if (pushStatus === 'in_progress') {
    return { label: 'Pushing...', tone: 'info' };
  }

  if (pushStatus === 'failed') {
    const next = order?.shiprocket_push_next_attempt_at
      ? new Date(order.shiprocket_push_next_attempt_at).toISOString()
      : null;
    const attemptSuffix = `Attempt ${attempt}/${MAX_PUSH_ATTEMPTS}`;
    const retrySuffix = next ? ` · Auto-retry ${next}` : '';
    return {
      label: `Failed ${shortReason(order?.shiprocket_push_error)}${attemptSuffix}${retrySuffix}`,
      tone: 'error',
      attempt,
      maxAttempts: MAX_PUSH_ATTEMPTS,
      nextAttemptAt: next,
      reason: order?.shiprocket_push_error,
    };
  }

  // Not pushed yet. Is the order even eligible to ship?
  const method = String(order?.payment_method || '').trim().toLowerCase();
  const isCod = method.includes('cod') || method.includes('cash');
  const paid = String(order?.payment_status || '').trim().toLowerCase() === 'paid';
  if (!isCod && !paid) {
    return { label: 'Awaiting payment', tone: 'muted' };
  }

  return { label: 'Queued', tone: 'info' };
}

/**
 * The invoice label.
 *
 * "Awaiting WhatsApp template" is a real, expected state: Meta reviews the
 * invoice template asynchronously, and until it is approved the invoice
 * exists (and is downloadable by the customer) but cannot be sent.
 */
export function invoiceState(order: any, opts: { whatsappTemplateReady?: boolean } = {}): InvoiceState {
  const invoiceNumber = order?.invoice_number || null;
  const sentAt = order?.invoice_sent_at || null;
  const error = order?.invoice_error || null;

  if (sentAt) {
    return {
      label: `Sent on WhatsApp · ${new Date(sentAt).toISOString().slice(0, 16).replace('T', ' ')}`,
      tone: 'ok',
      invoiceNumber,
      sentAt,
    };
  }
  if (invoiceNumber) {
    if (error) {
      return { label: `Failed ${shortReason(error)}`, tone: 'error', invoiceNumber, error };
    }
    if (opts.whatsappTemplateReady === false) {
      return {
        label: `Generated · ${invoiceNumber} · awaiting WhatsApp template`,
        tone: 'warn',
        invoiceNumber,
      };
    }
    return { label: `Generated · ${invoiceNumber}`, tone: 'info', invoiceNumber };
  }
  if (error) {
    return { label: `Failed ${shortReason(error)}`, tone: 'error', error };
  }
  return { label: 'Not generated', tone: 'muted' };
}

/** The "phone unverified" badge. */
export function phoneVerifiedBadge(order: any): { show: boolean; label: string } {
  if (order?.phone_verified === true) return { show: false, label: '' };
  if (order?.phone_verified === false) {
    return { show: true, label: 'Phone unverified' };
  }
  // NULL: the order predates phone verification, or it was never checked.
  if (isPreAutomationOrder(order)) return { show: false, label: '' };
  return { show: true, label: 'Phone unverified' };
}

/**
 * When the next push attempt may run, for the given attempt count.
 * Returns null when the order has exhausted its attempts.
 */
export function nextAttemptAt(attempts: number, from = new Date()): string | null {
  if (attempts >= MAX_PUSH_ATTEMPTS) return null;
  const index = Math.min(attempts, PUSH_BACKOFF_MINUTES.length - 1);
  const minutes = PUSH_BACKOFF_MINUTES[index];
  return new Date(from.getTime() + minutes * 60 * 1000).toISOString();
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

/**
 * Append a timeline event to the order.
 *
 * The order_tracking_history table doubles as the order timeline: order
 * placed, invoice generated, pushed, AWB, shipped, delivered and every
 * failure are all rows in it, in order.
 */
export async function recordTimelineEvent(
  orderId: string,
  activity: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await trackingRepo.insertHistory({
      order_id: orderId,
      tracking_status: String(payload.status || activity),
      activity,
      raw_payload: payload,
    });
  } catch (err: any) {
    // A timeline row is nice-to-have; it must never break the pipeline.
    console.error('[Automation] could not record timeline event:', err?.message || err);
  }
}

/* ------------------------------------------------------------------ */
/* Admin alert                                                         */
/* ------------------------------------------------------------------ */

/**
 * Tell the store owner that a push has failed for good.
 *
 * Sent exactly once per order: the `shiprocket_admin_alerted_at` stamp is
 * written with a conditional UPDATE, so a concurrent sweep cannot double
 * alert. The alert is a plain WhatsApp text message (no template needed, so
 * it works before any template is approved) and is never sent in dry-run mode.
 */
export async function alertAdminOfTerminalFailure(order: any, reason: string): Promise<boolean> {
  const adminNumber = normalizePhone(config.adminWhatsappNumber);
  if (!adminNumber) return false;
  if (config.whatsappDryRun) return false;
  if (!isWhatsappConfiguredForText()) return false;

  // Claim the alert slot first: a conditional UPDATE means only one caller
  // ever gets to send.
  let claimed = false;
  try {
    if (await hasColumn('orders', 'shiprocket_admin_alerted_at')) {
      const at = new Date().toISOString();
      const res = await ordersRepo.claimAdminAlert(order.id, at);
      claimed = Boolean(res);
    } else {
      claimed = true;
    }
  } catch (err: any) {
    console.error('[Automation] could not claim the admin alert slot:', err?.message || err);
    return false;
  }
  if (!claimed) return false;

  const text =
    `MeruVeda alert: Shiprocket push failed for order ${order.order_number} ` +
    `after ${MAX_PUSH_ATTEMPTS} attempts.\nReason: ${shortReason(reason)}\n` +
    `Please push it manually from the admin panel.`;

  try {
    const delivered = await sendText(adminNumber, text);
    if (!delivered) {
      console.error(`[Automation] admin alert for ${order.order_number} could not be delivered.`);
    }
    return delivered;
  } catch (err: any) {
    console.error('[Automation] admin alert failed:', err?.message || err);
    return false;
  }
}

function isWhatsappConfiguredForText(): boolean {
  return Boolean(config.whatsappApiToken && config.whatsappPhoneNumberId);
}

/* ------------------------------------------------------------------ */
/* Decorating an order for the admin UI                                 */
/* ------------------------------------------------------------------ */

/**
 * Attach every admin-facing state to an order.
 *
 * The admin panel renders these labels instead of the raw database values, so
 * "Pending" only ever appears where it is the real fulfilment state, and
 * every other column says exactly what is happening.
 */
export function decorateOrderForAdmin(order: any, opts: { whatsappTemplateReady?: boolean } = {}): any {
  if (!order) return order;
  const fulfilment = fulfillmentState(order);
  const payment = paymentState(order);
  const shiprocket = shiprocketState(order);
  const invoice = invoiceState(order, opts);
  const phone = phoneVerifiedBadge(order);

  return {
    ...order,
    automation: {
      fulfilment: { label: fulfilment.label, tone: fulfilment.tone },
      payment: { label: payment.label, tone: payment.tone },
      shiprocket: {
        label: shiprocket.label,
        tone: shiprocket.tone,
        attempt: shiprocket.attempt,
        maxAttempts: shiprocket.maxAttempts,
        nextAttemptAt: shiprocket.nextAttemptAt,
        skipped: shiprocket.skipped,
        reason: shiprocket.reason,
      },
      invoice: {
        label: invoice.label,
        tone: invoice.tone,
        invoiceNumber: invoice.invoiceNumber,
        sentAt: invoice.sentAt,
        error: invoice.error,
      },
      phoneUnverified: phone.show,
      phoneUnverifiedLabel: phone.label,
      preAutomation: isPreAutomationOrder(order),
    },
  };
}

/** Decorate a list of orders. */
export function decorateOrdersForAdmin(
  orders: any[],
  opts: { whatsappTemplateReady?: boolean } = {},
): any[] {
  return (orders || []).map((o) => decorateOrderForAdmin(o, opts));
}

/* ------------------------------------------------------------------ */
/* Tracking poll                                                       */
/* ------------------------------------------------------------------ */

export interface TrackingPollResult {
  polled: number;
  updated: number;
  results: Array<{ orderId: string; orderNumber: string; status?: string; error?: string }>;
}

/**
 * Poll Shiprocket for the tracking of pushed-but-not-delivered orders.
 *
 * Shiprocket pushes status changes by webhook, but a webhook can be missed
 * (a courier that never calls back, a downtime on their side, a webhook URL
 * that was not registered yet). Polling keeps the admin list honest without
 * any external cron.
 */
export async function pollShiprocketTracking(limit = 20): Promise<TrackingPollResult> {
  const out: TrackingPollResult = { polled: 0, updated: 0, results: [] };

  const candidates = await ordersRepo.trackingPollCandidates(limit);
  for (const order of candidates) {
    out.polled++;
    const awb = String(order.awb_code || '').trim();
    if (!awb) {
      out.results.push({ orderId: order.id, orderNumber: order.order_number, error: 'no AWB yet' });
      continue;
    }
    try {
      const response = await shiprocketTrackingService.trackAwb(awb);
      const status = extractTrackingStatus(response);
      if (status) {
        await shiprocketWebhookService.processWebhook({
          awb,
          current_status: status,
          shipment_date: undefined,
          event_timestamp: undefined,
        } as any);
        out.updated++;
        out.results.push({ orderId: order.id, orderNumber: order.order_number, status });
      } else {
        out.results.push({ orderId: order.id, orderNumber: order.order_number, error: 'no status in response' });
      }
    } catch (err: any) {
      out.results.push({
        orderId: order.id,
        orderNumber: order.order_number,
        error: shortReason(err?.message || String(err)),
      });
    } finally {
      try {
        await ordersRepo.touchTrackingPolled(order.id);
      } catch {
        // Best effort: a missed stamp only means one extra poll later.
      }
    }
  }
  return out;
}

/** Pull the current status out of a Shiprocket tracking response. */
export function extractTrackingStatus(response: any): string | null {
  const candidates = [
    response?.tracking_data?.[0]?.current_status,
    response?.tracking_data?.[0]?.status,
    response?.response?.tracking_data?.[0]?.current_status,
    response?.data?.tracking_data?.[0]?.current_status,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}
