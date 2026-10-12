import type { ImageLoaderProps } from "next/image";

const REMOTE_PATTERN = /^https?:\/\//i;

/**
 * Custom Next.js image loader.
 *
 * Remote photos are served through the backend proxy (which fetches with a long
 * timeout, resizes and caches) because Next's own optimizer gives up on the
 * upstream download after 7 seconds — see backend/src/routes/imageRoutes.ts.
 * Local /public assets are returned as-is.
 *
 * IMPORTANT: the proxy URL is intentionally same-origin (`/api/...`) instead of
 * `NEXT_PUBLIC_API_URL`. That env var is baked in at build time — if Vercel
 * builds with a localhost value (or a stale backend URL), every remote <Image>
 * would point the browser at an unreachable host and no card photo would render
 * in production while local dev kept working. The vercel.json rewrite forwards
 * same-origin `/api/*` to the backend service, so a relative URL works in both
 * environments with no env dependency.
 */
export default function imageLoader({ src, width, quality }: ImageLoaderProps): string {
  if (!REMOTE_PATTERN.test(src)) {
    // Public-folder asset — serve directly, no optimizer round-trip needed.
    // (Previously this hand-built a `/_next/image?...` URL; with a custom
    // loader that endpoint isn't guaranteed, so a direct return is safer.)
    return src;
  }

  const params = new URLSearchParams({
    url: src,
    w: String(width),
    q: String(quality ?? 75),
  });
  return `/api/images/fetch?${params.toString()}`;
}
