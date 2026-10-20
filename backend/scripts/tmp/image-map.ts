/**
 * Build the product-image -> local-file mapping.
 *
 * The Supabase project is suspended (HTTP 402), so the images have to come
 * from the local cache. The cache is keyed two ways:
 *   - <sha1(url)>.src   the ORIGINAL binary for that exact URL
 *   - <hash>.webp       an optimised rendition
 *
 * The `media` table records the original byte size of every stored file, so
 * an original that has no sha1 match can still be identified by size.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from 'pg';

const CACHE = path.join(__dirname, '..', '..', '.cache', 'images');

async function main() {
  const client = new Client({
    connectionString: (process.env.DATABASE_URL_APP || process.env.DATABASE_URL || '').trim(),
  });
  await client.connect();

  const files = fs.existsSync(CACHE) ? fs.readdirSync(CACHE) : [];
  const srcs = files.filter((f) => f.endsWith('.src'));
  const webps = files.filter((f) => f.endsWith('.webp'));

  // The size of every cached original, for size-based matching.
  const srcBySize = new Map<number, string[]>();
  for (const f of srcs) {
    const size = fs.statSync(path.join(CACHE, f)).size;
    if (!srcBySize.has(size)) srcBySize.set(size, []);
    srcBySize.get(size)!.push(f);
  }

  // Every media row (any bucket) so the banners and blogs are covered too.
  const media = await client.query(
    `SELECT public_url, storage_path, filename, bucket, mime_type, size FROM media`,
  );
  const byUrl = new Map<string, any>();
  for (const m of media.rows) byUrl.set(String(m.public_url), m);

  // Every URL referenced by a product, in order.
  const products = await client.query(`SELECT id, name, slug, images FROM products ORDER BY created_at`);
  const slots: Array<{ productId: string; product: string; index: number; url: string }> = [];
  for (const p of products.rows) {
    const arr = Array.isArray(p.images) ? p.images : [];
    arr.forEach((im: any, index: number) => {
      const url = typeof im === 'string' ? im : (im && im.url) || '';
      if (url) slots.push({ productId: p.id, product: p.name, index, url });
    });
  }

  const uniqueUrls = [...new Set(slots.map((s) => s.url))];
  console.log(`slots=${slots.length} uniqueUrls=${uniqueUrls.length} srcFiles=${srcs.length} webpFiles=${webps.length}`);

  const resolved = new Map<string, { file?: string; how: string; size?: number }>();
  const unresolved: string[] = [];

  for (const url of uniqueUrls) {
    const sha = crypto.createHash('sha1').update(url).digest('hex');
    const direct = srcs.find((f) => f.startsWith(sha));
    if (direct) {
      resolved.set(url, { file: direct, how: 'sha1(url)' });
      continue;
    }
    const row = byUrl.get(url);
    if (row && row.size != null) {
      const size = Number(row.size);
      const candidates = srcBySize.get(size) || [];
      if (candidates.length === 1) {
        resolved.set(url, { file: candidates[0], how: 'size', size });
        continue;
      }
    }
    unresolved.push(url);
  }

  console.log(`resolved=${resolved.size} unresolved=${unresolved.length}`);
  const byHow: Record<string, number> = {};
  for (const v of resolved.values()) byHow[v.how] = (byHow[v.how] || 0) + 1;
  console.log('by method:', byHow);

  // Which cached files are still unused?
  const used = new Set([...resolved.values()].map((v) => v.file));
  console.log('unused src files:', srcs.filter((f) => !used.has(f)).length);
  console.log('unused webp files:', webps.filter((f) => !used.has(f)).length);

  if (unresolved.length) {
    console.log('\nUNRESOLVED URLs:');
    for (const u of unresolved) {
      const row = byUrl.get(u);
      const who = slots.filter((s) => s.url === u).map((s) => s.product);
      console.log(`  ${u.split('/').pop()}  size=${row?.size ?? '?'}  products=${[...new Set(who)].join(', ')}`);
    }
  }

  await client.end();
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
