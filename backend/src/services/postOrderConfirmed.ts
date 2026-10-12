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
 *   1. invoice delivery to the customer
 *   2. Shiprocket push
 *
 * Call sites (ONLY these two — do not duplicate the logic anywhere else):
 *   - PayU success callback, after the order row is marked paid
 *   - COD order placement, after the order row is created
 *
 * Guarantees:
 *   - Awaits both jobs so nothing is killed when the serverless response
 *     returns (Vercel terminates the function right after the response).
 *   - Each job has its own try/catch: one failing never stops the other.
 *   - This function NEVER rejects, so payment/order flow can never fail
 *     because of it. Errors are logged and (when the columns exist) saved
 *     onto the order row for the admin retry UI.
 *   - Feature flags default to off; with both flags off the behaviour is
 *     exactly the pre-existing one.
 */
export async function postOrderConfirmed(
  orderId: string,
  { source }: { source: PostOrderSource }
): Promise<PostOrderConfirmedResult> {
  const result: PostOrderConfirmedResult = {
    invoice: { ok: false },
    shiprocket: { ok: false },
  };

  /* The two jobs are independent (invoice never needs the Shiprocket push and
   * vice-versa), so they run concurrently. Worst-case callback time drops from
   * (invoice + shiprocket) to max(invoice, shiprocket). Each still has its own
   * try/catch inside, so one failing never affects the other, and this function
   * still NEVER rejects. */
  const [invoiceOutcome, shiprocketOutcome] = await Promise.allSettled([
    (async () => {
      /* ---- (1) Invoice ---- */
      try {
        // The auto dispatcher needs the atomic invoice_sent_at claim (delta 010)
        // to be race-safe. When INVOICE_AUTO_SEND is on but that column is missing
        // the dispatcher would only skip — so we detect that up-front and fall back
        // to the legacy WhatsApp messages, ensuring the customer still receives a
        // confirmation + invoice. Once the column exists, auto-send runs normally
        // and the legacy messages are NOT triggered (no double message).
        const autoInvoiceReady = config.invoiceAutoSend && (await hasColumn('orders', 'invoice_sent_at'));
        if (autoInvoiceReady) {
          const dispatch = await invoiceDispatchService.sendInvoiceAuto(orderId);
          result.invoice = {
            ok: !dispatch.reason,
            skipped: dispatch.skipped,
            reason: dispatch.reason,
          };
          if (dispatch.reason) {
            console.error(`[PostOrder] invoice dispatch failed for ${orderId}: ${dispatch.reason}`);
          }
        } else {
          if (config.invoiceAutoSend) {
            console.warn(
              `[PostOrder] invoice auto-send skipped: needs delta 010 (orders.invoice_sent_at) — sending legacy messages for order ${orderId}`
            );
          }
          // Legacy behaviour: WhatsApp order confirmation + WhatsApp invoice.
          await orderNotifyService.sendPostPurchaseMessages(orderId);
          result.invoice = { ok: true };
        }
      } catch (err: any) {
        const message = err?.message || String(err);
        console.error(`[PostOrder] invoice step failed for ${orderId} (${source}):`, message);
        await saveInvoiceError(orderId, message);
        result.invoice = { ok: false, reason: message };
      }
    })(),
    (async () => {
      /* ---- (2) Shiprocket ---- */
      try {
        // Two independent triggers decide whether this order is pushed:
        //
        //   legacyTrigger — the PRE-EXISTING behaviour (matches HEAD). A PayU
        //     success callback and testMode both pushed unconditionally, column
        //     or no column. These must keep pushing exactly as before, so the
        //     delta-010 "skip on missing column" guard NEVER applies to them.
        //   autoTriggerOnly — the NEW path where SHIPROCKET_AUTO_PUSH alone is
        //     asking for a push (i.e. not a PayU callback, not testMode). Only
        //     here is the atomic claim available-in-principle, so only here do
        //     we refuse to auto-push without the column (double-push safety).
        const legacyTrigger = source === 'payu_success' || config.shiprocketTestMode;
        const autoTriggerOnly = config.shiprocketAutoPush && !legacyTrigger;

        if (legacyTrigger) {
          // Legacy parity: push regardless of delta 010 columns, exactly like HEAD.
          await pushOrderToShiprocket(orderId);
          result.shiprocket = { ok: true };
        } else if (autoTriggerOnly) {
          if (!(await hasColumn('orders', 'shiprocket_push_status'))) {
            // Delta 010 not applied: the atomic in_progress claim cannot serialise
            // the outbound Shiprocket create call, so two parallel auto-triggers
            // could create two shipments. Skip the AUTO push to guarantee no double
            // push. The admin manual "Push to Shiprocket" button calls
            // pushOrderToShiprocket() directly and is NOT affected by this skip.
            const reason = 'auto-push skipped: needs delta 010 (orders.shiprocket_push_status)';
            console.warn(`[PostOrder] ${reason} — order ${orderId}`);
            result.shiprocket = { ok: true, skipped: true, reason };
          } else {
            await pushOrderToShiprocket(orderId);
            result.shiprocket = { ok: true };
          }
        } else {
          // SHIPROCKET_AUTO_PUSH is off and neither legacy trigger fired
          // (COD placement with the flag off pushes from orderService.createOrder).
          result.shiprocket = { ok: true, skipped: true, reason: 'SHIPROCKET_AUTO_PUSH is off' };
        }
      } catch (err: any) {
        const message = err?.message || String(err);
        console.error(`[PostOrder] shiprocket step failed for ${orderId} (${source}):`, message);
        await saveShiprocketError(orderId, message);
        result.shiprocket = { ok: false, reason: message };
      }
    })(),
  ]);

  // Defensive: both lambdas already never reject, but if Promise.allSettled ever
  // reports a rejection we log it without throwing (this function must never reject).
  for (const outcome of [invoiceOutcome, shiprocketOutcome]) {
    if (outcome.status === 'rejected') {
      console.error(`[PostOrder] unexpected step rejection for ${orderId}:`, outcome.reason);
    }
  }

  return result;
}

export const postOrderService = { postOrderConfirmed };
