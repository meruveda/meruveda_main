/**
 * Customer reviews — a static, human-curated list.
 *
 * ONLY add reviews from real customers who gave permission to publish them.
 * Do not invent names, cities, ratings or review text — not here, not in tests,
 * not in fixtures, not in docs. A fabricated review is a false statement about
 * a real business and it is not worth the page it sits on.
 *
 * This file intentionally ships EMPTY. The product page shows a "Be the first
 * to review" state, the home page hides its reviews section, and the
 * aggregateRating structured data is omitted entirely, until real entries are
 * added here. Empty is a correct, honest state — please keep it that way rather
 * than filling it in with something invented.
 *
 * How to add a real one:
 *   - `productSlug`: the product's slug, or the literal "all" to show it on
 *     every product page as well.
 *   - `rating`: an integer 1-5. Every rating is displayed; none are hidden and
 *     none are filtered out, because a review wall that hides the bad reviews
 *     is marketing, not evidence.
 *   - `date`: ISO 8601 (YYYY-MM-DD), the date the customer gave the review.
 *   - `verified`: true only when we have confirmed they are a real customer.
 *   - `source`: optional provenance, e.g. 'whatsapp', 'email', 'in-store'.
 */

export interface Review {
  id: string;
  /** Product slug, or "all" to appear on every product page. */
  productSlug: string;
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
}

// EXAMPLE — DELETE THIS COMMENT BLOCK WHEN YOU ADD A REAL ENTRY.
// This is illustrative only. Do NOT copy it into the array below, and do not
// reuse this name, city, rating or text — every field here is fake.
// {
//   id: 'r-example-do-not-use',
//   productSlug: 'ashwagandha-capsules',
//   name: 'EXAMPLE NAME — replace with the real customer',
//   city: 'EXAMPLE CITY — replace or omit',
//   rating: 5,
//   title: 'EXAMPLE TITLE — replace or omit',
//   text: 'EXAMPLE REVIEW TEXT — replace with what the customer actually wrote.',
//   date: '2026-01-01',
//   verified: true,
//   source: 'whatsapp',
// },

/** Real, permissioned customer reviews. Currently none. */
export const reviews: Review[] = [];

/** Reviews for one product, including the site-wide ("all") ones. */
export function reviewsForProduct(slug: string): Review[] {
  return reviews.filter((r) => r.productSlug === slug || r.productSlug === 'all');
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