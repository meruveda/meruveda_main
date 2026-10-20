import { query } from '../db';
import { insertRow } from './sql';

export async function listForUser(userId: string): Promise<any[]> {
  return query(
    `SELECT c.*, to_jsonb(p) AS products
       FROM cart_items c
       LEFT JOIN products p ON p.id = c.product_id
      WHERE c.user_id = $1`,
    [userId],
  );
}

export async function findItem(userId: string, productId: string): Promise<any | null> {
  const rows = await query(
    `SELECT id, quantity FROM cart_items
      WHERE user_id = $1 AND product_id = $2
      LIMIT 1`,
    [userId, productId],
  );
  return rows[0] ?? null;
}

export async function updateQuantity(id: string, quantity: number): Promise<any | null> {
  const rows = await query(
    'UPDATE cart_items SET quantity = $1 WHERE id = $2 RETURNING *',
    [quantity, id],
  );
  return rows[0] ?? null;
}

export async function updateForUser(
  userId: string,
  id: string,
  patch: Record<string, any>,
): Promise<any | null> {
  const cols = Object.keys(patch);
  const sets = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
  const rows = await query(
    `UPDATE cart_items SET ${sets}
      WHERE id = $${cols.length + 1} AND user_id = $${cols.length + 2}
      RETURNING *`,
    [...cols.map((c) => patch[c]), id, userId],
  );
  return rows[0] ?? null;
}

export async function insertItem(data: Record<string, any>): Promise<any> {
  return insertRow('cart_items', data);
}

export async function removeForUser(userId: string, id: string): Promise<void> {
  await query('DELETE FROM cart_items WHERE id = $1 AND user_id = $2', [id, userId]);
}

export async function clearForUser(userId: string): Promise<void> {
  await query('DELETE FROM cart_items WHERE user_id = $1', [userId]);
}
