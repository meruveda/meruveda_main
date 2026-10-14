"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { CONSENT_EVENT, getConsent } from "@/lib/analytics";

/**
 * GA4 + Meta Pixel loader.
 *
 * Both scripts are rendered ONLY after the visitor accepts in the consent
 * banner (DPDP Act). When NEXT_PUBLIC_GA_ID / NEXT_PUBLIC_META_PIXEL_ID are
 * unset, nothing is emitted at all — dev and preview stay completely clean, and
 * a missing id can never leave a half-initialised tag behind.
 *
 * Accepting without a reload: the banner dispatches CONSENT_EVENT, this
 * component listens and swaps `granted` in, and the scripts load then.
 *
 * Vercel Web Analytics is NOT here — it is cookieless and loads in the layout
 * with no consent gate.
 */
export default function AnalyticsScripts() {
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    const sync = () => setConsented(getConsent() === "granted");
    sync();
    window.addEventListener(CONSENT_EVENT, sync);
    // Another tab accepted — pick it up without a reload.
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CONSENT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (!consented) return null;

  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;

  return (
    <>
      {gaId ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
            strategy="afterInteractive"
            id="ga4-loader"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = window.gtag || gtag;
              gtag('js', new Date());
              gtag('config', '${gaId}', { send_page_view: true });
            `}
          </Script>
        </>
      ) : null}

      {pixelId ? (
        <Script
          src="https://connect.facebook.net/en_US/fbevents.js"
          strategy="afterInteractive"
          id="meta-pixel"
          onLoad={() => {
            try {
              // Standard Meta pixel bootstrap. `eventID` is passed per event by
              // lib/analytics so a future server-side Conversions API event can
              // be deduplicated against it.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const fbq = ((window as any).fbq =
                (window as any).fbq ||
                function (...args: unknown[]) {
                  // eslint-disable-next-line prefer-rest-params
                  ((fbq as any).q = (fbq as any).q || []).push(args);
                });
              if (!(fbq as any).initialized) {
                (fbq as any).initialized = true;
                (fbq as any).q = [];
                fbq("init", pixelId);
                fbq("track", "PageView");
              }
            } catch {
              /* pixel is best-effort */
            }
          }}
        />
      ) : null}
    </>
  );
}