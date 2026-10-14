import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from './jobRoutes';
import { config } from '../config/env';
import { generateToken } from '../utils/jwt';

/**
 * Cron endpoint auth (used by all three vercel.json crons).
 *
 * The rules under test:
 *   - correct CRON_SECRET Bearer  -> allowed
 *   - ?secret= query fallback     -> allowed
 *   - wrong secret, no admin JWT  -> 401
 *   - no credentials at all       -> 401
 *   - admin JWT instead           -> allowed (dashboard "run now")
 *   - a customer JWT              -> 403
 */

const SECRET = 'test-cron-secret-abc123';

type Outcome =
  | { kind: 'next' }
  | { kind: 'status'; code: number }
  | { kind: 'err' };

/**
 * Runs the middleware against a fake req/res. It settles on whichever comes
 * first: the handler calling next(), or the middleware answering itself —
 * requireAuth/requireAdmin reject by responding 401/403 directly and never call
 * next(), so waiting on next() alone would hang.
 */
function run(headers: Record<string, string> = {}, query: Record<string, any> = {}): Promise<Outcome> {
  return new Promise<Outcome>((resolve) => {
    let settled = false;
    const settle = (outcome: Outcome) => {
      if (!settled) {
        settled = true;
        resolve(outcome);
      }
    };

    const req: any = { headers, query, user: undefined };
    let statusCode = 200;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return res;
      },
      json() {
        settle({ kind: 'status', code: statusCode });
        return res;
      },
      setHeader: () => res,
      end: () => {
        settle({ kind: 'status', code: statusCode });
        return res;
      },
    };

    authorize(req, res, (err?: any) => {
      if (err) settle({ kind: 'err' });
      else settle({ kind: 'next' });
    });
  });
}

test('cron auth', async (t) => {
  // config is read at call time, so the secret can be set per test run.
  const original = config.cronSecret;
  config.cronSecret = SECRET;
  t.after(() => {
    config.cronSecret = original;
  });

  await t.test('valid CRON_SECRET Bearer passes', async () => {
    assert.deepEqual(await run({ authorization: `Bearer ${SECRET}` }), { kind: 'next' });
  });

  await t.test('?secret= query fallback passes (Vercel cron style)', async () => {
    assert.deepEqual(await run({}, { secret: SECRET }), { kind: 'next' });
  });

  await t.test('wrong secret without a session is rejected with 401', async () => {
    assert.deepEqual(await run({ authorization: 'Bearer nope' }), { kind: 'status', code: 401 });
  });

  await t.test('no credentials at all is rejected with 401', async () => {
    assert.deepEqual(await run(), { kind: 'status', code: 401 });
  });

  await t.test('a near-miss secret (prefix) is rejected', async () => {
    assert.deepEqual(await run({ authorization: `Bearer ${SECRET.slice(0, -1)}` }), {
      kind: 'status',
      code: 401,
    });
  });

  await t.test('an admin session may run the job without the secret', async () => {
    const token = generateToken({ id: 'admin-1', role: 'admin', email: 'admin@meruveda.com' });
    assert.deepEqual(await run({ authorization: `Bearer ${token}` }), { kind: 'next' });
  });

  await t.test('a customer session is refused with 403', async () => {
    const token = generateToken({ id: 'cust-1', role: 'customer', email: 'c@example.com' });
    assert.deepEqual(await run({ authorization: `Bearer ${token}` }), { kind: 'status', code: 403 });
  });
});

test('with CRON_SECRET unset, an admin session is still required (fail closed)', async (t) => {
  const original = config.cronSecret;
  config.cronSecret = '';
  t.after(() => {
    config.cronSecret = original;
  });

  assert.deepEqual(await run(), { kind: 'status', code: 401 });

  const adminToken = generateToken({ id: 'admin-1', role: 'admin', email: 'admin@meruveda.com' });
  assert.deepEqual(await run({ authorization: `Bearer ${adminToken}` }), { kind: 'next' });
});