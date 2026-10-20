import { query } from '../db';
import { insertRow } from './sql';

export async function listForUser(userId: string): Promise<any[]> {
  return query(
    `SELECT w.*, to_jsonb(p) AS products
       FROM wishlist_items w
       LEFT JOIN products p ON p.id = w.product_id
      WHERE w.user_id = $1`,
    [userId],
  );
}

export async function findItem(userId: string, productId: string): Promise<any | null> {
  const rows = await query(
    `SELECT id FROM wishlist_items
      WHERE user_id = $1 AND product_id = $2
      LIMIT 1`,
    [userId, productId],
  );
  return rows[0] ?? null;
}

export async function insertItem(data: Record<string, any>): Promise<any> {
  return insertRow('wishlist_items', data);
}

export async function deleteItem(id: string): Promise<void> {
  await query('DELETE FROM wishlist_items WHERE id = $1', [id]);
}

export async function deleteItemForUser(userId: string, id: string): Promise<void> {
  await query('DELETE FROM wishlist_items WHERE id = $1 AND user_id = $2', [id, userId]);
}
