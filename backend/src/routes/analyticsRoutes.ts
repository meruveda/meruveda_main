import { Router } from 'express';
import { getDashboardStats, getSummary, getVisitorStats, recordPageview, recordEvent, getTrafficStats } from '../controllers/analyticsController';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimit';

const router = Router();

// Public — storefront pageview beacon. Rate-limited per IP; no auth, no PII stored.
const pageviewLimiter = createRateLimiter({ windowMs: 60_000, max: 30, prefix: 'pageview' });
router.post('/pageview', pageviewLimiter, recordPageview as any);

// Public — storefront e-commerce events (view_item, add_to_cart, purchase, ...).
// Same posture as the pageview beacon: public, rate-limited, PII-free, and a
// 204 no-op until the analytics_events migration is applied.
const eventLimiter = createRateLimiter({ windowMs: 60_000, max: 120, prefix: 'analytics-event' });
router.post('/event', eventLimiter, recordEvent as any);

router.get('/dashboard', requireAuth as any, requireAdmin as any, getDashboardStats as any);
router.get('/summary', requireAuth as any, requireAdmin as any, getSummary as any);
router.get('/visitors', requireAuth as any, requireAdmin as any, getVisitorStats as any);
// First-party traffic report backing the admin Analytics page.
router.get('/traffic', requireAuth as any, requireAdmin as any, getTrafficStats as any);

export default router;
