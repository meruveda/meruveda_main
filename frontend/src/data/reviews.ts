/**
 * Customer reviews — static, human-curated, loaded from reviews.json.
 *
 * The data lives in ./reviews.json so it can be edited without touching code,
 * and so a build check can inspect it directly.
 *
 * RULE, unchanged and non-negotiable: ONLY add reviews from real customers who
 * gave permission to publish them. Do not invent names, cities, ratings, dates
 * or review text — not here, not in tests, not in fixtures. A fabricated review
 * is a false statement about a real business.
 *
 * The shipped file holds an empty array plus two entries flagged
 * "placeholder": true. Those are layout fixtures only:
 *   - they are filtered out of every rendered section and out of aggregateRating
 *   - `npm run build` in production FAILS while any placeholder is present
 *     (see scripts/check-reviews.mjs)
 * So "no real reviews yet" remains the visible, honest state.
 *
 * How to add a real one to reviews.json:
 *   - `productId`: the product id/slug, or the literal "all" to show it on every
 *     product page as well.
 *   - `rating`: an integer 1-5. Every rating is displayed; none are hidden or
 *     filtered out, because a review wall that hides the bad reviews is
 *     marketing, not evidence.
 *   - `date`: ISO 8601 (YYYY-MM-DD), the date the customer gave the review.
 *   - `verified`: true only when we have confirmed they are a real customer.
 *   - `source`: optional provenance, e.g. "whatsapp", "email", "in-store".
 *   - Do NOT set `placeholder`. Production builds reject it.
 */
import raw from './reviews.json';

export interface Review {
  id: string;
  /** Product id/slug, or "all" to appear on every product page. */
  productId: string;
  name: string;
  city?: string;
  /** Integer 1-5. */
  rating: 1 | 2 | 3 | 4 | 5;
  title?: string;
  text: string;
  /** ISO 8601 date (YYYY-MM-DD). */
  date: string;
  verified?: boolean;
  source?: string;
  /** Layout fixture. Excluded from render + structured data; fails a prod build. */
  placeholder?: boolean;
}

interface ReviewFile {
  _comment?: string;
  reviews?: Array<Omit<Review, 'productId'> & { productId?: string; productSlug?: string }>;
}

const file = raw as ReviewFile;

/**
 * Real, permissioned reviews only. Placeholder fixtures are dropped here, once,
 * so no render path has to remember to filter them.
 */
export const reviews: Review[] = (file.reviews ?? [])
  .filter((r) => !r.placeholder)
  .map((r) => ({ ...r, productId: r.productId ?? r.productSlug ?? 'all' }) as Review);

/** Placeholder count, surfaced by the build check. Not exported to the UI. */
export const placeholderCount = (file.reviews ?? []).filter((r) => r.placeholder).length;

/**
 * Reviews for one product, including the site-wide ("all") ones.
 *
 * `source` is injectable so the filtering rule can be unit tested against a
 * fixture list without mutating the bundled data. Production callers pass one
 * argument and get the real reviews.
 */
export function reviewsForProduct(slug: string, source: Review[] = reviews): Review[] {
  return source.filter((r) => r.productId === slug || r.productId === 'all');
}

export type RatingBreakdown = Record<1 | 2 | 3 | 4 | 5, number>;

export interface RatingSummary {
  average: number;
  total: number;
  breakdown: RatingBreakdown;
}

const emptyBreakdown = (): RatingBreakdown => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

/**
 * Average, count and the 5-to-1 distribution.
 *
 * Rounded to one decimal so the UI and the structured data agree exactly — a
 * rating shown as 4.5 in the page must not be 4.49 in the markup.
 */
export function summarize(list: Review[]): RatingSummary {
  const breakdown = emptyBreakdown();
  if (list.length === 0) return { average: 0, total: 0, breakdown };

  let sum = 0;
  for (const r of list) {
    const stars = Math.min(5, Math.max(1, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
    breakdown[stars] += 1;
    sum += stars;
  }
  return {
    average: Math.round((sum / list.length) * 10) / 10,
    total: list.length,
    breakdown,
  };
}

export type ReviewSort = 'newest' | 'highest' | 'lowest';

/** Newest by date; ties broken by id so the order is stable across renders. */
export function sortReviews(list: Review[], sort: ReviewSort): Review[] {
  const copy = [...list];
  if (sort === 'highest') {
    copy.sort((a, b) => b.rating - a.rating || b.date.localeCompare(a.date));
  } else if (sort === 'lowest') {
    copy.sort((a, b) => a.rating - b.rating || b.date.localeCompare(a.date));
  } else {
    copy.sort((a, b) => b.date.localeCompare(a.date));
  }
  return copy;
}