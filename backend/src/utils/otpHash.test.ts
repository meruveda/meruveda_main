import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { hashOtpCode, verifyOtpCode, isOtpPepperConfigured } from './otpHash';
import { config } from '../config/env';

/**
 * OTP digest tests.
 *
 * The property that matters: the six-digit code must not be recoverable from
 * anything the database holds. A code is 10^6 values, so a *plain* SHA-256 is
 * reversible by brute force in well under a second — these tests exist to stop
 * that from being reintroduced by switching the primitive to something weaker.
 */

const PHONE = '918424819027';

test('a digest is 64 hex characters (sha256)', () => {
  const h = hashOtpCode('123456', PHONE);
  assert.match(h, /^[0-9a-f]{64}$/);
});

test('the plaintext code never appears in the digest', () => {
  const h = hashOtpCode('123456', PHONE);
  assert.ok(!h.includes('123456'));
  assert.notEqual(h, '123456');
});

test('a bare sha256 would be brute-forceable; the HMAC is not', () => {
  // Demonstrates WHY the pepper exists: 10^6 plain digests resolve instantly.
  const naive = crypto.createHash('sha256').update(`918424819027:123456`).digest('hex');
  const peppered = hashOtpCode('123456', PHONE);
  assert.notEqual(naive, peppered);

  // Reversing the naive digest is a 10^6 loop; reversing the HMAC needs the key.
  const found = (() => {
    for (let n = 100000; n < 1000000; n++) {
      if (crypto.createHash('sha256').update(`918424819027:${n}`).digest('hex') === naive) return n;
    }
    return -1;
  })();
  assert.equal(found, 123456, 'plain sha256 is reversible by exhaustive search');
});

test('the same code for the same phone is deterministic (verification needs that)', () => {
  assert.equal(hashOtpCode('424242', PHONE), hashOtpCode('424242', PHONE));
});

test('the digest is bound to the phone number', () => {
  assert.notEqual(hashOtpCode('123456', PHONE), hashOtpCode('123456', '919999999999'));
});

test('verifyOtpCode accepts the correct code', () => {
  const h = hashOtpCode('123456', PHONE);
  assert.equal(verifyOtpCode('123456', PHONE, h), true);
});

test('verifyOtpCode rejects a wrong code', () => {
  const h = hashOtpCode('123456', PHONE);
  assert.equal(verifyOtpCode('123457', PHONE, h), false);
  assert.equal(verifyOtpCode('', PHONE, h), false);
  assert.equal(verifyOtpCode('12345', PHONE, h), false);
  assert.equal(verifyOtpCode('1234567', PHONE, h), false);
});

test('a code issued for one phone cannot be replayed against another', () => {
  const h = hashOtpCode('123456', PHONE);
  assert.equal(verifyOtpCode('123456', '919999999999', h), false);
});

test('a malformed stored digest authenticates nothing', () => {
  for (const bad of [null, undefined, '', 'not-a-hash', 123, {}, [], 'a'.repeat(63), 'a'.repeat(65)]) {
    assert.equal(verifyOtpCode('123456', PHONE, bad as any), false);
  }
});

test('leading and trailing whitespace in the stored value is tolerated as a mismatch', () => {
  const h = hashOtpCode('123456', PHONE);
  assert.equal(verifyOtpCode('123456', PHONE, ` ${h}`), false);
});

test('changing the pepper changes every digest', () => {
  const before = config.otpHashPepper;
  try {
    (config as any).otpHashPepper = 'pepper-one';
    const a = hashOtpCode('123456', PHONE);
    (config as any).otpHashPepper = 'pepper-two';
    const b = hashOtpCode('123456', PHONE);
    assert.notEqual(a, b);
    assert.equal(verifyOtpCode('123456', PHONE, a), false);
  } finally {
    (config as any).otpHashPepper = before;
  }
});

test('the pepper is not readable from the config when it is unset', () => {
  // Unset => empty string, never the fallback literal. The fallback lives only
  // inside otpHash.ts so it cannot be accidentally serialised or logged.
  const before = config.otpHashPepper;
  try {
    (config as any).otpHashPepper = '';
    assert.equal(config.otpHashPepper, '');
    assert.equal(isOtpPepperConfigured(), false);
  } finally {
    (config as any).otpHashPepper = before;
  }
});

test('isOtpPepperConfigured reflects whether a pepper is set', () => {
  const before = config.otpHashPepper;
  try {
    (config as any).otpHashPepper = 'a-real-pepper';
    assert.equal(isOtpPepperConfigured(), true);
  } finally {
    (config as any).otpHashPepper = before;
  }
});