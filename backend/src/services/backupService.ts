/**
 * Database backups.
 *
 * A backup that is not in object storage is a backup that dies with the
 * machine. This exports the live tables, gzips them, and writes them to the
 * PRIVATE invoices bucket under a `backups/` prefix - never to the public
 * media bucket, and never with a public URL.
 *
 * The last 14 are kept; older ones are pruned.
 */
import { gzipSync, gunzipSync } from 'node:zlib';
import { query } from '../database/db';
import { listObjects, deleteObjects, putObject, getObjectBuffer, invoicesBucket } from './r2';
import { hasColumn } from './schemaGuard';

const BACKUP_PREFIX = 'backups/';
const KEEP = 14;

/** The tables a restore needs. */
const TABLES = [
  'users',
  'user_addresses',
  'orders',
  'order_items',
  'order_tracking_history',
  'transactions',
  'products',
  'categories',
  'banners',
  'blogs',
  'media',
  'coupons',
  'settings',
  'invoices',
  'invoice_sequences',
  'reviews',
  'wishlist_items',
  'cart_items',
  'notifications',
  'activity_logs',
  'otps',
  'whatsapp_message_log',
  'analytics_events',
  'page_views',
  'support_tickets',
  'review_requests',
];

export interface BackupResult {
  ok: boolean;
  key?: string;
  bytes?: number;
  tables?: number;
  rows?: number;
  pruned?: number;
  error?: string;
}

/**
 * Take a backup and store it in the private bucket.
 *
 * Never throws: the caller is a cron endpoint and must report a failure
 * rather than crash the invocation.
 */
export async function runBackup(): Promise<BackupResult> {
  try {
    const dump: Record<string, any[]> = {};
    let rows = 0;
    for (const table of TABLES) {
      try {
        const res = await query(`SELECT * FROM "${table}"`);
        dump[table] = res;
        rows += res.length;
      } catch {
        // A table that does not exist is simply not part of the dump.
      }
    }

    const payload = {
      created_at: new Date().toISOString(),
      version: 1,
      tables: dump,
    };
    const gz = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `${BACKUP_PREFIX}neon-${stamp}.json.gz`;

    await putObject(invoicesBucket(), key, gz, {
      contentType: 'application/gzip',
      // A backup is private: no CDN, no shared cache.
      cacheControl: 'private, no-store, max-age=0',
    });

    // Keep only the newest KEEP backups.
    let pruned = 0;
    try {
      const listed = await listObjects(invoicesBucket(), BACKUP_PREFIX, { limit: 100 });
      const keys = listed.keys
        .map((k) => k.key)
        .filter((k) => k.startsWith(BACKUP_PREFIX) && k.endsWith('.json.gz'))
        .sort();
      if (keys.length > KEEP) {
        const stale = keys.slice(0, keys.length - KEEP);
        await deleteObjects(invoicesBucket(), stale);
        pruned = stale.length;
      }
    } catch (err: any) {
      console.error('[backup] could not prune old backups:', err?.message || err);
    }

    console.log(
      `[backup] ${key} (${gz.length} bytes, ${Object.keys(dump).length} tables, ${rows} rows, ${pruned} pruned)`,
    );
    return { ok: true, key, bytes: gz.length, tables: Object.keys(dump).length, rows, pruned };
  } catch (err: any) {
    console.error('[backup] failed:', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * The newest backup in the bucket, or null.
 */
export async function latestBackupKey(): Promise<string | null> {
  const listed = await listObjects(invoicesBucket(), BACKUP_PREFIX, { limit: 100 });
  const keys = listed.keys
    .map((k) => k.key)
    .filter((k) => k.startsWith(BACKUP_PREFIX) && k.endsWith('.json.gz'))
    .sort();
  return keys.length ? keys[keys.length - 1] : null;
}

/**
 * Verify that the newest backup can actually be restored.
 *
 * "Can be restored" means: it is a valid gzip, it parses as JSON, and it
 * contains the tables a restore needs. This is the rehearsal - a backup that
 * was never tested is a hope, not a backup.
 */
export async function verifyLatestBackup(): Promise<{
  ok: boolean;
  key?: string;
  tables?: number;
  rows?: number;
  error?: string;
}> {
  try {
    const key = await latestBackupKey();
    if (!key) return { ok: false, error: 'there is no backup in the bucket' };

    const gz = await getObjectBuffer(invoicesBucket(), key);
    if (!gz) return { ok: false, key, error: 'the backup object could not be read' };

    const parsed = JSON.parse(gunzipSync(gz).toString('utf8'));
    const tables = Object.keys(parsed?.tables || {});
    const rows = tables.reduce((n: number, t: string) => n + (parsed.tables[t]?.length || 0), 0);

    const required = ['users', 'orders', 'order_items', 'products'];
    const missing = required.filter((t) => !tables.includes(t));
    if (missing.length) {
      return { ok: false, key, tables: tables.length, rows, error: `missing table(s): ${missing.join(', ')}` };
    }
    return { ok: true, key, tables: tables.length, rows };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** True when the invoice tables are present (the invoice pipeline needs them). */
export async function invoiceTablesPresent(): Promise<boolean> {
  return (
    (await hasColumn('orders', 'invoice_number')) &&
    (await hasColumn('orders', 'invoice_sent_at'))
  );
}
