/**
 * Ask the storefront to drop its ISR cache after an admin change.
 *
 * The storefront renders the catalogue with ISR (`revalidate = 60`), so a
 * product or banner edited in the admin used to stay invisible for up to five
 * minutes - and on a cold cache the old page could be served even longer.
 * The storefront exposes a protected `POST /api/revalidate` route that
 * revalidates `/`, `/products` and every product page; the backend calls it
 * right after the write so the customer sees the change on the next reload.
 *
 * Both sides share the `REVALIDATE_SECRET` env var. Without it the call is
 * skipped (never an open endpoint) and the ISR fallback still applies.
 */

const REVALIDATE_TIMEOUT_MS = 8000;

function storefrontBase(): string {
  const configured = (
    process.env.STOREFRONT_URL ||
    process.env.FRONTEND_URL ||
    'https://meruvedawellness.com'
  ).trim();
  return configured.replace(/\/+$/, '');
}

/** True when the backend is able to talk to the storefront revalidation route. */
export function isRevalidationConfigured(): boolean {
  return Boolean((process.env.REVALIDATE_SECRET || '').trim());
}

/**
 * Best-effort revalidation. It never fails the admin write: a storefront that
 * is unreachable must not turn a successful save into an error, the ISR
 * fallback covers that case.
 */
export async function triggerStorefrontRevalidation(reason: string): Promise<boolean> {
  const secret = (process.env.REVALIDATE_SECRET || '').trim();
  if (!secret) return false;

  const url = `${storefrontBase()}/api/revalidate`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-revalidate-token': secret,
      },
      body: JSON.stringify({ reason }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[Revalidate] storefront returned ${res.status} for ${reason}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn(`[Revalidate] storefront revalidation failed for ${reason}:`, err?.message || err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
