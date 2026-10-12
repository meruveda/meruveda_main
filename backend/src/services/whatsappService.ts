import { config } from '../config/env';
import { supabase } from '../database/supabase';

/**
 * WhatsApp Cloud API (Meta) client.
 *
 * All sends are best-effort: a failure is logged and swallowed so that an
 * OTP / payment / order flow can never be broken by a WhatsApp outage.
 *
 * Template names below MUST match the ones approved in Meta Business Manager:
 *   order_confirmation, order_shipped, order_delivered, order_cancelled,
 *   invoice_shared, otp_verification, welcome, shipping_update, review_request
 */
export const WHATSAPP_TEMPLATES = {
  OTP: 'otp_verification',
  WELCOME: 'welcome',
  ORDER_CONFIRMATION: 'order_confirmation',
  INVOICE_SHARED: 'invoice_shared',
  ORDER_SHIPPED: 'order_shipped',
  SHIPPING_UPDATE: 'shipping_update',
  ORDER_DELIVERED: 'order_delivered',
  ORDER_CANCELLED: 'order_cancelled',
  REVIEW_REQUEST: 'review_request',
} as const;

export type WhatsappTemplate = (typeof WHATSAPP_TEMPLATES)[keyof typeof WHATSAPP_TEMPLATES];

const graphBase = () =>
  `https://graph.facebook.com/${config.whatsappGraphApiVersion}/${config.whatsappPhoneNumberId}`;

export function isWhatsappConfigured(): boolean {
  return Boolean(config.whatsappApiToken && config.whatsappPhoneNumberId);
}

/**
 * Normalise an Indian (or already international) phone number into the
 * digits-only format Meta expects, e.g. "919876543210".
 */
export function normalizePhone(raw?: string | null): string {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  // International "00" prefix (e.g. 0091...) -> strip to national form first.
  if (digits.length === 13 && digits.startsWith('00')) digits = digits.slice(2);
  // 12-digit with country code (91XXXXXXXXXX) is already canonical.
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
}

async function graphPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsappApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.error?.message || `WhatsApp API HTTP ${res.status}`;
    throw new Error(message);
  }
  return json;
}

/** Persist an outbound message so repeated triggers never double-send. */
async function logSend(entry: {
  recipient: string;
  templateName?: string;
  messageType: string;
  purpose: string;
  referenceId?: string;
  status: 'sent' | 'failed';
  error?: string;
  payload?: unknown;
}): Promise<boolean> {
  if (!entry.referenceId) return true;
  try {
    const { error } = await supabase.from('whatsapp_message_log').upsert(
      {
        recipient: entry.recipient,
        template_name: entry.templateName || null,
        message_type: entry.messageType,
        purpose: entry.purpose,
        reference_id: entry.referenceId,
        status: entry.status,
        error: entry.error || null,
        payload: entry.payload || {},
      },
      { onConflict: 'purpose,reference_id' }
    );
    if (error) {
      console.error('[WhatsApp] Failed to write message log:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('[WhatsApp] Failed to write message log:', err?.message || err);
    return true;
  }
}

/** Returns true when this (purpose, referenceId) pair was already DELIVERED. */
export async function wasSent(purpose: string, referenceId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('whatsapp_message_log')
      .select('id, status')
      .eq('purpose', purpose)
      .eq('reference_id', referenceId)
      .maybeSingle();
    return Boolean(data) && data?.status === 'sent';
  } catch {
    return false;
  }
}

/** Plain text session message (only deliverable inside the 24h session window). */
export async function sendText(to: string, text: string): Promise<boolean> {
  const phone = normalizePhone(to);
  if (!phone || !isWhatsappConfigured()) return false;
  try {
    await graphPost(`${graphBase()}/messages`, {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: text },
    });
    return true;
  } catch (err: any) {
    console.error(`[WhatsApp] Text send failed for ${phone}:`, err?.message || err);
    return false;
  }
}

/**
 * Send an approved Meta template. `params` fill {{1}}, {{2}} ... in the body.
 * Works outside the 24h session window (required for proactive notifications).
 */
export async function sendTemplate(
  to: string,
  templateName: string,
  params: string[] = []
): Promise<boolean> {
  const phone = normalizePhone(to);
  if (!phone || !isWhatsappConfigured()) return false;

  const components: any[] = [];
  if (params.length > 0) {
    components.push({
      type: 'body',
      parameters: params.map((value) => ({ type: 'text', text: String(value ?? '') })),
    });
  }

  try {
    await graphPost(`${graphBase()}/messages`, {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' },
        ...(components.length ? { components } : {}),
      },
    });
    return true;
  } catch (err: any) {
    console.error(
      `[WhatsApp] Template "${templateName}" send failed for ${phone}:`,
      err?.message || err
    );
    return false;
  }
}

