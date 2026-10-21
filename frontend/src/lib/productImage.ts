/**
 * The catalogue stores a product's images in more than one shape:
 *
 *   - `["https://.../a.webp", "https://.../b.webp"]` (plain urls)
 *   - `[{ id, url, alt }, ...]` (what the admin media picker writes)
 *   - a single url as a string
 *
 * The first entry is the MAIN image, and the storefront has to show that one
 * first in the gallery and on the card. Every place that reads a product's
 * images goes through this helper so a product saved from the admin looks the
 * same everywhere.
 */

export interface ProductImageEntry {
  id?: string;
  url?: string;
  src?: string;
  image_url?: string;
  alt?: string;
}

const FALLBACK_IMAGE = '/images/placeholder.jpg';

/** The url of one image entry, whatever shape it has. */
export function getImageUrl(image: unknown): string | null {
  if (typeof image === 'string') {
    const trimmed = image.trim();
    return trimmed ? trimmed : null;
  }
  if (image && typeof image === 'object') {
    const entry = image as ProductImageEntry;
    const candidate = entry.url || entry.src || entry.image_url;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

/** Every image of a product, as urls, MAIN first. */
export function getImageUrls(images: unknown): string[] {
  if (!images) return [];
  if (typeof images === 'string') {
    const trimmed = images.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(images)) return [];
  const urls = images.map((image) => getImageUrl(image)).filter((url): url is string => Boolean(url));
  return urls;
}

/** The MAIN image of a product (the first one), or the placeholder. */
export function getMainImageUrl(images: unknown, fallback: string = FALLBACK_IMAGE): string {
  const urls = getImageUrls(images);
  return urls.length > 0 ? urls[0] : fallback;
}

/** The alt text of the MAIN image, when the entry carries one. */
export function getMainImageAlt(images: unknown, fallback: string): string {
  if (!Array.isArray(images) || images.length === 0) return fallback;
  const first = images[0];
  if (first && typeof first === 'object' && typeof (first as ProductImageEntry).alt === 'string') {
    const alt = (first as ProductImageEntry).alt!.trim();
    if (alt) return alt;
  }
  return fallback;
}

export { FALLBACK_IMAGE };
