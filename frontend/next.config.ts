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
};

export default nextConfig;
