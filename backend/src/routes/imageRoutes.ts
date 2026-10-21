import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promises as dns } from 'dns';
import sharp from 'sharp';
import { imageProxyLimiter } from '../middleware/rateLimit';

/**
 * Image derivative proxy used by the storefront's custom Next.js image loader.
 *
 * The canonical path is now a 302 redirect to the object on the R2 public
 * domain (R2_PUBLIC_BASE_URL). The proxy path is retained for any allowlisted
 * upstream that is not on R2, and for deployments where the public base is not
 * configured yet.
 *
 * SSRF hardening (this endpoint is a server-side fetcher, so treat the `url`
 * param as attacker-controlled):
 *   1. `new URL()` parse; https only (no http, not even in dev).
 *   2. Hostname allowlist: the R2 public host +
 *      optional IMAGE_PROXY_EXTRA_HOSTS (comma-separated). No wildcards.
 *   3. DNS resolution: every resolved address is checked against private /
 *      loopback / link-local / metadata ranges (IPv4 and IPv6) so a hostname
 *      that rebinds to 127.0.0.1 or 169.254.169.254 is rejected.
 *   4. Redirects: manual, max 2 hops, each hop re-validated by rules 1-3.
 *   5. Upstream content-type must start with image/.
 *   6. 10 MB response cap (content-length pre-check + post-download check)
 *      and a bounded fetch timeout.
 */
const router = Router();

const IS_SERVERLESS =
  Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
// Vercel's serverless filesystem is read-only except /tmp — writing the disk
// cache under process.cwd() threw EROFS there, so every product photo 500'd in
// production while local dev (writable disk) kept working.
const CACHE_DIR = IS_SERVERLESS
  ? path.join(os.tmpdir(), 'meruveda-images')
  : path.join(process.cwd(), '.cache', 'images');
// 15s: comfortably above Next's 7s optimizer abort (the original reason this
// proxy exists) without pinning a connection for a minute per uncached image.
const FETCH_TIMEOUT_MS = 15_000;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECT_HOPS = 2;

// Extra allowlisted hosts (comma-separated). Kept for any non-R2 origin.
const extraHosts = (process.env.IMAGE_PROXY_EXTRA_HOSTS || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const r2PublicBase = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const r2PublicHost = (() => {
  try {
    return r2PublicBase ? new URL(r2PublicBase).hostname.toLowerCase() : '';
  } catch {
    return '';
  }
})();

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, ''); // strip trailing dot
  if (extraHosts.includes(host)) return true;
  if (r2PublicHost && host === r2PublicHost) return true;
  // Exact match only - there is no wildcard for any storage provider. If
  // R2_PUBLIC_BASE_URL is unset the allowlist is empty and every source is
  // rejected (fail closed): a deployed backend missing its env must never
  // become an open relay.
  return false;
}

/**
 * Does this object exist in the public bucket?
 *
 * The bucket only holds the `-400/-800/-1600` derivative of an upload when the
 * upload actually wrote it. Redirecting to a derivative that was never written
 * is a 404 in the browser - every product photo, card and hero banner was
 * broken by exactly that. The answer is cached for a few minutes so the
 * storefront does not pay for a HEAD per request.
 */
const variantProbeCache = new Map<string, { exists: boolean; expiresAt: number }>();
const VARIANT_PROBE_TTL_MS = 10 * 60 * 1000;

async function r2ObjectExists(url: string): Promise<boolean> {
  const cached = variantProbeCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.exists;
  let exists = false;
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    exists = res.ok;
  } catch {
    exists = false;
  }
  variantProbeCache.set(url, { exists, expiresAt: Date.now() + VARIANT_PROBE_TTL_MS });
  return exists;
}

/**
 * Map a stored object URL onto its key inside the R2 public bucket and 302
 * there. Returns null when the URL is not a storage object we can map (the
 * caller then falls back to the proxy path).
 */
async function r2RedirectTarget(rawUrl: string, width: number): Promise<string | null> {
  if (!r2PublicBase) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;

  const host = parsed.hostname.toLowerCase();
  let key = '';

  if (r2PublicHost && host === r2PublicHost) {
    key = parsed.pathname.replace(/^\/+/, '');
  } else {
    return null;
  }

  if (!key) return null;

  // Prefer a pre-rendered variant when the requested width is smaller than the
  // original. The derivative only exists when the upload wrote it, so the
  // candidate is probed first: a redirect to a missing object is a 404 in the
  // browser and every photo on the site was broken by it. The original object
  // is always a valid fallback.
  if (/\.webp$/i.test(key)) {
    const uploaded = /^(general-media|banners|journal)\//.test(key) && /\d{13}-[a-f0-9]{8}\.webp$/i.test(key);
    if (uploaded) {
      // Smallest derivative that is still at least as wide as the request.
      const candidates = [400, 800, 1600].filter((variant) => variant >= width).sort((a, b) => a - b);
      for (const variant of candidates) {
        const candidate = `${r2PublicBase}/${key.replace(/\.webp$/i, `-${variant}.webp`)}`;
        if (await r2ObjectExists(candidate)) return candidate;
      }
    }
  }

  return `${r2PublicBase}/${key}`;
}

