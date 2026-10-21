import { query } from '../db';

async function count(table: string, where = '', params: any[] = []): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${table} ${where}`,
    params,
  );
  return Number(rows[0]?.count || 0);
}

export function countOrders(): Promise<number> {
  return count('orders');
}

export function countProducts(): Promise<number> {
  return count('products');
}

export function countCustomers(): Promise<number> {
  return count('users', `WHERE role = $1`, ['customer']);
}

export async function recentOrders(limit: number): Promise<any[]> {
  return query(
    `SELECT o.*,
            CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object(
              'first_name', u.first_name, 'last_name', u.last_name
            ) END AS users
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
      ORDER BY o.created_at DESC
      LIMIT $1`,
    [limit],
  );
}

export async function orderStatsRows(): Promise<any[]> {
  return query(
    // The numeric columns are NUMERIC in Postgres and arrive as strings, so
    // they are cast to float here rather than being summed as text.
    `SELECT id, created_at, status, payment_status, payment_method,
            subtotal::float AS subtotal,
            discount::float AS discount,
            tax::float AS tax,
            shipping_fee::float AS shipping_fee,
            total::float AS total
       FROM orders`,
  );
}

export async function summaryOrderRows(): Promise<any[]> {
  return query(
    `SELECT id, created_at, status, payment_status, payment_method,
            subtotal::float AS subtotal,
            discount::float AS discount,
            tax::float AS tax,
            shipping_fee::float AS shipping_fee,
            total::float AS total
       FROM orders`,
  );
}

export async function productStockRows(): Promise<any[]> {
  return query('SELECT stock, minimum_stock FROM products');
}

export async function insertPageview(data: Record<string, any>): Promise<void> {
  const cols = Object.keys(data);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  await query(
    `INSERT INTO page_views (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
    cols.map((c) => data[c]),
  );
}

export async function insertEvent(data: Record<string, any>): Promise<void> {
  const cols = Object.keys(data);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  await query(
    `INSERT INTO analytics_events (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
    cols.map((c) => data[c]),
  );
}

export async function eventRowsSince(since: string): Promise<any[]> {
  return query(
    `SELECT event_name, product_id FROM analytics_events
      WHERE created_at >= $1
      LIMIT 50000`,
    [since],
  );
}

export async function paymentMethodsSince(since: string): Promise<any[]> {
  return query(
    `SELECT payment_method, created_at FROM orders
      WHERE created_at >= $1
      LIMIT 50000`,
    [since],
  );
}

export async function pageViewRowsSince(since: string): Promise<any[]> {
  return query(
    `SELECT path, session_id, device_type, created_at FROM page_views
      WHERE created_at >= $1
      ORDER BY created_at ASC
      LIMIT 50000`,
    [since],
  );
}
