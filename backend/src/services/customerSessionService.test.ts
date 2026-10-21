/**
 * The customer session opened at the checkout contact step.
 *
 * These tests cover the four things the storefront depends on:
 *
 *   1. pressing "Continue" creates the customer profile
 *   2. a number that already belongs to somebody else leaks NOTHING
 *   3. a session sees only the orders it created itself
 *   4. the endpoint is rate limited per number and per IP
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const usersRepo = require('../database/repos/users');
const sessionsRepo = require('../database/repos/customerSessions');
const schemaGuard = require('../services/schemaGuard');
const ordersRepo = require('../database/repos/orders');

import {
  openCustomerSession,
  resolveCustomerSession,
  resolveSessionFromRequest,
  sessionTokenFromRequest,
  SESSION_COOKIE_NAME,
} from './customerSessionService';
import { verifyToken } from '../utils/jwt';

/* ------------------------------------------------------------------ */
/* The fake database                                                    */
/* ------------------------------------------------------------------ */

interface FakeUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string | null;
  phone: string;
  role: string;
  active: boolean;
  phone_verified: boolean;
  source?: string | null;
  password_hash?: string;
}

interface FakeSession {
  id: string;
  user_id: string | null;
  merged_into_user_id: string | null;
  phone: string;
  name: string | null;
  email: string | null;
  phone_verified: boolean;
  source: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
}

let users: FakeUser[] = [];
let sessions: FakeSession[] = [];
let createdUsers: FakeUser[] = [];
let nextId = 1;

function restore() {
  users = [];
  sessions = [];
  createdUsers = [];
  nextId = 1;

  usersRepo.findByPhoneVariants = async (variants: string[]) => {
    const wanted = new Set((variants || []).map((v) => String(v).replace(/\D/g, '')));
    const found = users.find((u) => wanted.has(String(u.phone).replace(/\D/g, '')));
    return found ? { ...found } : null;
  };
  usersRepo.findById = async (id: string) => {
    const found = users.find((u) => u.id === id);
    return found ? { ...found } : null;
  };
  usersRepo.findByEmail = async (email: string) => {
    const found = users.find((u) => u.email === String(email).toLowerCase());
    return found ? { ...found } : null;
  };
  usersRepo.insertUser = async (data: Record<string, any>) => {
    const row: FakeUser = {
      id: `user-${nextId++}`,
      email: data.email,
      first_name: data.first_name,
      last_name: data.last_name ?? null,
      phone: data.phone,
      role: data.role || 'customer',
      active: data.active ?? true,
      phone_verified: data.phone_verified ?? false,
      source: data.source ?? null,
      password_hash: data.password_hash,
    };
    users.push(row);
    createdUsers.push(row);
    return { ...row };
  };

  sessionsRepo.insertSession = async (data: Record<string, any>) => {
    const row: FakeSession = {
      id: `session-${nextId++}`,
      user_id: data.user_id ?? null,
      merged_into_user_id: null,
      phone: data.phone,
      name: data.name ?? null,
      email: data.email ?? null,
      phone_verified: data.phone_verified ?? false,
      source: data.source || 'checkout',
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      expires_at: data.expires_at,
    };
    sessions.push(row);
    return { ...row };
  };
  sessionsRepo.getSessionById = async (id: string) => {
    const found = sessions.find((s) => s.id === id);
    return found ? { ...found } : null;
  };
  sessionsRepo.touchSession = async () => undefined;
  sessionsRepo.updateSession = async (id: string, patch: Record<string, any>) => {
    const found = sessions.find((s) => s.id === id);
    if (!found) return null;
    Object.assign(found, patch);
    return { ...found };
  };
  sessionsRepo.listSessionsForPhone = async (phone: string) =>
    sessions.filter((s) => s.phone === phone).map((s) => ({ ...s }));
  sessionsRepo.listSessionsForUser = async (userId: string) =>
    sessions.filter((s) => s.user_id === userId || s.merged_into_user_id === userId).map((s) => ({ ...s }));
  sessionsRepo.mergeSessionIntoUser = async (id: string, userId: string) => {
    const found = sessions.find((s) => s.id === id);
    if (found) {
      found.merged_into_user_id = userId;
      found.user_id = userId;
      found.phone_verified = true;
    }
  };

  // The schema probes must not reach the real database.
  schemaGuard.hasColumn = async () => true;
}

restore();

const NAME = 'Aarav Sharma';
const EMAIL = 'aarav@example.com';
const PHONE = '9876543210';
const OTHER_PHONE = '9123456780';

