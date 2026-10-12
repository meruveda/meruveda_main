import { Router } from 'express';
import { getSettings, updateSettings } from '../controllers/settingsController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

router.get('/', getSettings as any); // Public config (like store hours, logo url)
router.post('/', requireAuth as any, requireAdmin as any, updateSettings as any);

export default router;
