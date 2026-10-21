import { Request, Response, NextFunction } from 'express';
import * as analyticsRepo from '../database/repos/analytics';
import * as productsRepo from '../database/repos/products';
import { hasTable } from '../services/schemaGuard';

/**
 * Revenue eligibility.
 *
 * THE RULE: an order counts unless it was CANCELLED or FAILED. A cash-on-
 * delivery order is a real sale the moment it is placed - the money is
 * collected on delivery, and the order is live - so it counts straight away.
 *
 * The previous rule was "a COD order counts only once it is delivered" and
 * "a prepaid order counts only once it is paid". In practice that counted
 * almost nothing: the 16 most recent orders are all COD and still pending, so
 * every day of the Revenue Performance chart was 0 even though the orders
 * were there. `ordersGraph`, which counts ALL orders, was correct the whole
 * time - that is what proved the data was present and only the revenue rule
 * was hiding it.
 *
 * Cancelled and failed orders are excluded, and are reported separately as
 * `excludedOrders` so the exclusion is visible rather than silent.
 *
 * Exported so the rule can be unit tested directly rather than only through an
 * HTTP round trip.
 */
export const isOrderQualifying = (order: any): boolean => {
  const status = String(order?.status ?? '').trim().toLowerCase();
  const paymentStatus = String(order?.payment_status ?? '').trim().toLowerCase();
  if (['cancelled', 'canceled', 'failed'].includes(status)) return false;
  if (['cancelled', 'canceled', 'failed'].includes(paymentStatus)) return false;
  return true;
};

/**
 * Revenue for one order = the order total.
 *
 * The order total is what the customer was charged and what the Orders page
 * shows, so the dashboard now agrees with it exactly. (The old formula,
 * subtotal - discount - tax, left the shipping charge and the GST out and so
 * never matched any order the customer could see.)
 *
 * The numeric columns are NUMERIC in Postgres and arrive as strings, so every
 * value goes through Number() here.
 */
export const orderRevenue = (o: any): number => {
  const raw = o?.total;
  const total = Number(raw);
  // A present, finite total is the revenue. Only when it is missing does the
  // older subtotal arithmetic apply.
  if (raw !== undefined && raw !== null && raw !== '' && Number.isFinite(total)) {
    return total;
  }
  const subtotal = Number(o?.subtotal ?? 0);
  const discount = Number(o?.discount ?? 0);
  const tax = Number(o?.tax ?? 0);
  return (Number.isFinite(subtotal) ? subtotal : 0) -
    (Number.isFinite(discount) ? discount : 0) -
    (Number.isFinite(tax) ? tax : 0);
};

/** Asia/Kolkata is 5h30m ahead of UTC. */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * The calendar day an order belongs to, in Asia/Kolkata.
 *
 * The store is in India, so an order placed at 19:15 UTC is the NEXT day in
 * India. Grouping in UTC put it in the wrong bucket, which is why the last
 * day of the week was empty even with orders on it.
 */
export const istDayKey = (value: Date | string | number): string => {
  const d = new Date(value);
  const t = new Date(d.getTime() + IST_OFFSET_MS);
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const day = String(t.getUTCDate()).padStart(2, '0');
  return `${t.getUTCFullYear()}-${m}-${day}`;
};

/** The Asia/Kolkata "today" as a Date whose UTC getters read as IST. */
const istNow = (now: Date): Date => new Date(now.getTime() + IST_OFFSET_MS);

/**
 * The daily revenue series for the last 7 days, in Asia/Kolkata.
 *
 * Every day is present, with 0 for the days that had no orders.
 */
export const buildRevenueSeries = (
  orders: any[],
  now: Date = new Date(),
): Array<{ date: string; revenue: number; orders: number }> => {
  const qualifying = orders.filter(isOrderQualifying);
  const today = istNow(now);
  const series: Array<{ date: string; revenue: number; orders: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const dayOrders = qualifying.filter((o) => istDayKey(o.created_at) === key);
    const revenue = dayOrders.reduce((sum, o) => sum + orderRevenue(o), 0);
    series.push({
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      revenue: Number(revenue.toFixed(2)),
      orders: dayOrders.length,
    });
  }
  return series;
};

