/**
 * A resilient server-side fetch for the storefront's catalogue pages.
 *
 * The backend is a separate Vercel service. Right after a deploy it can be
 * COLD, and the first request to it can take a couple of seconds to boot
 * (or time out entirely). A single `fetch` with no retry therefore turned
 * into an empty catalogue for real customers.
 *
 * So:
 *   - every attempt has its own timeout,
 *   - there are up to 3 attempts with a short backoff between them,
 *   - the WHOLE thing is bounded to about 8 seconds, so a page never hangs,
 *   - and on total failure the caller THROWS rather than rendering an error.
 *     That matters: in the App Router, a render that throws keeps serving the
 *     last good ISR page, whereas a render that catches the error and shows
 *     an error UI REPLACES the good page with the error UI. Throwing is what
 *     protects the customer.
 */

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_TOTAL_TIMEOUT_MS = 8000;
const BACKOFF_MS = [300, 800];

export interface ApiFetchOptions {
  /** How many attempts in total. */
  attempts?: number;
  /** The overall budget for every attempt and every backoff. */
  totalTimeoutMs?: number;
  /** Next.js fetch options, e.g. `{ next: { revalidate: 300 } }`. */
  next?: { revalidate?: number | false };
  /** A label used in the server log. */
  label?: string;
}

export class ApiUnavailableError extends Error {
  constructor(
    public readonly url: string,
    public readonly lastStatus?: number,
    message?: string,
  ) {
    super(message || `The catalogue service is not available right now.`);
    this.name = 'ApiUnavailableError';
  }
}

/**
 * GET a JSON endpoint with retries, and fail LOUDLY.
 *
 * The response body is returned as parsed JSON. A non-2xx response is a
 * failure and is retried; only a 404 (the resource genuinely does not
 * exist) is returned to the caller, because retrying that is pointless.
 */
export async function apiGetJson<T = any>(
  url: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const startedAt = Date.now();
  let lastStatus: number | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const elapsed = Date.now() - startedAt;
    const remaining = totalTimeoutMs - elapsed;
    if (remaining <= 250) break;

    // Every attempt gets whatever is left of the budget, capped so one slow
    // attempt cannot eat the whole thing.
    const perAttempt = Math.min(remaining, Math.max(1500, Math.floor(totalTimeoutMs / attempts) + 1000));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perAttempt);
    try {
      const res = await fetch(url, {
        ...(options.next ? { next: options.next } : {}),
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      lastStatus = res.status;
      if (res.ok) {
        return (await res.json()) as T;
      }
      // A 404 is an answer, not an outage.
      if (res.status === 404) {
        return (await res.json()) as T;
      }
      lastError = new Error(`${res.status} ${res.statusText}`);
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }

    const wait = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    if (Date.now() - startedAt + wait >= totalTimeoutMs) break;
    await new Promise((r) => setTimeout(r, wait));
  }

  const label = options.label ? `[${options.label}] ` : '';
  console.error(
    `${label}backend fetch failed after ${attempts} attempt(s): ${url}` +
      (lastStatus ? ` -> ${lastStatus}` : '') +
      ` (${lastError instanceof Error ? lastError.message : String(lastError || '')})`,
  );
  throw new ApiUnavailableError(url, lastStatus);
}
