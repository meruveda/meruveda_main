import { supabase } from '../database/supabase';
import { config } from '../config/env';
import { formatInvoiceNumber, invoiceFyLabel } from '@meruveda/shared';

/**
 * Storage-backed invoice state — the ONLY persistence the invoice system uses.
 *
 * Hard constraint: the backend has exactly two database credentials and no
 * ability to change the schema. Everything a tax invoice needs to remember
 * between invocations therefore lives in a private Storage bucket:
 *
 *   invoices/<order_id>/state.json    the invoice's identity + delivery state
 *   invoices/<order_id>/claim         once-only claim marker (upsert:false)
 *   invoices/<order_id>/<number>.pdf  the rendered PDF, written exactly once
 *   counters/<FY>/<000123>            empty numbering markers
 *
 * Storage gives us the two properties a tax invoice needs and a plain table
 * would not: `upsert:false` is a genuine atomic create-or-fail (so a parallel
 * worker can never mint a second number), and the bucket is created lazily so
 * the system works on a project that has never seen it before.
 */

/* ------------------------------------------------------------------ */
/* Bucket                                                              */
/* ------------------------------------------------------------------ */

/**
 * Resolved once per cold start.
 *
 * `undefined` = not attempted yet, `null` = unavailable. Both cache the failure
 * so a misconfigured project does not pay a failed round-trip per invoice; the
 * caller treats `null` as "storage unavailable" and degrades rather than
 * crashing, because a tax invoice must never take an order down.
 */
let bucketReady: boolean | null = null;

/** Ensure the private invoice bucket exists, creating it if necessary. */
export async function ensureInvoiceBucket(): Promise<boolean> {
  if (bucketReady !== null) return bucketReady;

  const bucket = config.invoiceStorageBucket;
  if (!bucket) {
    bucketReady = null;
    return false;
  }

  const client = supabase.storage.from(bucket);

  // Probing by listing is the cheapest call that does not create anything.
  const probe = await client.list('', { limit: 1 });
  if (!probe.error) {
    bucketReady = true;
    return true;
  }

  // Supabase reports a missing bucket by name; anything else is a real failure.
  if (!/bucket not found|not found|does not exist/i.test(probe.error.message || '')) {
    console.warn('[InvoiceStore] bucket probe failed:', probe.error.message);
    bucketReady = null;
    return false;
  }

  const created = await supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,
  });
  if (created.error) {
    // A concurrent cold start may have won the race; that is success, not failure.
    const recheck = await client.list('', { limit: 1 });
    if (recheck.error) {
      console.warn(`[InvoiceStore] could not create private bucket "${bucket}":`, created.error.message);
      bucketReady = null;
      return false;
    }
  }

  bucketReady = true;
  return true;
}

/** Test seam: forget the cached bucket probe. */
export function resetInvoiceBucketCache(): void {
  bucketReady = null;
}

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

/**
 * `MV/26-27/000123` -> `MV_26-27_000123`.
 *
 * The slashes in the printed number are formatting; as an object key they would
 * create a directory tree, so every separator becomes an underscore.
 */
export function safeObjectName(invoiceNumber: string): string {
  return String(invoiceNumber || '').replace(/[^A-Za-z0-9._-]+/g, '_') || 'invoice';
}

export const invoiceStatePath = (orderId: string) => `invoices/${orderId}/state.json`;
export const invoiceClaimPath = (orderId: string) => `invoices/${orderId}/claim`;
export const invoicePdfPath = (orderId: string, invoiceNumber: string) =>
  `invoices/${orderId}/${safeObjectName(invoiceNumber)}.pdf`;
const counterPath = (fy: string, seq: number) => `counters/${fy}/${String(seq).padStart(6, '0')}`;

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export type ChannelName = 'whatsapp' | 'email';

/** Per-channel delivery bookkeeping. Dedupe and retry both read this. */
export interface ChannelState {
  status: 'pending' | 'sent' | 'failed' | 'not_configured';
  attempts: number;
  lastError?: string | null;
  sentAt?: string | null;
  lastAttemptAt?: string | null;
}

export interface InvoiceState {
  invoiceNumber: string;
  orderNumber: string;
  issuedAt: string;
  pdfPath?: string | null;
  /**
   * The payment wording as it stood when the invoice was issued. Frozen so a
   * later payment update can never rewrite what the customer was told on a
   * document they already hold.
   */
  payment: {
    mode: 'cod' | 'prepaid';
    paid: boolean;
    reference?: string | null;
    wording: string;
  };
  channels: {
    whatsapp: ChannelState;
    email: ChannelState;
  };
}

/** A channel that has never been attempted. Exported so callers can rebuild a
 *  whole state object without reaching into the module internals. */
export const freshChannelState = (): ChannelState => ({
  status: 'pending',
  attempts: 0,
  lastError: null,
  sentAt: null,
  lastAttemptAt: null,
});

