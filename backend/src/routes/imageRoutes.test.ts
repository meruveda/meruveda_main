import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as dns } from 'dns';

// Env must be set BEFORE imageRoutes is loaded: the allowlist is computed at
// module import time and cached.
process.env.SUPABASE_URL = 'https://unit-test-project.supabase.co';
process.env.IMAGE_PROXY_EXTRA_HOSTS = 'images.example.com';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validateUpstreamUrl, fetchUpstreamImage } = require('./imageRoutes') as typeof import('./imageRoutes');

const ALLOWED = 'https://unit-test-project.supabase.co/bucket/photo.png';
const PUBLIC_IP = '93.184.216.34';

type Addresses = Array<{ address: string; family: number }>;

function mockDns(t: TestContext, addresses: Addresses): void {
  t.mock.method(dns, 'lookup', (async () => addresses) as any);
}

function mockFetch(t: TestContext, impl: () => Promise<any>): { calls: () => number } {
  let n = 0;
  t.mock.method(globalThis, 'fetch', (async () => {
    n++;
    return impl();
  }) as any);
  return { calls: () => n };
}

function resp(status: number, headers: Record<string, string> = {}, body?: Uint8Array): any {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    arrayBuffer: async () => (body ?? new Uint8Array(0)).buffer,
  };
}

test('allowlisted host resolving to 127.0.0.1 is rejected with 403', async (t) => {
  mockDns(t, [{ address: '127.0.0.1', family: 4 }]);
  await assert.rejects(validateUpstreamUrl(ALLOWED), (err: any) => {
    assert.equal(err.status, 403);
    assert.match(err.message, /private network/i);
    return true;
  });
});

test('allowlisted host resolving to ::ffff:10.0.0.1 is rejected with 403', async (t) => {
  mockDns(t, [{ address: '::ffff:10.0.0.1', family: 6 }]);
  await assert.rejects(validateUpstreamUrl(ALLOWED), (err: any) => {
    assert.equal(err.status, 403);
    assert.match(err.message, /private network/i);
    return true;
  });
});

test('wildcard removed: sibling *.supabase.co host is rejected with 400', async () => {
  await assert.rejects(validateUpstreamUrl('https://other-project.supabase.co/bucket/photo.png'), (err: any) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /Unsupported image URL/);
    return true;
  });
});

test('302 redirect to a non-allowlisted host is rejected', async (t) => {
  mockDns(t, [{ address: PUBLIC_IP, family: 4 }]);
  mockFetch(t, async () => resp(302, { location: 'https://evil.com/x.png' }));
  await assert.rejects(fetchUpstreamImage(ALLOWED), (err: any) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /Unsupported image URL/);
    return true;
  });
});

test('3+ redirects are rejected with 502', async (t) => {
  mockDns(t, [{ address: PUBLIC_IP, family: 4 }]);
  const fetchMock = mockFetch(t, async () => resp(302, { location: 'https://unit-test-project.supabase.co/next.png' }));
  await assert.rejects(fetchUpstreamImage(ALLOWED), (err: any) => {
    assert.equal(err.status, 502);
    assert.match(err.message, /Too many redirects/);
    return true;
  });
  assert.equal(fetchMock.calls(), 3); // MAX_REDIRECT_HOPS = 2 -> 3 fetches, then reject
});

test('non-image content-type is rejected with 502', async (t) => {
  mockDns(t, [{ address: PUBLIC_IP, family: 4 }]);
  mockFetch(t, async () => resp(200, { 'content-type': 'text/html; charset=utf-8' }));
  await assert.rejects(fetchUpstreamImage(ALLOWED), (err: any) => {
    assert.equal(err.status, 502);
    assert.match(err.message, /not an image/);
    return true;
  });
});

test('oversize body (> 10 MB) is rejected with 502', async (t) => {
  mockDns(t, [{ address: PUBLIC_IP, family: 4 }]);
  const oversized = new Uint8Array(10 * 1024 * 1024 + 1); // no content-length header: post-download check
  mockFetch(t, async () => resp(200, { 'content-type': 'image/png' }, oversized));
  await assert.rejects(fetchUpstreamImage(ALLOWED), (err: any) => {
    assert.equal(err.status, 502);
    assert.match(err.message, /too large/i);
    return true;
  });
});
