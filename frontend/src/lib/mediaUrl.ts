/**
 * Where an image lives, and how the browser should fetch it.
 *
 * The catalogue artwork is served statically from the storefront's own origin
 * (`frontend/public/images` -> `https://meruvedawellness.com/images/<file>`).
 * Those files are already optimised on disk (WebP siblings for everything
 * above 500 KB), so they are handed to the browser untouched — no resize
 * endpoint, no object-storage round-trip, no cross-origin request.
 *
 * Anything else (a freshly uploaded media object on R2) still goes through the
 * backend derivative proxy, which fetches patiently, resizes and caches.
 */

/** Hosts that serve the storefront's own static assets. */
const STATIC_HOSTS = new Set(['meruvedawellness.com', 'www.meruvedawellness.com']);

/** True for a `/public` path or an absolute URL on the storefront's own host. */
export function isStaticAsset(src: string | undefined | null): boolean {
  if (!src) return false;
  if (src.startsWith('//')) return false;
  if (src.startsWith('/')) return true;
  try {
    const url = new URL(src);
    return url.protocol === 'https:' && STATIC_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Widths the backend derivative proxy can render. */
const PROXY_WIDTHS = [640, 828, 1080, 1920] as const;

/**
 * A `srcset` for a plain `<img>`.
 *
 * A static asset is a single, already-optimised file: one candidate is the
 * correct answer and any extra candidate would only duplicate the download.
 * A remote asset gets the usual width candidates, served by the proxy.
 */
export function buildSrcSet(src: string | undefined | null): string | undefined {
  if (!src) return undefined;
  if (isStaticAsset(src)) return undefined;
  return PROXY_WIDTHS.map((w) => `/api/images/fetch?url=${encodeURIComponent(src)}&w=${w}&q=75 ${w}w`).join(', ');
}
