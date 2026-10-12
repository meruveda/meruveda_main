import { Router } from 'express';
import { verifyWebhook, receiveWebhook, webhookInfo } from '../controllers/whatsappController';

const router = Router();

// Meta webhook verification handshake (GET) + event receiver (POST).
router.get('/webhook', verifyWebhook as any);
router.post('/webhook', receiveWebhook as any);

// Helper documenting the exact URL/token to paste into Meta.
router.get('/webhook/info', webhookInfo as any);

export default router;
