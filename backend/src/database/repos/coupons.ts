import { query, type QueryFn } from '../db';
import { insertRow, updateById, deleteById } from './sql';

export async function listCoupons(): Promise<any[]> {
  return query('SELECT * FROM coupons');
}

export async function findByCode(code: string): Promise<any | null> {
  const rows = await query('SELECT * FROM coupons WHERE code = $1 LIMIT 1', [code]);
  return rows[0] ?? null;
}

export async function insertCoupon(data: Record<string, any>): Promise<any> {
  return insertRow('coupons', data);
}

export async function updateCoupon(id: string, data: Record<string, any>): Promise<any | null> {
  return updateById('coupons', id, data);
}

export async function deleteCoupon(id: string): Promise<void> {
  await deleteById('coupons', id);
}

/**
 * Atomically claim one usage of a coupon. The eligibility check and the
 * increment are the same UPDATE, so two orders racing for the last allowed
 * use cannot both win. Returns null when the coupon is unusable.
 */
export async function incrementUsageAtomic(code: string, q: QueryFn = query): Promise<any | null> {
  const rows = await q(
    `UPDATE coupons
        SET used_count = COALESCE(used_count, 0) + 1,
            updated_at = now()
      WHERE upper(code) = upper($1)
        AND active = true
        AND (usage_limit IS NULL OR COALESCE(used_count, 0) < usage_limit)
        AND (expires_at IS NULL OR expires_at > now())
      RETURNING *`,
    [code],
  );
  return rows[0] ?? null;
}
