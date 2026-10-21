import { revalidatePath, revalidateTag } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';

/**
 * Drop the storefront's ISR cache after an admin change.
 *
 * The catalogue pages are rendered with ISR, so a product or banner edited in
 * the admin stayed invisible until the cache expired. The backend calls this
 * route right after the write (see backend/src/services/revalidateService.ts)
 * with the shared `REVALIDATE_SECRET`.
 *
 * Without the secret configured the route refuses to run - it must never be an
 * open endpoint that anyone can use to flush the cache.
 */

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = (process.env.REVALIDATE_SECRET || '').trim();
  if (!expected) {
    return Response.json(
      { error: { message: 'Revalidation is not configured.' } },
      { status: 503 },
    );
  }

  const provided =
    request.headers.get('x-revalidate-token') ||
    (await request.json().catch(() => ({}))).token ||
    '';

  if (!secretMatches(String(provided), expected)) {
    return Response.json(
      { error: { message: 'Unauthorized.' } },
      { status: 401 },
    );
  }

  // The product detail pages are dynamic routes, so the pattern has to be
  // revalidated for every product, not for a single path.
  revalidateTag('products', 'max');
  revalidatePath('/', 'page');
  revalidatePath('/products', 'page');
  revalidatePath('/products/[id]', 'page');

  return Response.json({ revalidated: true, now: Date.now() });
}
