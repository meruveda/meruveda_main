import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { isUniqueViolation } from '../database/db';
import * as usersRepo from '../database/repos/users';
import * as activityRepo from '../database/repos/activityLogs';
import * as settingsRepo from '../database/repos/settings';
import { generateToken } from '../utils/jwt';
import { config } from '../config/env';
import { sendEmail, getPasswordResetTemplate } from '../services/emailService';
import { hasColumn } from '../services/schemaGuard';
import {
  buildResetLink,
  generateResetToken,
  hashResetToken,
  RESET_TOKEN_TTL_MS,
} from '../utils/resetToken';
import {
  canonicalPhoneAny,
  classifyIdentifier,
  isPlaceholderEmail,
  isValidEmail,
  isValidPhoneAny,
  normalizePhone10,
  phoneVariants,
  placeholderEmailFor,
} from '../utils/phone';
import { verifyToken } from '../utils/jwt';

/**
 * The answer a customer gets when the account pages are switched off.
 *
 * The storefront tells them what to do instead (check out as a guest with a
 * name and a phone number) instead of a bare error.
 */
export const ACCOUNT_PAGES_DISABLED_MESSAGE =
  'Account sign-in is temporarily unavailable. You can order as a guest - just your name and phone number at checkout.';

/**
 * Registration is public, so `role` in the body can never be trusted on its own:
 * any visitor could otherwise POST { role: 'admin' } and escalate. The role field is
 * only honoured when the caller also presents a JWT that belongs to a real admin
 * account — which is exactly the case for the admin portal's "Add user" flow.
 */
