import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@meruveda/shared"],
  images: {
    // Remote photos go through the backend proxy (/api/images/fetch): Supabase
    // Storage serves multi-megabyte originals and Next's optimizer aborts the
    // upstream download after 7 seconds, which 500'd every product photo on a
    // slow link. The proxy fetches patiently, resizes and caches instead.
    loader: "custom",
    loaderFile: "./src/imageLoader.ts",
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pfklokcgcppdmrqgukmr.supabase.co',
      },
    ],
    // Product images live in Supabase Storage. On networks that resolve the
    // Supabase host through NAT64/IPv6, Next's SSRF guard misreads the address
    // as a private IP and answers every remote image with 400 ("url parameter
    // is not allowed"), so no product photo renders. Fetches stay pinned to the
    // single trusted hostname above, so nothing else can be requested.
    dangerouslyAllowLocalIP: true,
  },
  async redirects() {
    // The cart page was removed: the cart icon and Buy Now both land on
    // checkout, which renders the cart contents inline.
    return [
      {
        source: '/cart',
        destination: '/checkout',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    // Same-origin /api/* → Express backend. The custom image loader (and the
    // Vercel fallback for axios) request /api/... on the frontend origin; only
    // Vercel's vercel.json forwards those to the backend service, so `next dev`
    // (and self-hosted deploys like Render) answered every /api/images/fetch
    // with a 404 and no product photo rendered anywhere.
    // On Vercel the platform rewrite already handles /api/* — adding it here
    // too would double-proxy, so it is skipped there.
    if (process.env.VERCEL) return [];

    const backendUrl =
      process.env.BACKEND_SERVICE_URL || process.env.NEXT_PUBLIC_API_URL;

    if (!backendUrl) {
      // On Render (or any self-host) a missing backend URL would silently
      // rewrite every /api call to localhost and break the whole storefront —
      // fail the build/startup with an actionable message instead.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          '[next.config] BACKEND_SERVICE_URL (or NEXT_PUBLIC_API_URL) must be set when building ' +
            'for production on a self-hosted platform (e.g. Render). It is the backend service ' +
            'origin that /api/* is rewritten to — without it every API and image request 404s.'
        );
      }
      // Local dev convenience default.
      return [
        { source: '/api/:path*', destination: 'http://localhost:5000/api/:path*' },
      ];
    }

    let base = backendUrl.replace(/\/+$/, '');
    if (base.endsWith('/api')) base = base.slice(0, -4);
    return [{ source: '/api/:path*', destination: `${base}/api/:path*` }];
  },
};

export default nextConfig;
