/**
 * Production build guard for static customer reviews.
 *
 * src/data/reviews.json ships with two entries flagged "placeholder": true so
 * the layout can be worked on locally. Those fixtures are filtered out of every
 * render and out of aggregateRating markup, but leaving them in a PRODUCTION
 * bundle would still ship dummy text and dummy names to real visitors, which is
 * exactly what the reviews file exists to prevent.
 *
 * So a production build FAILS while any placeholder remains. Local dev is
 * unaffected — the guard only runs when NODE_ENV=production, i.e. `next build`.
 *
 * Exit codes: 0 = clean (no placeholders), 1 = placeholders present in a
 * production build.
 */
const fs = require('fs');
const path = require('path');

const REVIEWS = path.join(__dirname, '..', 'src', 'data', 'reviews.json');

const isProduction =
  process.env.NODE_ENV === 'production' ||
  process.argv.includes('--strict') ||
  process.env.CI === 'true' ||
  process.env.CHECK_REVIEWS_STRICT === '1';

function main() {
  if (!fs.existsSync(REVIEWS)) {
    console.error(`reviews file missing: ${REVIEWS}`);
    process.exit(1);
  }

  let file;
  try {
    file = JSON.parse(fs.readFileSync(REVIEWS, 'utf8'));
  } catch (e) {
    console.error(`reviews.json is not valid JSON: ${e.message}`);
    process.exit(1);
  }

  const entries = Array.isArray(file.reviews) ? file.reviews : [];
  const placeholders = entries.filter((r) => r && r.placeholder === true);
  const real = entries.length - placeholders.length;

  // A real entry must not be missing anything the UI dereferences.
  const required = ['id', 'productId', 'name', 'rating', 'text', 'date'];
  const malformed = real > 0
    ? entries.filter((r) => !r.placeholder).filter((r) => {
        const missing = required.filter((k) => r[k] === undefined || r[k] === null || r[k] === '');
        if (missing.length) {
          console.error(`  review "${r.id ?? '(no id)'}" is missing: ${missing.join(', ')}`);
          return true;
        }
        if (!(Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5)) {
          console.error(`  review "${r.id}" rating must be an integer 1-5, got ${r.rating}`);
          return true;
        }
        return false;
      })
    : [];

  console.log(
    `[reviews] ${real} real, ${placeholders.length} placeholder, ${malformed.length} malformed`
  );

  if (malformed.length) {
    console.error('\nProduction build REFUSED: fix the malformed reviews above.');
    process.exit(1);
  }

  if (placeholders.length && isProduction) {
    console.error(
      `\nProduction build REFUSED: ${placeholders.length} placeholder review(s) in reviews.json.`
    );
    console.error('Placeholders are layout fixtures and must not reach production.');
    console.error('Either delete them, or replace them with real, permissioned reviews.');
    process.exit(1);
  }

  if (placeholders.length) {
    console.log('[reviews] placeholders ignored in this (non-production) build — they render nothing.');
  } else {
    console.log('[reviews] clean: no placeholders.');
  }
}

main();