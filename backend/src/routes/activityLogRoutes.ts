import { Router } from 'express';
import { getActivityLogs, logActivity } from '../controllers/activityLogsController';
import { requireAuth, requireAdmin, requireFullAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth as any, requireFullAuth as any);
router.post('/', logActivity as any); // Internal route generally used by middleware, exposed just in case

router.use(requireAdmin as any);
router.get('/', getActivityLogs as any);

export default router;