/* ------------------------------------------------------------------ */
/* 1. The profile is created at "Continue"                              */
/* ------------------------------------------------------------------ */

test('Continue creates the customer profile and opens the session', async () => {
  restore();
  const result = await openCustomerSession({ name: NAME, phone: PHONE, email: EMAIL });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  // The profile row exists, with the fields the storefront needs.
  assert.equal(createdUsers.length, 1);
  const profile = createdUsers[0];
  assert.equal(profile.email, EMAIL);
  assert.equal(profile.first_name, 'Aarav');
  assert.equal(profile.last_name, 'Sharma');
  assert.equal(profile.phone, '919876543210');
  assert.equal(profile.phone_verified, false, 'the number was never proven');
  assert.equal(profile.source, 'checkout');
  assert.equal(profile.role, 'customer');
  // There is no password anywhere: the account can only be used from the
  // session cookie.
  assert.ok(profile.password_hash, 'a password hash placeholder keeps the column NOT NULL');
  assert.match(String(profile.password_hash), /^session:/);

  // The session is attached to the profile it created.
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].user_id, profile.id);
  assert.equal(sessions[0].source, 'checkout');
  assert.equal(sessions[0].phone_verified, false);

  // The answer carries the profile of THIS session.
  assert.equal(result.profile.name, NAME);
  assert.equal(result.profile.email, EMAIL);
  assert.equal(result.profile.phone, '919876543210');
  assert.equal(result.profile.phoneVerified, false);
});

test('the email is trimmed and lowercased, and it is required', async () => {
  restore();
  const result = await openCustomerSession({
    name: NAME,
    phone: PHONE,
    email: '  Aarav@Example.COM ',
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.profile.email, 'aarav@example.com');

  restore();
  const missing = await openCustomerSession({ name: NAME, phone: PHONE, email: '' });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 400);

  restore();
  const invalid = await openCustomerSession({ name: NAME, phone: PHONE, email: 'not-an-email' });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.status, 400);
});

/* ------------------------------------------------------------------ */
/* 2. An existing number leaks nothing                                  */
/* ------------------------------------------------------------------ */

test('a number that already belongs to somebody leaks nothing', async () => {
  restore();
  // An existing, verified customer with an order history.
  users.push({
    id: 'owner-1',
    email: 'owner@example.com',
    first_name: 'Real',
    last_name: 'Owner',
    phone: '919876543210',
    role: 'customer',
    active: true,
    phone_verified: true,
  });

  const result = await openCustomerSession({ name: 'Someone Else', phone: PHONE, email: 'else@example.com' });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // The session is NOT attached to the existing account...
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].user_id, null, 'the session must not be linked to the existing account');
  assert.equal(sessions[0].merged_into_user_id, null);

  // ...and no new profile row was created for that number.
  assert.equal(createdUsers.length, 0);

  // The answer is the profile the visitor just typed, never the owner's.
  assert.equal(result.profile.name, 'Someone Else');
  assert.equal(result.profile.email, 'else@example.com');
  assert.equal(result.profile.phoneVerified, false);

  // The resolved session carries no account either.
  const resolved = await resolveCustomerSession(result.sessionId);
  assert.ok(resolved);
  assert.equal(resolved!.userId, null);
  assert.equal(resolved!.verifiedAccount, false);
  assert.equal(resolved!.email, 'else@example.com', 'never the owner\'s email');
});

test('the answer never says whether the number already existed', async () => {
  restore();
  const fresh = await openCustomerSession({ name: NAME, phone: PHONE, email: EMAIL });
  assert.equal(fresh.ok, true);

  restore();
  users.push({
    id: 'owner-2',
    email: 'owner2@example.com',
    first_name: 'Real',
    last_name: 'Owner',
    phone: '919876543210',
    role: 'customer',
    active: true,
    phone_verified: true,
  });
  const existing = await openCustomerSession({ name: NAME, phone: PHONE, email: EMAIL });
  assert.equal(existing.ok, true);
  if (!fresh.ok || !existing.ok) return;

  // The same answer, field for field, in both cases.
  assert.deepEqual(Object.keys(fresh.profile).sort(), Object.keys(existing.profile).sort());
  assert.deepEqual(fresh.profile, existing.profile);
});

/* ------------------------------------------------------------------ */
/* 3. A session sees only its own orders                                */
/* ------------------------------------------------------------------ */

