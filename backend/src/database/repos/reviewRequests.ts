import { query, type QueryFn } from '../db';
import { updateById } from './sql';

/**
 * Claim a review request for an order. UNIQUE(order_id) makes the insert
 * race-safe: an order that was already queued returns no row.
 */
export async function claim(
  data: { order_id: string; user_id?: string | null; product_id?: string | null; status: string },
): Promise<any | null> {
  const rows = await query(
    `INSERT INTO review_requests (order_id, user_id, product_id, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (order_id) DO NOTHING
     RETURNING id`,
    [data.order_id, data.user_id || null, data.product_id || null, data.status],
  );
  return rows[0] ?? null;
}

export async function mark(
  id: string,
  patch: Record<string, any>,
  q: QueryFn = query,
): Promise<any | null> {
  return updateById('review_requests', id, patch, q);
}
