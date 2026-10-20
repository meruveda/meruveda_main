import { config } from '../config/env';
import * as ordersRepo from '../database/repos/orders';
import { hasColumn } from './schemaGuard';
import { orderNotifyService } from './orderNotifyService';
import { invoiceDispatchService } from './invoiceDispatchService';
import { recordInvoiceError } from './invoiceService';
import { pushOrderToShiprocket } from './orderService';

export type PostOrderSource = 'payu_success' | 'cod_placement' | 'order_placement';

export interface PostOrderConfirmedResult {
  invoice: { ok: boolean; skipped?: boolean; reason?: string };
  shiprocket: { ok: boolean; skipped?: boolean; reason?: string };
}

/**
 * True when the order is paid on delivery (no payment callback exists).
 *
 * The stored value is the storefront's 'Cash On Delivery', not 'cod' — the old
 * exact match against 'cod' was therefore always false in production, which is
 * why the COD order-confirmation text was never sent.
 *
 * Exact set membership after trimming and lowercasing, never a substring match,
 * so 'cashfree' is not COD. Keep this list in step with invoiceService.isCodOrder.
 */
const COD_PAYMENT_METHODS = new Set(['cod', 'cash on delivery', 'cash_on_delivery']);

export function isCodOrder(order: any): boolean {
  return COD_PAYMENT_METHODS.has(String(order?.payment_method || '').trim().toLowerCase());
}

/**
 * Is this order genuinely billable RIGHT NOW?
 *
 * Always true for an order that exists. There is no longer any payment gating:
 * the invoice is issued at ORDER CREATION for every order, COD and prepaid
 * alike, because a tax invoice documents the sale and the sale has already
 * happened. The PayU callback only records payment — it never issues, so it
 * cannot produce a second invoice for the same order.
 */
export function isInvoiceEligible(order: any, _source?: PostOrderSource): boolean {
  return Boolean(order);
}

/**
 * Should this trigger issue the invoice, honouring the WHATSAPP_INVOICE_ENABLED
 * flag?
 *
 * Flag OFF (the default): exactly the previous behaviour. COD placement issues,
 * the PayU callback does not.
 *
 * Flag ON: the PayU success callback ALSO issues, because that is the moment
 * payment is confirmed — the one moment an invoice for a prepaid order may
 * legitimately be sent. The dispatcher's atomic claim still guarantees one
 * invoice per order, so a duplicate callback cannot double-issue.
 *
 * This lives here rather than at the PayU call site so the callback controller
 * is not modified at all.
 */
export function shouldIssueInvoice(
  requested: boolean,
  order: any,
  source: PostOrderSource
): boolean {
  if (requested) return true;
  if (source !== 'payu_success') return false;
  if (!invoiceDispatchService.whatsappInvoiceEnabled()) return false;
  // Only once the money is actually confirmed recorded on the order row.
  return String(order?.payment_status || '').trim().toLowerCase() === 'paid';
}

/* ------------------------------------------------------------------ */
/* Failure bookkeeping — never throws, never blocks the order flow     */
/* ------------------------------------------------------------------ */

async function saveInvoiceError(orderId: string, message: string): Promise<void> {
  // Invoice bookkeeping lives in state.json, not in an orders column.
  await recordInvoiceError(orderId, message);
}

async function saveShiprocketError(orderId: string, message: string): Promise<void> {
  try {
    if (await hasColumn('orders', 'shiprocket_push_error')) {
      await ordersRepo.updateOrderById(orderId, {
        shiprocket_push_error: message.slice(0, 500),
        ...(await hasColumn('orders', 'shiprocket_push_status'))
          ? { shiprocket_push_status: 'failed' }
          : {},
      });
    }
  } catch (err: any) {
    console.error('[PostOrder] could not persist shiprocket_push_error:', err?.message || err);
  }
}

/* ------------------------------------------------------------------ */
/* The single post-confirmation hook                                   */
/* ------------------------------------------------------------------ */

/**
 * Runs the two background jobs that must happen once an order is confirmed:
 *   1. invoice generation + delivery
 *   2. Shiprocket push
 *
 * Call sites (ONLY these — do not duplicate the logic anywhere else):
 *   - PayU success callback, AFTER the hash and amount have been verified and
 *     the order row has been flipped to paid/processing
 *   - COD order placement, AFTER the order row is created
 *
 * Guarantees:
 *   - Each job has its own try/catch: one failing never stops the other.
 *   - This function NEVER rejects, so payment/order flow can never fail
 *     because of it. Errors are logged and saved onto the order row for the
 *     admin retry UI.
 *   - The invoice path is invoiceDispatchService and nothing else; the old
 *     WhatsApp-only branch has been removed.
 *   - The returned promise IS the background work, so `keepAlive()` (and hence
 *     Vercel's `waitUntil`) holds the real work open. Callers still do not
 *     await it — the customer's checkout response is never delayed.
 */