/** Read the stored state. A missing object is `null`, never an error. */
export async function readInvoiceState(orderId: string): Promise<InvoiceState | null> {
  if (!(await ensureInvoiceBucket())) return null;
  const { data, error } = await supabase.storage
    .from(config.invoiceStorageBucket)
    .download(invoiceStatePath(orderId));
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as InvoiceState;
  } catch {
    // Corrupt state must not wedge the order: treat it as absent and re-issue.
    console.warn(`[InvoiceStore] unreadable state.json for order ${orderId}, re-issuing.`);
    return null;
  }
}

/**
 * Write the state object.
 *
 * `upsert: true` on purpose: the state file is mutable (delivery status changes
 * after issue) and is written by the same claim that guarantees only one writer
 * issues it. An issued invoice is never re-rendered, so a lost update here can
 * never mint a second tax document.
 */
export async function writeInvoiceState(orderId: string, state: InvoiceState): Promise<boolean> {
  if (!(await ensureInvoiceBucket())) return false;
  const { error } = await supabase.storage
    .from(config.invoiceStorageBucket)
    .upload(invoiceStatePath(orderId), JSON.stringify(state, null, 2), {
      contentType: 'application/json',
      cacheControl: '3600',
      upsert: true,
    });
  if (error) {
    console.warn(`[InvoiceStore] state write failed for order ${orderId}:`, error.message);
    return false;
  }
  return true;
}

/** Merge a patch into one channel, preserving anything the patch omits. */
export async function patchChannel(
  orderId: string,
  channel: ChannelName,
  patch: Partial<ChannelState>
): Promise<void> {
  const state = await readInvoiceState(orderId);
  if (!state) return;
  state.channels[channel] = { ...freshChannelState(), ...state.channels[channel], ...patch };
  await writeInvoiceState(orderId, state);
}

/** Merge a patch into the top level of the state (e.g. recording pdfPath). */
export async function patchInvoiceState(
  orderId: string,
  patch: Partial<InvoiceState>
): Promise<void> {
  const state = await readInvoiceState(orderId);
  if (!state) return;
  await writeInvoiceState(orderId, { ...state, ...patch });
}

/* ------------------------------------------------------------------ */
/* Once-only claim                                                     */
/* ------------------------------------------------------------------ */

/**
 * Atomically claim the right to issue an invoice for this order.
 *
 * `upsert: false` means Storage creates the object only if it is absent. If two
 * workers race, exactly one create succeeds and the loser gets `false`. That is
 * the entire once-only guarantee — there is no force flag, because a force path
 * would mint a second tax document for one order.
 *
 * @returns true when this caller owns the issue, false when someone else does.
 */
export async function claimInvoice(orderId: string, marker: Record<string, unknown>): Promise<boolean> {
  if (!(await ensureInvoiceBucket())) {
    // Without storage there is no atomic primitive, so refuse to guess: issuing
    // an un-claimable invoice risks two documents per order.
    console.error(`[InvoiceStore] cannot claim order ${orderId}: invoice bucket unavailable.`);
    return false;
  }
  const { error } = await supabase.storage
    .from(config.invoiceStorageBucket)
    .upload(invoiceClaimPath(orderId), JSON.stringify(marker), {
      contentType: 'application/json',
      cacheControl: '3600',
      upsert: false,
    });
  if (!error) return true;
  // 409/duplicate means another worker holds the claim — the expected race.
  if (/exists|duplicate|already/i.test(error.message || '')) return false;
  console.warn(`[InvoiceStore] claim failed for order ${orderId}:`, error.message);
  return false;
}

/* ------------------------------------------------------------------ */
/* Numbering                                                           */
/* ------------------------------------------------------------------ */

/** How many successors to try when another worker takes the number we picked. */
const MAX_ALLOCATE_ATTEMPTS = 20;

/**
 * Allocate the next `MV/<FY>/<000123>` for the given issue date.
 *
 * The FY is derived from the invoice date at call time, never hardcoded, so the
 * series rolls over on 1 April without a deploy.
 *
 * Allocation is "list, take highest + 1, create the marker with `upsert:false`".
 * The create is the atomic step: if a concurrent worker took that number in
 * between, the create fails and we simply look again for the next one. A number
 * can therefore be *skipped* if a worker dies mid-allocation, but two invoices
 * can never share one — uniqueness is guaranteed, gaplessness is not.
 */