function isAllowedSource(rawUrl: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  // https only — no plaintext, no file:, no data:, nothing else.
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null; // no creds in URL
  if (!isAllowedHost(parsed.hostname)) return null;
  return parsed;
}

/** IPv4-mapped IPv6 (::ffff:127.0.0.1) and other IPv4-in-IPv6 forms. */
function ipv4FromIpv6(ip: string): string | null {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return mapped ? mapped[1] : null;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const v4 = ipv4FromIpv6(ip);
  if (v4) return isPrivateIPv4(v4);
  const norm = ip.toLowerCase();
  if (norm === '::1' || norm === '::') return true; // loopback / unspecified
  if (norm.startsWith('fe80')) return true; // link-local
  if (norm.startsWith('fc') || norm.startsWith('fd')) return true; // unique-local fc00::/7
  if (norm.startsWith('ff')) return true; // multicast
  return false;
}

/**
 * Resolve the hostname and reject if ANY address is private/internal.
 * Catches DNS rebinding (allowlisted name pointing at 127.0.0.1 / metadata IP).
 */
async function assertPublicUpstream(parsed: URL): Promise<void> {
  const hostname = parsed.hostname.replace(/^\[|\]$/g, ''); // IPv6 literal brackets
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    const err: any = new Error('Upstream image host could not be resolved.');
    err.status = 400;
    throw err;
  }
  if (!addresses.length) {
    const err: any = new Error('Upstream image host could not be resolved.');
    err.status = 400;
    throw err;
  }
  for (const { address } of addresses) {
    const isV6 = address.includes(':');
    const blocked = isV6 ? isPrivateIPv6(address) : isPrivateIPv4(address);
    if (blocked) {
      const err: any = new Error('Upstream image host resolves to a private network address.');
      err.status = 403;
      throw err;
    }
  }
}

/** Full per-hop validation: allowlist + DNS/private-IP check. */
async function validateUpstreamUrl(rawUrl: string): Promise<URL> {
  const parsed = isAllowedSource(rawUrl);
  if (!parsed) {
    const err: any = new Error('Unsupported image URL.');
    err.status = 400;
    throw err;
  }
  await assertPublicUpstream(parsed);
  return parsed;
}

function readCachedFile(file: string): Buffer | null {
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file);
  } catch {
    // Ephemeral /tmp may be wiped between invocations — treat as cache miss.
  }
  return null;
}

function tryWriteCache(file: string, buffer: Buffer): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, file);
  } catch (err: any) {
    // Disk cache is best-effort on serverless — never fail the request for it.
    console.warn('[Images] cache write skipped:', err?.message || err);
  }
}

function clamp(value: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

// Fixed width allowlist: requests are SNAPPED to the nearest entry so the
// cache can only ever hold a bounded set of derivatives (unbounded arbitrary
// widths would let a burst fill the disk and force sharp to allocate any size).
const ALLOWED_WIDTHS = [64, 128, 256, 384, 640, 828, 1080, 1920] as const;
const DEFAULT_WIDTH = 828;

function snapWidth(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_WIDTH;
  const clamped = Math.min(1920, Math.max(64, Math.trunc(parsed)));
  let best: number = ALLOWED_WIDTHS[0];
  for (const w of ALLOWED_WIDTHS) {
    if (Math.abs(w - clamped) < Math.abs(best - clamped)) best = w;
  }
  return best;
}

// Hard cap on sharp's libvips thread pool + an in-process gate so a burst of
// uncached resizes can't each spin up native threads and exhaust RAM.
sharp.concurrency(1);
const MAX_PARALLEL_RESIZES = 2;
// Bounded wait queue: beyond this many queued resizes, shed load with a 503
// (+ Retry-After) instead of growing memory without limit.
const MAX_QUEUED_RESIZES = 20;
let resizesInFlight = 0;
const resizeWaiters: Array<() => void> = [];

async function withResizeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (resizesInFlight >= MAX_PARALLEL_RESIZES) {
    if (resizeWaiters.length >= MAX_QUEUED_RESIZES) {
      const err: any = new Error('Server is busy processing images. Please retry shortly.');
      err.status = 503;
      throw err;
    }
    await new Promise<void>((resolve) => resizeWaiters.push(resolve));
  }
  resizesInFlight++;
  try {
    return await fn();
  } finally {
    resizesInFlight--;
    resizeWaiters.shift()?.();
  }
}

