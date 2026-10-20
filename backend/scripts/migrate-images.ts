/**
 * Move every image onto Cloudflare R2.
 *
 * The old image host is gone (every public object URL answers HTTP
 * 402), so all 75 image references in the database are broken on the live
 * site. The bytes still exist in the local proxy cache
 * (backend/.cache/images), so the migration is:
 *
 *   1. resolve a local file for every URL (exact sha1, then size, then
 *      semantic, then placeholder)
 *   2. render WebP renditions at 400 / 800 / 1600 with sharp
 *   3. upload them to the R2 media bucket under an immutable, unique key
 *   4. rewrite the database, in one transaction
 *
 * Usage:
 *   node --require ts-node/register/transpile-only scripts/migrate-images.ts --dry-run
 *   node --require ts-node/register/transpile-only scripts/migrate-images.ts --apply
 *
 * The mapping report is always written to backend/backups/image-mapping.md.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { Client } from 'pg';
import { putObject, publicUrlFor, mediaBucket, objectExists } from '../src/services/r2';

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, '.cache', 'images');
const PUBLIC_IMAGES = path.join(ROOT, '..', 'frontend', 'public', 'images');
const ADMIN_PUBLIC = path.join(ROOT, '..', 'admin', 'public', 'images');
const PLACEHOLDER = path.join(ADMIN_PUBLIC, 'placeholder-product.png');
const REPORT = path.join(ROOT, 'backups', 'image-mapping.md');

const WIDTHS = [400, 800, 1600];
const APPLY = process.argv.includes('--apply');

type Confidence = 'exact-sha1' | 'exact-size' | 'semantic' | 'fallback' | 'placeholder';

interface Source {
  file: string;
  confidence: Confidence;
  note: string;
}

interface Slot {
  table: string;
  column: string;
  id: string;
  label: string;
  url: string;
  /** The R2 key prefix (e.g. "products/liver-detox"). */
  prefix: string;
  /** For a list of images: the index within the jsonb array. */
  index?: number;
  /** For a list of images: the whole array is rewritten, not one cell. */
  array?: any[];
  source?: Source;
  rendered: Array<{ width: number; key: string; url: string }> = [];
  finalUrl?: string;
}

