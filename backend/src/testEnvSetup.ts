// Test bootstrap: set the env vars that config/env.ts fails fast on, so the
// suite runs on CI (no backend/.env) and locally (dotenv won't override
// values that are already set).
process.env.JWT_SECRET ||= 'test-jwt-secret-0123456789abcdef0123456789';
process.env.PAYU_MERCHANT_KEY ||= 'test-merchant-key';
process.env.PAYU_SALT ||= 'test-salt';
process.env.ALLOWED_ORIGINS ||= 'http://localhost:3000';
// COD orders trigger a Shiprocket push inside createOrder unless auto-push is on
// (which moves the push to postOrderConfirmed). With neither set, the service
// would attempt a live Shiprocket call during unit tests.
process.env.SHIPROCKET_AUTO_PUSH ||= 'true';

export {};
