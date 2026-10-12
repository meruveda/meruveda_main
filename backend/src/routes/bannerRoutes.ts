import { Router } from 'express';
import { getBanners, adminGetBanners, createBanner, updateBanner, deleteBanner } from '../controllers/bannersController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// Public route to get active banners
router.get('/', getBanners as any);

// Protected admin routes
router.use(requireAuth as any, requireAdmin as any);
router.get('/admin', adminGetBanners as any);
router.post('/', createBanner as any);
router.patch('/:id', updateBanner as any);
router.delete('/:id', deleteBanner as any);

export default router;
