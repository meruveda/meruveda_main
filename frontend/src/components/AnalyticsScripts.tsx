"use client";

import Script from "next/script";
import { analyticsEnabled } from "@/lib/analytics";

/**
 * GA4 + Meta Pixel loader, mounted once in the root layout so the scripts land
 * in <head> on every page. There is no consent gate: both vendors load purely
 * on the ANALYTICS_ENABLED master switch + their env id.
 *
 * A missing id emits nothing — the noscript fallback and the loader are both
 * skipped, so dev/preview stay clean.
 *
 * Vercel Web Analytics is NOT here — it is cookieless and loads in the layout.
 */
export default function AnalyticsScripts() {
  const enabled = analyticsEnabled();
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;

  return (
    <>
      {enabled && gaId ? (
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

      {enabled && pixelId ? (
        <>
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
          <noscript>
            <img
              height="1"
              width="1"
              style={{ display: "none" }}
              src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
              alt=""
            />
          </noscript>
        </>
      ) : null}
    </>
  );
}
