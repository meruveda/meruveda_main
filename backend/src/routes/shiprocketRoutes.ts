import { Router } from 'express';
import { shiprocketController } from '../controllers/shiprocketController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// Public routes (Checkout / Webhooks)
router.get('/serviceability', shiprocketController.checkServiceability);
router.post('/webhook', shiprocketController.webhook);

// Protected routes (Admin / Customer)
router.use(requireAuth as any);

router.get('/tracking/:awb', shiprocketController.trackShipment);
router.post('/cancel-order', shiprocketController.cancelOrder);
router.get('/invoice/:shipmentId', shiprocketController.getInvoice);

// Admin-only routes
router.use(requireAdmin as any);

router.post('/generate-awb', shiprocketController.generateAwb);
router.post('/schedule-pickup', shiprocketController.schedulePickup);
router.get('/label/:shipmentId', shiprocketController.getLabel);

export default router;

