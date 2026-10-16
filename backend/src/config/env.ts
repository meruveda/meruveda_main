// Only load .env file when running locally — in production (Vercel) env vars
// are injected natively and no .env file exists on the filesystem.
if (process.env.NODE_ENV !== 'production') {
  const dotenv = require('dotenv');
  const path = require('path');
  const envFile = '../../.env';
  dotenv.config({ path: path.resolve(__dirname, envFile) });
}

// Fail fast: JWT_SECRET must be explicitly set. A weak/guessable fallback
// would allow anyone to forge auth tokens, so we refuse to start without it.
if (!process.env.JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is not set. Server will not start without it.');
  process.exit(1);
}

if (!process.env.PAYU_MERCHANT_KEY) {
  console.error('❌ FATAL: PAYU_MERCHANT_KEY environment variable is not set. Server will not start without it.');
  process.exit(1);
}

if (!process.env.PAYU_SALT) {
  console.error('❌ FATAL: PAYU_SALT environment variable is not set. Server will not start without it.');
  process.exit(1);
}

import { parseAllowedOrigins } from './corsOrigins';

const nodeEnv = process.env.NODE_ENV || 'development';

// CORS allowlist. In production an empty ALLOWED_ORIGINS is fatal — the
// storefront would be locked out silently (or, worse, someone ships a
// wildcard later to "fix" it).
let allowedOriginsSet: Set<string>;
try {
  allowedOriginsSet = parseAllowedOrigins(process.env.ALLOWED_ORIGINS, nodeEnv);
} catch (err: any) {
  console.error(`❌ FATAL: ${err.message}`);
  process.exit(1);
}

