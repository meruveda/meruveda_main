import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import { parseAllowedOrigins, isOriginAllowed, normalizeOrigin, expandStorefrontOrigins } from './corsOrigins';

const PROD_ORIGINS = 'https://meruveda.com/,https://admin.meruveda.com';

test('parseAllowedOrigins: trims, strips trailing slash, lowercases', () => {
  const set = parseAllowedOrigins(' https://MeruVEDA.com/ , https://admin.meruveda.com ', 'production');
  assert.deepEqual([...set].sort(), ['https://admin.meruveda.com', 'https://meruveda.com']);
});

test('parseAllowedOrigins: empty in production throws', () => {
  assert.throws(() => parseAllowedOrigins('', 'production'), /ALLOWED_ORIGINS/);
  assert.throws(() => parseAllowedOrigins(undefined, 'production'), /ALLOWED_ORIGINS/);
});

test('parseAllowedOrigins: empty in development is fine', () => {
  assert.equal(parseAllowedOrigins(undefined, 'development').size, 0);
});

test('isOriginAllowed: no Origin header -> allowed (server-to-server)', () => {
  const set = parseAllowedOrigins(PROD_ORIGINS, 'production');
  assert.equal(isOriginAllowed(undefined, set, 'production'), true);
  assert.equal(isOriginAllowed('', set, 'production'), true);
});

test('isOriginAllowed: listed origin -> allowed; evil origin -> denied', () => {
  const set = parseAllowedOrigins(PROD_ORIGINS, 'production');
  assert.equal(isOriginAllowed('https://meruveda.com', set, 'production'), true);
  assert.equal(isOriginAllowed('https://evil.com', set, 'production'), false);
  assert.equal(isOriginAllowed('https://meruveda.com.evil.com', set, 'production'), false);
});

test('isOriginAllowed: localhost only auto-allowed outside production', () => {
  const set = parseAllowedOrigins(PROD_ORIGINS, 'production');
  assert.equal(isOriginAllowed('http://localhost:3000', set, 'production'), false);
  const devSet = parseAllowedOrigins(undefined, 'development');
  assert.equal(isOriginAllowed('http://localhost:3000', devSet, 'development'), true);
  assert.equal(isOriginAllowed('http://127.0.0.1:5173', devSet, 'development'), true);
  assert.equal(isOriginAllowed('https://evil.com', devSet, 'development'), false);
});

test('normalizeOrigin strips trailing slashes', () => {
  assert.equal(normalizeOrigin('https://a.com///'), 'https://a.com');
});

// ---------------------------------------------------------------------------
// Integration: the real cors() wiring from app.ts — allowed origin receives
// Access-Control-Allow-Origin, evil origin receives none, no-origin passes.
// ---------------------------------------------------------------------------
function buildApp(allowed: Set<string>, nodeEnv: string) {
  const app = express();
  app.use(cors({
    origin: (origin, callback) => callback(null, isOriginAllowed(origin, allowed, nodeEnv)),
    credentials: true,
  }));
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

test('CORS headers: allowed origin gets ACAO, evil origin none, no-origin passes', async (t) => {
  const allowed = parseAllowedOrigins(PROD_ORIGINS, 'production');
  const app = buildApp(allowed, 'production');
  const server = app.listen(0);
  t.after(() => server.close());
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const ok = await fetch(`${base}/ping`, { headers: { Origin: 'https://meruveda.com' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://meruveda.com');
  assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');

  const evil = await fetch(`${base}/ping`, { headers: { Origin: 'https://evil.com' } });
  assert.equal(evil.status, 200);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);

  const noOrigin = await fetch(`${base}/ping`);
  assert.equal(noOrigin.status, 200);
  assert.equal(noOrigin.headers.get('access-control-allow-origin'), null);
});

// --- the storefront origin is always allowed (apex and www) ----------------
// A browser on one spelling that reaches the API on the other makes a
// cross-origin request; without the origin in the allowlist the browser
// blocks the answer and the page shows a bare "Network Error".
test('expandStorefrontOrigins: the storefront origin and its www twin are allowed', () => {
  const allowed = expandStorefrontOrigins(new Set<string>(), 'https://meruvedawellness.com');
  assert.ok(allowed.has('https://meruvedawellness.com'));
  assert.ok(allowed.has('https://www.meruvedawellness.com'));
  assert.ok(isOriginAllowed('https://www.meruvedawellness.com', allowed, 'production'));
  assert.ok(isOriginAllowed('https://meruvedawellness.com', allowed, 'production'));
  assert.ok(!isOriginAllowed('https://evil.com', allowed, 'production'));
});

test('expandStorefrontOrigins: a www storefront url also allows the apex', () => {
  const allowed = expandStorefrontOrigins(new Set<string>(), 'https://www.meruvedawellness.com/');
  assert.ok(allowed.has('https://www.meruvedawellness.com'));
  assert.ok(allowed.has('https://meruvedawellness.com'));
});

test('expandStorefrontOrigins: without a storefront url the shop hosts are allowed', () => {
  const allowed = expandStorefrontOrigins(new Set<string>(['https://admin.example.com']), undefined);
  assert.ok(allowed.has('https://meruvedawellness.com'));
  assert.ok(allowed.has('https://www.meruvedawellness.com'));
  assert.ok(isOriginAllowed('https://www.meruvedawellness.com', allowed, 'production'));
  assert.ok(!isOriginAllowed('https://evil.com', allowed, 'production'));
});
