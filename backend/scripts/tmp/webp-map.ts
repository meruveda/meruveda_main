/**
 * Map every product image URL to its cached renditions.
 *
 * The image proxy caches:
 *   <sha1(url)>.src        the original bytes
 *   <sha1(url|w|q)>.webp   a resized WebP rendition
 *
 * So once the widths and qualities the storefront asks for are known, every
 * URL can be resolved to the exact files that exist on disk.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from 'pg';

const CACHE = path.join(__dirname, '..', '..', '.cache', 'images');

/** The widths Next.js asks for, plus the quality the loader sends. */
const WIDTHS = [
  16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840,
  400, 800, 1600,
];
const QUALITIES = [75, 70, 60, 80, 90, 100];

function sha1(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}

async function main(): Promise<void> {
  const files = fs.existsSync(CACHE) ? fs.readdirSync(CACHE) : [];
  const webps = new Set(files.filter((f) => f.endsWith('.webp')));

  const client = new Client({
    connectionString: (process.env.DATABASE_URL_APP || process.env.DATABASE_URL || '').trim(),
  });
  await client.connect();
  const products = await client.query(`SELECT id, name, images FROM products ORDER BY created_at`);

  const urls = new Set<string>();
  for (const p of products.rows) {
    for (const im of Array.isArray(p.images) ? p.images : []) {
      const u = typeof im === 'string' ? im : (im && im.url) || '';
      if (u) urls.add(u);
    }
  }

  let withSrc = 0;
  let withWebp = 0;
  let neither = 0;
  const report: Array<{ url: string; src?: string; webps: string[] }> = [];

  for (const url of urls) {
    const src = files.find((f) => f === `${sha1(url)}.src`);
    const found: string[] = [];
    for (const w of WIDTHS) {
      for (const q of QUALITIES) {
        const k = `${sha1(`${url}|${w}|${q}`)}.webp`;
        if (webps.has(k)) found.push(`${w}x${q}`);
      }
    }
    if (src) withSrc++;
    if (found.length) withWebp++;
    if (!src && !found.length) neither++;
    report.push({ url, src, webps: found });
  }

  console.log(`unique urls=${urls.size}  withSource=${withSrc}  withRendition=${withWebp}  withNothing=${neither}`);
  for (const r of report) {
    const name = r.url.split('/').pop();
    console.log(`  ${name.padEnd(32)} src=${r.src ? 'Y' : 'n'} webp=${r.webps.length ? r.webps.join(',') : '-'}`);
  }

  await client.end();
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
