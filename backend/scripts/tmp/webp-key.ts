/**
 * Work out how the cached .webp files are keyed, so the remaining product
 * images can be matched to their optimised renditions.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CACHE = path.join(__dirname, '..', '..', '.cache', 'images');

function sha1(buf: Buffer | string): string {
  return crypto.createHash('sha1').update(buf).digest('hex');
}
function md5(buf: Buffer | string): string {
  return crypto.createHash('md5').update(buf).digest('hex');
}
function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function main(): void {
  const files = fs.readdirSync(CACHE);
  const srcs = files.filter((f) => f.endsWith('.src'));
  const webps = files.filter((f) => f.endsWith('.webp'));
  const webpNames = new Set(webps);

  console.log('srcs:', srcs.length, 'webps:', webps.length);

  // Does a .webp name equal a hash of the .src bytes?
  const hits: Record<string, number> = {};
  for (const src of srcs) {
    const buf = fs.readFileSync(path.join(CACHE, src));
    const cands: Record<string, string> = {
      'sha1(src)': sha1(buf),
      'md5(src)': md5(buf),
      'sha256(src)': sha256(buf),
      'sha1(srcName)': sha1(src),
    };
    for (const [label, h] of Object.entries(cands)) {
      const found = webps.find((w) => w.startsWith(h));
      if (found) hits[label] = (hits[label] || 0) + 1;
    }
  }
  console.log('src->webp derivations that hit:', JSON.stringify(hits));

  // Is the .webp name a hash of its own bytes?
  let selfHit = 0;
  for (const w of webps) {
    const buf = fs.readFileSync(path.join(CACHE, w));
    if (sha1(buf) === w.split('.')[0] || md5(buf) === w.split('.')[0]) selfHit++;
  }
  console.log('webp self-named by content hash:', selfHit);

  // What image format are they?
  const sample = webps.slice(0, 3).map((w) => {
    const buf = fs.readFileSync(path.join(CACHE, w));
    return `${w}: ${buf.slice(0, 12).toString('hex')}`;
  });
  console.log('webp magic bytes:', sample.join(' | '));
  const ssample = srcs.slice(0, 3).map((w) => {
    const buf = fs.readFileSync(path.join(CACHE, w));
    return `${w}: ${buf.slice(0, 12).toString('hex')}`;
  });
  console.log('src magic bytes:', ssample.join(' | '));
}

main();
