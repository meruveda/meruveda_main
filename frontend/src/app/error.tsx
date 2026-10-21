"use client";

import { useEffect } from "react";
import { RefreshCw, Leaf } from "lucide-react";

/**
 * The storefront's error boundary.
 *
 * It exists for the one case a customer must never see as a broken page:
 * the catalogue service (the backend) is unavailable and the page has never
 * been rendered before, so there is no cached version to fall back to.
 *
 * In that case the customer gets a calm message and a Retry button - not a
 * stack trace, not an internal URL, and not a debug dump.
 */
export default function StorefrontError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server log has the real cause; the browser only gets the digest.
    console.error('[Storefront] render failed:', error?.digest || error?.message);
  }, [error]);

  return (
    <div className="min-h-screen bg-ivory/30 flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-deep-purple/10 text-deep-purple flex items-center justify-center mb-6">
          <Leaf size={28} />
        </div>
        <h1 className="text-2xl md:text-3xl font-playfair font-bold text-deep-purple mb-3">
          Loading products, please refresh
        </h1>
        <p className="text-sm text-gray-600 leading-relaxed mb-8">
          We are fetching the catalogue right now and it is taking a little longer
          than usual. Please try again in a moment.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-2 bg-deep-purple text-white px-7 py-3 rounded-xl font-bold text-sm hover:bg-deep-purple/90 transition-colors"
        >
          <RefreshCw size={16} />
          Retry
        </button>
      </div>
    </div>
  );
}
