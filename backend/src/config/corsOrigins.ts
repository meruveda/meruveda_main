/**
 * CORS origin policy.
 *
 * - No Origin header (server-to-server, curl, webhooks) -> allowed.
 * - Origin in the ALLOWED_ORIGINS set -> allowed.
 * - In non-production, http://localhost:* and http://127.0.0.1:* are always
 *   allowed (Next dev on :3000, Vite on :5173/:5174).
 * - Everything else -> denied (cors package then sends NO CORS headers, so
 *   the browser blocks the response; never a 500).
 *
 * Production requires at least one configured origin: an unset
 * ALLOWED_ORIGINS in prod is a misconfiguration that would otherwise lock
 * out the storefront silently.
 */

export function normalizeOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, '').toLowerCase();
}

export function parseAllowedOrigins(raw: string | undefined, nodeEnv: string): Set<string> {
  const set = new Set(
    (raw || '')
      .split(',')
      .map(normalizeOrigin)
      .filter(Boolean),
  );
  if (nodeEnv === 'production' && set.size === 0) {
    throw new Error(
      'ALLOWED_ORIGINS must list at least one origin when NODE_ENV=production ' +
        '(e.g. https://meruveda.com,https://admin.meruveda.com). ' +
        'List Vercel preview URLs explicitly — never rely on a *.vercel.app wildcard in production.',
    );
  }
  return set;
}

/**
 * The storefront's own origin is always allowed.
 *
 * The shop is served on the apex and on `www`, and a browser that talks to
 * the API on the OTHER one makes a cross-origin request. When that origin is
 * missing from the allowlist the browser blocks the answer and the page shows
 * a bare "Network Error" instead of the server's message. `ALLOWED_ORIGINS`
 * is a secret env var, so this cannot be fixed by editing it on the server -
 * the storefront origin is derived from `FRONTEND_URL` instead, and both
 * spellings (apex and www) are allowed.
 */
/**
 * The storefront's own hosts, used when FRONTEND_URL is not set in the backend
 * service. The shop is served on the apex and on `www`; both must be able to
 * reach the API from a browser.
 */
const STOREFRONT_HOSTS = ['meruvedawellness.com', 'www.meruvedawellness.com'];

export function expandStorefrontOrigins(
  allowed: Set<string>,
  storefrontUrl: string | undefined,
): Set<string> {
  const raw = (storefrontUrl || '').trim().replace(/\/+$/, '');
  if (!raw) {
    for (const host of STOREFRONT_HOSTS) allowed.add(`https://${host}`);
    return allowed;
  }
  let origin: string;
  let host: string;
  try {
    const url = new URL(raw);
    origin = `${url.protocol}//${url.host}`;
    host = url.host;
  } catch {
    origin = raw;
    host = '';
  }
  const hosts = new Set<string>();
  if (host) {
    hosts.add(host);
    // apex <-> www
    if (host.startsWith('www.')) hosts.add(host.slice(4));
    else hosts.add(`www.${host}`);
  }
  for (const candidate of hosts) {
    allowed.add(normalizeOrigin(`${origin.split('//')[0]}//${candidate}`));
  }
  return allowed;
}

export function isOriginAllowed(
  origin: string | undefined,
  allowed: Set<string>,
  nodeEnv: string,
): boolean {
  // Non-browser clients send no Origin — nothing to check.
  if (!origin) return true;
  const norm = normalizeOrigin(origin);
  if (allowed.has(norm)) return true;
  if (nodeEnv !== 'production') {
    try {
      const url = new URL(norm);
      const isLocalHttp =
        url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
      if (isLocalHttp) return true;
    } catch {
      /* not a URL -> deny */
    }
  }
  return false;
}
