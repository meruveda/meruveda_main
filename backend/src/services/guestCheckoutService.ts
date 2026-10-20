/**
 * Guest checkout - the "name + number" order flow.
 *
 * Used while WhatsApp phone verification is unavailable (OTP_MODE=off). The
 * customer gives a name and a mobile number, and the order goes through with
 * the number flagged as unverified.
 *
 * The security rule that matters: a guest session NEVER exposes an existing
 * account. If the number already belongs to an account, the guest gets a
 * SEPARATE guest identity - never that account's session - and the guest
 * session may only place an order and read that one order.
 */
import { config } from '../config/env';
import * as usersRepo from '../database/repos/users';
import * as activityRepo from '../database/repos/activityLogs';
import { generateToken } from '../utils/jwt';
import { hasColumn } from './schemaGuard';
import { normalizePhone } from './whatsappService';

export interface GuestCheckoutInput {
  name?: string;
  phone?: string;
  /**
   * A field a human never fills in. Bots fill everything they see, so a
   * filled honeypot means the request is not from a person.
   */
  website?: string;
  /** A timestamp the page rendered; too fast means a script. */
  renderedAt?: number | string;
}

export type GuestCheckoutResult =
  | { ok: true; token: string; userId: string; created: boolean; phone: string }
  | { ok: false; status: number; message: string; silent?: boolean };

/** An Indian mobile number: 10 digits starting with 6-9. */
export function isValidIndianMobile(raw?: string | null): boolean {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d);
}

/**
 * Create (or reuse) a GUEST identity for a phone number.
 *
 * The guest identity is a separate user row. When the number already belongs
 * to a real account, that account is left completely alone: the guest gets a
 * new row, and the session it receives is scoped so it can never read the
 * account's orders, addresses or profile.
 */
export async function guestCheckout(input: GuestCheckoutInput): Promise<GuestCheckoutResult> {
  // 1. The honeypot. A filled hidden field means a bot: answer as if it
  //    worked, so the bot learns nothing, but create nothing either.
  if (String(input.website || '').trim() !== '') {
    return { ok: false, status: 400, message: 'We could not process that request.', silent: true };
  }

  // 2. A page that was submitted implausibly fast was not filled in by a
  //    person. (Three seconds is well below a human's shortest form fill.)
  const renderedAt = Number(input.renderedAt || 0);
  if (renderedAt > 0 && Date.now() - renderedAt < 3000) {
    return { ok: false, status: 400, message: 'We could not process that request.', silent: true };
  }

  // 3. The name.
  const name = String(input.name || '').trim();
  if (name.length < 2) {
    return { ok: false, status: 400, message: 'Please enter your full name.' };
  }
  if (name.length > 120) {
    return { ok: false, status: 400, message: 'That name is too long.' };
  }

  // 4. The number: an Indian mobile, because the store ships inside India.
  if (!isValidIndianMobile(input.phone)) {
    return {
      ok: false,
      status: 400,
      message: 'Please enter a valid 10-digit Indian mobile number.',
    };
  }
  const phone = normalizePhone(input.phone);

  // 5. The guest identity. A NEW row every time - never an existing
  //    account's row, so no data of an existing account can be reached.
  const email = `guest+${crypto.randomUUID()}@meruveda.guest`;
  const passwordHash = `guest:${crypto.randomUUID()}`;
  const [firstName, ...rest] = name.split(/\s+/);

  const insertData: Record<string, any> = {
    email,
    password_hash: passwordHash,
    first_name: firstName || name,
    last_name: rest.length ? rest.join(' ') : null,
    phone,
    role: 'customer',
    active: true,
  };
  if (await hasColumn('users', 'phone_verified')) {
    // The number was never proven: that is the whole point of this flow.
    insertData.phone_verified = false;
  }
  if (await hasColumn('users', 'last_login_at')) {
    insertData.last_login_at = new Date().toISOString();
  }

  let created: any;
  try {
    created = await usersRepo.insertUser(insertData, '*');
  } catch (error: any) {
    console.error('[Guest] could not create the guest identity:', error?.message || error);
    return { ok: false, status: 500, message: 'We could not start the checkout. Please try again.' };
  }

  // The session is a GUEST session: it may place an order and read that one
  // order, and nothing else.
  const token = generateToken({
    id: created.id,
    email: created.email,
    role: 'customer',
    phone_verified: false,
    scope: 'guest',
  });

  try {
    await activityRepo.logActivity({
      user_id: created.id,
      action: 'guest_checkout',
      entity_type: 'users',
      entity_id: created.id,
      details: { phone },
    });
  } catch (err: any) {
    console.error('[Guest] could not log the checkout:', err?.message || err);
  }

  return { ok: true, token, userId: created.id, created: true, phone };
}

/** Is the guest checkout flow switched on? */
export function guestCheckoutEnabled(): boolean {
  return config.otpMode === 'off';
}
