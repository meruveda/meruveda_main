import { Router } from 'express';
import { verifyWebhook, receiveWebhook, webhookInfo } from '../controllers/whatsappController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// Meta webhook verification handshake (GET) + event receiver (POST).
router.get('/webhook', verifyWebhook as any);
router.post('/webhook', receiveWebhook as any);

// Helper documenting the exact URL to paste into Meta. It reports only
// whether the verify token is configured - never the token itself - and it
// is admin-only.
router.get('/webhook/info', requireAuth as any, requireAdmin as any, webhookInfo as any);

export default router;
