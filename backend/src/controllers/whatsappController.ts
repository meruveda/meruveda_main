import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config/env';
import * as whatsappLogRepo from '../database/repos/whatsappLog';
import { timingSafeEqualStr } from '../utils/timingSafe';

/**
 * Meta WhatsApp Cloud API webhook.
 *
 * Configure in Meta App Dashboard > WhatsApp > Configuration > Webhook:
 *   Callback URL : <BACKEND_URL>/api/whatsapp/webhook
 *   Verify token : WHATSAPP_WEBHOOK_VERIFY_TOKEN (from .env)
 * Signature: inbound POSTs are authenticated via X-Hub-Signature-256
 *   (HMAC-SHA256 of the raw body, keyed by the App Secret =
 *   WHATSAPP_APP_SECRET). Enforced in production; in dev a missing secret
 *   only warns.
 */
export const verifyWebhook = async (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (
    mode === 'subscribe' &&
    typeof token === 'string' &&
    config.whatsappWebhookVerifyToken &&
    timingSafeEqualStr(token, config.whatsappWebhookVerifyToken)
  ) {
    console.log('[WhatsApp Webhook] Verified by Meta.');
    return res.status(200).send(String(challenge || ''));
  }
  return res.sendStatus(403);
};

/** Verify Meta's X-Hub-Signature-256 over the raw request body. */
function verifySignature(req: Request): boolean {
  const secret = config.whatsappAppSecret;
  if (!secret) return false;
  const header = String(req.get('x-hub-signature-256') || '');
  const [algo, sentHex] = header.split('=');
  if (algo !== 'sha256' || !sentHex) return false;
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!raw) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return timingSafeEqualStr(expected, sentHex);
}

export const receiveWebhook = async (req: Request, res: Response, next: NextFunction) => {
  if (!verifySignature(req)) {
    if (config.nodeEnv === 'production') {
      // Fail closed: without WHATSAPP_APP_SECRET we cannot tell Meta from an
      // attacker, so production rejects. (Dev only warns and proceeds.)
      console.warn('[WhatsApp Webhook] rejected: missing/invalid X-Hub-Signature-256 (is WHATSAPP_APP_SECRET set?)');
      return res.sendStatus(401);
    }
    if (!config.whatsappAppSecret) {
      console.warn('[WhatsApp Webhook] WHATSAPP_APP_SECRET not set — accepting unsigned payload (dev only).');
    } else {
      console.warn('[WhatsApp Webhook] signature mismatch — rejecting payload.');
      return res.sendStatus(401);
    }
  }

  // Acknowledge immediately — Meta retries aggressively on slow responses.
  res.sendStatus(200);

  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry?.changes || []) {
        const value = change?.value || {};
        const contacts = value.contacts || [];
        const messages = value.messages || [];

        // Delivery / read / failure receipts
        for (const status of value.statuses || []) {
          /**
           * Meta only reports the FINAL outcome of a send here: "accepted by
           * the API" is not "delivered to the phone". Printing each receipt
           * means an OTP the customer never received shows up as a
           * `status=failed` line with Meta's own code/title/reason.
           */
          const failure = status.errors?.[0];
          if (status.status === 'failed') {
            console.error(
              `[WhatsApp Webhook] status=failed id=${status.id} recipient=${status.recipient_id} ` +
                `code=${failure?.code ?? 'n/a'} title=${failure?.title ?? 'n/a'} ` +
                `reason=${failure?.details || failure?.message || 'no reason given'}`,
            );
          } else {
            console.log(
              `[WhatsApp Webhook] status=${status.status} id=${status.id} recipient=${status.recipient_id}`,
            );
          }
          try {
            await whatsappLogRepo.insertMessage({
              recipient: status.recipient_id || 'unknown',
              message_type: 'status_receipt',
              purpose: 'meta_status',
              reference_id: `${status.id}:${status.status}`,
              status: status.status === 'failed' ? 'failed' : 'sent',
              error: status.errors?.[0]?.title || null,
              payload: status,
            });
          } catch (logErr) {
            console.error('[WhatsApp Webhook] status log failed:', logErr);
          }
        }

        // Inbound messages (replies from customers)
        for (const message of messages) {
          try {
            await whatsappLogRepo.insertMessage({
              recipient: contacts[0]?.wa_id || message.from || 'unknown',
              message_type: 'inbound',
              purpose: 'inbound_message',
              reference_id: `${message.id}`,
              status: 'sent',
              payload: message,
            });
          } catch (logErr) {
            console.error('[WhatsApp Webhook] inbound log failed:', logErr);
          }
        }
      }
    }
  } catch (err: any) {
    // Never throw after the response has been sent.
    console.error('[WhatsApp Webhook] processing error:', err?.message || err);
  }
};

/**
 * Human-readable configuration helper for the webhook URL.
 *
 * The verify token is NOT returned. This endpoint used to be public and
 * printed the token, which handed anyone the value Meta signs its callback
 * with - enough to forge a webhook that looks genuine. It now reports only
 * whether a token is configured, and it is admin-only.
 */
export const webhookInfo = (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: { message: 'Forbidden' } });
  }
  const base = config.backendUrl || `${req.protocol}://${req.get('host')}`;
  res.json({
    data: {
      callbackUrl: `${base}/api/whatsapp/webhook`,
      // Only whether it is set, never the value.
      verifyTokenConfigured: Boolean(config.whatsappWebhookVerifyToken),
      configured: Boolean(config.whatsappApiToken && config.whatsappPhoneNumberId),
      templates: [
        'order_confirmation',
        'order_shipped',
        'order_delivered',
        'order_cancelled',
        'invoice_shared',
        'otp_verification',
        'welcome',
        'shipping_update',
        'review_request',
      ],
    },
  });
};
