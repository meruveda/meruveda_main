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
  deletes: number;
}

const originalFrom = (supabase as any).from;

function installFake(t: any, rows: Row[] = []) {
  const state: Fake = { inserts: [], updates: [], deletes: 0 };
  let result = rows;

  (supabase as any).from = () => {
    const b: any = {
      _filters: [] as Array<[string, any]>,
      select: () => b,
      insert: (payload: any) => {
        state.inserts.push(...(Array.isArray(payload) ? payload : [payload]));
        const single = { id: 'otp-inserted' };
        b._selectSingle = single;
        return {
          ...b,
          select: () => ({
            single: () => Promise.resolve({ data: single, error: null }),
          }),
        };
      },
      update: (payload: any) => {
        state.updates.push(payload);
        return b;
      },
      delete: () => {
        state.deletes += 1;
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

/**
 * Stub the Graph API transport so delivery success/failure is deterministic and
 * no test ever makes a real Meta call. whatsappService posts through global
 * fetch, so intercepting it is enough.
 */
function stubMeta(t: any, accept: boolean) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url === 'string' && url.includes('graph.facebook.com')) {
      if (accept) {
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ error: { message: 'Template name does not exist', code: 132001, type: 'OAuthException' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return real(input, init);
  }) as any;
  t.after(() => {
    globalThis.fetch = real;
  });
}

function configureWhatsapp(t: any) {
  const before = { tok: config.whatsappApiToken, pid: config.whatsappPhoneNumberId };
  (config as any).whatsappApiToken = 'EAAtest-token-not-real';
  (config as any).whatsappPhoneNumberId = '1428537175270606';
  t.after(() => {
    (config as any).whatsappApiToken = before.tok;
    (config as any).whatsappPhoneNumberId = before.pid;
  });
}

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
  configureWhatsapp(t);
  stubMeta(t, true);
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
  configureWhatsapp(t);
  stubMeta(t, true);
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

// --- delivery failure must not look like success --------------------------

test('a rejected WhatsApp send throws 503 instead of reporting success', async (t) => {
  // No WhatsApp credentials configured => sendOnce returns false, exactly as it
  // does when Meta rejects an unapproved template or an invalid token.
  const fake = installFake(t);
  const before = { t: config.whatsappApiToken, p: config.whatsappPhoneNumberId };
  try {
    (config as any).whatsappApiToken = '';
    (config as any).whatsappPhoneNumberId = '';
    await assert.rejects(
      () => otpService.sendOtp(PHONE),
      (err: any) => {
        assert.equal(err.status, 503);
        assert.match(err.message, /could not send the verification code/i);
        return true;
      }
    );
  } finally {
    (config as any).whatsappApiToken = before.t;
    (config as any).whatsappPhoneNumberId = before.p;
  }
  // A code the customer never received must not linger and burn the cooldown.
  assert.equal(fake.deletes, 1, 'the undelivered OTP row must be rolled back');
});

test('Meta rejecting the template is reported as a failure, not a send', async (t) => {
  // Credentials look valid, but Meta answers 400 "Template name does not exist".
  // This is the failure that must never reach the customer as "we sent a code".
  configureWhatsapp(t);
  stubMeta(t, false);
  const fake = installFake(t);

  await assert.rejects(
    () => otpService.sendOtp(PHONE),
    (err: any) => {
      assert.equal(err.status, 503);
      return true;
    }
  );
  assert.equal(fake.deletes, 1, 'the undelivered row must be rolled back');
  assert.equal(fake.updates.length, 0, 'no partial state is written on a failed send');
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