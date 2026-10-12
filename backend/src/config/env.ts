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

export const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || '',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  shiprocketTestMode: process.env.SHIPROCKET_TEST_MODE === 'true',
  // Comma-separated list of origins the backend CORS policy allows.
  // In dev: 'http://localhost:3000,http://localhost:5173,http://localhost:5174'
  // In prod: set to your production frontend and admin URLs.
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
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
  // Store admin's WhatsApp number — receives every invoice + order notification.
  adminWhatsappNumber: process.env.ADMIN_WHATSAPP_NUMBER || '',
  // Meta Graph API version used for WhatsApp Cloud API calls.
  whatsappGraphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0',
  // ---- Scheduled jobs (7-day review request) ----
  // Shared secret Vercel Cron (or any scheduler) must send as `Authorization: Bearer <secret>`.
  cronSecret: process.env.CRON_SECRET || '',
  // Base URL of this backend — used by the webhook docs helper.
  backendUrl: process.env.BACKEND_URL || '',
};
