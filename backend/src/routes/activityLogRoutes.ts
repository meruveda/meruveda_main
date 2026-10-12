import { Router } from 'express';
import { getActivityLogs, logActivity } from '../controllers/activityLogsController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

router.use(requireAuth as any);
router.post('/', logActivity as any); // Internal route generally used by middleware, exposed just in case

router.use(requireAdmin as any);
router.get('/', getActivityLogs as any);

export default router;