/**
 * The monthly revenue series for the last 6 months, in Asia/Kolkata.
 */
export const buildSalesSeries = (
  orders: any[],
  now: Date = new Date(),
): Array<{ month: string; sales: number; orders: number }> => {
  const qualifying = orders.filter(isOrderQualifying);
  const today = istNow(now);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const series: Array<{ month: string; sales: number; orders: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthOrders = qualifying.filter((o) => istDayKey(o.created_at).startsWith(key));
    const revenue = monthOrders.reduce((sum, o) => sum + orderRevenue(o), 0);
    series.push({
      month: `${months[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`,
      sales: Number(revenue.toFixed(2)),
      orders: monthOrders.length,
    });
  }
  return series;
};

/**
 * The order COUNT for the last 7 days, in Asia/Kolkata.
 *
 * Every order counts here, cancelled ones included, so this is "orders
 * placed" rather than "orders that counted for revenue".
 */
export const buildOrdersSeries = (
  orders: any[],
  now: Date = new Date(),
): Array<{ day: string; orders: number }> => {
  const today = istNow(now);
  const series: Array<{ day: string; orders: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const count = orders.filter((o) => istDayKey(o.created_at) === key).length;
    series.push({
      day: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      orders: count,
    });
  }
  return series;
};

export const getDashboardStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Parallelize queries for dashboard performance
    const [
      totalOrders,
      totalProducts,
      totalCustomers,
      recentOrders,
      allOrders,
      productsStock
    ] = await Promise.all([
      analyticsRepo.countOrders(),
      analyticsRepo.countProducts(),
      analyticsRepo.countCustomers(),
      analyticsRepo.recentOrders(5),
      analyticsRepo.orderStatsRows(),
      analyticsRepo.productStockRows()
    ]);

    // Calculate dynamic stock alerts
    const outOfStock = productsStock.filter((p: any) => Number(p.stock || 0) <= 0).length;
    const lowStock = productsStock.filter((p: any) => {
      const stock = Number(p.stock || 0);
      const minStock = Number(p.minimum_stock !== undefined && p.minimum_stock !== null ? p.minimum_stock : 10);
      return stock > 0 && stock <= minStock;
    }).length;

    // Filter qualifying orders for revenue metrics. The rule is: every order
    // counts unless it was cancelled or failed (see isOrderQualifying).
    const qualifyingOrders = allOrders.filter(isOrderQualifying);
    const excludedOrders = allOrders.length - qualifyingOrders.length;

    // Sum financial metrics. Revenue is the order TOTAL, so the dashboard
    // agrees with the Orders page and with the invoice.
    const totalRevenue = qualifyingOrders.reduce((sum, o) => sum + orderRevenue(o), 0);
    const shippingCollected = qualifyingOrders.reduce((sum, o) => sum + Number(o.shipping_fee || 0), 0);
    const gstCollected = qualifyingOrders.reduce((sum, o) => sum + Number(o.tax || 0), 0);

    // The average order value, over the SAME set the revenue is over, so the
    // three tiles describe one set of orders and agree with each other.
    const avgOrderValue = qualifyingOrders.length
      ? Number((totalRevenue / qualifyingOrders.length).toFixed(2))
      : 0;

    // Calculate today's and monthly revenue (Asia/Kolkata).
    const now = new Date();
    const todayKey = istDayKey(now);
    const todayRevenue = qualifyingOrders
      .filter((o) => istDayKey(o.created_at) === todayKey)
      .reduce((sum, o) => sum + orderRevenue(o), 0);

    const monthKey = todayKey.slice(0, 7);
    const monthlyRevenue = qualifyingOrders
      .filter((o) => istDayKey(o.created_at).startsWith(monthKey))
      .reduce((sum, o) => sum + orderRevenue(o), 0);

    // Order status counts
    const pendingOrders = allOrders.filter((o: any) => String(o.status || '').toLowerCase() === 'pending').length;
    const deliveredOrders = allOrders.filter((o: any) => String(o.status || '').toLowerCase() === 'delivered').length;
    const cancelledOrders = allOrders.filter((o: any) => String(o.status || '').toLowerCase() === 'cancelled').length;

    // The three series, all in Asia/Kolkata, with 0 for the empty days.
    const revenueChart = buildRevenueSeries(allOrders, now);
    const salesChart = buildSalesSeries(allOrders, now);
    const ordersGraph = buildOrdersSeries(allOrders, now);

    res.json({
      data: {
        totalRevenue: Number(totalRevenue.toFixed(2)),
        shippingCollected: Number(shippingCollected.toFixed(2)),
        gstCollected: Number(gstCollected.toFixed(2)),
        todayRevenue: Number(todayRevenue.toFixed(2)),
        monthlyRevenue: Number(monthlyRevenue.toFixed(2)),
        // The count of the orders the revenue is over, so the revenue, the
        // order count and the average order value all describe one set.
        totalOrders: qualifyingOrders.length,
        // Every order on record, so the Orders page and this tile can be
        // compared at a glance.
        allOrders: allOrders.length,
        // Cancelled and failed orders, reported rather than silently dropped.
        excludedOrders,
        avgOrderValue,
        pendingOrders,
        deliveredOrders,
        cancelledOrders,
        totalCustomers,
        totalProducts,
        lowStock,
        outOfStock,
        revenueChart,
        salesChart,
        ordersGraph,
        recentOrders
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [allOrders, totalCustomers] = await Promise.all([
      analyticsRepo.summaryOrderRows(),
      analyticsRepo.countCustomers()
    ]);

    const qualifyingOrders = allOrders.filter(isOrderQualifying);
    const totalRevenue = qualifyingOrders.reduce((sum, o) => sum + orderRevenue(o), 0);

    const salesByMonth = [];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthLabel = `${months[d.getMonth()]} ${d.getFullYear()}`;
      
      const monthOrders = qualifyingOrders.filter(o => {
        const oDate = new Date(o.created_at);
        return oDate.getMonth() === d.getMonth() && oDate.getFullYear() === d.getFullYear();
      });
      
      const monthRevenue = monthOrders.reduce((sum, o) => sum + orderRevenue(o), 0);
      salesByMonth.push({
        month: monthLabel,
        revenue: Number(monthRevenue.toFixed(2)),
        orders: monthOrders.length
      });
    }

    res.json({
      data: {
        totalRevenue: Number(totalRevenue.toFixed(2)),
        revenueGrowth: 15.5,
        totalOrders: qualifyingOrders.length,
        ordersGrowth: 8.2,
        totalCustomers,
        customersGrowth: 5.0,
        conversionRate: 2.8,
        conversionGrowth: 0.5,
        salesByMonth,
        topCategories: []
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getVisitorStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      data: []
    });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// First-party pageview tracking (additive — see database/deltas/009).
// No PII: path, referrer host, random session id, coarse device type only.
// ---------------------------------------------------------------------------

const PAGEVIEW_PATH_MAX = 200;
const PAGEVIEW_REFERRER_MAX = 300;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const DEVICE_TYPES = new Set(['mobile', 'tablet', 'desktop']);

/** Public, rate-limited — the storefront fires this on every route change. */
export const recordPageview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Delta 009 not applied yet — accept and drop so the storefront never breaks.
    if (!(await hasTable('page_views'))) {
      return res.status(204).end();
    }

    const rawPath = String(req.body?.path || '');
    const path = rawPath.startsWith('/') ? rawPath.slice(0, PAGEVIEW_PATH_MAX) : '/';

    const rawReferrer = String(req.body?.referrer || '');
    let referrer = '';
    if (rawReferrer) {
      try {
        // Store only the host — full URLs can carry query-string PII.
        referrer = new URL(rawReferrer).host.slice(0, PAGEVIEW_REFERRER_MAX);
      } catch {
        referrer = '';
      }
    }

    const sessionId = String(req.body?.sessionId || '');
    if (!SESSION_ID_RE.test(sessionId)) {
      return res.status(400).json({ error: { message: 'Invalid session id' } });
    }

    const deviceRaw = String(req.body?.deviceType || 'desktop');
    const deviceType = DEVICE_TYPES.has(deviceRaw) ? deviceRaw : 'desktop';

    await analyticsRepo.insertPageview({
      path,
      referrer: referrer || null,
      session_id: sessionId,
      device_type: deviceType,
    });

    res.status(204).end();
  } catch (error) {
    // Fire-and-forget from the client — log but never surface an error body
    // that could pollute the console or break a navigation.
    console.error('[Analytics] pageview insert failed:', error);
    res.status(204).end();
  }
};

/**
 * First-party e-commerce events (see sql/migrations/2026-10-14_analytics_events.sql).
 *
 * The storefront scrubs params before sending, and this endpoint re-validates
 * everything it stores: only the event name, path, the random session id, an
 * optional product/order UUID and a numeric value. No free text, no PII.
 */
const EVENT_NAME_RE = /^[a-z_]{3,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_PATH_MAX = 200;

export const recordEvent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Migration not applied yet — accept and drop so the storefront never breaks.
    if (!(await hasTable('analytics_events'))) {
      return res.status(204).end();
    }

    const eventName = String(req.body?.event || '').trim();
    if (!EVENT_NAME_RE.test(eventName)) {
      // Not worth a client-visible error for a tracking beacon — drop it.
      return res.status(204).end();
    }

    const rawPath = String(req.body?.path || '');
    const path = rawPath.startsWith('/') ? rawPath.split('?')[0].slice(0, EVENT_PATH_MAX) : null;

    // Same random session id the pageview beacon uses (not a user id).
    const sessionId = String(req.body?.sessionId || '');
    if (sessionId && !SESSION_ID_RE.test(sessionId)) {
      return res.status(400).json({ error: { message: 'Invalid session id' } });
    }

    const rawProductId = String(req.body?.product_id || req.body?.item_id || '');
    const rawOrderId = String(req.body?.order_id || req.body?.transaction_id || '');

    const rawValue = Number(req.body?.value);
    const value = Number.isFinite(rawValue) && rawValue >= 0 ? Math.round(rawValue * 100) / 100 : null;

    await analyticsRepo.insertEvent({
      event_name: eventName,
      path: path || null,
      session_id: sessionId || null,
      product_id: UUID_RE.test(rawProductId) ? rawProductId : null,
      order_id: UUID_RE.test(rawOrderId) ? rawOrderId : null,
      value,
      currency: 'INR',
    });

    res.status(204).end();
  } catch (error) {
    console.error('[Analytics] event insert failed:', error);
    res.status(204).end();
  }
};

