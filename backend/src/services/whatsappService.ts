import { config, invoiceWhatsapp } from '../config/env';
import * as whatsappLogRepo from '../database/repos/whatsappLog';
import { getOtpTemplate, getInvoiceTemplate } from './whatsappTemplateResolver';
import { classifyMetaError, type MetaErrorKind } from './metaErrors';

/**
 * WhatsApp Cloud API (Meta) client.
 *
 * All sends are best-effort: a failure is logged and swallowed so that an
 * OTP / payment / order flow can never be broken by a WhatsApp outage.
 *
 * Template names resolve from the environment so a .env written for one Meta
 * account works unchanged against another; the literals are only the fallback.
 *
 * A template name must match an APPROVED template in Meta exactly, and so must the
 */
export const WHATSAPP_TEMPLATES = {
  OTP: config.whatsappOtpTemplateName || 'otp_verification',
  WELCOME: 'welcome',
  ORDER_CONFIRMATION: config.whatsappOrderTemplateName || 'order_confirmation',
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
  REVIEW_REQUEST: config.whatsappReviewTemplateName || 'review_request',
} as const;

export type WhatsappTemplate = (typeof WHATSAPP_TEMPLATES)[keyof typeof WHATSAPP_TEMPLATES];

const graphBase = () =>
  `https://graph.facebook.com/${config.whatsappGraphApiVersion}/${config.whatsappPhoneNumberId}`;

/**
 * True when WhatsApp can actually send.
 *
 * A placeholder value counts as NOT configured. Without this check an unset-but-
 * present placeholder (the default in .env.example, and what ships in a copied
 * .env) reads as configured, so otpController's "WhatsApp is unavailable" guard
 * is skipped and the user gets a silent failure at send time instead of a clear
 * 503. It also keeps the test suite from attempting real Graph API calls.
 */
export function isWhatsappConfigured(): boolean {
  const token = config.whatsappApiToken;
  const id = config.whatsappPhoneNumberId;
  if (!token || !id) return false;
  if (/^(your-|<|placeholder)/i.test(token) || token === 'PLACEHOLDER_TOKEN') return false;
  if (/^(your-|<|placeholder)/i.test(id)) return false;
  return true;
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
    // The numeric code and subcode are attached so the error can be classified
    // (invalid number / rate limit / template problem / auth / service) and
    // logged precisely. They are never returned to the client.
    const err: any = new Error(message);
    err.status = res.status;
    err.code = json?.error?.code;
    err.errorSubcode = json?.error?.error_subcode;
    throw err;
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
    await whatsappLogRepo.logSend(entry);
    return true;
  } catch (err: any) {
    console.error('[WhatsApp] Failed to write message log:', err?.message || err);
    return true;
  }
}

/** Returns true when this (purpose, referenceId) pair was already DELIVERED. */
export async function wasSent(purpose: string, referenceId: string): Promise<boolean> {
  try {
    const data = await whatsappLogRepo.findByReference(purpose, referenceId, 'id, status');
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
    const data = await whatsappLogRepo.findByReference(
      purpose,
      referenceId,
      'status, error, message_type',
    );
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

  // Dry run: record that a send was skipped and report success without calling
  // Meta. The parameter VALUES are deliberately not printed — for the OTP path
  // they are the code itself.
  if (config.whatsappDryRun) {
    console.log(
      `[WhatsApp] DRY RUN — would send template "${templateName}" (lang ${config.whatsappTemplateLang || 'en'}) ` +
        `to ${phone} with ${params.length} body parameter(s). Values not logged.`
    );
    return true;
  }

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
        language: { code: config.whatsappTemplateLang || 'en' },
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

/* ------------------------------------------------------------------ */
/* Authentication-category templates (login_auth and friends)          */
/* ------------------------------------------------------------------ */

/**
 * Build the Meta payload for an AUTHENTICATION-category template.
 *
 * Meta requires the one-time code to be supplied TWICE:
 *
 *   1. as a body parameter  — {{1}} in the approved body text, and
 *   2. as the parameter of the COPY_CODE button at index 0, which is what
 *      produces the one-tap autofill in the WhatsApp UI.
 *
 * Sending only the body parameter is the single most common reason Meta
 * rejects an authentication template outright, so both are always sent here.
 *
 * The template NAME and LANGUAGE come from the environment only
 * (WHATSAPP_OTP_TEMPLATE_NAME / WHATSAPP_TEMPLATE_LANG). Nothing is hardcoded,
 * so the same build works against any Meta account.
 *
 * Exported pure so the exact payload shape can be asserted in tests without
 * touching the network.
 */
export function buildAuthenticationTemplatePayload(options: {
  to: string;
  code: string;
  templateName?: string;
  language?: string;
  /**
   * The copy-code button's sub_type on the wire. Meta accepts either
   * 'copy_code' (an OTP button) or 'url' (a URL button whose link carries the
   * code). It must match the approved template's button, otherwise Meta
   * rejects the message with error 132012.
   */
  buttonSubType?: 'url' | 'copy_code';
}): Record<string, any> {
  const phone = normalizePhone(options.to);
  const code = String(options.code ?? '');
  const name = String(options.templateName || config.whatsappOtpTemplateName || '').trim();
  const language = String(options.language || config.whatsappTemplateLang || 'en').trim();
  const subType = options.buttonSubType || 'url';

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'template',
    template: {
      name,
      language: { code: language },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: code }],
        },
        {
          type: 'button',
          sub_type: subType,
          // Index is a STRING on the wire, per Meta's template payload spec.
          index: '0',
          parameters: [{ type: 'text', text: code }],
        },
      ],
    },
  };
}

