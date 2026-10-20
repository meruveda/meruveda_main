/**
 * Static image optimiser.
 *
 * The storefront serves its catalogue artwork straight out of
 * `frontend/public/images` (no object storage, no CDN rewrite). Files above
 * `HEAVY_THRESHOLD_BYTES` are also written out as a WebP sibling next to the
 * original: the original keeps its name and stays in the repository, the
 * sibling is the one the database points at.
 *
 * Idempotent: an existing sibling is only rewritten when the source is newer
 * than the sibling.
 *
 * Usage:
 *   node scripts/optimize-static-images.js            # report only
 *   node scripts/optimize-static-images.js --apply    # write the siblings
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMAGES_DIR = path.resolve(__dirname, '..', '..', 'frontend', 'public', 'images');
const HEAVY_THRESHOLD_BYTES = 500 * 1024;
const QUALITY = 82;
const apply = process.argv.includes('--apply');

async function main() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error(`Image directory not found: ${IMAGES_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(IMAGES_DIR)
    .filter((f) => !/\.svg$/i.test(f) && /\.(png|jpe?g)$/i.test(f))
    .sort();

  const report = [];
  for (const file of files) {
    const src = path.join(IMAGES_DIR, file);
    const size = fs.statSync(src).size;
    if (size <= HEAVY_THRESHOLD_BYTES) continue;

    const dest = path.join(IMAGES_DIR, file.replace(/\.(png|jpe?g)$/i, '.webp'));
    const exists = fs.existsSync(dest);
    const fresh = exists && fs.statSync(dest).mtimeMs >= fs.statSync(src).mtimeMs;

    if (exists && fresh) {
      report.push({ file, kb: +(size / 1024).toFixed(1), out: path.basename(dest), outKb: +(fs.statSync(dest).size / 1024).toFixed(1), status: 'cached' });
      continue;
    }

    const buffer = await sharp(src).rotate().webp({ quality: QUALITY }).toBuffer();
    if (apply) fs.writeFileSync(dest, buffer);
    report.push({
      file,
      kb: +(size / 1024).toFixed(1),
      out: path.basename(dest),
      outKb: +(buffer.length / 1024).toFixed(1),
      status: apply ? 'written' : 'dry-run',
    });
  }

  if (!report.length) {
    console.log('No image exceeds the 500 KB threshold — nothing to optimise.');
    return;
  }

  console.log('file'.padEnd(36) + 'orig KB'.padStart(9) + 'webp KB'.padStart(10) + '  status');
  console.log('-'.repeat(72));
  for (const r of report) {
    console.log(r.file.padEnd(36) + String(r.kb).padStart(9) + String(r.outKb).padStart(10) + '  ' + r.status);
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write the WebP siblings.');
  } else {
    console.log('\nWebP siblings written.');
  }
}

main().catch((err) => {
  console.error('Optimisation failed:', err.message);
  process.exit(1);
});