export const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || '',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  shiprocketTestMode: process.env.SHIPROCKET_TEST_MODE === 'true',
  // Comma-separated list of origins the backend CORS policy allows (trimmed,
  // trailing slashes stripped, case-insensitive). Required in production.
  // Dev:  http://localhost:3000,http://localhost:5173,http://localhost:5174
  //       (plus any http://localhost:* / 127.0.0.1:* is auto-allowed in dev)
  // Prod: https://meruveda.com,https://admin.meruveda.com + each explicit
  //       Vercel preview URL you want to allow (never a *.vercel.app wildcard).
  allowedOrigins: [...allowedOriginsSet],
  // Base URL of the customer-facing frontend — used to construct absolute
  // redirect URLs for payment gateway callbacks.
  // In production plain-http values are upgraded to https so payment
  // redirects never go over an insecure connection.
  frontendUrl: (() => {
    const raw = process.env.FRONTEND_URL || 'http://localhost:3000';
    if (process.env.NODE_ENV === 'production' && raw.startsWith('http://')) {
      const host = raw.slice('http://'.length).split('/')[0];
      if (host !== 'localhost:3000' && !host.startsWith('localhost:') && host !== '127.0.0.1') {
        return `https://${raw.slice('http://'.length)}`;
      }
    }
    return raw;
  })(),
  // No hardcoded fallback: this key used to live in source control and must be
  // supplied via GOOGLE_IDENTITY_TOOLKIT_API_KEY (it is currently unused anyway).
  googleIdentityToolkitApiKey: process.env.GOOGLE_IDENTITY_TOOLKIT_API_KEY || '',
  payuMerchantKey: process.env.PAYU_MERCHANT_KEY || '',
  payuSalt: process.env.PAYU_SALT || '',
  payuMode: process.env.PAYU_MODE || 'test',
  payuBaseUrl: (process.env.PAYU_MODE === 'live') 
    ? 'https://secure.payu.in/_payment' 
    : 'https://test.payu.in/_payment',
  // Registered state of the seller for intra-state vs inter-state tax determination
  sellerGstState: 'Rajasthan',
  // Company GSTIN — confirmed.
  gstin: process.env.GSTIN || '08BFPPS7045C1Z4',
  // Shipping taxability flag — TODO: PENDING CLIENT CONFIRMATION.
  // Composite supply rule suggests shipping is taxable, defaulting to false.
  shippingIsTaxable: process.env.SHIPPING_IS_TAXABLE === 'true',
  // ---- WhatsApp Cloud API (Meta) ----
  whatsappApiToken: process.env.WHATSAPP_API_TOKEN || '',
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  whatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
  whatsappWebhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
  // Meta App Dashboard > Settings > Basic > App Secret. Used to verify the
  // X-Hub-Signature-256 header on inbound webhook POSTs.
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || '',
  // Shiprocket webhook shared token (x-api-key header).
  shiprocketWebhookToken: process.env.SHIPROCKET_WEBHOOK_TOKEN || '',
  // Store admin's WhatsApp number — receives every invoice + order notification.
  adminWhatsappNumber: process.env.ADMIN_WHATSAPP_NUMBER || '',
  // Meta Graph API version used for WhatsApp Cloud API calls.
  whatsappGraphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0',
  // ---- Scheduled jobs (7-day review request) ----
  // Shared secret Vercel Cron (or any scheduler) must send as `Authorization: Bearer <secret>`.
  cronSecret: process.env.CRON_SECRET || '',

  // ---- Upstash Redis (serverless-safe shared store) ----
  // Used by the rate limiter and cross-instance token caches. When unset the
  // backend falls back to in-process memory (dev only — see rateLimit.ts).
  upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL || '',
  upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN || '',

  // Hops of reverse proxy in front of the API (Vercel = 1) so req.ip is the
  // real client IP from X-Forwarded-For, not the proxy's address.
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 1),

  // ---- Post-order automation flags ----
  // SHIPROCKET_AUTO_PUSH=true -> postOrderConfirmed() becomes the single push
  //                            point for both COD placement and PayU success.
  //                            (default false — Shiprocket behaviour is
  //                             unchanged from before this work)
  // INVOICE_AUTO_SEND is now ON by default — the flag only exists so an operator
  // can pause invoice delivery during an incident. Set it to the literal string
  // "false" to disable; anything else (including unset) means enabled.
  invoiceAutoSend: process.env.INVOICE_AUTO_SEND !== 'false',
  shiprocketAutoPush: process.env.SHIPROCKET_AUTO_PUSH === 'true',

  // ---- Business identity printed on the tax invoice ----
  // Read from env only — never commit real values. `GSTIN` is the legacy name
  // still accepted so existing deployments keep working.
  businessName: (process.env.BUSINESS_NAME || '').trim(),
  businessAddress: (process.env.BUSINESS_ADDRESS || '').trim(),
  businessGstin: (process.env.BUSINESS_GSTIN || process.env.GSTIN || '').trim(),
  businessPhone: (process.env.BUSINESS_PHONE || '').trim(),
  businessEmail: (process.env.BUSINESS_EMAIL || '').trim(),

  // ---- Invoice PDF storage (private bucket + 7-day signed URLs) ----
  // Default MUST equal the bucket name the migrations create, otherwise storage
  // is silently skipped and orders.invoice_url stays NULL. The RLS migration
  // creates 'invoice' (private) and the invoice-automation migration creates it
  // too, so no env var is required. Matches the singular 'product-image'
  // convention.
  invoiceStorageBucket: (process.env.INVOICE_STORAGE_BUCKET || 'invoice').trim(),
  invoiceSignedUrlExpirySeconds: Math.max(
    60,
    Number(process.env.INVOICE_SIGNED_URL_EXPIRY_SECONDS) || 7 * 24 * 60 * 60
  ),
  // WhatsApp OTP checkout flow. Default false — the no-OTP quick-login flow
  // is active until OTP_ENABLED=true is set (and WhatsApp is configured).
  otpEnabled: process.env.OTP_ENABLED === 'true',
  // Base URL of this backend — used by the webhook docs helper.
  backendUrl: process.env.BACKEND_URL || '',

  // WhatsApp invoice template: name + language must match the approved template
  // in Meta Business Manager exactly. Configurable so operators can swap between
  // templates without a redeploy.
  whatsappInvoiceTemplateName: (process.env.WHATSAPP_INVOICE_TEMPLATE_NAME || 'invoice_with_document').trim(),
  whatsappInvoiceTemplateLang: (process.env.WHATSAPP_INVOICE_TEMPLATE_LANG || 'en').trim(),
};

// ---- Optional WhatsApp (Meta) slot ----------------------------------------
// Every one of these is optional. When WHATSAPP_API_TOKEN /
// WHATSAPP_PHONE_NUMBER_ID / the template name are unset, invoice delivery
// simply SKIPS WhatsApp quietly: no error, no attempt consumed, no failure
// state written. Fill them on Vercel and redeploy and delivery starts by itself.
export const invoiceWhatsapp = {
  configured: Boolean(
    process.env.WHATSAPP_API_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
  ),
  // Approved UTILITY template carrying a DOCUMENT header.
  templateName: (process.env.INVOICE_WA_TEMPLATE_NAME || 'INVOICE_WITH_DOCUMENT').trim(),
  templateLang: (process.env.INVOICE_WA_TEMPLATE_LANG || 'en_US').trim(),
  // true logs the exact payload and never calls Meta.
  dryRun: process.env.WHATSAPP_DRY_RUN === 'true',
  // How far back the delivery sweep looks for invoices that were issued but
  // never handed to WhatsApp (because the slot was empty at the time).
  backfillDays: Math.max(0, Number(process.env.WHATSAPP_BACKFILL_DAYS) || 2),
};

