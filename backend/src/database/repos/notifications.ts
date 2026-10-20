import { query } from '../db';

export async function listForUser(userId: string): Promise<any[]> {
  return query(
    'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );
}

export async function markRead(userId: string, id: string): Promise<any | null> {
  const rows = await query(
    `UPDATE notifications SET is_read = true
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [id, userId],
  );
  return rows[0] ?? null;
}

export async function markAllRead(userId: string): Promise<void> {
  await query('UPDATE notifications SET is_read = true WHERE user_id = $1', [userId]);
}

export async function remove(userId: string, id: string): Promise<void> {
  await query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [id, userId]);
}
