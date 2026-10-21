import { query, type QueryFn } from '../db';
import { insertRow, insertRows, updateById } from './sql';

const SORTABLE = new Set([
  'created_at',
  'updated_at',
  'total',
  'status',
  'order_number',
  'payment_status',
]);

const USER_EMBED = `CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('email', u.email) END AS users`;

export interface OrderListOptions {
  status?: string;
  paymentMethod?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit: number;
  offset: number;
  includeItems?: boolean;
}

function buildWhere(opts: OrderListOptions): { sql: string; params: any[] } {
  const clauses: string[] = [];
  const params: any[] = [];

  if (opts.status) {
    params.push(opts.status);
    clauses.push(`o.status = $${params.length}`);
  }
  if (opts.startDate) {
    params.push(opts.startDate);
    clauses.push(`o.created_at >= $${params.length}`);
  }
  if (opts.endDate) {
    params.push(opts.endDate);
    clauses.push(`o.created_at <= $${params.length}`);
  }
  if (opts.paymentMethod) {
    const val = opts.paymentMethod.toLowerCase();
    let pattern = `%${val}%`;
    if (val === 'cod') pattern = '%cash%';
    else if (val === 'upi') pattern = '%upi%';
    else if (val === 'card') pattern = '%card%';
    params.push(pattern);
    clauses.push(`LOWER(COALESCE(o.payment_method, '')) LIKE $${params.length}`);
  }
  if (opts.search) {
    const like = `%${opts.search}%`;
    params.push(like, like);
    clauses.push(
      `(o.order_number ILIKE $${params.length - 1} OR (o.shipping_address->>'fullName') ILIKE $${params.length})`,
    );
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

async function orderItemsWithProducts(orderIds: string[], productJson = 'to_jsonb(p)'): Promise<Map<string, any[]>> {
  const map = new Map<string, any[]>();
  if (orderIds.length === 0) return map;

  const placeholders = orderIds.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await query(
    `SELECT oi.*, ${productJson} AS products
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id IN (${placeholders})
      ORDER BY oi.created_at ASC NULLS LAST`,
    orderIds,
  );

  for (const row of rows) {
    const list = map.get(row.order_id) || [];
    list.push(row);
    map.set(row.order_id, list);
  }
  return map;
}

async function trackingHistory(orderIds: string[]): Promise<Map<string, any[]>> {
  const map = new Map<string, any[]>();
  if (orderIds.length === 0) return map;

  const placeholders = orderIds.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await query(
    `SELECT * FROM order_tracking_history
      WHERE order_id IN (${placeholders})
      ORDER BY created_at ASC`,
    orderIds,
  );

  for (const row of rows) {
    const list = map.get(row.order_id) || [];
    list.push(row);
    map.set(row.order_id, list);
  }
  return map;
}

export async function listOrders(opts: OrderListOptions): Promise<{ rows: any[]; count: number }> {
  const { sql: where, params } = buildWhere(opts);

  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM orders o ${where}`,
    params,
  );

  const sortBy = SORTABLE.has(opts.sortBy || '') ? opts.sortBy! : 'created_at';
  const direction = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const rows = await query(
    `SELECT o.*, ${USER_EMBED}
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       ${where}
      ORDER BY o.${sortBy} ${direction}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, opts.limit, opts.offset],
  );

  if (opts.includeItems && rows.length > 0) {
    const items = await orderItemsWithProducts(rows.map((r) => r.id));
    for (const row of rows) row.order_items = items.get(row.id) || [];
  }

  return { rows, count: Number(countRows[0]?.count || 0) };
}

export async function getOrderById(id: string): Promise<any | null> {
  const rows = await query(
    `SELECT o.*, ${USER_EMBED}
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
      LIMIT 1`,
    [id],
  );
  const order = rows[0];
  if (!order) return null;

  const items = await orderItemsWithProducts([id]);
  const history = await trackingHistory([id]);
  order.order_items = items.get(id) || [];
  order.order_tracking_history = history.get(id) || [];
  return order;
}