export function postOrderConfirmed(
  orderId: string,
  { source, wait = false, invoice = true }: { source: PostOrderSource; wait?: boolean; invoice?: boolean }
): Promise<PostOrderConfirmedResult> {
  const work = (async (): Promise<PostOrderConfirmedResult> => {
    const result: PostOrderConfirmedResult = {
      invoice: { ok: false },
      shiprocket: { ok: false },
    };

    const invoiceJob = (async () => {
      try {
        const order = await ordersRepo.getOrderRow(orderId);

        const issue = shouldIssueInvoice(invoice, order, source);

        if (!issue) {
          result.invoice = {
            ok: true,
            skipped: true,
            reason: 'invoice already issued at order creation',
          };
        } else if (!isInvoiceEligible(order, source)) {
          result.invoice = { ok: true, skipped: true, reason: 'order not found' };
        } else {
          const dispatch = await invoiceDispatchService.sendInvoiceAuto(orderId);
          result.invoice = {
            ok: !dispatch.reason,
            skipped: dispatch.skipped,
            reason: dispatch.reason,
          };
          if (dispatch.reason) {
            console.error(`[PostOrder] invoice dispatch failed for ${orderId}: ${dispatch.reason}`);
          }
        }
      } catch (err: any) {
        const message = err?.message || String(err);
        console.error(`[PostOrder] invoice step failed for ${orderId} (${source}):`, message);
        await saveInvoiceError(orderId, message);
        result.invoice = { ok: false, reason: message };
      }
    })();

    const shiprocketJob = (async () => {
      try {
        // Two independent triggers decide whether this order is pushed — this
        // block is deliberately UNCHANGED from the pre-invoice implementation
        // so Shiprocket behaviour is not altered by this work.
        //
        //   legacyTrigger — the PRE-EXISTING behaviour. A PayU success callback
        //     and testMode both push unconditionally, column or no column.
        //   autoTriggerOnly — the NEW path where SHIPROCKET_AUTO_PUSH alone is
        //     asking for a push (i.e. not a PayU callback, not testMode).
        const legacyTrigger = source !== 'order_placement' || config.shiprocketTestMode;
        const autoTriggerOnly = config.shiprocketAutoPush && !legacyTrigger;

        if (legacyTrigger) {
          await pushOrderToShiprocket(orderId);
          result.shiprocket = { ok: true };
        } else if (autoTriggerOnly) {
          if (!(await hasColumn('orders', 'shiprocket_push_status'))) {
            // Delta 010 not applied: the atomic in_progress claim cannot
            // serialise the outbound Shiprocket create call, so two parallel
            // auto-triggers could create two shipments. Skip the AUTO push to
            // guarantee no double push.
            result.shiprocket = {
              ok: true,
              skipped: true,
              reason: 'auto-push skipped: needs delta 010 (orders.shiprocket_push_status)',
            };
          } else {
            await pushOrderToShiprocket(orderId);
            result.shiprocket = { ok: true };
          }
        } else {
          result.shiprocket = { ok: true, skipped: true, reason: 'SHIPROCKET_AUTO_PUSH is off' };
        }
      } catch (err: any) {
        const message = err?.message || String(err);
        console.error(`[PostOrder] shiprocket step failed for ${orderId}:`, message);
        await saveShiprocketError(orderId, message);
        result.shiprocket = { ok: false, reason: message };
      }
    })();

    await Promise.allSettled([invoiceJob, shiprocketJob]);
    return result;
  })();

  // BUG FIXED HERE — this is why the 2026-10-16 COD orders never got an invoice.
  //
  // This used to return `Promise.resolve({...})` immediately and run the real
  // work on a detached `void work.catch(...)`. Every caller wraps this in
  // `keepAlive(postOrderConfirmed(...))`, and `keepAlive` hands its argument to
  // Vercel's `waitUntil()`. So waitUntil was registering an ALREADY-SETTLED
  // promise: the actual invoice dispatch was never registered with the
  // invocation, and Vercel froze the function as soon as the 201 / redirect
  // flushed. The PDF render died mid-flight with no state.json, no claim, no
  // error recorded anywhere — exactly the signature those orders have.
  //
  // Returning `work` costs nothing to either caller: neither `await`s it, and
  // `keepAlive` never blocks the response. It only means the real work is what
  // waitUntil now holds open.
  void work.catch((err: any) => {
    console.error('[PostOrder] post-confirmation work failed:', err?.message || err);
  });
  return work;
}

/**
 * Order confirmation WhatsApp (text only). The invoice document used to be sent
 * from here too — that produced a second, divergent invoice path. It now lives
 * solely in invoiceDispatchService; this helper only sends the confirmation
 * text so the customer still gets an immediate acknowledgement.
 */
export async function sendOrderConfirmationText(order: any): Promise<void> {
  try {
    await orderNotifyService.sendOrderConfirmation(order);
  } catch (err: any) {
    console.error('[PostOrder] order confirmation text failed:', err?.message || err);
  }
}

export const postOrderService = { postOrderConfirmed };