/**
 * Deliver the OTP on an AUTHENTICATION-category template.
 *
 * Returns true only when Meta accepted the message, so a rejected template is
 * surfaced to the caller instead of being reported to the customer as sent.
 */
/**
 * The outcome of an authentication-template send.
 *
 * `delivered` is true only when Meta accepted the message. On failure the
 * classified Meta error is attached so the caller can map it to a precise
 * customer message while the server log keeps the numeric code.
 */
export interface AuthenticationSendResult {
  delivered: boolean;
  errorKind?: MetaErrorKind;
  errorCode?: number;
  errorMessage?: string;
  /** The template that was used. */
  templateName?: string;
  templateLanguage?: string;
}

/**
 * Deliver the OTP on an AUTHENTICATION-category template.
 *
 * Returns true only when Meta accepted the message, so a rejected template is
 * surfaced to the caller instead of being reported to the customer as sent.
 */
export async function sendAuthenticationTemplate(to: string, code: string): Promise<boolean> {
  const result = await sendAuthenticationTemplateDetailed(to, code);
  return result.delivered;
}

/**
 * Deliver the OTP and report exactly why it failed.
 *
 * The Meta error code is logged here (server side only) and the caller turns
 * the classified kind into a customer-facing message. The code itself is never
 * sent to the client.
 */
export async function sendAuthenticationTemplateDetailed(
  to: string,
  code: string,
): Promise<AuthenticationSendResult> {
  const phone = normalizePhone(to);
  if (!phone || !isWhatsappConfigured()) {
    return { delivered: false, errorKind: 'auth', errorMessage: 'WhatsApp is not configured.' };
  }

  // The template is resolved at runtime so an approval that lands after deploy
  // activates the OTP path without a redeploy or an env flip. When Meta cannot
  // be reached we fall back to the configured name so the send is still
  // attempted with what the operator last set.
  const resolved = await resolveOtpTemplateForSend();
  const payload = buildAuthenticationTemplatePayload({
    to,
    code,
    templateName: resolved.name,
    language: resolved.language,
    buttonSubType: resolved.buttonSubType,
  });

  // Dry run reports success without calling Meta, and never prints the code.
  if (config.whatsappDryRun) {
    console.log(
      `[WhatsApp] DRY RUN — would send authentication template "${payload.template.name}" ` +
        `(lang ${payload.template.language.code}, button ${resolved.buttonSubType}) to ${phone}. Code not logged.`
    );
    return {
      delivered: true,
      templateName: resolved.name,
      templateLanguage: resolved.language,
    };
  }

  try {
    await graphPost(`${graphBase()}/messages`, payload);
    return {
      delivered: true,
      templateName: resolved.name,
      templateLanguage: resolved.language,
    };
  } catch (err: any) {
    const classified = classifyMetaError(err);
    console.error(
      `[WhatsApp] Authentication template "${payload.template.name}" (lang ${payload.template.language.code}) ` +
        `send failed for ${phone}: kind=${classified.kind} code=${classified.code ?? 'n/a'} ` +
        `status=${classified.status ?? 'n/a'} message=${classified.message ?? 'no message'}`,
    );

    // A language mismatch is the most common rejection when the configured
    // language does not match the approved one. Retry once with the approved
    // language before giving up.
    const fallback = await resolveApprovedLanguageFallback(resolved.language);
    if (fallback && fallback !== resolved.language) {
      console.warn(
        `[WhatsApp] Retrying authentication template "${resolved.name}" with approved language "${fallback}".`,
      );
      const retryPayload = buildAuthenticationTemplatePayload({
        to,
        code,
        templateName: resolved.name,
        language: fallback,
        buttonSubType: resolved.buttonSubType,
      });
      try {
        await graphPost(`${graphBase()}/messages`, retryPayload);
        return {
          delivered: true,
          templateName: resolved.name,
          templateLanguage: fallback,
        };
      } catch (retryErr: any) {
        const retryClassified = classifyMetaError(retryErr);
        console.error(
          `[WhatsApp] Authentication template retry with language "${fallback}" also failed for ${phone}: ` +
            `kind=${retryClassified.kind} code=${retryClassified.code ?? 'n/a'}`,
        );
        return {
          delivered: false,
          errorKind: retryClassified.kind,
          errorCode: retryClassified.code,
          errorMessage: retryClassified.message,
          templateName: resolved.name,
          templateLanguage: fallback,
        };
      }
    }
    return {
      delivered: false,
      errorKind: classified.kind,
      errorCode: classified.code,
      errorMessage: classified.message,
      templateName: resolved.name,
      templateLanguage: resolved.language,
    };
  }
}