export async function getOrderRow(id: string, q: QueryFn = query): Promise<any | null> {
  const rows = await q('SELECT * FROM orders WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

export async function getOrderRowByNumber(orderNumber: string): Promise<any | null> {
  const rows = await query(
    'SELECT * FROM orders WHERE order_number = $1 ORDER BY created_at DESC LIMIT 1',
    [orderNumber],
  );
  return rows[0] ?? null;
}

export async function findPaymentStatus(ref: string, isUuid: boolean): Promise<any | null> {
  const rows = await query(
    `SELECT id, order_number, user_id, status, payment_status, payment_method, total
       FROM orders
      WHERE ${isUuid ? 'id = $1 OR order_number = $1' : 'order_number = $1'}
      LIMIT 1`,
    [ref],
  );
  return rows[0] ?? null;
}

export async function findByAwb(awb: string): Promise<any | null> {
  const rows = await query('SELECT * FROM orders WHERE awb_code = $1 ORDER BY created_at DESC LIMIT 1', [awb]);
  return rows[0] ?? null;
}

export async function findByShiprocketOrderId(id: string): Promise<any | null> {
  const rows = await query(
    'SELECT * FROM orders WHERE shiprocket_order_id = $1 ORDER BY created_at DESC LIMIT 1',
    [id],
  );
  return rows[0] ?? null;
}

export async function findByShipmentId(id: string): Promise<any | null> {
  const rows = await query(
    'SELECT * FROM orders WHERE shipment_id = $1 ORDER BY created_at DESC LIMIT 1',
    [id],
  );
  return rows[0] ?? null;
}

export async function updateByShipmentId(
  shipmentId: string,
  patch: Record<string, any>,
): Promise<number> {
  const cols = Object.keys(patch);
  const sets = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
  const rows = await query(
    `UPDATE orders SET ${sets} WHERE shipment_id = $${cols.length + 1} RETURNING id`,
    [...cols.map((c) => patch[c]), shipmentId],
  );
  return rows.length;
}

/** The order id for a Shiprocket shipment id, for timeline events. */
export async function getOrderIdByShipmentId(shipmentId: string): Promise<string | null> {
  const rows = await query(
    'SELECT id FROM orders WHERE shipment_id = $1 LIMIT 1',
    [shipmentId],
  );
  return rows[0]?.id ?? null;
}

export async function findShipmentInfo(shipmentId: string): Promise<any | null> {
  const rows = await query(
    `SELECT shiprocket_order_id, user_id FROM orders
      WHERE shipment_id = $1 LIMIT 1`,
    [shipmentId],
  );
  return rows[0] ?? null;
}

export async function findCancelInfo(orderId: string): Promise<any | null> {
  const rows = await query(
    `SELECT id, awb_code, status, shiprocket_order_id, user_id
       FROM orders WHERE id = $1 LIMIT 1`,
    [orderId],
  );
  return rows[0] ?? null;
}

export async function insertOrder(data: Record<string, any>, q: QueryFn = query): Promise<any> {
  // `items` is not a column on `orders` - the line items live in their own
  // table. The service keeps the (server-priced) items on the object it
  // passes in, so they have to be stripped before the row is written.
  const { items: _items, ...columns } = data;
  return insertRow('orders', columns, q);
}

export async function updateOrderById(
  id: string,
  patch: Record<string, any>,
  q: QueryFn = query,
): Promise<any | null> {
  return updateById('orders', id, patch, q);
}

/**
 * Idempotent payment confirmation for gateway callbacks: only the FIRST call
 * flips the order to paid. PayU can POST the browser callback several times
 * (retry / double-submit), and a duplicate must not re-run side effects such
 * as the Shiprocket push. Returns true only for the caller that won.
 */
export async function markOrderPaidIfUnpaid(
  id: string,
  notes: string,
  q: QueryFn = query,
): Promise<boolean> {
  const rows = await q(
    `UPDATE orders
        SET status = 'processing',
            payment_status = 'paid',
            notes = $2
      WHERE id = $1
        AND COALESCE(payment_status, '') <> 'paid'
      RETURNING id`,
    [id, notes],
  );
  return rows.length > 0;
}

export async function insertOrderItems(items: Array<Record<string, any>>, q: QueryFn = query): Promise<any[]> {
  return insertRows('order_items', items, q);
}

export async function getOrderItems(orderId: string, q: QueryFn = query): Promise<any[]> {
  return q(
    `SELECT oi.*, to_jsonb(p) AS products
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
      ORDER BY oi.created_at ASC NULLS LAST`,
    [orderId],
  );
}

export async function getMyOrders(userId: string): Promise<any[]> {
  const rows = await query(
    `SELECT o.*, ${USER_EMBED}
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC`,
    [userId],
  );

  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const items = await orderItemsWithProducts(ids);
    const history = await trackingHistory(ids);
    for (const row of rows) {
      row.order_items = items.get(row.id) || [];
      row.order_tracking_history = history.get(row.id) || [];
    }
  }

  return rows;
}

/**
 * The orders of a checkout session.
 *
 * An unverified session sees ONLY the orders it created itself - the rows
 * whose session_id is its own. That is the security rule: a session opened
 * with a number that already belonged to somebody else must not be able to
 * read that account's history.
 *
 * A VERIFIED session (the number was proven by WhatsApp, or the customer
 * signed in) sees the whole account: its own orders and the account's
 * earlier ones.
 */
export async function getOrdersForSession(
  sessionId: string,
  userId: string | null,
  verifiedAccount: boolean,
): Promise<any[]> {
  const rows = verifiedAccount && userId
    ? await query(
        `SELECT o.*, ${USER_EMBED}
           FROM orders o
           LEFT JOIN users u ON u.id = o.user_id
          WHERE o.session_id = $1 OR o.user_id = $2
          ORDER BY o.created_at DESC`,
        [sessionId, userId],
      )
    : await query(
        `SELECT o.*, ${USER_EMBED}
           FROM orders o
           LEFT JOIN users u ON u.id = o.user_id
          WHERE o.session_id = $1
          ORDER BY o.created_at DESC`,
        [sessionId],
      );

  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const items = await orderItemsWithProducts(ids);
    const history = await trackingHistory(ids);
    for (const row of rows) {
      row.order_items = items.get(row.id) || [];
      row.order_tracking_history = history.get(row.id) || [];
    }
  }

  return rows;
}

