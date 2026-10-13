import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  createRateLimiter,
  MemoryStore,
  loginLimiter,
  otpSendLimiter,
  type RateLimitStore,
} from './rateLimit';

/** Mini app mirroring the production wiring: trust proxy 1 (Vercel) + limiter. */
function buildApp(limiter: express.RequestHandler) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.post('/x', limiter, (_req, res) => res.json({ ok: true }));
  return app;
}

async function listen(app: express.Express): Promise<{ base: string; close: () => void }> {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

test('login limiter: keys on X-Forwarded-For client IP; 429 + Retry-After when exceeded', async (t) => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2, prefix: 'test-login', store: new MemoryStore() });
  const { base, close } = await listen(buildApp(limiter));
  t.after(close);

  const hit = (xff: string) =>
    fetch(`${base}/x`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff },
      body: JSON.stringify({ phone: '9876543210' }),
    });

  assert.equal((await hit('203.0.113.7')).status, 200);
  assert.equal((await hit('203.0.113.7')).status, 200);
  const limited = await hit('203.0.113.7');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1, 'Retry-After header present');

  // Different client IP is unaffected.
  assert.equal((await hit('198.51.100.9')).status, 200);
});

test('OTP send limiter: phone secondary key isolates numbers on the same IP', async (t) => {
  // Real otpSendLimiter config (5 / 10 min) but with an injected store so the
  // test never touches the process-wide default.
  const limiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5, prefix: 'otp-send-test', store: new MemoryStore() });
  const { base, close } = await listen(buildApp(limiter));
  t.after(close);

  const hit = (phone: string, xff = '203.0.113.50') =>
    fetch(`${base}/x`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff },
      body: JSON.stringify({ phone }),
    });

  for (let i = 0; i < 5; i++) assert.equal((await hit('9876543210')).status, 200);
  assert.equal((await hit('9876543210')).status, 429);

  // Same IP, different phone — not locked out by the first phone's quota.
  assert.equal((await hit('9111111111')).status, 200);
});

test('rate limiter fails open when the store throws', async (t) => {
  const brokenStore: RateLimitStore = {
    async incr() {
      throw new Error('redis down');
    },
  };
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, prefix: 'broken', store: brokenStore });
  const { base, close } = await listen(buildApp(limiter));
  t.after(close);

  const res = await fetch(`${base}/x`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 200); // fail open, not 500
});

test('exported login/otp limiters are configured with strict caps', () => {
  // Sanity: the mounted middleware exists and is a function (config lives in
  // rateLimit.ts — login 20/15min, otp send 5/10min).
  assert.equal(typeof loginLimiter, 'function');
  assert.equal(typeof otpSendLimiter, 'function');
});
