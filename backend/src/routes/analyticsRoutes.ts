import { Router } from 'express';
import { getDashboardStats, getSummary, getVisitorStats, recordPageview, getTrafficStats } from '../controllers/analyticsController';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimit';

const router = Router();

// Public — storefront pageview beacon. Rate-limited per IP; no auth, no PII stored.
const pageviewLimiter = createRateLimiter({ windowMs: 60_000, max: 30, prefix: 'pageview' });
router.post('/pageview', pageviewLimiter, recordPageview as any);

router.get('/dashboard', requireAuth as any, requireAdmin as any, getDashboardStats as any);
router.get('/summary', requireAuth as any, requireAdmin as any, getSummary as any);
router.get('/visitors', requireAuth as any, requireAdmin as any, getVisitorStats as any);
// First-party traffic report backing the admin Analytics page.
router.get('/traffic', requireAuth as any, requireAdmin as any, getTrafficStats as any);

export default router;
