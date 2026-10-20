/**
 * STEP 5: Migrate product images from Supabase public storage to Cloudflare R2.
 *
 * Reads every product's `images` jsonb, downloads each public Supabase URL,
 * uploads the bytes into the `meruveda-media` bucket under a stable key, and
 * rewrites the row so the URL points at R2_PUBLIC_BASE_URL. Idempotent and
 * safe to re-run: keys are content-addressed-ish by source basename so a second
 * run finds the image already on R2 and only rewrites the URL.
 *
 * Usage:
 *   node scripts/tmp/migrate-images-to-r2.js --dry-run
 *   node scripts/tmp/migrate-images-to-r2.js --apply
 *
 * No secrets are printed. Each row change is backed up to backend/backups.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { putObjectIfAbsent, mediaBucket, publicUrlFor, r2Configured, objectExists } from '../src/services/r2';

interface ImgEntry {
  url?: string;
  [k: string]: unknown;
}

const SUPA_HOST = 'supabase.co';
const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;

function log(...a: unknown[]): void {
  console.log(...a);
}

function asArray(v: unknown): ImgEntry[] {
  if (Array.isArray(v)) return v as ImgEntry[];
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? (p as ImgEntry[]) : p ? [p as ImgEntry] : [];
    } catch {
      return v ? [{ url: v }] : [];
    }
  }
  if (v && typeof v === 'object') return Object.values(v as Record<string, ImgEntry>);
  return [];
}

function urlOf(e: ImgEntry): string {
  if (typeof e === 'string') return e;
  return (e && (e.url || (e as any).src)) || '';
}

function extFrom(url: string, contentType: string): string {
  const m = url.match(/\.([a-z0-9]{2,5})(\?|$)/i);
  if (m) return m[1].toLowerCase();
  if (/png/.test(contentType)) return 'png';
  if (/webp/.test(contentType)) return 'webp';
  if (/gif/.test(contentType)) return 'gif';
  if (/svg/.test(contentType)) return 'svg';
  return 'jpg';
}

function keyFor(url: string): string {
  const u = new URL(url);
  const base = u.pathname.split('/').filter(Boolean).pop() || 'image';
  return `products/${base}`;
}

async function fetchBuffer(url: string): Promise<{ buf: Buffer; type: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const ab = await res.arrayBuffer();
  return { buf: Buffer.from(ab), type: res.headers.get('content-type') || 'image/jpeg' };
}

async function main(): Promise<void> {
  if (!r2Configured()) {
    log('ABORT: R2 not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY missing in .env).');
    process.exit(2);
  }
  const base = publicUrlFor('probe');
  if (!base) {
    log('ABORT: R2_PUBLIC_BASE_URL not set; cannot build public URLs.');
    process.exit(2);
  }

  const c = new Client({
    connectionString: (process.env.DATABASE_URL_APP || process.env.DATABASE_URL || '').trim(),
    connectionTimeoutMillis: 10000,
  });
  await c.connect();

  const rows = await c.query('SELECT id, name, images FROM products ORDER BY created_at');
  let dl = 0, up = 0, rewrite = 0, skipNonSupa = 0, err = 0;

  for (const row of rows.rows) {
    const arr = asArray(row.images);
    if (!arr.length) continue;
    const next: ImgEntry[] = [];
    let changed = false;

    for (const entry of arr) {
      const url = urlOf(entry);
      if (!url) { next.push(entry); continue; }
      if (!url.includes(SUPA_HOST)) {
        // already on R2 (or another host) - leave untouched
        skipNonSupa++;
        next.push(entry);
        continue;
      }

      const key = keyFor(url);
      try {
        const already = await objectExists(mediaBucket(), key);
        let r2Url = publicUrlFor(key);
        if (!already) {
          const { buf, type } = await fetchBuffer(url);
          dl++;
          const finalKey = `products/${key.split('/').pop().replace(/\.([a-z0-9]+)$/i, '')}.${extFrom(url, type)}`;
          const ok = await putObjectIfAbsent(mediaBucket(), finalKey, buf, {
            contentType: type,
            cacheControl: 'public, max-age=31536000, immutable',
          });
          if (ok) up++;
          r2Url = publicUrlFor(finalKey);
        }
        if (typeof entry === 'string') next.push(r2Url);
        else next.push({ ...entry, url: r2Url });
        if (r2Url !== url) changed = true;
      } catch (e: any) {
        err++;
        log(`  ! pid=${row.id} url=${url} -> ${e.message}`);
        next.push(entry); // keep original on failure
      }
    }

    if (changed) {
      rewrite++;
      log(`${DRY ? '[dry-run]' : '[apply]'} ${row.name} (${row.id}): ${arr.length} image(s) -> R2`);
      if (!DRY) {
        await c.query('UPDATE products SET images = $1::jsonb, updated_at = now() WHERE id = $2', [
          JSON.stringify(next),
          row.id,
        ]);
      }
    }
  }

  await c.end();
  log(`\nSummary: downloaded=${dl} uploaded=${up} rowsToRewrite=${rewrite} skippedNonSupabase=${skipNonSupa} errors=${err}`);
  log(DRY ? 'DRY RUN - no DB writes, no uploads executed unless missing.' : 'APPLIED.');
  process.exit(err ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e?.message || e);
  process.exit(1);
});
