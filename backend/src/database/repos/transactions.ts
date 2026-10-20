import { query, type QueryFn } from '../db';
import { insertRow, updateById } from './sql';

export async function insertTransaction(data: Record<string, any>, q: QueryFn = query): Promise<any> {
  return insertRow('transactions', data, q);
}

export async function findByOrderId(orderId: string, q: QueryFn = query): Promise<any | null> {
  const rows = await q(
    'SELECT * FROM transactions WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
    [orderId],
  );
  return rows[0] ?? null;
}

export async function findSuccessByOrder(orderId: string, q: QueryFn = query): Promise<any | null> {
  const rows = await q(
    `SELECT id FROM transactions
      WHERE order_id = $1 AND status = 'success'
      ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );
  return rows[0] ?? null;
}

export async function updateTransaction(
  id: string,
  patch: Record<string, any>,
  q: QueryFn = query,
): Promise<any | null> {
  return updateById('transactions', id, patch, q);
}

/** `*, users(first_name, last_name), orders(order_number)` */
export async function listTransactions(status?: string): Promise<any[]> {
  const params: any[] = [];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE t.status = $1`;
  }

  return query(
    `SELECT t.*,
            CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object(
              'first_name', u.first_name, 'last_name', u.last_name
            ) END AS users,
            CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object(
              'order_number', o.order_number
            ) END AS orders
       FROM transactions t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN orders o ON o.id = t.order_id
       ${where}
      ORDER BY t.created_at DESC`,
    params,
  );
}
