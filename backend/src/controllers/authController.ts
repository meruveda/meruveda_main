import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { supabase } from '../database/supabase';
import { generateToken } from '../utils/jwt';
import { config } from '../config/env';
import { sendEmail, getPasswordResetTemplate } from '../services/emailService';
import { hasColumn } from '../services/schemaGuard';
import {
  canonicalPhone,
  classifyIdentifier,
  isPlaceholderEmail,
  isValidEmail,
  isValidPhone10,
  normalizePhone10,
  phoneVariants,
  placeholderEmailFor,
} from '../utils/phone';

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, phone, password, firstName, lastName, role } = req.body;

    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: { message: 'Password must be at least 6 characters long' } });
    }

    // Mobile number is the primary login identifier and is mandatory.
    if (!isValidPhone10(phone)) {
      return res.status(400).json({ error: { message: 'Please enter a valid 10-digit mobile number' } });
    }
    const phone10 = normalizePhone10(phone);
    const storedPhone = canonicalPhone(phone10);

    // Email is optional — kept for order notifications. Validate only when given.
    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: { message: 'Please enter a valid email address' } });
    }
    if (cleanEmail && isPlaceholderEmail(cleanEmail)) {
      return res.status(400).json({ error: { message: 'Please enter a valid email address' } });
    }

    // Prevent duplicate accounts for the same normalized mobile number,
    // matching every legacy stored spelling of it.
    const { data: phoneOwner, error: phoneCheckError } = await supabase
      .from('users')
      .select('id')
      .in('phone', phoneVariants(phone10))
      .maybeSingle();
    if (phoneCheckError) throw phoneCheckError;
    if (phoneOwner) {
      return res.status(400).json({ error: { message: 'This mobile number is already registered. Please log in instead.' } });
    }

    if (cleanEmail) {
      const { data: emailOwner, error: emailCheckError } = await supabase
        .from('users')
        .select('id')
        .ilike('email', cleanEmail)
        .maybeSingle();
      if (emailCheckError) throw emailCheckError;
      if (emailOwner) {
        return res.status(400).json({ error: { message: 'This email address is already registered' } });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // users.email is NOT NULL + UNIQUE, so phone-only accounts keep the same
    // deterministic placeholder identity the OTP flow already uses.
    const emailToStore = cleanEmail || placeholderEmailFor(storedPhone);

    // Create user
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        email: emailToStore,
        password_hash: passwordHash,
        first_name: firstName,
        last_name: lastName,
        phone: storedPhone,
        role: role || 'customer',
        active: true
      })
      .select('id, email, first_name, last_name, role, phone')
      .single();

    if (createError) {
      // UNIQUE race (placeholder email or phone taken between check and insert).
      if ((createError as any).code === '23505') {
        return res.status(400).json({ error: { message: 'This mobile number is already registered. Please log in instead.' } });
      }
      throw createError;
    }

    const token = generateToken({
      id: newUser.id,
      email: newUser.email,
      role: newUser.role
    });

    const { first_name, last_name, ...rest } = newUser;
    const userToReturn = { ...rest, firstName: first_name, lastName: last_name };

    res.status(201).json({
      message: 'Registration successful',
      user: userToReturn,
      token
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Mobile-first: the storefront sends { phone } (or { identifier });
    // the admin portal still sends { email }. All three are accepted so no
    // existing account or client breaks.
    const { email, phone, identifier, password } = req.body;

    if (!password) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    let user: any = null;
    let lookupError: any = null;

    const selectCols = 'id, email, phone, password_hash, first_name, last_name, role, active';

    if (phone && String(phone).trim()) {
      if (!isValidPhone10(phone)) {
        return res.status(401).json({ error: { message: 'Invalid credentials' } });
      }
      const found = await supabase
        .from('users')
        .select(selectCols)
        .in('phone', phoneVariants(phone))
        .order('created_at', { ascending: false })
        .limit(1);
      lookupError = found.error;
      user = found.data && found.data[0];
    } else if (email && String(email).trim()) {
      const found = await supabase
        .from('users')
        .select(selectCols)
        .ilike('email', String(email).trim())
        .maybeSingle();
      lookupError = found.error;
      user = found.data;
    } else if (identifier && String(identifier).trim()) {
      const classified = classifyIdentifier(identifier);
      if (classified.kind === 'phone') {
        const found = await supabase
          .from('users')
          .select(selectCols)
          .in('phone', phoneVariants(classified.phone10))
          .order('created_at', { ascending: false })
          .limit(1);
        lookupError = found.error;
        user = found.data && found.data[0];
      } else {
        const found = await supabase
          .from('users')
          .select(selectCols)
          .ilike('email', classified.email)
          .maybeSingle();
        lookupError = found.error;
        user = found.data;
      }
    } else {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    // Generic message either way — never reveal whether an identifier has an account.
    if (lookupError || !user) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
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
      role: user.role
    });

    // Log the login activity (phone numbers are operational identifiers, not logged in full).
    try {
      await supabase.from('activity_logs').insert({
        user_id: user.id,
        action: 'login',
        entity_type: 'users',
        entity_id: user.id,
        details: {}
      });
    } catch (logError) {
      console.error('Failed to log login activity:', logError);
    }

    // Remove password hash from response and map snake_case to camelCase
    const { password_hash, first_name, last_name, ...rest } = user;
    const userToReturn = { ...rest, firstName: first_name, lastName: last_name };

    res.json({
      message: 'Login successful',
      user: userToReturn,
      token
    });
  } catch (error) {
    next(error);
  }
};