// Public storefront URL printed on the tax invoice. Built-in default is the
// live domain; FRONTEND_URL is honoured only when it is set AND is not a local
// dev host, so a legal document can never print "localhost".
const DEFAULT_STOREFRONT_URL = 'https://meruvedawellness.com';
export const storefrontUrl = (() => {
  const raw = (process.env.FRONTEND_URL || '').trim();
  if (!raw) return DEFAULT_STOREFRONT_URL;
  const host = raw.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  if (!host || /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(host) || host.endsWith('.local')) {
    return DEFAULT_STOREFRONT_URL;
  }
  return raw.replace(/\/$/, '');
})();

// ---------------------------------------------------------------------------
// Production environment audit.
//
// Fail-fast cases (server refuses to boot) are handled above: JWT_SECRET,
// PAYU_MERCHANT_KEY, PAYU_SALT, ALLOWED_ORIGINS.
//
// Everything below is checked once, at boot, and printed as a single report.
// A missing var here means a feature is silently degraded in production, which
// is exactly the class of problem that is invisible until a customer complains.
// ---------------------------------------------------------------------------
if (nodeEnv === 'production') {
  const fatal: string[] = [];
  const warn: string[] = [];

  // Without CRON_SECRET the three scheduled jobs fall back to "admin JWT
  // required", so every cron invocation 401s. That is fail-closed (good) but
  // it looks like the jobs are simply broken, so refuse to boot instead.
  if (!process.env.CRON_SECRET) {
    fatal.push(
      'CRON_SECRET — Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; without it all three scheduled jobs 401',
    );
  }

  // Rate limits and the Shiprocket token cache are per-instance in memory
  // without Upstash, so they reset on every cold start and are not shared
  // across concurrently-running instances.
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!upstashUrl || !upstashToken) {
    warn.push(
      'UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN — rate limits and the Shiprocket token cache are per-instance only (they reset on cold start and are not shared between instances)',
    );
  }

  // Database.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    fatal.push('SUPABASE_URL + SUPABASE_SERVICE_KEY — every read/write goes through these');
  }

  // Payment gateway. PAYU_MERCHANT_KEY/PAYU_SALT are already fatal above.
  if ((process.env.PAYU_MODE || 'live') === 'live' && !process.env.PAYU_BASE_URL) {
    warn.push('PAYU_BASE_URL — left unset, live checkout points at the PayU test host');
  }

  // Order fulfilment. COD orders need no Shiprocket credentials, but prepaid
  // fulfilment stops without them.
  if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) {
    warn.push('SHIPROCKET_EMAIL + SHIPROCKET_PASSWORD — order fulfilment (tracking, labels) is disabled');
  }

  // Transactional email: password resets and order/invoice mail.
  if (!process.env.RESEND_API_KEY) {
    warn.push('RESEND_API_KEY — password reset, order confirmation and invoice emails are not sent');
  }
  if (!process.env.EMAIL_FROM) {
    warn.push('EMAIL_FROM — Resend needs a verified From address');
  }

  // Absolute links (password reset) must point at the real storefront.
  if (!process.env.FRONTEND_URL) {
    warn.push('FRONTEND_URL — password reset links would point at http://localhost:3000');
  }

  // WhatsApp is an OPTIONAL slot. When it is unset the invoice pipeline skips
  // WhatsApp quietly and nothing is warned about: that is a supported state.
  if (process.env.WHATSAPP_API_TOKEN && !process.env.WHATSAPP_APP_SECRET) {
    warn.push('WHATSAPP_APP_SECRET — webhook signatures cannot be verified; receiveWebhook then rejects every call in production');
  }

  // Invoice: GST compliance needs a real GSTIN on the printed invoice.
  if (!(process.env.BUSINESS_GSTIN || process.env.GSTIN)) {
    warn.push('BUSINESS_GSTIN (or GSTIN) — invoices print without a GSTIN, which is not GST-compliant');
  }

// Invoice numbering: gapless numbering needs a sequence table; without one the
  // invoice still issues, using the order number as the invoice number.

  if (fatal.length) {
    console.error(
      '\n❌ FATAL: required production environment variables are missing:\n' +
        fatal.map((v) => `     - ${v}`).join('\n') +
        '\n   Server will not start. See backend/.env.example.\n',
    );
    process.exit(1);
  }

  if (warn.length) {
    console.warn(
      '\n⚠️  [env] production configuration is incomplete:\n' +
        warn.map((v) => `     - ${v}`).join('\n') +
        '\n   These features will be degraded or disabled. See backend/.env.example.\n',
    );
  }
}
