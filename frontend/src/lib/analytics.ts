/**
 * Analytics wrapper — one entry point, fanned out to every backend we use.
 *
 *   track()  ->  first-party beacon (ours, cookieless, no consent needed)
 *                Vercel Web Analytics (cookieless, no consent needed)
 *                GA4 + Meta Pixel   (CONSENT-GATED: only after the user accepts)
 *
 * Design rules, all enforced here rather than at each call site:
 *   1. Nothing is loaded and nothing fires for GA4/Meta before consent is
 *      granted (DPDP Act). `track()` is a safe no-op for them without it.
 *   2. Missing env ids (NEXT_PUBLIC_GA_ID / NEXT_PUBLIC_META_PIXEL_ID) mean the
 *      scripts were never rendered, so the global is absent and we skip.
 *   3. No PII leaves the site. Params are passed through a denylist scrub, and
 *      ids we generate are random — never an email, phone or customer id.
 *   4. `purchase` fires once per order, persisted by order number, so a refresh
 *      (or the polling this page already does) cannot double count.
 */

/** localStorage key holding the consent choice. */
export const CONSENT_KEY = "meruveda_consent";
/** localStorage key holding order numbers we already counted as a purchase. */
const PURCHASE_SEEN_KEY = "meruveda_purchase_seen";
/** Most recent order numbers kept in that list (bound the storage growth). */
const PURCHASE_SEEN_MAX = 50;

/** Custom DOM event so an Accept click can load the scripts without a reload. */
export const CONSENT_EVENT = "meruveda:consent";

export type ConsentValue = "granted" | "denied";

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
// Consent
// ---------------------------------------------------------------------------

export function getConsent(): ConsentValue | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    return raw === "granted" || raw === "denied" ? raw : null;
  } catch {
    return null;
  }
}

export function setConsent(value: ConsentValue): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
  } catch {
    /* storage unavailable — the banner will simply ask again next visit */
  }
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: { consent: value } }));
  } catch {
    /* no CustomEvent support: scripts load on the next navigation */
  }
}

/** True only when the user actively accepted. Anything else blocks GA4/Meta. */
export function hasThirdPartyConsent(): boolean {
  return getConsent() === "granted";
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
  /^(user|customer|account)_/,
  /(email|phone|address)$/,
  /_id$/, // user_id / customer_id / auth_id — our own ids are PII-adjacent;
]; // session_id is allowed back in below (it is a random, non-identifying id).

function isPiiKey(key: string): boolean {
  const k = key.toLowerCase();
  if (k === "session_id") return false;
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

/** True when the GA4 snippet is present AND consent was granted. */
export function gaEnabled(): boolean {
  return hasThirdPartyConsent() && typeof globals().gtag === "function";
}

/** True when the Meta Pixel snippet is present AND consent was granted. */
export function pixelEnabled(): boolean {
  return hasThirdPartyConsent() && typeof globals().fbq === "function";
}

/** Vercel Web Analytics is cookieless and consent-free, so it needs no gate. */
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
 * Consent-gated destinations (GA4, Meta Pixel) are skipped unless the user has
 * accepted AND the script is actually loaded. Cookieless destinations (our own
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