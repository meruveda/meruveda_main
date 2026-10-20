/**
 * The automation sweep.
 *
 * One function that keeps the pipeline moving without needing an external
 * cron service. It:
 *   1. retries Shiprocket pushes that are due (respecting the backoff)
 *   2. retries invoices that were generated but not sent
 *   3. polls Shiprocket for the tracking of pushed-but-not-delivered orders
 *   4. sends the backlog of invoices once the WhatsApp template is approved
 *
 * It can be triggered by:
 *   - GET/POST /api/jobs/sweep   (Bearer CRON_SECRET, also the Vercel cron)
 *   - after every new order
 *   - when an admin opens the orders list or an order detail
 *   - when a customer opens their order tracking page
 *
 * The opportunistic triggers are throttled, so opening the admin panel fifty
 * times in a minute still results in one sweep.
 */
import { config } from '../config/env';
import * as ordersRepo from '../database/repos/orders';
import { retryFailedShiprocketPushes } from './orderService';
import { invoiceDispatchService } from './invoiceDispatchService';
import { pollShiprocketTracking } from './shiprocketAutomation';
import { getInvoiceTemplate, invalidateTemplateCache } from './whatsappTemplateResolver';
export interface SweepOptions {
  /** Maximum orders retried per section. */
  limit?: number;
  /** Skip the tracking poll (used by the cheap opportunistic triggers). */
  skipTrackingPoll?: boolean;
  /** Skip the invoice retry (used when only the push state needs refreshing). */
  skipInvoiceRetry?: boolean;
  /** Force the template cache to refresh — used to notice a fresh approval. */
  refreshTemplates?: boolean;
}

export interface SweepResult {
  shiprocket: { attempted: number; pushed: number; results: any[] };
  invoice: { attempted: number; sent: number; results: any[]; templateReady: boolean };
  tracking: { polled: number; updated: number; results: any[] };
  template: { ready: boolean; name?: string; reason?: string };
}

/**
 * Run the sweep.
 *
 * Never throws: a failure in one section must not stop the others, and the
 * caller is usually a background trigger that must not fail the request.
 */
export async function runSweep(options: SweepOptions = {}): Promise<SweepResult> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 15));

  if (options.refreshTemplates) {
    invalidateTemplateCache();
  }

  // 1. Which invoice template is approved right now?
  const templateState = await getInvoiceTemplate();
  const templateReady = Boolean(templateState.template);

  // 2. Retry due Shiprocket pushes.
  let shiprocket: SweepResult['shiprocket'] = { attempted: 0, pushed: 0, results: [] };
  if (config.shiprocketAutoPush) {
    try {
      const results = await retryFailedShiprocketPushes(limit);
      shiprocket = {
        attempted: results.length,
        pushed: results.filter((r: any) => r.ok && !r.skipped).length,
        results,
      };
    } catch (err: any) {
      console.error('[Sweep] shiprocket retry failed:', err?.message || err);
      shiprocket = { attempted: 0, pushed: 0, results: [{ error: String(err?.message || err) }] };
    }
  }

  // 3. Retry invoices that were generated but not sent.
  let invoice: SweepResult['invoice'] = {
    attempted: 0,
    sent: 0,
    results: [],
    templateReady,
  };
  if (config.invoiceAutoSend && !options.skipInvoiceRetry) {
    try {
      const results = await invoiceDispatchService.retryPendingInvoices(limit);
      invoice = {
        attempted: results.length,
        sent: results.filter((r: any) => r.ok && !r.skipped).length,
        results,
        templateReady,
      };
    } catch (err: any) {
      console.error('[Sweep] invoice retry failed:', err?.message || err);
      invoice = { attempted: 0, sent: 0, results: [{ error: String(err?.message || err) }], templateReady };
    }
  }

  // 4. Poll Shiprocket tracking for pushed-but-undelivered orders.
  let tracking: SweepResult['tracking'] = { polled: 0, updated: 0, results: [] };
  if (!options.skipTrackingPoll) {
    try {
      tracking = await pollShiprocketTracking(20);
    } catch (err: any) {
      console.error('[Sweep] tracking poll failed:', err?.message || err);
      tracking = { polled: 0, updated: 0, results: [{ error: String(err?.message || err) }] };
    }
  }

  return {
    shiprocket,
    invoice,
    tracking,
    template: {
      ready: templateReady,
      name: templateState.template?.name,
      reason: templateState.reason,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Opportunistic triggering                                             */
/* ------------------------------------------------------------------ */

const THROTTLE_MS = 60 * 1000;
let lastSweepAt = 0;
let lastSweepPromise: Promise<SweepResult> | null = null;

/**
 * Run the sweep if it has not run in the last minute.
 *
 * Returns null when the sweep was throttled. Used by the admin orders list,
 * the admin order detail and the customer tracking page: those pages are
 * opened often, and they are a perfect trigger for keeping the statuses
 * fresh without an external cron.
 */
export async function runSweepIfDue(
  options: SweepOptions = {},
): Promise<SweepResult | null> {
  const now = Date.now();
  if (now - lastSweepAt < THROTTLE_MS) return null;

  // If a sweep is already running, join it instead of starting another.
  if (lastSweepPromise) return lastSweepPromise;

  lastSweepAt = now;
  const promise = runSweep(options)
    .catch((err: any) => {
      console.error('[Sweep] failed:', err?.message || err);
      return {
        shiprocket: { attempted: 0, pushed: 0, results: [] },
        invoice: { attempted: 0, sent: 0, results: [], templateReady: false },
        tracking: { polled: 0, updated: 0, results: [] },
        template: { ready: false },
      } as SweepResult;
    })
    .finally(() => {
      lastSweepPromise = null;
    });
  lastSweepPromise = promise;
  return promise;
}

/** Test seam: forget the throttle so the next call runs immediately. */
export function resetSweepThrottle(): void {
  lastSweepAt = 0;
  lastSweepPromise = null;
}

/**
 * The orders that a customer can see the state of.
 *
 * Used by the tracking page to refresh a single order.
 */
export async function refreshOrderState(orderId: string): Promise<void> {
  try {
    const order = await ordersRepo.getOrderRow(orderId);
    if (!order) return;
    if (order.awb_code && String(order.status).toLowerCase() !== 'delivered') {
      await pollShiprocketTracking(1);
    }
  } catch (err: any) {
    console.error('[Sweep] order refresh failed:', err?.message || err);
  }
}
