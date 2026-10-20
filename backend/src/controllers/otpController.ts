import { Request, Response, NextFunction } from 'express';
import * as usersRepo from '../database/repos/users';
import * as activityRepo from '../database/repos/activityLogs';
import { generateToken } from '../utils/jwt';
import { otpService } from '../services/otpService';
import { normalizePhone, isWhatsappConfigured } from '../services/whatsappService';
import { canonicalPhone, isPlaceholderEmail, isValidEmail, isValidPhone10 } from '../utils/phone';
import { otpAvailability } from '../services/whatsappTemplateResolver';
import * as guestCheckoutService from '../services/guestCheckoutService';
import { config } from '../config/env';
import { hasColumn } from '../services/schemaGuard';

const MESSAGES: Record<string, string> = {
  not_found: 'No active OTP found for this number. Please request a new code.',
  expired: 'This OTP has expired. Please request a new code.',
  already_used: 'This OTP was already used. Please request a new code.',
  too_many_attempts: 'Too many incorrect attempts. Please request a new code.',
  invalid: 'The OTP you entered is incorrect. Please try again.',
};

const handleSend = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!config.otpEnabled) {
      return res.status(503).json({
        error: { message: 'OTP sign-in is temporarily disabled. Please try again shortly.' },
      });
    }

    const { phone } = req.body;

    // Fail loudly in production when WhatsApp credentials are missing —
    // otherwise checkout would silently never deliver an OTP.
    if (!isWhatsappConfigured() && config.nodeEnv === 'production') {
      return res.status(503).json({
        error: { message: 'WhatsApp OTP is temporarily unavailable. Please try again later.' },
      });
    }

    const result = await otpService.sendOtp(phone);
    res.json({
      message: 'OTP sent to your WhatsApp number.',
      expiresInSeconds: result.expiresInSeconds,
      // Local development convenience only. Mirrors the gate in otpService:
      // never in production, and never once real Meta credentials exist.
      ...(config.nodeEnv !== 'production' && !isWhatsappConfigured()
        ? { devOtp: result.devOtp }
        : {}),
    });
  } catch (error: any) {
    if (error.status) {
      return res.status(error.status).json({ error: { message: error.message } });
    }
    next(error);
  }
};

export const sendOtp = handleSend;
export const resendOtp = handleSend;

/**
 * Reports whether phone verification is currently required, and why.
 *
 * The storefront calls this before checkout so it can decide between
 * "verify the number" and "let the order through, flagged unverified". The
 * answer changes on its own the moment Meta approves the template, so the
 * storefront never needs a redeploy to pick it up.
 */
export const otpStatus = async (_req: Request, res: Response) => {
  try {
    // OTP_MODE=off switches the checkout over to the "name + number" flow.
    // It is reported here so the storefront can render the right form without
    // a rebuild, and so switching the mode back to 'auto' restores the OTP
    // flow with no code change.
    if (config.otpMode === 'off') {
      return res.json({
        data: {
          mode: 'off',
          required: false,
          guestCheckout: true,
          templateAvailable: false,
          templateName: null,
          templateLanguage: null,
          reason: 'OTP is switched off; guests check out with their name and number.',
          otpEnabled: config.otpEnabled,
          whatsappConfigured: isWhatsappConfigured(),
        },
      });
    }

    const availability = await otpAvailability();
    res.json({
      data: {
        mode: availability.mode,
        required: availability.required,
        guestCheckout: false,
        templateAvailable: availability.templateAvailable,
        templateName: availability.templateName || null,
        templateLanguage: availability.templateLanguage || null,
        // The reason is diagnostic only — it explains an internal state, so it
        // is safe to expose (it never contains a credential).
        reason: availability.reason || null,
        otpEnabled: config.otpEnabled,
        whatsappConfigured: isWhatsappConfigured(),
      },
    });
  } catch (error: any) {
    // Never fail the storefront's ability to place an order.
    console.error('[OTP] status probe failed:', error?.message || error);
    res.json({
      data: {
        mode: 'auto',
        required: false,
        guestCheckout: false,
        templateAvailable: false,
        templateName: null,
        templateLanguage: null,
        reason: 'Status probe failed.',
        otpEnabled: config.otpEnabled,
        whatsappConfigured: isWhatsappConfigured(),
      },
    });
  }
};

