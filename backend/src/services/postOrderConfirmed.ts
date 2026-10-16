import { config } from '../config/env';
import { supabase } from '../database/supabase';
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

/** True when the order is paid on delivery (no payment callback exists). */
export function isCodOrder(order: any): boolean {
  // Exact stored value, case-insensitive — not a substring match, which used to
  // classify any method containing "cash" (e.g. "cashfree") as COD.
  return String(order?.payment_method || '').trim().toLowerCase() === 'cod';
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
      await supabase
        .from('orders')
        .update({
          shiprocket_push_error: message.slice(0, 500),
          ...(await hasColumn('orders', 'shiprocket_push_status'))
            ? { shiprocket_push_status: 'failed' }
            : {},
        })
        .eq('id', orderId);
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
 *   - It returns as soon as the jobs are KICKED OFF, not when they finish.
 *     Callers that must not block (the PayU browser redirect) rely on that:
 *     idempotency comes from the atomic claim inside the dispatcher, not from
 *     waiting.
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
        const { data: order } = await supabase
          .from('orders')
          .select('id, payment_method, payment_status, status')
          .eq('id', orderId)
          .maybeSingle();

// The PayU success callback records payment and must NOT issue: the invoice
        // was already issued at order creation. Issuing again would risk a
        // second tax document for one order.
        if (!invoice) {
          result.invoice = { ok: true, skipped: true, reason: 'invoice already issued at order creation' };
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

  // `wait: true` is for callers that genuinely must block (tests, admin tools).
  // The PayU callback uses the default fire-and-return so the customer's
  // redirect is never delayed by invoice rendering or provider latency.
  if (wait) return work;
  void work.catch((err: any) => {
    console.error('[PostOrder] post-confirmation work failed:', err?.message || err);
  });
  return Promise.resolve({ invoice: { ok: false }, shiprocket: { ok: false } });
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