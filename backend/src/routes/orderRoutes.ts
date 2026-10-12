import { Router } from 'express';
import { getOrders, getOrderById, createOrder, updateOrderStatus, getMyOrders, updateOrder, deleteOrder, trackOrder, trackByAwb, resendInvoice, downloadInvoice, pushToShiprocket, retryShiprocketPushes } from '../controllers/ordersController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// PUBLIC — guest order tracking by order number + mobile number (no login).
router.get('/track', trackOrder as any);

// PUBLIC — live tracking by AWB entered manually (Shiprocket live API).
router.get('/track-awb', trackByAwb as any);

// Retry for failed Shiprocket pushes. Mounted BEFORE requireAuth so Vercel
// Cron (Authorization: Bearer CRON_SECRET, no user JWT) can reach it; the
// controller authorizes cron-secret OR admin itself.
// Vercel Cron always issues GET, admin tooling uses POST — support both.
router.get('/retry-shiprocket-failed', retryShiprocketPushes as any);
router.post('/retry-shiprocket-failed', retryShiprocketPushes as any);

router.use(requireAuth as any);

router.get('/my', getMyOrders as any);
router.post('/', createOrder as any);

// Owner or admin may regenerate/resend the WhatsApp invoice.
router.post('/:id/resend-invoice', resendInvoice as any);

// Owner or admin may download the fixed GST invoice PDF.
router.get('/:id/invoice', downloadInvoice as any);

router.get('/:id', getOrderById as any);

router.get('/', requireAdmin as any, getOrders as any);
router.patch('/:id/status', requireAdmin as any, updateOrderStatus as any);
router.patch('/:id', requireAdmin as any, updateOrder as any);
router.delete('/:id', requireAdmin as any, deleteOrder as any);

// Manual fallback + retry for failed Shiprocket pushes (admin; retry also
// accepts cron with Authorization: Bearer CRON_SECRET).
router.post('/:id/push-shiprocket', requireAdmin as any, pushToShiprocket as any);

export default router;
