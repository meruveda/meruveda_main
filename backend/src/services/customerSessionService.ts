/**
 * The customer session created at the checkout contact step.
 *
 * While the storefront's password pages are switched off, the ONLY way a
 * customer identifies themselves is the checkout contact step: a name, a
 * mobile number and an email address. Pressing "Continue" creates (or
 * reuses) the customer profile and opens a long-lived session in THAT
 * browser - 90 days, httpOnly cookie plus a token for the API.
 *
 * THE SECURITY RULE
 * -----------------
 * An unverified session may only see the data it created itself.
 *
 *   - If the number does not belong to anybody yet, the profile is created
 *     and the session is attached to it.
 *   - If the number ALREADY belongs to a customer (verified, or with older
 *     orders), the session is NOT attached to that customer. It is a session
 *     of its own, and it sees only the orders and the addresses it created
 *     itself. The older profile, the older addresses and the older order
 *     history stay hidden.
 *
 * The response is IDENTICAL in both cases, so the endpoint can never be used
 * to find out whether a phone number is registered.
 *
 * When the WhatsApp OTP is switched on and the number is verified later, the
 * session is merged into the real customer and the older history becomes
 * visible - from that moment on.
 */
import * as usersRepo from '../database/repos/users';
import * as sessionsRepo from '../database/repos/customerSessions';
import { generateToken, isCustomerScope, verifyToken } from '../utils/jwt';
import { hasColumn } from './schemaGuard';
import { canonicalPhoneAny, isValidEmail, isValidPhoneAny, phoneVariants } from '../utils/phone';

const SYSTEM_USER_EMAIL = 'system@meruveda.internal';

/**
 * Get or create a system user for isolated sessions (where the phone number
 * already belonged to another customer).
 */
async function getOrCreateSystemUser(): Promise<string> {
  const existing = await usersRepo.findByEmail(SYSTEM_USER_EMAIL, 'id');
  if (existing) return existing.id;

  const { nanoid } = await import('nanoid');
  const passwordHash = `system:${nanoid()}`;
  const created = await usersRepo.insertUser({
    email: SYSTEM_USER_EMAIL,
    password_hash: `system:${nanoid()}`,
    first_name: 'System',
    last_name: 'User',
    phone: null,
    role: 'customer',
    active: true,
    source: 'system',
    phone_verified: false,
  });
  return created.id;
}

export interface CustomerSessionInput {
  name?: string;
  phone?: string;
  email?: string;
  /** Honeypot: a human never fills this in. */
  website?: string;
  /** When the page was rendered - too fast means a script. */
  renderedAt?: number | string;
}

export type CustomerSessionResult =
  | {
      ok: true;
      token: string;
      sessionId: string;
      /** The profile of THIS session. Never the profile of somebody else. */
      profile: { name: string; phone: string; email: string; phoneVerified: boolean };
    }
  | { ok: false; status: number; message: string; silent?: boolean };

/** 90 days, in seconds - the cookie's Max-Age. */
export const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export const SESSION_COOKIE_NAME = 'mv_customer_session';

/** Split a name into first and last, the way the users table stores it. */
function splitName(name: string): { firstName: string; lastName: string | null } {
  const parts = name.split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || name, lastName: parts.length > 1 ? parts.slice(1).join(' ') : null };
}

/**
 * Create (or re-open) the customer session.
 *
 * `existing` is never revealed: the answer looks the same whether the number
 * was new or not.
 */