/**
 * `*, order_items(*, products(id, name, sku, seo_metadata)), users(email, first_name, last_name, phone)`
 * — exactly the shape the invoice renderer expects.
 */
export async function getOrderForInvoice(orderId: string): Promise<any | null> {
  const rows = await query(
    `SELECT o.*,
            CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object(
              'email', u.email,
              'first_name', u.first_name,
              'last_name', u.last_name,
              'phone', u.phone
            ) END AS users
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
      LIMIT 1`,
    [orderId],
  );
  const order = rows[0];
  if (!order) return null;

  const productJson = `CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
    'id', p.id, 'name', p.name, 'sku', p.sku, 'seo_metadata', p.seo_metadata
  ) END`;
  const items = await orderItemsWithProducts([orderId], productJson);
  order.order_items = items.get(orderId) || [];
  return order;
}

/** Order + tracking history for the public /track lookup. */
export async function findForTracking(ref: string, isUuid: boolean): Promise<any | null> {
  const rows = await query(
    `SELECT o.* FROM orders o
      WHERE ${isUuid ? 'o.order_number = $1 OR o.id = $1' : 'o.order_number = $1'}
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [ref],
  );
  const order = rows[0];
  if (!order) return null;
  const history = await trackingHistory([order.id]);
  order.order_tracking_history = history.get(order.id) || [];
  return order;
}

export async function deleteOrderCascade(id: string): Promise<void> {
  await query('DELETE FROM transactions WHERE order_id = $1', [id]);
  await query('DELETE FROM order_tracking_history WHERE order_id = $1', [id]);
  await query('DELETE FROM order_items WHERE order_id = $1', [id]);
  await query('DELETE FROM orders WHERE id = $1', [id]);
}

/** Delivered orders old enough for the 7-day review request sweep. */
export async function listForReviewRequests(cutoff: string, limit: number): Promise<any[]> {
  const rows = await query(
    `SELECT id, order_number, user_id, delivered_at, shipping_address
       FROM orders
      WHERE status = 'delivered' AND delivered_at <= $1
      ORDER BY delivered_at ASC
      LIMIT $2`,
    [cutoff, limit],
  );

  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const items = await query(
      `SELECT id, order_id, product_id, product_name
         FROM order_items
        WHERE order_id IN (${placeholders})
        ORDER BY created_at ASC NULLS LAST`,
      ids,
    );
    const byOrder = new Map<string, any[]>();
    for (const item of items) {
      const list = byOrder.get(item.order_id) || [];
      list.push(item);
      byOrder.set(item.order_id, list);
    }
    for (const row of rows) row.order_items = byOrder.get(row.id) || [];
  }

  return rows;
}

export async function listByUserIds(userIds: string[]): Promise<any[]> {
  if (userIds.length === 0) return [];
  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(', ');
  return query(
    `SELECT user_id, total, created_at, shipping_address
       FROM orders WHERE user_id IN (${placeholders})`,
    userIds,
  );
}

export async function listShippingAddresses(userId: string): Promise<any[]> {
  return query(
    `SELECT shipping_address FROM orders
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  );
}

