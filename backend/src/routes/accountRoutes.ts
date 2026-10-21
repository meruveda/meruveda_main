import { Router } from 'express';
import { createSession, getSession, logoutSession, getProfile, updateProfile } from '../controllers/customerSessionController';
import { createRateLimiter } from '../middleware/rateLimit';
import { requireCustomerSession } from '../middleware/auth';

/**
 * The customer session.
 *
 * `POST /session` is the "Continue" button of the checkout contact step: it
 * creates the customer profile and opens the session.
 *
 * It is rate limited PER IP and PER NUMBER, because it creates rows: a
 * script must not be able to flood the database with profiles, nor to use one
 * victim's number to exhaust somebody else's bucket.
 */
export const sessionPerNumberLimiter = createRateLimiter({
  windowMs: 60 * 60_000,
  max: 10,
  prefix: 'session-phone',
  keyMode: 'phone',
  secondaryKey: (req) => String(req.body?.phone || ''),
});

export const sessionPerIpLimiter = createRateLimiter({
  windowMs: 60 * 60_000,
  max: 30,
  prefix: 'session-ip',
  keyMode: 'ip',
});

const router = Router();

router.post('/session', sessionPerNumberLimiter, sessionPerIpLimiter, createSession as any);
router.get('/session', getSession as any);
router.post('/session/logout', logoutSession as any);

// The profile of THIS session: the name and the email can be edited, the
// phone is read-only (it is the identity of the session).
router.get('/profile', requireCustomerSession as any, getProfile as any);
router.put('/profile', requireCustomerSession as any, updateProfile as any);

export default router;