const requestedRoleIsAdminTrusted = (req: Request): boolean => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return false;
    const payload = verifyToken(header.split(' ')[1]);
    return payload?.role === 'admin';
  } catch {
    return false;
  }
};

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, phone, password, firstName, lastName, role } = req.body;

    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: { message: 'Password must be at least 6 characters long' } });
    }

    const trustedAdminCaller = requestedRoleIsAdminTrusted(req);
    const requestedRole = trustedAdminCaller && (role === 'admin' || role === 'customer') ? role : 'customer';

    /**
     * The storefront sign-up page is switched off (ACCOUNT_PAGES_ENABLED is
     * false). A customer account cannot be created from the storefront; the
     * admin app may still add one (its "Add user" flow carries an admin JWT).
     */
    if (!config.accountPagesEnabled && !trustedAdminCaller) {
      return res.status(404).json({
        error: { message: ACCOUNT_PAGES_DISABLED_MESSAGE, code: 'ACCOUNT_PAGES_DISABLED' },
      });
    }

    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: { message: 'Please enter a valid email address' } });
    }
    if (cleanEmail && isPlaceholderEmail(cleanEmail)) {
      return res.status(400).json({ error: { message: 'Please enter a valid email address' } });
    }

    // A phone number is optional at signup, but when one is given it must be
    // valid for its country. Indian numbers are stored as 91XXXXXXXXXX, every
    // other country as +<code><national>.
    const storedPhone = canonicalPhoneAny(phone) || null;

    if (!storedPhone && !cleanEmail) {
      return res.status(400).json({ error: { message: 'Please enter a valid mobile number' } });
    }
    if (phone !== undefined && phone !== null && String(phone).trim() !== '' && !storedPhone) {
      return res.status(400).json({ error: { message: 'Please enter a valid mobile number' } });
    }

    if (storedPhone) {
      const phoneOwner = await usersRepo.findByPhoneVariants(phoneVariants(phone), 'id');
      if (phoneOwner) {
        return res.status(400).json({ error: { message: 'This mobile number is already registered. Please log in instead.' } });
      }
    }

    if (cleanEmail) {
      const emailOwner = await usersRepo.findByEmail(cleanEmail, 'id');
      if (emailOwner) {
        return res.status(400).json({ error: { message: 'This email address is already registered' } });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const emailToStore = cleanEmail || placeholderEmailFor(storedPhone as string);

    let newUser: any;
    try {
      newUser = await usersRepo.insertUser(
        {
          email: emailToStore,
          password_hash: passwordHash,
          first_name: firstName,
          last_name: lastName,
          phone: storedPhone,
          role: requestedRole,
          active: true,
        },
        'id, email, first_name, last_name, role, phone',
      );
    } catch (createError: any) {
      if (isUniqueViolation(createError)) {
        return res.status(400).json({ error: { message: 'This mobile number is already registered. Please log in instead.' } });
      }
      throw createError;
    }

    const token = generateToken({
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
    });

    const { first_name, last_name, ...rest } = newUser;
    const userToReturn = { ...rest, firstName: first_name, lastName: last_name };

    res.status(201).json({
      message: 'Registration successful',
      user: userToReturn,
      token,
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, phone, identifier, password } = req.body;

    if (!password) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    let user: any = null;
    const selectCols = 'id, email, phone, password_hash, first_name, last_name, role, active';

    if (phone && String(phone).trim()) {
      if (!isValidPhoneAny(phone)) {
        return res.status(401).json({ error: { message: 'Invalid credentials' } });
      }
      user = await usersRepo.findByPhoneVariants(phoneVariants(phone), selectCols);
    } else if (email && String(email).trim()) {
      user = await usersRepo.findByEmail(String(email).trim(), selectCols);
    } else if (identifier && String(identifier).trim()) {
      const classified = classifyIdentifier(identifier);
      if (classified.kind === 'phone') {
        user = await usersRepo.findByPhoneVariants(phoneVariants(classified.phone), selectCols);
      } else {
        user = await usersRepo.findByEmail(classified.email, selectCols);
      }
    } else {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    if (!user) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    /**
     * The storefront account pages are switched off (ACCOUNT_PAGES_ENABLED is
     * false): the only way a customer identifies themselves is the checkout
     * contact step. The ADMIN app is a separate app with its own sign-in
     * page, and it keeps working - only a customer account is refused.
     */
    if (!config.accountPagesEnabled && user.role !== 'admin') {
      return res.status(404).json({
        error: { message: ACCOUNT_PAGES_DISABLED_MESSAGE, code: 'ACCOUNT_PAGES_DISABLED' },
      });
    }

    if (!user.active) {
      return res.status(401).json({ error: { message: 'Account is disabled' } });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    try {
      await activityRepo.logActivity({
        user_id: user.id,
        action: 'login',
        entity_type: 'users',
        entity_id: user.id,
        details: {},
      });
    } catch (logError) {
      console.error('Failed to log login activity:', logError);
    }

    const { password_hash, first_name, last_name, ...rest } = user;
    const userToReturn = { ...rest, firstName: first_name, lastName: last_name };

    res.json({
      message: 'Login successful',
      user: userToReturn,
      token,
    });
  } catch (error) {
    next(error);
  }
};

export const getMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: { message: 'Unauthorized' } });

    const user = await usersRepo.findById(userId, 'id, email, first_name, last_name, role, phone, active');
    if (!user) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }

    const { first_name, last_name, ...rest } = user;
    const userToReturn = { ...rest, firstName: first_name, lastName: last_name };

    res.json({ user: userToReturn });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // The storefront "forgot password" page is switched off with the rest of
    // the account pages (ACCOUNT_PAGES_ENABLED is false).
    if (!config.accountPagesEnabled) {
      return res.status(404).json({
        error: { message: ACCOUNT_PAGES_DISABLED_MESSAGE, code: 'ACCOUNT_PAGES_DISABLED' },
      });
    }
    const GENERIC_OK = 'If an account exists, password reset instructions have been sent to its registered email address.';
    const { email, phone, identifier } = req.body;

    let user: any = null;
    if (phone && String(phone).trim()) {
      if (!isValidPhoneAny(phone)) return res.status(200).json({ message: GENERIC_OK });
      user = await usersRepo.findByPhoneVariants(phoneVariants(phone), 'id, email, first_name');
    } else if (email && String(email).trim()) {
      user = await usersRepo.findByEmail(String(email).trim(), 'id, email, first_name');
    } else if (identifier && String(identifier).trim()) {
      const classified = classifyIdentifier(identifier);
      if (classified.kind === 'phone') {
        user = await usersRepo.findByPhoneVariants(phoneVariants(classified.phone), 'id, email, first_name');
      } else {
        user = await usersRepo.findByEmail(classified.email, 'id, email, first_name');
      }
    } else {
      return res.status(400).json({ error: { message: 'Mobile number or email address is required' } });
    }

    if (!user) {
      return res.status(200).json({ message: GENERIC_OK });
    }

    if (isPlaceholderEmail(user.email)) {
      console.log(`Password reset requested for phone-only account ${user.id} (no email on file)`);
      return res.status(200).json({ message: GENERIC_OK });
    }

    if (!(await hasColumn('users', 'reset_password_token')) || !(await hasColumn('users', 'reset_password_expires'))) {
      console.error('[forgotPassword] users.reset_password_token/expires columns missing — apply database/deltas/007_mobile_auth.sql.');
      return res.status(200).json({ message: GENERIC_OK });
    }

    const token = generateResetToken();
    const tokenHash = hashResetToken(token);
    const expiry = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

    await usersRepo.updateUser(user.id, {
      reset_password_token: tokenHash,
      reset_password_expires: expiry,
      updated_at: new Date().toISOString(),
    });

    const resetLink = buildResetLink(config.frontendUrl, token);
    const htmlContent = getPasswordResetTemplate(resetLink, user.first_name || 'Customer');

    sendEmail(user.email, 'Reset Your MeruVeda Password', htmlContent).catch((mailErr) => {
      console.error('[forgotPassword] Failed to send email background task:', mailErr);
    });

    res.status(200).json({ message: GENERIC_OK });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // The storefront "reset password" page is switched off with the rest of
    // the account pages (ACCOUNT_PAGES_ENABLED is false).
    if (!config.accountPagesEnabled) {
      return res.status(404).json({
        error: { message: ACCOUNT_PAGES_DISABLED_MESSAGE, code: 'ACCOUNT_PAGES_DISABLED' },
      });
    }
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: { message: 'Token and new password are required' } });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: { message: 'Password must be at least 6 characters long' } });
    }

    if (!(await hasColumn('users', 'reset_password_token')) || !(await hasColumn('users', 'reset_password_expires'))) {
      return res.status(400).json({ error: { message: 'Invalid or expired password reset token' } });
    }

    const user = await usersRepo.findByResetTokenHash(hashResetToken(String(token)));
    if (!user) {
      return res.status(400).json({ error: { message: 'Invalid or expired password reset token' } });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await usersRepo.updateUser(user.id, {
      password_hash: passwordHash,
      reset_password_token: null,
      reset_password_expires: null,
      updated_at: new Date().toISOString(),
    });

    res.status(200).json({ message: 'Password has been reset successfully.' });
  } catch (error) {
    next(error);
  }
};

const DEFAULT_PREFS = {
  emailPromo: true,
  smsOrder: true,
  emailNewsletter: false,
  whatsappAlerts: true,
};

export const getPreferences = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: { message: 'Unauthorized' } });
    }

    const setting = await settingsRepo.getByKey(`notification_preferences_${userId}`);
    res.json({ data: setting ? setting.value : DEFAULT_PREFS });
  } catch (error) {
    next(error);
  }
};

export const updatePreferences = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: { message: 'Unauthorized' } });
    }

    const key = `notification_preferences_${userId}`;
    await settingsRepo.upsertSetting(key, req.body);

    res.json({ success: true, message: 'Preferences updated successfully.' });
  } catch (error) {
    next(error);
  }
};

export const getCustomerPreferences = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const currentUser = req.user;
    const { userId } = req.params;

    if (!currentUser) {
      return res.status(401).json({ error: { message: 'Unauthorized' } });
    }

    if (currentUser.role !== 'admin' && currentUser.id !== userId) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }

    const setting = await settingsRepo.getByKey(`notification_preferences_${userId}`);
    res.json({ data: setting ? setting.value : DEFAULT_PREFS });
  } catch (error) {
    next(error);
  }
};