/** GET the upstream image with hardened redirect handling + size/type caps. */
async function fetchUpstreamImage(source: string): Promise<Buffer> {
  let currentUrl = source;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const parsed = await validateUpstreamUrl(currentUrl);
    const upstream = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'manual',
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      if (!location) {
        const err: any = new Error('Upstream image returned a redirect with no location.');
        err.status = 502;
        throw err;
      }
      // Re-resolve relative redirects against the current URL, then re-validate
      // the next hop with the full allowlist + private-IP checks.
      currentUrl = new URL(location, parsed).toString();
      continue;
    }

    if (!upstream.ok) {
      const err: any = new Error(`Upstream image returned ${upstream.status}.`);
      err.status = 502;
      throw err;
    }

    // Only image/* payloads are accepted — an HTML error page or JSON body
    // must never be fed to sharp or cached as a product photo.
    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      const err: any = new Error('Upstream response is not an image.');
      err.status = 502;
      throw err;
    }

    const length = Number(upstream.headers.get('content-length') || 0);
    if (length > MAX_SOURCE_BYTES) {
      const err: any = new Error('Image too large.');
      err.status = 502;
      throw err;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength > MAX_SOURCE_BYTES) {
      const err: any = new Error('Image too large.');
      err.status = 502;
      throw err;
    }
    return buffer;
  }
  const err: any = new Error('Too many redirects fetching upstream image.');
  err.status = 502;
  throw err;
}

router.get('/fetch', imageProxyLimiter, async (req: Request, res: Response) => {
  // Per-response mutable headers — only image successes get immutable caching
  // (an earlier version stamped Cache-Control: immutable on error JSON too,
  // which let a CDN cache a 502 for a year).
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  try {
    const source = String(req.query.url || '');
    const width = snapWidth(String(req.query.w || ''));
    const quality = clamp(String(req.query.q || ''), 30, 95, 75);

    // Canonical path: the object already exists on R2. Redirecting (rather than
    // proxying/resizing again) removes the per-cold-start re-download entirely.
    const redirect = await r2RedirectTarget(source, width);
    if (redirect) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.redirect(302, redirect);
    }

    // Cheap allowlist pass (no DNS) so junk never reaches the resolver.
    if (!isAllowedSource(source)) {
      return res.status(400).json({ error: { message: 'Unsupported image URL.' } });
    }

    // Two-tier cache: the (slow) upstream download is stored once per URL, then
    // every requested width is rendered from disk — a single srcset page would
    // otherwise re-download the multi-megabyte original for each size.
    const sourceKey = crypto.createHash('sha1').update(source).digest('hex');
    const sourceFile = path.join(CACHE_DIR, `${sourceKey}.src`);
    const derivativeKey = crypto.createHash('sha1').update(`${source}|${width}|${quality}`).digest('hex');
    const derivativeFile = path.join(CACHE_DIR, `${derivativeKey}.webp`);

    const sendImage = (buffer: Buffer) => {
      res.setHeader('Content-Type', 'image/webp');
      // Derivative key includes width+quality of an immutable storage object —
      // safe to cache hard. (The stored object URLs are versioned by
      // timestamped filenames; content at a URL never changes.)
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(buffer);
    };

    const cachedDerivative = readCachedFile(derivativeFile);
    if (cachedDerivative) {
      return sendImage(cachedDerivative);
    }

    let sourceBuffer = readCachedFile(sourceFile);
    if (!sourceBuffer) {
      sourceBuffer = await fetchUpstreamImage(source);
      tryWriteCache(sourceFile, sourceBuffer);
    }

    const output = await withResizeSlot(() =>
      sharp(sourceBuffer)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality })
        .toBuffer(),
    );

    tryWriteCache(derivativeFile, output);

    return sendImage(output);
  } catch (error: any) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const status = timedOut ? 504 : (error?.status || 500);
    if (status === 503) res.setHeader('Retry-After', '2');
    if (status >= 500) {
      console.error('[Images] derivative failed:', error?.message || error);
    }
    return res.status(status).json({
      error: { message: timedOut ? 'Upstream image timed out.' : (error?.message || 'Could not process image.') },
    });
  }
});

export { validateUpstreamUrl, fetchUpstreamImage, snapWidth, r2RedirectTarget };
export default router;