export async function openCustomerSession(input: CustomerSessionInput): Promise<CustomerSessionResult> {
  // 1. The honeypot and the "too fast to be human" check.
  if (String(input.website || '').trim() !== '') {
    return { ok: false, status: 400, message: 'We could not process that request.', silent: true };
  }
  const renderedAt = Number(input.renderedAt || 0);
  if (renderedAt > 0 && Date.now() - renderedAt < 1200) {
    return { ok: false, status: 400, message: 'We could not process that request.', silent: true };
  }

  // 2. The name.
  const name = String(input.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) {
    return { ok: false, status: 400, message: 'Please enter your full name.' };
  }
  if (name.length > 120) {
    return { ok: false, status: 400, message: 'That name is too long.' };
  }

  // 3. The number - any country, using the same rules as everywhere else.
  if (!isValidPhoneAny(input.phone)) {
    return { ok: false, status: 400, message: 'Please enter a valid mobile number.' };
  }
  const phone = canonicalPhoneAny(input.phone);
  if (!phone) {
    return { ok: false, status: 400, message: 'Please enter a valid mobile number.' };
  }

  // 4. The email - required, trimmed and lowercased.
  const email = String(input.email || '').trim().toLowerCase();
  if (!email) {
    return { ok: false, status: 400, message: 'Please enter your email address.' };
  }
  if (!isValidEmail(email)) {
    return { ok: false, status: 400, message: 'Please enter a valid email address.' };
  }
  if (email.length > 200) {
    return { ok: false, status: 400, message: 'That email address is too long.' };
  }

  // 5. Does the number already belong to somebody?
  const existing = await usersRepo.findByPhoneVariants(phoneVariants(phone), 'id, email, first_name, last_name, role, phone_verified');

  let userId: string | null = null;
  if (!existing) {
    // The profile is created automatically, straight from the checkout.
    const { firstName, lastName } = splitName(name);
    const insertData: Record<string, any> = {
      email,
      password_hash: `session:${crypto.randomUUID()}`,
      first_name: firstName,
      last_name: lastName,
      phone,
      role: 'customer',
      active: true,
    };
    if (await hasColumn('users', 'phone_verified')) insertData.phone_verified = false;
    if (await hasColumn('users', 'source')) insertData.source = 'checkout';

    try {
      const created = await usersRepo.insertUser(insertData, '*');
      userId = created.id;
    } catch (error: any) {
      // A unique-violation on the email (or the phone, in a race) must not
      // fail the checkout: the session is simply opened without a profile.
      console.error('[Session] could not create the profile:', error?.message || error);
      const byEmail = await usersRepo.findByEmail(email, 'id').catch(() => null);
      // The email already belongs to somebody: do NOT attach to that account.
      userId = null;
      void byEmail;
    }
  } else {
    // The number already belongs to a customer. For security, this session
    // is NOT attached to that account. Instead, we use a system user so
    // the order has a valid user_id (avoiding FK/NOT NULL issues).
    userId = await getOrCreateSystemUser();
  }

  // 6. The session row.
  const session = await sessionsRepo.insertSession({
    user_id: userId,
    phone,
    name,
    email,
    phone_verified: false,
    source: 'checkout',
    expires_at: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
  });

  // 7. The token. It carries the SESSION id, so the backend can scope every
  //    request to what this session created.
  const token = generateToken({
    id: userId || session.id,
    email,
    role: 'customer',
    phone_verified: false,
    scope: 'customer',
    sid: session.id,
  } as any);

  return {
    ok: true,
    token,
    sessionId: session.id,
    profile: { name, phone, email, phoneVerified: false },
  };
}

/**
 * The session a request belongs to.
 *
 * `full` means a real, verified account (the normal login); `customer` means
 * a checkout session, which is scoped to what it created.
 */
export interface ResolvedCustomerSession {
  id: string;
  userId: string | null;
  phone: string;
  name: string | null;
  email: string | null;
  phoneVerified: boolean;
  /** True when the session may see the WHOLE account (verified number). */
  verifiedAccount: boolean;
  createdAt: string;
}

export async function resolveCustomerSession(sessionId: string): Promise<ResolvedCustomerSession | null> {
  const session = await sessionsRepo.getSessionById(sessionId);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  // A session that was merged into a verified customer sees that account.
  const accountUserId = session.merged_into_user_id || session.user_id;
  let verifiedAccount = false;
  if (accountUserId) {
    const owner = await usersRepo.findById(accountUserId, 'id, phone_verified').catch(() => null);
    verifiedAccount = Boolean(owner?.phone_verified);
  }

  await sessionsRepo.touchSession(session.id).catch(() => undefined);

  return {
    id: session.id,
    userId: accountUserId,
    phone: session.phone,
    name: session.name,
    email: session.email,
    phoneVerified: session.phone_verified || verifiedAccount,
    verifiedAccount,
    createdAt: session.created_at,
  };
}

/**
 * Merge every session of a number into the real customer.
 *
 * This is what happens when the number is verified by WhatsApp: from that
 * moment on the customer sees their whole history.
 *
 * The sessions are found by PHONE, not by user id: a session whose number
 * already belonged to somebody else is deliberately not attached to that
 * account, so it would never show up in a user-id lookup.
 */
export async function mergeSessionsForPhone(phone: string, userId: string): Promise<void> {
  const rows = await sessionsRepo
    .listSessionsForPhone(phone)
    .catch(() => [] as any[]);
  for (const row of rows) {
    if (row.phone === phone) {
      await sessionsRepo.mergeSessionIntoUser(row.id, userId).catch(() => undefined);
    }
  }
}

/**
 * The session token carried by a request.
 *
 * The httpOnly cookie is the primary carrier: the page's JavaScript cannot
 * read it, so a cross-site script cannot steal it. A Bearer token is still
 * accepted, for non-browser clients and for the admin app.
 */
export function sessionTokenFromRequest(req: {
  headers: Record<string, any>;
}): string | null {
  const cookieHeader = String(req.headers?.cookie || '');
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) {
        const value = decodeURIComponent(part.slice(eq + 1).trim());
        if (value) return value;
      }
    }
  }
  const auth = String(req.headers?.authorization || '');
  if (auth.startsWith('Bearer ')) {
    const value = auth.slice('Bearer '.length).trim();
    if (value) return value;
  }
  return null;
}

/**
 * The customer session a request belongs to, or null.
 *
 * The cookie is checked first, the Bearer token second. A token that is not a
 * customer session (an admin token, a legacy login token) resolves to null
 * here - the caller decides what to do with it.
 */
export async function resolveSessionFromRequest(req: {
  headers: Record<string, any>;
}): Promise<ResolvedCustomerSession | null> {
  const token = sessionTokenFromRequest(req);
  if (!token) return null;
  let payload: any;
  try {
    payload = verifyToken(token);
  } catch {
    return null;
  }
  if (!isCustomerScope(payload) || !payload.sid) return null;
  return resolveCustomerSession(payload.sid);
}
