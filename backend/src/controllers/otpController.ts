import { Request, Response, NextFunction } from 'express';
import { supabase } from '../database/supabase';
import { generateToken } from '../utils/jwt';
import { otpService } from '../services/otpService';
import { normalizePhone, isWhatsappConfigured } from '../services/whatsappService';
import { canonicalPhone, isPlaceholderEmail, isValidEmail, isValidPhone10 } from '../utils/phone';
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
    // OTP_DISABLED TEMPORARILY - re-enable by setting OTP_ENABLED=true.
    if (!config.otpEnabled) {
      return res.status(503).json({
        error: { message: 'OTP sign-in is temporarily disabled. Please use Sign up / Login instead.' },
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
      // Local development convenience only — never exposed in production.
      ...(config.nodeEnv !== 'production' && { devOtp: result.devOtp }),
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
      await supabase.from('users').update({ phone_verified: true }).eq('id', user.id);
    }

    const token = generateToken({ id: user.id, email: user.email, role: user.role, phone_verified: true });

    try {
      await supabase.from('activity_logs').insert({
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
let addressColumnOk = false;

async function supportsAddressColumn(): Promise<boolean> {
  if (addressColumnOk) return true;
  const { error } = await supabase.from('users').select('address').limit(1);
  // Only remember successes so a freshly applied migration is picked up without
  // a restart, while transient failures are simply retried next time.
  addressColumnOk = !error;
  return !error;
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
      const { data: owner } = await supabase
        .from('users')
        .select('id')
        .ilike('email', cleanEmail)
        .maybeSingle();
      if (!owner || owner.id === userId) patch.email = cleanEmail;
    }

    // Two literal selects: a dynamically built column list makes the Supabase
    // client fall back to an untyped result, and the missing-column case has to
    // be kept out of the request entirely.
    const result = persistAddress
      ? await supabase
          .from('users')
          .update(patch)
          .eq('id', userId)
          .select('id, email, first_name, last_name, phone, role, active, address')
          .single()
      : await supabase
          .from('users')
          .update(patch)
          .eq('id', userId)
          .select('id, email, first_name, last_name, phone, role, active')
          .single();

    if (result.error) throw result.error;
    const updated = result.data as any;

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
        await supabase.from('users').update({ phone_verified: false }).eq('id', user.id);
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
    });

    try {
      await supabase.from('activity_logs').insert({
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