export const getMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: { message: 'Unauthorized' } });

    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, role, phone, active')
      .eq('id', userId)
      .single();

    if (error || !user) throw error;

    const { first_name, last_name, ...rest } = user;
    const userToReturn = { ...rest, firstName: first_name, lastName: last_name };

    res.json({ user: userToReturn });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Accepts a mobile number ({ phone } / { identifier }) or a legacy email
    // ({ email }). The reset link is always delivered to the account's
    // registered email address — there is no SMS/WhatsApp reset channel, so a
    // phone-only account without a real email on file is directed to support.
    const GENERIC_OK = 'If an account exists, password reset instructions have been sent to its registered email address.';
    const { email, phone, identifier } = req.body;

    let user: any = null;
    if (phone && String(phone).trim()) {
      if (!isValidPhone10(phone)) return res.status(200).json({ message: GENERIC_OK });
      const { data, error: findError } = await supabase
        .from('users')
        .select('id, email, first_name')
        .in('phone', phoneVariants(phone))
        .order('created_at', { ascending: false })
        .limit(1);
      if (!findError && data && data[0]) user = data[0];
    } else if (email && String(email).trim()) {
      const { data, error: checkError } = await supabase
        .from('users')
        .select('id, email, first_name')
        .ilike('email', String(email).trim())
        .maybeSingle();
      if (!checkError && data) user = data;
    } else if (identifier && String(identifier).trim()) {
      const classified = classifyIdentifier(identifier);
      if (classified.kind === 'phone') {
        const { data, error: findError } = await supabase
          .from('users')
          .select('id, email, first_name')
          .in('phone', phoneVariants(classified.phone10))
          .order('created_at', { ascending: false })
          .limit(1);
        if (!findError && data && data[0]) user = data[0];
      } else if (classified.email) {
        const { data, error: checkError } = await supabase
          .from('users')
          .select('id, email, first_name')
          .ilike('email', classified.email)
          .maybeSingle();
        if (!checkError && data) user = data;
      }
    } else {
      return res.status(400).json({ error: { message: 'Mobile number or email address is required' } });
    }

    // Always return success to protect user privacy and prevent enumeration.
    if (!user) {
      return res.status(200).json({ message: GENERIC_OK });
    }

    if (isPlaceholderEmail(user.email)) {
      // No real inbox on file — the generic reply avoids confirming account
      // existence; support can verify ownership out of band.
      console.log(`Password reset requested for phone-only account ${user.id} (no email on file)`);
      return res.status(200).json({ message: GENERIC_OK });
    }

    // reset_password_token / reset_password_expires arrive with delta 007. If
    // the migration has not been applied yet, fail soft (generic reply) rather
    // than surfacing a PostgREST 500.
    if (!(await hasColumn('users', 'reset_password_token')) || !(await hasColumn('users', 'reset_password_expires'))) {
      console.error('[forgotPassword] users.reset_password_token/expires columns missing — apply database/deltas/007_mobile_auth.sql.');
      return res.status(200).json({ message: GENERIC_OK });
    }

    // Generate secure random token and 1-hour expiry
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 3600000).toISOString(); // 1 hour

    // Update user record with token and expiry
    const { error: updateError } = await supabase
      .from('users')
      .update({
        reset_password_token: token,
        reset_password_expires: expiry,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    if (updateError) {
      throw updateError;
    }

    // Send password reset email
    const resetLink = `https://meruvedawellness.com/reset-password?token=${token}`;
    const htmlContent = getPasswordResetTemplate(resetLink, user.first_name || 'Customer');
    
    // Asynchronously send email so response is instant, but catch errors
    sendEmail(user.email, 'Reset Your MeruVeda Password', htmlContent).catch(mailErr => {
      console.error('[forgotPassword] Failed to send email background task:', mailErr);
    });

    res.status(200).json({ message: GENERIC_OK });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: { message: 'Token and new password are required' } });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: { message: 'Password must be at least 6 characters long' } });
    }

    // Token columns arrive with delta 007; without them no token can be valid.
    if (!(await hasColumn('users', 'reset_password_token')) || !(await hasColumn('users', 'reset_password_expires'))) {
      return res.status(400).json({ error: { message: 'Invalid or expired password reset token' } });
    }

    // Find user with valid token and not yet expired
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id, email')
      .eq('reset_password_token', token)
      .gt('reset_password_expires', new Date().toISOString())
      .maybeSingle();

    if (findError || !user) {
      return res.status(400).json({ error: { message: 'Invalid or expired password reset token' } });
    }

    // Hash the new password using bcrypt (matching rounds = 10 from register)
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Update the password and clear reset token columns
    const { error: updateError } = await supabase
      .from('users')
      .update({
        password_hash: passwordHash,
        reset_password_token: null,
        reset_password_expires: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    if (updateError) {
      throw updateError;
    }

    res.status(200).json({ message: 'Password has been reset successfully.' });
  } catch (error) {
    next(error);
  }
};

