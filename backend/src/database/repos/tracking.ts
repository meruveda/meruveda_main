import { query, type QueryFn } from '../db';
import { insertRow } from './sql';

export async function insertHistory(data: Record<string, any>, q: QueryFn = query): Promise<any> {
  return insertRow('order_tracking_history', data, q);
}

/** Deduplicate a webhook scan on (order, activity, created_at). */
export async function findScan(orderId: string, activity: string, createdAt: string): Promise<any | null> {
  const rows = await query(
    `SELECT id FROM order_tracking_history
      WHERE order_id = $1 AND activity = $2 AND created_at = $3
      LIMIT 1`,
    [orderId, activity, createdAt],
  );
  return rows[0] ?? null;
}

export async function listForOrder(orderId: string): Promise<any[]> {
  return query(
    'SELECT * FROM order_tracking_history WHERE order_id = $1 ORDER BY created_at ASC',
    [orderId],
  );
}
