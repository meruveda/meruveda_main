import { Router, Request, Response, NextFunction } from 'express';
import { reviewJobService } from '../services/reviewJobService';
import { config } from '../config/env';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { invoiceDispatchService } from '../services/invoiceDispatchService';
import { retryFailedShiprocketPushes } from '../services/orderService';
import { runSweep } from '../services/sweepService';
import { timingSafeEqualStr } from '../utils/timingSafe';

/**
 * Scheduled jobs.
 *
 * GET /api/jobs/review-requests
 *   - Vercel Cron calls this daily (see `crons` in vercel.json) and authenticates
 *     with `Authorization: Bearer ${CRON_SECRET}`.
 *   - Admins may also trigger it manually.
 *   - Idempotent: an order is only ever processed once.
 *
 * GET|POST /api/jobs/retry-failures
 *   - Daily sweep that retries (a) invoices that never went out and
 *     (b) Shiprocket pushes that failed.
 *   - Same CRON_SECRET Bearer auth; 401 when the secret mismatches and the
 *     caller is not an authenticated admin.
 *   - Both steps are individually flag-gated and idempotent.
 */
const router = Router();

export const authorize = (req: Request, res: Response, next: any) => {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const provided = bearer || (req.query.secret as string) || '';

  if (config.cronSecret && timingSafeEqualStr(provided, config.cronSecret)) return next();

  // Explicit 401 when a wrong secret was supplied and no admin session exists.
  if (config.cronSecret && provided && !timingSafeEqualStr(provided, config.cronSecret)) {
    return requireAuth(req, res, (err: any) => {
      if (err) return next(err);
      requireAdmin(req, res, next);
    });
  }

  // Fallback: an authenticated admin can run it from the dashboard.
  return requireAuth(req, res, (err: any) => {
    if (err) return next(err);
    requireAdmin(req, res, next);
  });
};

router.get('/review-requests', authorize, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await reviewJobService.process();
    res.json({ data: stats, delayDays: reviewJobService.delayDays });
  } catch (error) {
    next(error);
  }
});

/**
 * GET|POST /api/jobs/sweep
 *
 * The single housekeeping endpoint. It retries due Shiprocket pushes, retries
 * invoices that were generated but not sent, polls Shiprocket tracking for
 * pushed orders, and picks up the invoice backlog the moment the WhatsApp
 * template is approved.
 *
 * Authenticated with CRON_SECRET (the Vercel cron uses it) or an admin
 * session. GET and POST behave identically so any cron provider works.
 */
router.get('/sweep', authorize, sweepHandler);
router.post('/sweep', authorize, sweepHandler);

async function sweepHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));
    const result = await runSweep({
      limit,
      // The sweep is the one place that notices a fresh template approval, so
      // it always refreshes the resolver cache.
      refreshTemplates: true,
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

router.get('/retry-failures', authorize, retryFailuresHandler);
router.post('/retry-failures', authorize, retryFailuresHandler);

async function retryFailuresHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));

    let invoices: any[] = [];
    if (config.invoiceAutoSend) {
      try {
        invoices = await invoiceDispatchService.retryPendingInvoices(limit);
      } catch (err: any) {
        console.error('[Jobs] invoice retry sweep failed:', err?.message || err);
      }
    }

    let shiprocket: any[] = [];
    if (config.shiprocketAutoPush) {
      try {
        shiprocket = await retryFailedShiprocketPushes(limit);
      } catch (err: any) {
        console.error('[Jobs] shiprocket retry sweep failed:', err?.message || err);
      }
    }

    res.json({
      data: {
        invoice: {
          enabled: config.invoiceAutoSend,
          attempted: invoices.length,
          sent: invoices.filter((r) => r.ok && !r.skipped).length,
          results: invoices,
        },
        shiprocket: {
          enabled: config.shiprocketAutoPush,
          attempted: shiprocket.length,
          pushed: shiprocket.filter((r) => r.ok).length,
          results: shiprocket,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export default router;
