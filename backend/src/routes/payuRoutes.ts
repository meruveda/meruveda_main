import { Router } from 'express';
import { initiatePayUPayment, handlePayUCallback, getPaymentStatus } from '../controllers/payuController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/initiate', requireAuth as any, initiatePayUPayment as any);
router.post('/callback', handlePayUCallback as any);
// Verified status for laptop polling after QR/UPI payment on the phone.
router.get('/status/:ref', requireAuth as any, getPaymentStatus as any);

export default router;