/** Upload a file to WhatsApp and return its Meta media id. */
async function uploadMedia(base64: string, filename: string, mime: string): Promise<string> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'file');
  form.append('file', base64);
  form.append('filename', filename);
  form.append('mime_type', mime);

  const res = await fetch(`${graphBase()}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsappApiToken}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.id) {
    throw new Error(json?.error?.message || `Media upload failed (HTTP ${res.status})`);
  }
  return json.id;
}

/** Send a document (used for the PDF invoice). */
export async function sendDocument(
  to: string,
  base64: string,
  filename: string,
  caption: string,
  mime = 'application/pdf'
): Promise<boolean> {
  const phone = normalizePhone(to);
  if (!phone || !isWhatsappConfigured()) return false;
  try {
    const mediaId = await uploadMedia(base64, filename, mime);
    await graphPost(`${graphBase()}/messages`, {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'document',
      document: { id: mediaId, caption, filename },
    });
    return true;
  } catch (err: any) {
    console.error(`[WhatsApp] Document send failed for ${phone}:`, err?.message || err);
    return false;
  }
}

/** Send a document (used for the PDF invoice) at most once per purpose/reference. */
export async function sendDocumentOnce(options: {
  to: string;
  purpose: string;
  referenceId: string;
  base64: string;
  filename: string;
  caption: string;
  fallback?: { template: string; params: string[] };
  payload?: unknown;
}): Promise<boolean> {
  const { to, purpose, referenceId, base64, filename, caption, fallback, payload } = options;

  if (await wasSent(purpose, referenceId)) return false;
  const phone = normalizePhone(to);
  if (!phone) {
    await logSend({
      recipient: to || 'unknown',
      messageType: 'document',
      purpose,
      referenceId,
      status: 'failed',
      error: 'No WhatsApp number available',
      payload,
    });
    return false;
  }

  let delivered = await sendDocument(phone, base64, filename, caption);
  let usedTemplate = false;
  if (!delivered && fallback) {
    delivered = await sendTemplate(phone, fallback.template, fallback.params);
    usedTemplate = delivered;
  }

  await logSend({
    recipient: phone,
    templateName: usedTemplate ? fallback?.template : undefined,
    messageType: delivered ? (usedTemplate ? 'template' : 'document') : 'failed',
    purpose,
    referenceId,
    status: delivered ? 'sent' : 'failed',
    error: delivered ? undefined : 'Delivery attempt failed',
    payload,
  });

  return delivered;
}

/**
 * Send a notification for a given purpose exactly once.
 * Returns true when this call actually delivered the message.
 */
export async function sendOnce(options: {
  to: string;
  purpose: string;
  referenceId: string;
  template?: WhatsappTemplate | string;
  params?: string[];
  fallbackText?: string;
  messageType?: string;
  payload?: unknown;
}): Promise<boolean> {
  const { to, purpose, referenceId, template, params = [], fallbackText, payload } = options;
  const messageType = options.messageType || (template ? 'template' : 'text');

  if (await wasSent(purpose, referenceId)) return false;
  if (!normalizePhone(to)) {
    await logSend({
      recipient: to || 'unknown',
      templateName: template,
      messageType,
      purpose,
      referenceId,
      status: 'failed',
      error: 'No WhatsApp number available',
      payload,
    });
    return false;
  }

  let delivered = false;
  if (template) {
    delivered = await sendTemplate(to, template, params);
    // Graceful fallback so the user still gets the information if the
    // template is missing / not yet approved by Meta.
    if (!delivered && fallbackText) {
      delivered = await sendText(to, fallbackText);
    }
  } else if (fallbackText) {
    delivered = await sendText(to, fallbackText);
  }

  await logSend({
    recipient: normalizePhone(to),
    templateName: template,
    messageType: delivered ? messageType : 'failed',
    purpose,
    referenceId,
    status: delivered ? 'sent' : 'failed',
    error: delivered ? undefined : 'Delivery attempt failed',
    payload,
  });

  return delivered;
}

export const whatsappService = {
  isConfigured: isWhatsappConfigured,
  normalizePhone,
  sendText,
  sendTemplate,
  sendDocument,
  sendOnce,
  wasSent,
};
