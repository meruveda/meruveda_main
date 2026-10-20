import { Router } from 'express';
import { getCoupons, validateCoupon, createCoupon, updateCoupon, deleteCoupon } from '../controllers/couponsController';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { couponValidateLimiter } from '../middleware/rateLimit';

const router = Router();

// Public (often used from the cart before login). Throttled because the error
// message per code makes it an oracle for brute-forcing active codes.
router.post('/validate', couponValidateLimiter, validateCoupon as any);

router.use(requireAuth as any, requireAdmin as any);
router.get('/', getCoupons as any);
router.post('/', createCoupon as any);
router.patch('/:id', updateCoupon as any);
router.delete('/:id', deleteCoupon as any);

export default router;
