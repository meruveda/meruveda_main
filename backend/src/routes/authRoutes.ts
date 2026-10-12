import { Router } from 'express';
import { login, register, getMe, forgotPassword, resetPassword, getPreferences, updatePreferences, getCustomerPreferences } from '../controllers/authController';
import { sendOtp, verifyOtp, resendOtp, quickLogin } from '../controllers/otpController';
import { updateCheckoutProfile } from '../controllers/otpController';
import { requireAuth } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimit';

const router = Router();

router.post('/register', register as any);
router.post('/login', login as any);
router.post('/forgot-password', forgotPassword as any);
router.post('/reset-password', resetPassword as any);

// No-OTP checkout sign-up/login (feature-flagged alternative to WhatsApp OTP).
// Strict rate limit: 10 / 10 min per IP+phone, 30 / 10 min per IP alone.
const quickLoginLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10, prefix: 'quicklogin' });
router.post('/quick-login', quickLoginLimiter, quickLogin as any);

// WhatsApp OTP login/registration used by the checkout form
// (disabled when OTP_ENABLED != true — see otpController).
router.post('/otp/send', sendOtp as any);
router.post('/otp/resend', resendOtp as any);
router.post('/otp/verify', verifyOtp as any);
router.put('/profile', requireAuth as any, updateCheckoutProfile as any);

router.get('/me', requireAuth as any, getMe as any);
// Account self-deletion is disabled (non-returnable store policy keeps order
// history for invoicing). Explicitly reject direct calls so removed UI can't
// be bypassed via API.
router.delete('/me', (_req, res) => res.status(410).json({ error: { message: 'Account deletion is disabled. Please contact support.' } }));
router.get('/preferences', requireAuth as any, getPreferences as any);
router.post('/preferences', requireAuth as any, updatePreferences as any);
router.get('/preferences/:userId', requireAuth as any, getCustomerPreferences as any);

export default router;
