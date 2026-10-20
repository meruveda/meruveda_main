import { Router } from 'express';
import { shiprocketController } from '../controllers/shiprocketController';

const router = Router();

/**
 * Neutral logistics webhook.
 *
 * Shiprocket's own dashboard wants a webhook URL, and a provider-neutral
 * path means the URL does not have to change if the courier is swapped later.
 * It is the exact same handler as /api/shiprocket/webhook — the token check
 * (SHIPROCKET_WEBHOOK_TOKEN) is identical.
 */
router.post('/webhook', shiprocketController.webhook);

export default router;
