import type { ImageLoaderProps } from "next/image";
import { isStaticAsset } from "@/lib/mediaUrl";

const REMOTE_PATTERN = /^https?:\/\//i;

/**
 * Custom Next.js image loader.
 *
 * Static assets — the storefront's own `/public` folder, served from the same
 * origin — are returned untouched: they are already stored in their final,
 * optimised form (WebP siblings are generated for everything above 500 KB),
 * so a resize round-trip would only add latency. `MediaImage` marks those
 * sources `unoptimized`, so this loader is not even called for them.
 *
 * Remote photos are served through the backend proxy (which fetches with a
 * long timeout, resizes and caches) because Next's own optimizer gives up on
 * the upstream download after 7 seconds — see backend/src/routes/imageRoutes.ts.
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
  if (isStaticAsset(src)) {
    // Local (or own-origin) asset — serve directly, no optimizer round-trip.
    return src;
  }

  if (!REMOTE_PATTERN.test(src)) {
    // Anything else that is not a remote URL is a public-folder asset.
    return src;
  }

  const params = new URLSearchParams({
    url: src,
    w: String(width),
    q: String(quality ?? 75),
  });
  return `/api/images/fetch?${params.toString()}`;
}
