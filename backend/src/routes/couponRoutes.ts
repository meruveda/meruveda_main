import { Router } from 'express';
import { getCoupons, validateCoupon, createCoupon, updateCoupon, deleteCoupon } from '../controllers/couponsController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

router.post('/validate', validateCoupon as any); // Public but often restricted to logged-in users

router.use(requireAuth as any, requireAdmin as any);
router.get('/', getCoupons as any);
router.post('/', createCoupon as any);
router.patch('/:id', updateCoupon as any);
router.delete('/:id', deleteCoupon as any);

export default router;
