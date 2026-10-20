import { query, type QueryFn } from '../db';
import { insertRow } from './sql';

export async function latestCreatedAt(phone: string, purpose: string): Promise<string | null> {
  const rows = await query<{ created_at: string }>(
    `SELECT created_at FROM otps
      WHERE phone = $1 AND purpose = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [phone, purpose],
  );
  return rows[0]?.created_at ?? null;
}

export async function insertOtp(data: Record<string, any>, q: QueryFn = query): Promise<any> {
  return insertRow('otps', data, q);
}

export async function deleteOtp(id: string, q: QueryFn = query): Promise<void> {
  await q('DELETE FROM otps WHERE id = $1', [id]);
}

export async function findActive(phone: string, purpose: string): Promise<any | null> {
  const rows = await query(
    `SELECT * FROM otps
      WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [phone, purpose],
  );
  return rows[0] ?? null;
}

export async function incrementAttempts(id: string): Promise<void> {
  await query('UPDATE otps SET attempts = COALESCE(attempts, 0) + 1 WHERE id = $1', [id]);
}

/**
 * Atomic single use. Returns false when another request consumed the row first.
 */
export async function consume(id: string): Promise<boolean> {
  const rows = await query(
    `UPDATE otps SET consumed_at = NOW()
      WHERE id = $1 AND consumed_at IS NULL
      RETURNING id`,
    [id],
  );
  return rows.length > 0;
}
