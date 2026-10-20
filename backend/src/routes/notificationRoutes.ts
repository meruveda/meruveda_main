import { Router } from 'express';
import { getNotifications, markAsRead, markAllAsRead, deleteNotification } from '../controllers/notificationsController';
import { requireAuth, requireFullAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth as any, requireFullAuth as any);
router.get('/', getNotifications as any);
router.patch('/:id/read', markAsRead as any);
router.post('/read-all', markAllAsRead as any);
router.delete('/:id', deleteNotification as any);

export default router;
