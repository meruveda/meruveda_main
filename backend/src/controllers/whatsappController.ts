import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { supabase } from '../database/supabase';

/**
 * Meta WhatsApp Cloud API webhook.
 *
 * Configure in Meta App Dashboard > WhatsApp > Configuration > Webhook:
 *   Callback URL : <BACKEND_URL>/api/whatsapp/webhook
 *   Verify token : WHATSAPP_WEBHOOK_VERIFY_TOKEN (from .env)
 */
export const verifyWebhook = async (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsappWebhookVerifyToken) {
    console.log('[WhatsApp Webhook] Verified by Meta.');
    return res.status(200).send(String(challenge || ''));
  }
  return res.sendStatus(403);
};

export const receiveWebhook = async (req: Request, res: Response, next: NextFunction) => {
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
          try {
            await supabase.from('whatsapp_message_log').insert({
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
            await supabase.from('whatsapp_message_log').insert({
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

/** Human-readable configuration helper for the webhook URL. */
export const webhookInfo = (_req: Request, res: Response) => {
  const base = config.backendUrl || `${_req.protocol}://${_req.get('host')}`;
  res.json({
    data: {
      callbackUrl: `${base}/api/whatsapp/webhook`,
      verifyToken: config.whatsappWebhookVerifyToken || 'NOT SET',
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