test('an unverified session only sees the orders it created itself', async () => {
  restore();
  const captured: Array<{ sql: string; params: any[] }> = [];
  const realQuery = require('../database/db').query;
  require('../database/db').query = async (sql: string, params: any[] = []) => {
    captured.push({ sql, params });
    return [];
  };
  try {
    // The session of a stranger: no account, not verified.
    await ordersRepo.getOrdersForSession('session-1', null, false);
    const scoped = captured[captured.length - 1];
    assert.match(scoped.sql, /session_id\s*=\s*\$1/);
    assert.doesNotMatch(scoped.sql, /user_id\s*=\s*\$2/, 'an unverified session must not read the account history');
    assert.deepEqual(scoped.params, ['session-1']);

    // A verified account sees its whole history.
    captured.length = 0;
    await ordersRepo.getOrdersForSession('session-2', 'user-9', true);
    const full = captured[captured.length - 1];
    assert.match(full.sql, /user_id\s*=\s*\$2/);
    assert.deepEqual(full.params, ['session-2', 'user-9']);
  } finally {
    require('../database/db').query = realQuery;
  }
});

/* ------------------------------------------------------------------ */
/* 4. The rate limits                                                   */
/* ------------------------------------------------------------------ */

test('the Continue endpoint is rate limited per number and per IP', async () => {
  const { createRateLimiter, MemoryStore } = require('../middleware/rateLimit');

  // The limiters the route actually uses, rebuilt with a tiny budget so the
  // test is fast, and with an in-memory store so no network is involved.
  const perNumber = createRateLimiter({
    windowMs: 60_000,
    max: 2,
    prefix: 'test-session-phone',
    keyMode: 'phone',
    store: new MemoryStore(),
    secondaryKey: (req: any) => String(req.body?.phone || ''),
  });
  const perIp = createRateLimiter({
    windowMs: 60_000,
    max: 3,
    prefix: 'test-session-ip',
    keyMode: 'ip',
    store: new MemoryStore(),
  });

  const call = async (limiter: any, ip: string, phone: string) => {
    const req: any = { body: { phone }, ip, headers: {}, socket: { remoteAddress: ip } };
    const res: any = {
      statusCode: 0,
      body: null,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        this.headers[k] = v;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: any) {
        this.body = body;
        return this;
      },
    };
    // The limiter either calls next() (allowed) or answers 429 (refused).
    await new Promise<void>((resolve) => {
      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        originalJson(body);
        resolve();
        return res;
      };
      limiter(req, res, () => resolve());
    });
    return res;
  };

  // The same number: the bucket runs out.
  const first = await call(perNumber, '1.1.1.1', PHONE);
  const second = await call(perNumber, '1.1.1.1', PHONE);
  const third = await call(perNumber, '1.1.1.1', PHONE);
  assert.equal(first.statusCode, 0, 'the first call passes');
  assert.equal(second.statusCode, 0, 'the second call passes');
  assert.equal(third.statusCode, 429, 'the third call for the same number is refused');

  // Another number from the same IP is NOT blocked by the number bucket.
  const other = await call(perNumber, '1.1.1.1', OTHER_PHONE);
  assert.equal(other.statusCode, 0);

  // The IP bucket is separate and has its own budget.
  const ip1 = await call(perIp, '2.2.2.2', PHONE);
  const ip2 = await call(perIp, '2.2.2.2', OTHER_PHONE);
  const ip3 = await call(perIp, '2.2.2.2', '9333333333');
  const ip4 = await call(perIp, '2.2.2.2', '9444444444');
  assert.equal(ip1.statusCode, 0);
  assert.equal(ip2.statusCode, 0);
  assert.equal(ip3.statusCode, 0);
  assert.equal(ip4.statusCode, 429, 'the fourth call from one IP is refused');
});

/* ------------------------------------------------------------------ */
/* The cookie is the carrier                                            */
/* ------------------------------------------------------------------ */

test('the session travels in the httpOnly cookie', async () => {
  restore();
  const result = await openCustomerSession({ name: NAME, phone: PHONE, email: EMAIL });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const payload = verifyToken(result.token);
  assert.equal(payload.scope, 'customer');
  assert.equal(payload.sid, result.sessionId);

  // The cookie is found on the request...
  const req: any = { headers: { cookie: `other=1; ${SESSION_COOKIE_NAME}=${result.token}; another=2` } };
  assert.equal(sessionTokenFromRequest(req), result.token);

  // ...and it resolves to the session.
  const resolved = await resolveSessionFromRequest(req);
  assert.ok(resolved);
  assert.equal(resolved!.id, result.sessionId);
  assert.equal(resolved!.email, EMAIL);

  // A request without the cookie has no session.
  assert.equal(await resolveSessionFromRequest({ headers: {} } as any), null);
});
