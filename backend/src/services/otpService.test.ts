import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '../database/supabase';
import { config } from '../config/env';
import { otpService } from './otpService';
import { hashOtpCode, verifyOtpCode } from '../utils/otpHash';
import { isWhatsappConfigured } from './whatsappService';

/**
 * OTP lifecycle: cooldown, expiry, attempt cap and one-time use.
 *
 * otpHash.test.ts covers how the code is stored. This covers the guards that
 * decide whether a stored digest may still be spent — the difference between an
 * OTP being a one-shot secret and it being a reusable password.
 */

type Row = Record<string, any>;

interface Fake {
  inserts: Row[];
  updates: Row[];
}

const originalFrom = (supabase as any).from;

function installFake(t: any, rows: Row[] = []) {
  const state: Fake = { inserts: [], updates: [] };
  let result = rows;

  (supabase as any).from = () => {
    const b: any = {
      _filters: [] as Array<[string, any]>,
      select: () => b,
      insert: (payload: any) => {
        state.inserts.push(...(Array.isArray(payload) ? payload : [payload]));
        return Promise.resolve({ data: null, error: null });
      },
      update: (payload: any) => {
        state.updates.push(payload);
        return b;
      },
      eq: (col: string, val: any) => {
        b._filters.push([col, val]);
        result = result.filter((r) => r[col] === val);
        return b;
      },
      is: (col: string, val: any) => {
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

// --- sendOtp --------------------------------------------------------------

test('sendOtp rejects a number that is too short', async (t) => {
  installFake(t);
  await assert.rejects(() => otpService.sendOtp('123'), /valid mobile number/i);
});

test('sendOtp persists a hash and never the plaintext code', async (t) => {
  const fake = installFake(t);
  const res = await otpService.sendOtp(PHONE);

  assert.equal(fake.inserts.length, 1);
  const row = fake.inserts[0];
  assert.match(row.code_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.code, undefined, 'the plaintext code column must not be written');
  assert.ok(!JSON.stringify(fake.inserts).includes('"code"'), 'no plaintext code key anywhere');

  // Non-production returns devOtp; it must match what was persisted.
  if (res.devOtp) assert.equal(row.code_hash, hashOtpCode(res.devOtp, PHONE));
});

test('sendOtp enforces the resend cooldown', async (t) => {
  installFake(t, [makeRow({ created_at: new Date().toISOString() })]);
  await assert.rejects(() => otpService.sendOtp(PHONE), /wait \d+s/i);
});

test('sendOtp allows a resend once the cooldown has elapsed', async (t) => {
  const fake = installFake(t, [makeRow({ created_at: new Date(Date.now() - 120_000).toISOString() })]);
  const res = await otpService.sendOtp(PHONE);
  assert.ok(res.expiresInSeconds > 0);
  assert.equal(fake.inserts.length, 1);
});

// --- verifyOtp ------------------------------------------------------------

test('verifyOtp reports not_found when there is no active code', async (t) => {
  installFake(t, []);
  assert.deepEqual(await otpService.verifyOtp(PHONE, '123456'), { ok: false, reason: 'not_found' });
});

test('verifyOtp refuses an expired code', async (t) => {
  installFake(t, [makeRow({ expires_at: new Date(Date.now() - 1000).toISOString() })]);
  assert.deepEqual(await otpService.verifyOtp(PHONE, '123456'), { ok: false, reason: 'expired' });
});

test('verifyOtp refuses once the attempt cap is reached', async (t) => {
  installFake(t, [makeRow({ attempts: 5 })]);
  assert.deepEqual(await otpService.verifyOtp(PHONE, '123456'), { ok: false, reason: 'too_many_attempts' });
});

test('a wrong code is rejected and the attempt counter advances', async (t) => {
  const fake = installFake(t, [makeRow({ attempts: 0 })]);
  assert.deepEqual(await otpService.verifyOtp(PHONE, '999999'), { ok: false, reason: 'invalid' });
  assert.equal(fake.updates[0].attempts, 1);
});

test('the attempt counter never exceeds max_attempts', async (t) => {
  const fake = installFake(t, [makeRow({ attempts: 4 })]);
  assert.deepEqual(await otpService.verifyOtp(PHONE, '999999'), { ok: false, reason: 'too_many_attempts' });
  assert.equal(fake.updates[0].attempts, 5);
});

test('the correct code is accepted and the row is consumed', async (t) => {
  const fake = installFake(t, [makeRow({ attempts: 0 })]);
  assert.deepEqual(await otpService.verifyOtp(PHONE, '123456'), { ok: true });
  assert.ok(fake.updates.some((u) => u.consumed_at), 'consumed_at must be written (single use)');
});

test('a spent code is invisible to the next lookup, so it cannot be reused', async (t) => {
  installFake(t, []);
  assert.deepEqual(await otpService.verifyOtp(PHONE, '123456'), { ok: false, reason: 'not_found' });
});

test('a code issued for one phone fails against another', async (t) => {
  installFake(t, [makeRow({ phone: '919999999999' })]);
  assert.equal((await otpService.verifyOtp(PHONE, '123456')).ok, false);
});

test('a corrupt stored digest authenticates nobody and is not consumed', async (t) => {
  const fake = installFake(t, [makeRow({ code_hash: 'corrupt' })]);
  assert.equal((await otpService.verifyOtp(PHONE, '123456')).ok, false);
  assert.equal(fake.updates.some((u) => u.consumed_at), false);
});

test('whitespace in the submitted code is stripped before comparison', async (t) => {
  installFake(t, [makeRow()]);
  assert.deepEqual(await otpService.verifyOtp(PHONE, '123 456'), { ok: true });
});

test('an empty submission is rejected without touching the store', async (t) => {
  const fake = installFake(t, [makeRow()]);
  assert.equal((await otpService.verifyOtp(PHONE, '')).ok, false);
  assert.equal(fake.updates.length, 0);
});

// --- configuration guards -------------------------------------------------

test('a placeholder token does not count as a working WhatsApp config', () => {
  const before = { t: config.whatsappApiToken, p: config.whatsappPhoneNumberId };
  try {
    for (const placeholder of ['PLACEHOLDER_TOKEN', 'your-token', '<token>', '']) {
      (config as any).whatsappApiToken = placeholder;
      (config as any).whatsappPhoneNumberId = '1428537175270606';
      assert.equal(isWhatsappConfigured(), false, `placeholder ${JSON.stringify(placeholder)} must not read as configured`);
    }
    (config as any).whatsappApiToken = 'EAA-real-looking-token';
    (config as any).whatsappPhoneNumberId = 'your-phone-id';
    assert.equal(isWhatsappConfigured(), false, 'a placeholder phone id must not read as configured');
    (config as any).whatsappPhoneNumberId = '1428537175270606';
    assert.equal(isWhatsappConfigured(), true);
  } finally {
    (config as any).whatsappApiToken = before.t;
    (config as any).whatsappPhoneNumberId = before.p;
  }
});

// --- pepper behaviour -----------------------------------------------------

test('hashing still works with no pepper configured (strength drops, correctness does not)', () => {
  const before = config.otpHashPepper;
  try {
    (config as any).otpHashPepper = '';
    const h = hashOtpCode('123456', PHONE);
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(verifyOtpCode('123456', PHONE, h), true);
    assert.equal(verifyOtpCode('000000', PHONE, h), false);
  } finally {
    (config as any).otpHashPepper = before;
  }
});