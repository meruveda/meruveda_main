import { Router, Request, Response, NextFunction } from 'express';
import { reviewJobService } from '../services/reviewJobService';
import { config } from '../config/env';
import { requireAuth, requireAdmin } from '../middleware/auth';

/**
 * Scheduled jobs.
 *
 * GET /api/jobs/review-requests
 *   - Vercel Cron calls this daily (see `crons` in vercel.json) and authenticates
 *     with `Authorization: Bearer ${CRON_SECRET}`.
 *   - Admins may also trigger it manually.
 *   - Idempotent: an order is only ever processed once.
 */
const router = Router();

const authorize = (req: Request, res: Response, next: any) => {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const provided = bearer || (req.query.secret as string) || '';

  if (config.cronSecret && provided === config.cronSecret) return next();

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

export default router;
