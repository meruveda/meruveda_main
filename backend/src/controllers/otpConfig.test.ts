/**
 * The checkout's OTP-mode switch.
 *
 * The storefront reads ONE value from the server - `otpRequired` - and never
 * from a build-time env var, so a store-wide switch takes effect on the next
 * page load.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../config/env';
import { otpConfig } from '../controllers/otpController';

function fakeRes(): any {
  const res: any = { statusCode: 200, headers: {} as Record<string, string>, body: null };
  res.set = (k: string, v: string) => {
    res.headers[k] = v;
    return res;
  };
  res.json = (body: any) => {
    res.body = body;
    return res;
  };
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  return res;
}

test('OTP_MODE=off tells the storefront that no OTP is needed', async () => {
  const before = config.otpMode;
  try {
    (config as any).otpMode = 'off';
    const res = fakeRes();
    await otpConfig({} as any, res, () => undefined);
    assert.equal(res.body.data.otpRequired, false);
    assert.equal(res.body.data.guestCheckout, true);
    // The storefront must never be told to cache this.
    assert.match(String(res.headers['Cache-Control'] || ''), /no-store/);
  } finally {
    (config as any).otpMode = before;
  }
});

test('OTP_MODE=auto requires the OTP', async () => {
  const before = config.otpMode;
  try {
    (config as any).otpMode = 'auto';
    const res = fakeRes();
    await otpConfig({} as any, res, () => undefined);
    assert.equal(res.body.data.guestCheckout, false);
    assert.match(String(res.headers['Cache-Control'] || ''), /no-store/);
    // With an approved AUTHENTICATION template the OTP is required.
    assert.equal(typeof res.body.data.otpRequired, 'boolean');
  } finally {
    (config as any).otpMode = before;
  }
});
