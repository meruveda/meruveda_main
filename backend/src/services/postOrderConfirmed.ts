import { config } from '../config/env';
import { supabase } from '../database/supabase';
import { hasColumn } from './schemaGuard';
import { orderNotifyService } from './orderNotifyService';
import { invoiceDispatchService } from './invoiceDispatchService';
import { pushOrderToShiprocket } from './orderService';

export type PostOrderSource = 'payu_success' | 'cod_placement';

export interface PostOrderConfirmedResult {
  invoice: { ok: boolean; skipped?: boolean; reason?: string };
  shiprocket: { ok: boolean; skipped?: boolean; reason?: string };
}

/** True when the order is paid on delivery (no payment callback exists). */
export function isCodOrder(order: any): boolean {
  const method = String(order?.payment_method || '');
  return /cash|\bcod\b/i.test(method);
}

/**
 * Is this order genuinely billable RIGHT NOW?
 *
 * Prepaid orders are only billable once payment is verified (PayU hash + amount
 * match have already run and flipped payment_status to 'paid' before we get
 * here). COD orders are billable the moment the order is placed, because the
 * invoice states the amount due on delivery.
 */
export function isInvoiceEligible(order: any, source: PostOrderSource): boolean {
  if (!order) return false;
  if (isCodOrder(order)) return true;
  return String(order.payment_status || '') === 'paid' && source === 'payu_success';
}

/* ------------------------------------------------------------------ */
/* Failure bookkeeping — never throws, never blocks the order flow     */
/* ------------------------------------------------------------------ */

async function saveInvoiceError(orderId: string, message: string): Promise<void> {
  try {
    if (await hasColumn('orders', 'invoice_error')) {
      await supabase.from('orders').update({ invoice_error: message.slice(0, 500) }).eq('id', orderId);
    }
  } catch (err: any) {
    console.error('[PostOrder] could not persist invoice_error:', err?.message || err);
  }
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
  { source, wait = false }: { source: PostOrderSource; wait?: boolean }
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

        // Gate: never issue an invoice for an unverified prepaid order, and
        // never issue one from a COD-placement trigger for a prepaid order.
        if (!isInvoiceEligible(order, source)) {
          console.warn(
            `[PostOrder] invoice skipped for ${orderId} (source=${source}, ` +
              `method=${order?.payment_method}, payment=${order?.payment_status}) — not billable yet.`
          );
          result.invoice = { ok: true, skipped: true, reason: 'order is not billable yet' };
          return;
        }

        const dispatch = await invoiceDispatchService.sendInvoiceAuto(orderId);
        result.invoice = {
          ok: !dispatch.reason,
          skipped: dispatch.skipped,
          reason: dispatch.reason,
        };
        if (dispatch.reason) {
          console.error(`[PostOrder] invoice dispatch failed for ${orderId}: ${dispatch.reason}`);
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
        const legacyTrigger = source === 'payu_success' || config.shiprocketTestMode;
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