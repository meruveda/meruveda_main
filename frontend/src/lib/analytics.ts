/**
 * Analytics wrapper — one entry point, fanned out to every backend we use.
 *
 *   track()  ->  first-party beacon (ours, cookieless)
 *                Vercel Web Analytics (cookieless)
 *                GA4 + Meta Pixel   (gated by env ids + ANALYTICS_ENABLED)
 *
 * Design rules, all enforced here rather than at each call site:
 *   0. GA4 + Meta Pixel sit behind the ANALYTICS_ENABLED master switch, which
 *      is OFF by default (see analyticsEnabled).
 *   1. There is no consent banner and no consent gate anywhere — vendor scripts
 *      load and fire based purely on the env ids + the master switch.
 *   2. Missing env ids (NEXT_PUBLIC_GA_ID / NEXT_PUBLIC_META_PIXEL_ID) mean the
 *      scripts were never rendered, so the global is absent and we skip.
 *   3. No PII leaves the site. Params are passed through a denylist scrub, and
 *      ids we generate are random — never an email, phone or customer id.
 *   4. `purchase` fires once per order, persisted by order number, so a refresh
 *      (or the polling this page already does) cannot double count.
 */

/** localStorage key holding order numbers we already counted as a purchase. */
const PURCHASE_SEEN_KEY = "meruveda_purchase_seen";
/** Most recent order numbers kept in that list (bound the storage growth). */
const PURCHASE_SEEN_MAX = 50;

export type AnalyticsValue = string | number | boolean | null | undefined;

export interface AnalyticsItem {
  item_id?: string;
  item_name?: string;
  price?: number;
  quantity?: number;
  [key: string]: AnalyticsValue | undefined;
}

export interface TrackParams {
  value?: number;
  currency?: string;
  transaction_id?: string;
  payment_type?: string;
  items?: AnalyticsItem[];
  item_id?: string;
  item_name?: string;
  [key: string]: AnalyticsValue | AnalyticsItem[] | undefined;
}

/** E-commerce events we forward to our own database. Anything else is dropped. */
const FIRST_PARTY_EVENTS = new Set([
  "view_item",
  "view_item_list",
  "add_to_cart",
  "remove_from_cart",
  "begin_checkout",
  "add_shipping_info",
  "add_payment_info",
  "purchase",
]);

// ---------------------------------------------------------------------------
// Master switch — Google Analytics + Meta Pixel
// ---------------------------------------------------------------------------

/**
 * ANALYTICS_ENABLED — the single kill-switch for the two vendor tags
 * (Google Analytics 4 and Meta Pixel).
 *
 * Both vendors are DISABLED unless NEXT_PUBLIC_ANALYTICS_ENABLED is exactly the
 * string "true". With it off, no gtag/js and no fbevents.js are ever rendered or
 * requested. The cookieless first-party measurement (our own beacon + Vercel)
 * is NOT behind this switch and keeps running.
 *
 * Read at call time instead of being captured in a module-level const: Next.js
 * inlines the NEXT_PUBLIC_ literal at build time either way, and per-call
 * reading keeps the switch testable (tests flip env between cases).
 */
export function analyticsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === "true";
}

/**
 * Stable per-browser-session id, shared by the pageview beacon and the
 * e-commerce events so a funnel can be joined on session. Deliberately random
 * and session-scoped — it is not a user id and leaves no trace across visits.
 */