/**
 * The template + language to use for an OTP send.
 *
 * Prefers the runtime-resolved (APPROVED) template. Falls back to the
 * configured name and language when Meta is unreachable.
 */
async function resolveOtpTemplateForSend(): Promise<{
  name: string;
  language: string;
  buttonSubType: 'url' | 'copy_code';
}> {
  const fallbackName = (config.whatsappOtpTemplateName || WHATSAPP_TEMPLATES.OTP).trim();
  const fallbackLang = (config.whatsappTemplateLang || 'en').trim();
  try {
    const { template } = await getOtpTemplate();
    if (template) {
      return {
        name: template.name,
        language: template.language,
        buttonSubType: template.otpButtonSubType,
      };
    }
  } catch (err: any) {
    console.error('[WhatsApp] Template resolution failed, using configured values:', err?.message || err);
  }
  return { name: fallbackName, language: fallbackLang, buttonSubType: 'url' };
}

/**
 * The language Meta reports as approved for the OTP template, when it differs
 * from the one we just tried. null when there is nothing better to try.
 */
async function resolveApprovedLanguageFallback(tried: string): Promise<string | null> {
  try {
    const { all } = await getOtpTemplate();
    const approved = all.find(
      (t) => String(t.status).toUpperCase() === 'APPROVED' &&
        String(t.category || '').toUpperCase() === 'AUTHENTICATION',
    );
    if (approved?.language && approved.language !== tried) return approved.language;
  } catch {
    // Best effort only.
  }
  return null;
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

/**
 * Build the invoice template payload. Exported pure so both env modes can be
 * asserted in tests without a network call.
 *
 * WHATSAPP_INVOICE_MODE picks the shape:
 *
 *   'document' (default) — the PDF rides in the template's DOCUMENT header.
 *     Body variables: {{1}} name {{2}} order no {{3}} invoice no {{4}} amount.
 *
 *   'link' — no attachment; a signed, expiring Storage URL goes in the body as
 *     {{5}}. Never a bare order id: the URL is minted by storage with an
 *     expiry (INVOICE_SIGNED_URL_EXPIRY_SECONDS, default 7 days) so a guessable
 *     /orders/:id link can never be used to fetch someone else's invoice.
 *
 * Template name and language come from env only.
 */
export function buildInvoiceTemplatePayload(options: {
  to: string;
  customerName: string;
  orderNumber: string;
  invoiceNumber: string;
  total: string;
  signedUrl: string | null;
  filename: string;
  templateName?: string;
  templateLanguage?: string;
  /**
   * How the PDF is delivered. 'document' attaches it through a DOCUMENT
   * header; 'link' puts the signed URL in the body. When not given, the
   * configured WHATSAPP_INVOICE_MODE decides.
   */
  mode?: 'document' | 'link';
}): Record<string, any> {
  const mode = options.mode || (invoiceWhatsapp.mode === 'link' ? 'link' : 'document');
  const bodyText = [
    options.customerName,
    options.orderNumber,
    options.invoiceNumber,
    options.total,
  ];

  const components: any[] = [];

  if (mode === 'document') {
    // Header MUST precede the body component.
    components.push({
      type: 'header',
      parameters: [
        {
          type: 'document',
          document: { link: options.signedUrl, filename: options.filename },
        },
      ],
    });
  } else {
    // Link mode: the URL is the 5th body variable.
    bodyText.push(String(options.signedUrl || ''));
  }

  components.push({
    type: 'body',
    parameters: bodyText.map((value) => ({ type: 'text', text: String(value ?? '') })),
  });

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizePhone(options.to),
    type: 'template',
    template: {
      name: String(options.templateName || invoiceWhatsapp.templateName).trim(),
      language: { code: String(options.templateLanguage || invoiceWhatsapp.templateLang).trim() },
      components,
    },
  };
}

