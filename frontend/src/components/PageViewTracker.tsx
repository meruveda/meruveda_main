"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import axiosInstance from "@/api/axiosInstance";

/** Stable per-browser-session id — no PII, expires with sessionStorage. */
function getOrCreateSessionId(): string {
  try {
    let id = sessionStorage.getItem("meruveda_pv_sid");
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem("meruveda_pv_sid", id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

function getDeviceType(): string {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (/Mobi|Android|iPhone|iPod|Mobile/i.test(ua)) return "mobile";
  if (/Tablet|iPad/i.test(ua)) return "tablet";
  return "desktop";
}

/**
 * First-party pageview beacon. Fires once per route change, fire-and-forget
 * (errors swallowed) so a tracking failure never affects navigation or UX.
 * Backs the admin Analytics traffic cards; Vercel Web Analytics runs in
 * parallel via <Analytics /> in the root layout.
 */
export default function PageViewTracker() {
  const pathname = usePathname();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || lastTracked.current === pathname) return;
    lastTracked.current = pathname;

    try {
      axiosInstance
        .post("/analytics/pageview", {
          path: pathname,
          referrer: typeof document !== "undefined" ? document.referrer : "",
          sessionId: getOrCreateSessionId(),
          deviceType: getDeviceType(),
        })
        .catch(() => {
          /* fire-and-forget */
        });
    } catch {
      /* never break navigation */
    }
  }, [pathname]);

  return null;
}
