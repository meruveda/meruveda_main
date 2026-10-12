import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { supabase } from '../database/supabase';
import { config } from '../config/env';
import { hasColumn, hasTable } from './schemaGuard';
import { normalizePhone, sendOnce, WHATSAPP_TEMPLATES, sendTemplate } from './whatsappService';
import { canonicalPhone, phoneVariants, placeholderEmailFor } from '../utils/phone';

const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 45;
const PURPOSE = 'checkout_login';

export type OtpFailureReason = 'not_found' | 'expired' | 'already_used' | 'too_many_attempts' | 'invalid';

/**
 * `otps` is created by database/deltas/005. Refuse with a clear 503 rather than
 * letting PostgREST's missing-table error bubble up as an opaque 500 — the
 * checkout step this powers cannot fall back to anything else.
 */
async function assertOtpStoreAvailable(): Promise<void> {
  if (await hasTable('otps')) return;
  console.error('[OTP] Table "otps" is missing — apply database/deltas/005_otp_whatsapp_review_requests.sql.');
  throw Object.assign(new Error('Sign-in with OTP is temporarily unavailable. Please try again shortly.'), {
    status: 503,
  });
}

export const otpService = {
  ttlMinutes: OTP_TTL_MINUTES,

  /**
   * Generate + deliver a 6-digit OTP over WhatsApp.
   * Returns { expiresInSeconds } on success, or throws with a user-friendly message.
   */
  async sendOtp(phoneRaw: string): Promise<{ expiresInSeconds: number; devOtp?: string }> {
    const phone = normalizePhone(phoneRaw);
    if (!phone || phone.length < 10) {
      throw Object.assign(new Error('Please enter a valid mobile number.'), { status: 400 });
    }

    await assertOtpStoreAvailable();

    // Cooldown so the endpoint cannot be abused for spam.
    const { data: recent } = await supabase
      .from('otps')
      .select('created_at, consumed_at')
      .eq('phone', phone)
      .eq('purpose', PURPOSE)
      .is('consumed_at', null)
      .order('created_at', { ascending: false })
      .limit(1);

    if (recent && recent.length > 0) {
      const ageSeconds = (Date.now() - new Date(recent[0].created_at).getTime()) / 1000;
      if (ageSeconds < RESEND_COOLDOWN_SECONDS) {
        throw Object.assign(
          new Error(`Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - ageSeconds)}s before requesting a new code.`),
          { status: 429 }
        );
      }
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

    const { error } = await supabase.from('otps').insert({
      phone,
      code,
      purpose: PURPOSE,
      attempts: 0,
      max_attempts: OTP_MAX_ATTEMPTS,
      expires_at: expiresAt,
    });
    if (error) throw error;

    const delivered = await sendOnce({
      to: phone,
      purpose: 'otp_send',
      referenceId: `${phone}:${Date.now()}`,
      template: WHATSAPP_TEMPLATES.OTP,
      params: [code, String(OTP_TTL_MINUTES)],
      fallbackText: `Your MeruVeda verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
    });

    if (!delivered) {
      // Surface a clear message when WhatsApp credentials are missing/unapproved so
      // the checkout team can see exactly what is misconfigured.
      console.warn('[OTP] WhatsApp delivery failed — check WHATSAPP_* env vars and Meta template approval.');
    }

    return {
      expiresInSeconds: OTP_TTL_MINUTES * 60,
      ...(config.nodeEnv !== 'production' ? { devOtp: code } : {}),
    };
  },

  /** Validate a code. Consumes the row on success. */
  async verifyOtp(phoneRaw: string, code: string): Promise<{ ok: true } | { ok: false; reason: OtpFailureReason }> {
    const phone = normalizePhone(phoneRaw);
    const submitted = String(code || '').replace(/\D/g, '');
    if (!phone || !submitted) return { ok: false, reason: 'invalid' };

    await assertOtpStoreAvailable();

    const { data: rows } = await supabase
      .from('otps')
      .select('*')
      .eq('phone', phone)
      .eq('purpose', PURPOSE)
      .is('consumed_at', null)
      .order('created_at', { ascending: false })
      .limit(1);

    const row = rows && rows[0];
    if (!row) return { ok: false, reason: 'not_found' };
    if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };
    if (Number(row.attempts) >= Number(row.max_attempts)) return { ok: false, reason: 'too_many_attempts' };

    if (row.code !== submitted) {
      await supabase
        .from('otps')
        .update({ attempts: Number(row.attempts) + 1 })
        .eq('id', row.id);
      const remaining = Number(row.max_attempts) - (Number(row.attempts) + 1);
      if (remaining <= 0) return { ok: false, reason: 'too_many_attempts' };
      return { ok: false, reason: 'invalid' };
    }

    const { error } = await supabase
      .from('otps')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) throw error;

    return { ok: true };
  },

  /**
   * Login-or-register on OTP verification.
   * - number not found  => auto-create the customer (register)
   * - number found      => log them in and refresh name/phone (login)
   * Returns the user row (snake_case) ready for JWT issue.
   */
  async findOrCreateUserByPhone(phoneRaw: string, name?: string) {
    const phone = canonicalPhone(phoneRaw) || normalizePhone(phoneRaw);
    if (!phone) throw Object.assign(new Error('Please enter a valid mobile number.'), { status: 400 });

    const variants = phoneVariants(phoneRaw);
    const lookup = variants.length > 0 ? variants : [phone];

    const { data: existing } = await supabase
      .from('users')
      .select('*')
      .in('phone', lookup)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existing && existing.length > 0) {
      const user = existing[0];
      const patch: any = { updated_at: new Date().toISOString() };
      // `users.last_login_at` arrives in delta 005 — never let a missing
      // timestamp column roll back the name/phone refresh below.
      if (await hasColumn('users', 'last_login_at')) {
        patch.last_login_at = new Date().toISOString();
      }
      if (name && !user.first_name) {
        const [firstName, ...rest] = name.trim().split(/\s+/);
        patch.first_name = firstName || user.first_name;
        if (rest.length) patch.last_name = rest.join(' ');
      }
      const { data: updated } = await supabase.from('users').update(patch).eq('id', user.id).select('*').single();
      return { user: updated || user, created: false };
    }

    // users.email / password_hash are NOT NULL + UNIQUE in the base schema, so a
    // phone-only customer gets a deterministic placeholder identity.
    const placeholderEmail = placeholderEmailFor(phone);
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    const [firstName, ...rest] = (name || '').trim().split(/\s+/);

    const insertData: any = {
      email: placeholderEmail,
      password_hash: passwordHash,
      first_name: firstName || null,
      last_name: rest.length ? rest.join(' ') : null,
      phone,
      role: 'customer',
      active: true,
    };
    if (await hasColumn('users', 'last_login_at')) {
      insertData.last_login_at = new Date().toISOString();
    }

    const { data: created, error } = await supabase
      .from('users')
      .insert(insertData)
      .select('*')
      .single();

    if (error) {
      // UNIQUE violation = a racing request created it first; re-read.
      if (error.code === '23505') {
        const { data: retry } = await supabase.from('users').select('*').in('phone', lookup).limit(1);
        if (retry && retry[0]) return { user: retry[0], created: false };
      }
      throw error;
    }

    // Welcome message — never blocks the login flow.
    sendOnce({
      to: phone,
      purpose: 'welcome',
      referenceId: `welcome:${phone}`,
      template: WHATSAPP_TEMPLATES.WELCOME,
      params: [created.first_name || 'there'],
      fallbackText: 'Welcome to MeruVeda! Your account has been created.',
    }).catch(() => undefined);

    return { user: created, created: true };
  },
};
