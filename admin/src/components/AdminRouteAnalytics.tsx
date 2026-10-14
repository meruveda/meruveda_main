import { useEffect, useRef } from "react"
import { useLocation } from "react-router-dom"
import { injectSpeedInsights } from "@vercel/speed-insights"

/**
 * Vercel Web Analytics pageviews for a client-side-routed SPA.
 *
 * Vercel's <Analytics /> React component only auto-tracks route changes for the
 * frameworks it ships integrations for (Next, Nuxt, SvelteKit). The admin panel
 * is a Vite SPA on React Router, so navigations were invisible — it reported
 * the login page and nothing else. This sends `pageview` on every route change
 * instead, which is what the Web Analytics dashboard charts.
 *
 * Privacy: cookieless, aggregate-only, and no third-party ad platforms. Paths
 * are masked before sending — admin URLs embed customer/order ids
 * (/customers/<uuid>, /orders/<uuid>), and those must not leave the app.
 */

const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ORDER_NUMBER = /^MV-\d+$/i
const LONG_ID = /^[a-z0-9_-]{16,}$/i

/** Replaces identifier-looking path segments with a placeholder. */
export function maskAdminPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      if (!segment) return segment
      if (UUIDISH.test(segment)) return ":id"
      if (ORDER_NUMBER.test(segment)) return ":order"
      if (LONG_ID.test(segment)) return ":id"
      return segment
    })
    .join("/")
}

export function AdminRouteAnalytics() {
  const location = useLocation()
  const lastPath = useRef<string | null>(null)
  const speedInsights = useRef<ReturnType<typeof injectSpeedInsights> | null>(null)

  // Speed Insights reports vitals against a route, so it needs the same masked
  // path we send as a pageview.
  useEffect(() => {
    speedInsights.current = injectSpeedInsights() ?? null
  }, [])

  useEffect(() => {
    // Skip the duplicate fire React StrictMode causes in development.
    const masked = maskAdminPath(location.pathname)
    if (lastPath.current === masked) return
    lastPath.current = masked

    try {
      // `va` is injected by @vercel/analytics once inject() has run in main.tsx.
      const va = (window as unknown as { va?: (event: string) => void }).va
      va?.("pageview")
    } catch {
      /* analytics must never break the admin panel */
    }

    try {
      speedInsights.current?.setRoute(masked)
    } catch {
      /* same */
    }
  }, [location.pathname])

  return null
}