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
 *   invoice_shared, invoice_with_document, otp_verification, welcome,
 *   shipping_update, review_request
 */
export const WHATSAPP_TEMPLATES = {
  OTP: 'otp_verification',
  WELCOME: 'welcome',
  ORDER_CONFIRMATION: 'order_confirmation',
  INVOICE_SHARED: 'invoice_shared',
  /**
   * Business-initiated send with an attachment. Required for invoices: outside
   * the 24h customer-service window Meta rejects a free-form document message
   * (error 131047 "message failed to send because more than 24 hours have
   * passed"), so the PDF rides on an approved template that declares a
   * `document` header component.
   */
  INVOICE_WITH_DOCUMENT: 'invoice_with_document',
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

/**
 * Exported so the invoice dispatcher can record non-WhatsApp channels (email)
 * in the same `whatsapp_message_log` table, which is what the dedupe checks read.
 */
export const logMessage = logSend;

/** Returns the delivery row for (purpose, referenceId), or null. */
export async function getLogEntry(
  purpose: string,
  referenceId: string
): Promise<{ status: string; error?: string | null; message_type?: string | null } | null> {
  try {
    const { data } = await supabase
      .from('whatsapp_message_log')
      .select('status, error, message_type')
      .eq('purpose', purpose)
      .eq('reference_id', referenceId)
      .maybeSingle();
    return (data as any) || null;
  } catch {
    return null;
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

/**
 * Send the invoice PDF as an APPROVED TEMPLATE whose first component is a
 * document header.
 *
 * Why not a plain `type: document` message: invoices go out long after the
 * customer's last inbound message (often days), which puts them outside
 * WhatsApp's 24-hour customer service window. In that window Meta accepts only
 * template messages, and a template may carry a `document` header component —
 * so this is the only compliant way to attach a PDF.
 *
 * Template shape that must be approved in Meta Business Manager:
 *   name     : invoice_with_document
 *   category : UTILITY
 *   header   : DOCUMENT  (no sample media required)
 *   body     : "Hi {{1}}, your invoice {{2}} for MeruVeda order {{3}} of
 *               {{4}} is attached. View online: {{5}}"
 *   footer   : "Thank You For Your Business!"
 *
 * `{{5}}` (the signed link) is appended to the body by us, so the template body
 * must contain that fifth placeholder.
 */
export async function sendDocumentTemplate(options: {
  to: string;
  base64: string;
  filename: string;
  templateName?: string;
  bodyParams: string[];
}): Promise<boolean> {
  const phone = normalizePhone(options.to);
  if (!phone || !isWhatsappConfigured()) return false;

  let mediaId: string;
  try {
    mediaId = await uploadMedia(options.base64, options.filename, 'application/pdf');
  } catch (err: any) {
    console.error(`[WhatsApp] Invoice media upload failed for ${phone}:`, err?.message || err);
    return false;
  }

  try {
    await graphPost(`${graphBase()}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'template',
      template: {
        name: options.templateName || config.whatsappInvoiceTemplateName || WHATSAPP_TEMPLATES.INVOICE_WITH_DOCUMENT,
        language: { code: options.templateName ? 'en' : config.whatsappInvoiceTemplateLang || 'en' },
        components: [
          // Header component MUST come before the body component.
          { type: 'header', parameters: [{ type: 'document', document: { id: mediaId } }] },
          {
            type: 'body',
            parameters: options.bodyParams.map((value) => ({ type: 'text', text: String(value ?? '') })),
          },
        ],
      },
    });
    return true;
  } catch (err: any) {
    console.error(
      `[WhatsApp] Template "${options.templateName || WHATSAPP_TEMPLATES.INVOICE_WITH_DOCUMENT}" send failed for ${phone}:`,
      err?.message || err
    );
    return false;
  }
}

/**
 * Send the invoice template at most once per (purpose, referenceId).
 * Falls back to the plain-text invoice_shared template when the document
 * template is not yet approved, so the customer still hears from us.
 */
export async function sendDocumentTemplateOnce(options: {
  to: string;
  purpose: string;
  referenceId: string;
  base64: string;
  filename: string;
  invoiceNumber: string;
  orderNumber: string;
  total: string;
  signedUrl?: string | null;
  payload?: unknown;
}): Promise<boolean> {
  const { to, purpose, referenceId, invoiceNumber, orderNumber, total, signedUrl, payload } = options;

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

  const bodyParams = [
    orderNumber,
    invoiceNumber,
    orderNumber,
    total,
    signedUrl || 'Not available',
  ];

  let delivered = await sendDocumentTemplate({
    to: phone,
    base64: options.base64,
    filename: options.filename,
    bodyParams,
  });

  // The document template is new; if Meta has not approved it yet, fall back to
  // the text-only invoice template so the customer is not left in silence.
  let usedTemplate: string = WHATSAPP_TEMPLATES.INVOICE_WITH_DOCUMENT;
  if (!delivered) {
    delivered = await sendTemplate(phone, WHATSAPP_TEMPLATES.INVOICE_SHARED, [orderNumber, total]);
    usedTemplate = WHATSAPP_TEMPLATES.INVOICE_SHARED;
  }

  await logSend({
    recipient: phone,
    templateName: usedTemplate,
    messageType: delivered ? 'template' : 'failed',
    purpose,
    referenceId,
    status: delivered ? 'sent' : 'failed',
    error: delivered ? undefined : 'Delivery attempt failed',
    payload,
  });

  return delivered;
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
  sendDocumentTemplate,
  sendDocumentTemplateOnce,
  sendOnce,
  wasSent,
};
