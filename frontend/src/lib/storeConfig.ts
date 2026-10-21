/**
 * The store's public configuration, read from the backend.
 *
 * The backend publishes ONE public endpoint for this:
 *   GET /api/auth/otp/config
 * which answers with `{ otpRequired, mode, guestCheckout, accountPages }`.
 *
 * `accountPages` says whether the storefront's account pages (login, signup,
 * forgot/reset password and everything under /account) are switched on. It is
 * read at request time from the backend, exactly like `otpRequired`, so there
 * is NO hardcoded flag in the frontend: flipping ACCOUNT_PAGES_ENABLED on the
 * backend brings the pages back without a rebuild.
 */

import { API_BASE_URL } from "@/utils/apiUrl";

export interface StoreConfig {
  otpRequired: boolean;
  mode: string;
  guestCheckout: boolean;
  accountPages: boolean;
  message: string | null;
}

/**
 * The value used when the backend cannot be reached.
 *
 * The account pages are switched OFF by default (the whole point of the
 * feature), so a backend that is cold or down must not bring them back - it
 * only sends the visitor to the shop, where the checkout still works.
 */
const FALLBACK: StoreConfig = {
  otpRequired: false,
  mode: "off",
  guestCheckout: true,
  accountPages: false,
  message: null,
};

let cached: { value: StoreConfig; at: number } | null = null;
const CACHE_MS = 5000;

/**
 * Read the store configuration.
 *
 * `fresh` skips the short in-process cache (used by the account pages, which
 * must redirect on the current value).
 */
export async function getStoreConfig(options: { fresh?: boolean } = {}): Promise<StoreConfig> {
  if (!options.fresh && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.value;
  }

  try {
    /**
     * A timeout is not optional: without one a backend that accepts the
     * connection but never answers would hang the page render forever.
     */
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/auth/otp/config`, {
        headers: { Accept: "application/json" },
        /**
         * Always `no-store`: the value must never be served from a build-time
         * cache, and the Next.js data cache (`next: { revalidate }`) hangs the
         * dev server. The short in-process cache above does the deduplication.
         */
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`${res.status}`);
    const body = await res.json();
    const data = (body?.data || body || {}) as Partial<StoreConfig>;
    const value: StoreConfig = {
      otpRequired: Boolean(data.otpRequired),
      mode: String(data.mode || FALLBACK.mode),
      guestCheckout: Boolean(data.guestCheckout),
      accountPages: Boolean(data.accountPages),
      message: (data.message as string | null) ?? null,
    };
    cached = { value, at: Date.now() };
    return value;
  } catch (err) {
    console.error(
      `[store-config] the store configuration could not be read: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return FALLBACK;
  }
}

/**
 * Are the storefront account pages switched on?
 *
 * This is the single gate used by the server components that redirect
 * /login, /signup and /account/*.
 */
export async function accountPagesEnabled(): Promise<boolean> {
  const config = await getStoreConfig({ fresh: true });
  return config.accountPages;
}