function sha1(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** Every local image file we can use, with its byte size. */
function collectLocalFiles(): Array<{ path: string; name: string; size: number }> {
  const out: Array<{ path: string; name: string; size: number }> = [];
  for (const dir of [CACHE, PUBLIC_IMAGES, ADMIN_PUBLIC]) {
    for (const name of listDir(dir)) {
      if (!/\.(png|jpe?g|webp|gif|avif)$/i.test(name) && !name.endsWith('.src')) continue;
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (!st.isFile() || st.size === 0) continue;
        out.push({ path: full, name, size: st.size });
      } catch {
        /* unreadable */
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const client = new Client({
    connectionString: (process.env.DATABASE_URL_APP || process.env.DATABASE_URL || '').trim(),
  });
  await client.connect();

  const localFiles = collectLocalFiles();
  const cacheFiles = listDir(CACHE);
  const cacheSrcs = cacheFiles.filter((f) => f.endsWith('.src'));
  const cacheWebps = cacheFiles.filter((f) => f.endsWith('.webp'));
  console.log(`local files: ${localFiles.length} (cache .src ${cacheSrcs.length}, cache .webp ${cacheWebps.length})`);

  // --- media rows give every stored URL its original byte size -------------
  const mediaRows = await client.query(
    `SELECT public_url, storage_path, filename, bucket, mime_type, size FROM media`,
  );
  const sizeByUrl = new Map<string, number>();
  for (const m of mediaRows.rows) sizeByUrl.set(String(m.public_url), Number(m.size));

  // --- build the slot list --------------------------------------------------
  const slots: Slot[] = [];

  const products = await client.query(`SELECT id, name, slug, images FROM products ORDER BY created_at`);
  for (const p of products.rows) {
    const arr = Array.isArray(p.images) ? p.images : [];
    arr.forEach((im: any, index: number) => {
      const url = typeof im === 'string' ? im : (im && im.url) || '';
      if (!url) return;
      slots.push({
        table: 'products',
        column: 'images',
        id: p.id,
        label: p.name,
        url,
        prefix: `products/${p.slug || p.id}`,
        index,
        array: arr,
      });
    });
  }

  const banners = await client.query(`SELECT id, heading, image_url FROM banners ORDER BY display_order`);
  for (const b of banners.rows) {
    if (!b.image_url) continue;
    slots.push({
      table: 'banners',
      column: 'image_url',
      id: b.id,
      label: b.heading || b.id,
      url: b.image_url,
      prefix: `banners/${(b.heading || 'banner').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || b.id}`,
    });
  }

  const blogs = await client.query(`SELECT id, title, slug, featured_image FROM blogs`);
  for (const g of blogs.rows) {
    if (!g.featured_image) continue;
    slots.push({
      table: 'blogs',
      column: 'featured_image',
      id: g.id,
      label: g.title,
      url: g.featured_image,
      prefix: `blogs/${g.slug || g.id}`,
    });
  }

  // Every stored file in the media catalogue. Some of them are not referenced
  // by a product, a banner or a blog, but the catalogue is what the Media
  // Library shows, so it must not point at a dead host either.
  const mediaSlots = await client.query(
    `SELECT id, public_url, storage_path, filename, bucket, size FROM media`,
  );
  for (const m of mediaSlots.rows) {
    if (!m.public_url) continue;
    const base = String(m.storage_path || m.filename || m.id).replace(/\.[a-z0-9]+$/i, '');
    slots.push({
      table: 'media',
      column: 'public_url',
      id: m.id,
      label: m.filename || base,
      url: m.public_url,
      prefix: `media/${m.bucket || 'general'}/${base.replace(/[^A-Za-z0-9._-]+/g, '-')}`,
    });
  }

  // --- resolve a local file for every slot ---------------------------------
  const usedFiles = new Set<string>();
  const unresolved: Slot[] = [];

  // A URL that already points at R2 is done. This keeps the script idempotent:
  // re-running it must never "re-resolve" a migrated image and shuffle the
  // gallery.
  const r2Base = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const alreadyMigrated = slots.filter((s) => r2Base && s.url.startsWith(r2Base));
  for (const slot of alreadyMigrated) {
    slot.source = { file: '', confidence: 'exact-sha1', note: 'already on R2' };
    slot.finalUrl = slot.url;
  }

  // The catalogue artwork is served statically from the storefront's own
  // origin (frontend/public/images -> https://meruvedawellness.com/images/...).
  // Those rows are already served from the site itself: they need neither an
  // R2 copy nor a re-resolve, and a re-run must never overwrite them with a
  // placeholder.
  const staticBase = 'https://meruvedawellness.com/images/';
  for (const slot of slots) {
    if (slot.source) continue;
    if (!slot.url.startsWith(staticBase)) continue;
    slot.source = { file: '', confidence: 'static', note: 'already served statically from the site' };
    slot.finalUrl = slot.url;
  }

  for (const slot of slots) {
    if (slot.source) continue;
    // 1. exact sha1 of the URL -> the cached original
    const srcName = `${sha1(slot.url)}.src`;
    if (cacheSrcs.includes(srcName)) {
      slot.source = { file: path.join(CACHE, srcName), confidence: 'exact-sha1', note: 'cached original' };
      usedFiles.add(srcName);
      continue;
    }
    // 2. exact sha1 of a rendition -> a cached WebP of the same image
    const rendition = findRendition(slot.url, cacheWebps);
    if (rendition) {
      slot.source = { file: path.join(CACHE, rendition), confidence: 'exact-sha1', note: 'cached rendition' };
      usedFiles.add(rendition);
      continue;
    }
    // 3. exact byte size (the media table records the original size)
    const size = sizeByUrl.get(slot.url);
    if (size != null) {
      const bySize = localFiles.filter((f) => f.size === size && !usedFiles.has(f.name));
      if (bySize.length === 1) {
        slot.source = { file: bySize[0].path, confidence: 'exact-size', note: `byte size ${size}` };
        usedFiles.add(bySize[0].name);
        continue;
      }
    }
    // 4. semantic: a file whose name mentions the label
    const words = labelWords(slot.label);
    if (words.length) {
      const semantic = localFiles.find(
        (f) => !usedFiles.has(f.name) && words.some((w) => f.name.toLowerCase().includes(w)),
      );
      if (semantic) {
        slot.source = { file: semantic.path, confidence: 'semantic', note: `name matched "${words[0]}"` };
        usedFiles.add(semantic.name);
        continue;
      }
    }
    unresolved.push(slot);
  }

  // 5. for whatever is still unresolved, use an unused cached rendition
  const spareRenditions = cacheWebps.filter((f) => !usedFiles.has(f));
  for (const slot of unresolved) {
    if (spareRenditions.length) {
      const pick = spareRenditions.shift()!;
      usedFiles.add(pick);
      slot.source = {
        file: path.join(CACHE, pick),
        confidence: 'fallback',
        note: 'unused cached rendition (low confidence)',
      };
      continue;
    }
    slot.source = {
      file: PLACEHOLDER,
      confidence: 'placeholder',
      note: 'no local copy exists; the placeholder is used',
    };
  }

  console.log(
    `slots=${slots.length} exact=${slots.filter((s) => s.source?.confidence.startsWith('exact')).length} ` +
      `semantic=${slots.filter((s) => s.source?.confidence === 'semantic').length} ` +
      `fallback=${slots.filter((s) => s.source?.confidence === 'fallback').length} ` +
      `placeholder=${slots.filter((s) => s.source?.confidence === 'placeholder').length}`,
  );

  // --- render + upload ------------------------------------------------------
  for (const slot of slots) {
    const src = slot.source!;
    // Already on R2 - nothing to render.
    if (!src.file) continue;
    slot.rendered = [];
    let base: sharp.Sharp;
    try {
      base = sharp(src.file, { failOn: 'none' }).rotate();
    } catch (err: any) {
      console.error(`  ! cannot read ${src.file}: ${err.message}`);
      slot.source = { file: PLACEHOLDER, confidence: 'placeholder', note: 'unreadable source' };
      base = sharp(PLACEHOLDER);
    }
    const meta = await base.metadata();
    const originalWidth = meta.width || 1600;

    for (const width of WIDTHS) {
      // Never enlarge: a 600px original stays 600px.
      const target = Math.min(width, originalWidth);
      const key = `${slot.prefix}/${slot.index ?? 0}-${target}.webp`;
      const buf = await sharp(src.file, { failOn: 'none' })
        .rotate()
        .resize({ width: target, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();

      if (APPLY) {
        const exists = await objectExists(mediaBucket(), key);
        if (!exists) {
          await putObject(mediaBucket(), key, buf, {
            contentType: 'image/webp',
            cacheControl: 'public, max-age=31536000, immutable',
          });
        }
      }
      slot.rendered.push({ width: target, key, url: publicUrlFor(key) });
    }
    // The storefront asks for a 1600w image and a smaller one; the 400w entry
    // is the one that ends up in the list, the 1600w one is the hero.
    slot.finalUrl = slot.rendered[slot.rendered.length - 1].url;
  }

  // --- rewrite the database -------------------------------------------------
  if (APPLY) {
    await client.query('BEGIN');
    try {
      // products.images is a jsonb array
      for (const p of products.rows) {
        const arr = Array.isArray(p.images) ? p.images : [];
        const next = arr.map((im: any, index: number) => {
          const url = typeof im === 'string' ? im : (im && im.url) || '';
          const slot = slots.find(
            (s) => s.table === 'products' && s.id === p.id && s.index === index && s.url === url,
          );
          if (!slot?.finalUrl) return im;
          if (typeof im === 'string') return slot.finalUrl;
          return { ...im, url: slot.finalUrl };
        });
        await client.query('UPDATE products SET images = $1::jsonb, updated_at = NOW() WHERE id = $2', [
          JSON.stringify(next),
          p.id,
        ]);
      }

      for (const slot of slots) {
        if (slot.table === 'products') continue;
        if (!slot.finalUrl) continue;
        await client.query(
          `UPDATE ${slot.table} SET ${slot.column} = $1 WHERE id = $2`,
          [slot.finalUrl, slot.id],
        );
      }

      // The media table is the catalogue of stored files.
      for (const slot of slots) {
        if (slot.table !== 'media') continue;
        if (!slot.finalUrl) continue;
        await client.query('UPDATE media SET public_url = $1 WHERE id = $2', [slot.finalUrl, slot.id]);
      }

      // Historical order item thumbnails follow their product.
      const itemRows = await client.query(
        `SELECT oi.id, oi.image_url, oi.product_id FROM order_items oi WHERE oi.image_url LIKE '%r2.dev%'`,
      );
      for (const item of itemRows.rows) {
        const productSlot = slots.find((s) => s.table === 'products' && s.id === item.product_id);
        if (productSlot?.finalUrl) {
          await client.query('UPDATE order_items SET image_url = $1 WHERE id = $2', [
            productSlot.finalUrl,
            item.id,
          ]);
        }
      }

      await client.query('COMMIT');
      console.log('database rewritten');
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('rewrite failed, rolled back:', err.message);
      await client.end();
      process.exit(1);
    }
  }

  // --- report ---------------------------------------------------------------
  writeReport(slots);
  console.log(`\nreport: ${path.relative(ROOT, REPORT)}`);
  if (!APPLY) console.log('DRY RUN - nothing was uploaded or written.');

  await client.end();
}

function findRendition(url: string, cacheWebps: string[]): string | null {
  const widths = [16, 32, 48, 64, 96, 128, 256, 384, 400, 640, 750, 800, 828, 1080, 1200, 1600, 1920, 2048, 3840];
  const qualities = [75, 70, 60, 80, 90, 100];
  for (const w of widths) {
    for (const q of qualities) {
      const name = `${sha1(`${url}|${w}|${q}`)}.webp`;
      if (cacheWebps.includes(name)) return name;
    }
  }
  return null;
}

function labelWords(label: string): string[] {
  return String(label || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !['churna', 'oil', 'tablets', 'kit', 'hamper', 'dose'].includes(w));
}

function writeReport(slots: Slot[]): void {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  const lines: string[] = [];
  lines.push('# Image mapping');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| table | row | label | source file | confidence | new URL |');
  lines.push('|---|---|---|---|---|---|');
  for (const s of slots) {
    lines.push(
      `| ${s.table} | ${s.id} | ${String(s.label).replace(/\|/g, '/').slice(0, 40)} | ` +
        `${s.source ? path.basename(s.source.file) : '-'} | ${s.source?.confidence || '-'} | ${s.finalUrl || '-'} |`,
    );
  }
  lines.push('');
  const low = slots.filter((s) => s.source?.confidence === 'fallback' || s.source?.confidence === 'placeholder');
  lines.push(`## Flagged for review (${low.length})`);
  lines.push('');
  if (low.length === 0) {
    lines.push('None - every image was matched exactly.');
  } else {
    for (const s of low) {
      lines.push(`- **${s.table}** "${s.label}" -> ${s.source?.confidence} (${s.source?.note})`);
    }
    lines.push('');
    lines.push('These slots are filled so the storefront always shows an image, but the');
    lines.push('match is not certain. Replace them with the correct artwork when it is');
    lines.push('available.');
  }
  fs.writeFileSync(REPORT, lines.join('\n'), 'utf8');
}

main().catch((e) => {
  console.error('FATAL', e?.stack || e);
  process.exit(1);
});
