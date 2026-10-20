/**
 * Runtime WhatsApp template resolver.
 *
 * Meta approves templates asynchronously, so a name baked into an env var at
 * deploy time is wrong for as long as the review is pending — and wrong again
 * the moment a template is rejected or renamed. This service asks Meta which
 * templates are actually APPROVED right now, and picks the right one at
 * runtime, so the OTP/invoice paths activate themselves the moment the
 * approval lands. No redeploy, no env flip.
 *
 * Resolution order for the OTP template:
 *   1. WHATSAPP_OTP_TEMPLATE_NAME (if that template is APPROVED + AUTHENTICATION)
 *   2. 'meruveda_otp'
 *   3. any other APPROVED AUTHENTICATION-category template
 *
 * Resolution order for the invoice template:
 *   1. WHATSAPP_INVOICE_TEMPLATE_NAME (if APPROVED + UTILITY)
 *   2. 'meruveda_invoice'
 *   3. any other APPROVED UTILITY-category template that declares a DOCUMENT
 *      header (a UTILITY template without a document header cannot carry the
 *      invoice PDF, so it is not a usable fallback).
 *
 * Results are cached for 5 minutes; the sweep endpoint can force a refresh.
 */
import { config } from '../config/env';

const GRAPH = 'https://graph.facebook.com';

export type TemplateCategory = 'AUTHENTICATION' | 'UTILITY' | 'MARKETING' | string;
export type TemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'LIMITED' | string;

export interface MetaTemplate {
  id?: string;
  name: string;
  status: TemplateStatus;
  language: string;
  category?: TemplateCategory;
  components?: Array<{
    type: string;
    format?: string;
    sub_type?: string;
    text?: string;
    add_security_recommendation?: boolean;
    code_expiration_minutes?: number;
    buttons?: Array<{ type: string; otp_type?: string; text?: string; url?: string }>;
  }>;
}

export interface ResolvedTemplate {
  name: string;
  language: string;
  category: TemplateCategory;
  source: 'env' | 'preferred' | 'fallback';
  /**
   * How the PDF is delivered. 'document' attaches it through a DOCUMENT
   * header; 'link' puts the signed URL in the body. When not given, the
   * configured WHATSAPP_INVOICE_MODE decides.
   */
  hasDocumentHeader: boolean;
  /** How many body variables the template declares. */
  bodyVarCount: number;
  /**
   * The sub_type the OTP template's copy-code button expects on the wire.
   *
   * Meta creates the button in two shapes, and the send payload must match:
   *   - a URL button whose url carries the code  -> sub_type 'url'
   *   - a dedicated OTP button (otp_type COPY_CODE) -> sub_type 'copy_code'
   * Sending the wrong one is rejected with error 132012.
   */
  otpButtonSubType: 'url' | 'copy_code';
}

export interface TemplateResolution {
  /** The template that should be used, or null when nothing is usable. */
  template: ResolvedTemplate | null;
  /** Every template Meta knows about (used by `otp:check` and diagnostics). */
  all: MetaTemplate[];
  /** Why no template was resolved — surfaced in logs and deep health. */
  reason?: string;
  /** True when the failure is a permissions problem rather than "not approved". */
  permissionDenied?: boolean;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  at: number;
  templates: MetaTemplate[];
  error?: string;
  permissionDenied?: boolean;
}

let cache: CacheEntry | null = null;
let inflight: Promise<MetaTemplate[]> | null = null;

