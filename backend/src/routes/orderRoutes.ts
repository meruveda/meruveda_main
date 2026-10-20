import { Router } from 'express';
import { getOrders, getOrderById, createOrder, updateOrderStatus, getMyOrders, updateOrder, deleteOrder, trackOrder, trackByAwb, invoiceStatus, resendInvoice, downloadInvoice, downloadInvoiceForGuest, pushToShiprocket, retryShiprocketPushes } from '../controllers/ordersController';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { orderCreateLimiter, trackAwbLimiter, trackInvoiceLimiter } from '../middleware/rateLimit';

const router = Router();

// PUBLIC — guest order tracking by order number + mobile number (no login).
router.get('/track', trackOrder as any);

// PUBLIC — live tracking by AWB entered manually (Shiprocket live API).
router.get('/track-awb', trackAwbLimiter, trackByAwb as any);

// PUBLIC — guest invoice download, verified by order number + mobile number.
// The fallback that keeps the invoice reachable while the WhatsApp template is
// still awaiting Meta's approval.
router.get('/track/invoice', trackInvoiceLimiter, downloadInvoiceForGuest as any);

// Retry for failed Shiprocket pushes. Mounted BEFORE requireAuth so Vercel
// Cron (Authorization: Bearer CRON_SECRET, no user JWT) can reach it; the
// controller authorizes cron-secret OR admin itself.
// Vercel Cron always issues GET, admin tooling uses POST — support both.
router.get('/retry-shiprocket-failed', retryShiprocketPushes as any);
router.post('/retry-shiprocket-failed', retryShiprocketPushes as any);

router.use(requireAuth as any);

router.get('/my', getMyOrders as any);
router.post('/', orderCreateLimiter, createOrder as any);

// Read-only invoice delivery status. Delivery is automatic (COD at placement,
// PayU on the verified callback) and the cron sweep retries failures.
router.get('/:id/invoice/status', invoiceStatus as any);

// Re-attempt delivery of an invoice that was issued but never delivered.
// Idempotent: a channel already recorded as `sent` is a no-op, so this can
// never turn one order into two delivered invoices. Admin only.
router.post('/:id/resend-invoice', requireAdmin as any, resendInvoice as any);

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
