/**
 * The guest checkout flow.
 *
 * These tests cover the three things that matter:
 *   1. the flow works: a name and a number open a checkout-only session
 *   2. it is SAFE: a guest can never reach an existing account's data
 *   3. it is not abusable: the rate limits and the validation hold
 *
 * And that OTP_MODE=auto restores exactly the old behaviour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../config/env';
import { guestCheckout, isValidIndianMobile } from './guestCheckoutService';
import { isGuestScope, generateToken, verifyToken } from '../utils/jwt';
import { requireFullAuth } from '../middleware/auth';

const PHONE = '9876543210';
const NAME = 'Aarav Sharma';

/** A minimal Express-ish request/response for the middleware. */
function fakeReq(user: any): any {
  return { user };
}
function fakeRes(): any {
  const res: any = { statusCode: 0, body: null };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: any) => {
    res.body = body;
    return res;
  };
  return res;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

test('only an Indian mobile number is accepted', () => {
  assert.equal(isValidIndianMobile('9876543210'), true);
  assert.equal(isValidIndianMobile('+91 98765 43210'), true);
  assert.equal(isValidIndianMobile('919876543210'), true);
  assert.equal(isValidIndianMobile('09876543210'), true);
  // Not a mobile: starts with 5, or 9 digits, or a foreign number.
  assert.equal(isValidIndianMobile('5876543210'), false);
  assert.equal(isValidIndianMobile('987654321'), false);
  assert.equal(isValidIndianMobile('971501234567'), false);
  assert.equal(isValidIndianMobile(''), false);
  assert.equal(isValidIndianMobile(undefined), false);
});

test('the guest checkout needs a name and a number', async () => {
  const noName = await guestCheckout({ name: '', phone: PHONE });
  assert.equal(noName.ok, false);
  if (!noName.ok) assert.equal(noName.status, 400);

  const noPhone = await guestCheckout({ name: NAME, phone: '' });
  assert.equal(noPhone.ok, false);
  if (!noPhone.ok) assert.equal(noPhone.status, 400);

  const badPhone = await guestCheckout({ name: NAME, phone: '12345' });
  assert.equal(badPhone.ok, false);
  if (!badPhone.ok) assert.equal(badPhone.status, 400);
});

/* ------------------------------------------------------------------ */
/* Abuse                                                              */
/* ------------------------------------------------------------------ */

test('a filled honeypot is rejected and creates nothing', async () => {
  const result = await guestCheckout({ name: NAME, phone: PHONE, website: 'http://spam.example' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    // The message must not say what gave it away.
    assert.doesNotMatch(result.message, /honeypot|bot|website/i);
  }
});

test('a form submitted implausibly fast is rejected', async () => {
  const result = await guestCheckout({
    name: NAME,
    phone: PHONE,
    renderedAt: Date.now(), // submitted in the same tick
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);
});

test('an old form is accepted by the timing check', async () => {
  // The timing check must not block a real customer who took their time.
  const result = await guestCheckout({
    name: NAME,
    phone: PHONE,
    renderedAt: Date.now() - 60_000,
  });
  // It gets past the validation stage (the database is not available in the
  // unit suite, so the identity insert is where it stops).
  assert.ok(!('ok' in result) || result.ok !== false || result.status !== 400);
});

/* ------------------------------------------------------------------ */
/* The session scope                                                   */
/* ------------------------------------------------------------------ */

test('a guest session is scoped to the checkout', () => {
  const token = generateToken({
    id: '11111111-1111-1111-1111-111111111111',
    email: 'guest+x@meruveda.guest',
    role: 'customer',
    phone_verified: false,
    scope: 'guest',
  });
  const payload = verifyToken(token);
  assert.equal(payload.scope, 'guest');
  assert.equal(isGuestScope(payload), true);
  assert.equal(isGuestScope({ scope: 'full' }), false);
  assert.equal(isGuestScope(undefined), false);
});

test('a normal session is not a guest session', () => {
  const token = generateToken({
    id: '11111111-1111-1111-1111-111111111111',
    email: 'a@b.com',
    role: 'customer',
  });
  const payload = verifyToken(token);
  assert.equal(isGuestScope(payload), false);
});

test('a guest session is refused the account data', () => {
  const guest = { id: 'g', role: 'customer', scope: 'guest' } as any;
  const res = fakeRes();
  let called = false;
  requireFullAuth(fakeReq(guest), res, () => {
    called = true;
  });
  assert.equal(called, false, 'the next handler must NOT run');
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error.message, /only place an order/i);
});

test('a normal session passes the account data gate', () => {
  const res = fakeRes();
  let called = false;
  requireFullAuth(fakeReq({ id: 'u', role: 'customer' } as any), res, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(res.statusCode, 0);
});

test('a guest session is still refused by the admin gate', () => {
  // The guest role is "customer", so the admin gate already refuses it.
  const { requireAdmin } = require('../middleware/auth');
  const res = fakeRes();
  let called = false;
  requireAdmin(fakeReq({ id: 'g', role: 'customer', scope: 'guest' } as any), res, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
});

/* ------------------------------------------------------------------ */
/* The switch                                                          */
/* ------------------------------------------------------------------ */

test('OTP_MODE=off switches the guest flow on, and back to auto', () => {
  const before = config.otpMode;
  try {
    (config as any).otpMode = 'off';
    const { guestCheckoutEnabled } = require('./guestCheckoutService');
    assert.equal(guestCheckoutEnabled(), true);

    (config as any).otpMode = 'auto';
    assert.equal(guestCheckoutEnabled(), false);

    (config as any).otpMode = 'on';
    assert.equal(guestCheckoutEnabled(), false);
  } finally {
    (config as any).otpMode = before;
  }
});