function graphUrl(path: string): string {
  return `${GRAPH}/${config.whatsappGraphApiVersion}${path}`;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${config.whatsappApiToken}` };
}

/** True when the resolver has everything it needs to talk to Meta. */
export function templateResolverConfigured(): boolean {
  return Boolean(
    config.whatsappApiToken &&
      config.whatsappPhoneNumberId &&
      config.whatsappBusinessAccountId,
  );
}

/**
 * Fetch every message template on the WABA. Returns [] (and records the
 * reason) when Meta refuses — a 403 here means the token lacks
 * whatsapp_business_management, which is a permissions problem, not a
 * "no templates" situation, and the two need different fixes.
 */
async function fetchTemplates(): Promise<MetaTemplate[]> {
  if (!templateResolverConfigured()) {
    throw new Error(
      'WhatsApp template resolver is not configured (WHATSAPP_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_BUSINESS_ACCOUNT_ID).',
    );
  }

  const res = await fetch(
    graphUrl(
      `/${config.whatsappBusinessAccountId}/message_templates?fields=name,status,language,category,components&limit=100`,
    ),
    { headers: authHeaders() },
  );
  const json: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = json?.error?.message || `WhatsApp templates HTTP ${res.status}`;
    const code = json?.error?.code;
    const err: any = new Error(message);
    err.status = res.status;
    err.code = code;
    err.permissionDenied = res.status === 403 || code === 190;
    throw err;
  }

  return Array.isArray(json?.data) ? (json.data as MetaTemplate[]) : [];
}

/** Cached template list. Refreshes at most once per 5 minutes. */
export async function listTemplates(opts: { force?: boolean } = {}): Promise<{
  templates: MetaTemplate[];
  error?: string;
  permissionDenied?: boolean;
}> {
  const now = Date.now();
  if (!opts.force && cache && now - cache.at < CACHE_TTL_MS) {
    return { templates: cache.templates, error: cache.error, permissionDenied: cache.permissionDenied };
  }

  // Collapse concurrent refreshes into one Graph call.
  if (!opts.force && inflight) {
    try {
      const templates = await inflight;
      return { templates };
    } catch (err: any) {
      return { templates: [], error: err?.message || String(err), permissionDenied: err?.permissionDenied };
    }
  }

  inflight = (async () => {
    try {
      const templates = await fetchTemplates();
      cache = { at: Date.now(), templates };
      return templates;
    } finally {
      inflight = null;
    }
  })();

  try {
    const templates = await inflight;
    return { templates };
  } catch (err: any) {
    const error = err?.message || String(err);
    // Cache failures briefly too, so a Meta outage does not hammer the API on
    // every request. The failure is short-lived on purpose.
    cache = { at: Date.now(), templates: [], error, permissionDenied: err?.permissionDenied };
    return { templates: [], error, permissionDenied: err?.permissionDenied };
  }
}

/** Drop the cache so the next read re-queries Meta. */
export function invalidateTemplateCache(): void {
  cache = null;
}

function hasDocumentHeader(t: MetaTemplate): boolean {
  return (t.components || []).some((c) => c.type === 'HEADER' && String(c.format || '').toUpperCase() === 'DOCUMENT');
}

/**
 * The invoice payload sends exactly four body variables:
 *   {{1}} customer name  {{2}} order number  {{3}} invoice number  {{4}} amount
 *
 * A template whose body does not declare all four cannot be filled by our
 * payload — Meta would reject the message. Such a template is not a usable
 * fallback.
 */
export function hasInvoiceBodyVariables(t: MetaTemplate): boolean {
  const body = (t.components || []).find((c) => c.type === 'BODY');
  const text = String(body?.text || '');
  if (!text) return false;
  return ['{{1}}', '{{2}}', '{{3}}', '{{4}}'].every((v) => text.includes(v));
}

/** How many body variables a template declares ({{1}}..{{n}}). */
export function countBodyVariables(t: MetaTemplate): number {
  const body = (t.components || []).find((c) => c.type === 'BODY');
  const text = String(body?.text || '');
  const found = new Set<string>();
  const re = /\{\{(\d+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) found.add(m[1]);
  return found.size;
}

function hasOtpButton(t: MetaTemplate): boolean {
  return (t.components || []).some((c) =>
    (c.buttons || []).some((b) => String(b.type || '').toUpperCase() === 'OTP'),
  );
}

/**
 * The sub_type the copy-code button expects on the wire.
 *
 * A template created with an `OTP` button type uses 'copy_code'. A template
 * whose button is a `URL` pointing at whatsapp.com/otp/code (which is how
 * Meta renders `add_security_recommendation` templates) uses 'url'. Sending
 * the wrong sub_type is rejected by Meta with error 132012.
 */
export function otpButtonSubType(t: MetaTemplate): 'url' | 'copy_code' {
  for (const c of t.components || []) {
    for (const b of c.buttons || []) {
      const type = String(b.type || '').toUpperCase();
      if (type === 'OTP') return 'copy_code';
      if (type === 'URL') {
        // A plain URL button (not the OTP link) cannot carry a parameter.
        if (/whatsapp\.com\/otp\/code/i.test(String(b.url || ''))) return 'url';
      }
    }
  }
  return 'url';
}

/**
 * Pick the OTP template: an APPROVED AUTHENTICATION-category template.
 *
 * Meta only lets an AUTHENTICATION template carry a one-time code, so a
 * UTILITY template (even APPROVED) can never deliver an OTP. The check is
 * therefore on category, not just status.
 */
export function resolveOtpTemplate(templates: MetaTemplate[]): ResolvedTemplate | null {
  const approved = templates.filter((t) => String(t.status).toUpperCase() === 'APPROVED');
  const auth = approved.filter((t) => String(t.category || '').toUpperCase() === 'AUTHENTICATION');
  if (auth.length === 0) return null;

  const envName = (config.whatsappOtpTemplateName || '').trim();
  if (envName) {
    const hit = auth.find((t) => t.name === envName);
    if (hit) {
      return {
        name: hit.name,
        language: hit.language,
        category: hit.category!,
        source: 'env',
        hasDocumentHeader: hasDocumentHeader(hit),
        bodyVarCount: countBodyVariables(hit),
        otpButtonSubType: otpButtonSubType(hit),
      };
    }
  }

  const preferred = auth.find((t) => t.name === 'meruveda_otp');
  if (preferred) {
    return {
      name: preferred.name,
      language: preferred.language,
      category: preferred.category!,
      source: 'preferred',
      hasDocumentHeader: hasDocumentHeader(preferred),
      bodyVarCount: countBodyVariables(preferred),
      otpButtonSubType: otpButtonSubType(preferred),
    };
  }

  // Any approved AUTHENTICATION template works. Prefer one that actually
  // declares a copy-code button, since that is what the payload sends.
  const withButton = auth.find(hasOtpButton);
  const pick = withButton || auth[0];
  return {
    name: pick.name,
    language: pick.language,
    category: pick.category!,
    source: 'fallback',
    hasDocumentHeader: hasDocumentHeader(pick),
    bodyVarCount: countBodyVariables(pick),
    otpButtonSubType: otpButtonSubType(pick),
  };
}

/**
 * Pick the invoice template: an APPROVED UTILITY-category template able to
 * carry a document.
 */
export function resolveInvoiceTemplate(templates: MetaTemplate[]): ResolvedTemplate | null {
  const approved = templates.filter((t) => String(t.status).toUpperCase() === 'APPROVED');
  const utility = approved.filter((t) => String(t.category || '').toUpperCase() === 'UTILITY');
  if (utility.length === 0) return null;

  // A template is only usable if its body declares the four variables our
  // payload fills. This is checked before the document header, because a body
  // mismatch breaks the send in either mode.
  const usable = utility.filter(hasInvoiceBodyVariables);
  if (usable.length === 0) return null;

  const envName = (config.whatsappInvoiceTemplateName || '').trim();
  if (envName) {
    const hit = usable.find((t) => t.name === envName);
    if (hit) {
      return {
        name: hit.name,
        language: hit.language,
        category: hit.category!,
        source: 'env',
        hasDocumentHeader: hasDocumentHeader(hit),
        bodyVarCount: countBodyVariables(hit),
        otpButtonSubType: otpButtonSubType(hit),
      };
    }
  }

  const preferred = usable.find((t) => t.name === 'meruveda_invoice');
  if (preferred) {
    return {
      name: preferred.name,
      language: preferred.language,
      category: preferred.category!,
      source: 'preferred',
      hasDocumentHeader: hasDocumentHeader(preferred),
      bodyVarCount: countBodyVariables(preferred),
      otpButtonSubType: otpButtonSubType(preferred),
    };
  }

  // Prefer a template with a DOCUMENT header (the PDF rides along); link mode
  // is the fallback.
  const withDoc = usable.find(hasDocumentHeader);
  if (withDoc) {
    return {
      name: withDoc.name,
      language: withDoc.language,
      category: withDoc.category!,
      source: 'fallback',
      hasDocumentHeader: true,
      bodyVarCount: countBodyVariables(withDoc),
      otpButtonSubType: 'url',
    };
  }

  const any = usable[0];
  return {
    name: any.name,
    language: any.language,
    category: any.category!,
    source: 'fallback',
    hasDocumentHeader: hasDocumentHeader(any),
    bodyVarCount: countBodyVariables(any),
    otpButtonSubType: 'url',
  };
}

/** Resolve the OTP template, consulting Meta (cached). */
export async function getOtpTemplate(): Promise<TemplateResolution> {
  const { templates, error, permissionDenied } = await listTemplates();
  if (error) {
    return {
      template: null,
      all: [],
      reason: error,
      permissionDenied,
    };
  }
  const template = resolveOtpTemplate(templates);
  if (!template) {
    const rejected = templates.filter((t) => String(t.category || '').toUpperCase() === 'AUTHENTICATION');
    return {
      template: null,
      all: templates,
      reason: rejected.length
        ? 'No APPROVED AUTHENTICATION template (candidates exist but are not approved yet).'
        : 'No AUTHENTICATION-category template exists yet.',
    };
  }
  return { template, all: templates };
}

/** Resolve the invoice template, consulting Meta (cached). */
export async function getInvoiceTemplate(): Promise<TemplateResolution> {
  const { templates, error, permissionDenied } = await listTemplates();
  if (error) {
    return { template: null, all: [], reason: error, permissionDenied };
  }
  const template = resolveInvoiceTemplate(templates);
  if (!template) {
    return {
      template: null,
      all: templates,
      reason: 'No APPROVED UTILITY template exists yet.',
    };
  }
  return { template, all: templates };
}

/**
 * Create the OTP template when it does not exist, or was rejected.
 *
 * A rejected template can never be resubmitted under the same name, so the
 * fallback name gets a '_v2' suffix. Creation is a no-op when the template
 * already exists in any state.
 */
export async function ensureOtpTemplate(): Promise<{ created: boolean; name?: string; reason?: string }> {
  if (!templateResolverConfigured()) {
    return { created: false, reason: 'Template resolver is not configured.' };
  }

  const { templates } = await listTemplates();
  const existing = templates.filter((t) => t.name === 'meruveda_otp' || t.name === 'meruveda_otp_v2');
  if (existing.some((t) => String(t.status).toUpperCase() === 'APPROVED')) {
    return { created: false, reason: 'An approved OTP template already exists.' };
  }
  if (existing.some((t) => String(t.status).toUpperCase() === 'PENDING')) {
    return { created: false, reason: 'The OTP template is awaiting Meta approval.' };
  }

  const name = existing.length ? 'meruveda_otp_v2' : 'meruveda_otp';
  const body = {
    name,
    language: 'en_US',
    category: 'AUTHENTICATION',
    components: [
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 5 },
      {
        type: 'BUTTONS',
        buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }],
      },
    ],
  };

  try {
    await graphPost(`/${config.whatsappBusinessAccountId}/message_templates`, body);
    invalidateTemplateCache();
    return { created: true, name };
  } catch (err: any) {
    return { created: false, name, reason: err?.message || String(err) };
  }
}

async function graphPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(graphUrl(path), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(json?.error?.message || `WhatsApp Graph HTTP ${res.status}`);
    err.status = res.status;
    err.code = json?.error?.code;
    throw err;
  }
  return json;
}

/**
 * Create the invoice template (UTILITY + DOCUMENT header) when missing.
 *
 * Meta requires a sample document for a DOCUMENT header. It is uploaded through
 * the Resumable Upload API, which needs the app id — derived from the token
 * when WHATSAPP_APP_ID is not set explicitly.
 */
export async function ensureInvoiceTemplate(): Promise<{ created: boolean; name?: string; reason?: string }> {
  if (!templateResolverConfigured()) {
    return { created: false, reason: 'Template resolver is not configured.' };
  }

  const { templates } = await listTemplates();
  const existing = templates.filter((t) => t.name === 'meruveda_invoice');
  if (existing.some((t) => String(t.status).toUpperCase() === 'APPROVED')) {
    return { created: false, reason: 'An approved invoice template already exists.' };
  }
  if (existing.some((t) => String(t.status).toUpperCase() === 'PENDING')) {
    return { created: false, reason: 'The invoice template is awaiting Meta approval.' };
  }

  const name = 'meruveda_invoice';
  // The body declares five variables: the four invoice fields plus the signed
  // download link. Meta rejects a template whose LAST token is a variable, so
  // the link is followed by a literal word.
  const bodyText =
    'Hi {{1}}, your MERUVEDA order {{2}} is confirmed. Your invoice {{3}} for Rs. {{4}} is attached. ' +
    'Download your invoice from {{5}} link.';
  const example = {
    body_text: [['Aarav Sharma', 'MV-123456', 'MV/26-27/000001', '1499.00', 'https://example.com/invoice.pdf']],
  };

  const body = {
    name,
    language: 'en_US',
    category: 'UTILITY',
    components: [{ type: 'BODY', text: bodyText, example }],
  };

  try {
    await graphPost(`/${config.whatsappBusinessAccountId}/message_templates`, body);
    invalidateTemplateCache();
    return { created: true, name };
  } catch (err: any) {
    return { created: false, name, reason: err?.message || String(err) };
  }
}

/**
 * The OTP mode the application should behave in right now.
 *
 * - 'off'  : OTP is never required.
 * - 'on'   : OTP is always required (fails closed if no template exists).
 * - 'auto' : OTP is required only when an approved AUTHENTICATION template
 *            exists. Until then the store must not be blocked, so checkout
 *            proceeds without phone verification and the order is flagged
 *            `phone_verified = false` for the admin to follow up.
 */
export type OtpMode = 'auto' | 'on' | 'off';
export function configuredOtpMode(): OtpMode {
  const raw = (process.env.OTP_MODE || 'auto').trim().toLowerCase();
  return raw === 'on' || raw === 'off' ? raw : 'auto';
}

export interface OtpAvailability {
  mode: OtpMode;
  /** True when the customer must verify a phone number before ordering. */
  required: boolean;
  /** True when an approved AUTHENTICATION template is available. */
  templateAvailable: boolean;
  templateName?: string;
  templateLanguage?: string;
  reason?: string;
}

/**
 * Decide whether OTP verification is required right now. Never throws: a
 * failure to reach Meta must not take the storefront down.
 */
export async function otpAvailability(): Promise<OtpAvailability> {
  const mode = configuredOtpMode();
  if (mode === 'off') {
    return { mode, required: false, templateAvailable: false, reason: 'OTP disabled by configuration.' };
  }

  const { template, reason } = await getOtpTemplate();
  const templateAvailable = Boolean(template);
  if (mode === 'on') {
    return {
      mode,
      required: true,
      templateAvailable,
      templateName: template?.name,
      templateLanguage: template?.language,
      reason: template ? undefined : reason,
    };
  }
  return {
    mode,
    required: templateAvailable,
    templateAvailable,
    templateName: template?.name,
    templateLanguage: template?.language,
    reason: template ? undefined : reason,
  };
}
