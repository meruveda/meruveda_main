import { Router } from 'express';
import { getDashboardStats, getSummary, getVisitorStats } from '../controllers/analyticsController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

router.get('/dashboard', requireAuth as any, requireAdmin as any, getDashboardStats as any);
router.get('/summary', requireAuth as any, requireAdmin as any, getSummary as any);
router.get('/visitors', requireAuth as any, requireAdmin as any, getVisitorStats as any);

export default router;