/**
 * Deliver a tax invoice over the approved template, in whichever mode
 * WHATSAPP_INVOICE_MODE selects.
 *
 * Additive sibling of `sendInvoiceDocumentTemplate` (which is untouched and
 * still does exactly what it always did). `invoiceDispatchService` calls this
 * one; behaviour in 'document' mode is identical to the old sender.
 *
 * Outside the 24-hour customer-service window Meta only accepts a template
 * message, so the PDF is either attached via the template's DOCUMENT header or
 * handed over as a signed link.
 *
 * Never throws: a Meta error is logged and reported as `false`.
 * Returns true only when Meta accepted the message.
 */
export async function sendInvoiceTemplate(options: {
  to: string;
  customerName: string;
  orderNumber: string;
  invoiceNumber: string;
  total: string;
  signedUrl: string | null;
  filename: string;
}): Promise<boolean> {
  try {
    const phone = normalizePhone(options.to);
    if (!phone) return false;
    if (!options.signedUrl) {
      console.warn(`[WhatsApp] no signed invoice URL for ${options.invoiceNumber} — skipping.`);
      return false;
    }

    // Resolve the approved invoice template at runtime so the send activates
    // as soon as Meta approves it, with no redeploy and no env flip. Falls
    // back to the configured name when Meta is unreachable.
    const resolved = await resolveInvoiceTemplateForSend();
    const payload = buildInvoiceTemplatePayload({
      ...options,
      templateName: resolved.name,
      templateLanguage: resolved.language,
      mode: resolved.mode,
    });

    // Dry run logs the shape only. A signed URL is a bearer token for that
    // invoice, so it is never printed.
    if (invoiceWhatsapp.dryRun) {
      console.log(
        `[WhatsApp] DRY RUN — would send invoice ${options.invoiceNumber} via template ` +
          `"${payload.template.name}" (lang ${payload.template.language.code}, mode ${invoiceWhatsapp.mode}). ` +
          `URL not logged.`
      );
      return true;
    }

    const res = await fetch(`${graphBase()}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.whatsappApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    // Log the full Meta response: the HTTP status, the message id on success,
    // and error.code / error.message on failure. Without error.code a template
    // rejection and a rate limit look identical in the logs.
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(
        `[WhatsApp] invoice send FAILED for ${phone} — HTTP ${res.status} ` +
          `code=${json?.error?.code ?? 'n/a'} ` +
          `message=${json?.error?.message ?? 'no message'} ` +
          `detail=${JSON.stringify(json?.error?.error_data ?? null)}`
      );
      return false;
    }

    console.log(
      `[WhatsApp] invoice ${options.invoiceNumber} accepted by Meta — ` +
        `HTTP ${res.status} wamid=${json?.messages?.[0]?.id ?? 'n/a'}`
    );
    return true;
  } catch (err: any) {
    // Belt and braces: this runs from post-order background work and must never
    // reject into it.
    console.error('[WhatsApp] invoice send threw:', err?.message || err);
    return false;
  }
}

/**
 * The invoice template + language to use for a send.
 *
 * Prefers the runtime-resolved (APPROVED) template. Falls back to the
 * configured name and language when Meta is unreachable.
 */
async function resolveInvoiceTemplateForSend(): Promise<{
  name: string;
  language: string;
  mode: 'document' | 'link';
}> {
  const fallbackName = (config.whatsappInvoiceTemplateName || invoiceWhatsapp.templateName || '').trim();
  const fallbackLang = (invoiceWhatsapp.templateLang || 'en').trim();
  const fallbackMode: 'document' | 'link' =
    invoiceWhatsapp.mode === 'link' ? 'link' : 'document';
  try {
    const { template } = await getInvoiceTemplate();
    if (template) {
      // The delivery mode follows the template's own capabilities: a template
      // with a DOCUMENT header can carry the PDF as an attachment, one without
      // it must deliver the PDF as a link in the body.
      const mode: 'document' | 'link' = template.hasDocumentHeader
        ? 'document'
        : template.bodyVarCount >= 5
          ? 'link'
          : fallbackMode;
      return { name: template.name, language: template.language, mode };
    }
  } catch (err: any) {
    console.error('[WhatsApp] Invoice template resolution failed, using configured values:', err?.message || err);
  }
  return { name: fallbackName, language: fallbackLang, mode: fallbackMode };
}

/**
 * Deliver a tax invoice over the approved UTILITY template.
 *
 * Outside the 24-hour customer-service window Meta only accepts a template
 * message, so the PDF has to ride in the template's DOCUMENT header. We hand
 * Meta a signed Storage URL (`document.link`) rather than uploading the bytes:
 * the file is already stored, and this avoids a second copy of every invoice
 * living in Meta's media library.
 *
 * Template body variables, in order:
 *   {{1}} customer name  {{2}} order number  {{3}} invoice number  {{4}} amount
 *
 * Returns true only when Meta accepted the message. WHATSAPP_DRY_RUN=true logs
 * the exact payload and returns true without calling Meta.
 */
export async function sendInvoiceDocumentTemplate(options: {
  to: string;
  customerName: string;
  orderNumber: string;
  invoiceNumber: string;
  total: string;
  signedUrl: string | null;
  filename: string;
}): Promise<boolean> {
  const phone = normalizePhone(options.to);
  if (!phone) return false;
  if (!options.signedUrl) {
    console.warn(`[WhatsApp] no signed invoice URL for ${options.invoiceNumber} — skipping.`);
    return false;
  }

  const bodyParams = [
    options.customerName,
    options.orderNumber,
    options.invoiceNumber,
    options.total,
  ];

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'template',
    template: {
      name: invoiceWhatsapp.templateName,
      language: { code: invoiceWhatsapp.templateLang },
      components: [
        // Header MUST precede the body component.
        {
          type: 'header',
          parameters: [
            {
              type: 'document',
              document: { link: options.signedUrl, filename: options.filename },
            },
          ],
        },
        {
          type: 'body',
          parameters: bodyParams.map((value) => ({ type: 'text', text: String(value ?? '') })),
        },
      ],
    },
  };

  if (invoiceWhatsapp.dryRun) {
    console.log(
      `[WhatsApp] DRY RUN — would send invoice ${options.invoiceNumber} to ${phone}:`,
      JSON.stringify(payload)
    );
    return true;
  }

  const res = await fetch(`${graphBase()}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsappApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  // Log the full Meta response: the HTTP status, the message id on success, and
  // error.code / error.message on failure. Without error.code a template
  // rejection and a rate-limit look identical in the logs.
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(
      `[WhatsApp] invoice send FAILED for ${phone} — HTTP ${res.status} ` +
        `code=${json?.error?.code ?? 'n/a'} ` +
        `message=${json?.error?.message ?? 'no message'} ` +
        `detail=${JSON.stringify(json?.error?.error_data ?? null)}`
    );
    return false;
  }

  console.log(
    `[WhatsApp] invoice ${options.invoiceNumber} accepted by Meta — ` +
      `HTTP ${res.status} wamid=${json?.messages?.[0]?.id ?? 'n/a'}`
  );
  return true;
}

export const whatsappService = {
  isConfigured: isWhatsappConfigured,
  normalizePhone,
  sendText,
  sendTemplate,
  sendDocument,
  sendDocumentTemplate,
  sendDocumentTemplateOnce,
  sendInvoiceDocumentTemplate,
  sendInvoiceTemplate,
  sendAuthenticationTemplate,
  sendOnce,
  wasSent,
};
