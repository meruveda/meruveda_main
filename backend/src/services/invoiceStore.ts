import { config } from '../config/env';
import { assignInvoiceNumber } from '../database/repos/invoices';
import {
  deleteObject,
  getObjectBuffer,
  invoicesBucket,
  listObjects,
  putObject,
  putObjectIfAbsent,
  r2Configured,
  signedGetUrl,
} from './r2';

/**
 * Storage-backed invoice state.
 *
 *   invoices/<order_id>/state.json    the invoice's identity + delivery state
 *   invoices/<order_id>/claim         once-only claim marker (If-None-Match: *)
 *   invoices/<order_id>/<number>.pdf  the rendered PDF, written exactly once
 *
 * Invoice NUMBERS come from Postgres (`assign_invoice_number`), never from
 * bucket listings. R2 gives the two properties the old bucket gave us: a
 * conditional put is a genuine atomic create-or-fail, and reads are by key.
 */

let bucketReady: boolean | null = null;

/** Probe the private invoice bucket. It must exist (created in Phase B). */
export async function ensureInvoiceBucket(): Promise<boolean> {
  if (bucketReady !== null) return bucketReady;

  if (!r2Configured()) {
    console.warn('[InvoiceStore] R2 is not configured — invoices will not be stored.');
    bucketReady = false;
    return false;
  }

  try {
    await listObjects(invoicesBucket(), '', { limit: 1 });
    bucketReady = true;
  } catch (err: any) {
    console.warn('[InvoiceStore] invoice bucket probe failed:', err?.name || err?.message || err);
    bucketReady = false;
  }
  return bucketReady;
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

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export type ChannelName = 'whatsapp' | 'email';

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

export const freshChannelState = (): ChannelState => ({
  status: 'pending',
  attempts: 0,
  lastError: null,
  sentAt: null,
  lastAttemptAt: null,
});

export async function readInvoiceState(orderId: string): Promise<InvoiceState | null> {
  if (!(await ensureInvoiceBucket())) return null;
  const buffer = await getObjectBuffer(invoicesBucket(), invoiceStatePath(orderId));
  if (!buffer) return null;
  try {
    return JSON.parse(buffer.toString('utf8')) as InvoiceState;
  } catch {
    console.warn(`[InvoiceStore] unreadable state.json for order ${orderId}, re-issuing.`);
    return null;
  }
}

export async function writeInvoiceState(orderId: string, state: InvoiceState): Promise<boolean> {
  if (!(await ensureInvoiceBucket())) return false;
  try {
    await putObject(invoicesBucket(), invoiceStatePath(orderId), JSON.stringify(state, null, 2), {
      contentType: 'application/json',
      cacheControl: 'no-store',
    });
    return true;
  } catch (err: any) {
    console.warn(`[InvoiceStore] state write failed for order ${orderId}:`, err?.message || err);
    return false;
  }
}

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

export async function patchInvoiceState(
  orderId: string,
  patch: Partial<InvoiceState>
): Promise<void> {
  const state = await readInvoiceState(orderId);
  if (!state) return;
  await writeInvoiceState(orderId, { ...state, ...patch });
}

/* ------------------------------------------------------------------ */
/* Claim recovery                                                      */
/* ------------------------------------------------------------------ */

export const CLAIM_STALE_MS = 60_000;

export interface InvoiceClaim {
  claimedAt: string;
  owner?: string;
}

export async function readInvoiceClaim(orderId: string): Promise<InvoiceClaim | null> {
  if (!(await ensureInvoiceBucket())) return null;
  const buffer = await getObjectBuffer(invoicesBucket(), invoiceClaimPath(orderId));
  if (!buffer) return null;
  try {
    const parsed = JSON.parse(buffer.toString('utf8'));
    if (parsed && typeof parsed.claimedAt === 'string') return parsed as InvoiceClaim;
    return { claimedAt: new Date(0).toISOString(), owner: 'legacy' };
  } catch {
    return { claimedAt: new Date(0).toISOString(), owner: 'unparseable' };
  }
}

export async function deleteInvoiceClaim(orderId: string): Promise<void> {
  if (!(await ensureInvoiceBucket())) return;
  try {
    await deleteObject(invoicesBucket(), invoiceClaimPath(orderId));
  } catch (err: any) {
    console.warn(`[invoice] step=release-claim order=${orderId}`, err?.message || err);
  }
}

export type ClaimOutcome =
  | { ok: true }
  | { ok: false; busy: true; retryAfterSeconds: number }
  | { ok: true; tookOver: true }
  | { ok: false; busy: false; reason: string };

export async function claimInvoice(
  orderId: string,
  marker: Record<string, unknown>,
  opts: { existingState?: boolean } = {}
): Promise<ClaimOutcome> {
  if (!(await ensureInvoiceBucket())) {
    return { ok: false, busy: false, reason: 'Invoice storage is unavailable right now.' };
  }

  const tryCreate = async (): Promise<boolean> => {
    try {
      return await putObjectIfAbsent(
        invoicesBucket(),
        invoiceClaimPath(orderId),
        JSON.stringify(marker),
        { contentType: 'application/json', cacheControl: 'no-store' },
      );
    } catch (err: any) {
      console.warn(`[invoice] step=claim order=${orderId}`, err?.message || err);
      return false;
    }
  };

  if (await tryCreate()) return { ok: true };

  if (opts.existingState) return { ok: false, busy: false, reason: 'Invoice already issued.' };

  const claim = await readInvoiceClaim(orderId);
  if (!claim) {
    return (await tryCreate()) ? { ok: true } : { ok: false, busy: true, retryAfterSeconds: 3 };
  }

  const age = Date.now() - new Date(claim.claimedAt).getTime();
  if (age < CLAIM_STALE_MS) {
    return { ok: false, busy: true, retryAfterSeconds: 3 };
  }

  console.error(
    `[invoice] step=stale-claim order=${orderId} ageMs=${age} — the previous worker never wrote state.json, taking over`
  );
  await deleteInvoiceClaim(orderId);
  return (await tryCreate()) ? { ok: true, tookOver: true } : { ok: false, busy: true, retryAfterSeconds: 3 };
}

/* ------------------------------------------------------------------ */
/* Numbering                                                            */
/* ------------------------------------------------------------------ */

/**
 * Allocate (or return) the invoice number for an order.
 *
 * The counter lives in Postgres, not in the bucket: `assign_invoice_number`
 * locks the order row, returns the existing number on retries, and increments
 * the FY sequence atomically. `issuedAt` is kept in the signature for callers,
 * but the FY comes from the database clock so every writer agrees.
 */
export async function allocateInvoiceNumber(orderId: string, _issuedAt: Date = new Date()): Promise<string> {
  const number = await assignInvoiceNumber(orderId);
  if (!number) throw new Error(`Invoice numbering returned no number for order ${orderId}`);
  return number;
}

/* ------------------------------------------------------------------ */
/* PDF + links                                                         */
/* ------------------------------------------------------------------ */

export async function uploadInvoicePdf(
  orderId: string,
  invoiceNumber: string,
  pdf: Buffer
): Promise<string | null> {
  if (!(await ensureInvoiceBucket())) return null;
  const objectPath = invoicePdfPath(orderId, invoiceNumber);
  try {
    const created = await putObjectIfAbsent(invoicesBucket(), objectPath, pdf, {
      contentType: 'application/pdf',
      cacheControl: 'private, no-store',
    });
    // Already issued by a concurrent worker: the object is the document.
    return created || (await objectExistsSafe(objectPath)) ? objectPath : null;
  } catch (err: any) {
    console.warn(`[InvoiceStore] PDF upload failed for order ${orderId}:`, err?.message || err);
    return null;
  }
}

async function objectExistsSafe(objectPath: string): Promise<boolean> {
  try {
    return Boolean(await getObjectBuffer(invoicesBucket(), objectPath));
  } catch {
    return false;
  }
}

export async function downloadInvoicePdf(objectPath: string): Promise<Buffer | null> {
  if (!(await ensureInvoiceBucket())) return null;
  if (/^https?:\/\//i.test(objectPath)) return null;
  return getObjectBuffer(invoicesBucket(), objectPath);
}

export async function createInvoiceSignedUrl(objectPath: string): Promise<string | null> {
  if (!objectPath) return null;
  if (/^https?:\/\//i.test(objectPath)) return objectPath;
  return signedGetUrl(invoicesBucket(), objectPath, config.invoiceSignedUrlExpirySeconds);
}

/* ------------------------------------------------------------------ */
/* Sweep support                                                       */
/* ------------------------------------------------------------------ */

export interface StateFileRef {
  orderId: string;
  state: InvoiceState;
}

export async function listRecentInvoiceStates(
  limit = 50,
  since?: Date
): Promise<StateFileRef[]> {
  if (!(await ensureInvoiceBucket())) return [];
  const cutoff = since ? since.getTime() : 0;

  let listing;
  try {
    listing = await listObjects(invoicesBucket(), 'invoices/', {
      delimiter: '/',
      limit: Math.max(limit * 2, 100),
    });
  } catch (err: any) {
    console.warn('[InvoiceStore] could not list invoices/:', err?.message || err);
    return [];
  }

  const found: StateFileRef[] = [];
  for (const prefix of listing.prefixes) {
    if (found.length >= limit) break;
    const orderId = prefix.replace(/^invoices\//, '').replace(/\/$/, '');
    if (!orderId) continue;
    const state = await readInvoiceState(orderId);
    if (!state) continue;
    if (cutoff && new Date(state.issuedAt).getTime() < cutoff) continue;
    found.push({ orderId, state });
  }

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
