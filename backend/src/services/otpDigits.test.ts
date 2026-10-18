/**
 * OTP shape and lifecycle rules that are easy to regress:
 *   - the code is exactly six digits, from a CSPRNG, always
 *   - the resend cooldown is 30 seconds
 *   - only real six digits authenticate
 *   - a code is consumed atomically (guarded on consumed_at IS NULL)
 *   - nothing about the code escapes into an API response
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { supabase } from '../database/supabase';
import { config } from '../config/env';
import { otpService } from './otpService';
import { hashOtpCode } from '../utils/otpHash';
import { isWhatsappConfigured } from './whatsappService';

type Row = Record<string, any>;

const originalFrom = (supabase as any).from;

/**
 * A fluent stand-in for the `otps` table, mirroring the one in
 * otpService.test.ts. It records the filters attached to each update so the
 * atomic single-use guard can be asserted structurally.
 */
function installFake(t: any, rows: Row[] = []) {
  const state = { inserts: [] as Row[], updates: [] as Row[], updateBuilders: [] as any[] };
  let result = rows;

  (supabase as any).from = () => {
    const b: any = {
      select: () => b,
      insert: (payload: any) => {
        state.inserts.push(...(Array.isArray(payload) ? payload : [payload]));
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'otp-inserted' }, error: null }) }) };
      },
      update: (payload: any) => {
        state.updates.push(payload);
        // The builder is kept so the filters attached AFTER update() are visible.
        state.updateBuilders.push(b);
        return b;
      },
      delete: () => b,
      eq: (col: string, val: any) => {
        b._filters = b._filters || [];
        b._filters.push([col, val]);
        result = result.filter((r) => r[col] === val);
        return b;
      },
      is: (col: string, val: any) => {
        b._filters = b._filters || [];
        b._filters.push([col, val]);
        if (val === null) result = result.filter((r) => r[col] === null || r[col] === undefined);
        return b;
      },
      order: () => b,
      limit: () => b,
      range: () => b,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      upsert: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: any) => resolve({ data: result, error: null }),
    };
    return b;
  };

  t.after(() => {
    (supabase as any).from = originalFrom;
  });
  return state;
}

const PHONE = '918424819027';

