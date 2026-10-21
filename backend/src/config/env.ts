// Only load .env file when running locally — in production (Vercel) env vars
// are injected natively and no .env file exists on the filesystem.
if (process.env.NODE_ENV !== 'production') {
  const dotenv = require('dotenv');
  const path = require('path');
  const envFile = '../../.env';
  dotenv.config({ path: path.resolve(__dirname, envFile) });
}

// Values pasted from a dashboard or a .env editor routinely pick up leading or
// trailing whitespace. One stray space in a URL or secret breaks the client in
// a way that is nearly invisible at runtime (a broken DB connection that only
// surfaced as a leaked connection string, for example). Normalise the critical
// keys once, here, before anything reads them.
const TRIM_ON_BOOT = [
  'DATABASE_URL',
  'DATABASE_URL_APP',
  'DATABASE_URL_UNPOOLED',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_PUBLIC_BASE_URL',
  'R2_BUCKET_MEDIA',
  'R2_BUCKET_INVOICES',
  'JWT_SECRET',
  'CRON_SECRET',
  'PAYU_MERCHANT_KEY',
  'PAYU_SALT',
  'SHIPROCKET_EMAIL',
  'SHIPROCKET_PASSWORD',
  'WHATSAPP_API_TOKEN',
  'WHATSAPP_APP_SECRET',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'FRONTEND_URL',
  'ALLOWED_ORIGINS',
  'OTP_HASH_PEPPER',
  'OTP_HASH_SECRET',
] as const;
const whitespaceHits: string[] = [];
for (const key of TRIM_ON_BOOT) {
  const value = process.env[key];
  if (typeof value === 'string' && value !== value.trim()) {
    whitespaceHits.push(key);
    process.env[key] = value.trim();
  }
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
  // ---- Neon Postgres ----
  // DATABASE_URL is pooled (runtime). DATABASE_URL_UNPOOLED is used by
  // migrations/DDL only. Both are read lazily by database/db.ts; leaving them
  // unset is fine in development so tsc/tests run offline.
  databaseUrl: (process.env.DATABASE_URL || '').trim(),
  databaseUrlUnpooled: (process.env.DATABASE_URL_UNPOOLED || '').trim(),
  // ---- Cloudflare R2 ----
  // The buckets must already exist (created in Phase B). Names/domains are
  // env-driven; nothing in the code hardcodes a public host.
  r2AccountId: process.env.R2_ACCOUNT_ID || '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  r2BucketMedia: process.env.R2_BUCKET_MEDIA || 'meruveda-media',
  r2BucketInvoices: process.env.R2_BUCKET_INVOICES || 'meruveda-invoices',
  r2PublicBaseUrl: (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
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
  // Each of these accepts two spellings so a .env written against either the
  // original names or the shorter documented ones works with no code change.
  // The first non-empty value wins; the legacy name is checked first because it
  // is what already running deployments set.
  whatsappApiToken: process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_TOKEN || '',
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  whatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
  whatsappWebhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
  // Template names + language for the three transactional sends. A template
  // name must match an APPROVED template in Meta exactly, including language.
  whatsappOtpTemplateName: (process.env.WHATSAPP_OTP_TEMPLATE_NAME || '').trim(),
  whatsappOrderTemplateName: (process.env.WHATSAPP_ORDER_TEMPLATE_NAME || '').trim(),
  whatsappReviewTemplateName: (process.env.WHATSAPP_REVIEW_TEMPLATE_NAME || '').trim(),
  whatsappTemplateLang: (process.env.WHATSAPP_TEMPLATE_LANG || 'en').trim(),
  // Master switch for WhatsApp INVOICE delivery. Default false = the WhatsApp
  // invoice channel is switched off and every other part of the order flow
  // behaves exactly as it did before this flag existed.
  whatsappInvoiceEnabled: process.env.WHATSAPP_INVOICE_ENABLED === 'true',
  // 'document' -> attach the PDF in the template's document header.
  // 'link'     -> put a signed, expiring URL in the template body instead.
  // Read from env only; never hardcoded per deployment.
  whatsappInvoiceMode: (
    process.env.WHATSAPP_INVOICE_MODE || 'document'
  ).trim().toLowerCase() === 'link' ? 'link' : 'document',
  // When true, sends are logged instead of dispatched. Hard-refused in
  // production (see the audit block below): a silent dry run in production
  // reports "OTP sent" to a customer who receives nothing.
  whatsappDryRun: process.env.WHATSAPP_DRY_RUN === 'true',
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
  // SHIPROCKET_AUTO_PUSH is ON by default: postOrderConfirmed() becomes the
  // single push point for both COD placement and PayU success. Set it to the
  // literal string "false" to pause automatic pushes during an incident; the
  // admin retry button and daily cron still work while it is off.
  // INVOICE_AUTO_SEND is now ON by default — the flag only exists so an operator
  // can pause invoice delivery during an incident. Set it to the literal string
  // "false" to disable; anything else (including unset) means enabled.
  invoiceAutoSend: process.env.INVOICE_AUTO_SEND !== 'false',
  shiprocketAutoPush: process.env.SHIPROCKET_AUTO_PUSH !== 'false',
  // Fallbacks used when an order item has no weight/dimension in the products
  // table. Shiprocket rejects 0 kg / 0 cm, so these must stay positive.
  shiprocketDefaultWeightKg:
    Number(process.env.SHIPROCKET_DEFAULT_WEIGHT_KG) > 0
      ? Number(process.env.SHIPROCKET_DEFAULT_WEIGHT_KG)
      : 0.5,
  shiprocketDefaultLengthCm:
    Number(process.env.SHIPROCKET_DEFAULT_LENGTH_CM) > 0
      ? Number(process.env.SHIPROCKET_DEFAULT_LENGTH_CM)
      : 10,
  shiprocketDefaultBreadthCm:
    Number(process.env.SHIPROCKET_DEFAULT_BREADTH_CM) > 0
      ? Number(process.env.SHIPROCKET_DEFAULT_BREADTH_CM)
      : 10,
  shiprocketDefaultHeightCm:
    Number(process.env.SHIPROCKET_DEFAULT_HEIGHT_CM) > 0
      ? Number(process.env.SHIPROCKET_DEFAULT_HEIGHT_CM)
      : 10,
  // Server-side pepper for OTP digests (src/utils/otpHash.ts). Must never be
  // sent to a client or stored in the database. Changing it invalidates every
  // outstanding OTP, which is acceptable because they live 5 minutes.
  // Accepts either spelling; OTP_HASH_PEPPER is the deployed name.
  otpHashPepper: process.env.OTP_HASH_PEPPER || process.env.OTP_HASH_SECRET || '',

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
  /**
   * How the checkout treats phone verification.
   *
   *   'auto' (default) - an OTP is required when Meta has approved an
   *                       AUTHENTICATION template, and skipped (with the
   *                       order flagged unverified) when it has not.
   *   'on'              - an OTP is always required.
   *   'off'             - no OTP: the customer checks out with name + number.
   *
   * This is the switch that lets the store take orders while a WhatsApp
   * template is being reviewed. Setting it back to 'auto' restores the OTP
   * flow with no code change.
   */
  otpMode: (() => {
    const raw = (process.env.OTP_MODE || 'auto').trim().toLowerCase();
    return raw === 'on' || raw === 'off' ? raw : 'auto';
  })(),
  /**
   * The storefront account pages (login, signup, forgot/reset password and
   * everything under /account).
   *
   * While this is false the ONLY way a customer identifies themselves is the
   * checkout contact step (name + number + Continue). The pages are not
   * deleted - they are switched off, so setting
   * ACCOUNT_PAGES_ENABLED=true brings every one of them back unchanged.
   *
   * The admin app is NOT affected: the admin signs in on /admin/login, which
   * is a separate app with its own session.
   */
  accountPagesEnabled: (process.env.ACCOUNT_PAGES_ENABLED || '').trim().toLowerCase() === 'true',
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
  // Master switch (WHATSAPP_INVOICE_ENABLED). Off = the WhatsApp invoice
  // channel is inert and the order flow is byte-for-byte what it was before.
  enabled: config.whatsappInvoiceEnabled,
  // `document` attaches the PDF in the template's document header; `link` puts
  // a signed, expiring URL in the template body.
  mode: config.whatsappInvoiceMode,
  configured: Boolean(
    (process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_TOKEN) &&
      process.env.WHATSAPP_PHONE_NUMBER_ID
  ),
  // Approved UTILITY template carrying a DOCUMENT header (or a plain link body
  // when mode is 'link'). Name + language come from env only.
  templateName: (
    process.env.WHATSAPP_INVOICE_TEMPLATE_NAME ||
    process.env.INVOICE_WA_TEMPLATE_NAME ||
    'invoice_with_document'
  ).trim(),
  templateLang: (
    process.env.WHATSAPP_TEMPLATE_LANG ||
    process.env.INVOICE_WA_TEMPLATE_LANG ||
    'en'
  ).trim(),
  // true logs the exact payload and never calls Meta.
  dryRun: process.env.WHATSAPP_DRY_RUN === 'true',
  // How far back the delivery sweep looks for invoices that were issued but
  // never handed to WhatsApp (because the slot was empty at the time).
  //
  // The default is deliberately wide: when Meta finally approves the invoice
  // template, EVERY invoice that was generated in the meantime must go out,
  // not just the last couple of days. The sweep sends at most 20 per run, so
  // a large backlog drains over a few runs instead of never.
  backfillDays: Math.max(0, Number(process.env.WHATSAPP_BACKFILL_DAYS) || 365),
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

  // Database. The API cannot serve a single request without Postgres.
  if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_APP) {
    fatal.push('DATABASE_URL — every read/write goes through Neon Postgres');
  }
  if (!process.env.DATABASE_URL_UNPOOLED) {
    warn.push('DATABASE_URL_UNPOOLED — migrations/DDL cannot run against the pooled endpoint');
  }

  // ---- Format checks ---------------------------------------------------
  // A variable can be present and still be unusable. Every check below
  // burned real debugging time once, so they fail (or warn) at boot instead.
  const runtimeDbUrl = process.env.DATABASE_URL_APP || process.env.DATABASE_URL || '';
  if (runtimeDbUrl && !runtimeDbUrl.includes('-pooler.')) {
    fatal.push(
      'DATABASE_URL / DATABASE_URL_APP must be the POOLED Neon endpoint (host contains "-pooler.") — the runtime connection string',
    );
  }
  if (
    process.env.DATABASE_URL_UNPOOLED &&
    process.env.DATABASE_URL_UNPOOLED.includes('-pooler.')
  ) {
    warn.push(
      'DATABASE_URL_UNPOOLED points at the pooled host — migrations/DDL may fail or behave oddly',
    );
  }
  if (process.env.R2_ACCOUNT_ID && !/^[0-9a-f]{32}$/i.test(process.env.R2_ACCOUNT_ID)) {
    fatal.push('R2_ACCOUNT_ID must be the 32-character hex account id (not a URL, not a key)');
  }
  if (process.env.R2_ACCESS_KEY_ID && /\s/.test(process.env.R2_ACCESS_KEY_ID)) {
    fatal.push('R2_ACCESS_KEY_ID contains whitespace inside the value');
  }
  if (process.env.R2_SECRET_ACCESS_KEY && /\s/.test(process.env.R2_SECRET_ACCESS_KEY)) {
    fatal.push('R2_SECRET_ACCESS_KEY contains whitespace inside the value');
  }
  // Copy-paste placeholders: the key exists but holds an obvious fake value.
  const PLACEHOLDER_KEYS = [
    'JWT_SECRET',
    'PAYU_MERCHANT_KEY',
    'PAYU_SALT',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'CRON_SECRET',
    'OTP_HASH_PEPPER',
    'OTP_HASH_SECRET',
  ];
  const placeholderHits = PLACEHOLDER_KEYS.filter((k) =>
    /^(changeme|change-me|dummy|example|placeholder|your[-_].+|<.+>|\{\{.+\}\}|test123|xxx+|fixme)$/i.test(
      process.env[k] || '',
    ),
  );
  if (placeholderHits.length) {
    fatal.push(`placeholder values found in: ${placeholderHits.join(', ')}`);
  }
  if (whitespaceHits.length) {
    warn.push(
      `whitespace auto-trimmed at boot from: ${whitespaceHits.join(', ')} — fix the stored value (this is how a connection string once broke in production)`,
    );
  }

  // Object storage (media + invoice PDFs). Both buckets must exist already.
  if (
    !process.env.R2_ACCOUNT_ID ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY
  ) {
    fatal.push(
      'R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY — media and invoice PDFs cannot be stored',
    );
  }
  if (!process.env.R2_PUBLIC_BASE_URL) {
    warn.push('R2_PUBLIC_BASE_URL — public media URLs cannot be built, so product images will not render');
  } else if (!/^https:\/\/[^\s]+$/.test(process.env.R2_PUBLIC_BASE_URL)) {
    fatal.push('R2_PUBLIC_BASE_URL must be an https URL (it must not be a bucket name or account id)');
  }
  if (process.env.R2_BUCKET_MEDIA && /^https?:\/\//i.test(process.env.R2_BUCKET_MEDIA)) {
    fatal.push('R2_BUCKET_MEDIA must be a bucket name, not a URL');
  }
  if (process.env.R2_BUCKET_INVOICES && /^https?:\/\//i.test(process.env.R2_BUCKET_INVOICES)) {
    fatal.push('R2_BUCKET_INVOICES must be a bucket name, not a URL');
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

  // OTP digests are only as strong as their pepper. Without it the fallback is
  // a constant published in the source tree, so the otps table is effectively
  // brute-forceable by anyone holding a dump. Both documented spellings count.
  if (!(process.env.OTP_HASH_PEPPER || process.env.OTP_HASH_SECRET)) {
    warn.push('OTP_HASH_PEPPER (or OTP_HASH_SECRET) — OTP codes are hashed with a development fallback pepper; rotate before going live');
  }

  // WHATSAPP_DRY_RUN=true in production makes sendTemplate return true without
  // ever calling Meta, so the checkout answers "OTP sent to your WhatsApp
  // number" to a customer who receives nothing. That is a silent, false-green
  // failure, so it is fatal rather than a warning.
  if (process.env.WHATSAPP_DRY_RUN === 'true') {
    fatal.push(
      'WHATSAPP_DRY_RUN — must never be true in production: it reports "OTP sent" while sending nothing',
    );
  }

  // WhatsApp is an OPTIONAL slot. When it is unset the invoice pipeline skips
  // WhatsApp quietly and nothing is warned about: that is a supported state.
  if ((process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_TOKEN) && !process.env.WHATSAPP_APP_SECRET) {
    warn.push('WHATSAPP_APP_SECRET — webhook signatures cannot be verified; receiveWebhook then rejects every call in production');
  }

  // Invoice delivery on WhatsApp: the flag is on, so a missing template name
  // would silently deliver nothing.
  if (config.whatsappInvoiceEnabled && !config.whatsappInvoiceTemplateName) {
    fatal.push(
      'WHATSAPP_INVOICE_TEMPLATE_NAME — WHATSAPP_INVOICE_ENABLED is true but no invoice template name is set, so invoices would be issued and never delivered',
    );
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
