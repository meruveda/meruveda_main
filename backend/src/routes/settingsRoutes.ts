import { Router } from 'express';
import { getSettings, updateSettings } from '../controllers/settingsController';
import { requireAuth, requireAdmin, optionalAuth } from '../middleware/auth';

const router = Router();

// Public config (store hours, logo url). optionalAuth widens the response for
// signed-in admins; the public payload is filtered in the controller.
router.get('/', optionalAuth as any, getSettings as any);
router.post('/', requireAuth as any, requireAdmin as any, updateSettings as any);

export default router;