/**
 * PUBLIC: what the checkout needs to know before it renders.
 *
 * `{ otpRequired: boolean }` is the one value the storefront gates on. It is
 * read at request time (never baked into a build) so a store-wide switch -
 * OTP_MODE=off while a WhatsApp template is reviewed - takes effect on the
 * next page load, with no rebuild.
 */
export const otpConfig = async (_req: Request, res: Response) => {
  // Never cached: the mode can change at any moment.
  res.set('Cache-Control', 'no-store, max-age=0');
  try {
    if (config.otpMode === 'off') {
      return res.json({
        data: {
          otpRequired: false,
          mode: 'off',
          guestCheckout: true,
          message: 'Order updates and your invoice will come to this WhatsApp number.',
        },
      });
    }
    const availability = await otpAvailability();
    res.json({
      data: {
        otpRequired: availability.required,
        mode: availability.mode,
        guestCheckout: false,
        message: null,
      },
    });
  } catch (error: any) {
    console.error('[OTP] config probe failed:', error?.message || error);
    // The safe default is to require the OTP.
    res.json({
      data: { otpRequired: true, mode: 'auto', guestCheckout: false, message: null },
    });
  }
};

export const verifyOtp = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // OTP_DISABLED TEMPORARILY - re-enable by setting OTP_ENABLED=true.
    if (!config.otpEnabled) {
      return res.status(503).json({
        error: { message: 'OTP verification is temporarily disabled. Please use Sign up / Login instead.' },
      });
    }

    const { phone, code, name } = req.body;
    const result = await otpService.verifyOtp(phone, code);

    if (!result.ok) {
      return res.status(400).json({ error: { message: MESSAGES[result.reason] || MESSAGES.invalid } });
    }

    // Auto-register when the number is unknown, otherwise log the existing
    // customer in. Either way the order gets linked to this user id.
    const { user, created } = await otpService.findOrCreateUserByPhone(phone, name);

    // A successful OTP is the proof of ownership — flip phone_verified on.
    if (await hasColumn('users', 'phone_verified')) {
      await usersRepo.setPhoneVerified(user.id, true);
    }

    const token = generateToken({ id: user.id, email: user.email, role: user.role, phone_verified: true });

    try {
      await activityRepo.logActivity({
        user_id: user.id,
        action: created ? 'register_otp' : 'login_otp',
        entity_type: 'users',
        entity_id: user.id,
        details: { phone: normalizePhone(phone) },
      });
    } catch (logErr) {
      console.error('Failed to log OTP activity:', logErr);
    }

    const { password_hash, first_name, last_name, ...rest } = user;
    res.json({
      message: created ? 'Account created and verified.' : 'Mobile number verified.',
      user: { ...rest, firstName: first_name, lastName: last_name },
      token,
      isNewUser: created,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Persist the details collected in the checkout form (name / email / address).
 * Called after OTP verification so the latest form values always win.
 */

// `users.address` is introduced by database/deltas/005. When that delta has not
// been applied yet the column does not exist, and selecting/patching it would
// fail the entire profile update — silently dropping name, email and phone as
// well. Probe the column and skip it until the migration has run.
async function supportsAddressColumn(): Promise<boolean> {
  return hasColumn('users', 'address');
}

export const updateCheckoutProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: { message: 'Unauthorized' } });

    const { name, firstName, lastName, email, address, phone } = req.body;
    const patch: any = { updated_at: new Date().toISOString() };

    const resolvedFirst = firstName ?? (name ? String(name).trim().split(/\s+/)[0] : undefined);
    const resolvedLast = lastName ?? (name ? String(name).trim().split(/\s+/).slice(1).join(' ') : undefined);
    if (resolvedFirst !== undefined && resolvedFirst !== '') patch.first_name = resolvedFirst;
    if (resolvedLast !== undefined) patch.last_name = resolvedLast || null;

    const persistAddress = address !== undefined ? await supportsAddressColumn() : false;
    if (persistAddress) patch.address = address;

    if (phone) {
      const normalized = canonicalPhone(phone) || normalizePhone(phone);
      if (normalized) patch.phone = normalized;
    }

    if (email) {
      const cleanEmail = String(email).trim();
      if (!isValidEmail(cleanEmail) || isPlaceholderEmail(cleanEmail)) {
        return res.status(400).json({ error: { message: 'Please enter a valid email address' } });
      }
      // Only adopt the email if nobody else already owns it (users.email is UNIQUE).
      const owner = await usersRepo.findByEmail(cleanEmail, 'id');
      if (!owner || owner.id === userId) patch.email = cleanEmail;
    }

    // Two literal column lists: the missing-column case must stay out of the
    // request entirely, and the response shape must not change.
    const updated = await usersRepo.updateUserReturning(
      userId,
      patch,
      persistAddress
        ? 'id, email, first_name, last_name, phone, role, active, address'
        : 'id, email, first_name, last_name, phone, role, active',
    );
    if (!updated) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }

    res.json({
      message: 'Profile updated.',
      user: {
        id: updated.id,
        email: updated.email,
        firstName: updated.first_name,
        lastName: updated.last_name,
        phone: updated.phone,
        role: updated.role,
        ...(persistAddress ? { address: updated.address } : {}),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * No-OTP checkout sign-up / login.
 *
 * Given a name + 10-digit Indian mobile number:
 *   - number already in DB  => log the existing customer in
 *   - number unknown        => auto-create the customer, then log in
 *
 * SECURITY: this endpoint does NOT prove ownership of the phone number.
 * The issued JWT carries phone_verified=false so GET /api/orders/my (and
 * other sensitive reads) can refuse until a real OTP verification flips
 * the flag. Rate limiting lives on the route (createRateLimiter).
 */
/**
 * Guest checkout - place an order with a name and a number, no OTP.
 *
 * Only available when OTP_MODE=off. The session it returns is a GUEST
 * session: it may place an order and read that one order, and it can never
 * read an existing account's data.
 */
export const guestCheckout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!guestCheckoutService.guestCheckoutEnabled()) {
      return res.status(403).json({
        error: { message: 'Guest checkout is switched off. Please verify your WhatsApp number.' },
      });
    }

    const result = await guestCheckoutService.guestCheckout(req.body || {});
    if (!result.ok) {
      return res.status(result.status).json({ error: { message: result.message } });
    }

    res.json({
      message: 'You can check out now.',
      token: result.token,
      user: { id: result.userId, phone: result.phone, phone_verified: false, scope: 'guest' },
      isNewUser: true,
    });
  } catch (error: any) {
    next(error);
  }
};

