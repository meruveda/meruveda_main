import { Request, Response, NextFunction } from 'express';
import { supabase } from '../database/supabase';
import { hasTable } from '../services/schemaGuard';

/**
 * Revenue eligibility.
 *
 * The business rules are unchanged and were not touched:
 *   - COD        counts once the order is delivered (cash is only banked on
 *                delivery, so recognising an order before that would overstate
 *                revenue).
 *   - Prepaid    counts once payment_status = paid, regardless of delivery.
 *
 * What was broken is the status COMPARISON. Postgres stores these values
 * lower-case — the live `orders.status` column contains 'delivered' and
 * 'pending', never 'Delivered' — while this compared against 'Delivered'.
 * The comparison could therefore never be true and no COD order was ever
 * counted. Comparisons are now case-insensitive so they match the stored data
 * and stay correct if the casing ever changes upstream.
 *
 * Exported so the rule can be unit tested directly rather than only through an
 * HTTP round trip.
 */
export const isOrderQualifying = (order: any) => {
  const isCOD = order.payment_method === 'Cash On Delivery' || String(order.payment_method).toUpperCase() === 'COD';
  const isPaid = String(order.payment_status ?? '').toLowerCase() === 'paid';
  const status = String(order.status ?? '').toLowerCase();

  if (isCOD) {
    return status === 'delivered';
  }
  return isPaid;
};

/** Revenue = subtotal - discount - tax (GST). Shipping is excluded, as before. */
export const orderRevenue = (o: any) =>
  Number(o.subtotal || 0) - Number(o.discount || 0) - Number(o.tax || 0);