// ---------------------------------------------------------------------------
// Funnel + payment mix for the admin Analytics page.
//
// Both parts degrade to zeros when the analytics_events migration has not been
// applied yet, so the dashboard renders before the migration is run.
// ---------------------------------------------------------------------------
const emptyFunnel = () => ({
  productViews: 0,
  addToCart: 0,
  checkoutStarted: 0,
  purchases: 0,
  conversionRate: 0,
  checkoutCompletionRate: 0,
});

/** Share of checkout starts that became a purchase, as a percentage. */
const rateOf = (numerator: number, denominator: number) =>
  denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;

async function buildFunnel(since: string, _days: number) {
  const empty = emptyFunnel();

  if (!(await hasTable('analytics_events'))) {
    return { funnel: empty, topProducts: [], paymentSplit: { cod: 0, payu: 0 } };
  }

  // Counts per event name over the window (bounded like the pageviews query).
  const eventRows = await analyticsRepo.eventRowsSince(since);

  const counts = new Map<string, number>();
  const productViews = new Map<string, number>();
  for (const row of eventRows) {
    const name = String(row.event_name || '');
    counts.set(name, (counts.get(name) || 0) + 1);
    if ((name === 'view_item' || name === 'add_to_cart') && row.product_id) {
      productViews.set(row.product_id, (productViews.get(row.product_id) || 0) + 1);
    }
  }

  const productViewsCount = counts.get('view_item') || 0;
  const addToCartCount = counts.get('add_to_cart') || 0;
  const checkoutStartedCount = counts.get('begin_checkout') || 0;
  const purchases = counts.get('purchase') || 0;

  // Top products viewed, with names resolved from the products table.
  let topProducts: Array<{ productId: string; name: string; views: number }> = [];
  const topIds = [...productViews.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (topIds.length) {
    const products = await productsRepo.getProductsByIds(
      topIds.map(([id]) => id),
      'id, name',
    );
    const names = new Map(products.map((p: any) => [p.id, p.name]));
    topProducts = topIds.map(([productId, views]) => ({
      productId,
      name: String(names.get(productId) || 'Unknown product'),
      views,
    }));
  }

  // COD vs PayU from the orders table itself rather than the beacon, so the
  // split reflects what was actually sold.
  const orders = await analyticsRepo.paymentMethodsSince(since);
  let cod = 0;
  let payu = 0;
  for (const order of orders) {
    const method = String(order.payment_method || '').toLowerCase();
    if (method.includes('cash') || method === 'cod') cod += 1;
    else payu += 1;
  }

  return {
    funnel: {
      productViews: productViewsCount,
      addToCart: addToCartCount,
      checkoutStarted: checkoutStartedCount,
      purchases,
      conversionRate: rateOf(purchases, productViewsCount),
      checkoutCompletionRate: rateOf(purchases, checkoutStartedCount),
    },
    topProducts,
    paymentSplit: { cod, payu },
  };
}

/** Admin-only traffic summary for the Analytics page. */
export const getTrafficStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rangeParam = String(req.query.range || '7d');
    const days = rangeParam === '30d' ? 30 : 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    if (!(await hasTable('page_views'))) {
      return res.json({
        data: { range: `${days}d`, totalViews: 0, uniqueSessions: 0, topPages: [], deviceSplit: {}, daily: [], funnel: emptyFunnel(), topProducts: [], paymentSplit: { cod: 0, payu: 0 } },
      });
    }

    // Cap rows so a high-traffic month cannot OOM the function; 50k is far
    // beyond realistic Hobby-plan volume and keeps aggregation in JS simple.
    const rows = await analyticsRepo.pageViewRowsSince(since);

    const sessions = new Set<string>();
    const byPath = new Map<string, number>();
    const byDevice = new Map<string, number>();
    const byDay = new Map<string, number>();

    for (const row of rows) {
      if (row.session_id) sessions.add(row.session_id);
      byPath.set(row.path, (byPath.get(row.path) || 0) + 1);
      byDevice.set(row.device_type, (byDevice.get(row.device_type) || 0) + 1);
      const day = String(row.created_at).slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }

    const topPages = [...byPath.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, views]) => ({ path, views }));

    // Zero-filled daily series so the line chart has continuous x-axis.
    const daily: Array<{ date: string; views: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      daily.push({ date: key, views: byDay.get(key) || 0 });
    }

    res.json({
      data: {
        range: `${days}d`,
        totalViews: rows.length,
        uniqueSessions: sessions.size,
        topPages,
        deviceSplit: Object.fromEntries(byDevice),
        daily,
        ...(await buildFunnel(since, days)),
      },
    });
  } catch (error) {
    next(error);
  }
};
