import { waitUntil } from '@vercel/functions';

/**
 * Keep post-response work alive on serverless.
 *
 * The invoice dispatch (and the Shiprocket push) run AFTER the order response
 * has been sent, so the customer's checkout is never delayed by PDF rendering or
 * Meta/Resend latency. But on Vercel the invocation can be frozen or torn down
 * once the response is flushed, and anything not registered with `waitUntil()`
 * is killed with it — silently, mid-render, with nothing in the database.
 *
 * That is precisely how invoices went missing for every order with no error
 * recorded anywhere: the trigger fired, the promise was dropped, and
 * `saveInvoiceError` had nothing to write to because the column did not exist.
 *
 * `waitUntil` throws outside a Vercel request context (local dev, tests, a
 * plain Node process), so fall back to awaiting-and-swallowing there.
 */
export function keepAlive(work: Promise<unknown>): void {
  // Never let this become an unhandled rejection.
  const settled = Promise.resolve(work).catch((err: unknown) => {
    console.error('[keepAlive] background work failed:', (err as Error)?.message || err);
  });
  try {
    waitUntil(settled);
  } catch {
    // Not a Vercel invocation (local dev / test runner). Hold the process open
    // long enough for the work to finish.
    void settled;
  }
}