export const quickLogin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, name } = req.body;

    if (!isValidPhone10(phone)) {
      return res.status(400).json({ error: { message: 'Please enter a valid 10-digit mobile number' } });
    }
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) {
      return res.status(400).json({ error: { message: 'Please enter your name' } });
    }

    const { user, created } = await otpService.findOrCreateUserByPhone(phone, cleanName);

    // New quick-login users start unverified; pre-existing users keep whatever
    // they already had (password accounts and OTP-verified ones stay usable).
    let phoneVerified = true;
    if (await hasColumn('users', 'phone_verified')) {
      if (created) {
        await usersRepo.setPhoneVerified(user.id, false);
        phoneVerified = false;
      } else {
        phoneVerified = user.phone_verified !== false;
      }
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
      phone_verified: phoneVerified,
      // A quick login never proved ownership of the number, so the session is
      // a checkout-only GUEST session. It may place an order and read that
      // order - it may not read the account history, the addresses, the cart
      // or the profile. Without this, typing somebody else's phone number
      // would hand over their account.
      scope: 'guest',
    });

    try {
      await activityRepo.logActivity({
        user_id: user.id,
        action: created ? 'register_quick' : 'login_quick',
        entity_type: 'users',
        entity_id: user.id,
        details: { phone: normalizePhone(phone) },
      });
    } catch (logErr) {
      console.error('Failed to log quick-login activity:', logErr);
    }

    const { password_hash, first_name, last_name, ...rest } = user;
    res.json({
      message: created ? 'Account created.' : 'Logged in.',
      user: {
        ...rest,
        firstName: first_name,
        lastName: last_name,
        phone_verified: phoneVerified,
      },
      token,
      isNewUser: created,
    });
  } catch (error) {
    next(error);
  }
};
