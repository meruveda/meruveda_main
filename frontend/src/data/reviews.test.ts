import { test, describe, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { reviews, reviewsForProduct, summarize, sortReviews, placeholderCount } from './reviews';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(HERE, 'reviews.json');
const raw = () => JSON.parse(readFileSync(FILE, 'utf8'));

describe('static reviews', () => {
  test('the file exists and is well formed', () => {
    const f = raw();
    expect(Array.isArray(f.reviews)).toBe(true);
  });

  test('placeholders never reach the exported list', () => {
    const f = raw();
    const ph = f.reviews.filter((r: any) => r.placeholder);
    expect(ph.length).toBe(placeholderCount);
    // Whatever the file contains, the exported array is real reviews only.
    expect(reviews.every((r) => !r.placeholder)).toBe(true);
    expect(reviews.length).toBe(f.reviews.length - ph.length);
  });

  test('placeholder text is never rendered for any product', () => {
    for (const r of reviews) {
      expect(String(r.text)).not.toMatch(/PLACEHOLDER/i);
      expect(String(r.name)).not.toMatch(/PLACEHOLDER/i);
    }
    // And the site-wide fixture set does not surface on a product page.
    expect(reviewsForProduct('anything')).toHaveLength(0);
  });

  test('a zero-review product yields a zero summary so the section can hide', () => {
    const s = summarize(reviewsForProduct('no-such-product'));
    expect(s.total).toBe(0);
    expect(s.average).toBe(0);
  });

  test('average and count are computed from real entries only', () => {
    const sample = [
      { id: 'a', productId: 'x', name: 'A', rating: 5 as const, text: 't', date: '2026-01-02' },
      { id: 'b', productId: 'x', name: 'B', rating: 4 as const, text: 't', date: '2026-01-01' },
      { id: 'c', productId: 'x', name: 'C', rating: 3 as const, text: 't', date: '2026-01-03' },
    ];
    const s = summarize(sample);
    expect(s.total).toBe(3);
    expect(s.average).toBe(4); // (5+4+3)/3
    expect(s.breakdown).toEqual({ 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 });
  });

  test('site-wide entries appear on every product page', () => {
    const sample = [
      { id: 's', productId: 'all', name: 'S', rating: 5 as const, text: 't', date: '2026-01-01' },
      { id: 'p', productId: 'ashwagandha', name: 'P', rating: 4 as const, text: 't', date: '2026-01-01' },
    ];
    expect(reviewsForProduct('ashwagandha', sample).map((r) => r.id).sort()).toEqual(['p', 's']);
    expect(reviewsForProduct('other', sample).map((r) => r.id)).toEqual(['s']);
  });

  test('every rating is displayed, including low ones', () => {
    const sample = [
      { id: 'lo', productId: 'x', name: 'L', rating: 1 as const, text: 't', date: '2026-01-01' },
      { id: 'hi', productId: 'x', name: 'H', rating: 5 as const, text: 't', date: '2026-01-01' },
    ];
    const s = summarize(sample);
    expect(s.total).toBe(2);
    expect(s.breakdown[1]).toBe(1);
    expect(s.breakdown[5]).toBe(1);
  });

  test('sorting is stable and correct in every mode', () => {
    const sample = [
      { id: 'a', productId: 'x', name: 'A', rating: 3 as const, text: 't', date: '2026-02-01' },
      { id: 'b', productId: 'x', name: 'B', rating: 5 as const, text: 't', date: '2026-01-01' },
      { id: 'c', productId: 'x', name: 'C', rating: 1 as const, text: 't', date: '2026-03-01' },
    ];
    expect(sortReviews(sample, 'newest').map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(sortReviews(sample, 'highest').map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(sortReviews(sample, 'lowest').map((r) => r.id)).toEqual(['c', 'a', 'b']);
    // the input array is never mutated
    expect(sample.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});