export function getSessionId(): string {
  if (typeof window === "undefined") return "unknown";
  try {
    let id = window.sessionStorage.getItem("meruveda_pv_sid");
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      window.sessionStorage.setItem("meruveda_pv_sid", id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Purchase dedupe (once per order, across refreshes)
// ---------------------------------------------------------------------------

function readSeenPurchases(): string[] {
  try {
    const raw = window.localStorage.getItem(PURCHASE_SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeSeenPurchases(list: string[]): void {
  try {
    window.localStorage.setItem(PURCHASE_SEEN_KEY, JSON.stringify(list.slice(-PURCHASE_SEEN_MAX)));
  } catch {
    /* non-fatal: worst case this order counts twice in the analytics tools */
  }
}

/**
 * Claims a purchase. Returns true the first time it is called for an order id
 * and false for every later call (refresh, back button, polling) — the caller
 * must only send the event when this returns true.
 *
 * Exported for tests and for the success page, which needs the same answer.
 */
export function claimPurchaseOnce(orderId: string): boolean {
  if (!orderId || typeof window === "undefined") return false;
  const seen = readSeenPurchases();
  if (seen.includes(orderId)) return false;
  writeSeenPurchases([...seen, orderId]);
  return true;
}

// ---------------------------------------------------------------------------
// PII scrub
// ---------------------------------------------------------------------------

const PII_KEYS = new Set([
  "email",
  "email_address",
  "phone",
  "phone_number",
  "name",
  "first_name",
  "last_name",
  "full_name",
  "address",
  "shipping_address",
  "billing_address",
  "user_id",
  "userid",
  "customer_id",
  "user",
  "auth",
]);

const PII_KEY_PATTERNS = [
  // user_id / customer_id / account_ref and friends. Deliberately NOT a bare
  // /_id$/ rule: commerce ids we are required to send (item_id, transaction_id,
  // product_id, order_id) are business references, not customer data.
  /^(user|customer|account)_/,
  /(email|phone|address)$/,
];

function isPiiKey(key: string): boolean {
  const k = key.toLowerCase();
  if (k === "session_id") return false; // random per-browser-session id
  if (PII_KEYS.has(k)) return true;
  return PII_KEY_PATTERNS.some((re) => re.test(k));
}

/** Strips anything that looks like PII, at the top level and inside items. */
export function sanitizeParams(params: TrackParams = {}): Record<string, AnalyticsValue> {
  const out: Record<string, AnalyticsValue> = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    if (key === "items") continue; // handled below
    if (isPiiKey(key)) continue;
    out[key] = value as AnalyticsValue;
  }
  return out;
}

function sanitizeItems(items: AnalyticsItem[] | undefined): AnalyticsItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const clean: AnalyticsItem = {};
      for (const [key, value] of Object.entries(item || {})) {
        if (value === undefined || value === null) continue;
        if (isPiiKey(key)) continue;
        clean[key] = value;
      }
      return clean;
    })
    .filter((item) => Object.keys(item).length > 0);
}

// ---------------------------------------------------------------------------
// Fan-out targets
// ---------------------------------------------------------------------------

type GtagFn = (command: string, target: string, params?: Record<string, unknown>) => void;
type FbqFn = (command: string, ...args: unknown[]) => void;

interface AnalyticsGlobals {
  gtag?: GtagFn;
  fbq?: FbqFn;
}

function globals(): AnalyticsGlobals {
  if (typeof window === "undefined") return {};
  return window as unknown as AnalyticsGlobals;
}

/**
 * True only when GA4 is fully usable: the master switch is on, an id is
 * configured (so the script was actually rendered), and the global has loaded.
 */
export function gaEnabled(): boolean {
  return (
    analyticsEnabled() &&
    !!gaId() &&
    typeof globals().gtag === "function"
  );
}

/** Same conditions for Meta Pixel. */
export function pixelEnabled(): boolean {
  return (
    analyticsEnabled() &&
    !!pixelId() &&
    typeof globals().fbq === "function"
  );
}

/** Vercel Web Analytics is cookieless, so it needs no gate. */
export function vercelEnabled(): boolean {
  return typeof window !== "undefined";
}

export function gaId(): string {
  return process.env.NEXT_PUBLIC_GA_ID || "";
}

export function pixelId(): string {
  return process.env.NEXT_PUBLIC_META_PIXEL_ID || "";
}

// ---------------------------------------------------------------------------
// The wrapper
// ---------------------------------------------------------------------------

let beacon: ((path: string, body: Record<string, unknown>) => void) | null = null;

/**
 * Lets the layout inject the existing axios instance so this module stays free
 * of app-level imports (and testable without React).
 */
export function setBeacon(fn: (path: string, body: Record<string, unknown>) => void): void {
  beacon = fn;
}

function fireFirstParty(event: string, path: string, params: TrackParams): void {
  if (!FIRST_PARTY_EVENTS.has(event) || !beacon) return;
  const body: Record<string, unknown> = {
    event,
    path,
    sessionId: getSessionId(),
    // Only the non-identifying values survive the scrub.
    ...sanitizeParams(params),
  };
  const items = sanitizeItems(params.items);
  if (items.length) {
    // The beacon stores one row per event; a single representative product id
    // is enough for "top products viewed" (first item of the list).
    body.product_id = items[0]?.item_id;
  }
  // Do not let a tracking failure surface to the caller.
  try {
    beacon("/analytics/event", body);
  } catch {
    /* fire-and-forget */
  }
}

async function fireVercel(event: string, params: TrackParams): Promise<void> {
  if (!vercelEnabled()) return;
  try {
    const mod = await import("@vercel/analytics");
    // Vercel's API takes primitives only, so the item array is summarised as a
    // count here — GA4 and Meta Pixel are the destinations that get the detail.
    const scrubbed = sanitizeParams(params);
    const clean: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(scrubbed)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        clean[key] = value;
      }
    }
    const items = sanitizeItems(params.items);
    if (items.length) clean.items_count = items.length;
    mod.track(event, clean);
  } catch {
    /* analytics must never break the page */
  }
}

function fireGa(event: string, params: TrackParams): void {
  if (!gaEnabled()) return;
  try {
    const gtag = globals().gtag!;
    const clean = sanitizeParams(params);
    const items = sanitizeItems(params.items);
    gtag("event", event, items.length ? { ...clean, items } : clean);
  } catch {
    /* ignore */
  }
}

function firePixel(event: string, params: TrackParams, eventId: string): void {
  if (!pixelEnabled()) return;
  try {
    const fbq = globals().fbq!;
    const clean = sanitizeParams(params);
    const items = sanitizeItems(params.items);
    const payload: Record<string, unknown> = items.length ? { ...clean, items } : { ...clean };
    // The same eventID goes to the browser Pixel and, later, to a server-side
    // Conversions API event, so Meta can dedupe the two. We only generate and
    // pass it here — no CAPI call is made.
    fbq("track", event, payload, { eventID: eventId });
  } catch {
    /* ignore */
  }
}

function newEventId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The single call site for every analytics event in the storefront.
 *
 * GA4 and Meta Pixel are skipped unless the master switch is on, the id is
 * configured and the script has loaded. Cookieless destinations (our own
 * beacon, Vercel) always run. `purchase` is deduped per order id.
 */
export function track(event: string, params: TrackParams = {}): void {
  if (typeof window === "undefined") return;

  const path =
    (typeof window.location !== "undefined" && window.location.pathname) || "";

  let eventId = "";
  if (event === "purchase") {
    // Once per order — nothing else about this event reaches any destination
    // on a refresh.
    const orderId = String(params.transaction_id || "");
    if (!claimPurchaseOnce(orderId)) return;
    eventId = newEventId();
  }

  fireFirstParty(event, path, params);
  void fireVercel(event, params);
  fireGa(event, params);
  firePixel(event, params, eventId || newEventId());
}

export default { track };