export const getPreferences = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: { message: 'Unauthorized' } });
    }

    const key = `notification_preferences_${userId}`;
    const { data: setting, error } = await supabase
      .from('settings')
      .select('*')
      .eq('key', key)
      .maybeSingle();

    const defaultPrefs = {
      emailPromo: true,
      smsOrder: true,
      emailNewsletter: false,
      whatsappAlerts: true
    };

    if (error) throw error;

    res.json({ data: setting ? setting.value : defaultPrefs });
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
    const value = req.body;

    const { data: existing } = await supabase
      .from('settings')
      .select('id')
      .eq('key', key)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('settings')
        .update({ value })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('settings')
        .insert({ key, value });
      if (error) throw error;
    }

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

    // Only allow admin or the owner
    if (currentUser.role !== 'admin' && currentUser.id !== userId) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }

    const key = `notification_preferences_${userId}`;
    const { data: setting, error } = await supabase
      .from('settings')
      .select('*')
      .eq('key', key)
      .maybeSingle();

    const defaultPrefs = {
      emailPromo: true,
      smsOrder: true,
      emailNewsletter: false,
      whatsappAlerts: true
    };

    if (error) throw error;

    res.json({ data: setting ? setting.value : defaultPrefs });
  } catch (error) {
    next(error);
  }
};
