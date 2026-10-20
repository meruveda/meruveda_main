import { Router } from 'express';
import { login, register, getMe, forgotPassword, resetPassword, getPreferences, updatePreferences, getCustomerPreferences } from '../controllers/authController';
import { sendOtp, verifyOtp, resendOtp, quickLogin, otpStatus, otpConfig, guestCheckout } from '../controllers/otpController';
import { updateCheckoutProfile } from '../controllers/otpController';
import { requireAuth, requireFullAuth } from '../middleware/auth';
import {
  createRateLimiter,
  loginLimiter,
  signupLimiter,
  otpSendLimiter,
  otpVerifyLimiter,
  otpSendPerPhoneLimiter,
  otpSendPerIpLimiter,
  otpVerifyPerPhoneLimiter,
  otpVerifyPerIpLimiter,
  otpCooldownPerPhoneLimiter,
  otpHourlyPerPhoneLimiter,
  otpGlobalDailyLimiter,
  passwordResetLimiter,
  guestPerNumberLimiter,
  guestPerIpLimiter,
} from '../middleware/rateLimit';

const router = Router();

router.post('/register', signupLimiter, register as any);
router.post('/login', loginLimiter, login as any);
router.post('/forgot-password', passwordResetLimiter, forgotPassword as any);
router.post('/reset-password', passwordResetLimiter, resetPassword as any);

// No-OTP checkout sign-up/login (feature-flagged alternative to WhatsApp OTP).
// Strict rate limit: 10 / 10 min per IP+phone, 30 / 10 min per IP alone.
const quickLoginLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10, prefix: 'quicklogin' });
router.post('/quick-login', quickLoginLimiter, quickLogin as any);

// What the checkout needs to know before it renders. Public, never cached.
router.get('/otp/config', otpConfig as any);

// Guest checkout - name + number, no OTP. Only live when OTP_MODE=off.
const guestLimiter = [
  guestPerNumberLimiter,
  guestPerIpLimiter,
  createRateLimiter({ windowMs: 60 * 60_000, max: 20, prefix: 'guest-session' }),
];
router.post('/guest', ...guestLimiter, guestCheckout as any);

// WhatsApp OTP login/registration used by the checkout form
// (disabled when OTP_ENABLED != true — see otpController).
//
// Three buckets each: composite (ip+phone), phone alone and IP alone. The
// composite bucket alone leaves both an IP-rotation flood against one number
// and a one-host spray across many numbers completely unthrottled.
// On top of those: a hard 30s cooldown per number, a 5/hour per-number cap
// and one deployment-wide daily send ceiling (OTP_DAILY_SEND_CAP).
router.post(
  '/otp/send',
  otpCooldownPerPhoneLimiter,
  otpHourlyPerPhoneLimiter,
  otpGlobalDailyLimiter,
  otpSendLimiter,
  otpSendPerPhoneLimiter,
  otpSendPerIpLimiter,
  sendOtp as any,
);
router.post(
  '/otp/resend',
  otpCooldownPerPhoneLimiter,
  otpHourlyPerPhoneLimiter,
  otpGlobalDailyLimiter,
  otpSendLimiter,
  otpSendPerPhoneLimiter,
  otpSendPerIpLimiter,
  resendOtp as any,
);
router.post(
  '/otp/verify',
  otpVerifyLimiter,
  otpVerifyPerPhoneLimiter,
  otpVerifyPerIpLimiter,
  verifyOtp as any
);
router.put('/profile', requireAuth as any, updateCheckoutProfile as any);

// Reports whether phone verification is currently required. The storefront
// calls this before checkout so it can fall back to "order without
// verification" while no AUTHENTICATION template is approved — the store must
// never be blocked by a pending Meta review.
router.get('/otp/status', otpStatus as any);

router.get('/me', requireAuth as any, getMe as any);
// Account self-deletion is disabled (non-returnable store policy keeps order
// history for invoicing). Explicitly reject direct calls so removed UI can't
// be bypassed via API.
router.delete('/me', (_req, res) => res.status(410).json({ error: { message: 'Account deletion is disabled. Please contact support.' } }));
router.get('/preferences', requireAuth as any, getPreferences as any);
router.post('/preferences', requireAuth as any, updatePreferences as any);
router.get('/preferences/:userId', requireAuth as any, getCustomerPreferences as any);

export default router;