export async function allocateInvoiceNumber(issuedAt: Date = new Date()): Promise<string> {
  const fy = invoiceFyLabel(issuedAt);
  const client = supabase.storage.from(config.invoiceStorageBucket);

  for (let attempt = 0; attempt < MAX_ALLOCATE_ATTEMPTS; attempt++) {
    const { data: markers } = await client.list(`counters/${fy}`, { limit: 1000 });
    let highest = 0;
    for (const marker of markers || []) {
      const seq = Number((marker.name || '').split('.')[0]);
      if (Number.isFinite(seq) && seq > highest) highest = seq;
    }
    const candidate = highest + 1;

    const { error } = await client.upload(counterPath(fy, candidate), new Blob([]), {
      contentType: 'application/octet-stream',
      cacheControl: '3600',
      upsert: false,
    });
    if (!error) return formatInvoiceNumber(fy, candidate);

    if (!/exists|duplicate|already/i.test(error.message || '')) {
      console.warn(`[InvoiceStore] counter marker write failed for ${counterPath(fy, candidate)}:`, error.message);
    }
    // Lost the race for `candidate` — loop and re-read the directory.
  }

  throw new Error(`Could not allocate an invoice number for FY ${fy} after ${MAX_ALLOCATE_ATTEMPTS} attempts.`);
}

/* ------------------------------------------------------------------ */
/* PDF + links                                                         */
/* ------------------------------------------------------------------ */

/** Store the rendered PDF. Written once, never regenerated. */
export async function uploadInvoicePdf(
  orderId: string,
  invoiceNumber: string,
  pdf: Buffer
): Promise<string | null> {
  if (!(await ensureInvoiceBucket())) return null;
  const objectPath = invoicePdfPath(orderId, invoiceNumber);
  const { error } = await supabase.storage
    .from(config.invoiceStorageBucket)
    .upload(objectPath, pdf, {
      contentType: 'application/pdf',
      cacheControl: '3600',
      upsert: false,
    });
  if (error) {
    console.warn(`[InvoiceStore] PDF upload failed for order ${orderId}:`, error.message);
    return null;
  }
  return objectPath;
}

/** Download a stored PDF. Returns null when the object is absent. */
export async function downloadInvoicePdf(objectPath: string): Promise<Buffer | null> {
  if (!(await ensureInvoiceBucket())) return null;
  if (/^https?:\/\//i.test(objectPath)) return null;
  const { data, error } = await supabase.storage
    .from(config.invoiceStorageBucket)
    .download(objectPath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Mint a time-limited link to a stored invoice.
 *
 * Needed by WhatsApp (Meta fetches the document over HTTPS) and by "View
 * invoice". Expiring is correct here: these are share links, not the document.
 */
export async function createInvoiceSignedUrl(objectPath: string): Promise<string | null> {
  if (!objectPath || !config.invoiceStorageBucket) return null;
  if (/^https?:\/\//i.test(objectPath)) return objectPath;
  const { data, error } = await supabase.storage
    .from(config.invoiceStorageBucket)
    .createSignedUrl(objectPath, config.invoiceSignedUrlExpirySeconds);
  if (error || !data?.signedUrl) {
    console.warn('[InvoiceStore] signed URL failed:', error?.message || 'no url');
    return null;
  }
  return data.signedUrl;
}

/* ------------------------------------------------------------------ */
/* Sweep support                                                       */
/* ------------------------------------------------------------------ */

export interface StateFileRef {
  orderId: string;
  state: InvoiceState;
}

/**
 * List recent invoices and their state, newest first.
 *
 * Used by the delivery sweep: when the WhatsApp slot was empty at issue time
 * the invoice still exists, it simply never reached WhatsApp. This finds those
 * without needing any index, so no schema change is required.
 *
 * Storage lists one directory level at a time, so this walks `invoices/` and
 * reads each order's state file. Bounded by `limit` and `since` to stay cheap.
 */
export async function listRecentInvoiceStates(
  limit = 50,
  since?: Date
): Promise<StateFileRef[]> {
  if (!(await ensureInvoiceBucket())) return [];
  const client = supabase.storage.from(config.invoiceStorageBucket);
  const cutoff = since ? since.getTime() : 0;

  const { data: orders, error } = await client.list('invoices', { limit: Math.max(limit * 2, 100) });
  if (error) {
    console.warn('[InvoiceStore] could not list invoices/:', error.message);
    return [];
  }

  const found: StateFileRef[] = [];
  for (const entry of orders || []) {
    if (found.length >= limit) break;
    if (!entry.name) continue;

    const orderId = entry.name;
    const state = await readInvoiceState(orderId);
    if (!state) continue;
    if (cutoff && new Date(state.issuedAt).getTime() < cutoff) continue;
    found.push({ orderId, state });
  }

  // Storage listing order is not guaranteed, and the sweep wants the newest first.
  found.sort((a, b) => new Date(b.state.issuedAt).getTime() - new Date(a.state.issuedAt).getTime());
  return found.slice(0, limit);
}

export const invoiceStore = {
  ensureInvoiceBucket,
  readInvoiceState,
  writeInvoiceState,
  patchChannel,
  patchInvoiceState,
  freshChannelState,
  allocateInvoiceNumber,
  claimInvoice,
  uploadInvoicePdf,
  downloadInvoicePdf,
  createInvoiceSignedUrl,
  listRecentInvoiceStates,
  invoiceStatePath,
  invoicePdfPath,
  safeObjectName,
  resetInvoiceBucketCache,
};