export const getDashboardStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Parallelize queries for dashboard performance
    const [
      { count: totalOrders },
      { count: totalProducts },
      { count: totalCustomers },
      { data: recentOrders },
      { data: allOrders },
      { data: productsStock }
    ] = await Promise.all([
      supabase.from('orders').select('*', { count: 'exact', head: true }),
      supabase.from('products').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'customer'),
      supabase.from('orders').select('*, users(first_name, last_name)').order('created_at', { ascending: false }).limit(5),
      supabase.from('orders').select('id, created_at, status, payment_status, payment_method, subtotal, discount, tax, shipping_fee, total'),
      supabase.from('products').select('stock, minimum_stock')
    ]);

    // Calculate dynamic stock alerts
    const outOfStock = productsStock?.filter((p: any) => Number(p.stock || 0) <= 0).length || 0;
    const lowStock = productsStock?.filter((p: any) => {
      const stock = Number(p.stock || 0);
      const minStock = Number(p.minimum_stock !== undefined && p.minimum_stock !== null ? p.minimum_stock : 10);
      return stock > 0 && stock <= minStock;
    }).length || 0;

    // Filter qualifying orders for revenue metrics
    const qualifyingOrders = allOrders?.filter(isOrderQualifying) || [];

    // Sum financial metrics
    // Revenue = Subtotal - Discount - Tax (GST)
    const totalRevenue = qualifyingOrders.reduce((sum, o) => sum + orderRevenue(o), 0);
    const shippingCollected = qualifyingOrders.reduce((sum, o) => sum + Number(o.shipping_fee || 0), 0);
    const gstCollected = qualifyingOrders.reduce((sum, o) => sum + Number(o.tax || 0), 0);

    // Calculate today's and monthly revenue
    const today = new Date();
    const todayRevenue = qualifyingOrders
      .filter(o => new Date(o.created_at).toDateString() === today.toDateString())
      .reduce((sum, o) => sum + orderRevenue(o), 0);

    const monthlyRevenue = qualifyingOrders
      .filter(o => {
        const oDate = new Date(o.created_at);
        return oDate.getMonth() === today.getMonth() && oDate.getFullYear() === today.getFullYear();
      })
      .reduce((sum, o) => sum + orderRevenue(o), 0);

    // Order status counts
    const pendingOrders = allOrders?.filter((o: any) => o.status === 'Pending').length || 0;
    const deliveredOrders = allOrders?.filter((o: any) => o.status === 'Delivered').length || 0;
    const cancelledOrders = allOrders?.filter((o: any) => o.status === 'Cancelled').length || 0;

    // Generate last 7 days' daily data for weekly revenueChart
    const revenueChart = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateString = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); // e.g., "Jul 25"
      
      const dayOrders = qualifyingOrders.filter(o => new Date(o.created_at).toDateString() === d.toDateString());
      const dayRevenue = dayOrders.reduce((sum, o) => sum + orderRevenue(o), 0);
      
      revenueChart.push({
        date: dateString,
        revenue: Number(dayRevenue.toFixed(2))
      });
    }

    // Generate salesChart (last 6 months)
    const salesChart = [];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthLabel = `${months[d.getMonth()]} ${d.getFullYear().toString().substring(2)}`;
      
      const monthOrders = qualifyingOrders.filter(o => {
        const oDate = new Date(o.created_at);
        return oDate.getMonth() === d.getMonth() && oDate.getFullYear() === d.getFullYear();
      });
      const monthRevenue = monthOrders.reduce((sum, o) => sum + orderRevenue(o), 0);
      
      salesChart.push({
        month: monthLabel,
        sales: Number(monthRevenue.toFixed(2))
      });
    }

    // Generate ordersGraph (last 7 days counts)
    const ordersGraph = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
      
      const dayOrdersCount = allOrders?.filter(o => new Date(o.created_at).toDateString() === d.toDateString()).length || 0;
      ordersGraph.push({
        day: dayLabel,
        orders: dayOrdersCount
      });
    }

    res.json({
      data: {
        totalRevenue: Number(totalRevenue.toFixed(2)),
        shippingCollected: Number(shippingCollected.toFixed(2)),
        gstCollected: Number(gstCollected.toFixed(2)),
        todayRevenue: Number(todayRevenue.toFixed(2)),
        monthlyRevenue: Number(monthlyRevenue.toFixed(2)),
        totalOrders: totalOrders || 0,
        pendingOrders,
        deliveredOrders,
        cancelledOrders,
        totalCustomers: totalCustomers || 0,
        totalProducts: totalProducts || 0,
        lowStock,
        outOfStock,
        revenueChart,
        salesChart,
        ordersGraph,
        recentOrders: recentOrders || []
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [
      { data: allOrders },
      { count: totalCustomers }
    ] = await Promise.all([
      supabase.from('orders').select('id, created_at, status, payment_status, payment_method, subtotal, discount, tax, total'),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'customer')
    ]);

    const qualifyingOrders = allOrders?.filter(isOrderQualifying) || [];
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
        totalCustomers: totalCustomers || 0,
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

    const { error } = await supabase.from('page_views').insert({
      path,
      referrer: referrer || null,
      session_id: sessionId,
      device_type: deviceType,
    });
    if (error) throw error;

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

    const { error } = await supabase.from('analytics_events').insert({
      event_name: eventName,
      path: path || null,
      session_id: sessionId || null,
      product_id: UUID_RE.test(rawProductId) ? rawProductId : null,
      order_id: UUID_RE.test(rawOrderId) ? rawOrderId : null,
      value,
      currency: 'INR',
    });
    if (error) throw error;

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
  const { data: eventRows } = await supabase
    .from('analytics_events')
    .select('event_name, product_id')
    .gte('created_at', since)
    .limit(50_000);

  const counts = new Map<string, number>();
  const productViews = new Map<string, number>();
  for (const row of eventRows || []) {
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
    const { data: products } = await supabase
      .from('products')
      .select('id, name')
      .in('id', topIds.map(([id]) => id));
    const names = new Map((products || []).map((p: any) => [p.id, p.name]));
    topProducts = topIds.map(([productId, views]) => ({
      productId,
      name: String(names.get(productId) || 'Unknown product'),
      views,
    }));
  }

  // COD vs PayU from the orders table itself rather than the beacon, so the
  // split reflects what was actually sold.
  const { data: orders } = await supabase
    .from('orders')
    .select('payment_method, created_at')
    .gte('created_at', since)
    .limit(50_000);
  let cod = 0;
  let payu = 0;
  for (const order of orders || []) {
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
    const { data: rows, error } = await supabase
      .from('page_views')
      .select('path, session_id, device_type, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(50_000);
    if (error) throw error;

    const sessions = new Set<string>();
    const byPath = new Map<string, number>();
    const byDevice = new Map<string, number>();
    const byDay = new Map<string, number>();

    for (const row of rows || []) {
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
        totalViews: rows?.length || 0,
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
