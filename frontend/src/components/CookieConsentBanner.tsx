"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CONSENT_KEY, setConsent } from "@/lib/analytics";

/**
 * Unmounted: re-enable together with ANALYTICS_ENABLED when ads start.
 *
 * This component is no longer rendered from the root layout, so the popup does
 * not appear. The file is kept intact (and lint/type-clean) for when Meta ads
 * start. To bring it back: re-add the import + <CookieConsentBanner /> in
 * frontend/src/app/layout.tsx AND set NEXT_PUBLIC_ANALYTICS_ENABLED="true".
 *
 * Consent banner for non-essential analytics (DPDP Act).
 *
 * Vercel Web Analytics is cookieless and loads regardless; GA4 and Meta Pixel
 * stay unloaded until this banner is accepted — see AnalyticsScripts.
 *
 * Accepting is one click and no reload: the choice is written to localStorage
 * (meruveda_consent) and announced through the CONSENT_EVENT that the script
 * loader listens for.
 *
 * Note: this key deliberately does NOT match the CardVaultCleanup wipe pattern
 * (/^meruveda_.*(card|vault)/i) — the consent choice must survive that cleanup.
 */
export default function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let decided: string | null = null;
    try {
      decided = window.localStorage.getItem(CONSENT_KEY);
    } catch {
      decided = null;
    }
    if (decided !== "granted" && decided !== "denied") setVisible(true);
  }, []);

  const decide = (choice: "granted" | "denied") => {
    setConsent(choice);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="fixed bottom-0 left-0 right-0 z-50 p-4 sm:p-6"
    >
      <div className="mx-auto max-w-4xl rounded-2xl border border-gray-200 bg-white shadow-2xl p-5 sm:p-6">
        <h2 className="text-base font-bold text-deep-purple mb-2">
          Cookies & analytics
        </h2>
        <p className="text-sm text-gray-600 leading-relaxed mb-4">
          We use Google Analytics and Meta Pixel to understand how the store is
          used and improve it. They are only loaded if you accept. We also use
          cookieless, first-party measurement to count page views. See our{" "}
          <Link href="/privacy" className="text-gold underline">
            privacy policy
          </Link>{" "}
          for details.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
          <button
            type="button"
            onClick={() => decide("denied")}
            className="px-5 py-2.5 rounded-xl border border-gray-300 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Reject non-essential
          </button>
          <button
            type="button"
            onClick={() => decide("granted")}
            className="px-5 py-2.5 rounded-xl bg-deep-purple text-white text-sm font-bold hover:bg-deep-purple/90 transition-colors"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}