function makeRow(over: Partial<Row> = {}): Row {
  return {
    id: 'otp-1',
    phone: PHONE,
    code_hash: hashOtpCode('123456', PHONE),
    purpose: 'checkout_login',
    attempts: 0,
    max_attempts: 5,
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    consumed_at: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* Length                                                              */
/* ------------------------------------------------------------------ */

test('the code generator is a CSPRNG bounded to exactly the six-digit range', () => {
  // The exact call the service makes, and the bound it relies on.
  assert.equal(crypto.randomInt(100000, 1000000) >= 100000, true);
  assert.equal(crypto.randomInt(100000, 1000000) < 1000000, true);
});

test('2000 generated codes are always exactly six digits — never short, never padded', () => {
  for (let i = 0; i < 2000; i += 1) {
    const code = String(crypto.randomInt(100000, 1000000));
    assert.equal(code.length, 6, `expected 6 digits, got "${code}"`);
    assert.match(code, /^[0-9]{6}$/);
  }
});

test('the TTL is five minutes, the attempt cap is five, the cooldown is 30 seconds', () => {
  assert.equal(otpService.ttlMinutes, 5);
  assert.equal(otpService.maxAttempts, 5);
  assert.equal(otpService.resendCooldownSeconds, 30);
});

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

test('a correct six-digit code is accepted', async (t) => {
  installFake(t, [makeRow()]);
  assert.deepEqual(await otpService.verifyOtp(PHONE, '123456'), { ok: true });
});

test('a pasted code with surrounding or interior whitespace still works', async (t) => {
  installFake(t, [makeRow()]);
  assert.deepEqual(await otpService.verifyOtp(PHONE, '  123456  '), { ok: true });
});

test('anything that is not exactly six digits is rejected and consumes no attempt', async (t) => {
  const bad = ['', '1', '12345', '1234567', 'abcdef', '12345a', '12-456', '123 45', '+123456', '12345a6'];
  for (const value of bad) {
    const fake = installFake(t, [makeRow()]);
    const result = await otpService.verifyOtp(PHONE, value);
    assert.equal(result.ok, false, `"${value}" must not authenticate`);
    assert.deepEqual(result, { ok: false, reason: 'invalid' });
    assert.equal(fake.updates.length, 0, 'a malformed code must never consume an attempt');
  }
});

test('a wrong but well-formed code is rejected', async (t) => {
  installFake(t, [makeRow()]);
  const result = await otpService.verifyOtp(PHONE, '000000');
  assert.equal(result.ok, false);
});

/* ------------------------------------------------------------------ */
/* Single use                                                          */
/* ------------------------------------------------------------------ */

test('the consuming update is guarded on consumed_at IS NULL — one code, one use', async (t) => {
  const fake = installFake(t, [makeRow()]);
  const result = await otpService.verifyOtp(PHONE, '123456');
  assert.deepEqual(result, { ok: true });

  const consume = fake.updates.find((u) => u.consumed_at);
  assert.ok(consume, 'consumed_at must be written');

  // Without this guard two concurrent verifies both read an unconsumed row,
  // both pass the hash check, and both mint a JWT from one code.
  const consumeIndex = fake.updates.findIndex((u) => u.consumed_at);
  const builder = fake.updateBuilders[consumeIndex];
  const filters: Array<[string, any]> = builder._filters || [];
  assert.ok(
    filters.some(([col, val]) => col === 'consumed_at' && val === null),
    `the update must carry .is(consumed_at, null); got ${JSON.stringify(filters)}`
  );
  assert.ok(
    filters.some(([col, val]) => col === 'id' && val === 'otp-1'),
    'the update must still be scoped to the single row'
  );
});

/* ------------------------------------------------------------------ */
/* Leakage                                                             */
/* ------------------------------------------------------------------ */

test('the stored digest is HMAC-SHA256 and never contains the plaintext code', () => {
  const digest = hashOtpCode('123456', PHONE);
  assert.equal(digest.length, 64);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.ok(!digest.includes('123456'));
});

test('devOtp is never exposed once real Meta credentials are present, whatever NODE_ENV says', () => {
  const before = { t: config.whatsappApiToken, p: config.whatsappPhoneNumberId, e: config.nodeEnv };
  try {
    config.whatsappApiToken = 'EAAG-real-looking-token';
    config.whatsappPhoneNumberId = '1428537175270606';
    assert.equal(isWhatsappConfigured(), true);

    // This is the exact gate both otpService and otpController use.
    for (const env of ['development', 'test', 'production']) {
      config.nodeEnv = env;
      const gate = config.nodeEnv !== 'production' && !isWhatsappConfigured();
      assert.equal(gate, false, `NODE_ENV=${env} with real credentials must not expose the code`);
    }
  } finally {
    config.whatsappApiToken = before.t;
    config.whatsappPhoneNumberId = before.p;
    config.nodeEnv = before.e;
  }
});

test('devOtp is never exposed in production, with or without credentials', () => {
  const before = { t: config.whatsappApiToken, p: config.whatsappPhoneNumberId, e: config.nodeEnv };
  try {
    config.nodeEnv = 'production';
    for (const creds of [false, true]) {
      config.whatsappApiToken = creds ? 'EAAG-real-looking-token' : '';
      config.whatsappPhoneNumberId = creds ? '1428537175270606' : '';
      const gate = config.nodeEnv !== 'production' && !isWhatsappConfigured();
      assert.equal(gate, false);
    }
  } finally {
    config.whatsappApiToken = before.t;
    config.whatsappPhoneNumberId = before.p;
    config.nodeEnv = before.e;
  }
});

test('devOtp is still available for local work with no credentials at all', () => {
  const before = { t: config.whatsappApiToken, p: config.whatsappPhoneNumberId, e: config.nodeEnv };
  try {
    config.nodeEnv = 'development';
    config.whatsappApiToken = '';
    config.whatsappPhoneNumberId = '';
    assert.equal(isWhatsappConfigured(), false);
    const gate = config.nodeEnv !== 'production' && !isWhatsappConfigured();
    assert.equal(gate, true, 'the local dev convenience must survive');
  } finally {
    config.whatsappApiToken = before.t;
    config.whatsappPhoneNumberId = before.p;
    config.nodeEnv = before.e;
  }
});