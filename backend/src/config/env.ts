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
  // BOTH DEFAULT OFF. With a flag off the app behaves exactly as before this
  // feature existed (legacy WhatsApp invoice / legacy Shiprocket push paths).
  // INVOICE_AUTO_SEND=true  -> postOrderConfirmed() sends the invoice itself
  //                            (email attachment + WhatsApp document) with an
  //                            atomic per-order claim and status bookkeeping.
  // SHIPROCKET_AUTO_PUSH=true -> postOrderConfirmed() becomes the single push
  //                            point for both COD placement and PayU success.
  invoiceAutoSend: process.env.INVOICE_AUTO_SEND === 'true',
  shiprocketAutoPush: process.env.SHIPROCKET_AUTO_PUSH === 'true',

  // ---- Business identity printed on the tax invoice ----
  // Read from env only — never commit real values. `GSTIN` is the legacy name
  // still accepted so existing deployments keep working.
  businessName: (process.env.BUSINESS_NAME || '').trim(),
  businessAddress: (process.env.BUSINESS_ADDRESS || '').trim(),
  businessGstin: (process.env.BUSINESS_GSTIN || process.env.GSTIN || '').trim(),

  // ---- Invoice PDF storage (private bucket + 7-day signed URLs) ----
  invoiceStorageBucket: (process.env.INVOICE_STORAGE_BUCKET || 'invoices').trim(),
  invoiceSignedUrlExpirySeconds: Math.max(
    60,
    Number(process.env.INVOICE_SIGNED_URL_EXPIRY_SECONDS) || 7 * 24 * 60 * 60
  ),
  // WhatsApp OTP checkout flow. Default false — the no-OTP quick-login flow
  // is active until OTP_ENABLED=true is set (and WhatsApp is configured).
  otpEnabled: process.env.OTP_ENABLED === 'true',
  // Base URL of this backend — used by the webhook docs helper.
  backendUrl: process.env.BACKEND_URL || '',
};