export async function listAllForUser(userId: string): Promise<any[]> {
  return query(
    'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );
}

export interface RetryPushOptions {
  /** Only rows whose last push explicitly failed. */
  failedOnly?: boolean;
  /** Only rows created within the last N hours (opportunistic retry sweep). */
  sinceHours?: number;
  /** Ignore the scheduled next-attempt time and take every candidate. */
  ignoreSchedule?: boolean;
}

export async function retryPushCandidates(
  limit: number,
  opts: RetryPushOptions = {},
): Promise<any[]> {
  const clauses = [
    'shiprocket_order_id IS NULL',
    "status IN ('processing', 'confirmed', 'pending')",
    // A non-Indian delivery phone can never satisfy Shiprocket; retrying it
    // every day would just burn API calls. The admin can still push manually.
    "(shiprocket_push_error IS NULL OR shiprocket_push_error NOT LIKE 'Non-Indian phone number%')",
    // A deliberately skipped order is final: never retry it.
    'COALESCE(shiprocket_push_skipped, false) = false',
    // Orders that have exhausted their attempts are terminal.
    'COALESCE(shiprocket_push_attempts, 0) < 8',
  ];
  const params: any[] = [];

  if (opts.failedOnly) {
    clauses.push("shiprocket_push_status = 'failed'");
  }
  if (opts.sinceHours && opts.sinceHours > 0) {
    params.push(Math.floor(opts.sinceHours));
    clauses.push(`created_at >= NOW() - ($${params.length}::int * INTERVAL '1 hour')`);
  }
  // The backoff schedule: an order is only retried once its next-attempt time
  // has passed. A row that has never been scheduled (NULL) is due immediately.
  if (!opts.ignoreSchedule) {
    clauses.push('(shiprocket_push_next_attempt_at IS NULL OR shiprocket_push_next_attempt_at <= NOW())');
  }

  params.push(limit);

  return query(
    `SELECT id, order_number, status, payment_status, payment_method, created_at,
            shiprocket_push_attempts, shiprocket_push_error, shiprocket_push_status
       FROM orders
      WHERE ${clauses.join(' AND ')}
      ORDER BY COALESCE(shiprocket_push_next_attempt_at, created_at) ASC
      LIMIT $${params.length}`,
    params,
  );
}

/**
 * Claim the single "tell the store owner" slot for an order.
 *
 * The conditional UPDATE is the whole point: two concurrent sweeps must not
 * both send the alert.
 */
export async function claimAdminAlert(orderId: string, at: string): Promise<boolean> {
  const rows = await query(
    `UPDATE orders SET shiprocket_admin_alerted_at = $1
      WHERE id = $2 AND shiprocket_admin_alerted_at IS NULL
      RETURNING id`,
    [at, orderId],
  );
  return rows.length > 0;
}

/** Stamp the time a tracking poll ran, so the sweep can rate-limit itself. */
export async function touchTrackingPolled(orderId: string): Promise<void> {
  await query(
    'UPDATE orders SET shiprocket_tracking_polled_at = NOW() WHERE id = $1',
    [orderId],
  );
}

/**
 * Count one push attempt and return the new total.
 *
 * The increment is atomic, so parallel attempts cannot both read the same
 * count. Returns the new value.
 */
export async function incrementPushAttempts(orderId: string): Promise<number> {
  const rows = await query<{ attempts: number }>(
    `UPDATE orders SET shiprocket_push_attempts = COALESCE(shiprocket_push_attempts, 0) + 1
      WHERE id = $1
      RETURNING shiprocket_push_attempts`,
    [orderId],
  );
  return Number(rows[0]?.attempts ?? 0);
}

/**
 * Pushed orders that are not delivered yet, for the tracking poll.
 *
 * Ordered by the oldest poll, so the orders nobody has checked for the
 * longest time are checked first.
 */
export async function trackingPollCandidates(limit: number): Promise<any[]> {
  return query(
    `SELECT id, order_number, awb_code, courier_name, status, shiprocket_order_id
       FROM orders
      WHERE shiprocket_order_id IS NOT NULL
        AND awb_code IS NOT NULL
        AND status NOT IN ('delivered', 'cancelled', 'canceled', 'returned')
        AND (shiprocket_tracking_polled_at IS NULL OR shiprocket_tracking_polled_at < NOW() - INTERVAL '30 minutes')
      ORDER BY COALESCE(shiprocket_tracking_polled_at, created_at) ASC
      LIMIT $1`,
    [limit],
  );
}

/** Atomic claim of the right to push an order to Shiprocket. */
export async function claimShiprocketPush(orderId: string, patch: Record<string, any>): Promise<boolean> {
  const cols = Object.keys(patch);
  const sets = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
  const rows = await query(
    `UPDATE orders SET ${sets}
      WHERE id = $${cols.length + 1}
        AND shiprocket_order_id IS NULL
        AND (shiprocket_push_status IS NULL OR shiprocket_push_status <> 'in_progress')
      RETURNING id`,
    [...cols.map((c) => patch[c]), orderId],
  );
  return rows.length > 0;
}

export async function getPushState(orderId: string): Promise<any | null> {
  const rows = await query(
    `SELECT shiprocket_order_id, shiprocket_push_status, shiprocket_push_started_at
       FROM orders WHERE id = $1 LIMIT 1`,
    [orderId],
  );
  return rows[0] ?? null;
}

export async function claimStaleShiprocketPush(
  orderId: string,
  patch: Record<string, any>,
  staleCutoff: string,
): Promise<boolean> {
  const cols = Object.keys(patch);
  const sets = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
  const rows = await query(
    `UPDATE orders SET ${sets}
      WHERE id = $${cols.length + 1}
        AND shiprocket_order_id IS NULL
        AND shiprocket_push_status = 'in_progress'
        AND shiprocket_push_started_at < $${cols.length + 2}
      RETURNING id`,
    [...cols.map((c) => patch[c]), orderId, staleCutoff],
  );
  return rows.length > 0;
}

export async function getShiprocketIds(
  orderId: string,
): Promise<{ shiprocket_order_id: string | null; shipment_id: string | null } | null> {
  const rows = await query(
    'SELECT shiprocket_order_id, shipment_id FROM orders WHERE id = $1 LIMIT 1',
    [orderId],
  );
  return rows[0] ?? null;
}

/** Guarded write: only store Shiprocket IDs if no concurrent push beat us. */
/**
 * Adopt the guest orders placed for a phone number.
 *
 * A guest checkout creates its own user row. When the same number is later
 * verified with an OTP, the orders placed as a guest move to the real
 * account, so the customer finds them in their history.
 */
export async function adoptGuestOrdersForPhone(
  userId: string,
  phone: string,
  q: QueryFn = query,
): Promise<number> {
  const rows = await q(
    `UPDATE orders o
        SET user_id = $1
       FROM users g
      WHERE g.id = o.user_id
        AND g.id <> $1
        AND g.phone = $2
        AND o.delivery_phone = $2
      RETURNING o.id`,
    [userId, phone],
  );
  return rows.length;
}

/** Guarded write: only store Shiprocket IDs if no concurrent push beat us. */
export async function claimShiprocketIds(orderId: string, patch: Record<string, any>): Promise<boolean> {
  const cols = Object.keys(patch);
  const sets = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
  const rows = await query(
    `UPDATE orders SET ${sets}
      WHERE id = $${cols.length + 1} AND shiprocket_order_id IS NULL
      RETURNING id`,
    [...cols.map((c) => patch[c]), orderId],
  );
  return rows.length > 0;
}

/** `*, users(email)` without the heavy item/tracking embeds. */
export async function getOrderWithUser(id: string): Promise<any | null> {
  const rows = await query(
    `SELECT o.*, ${USER_EMBED}
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
      LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

/** order_items plus only the embedded product tax metadata. */
export async function getItemsWithProductMeta(orderId: string): Promise<any[]> {
  return query(
    `SELECT oi.*,
            CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
              'seo_metadata', p.seo_metadata
            ) END AS products
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1`,
    [orderId],
  );
}
