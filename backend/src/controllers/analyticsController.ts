import { Request, Response, NextFunction } from 'express';
import { supabase } from '../database/supabase';

// Helper to determine if an order qualifies for revenue calculation
const isOrderQualifying = (order: any) => {
  const isCOD = order.payment_method === 'Cash On Delivery' || String(order.payment_method).toUpperCase() === 'COD';
  const isPaid = order.payment_status === 'paid';
  
  if (isCOD) {
    // COD orders: count only once delivery status = Delivered
    return order.status === 'Delivered';
  } else {
    // Online/PayU orders: count toward revenue once payment_status = paid, regardless of delivery status
    return isPaid;
  }
};

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
    const totalRevenue = qualifyingOrders.reduce((sum, o) => sum + (Number(o.subtotal || 0) - Number(o.discount || 0) - Number(o.tax || 0)), 0);
    const shippingCollected = qualifyingOrders.reduce((sum, o) => sum + Number(o.shipping_fee || 0), 0);
    const gstCollected = qualifyingOrders.reduce((sum, o) => sum + Number(o.tax || 0), 0);

    // Calculate today's and monthly revenue
    const today = new Date();
    const todayRevenue = qualifyingOrders
      .filter(o => new Date(o.created_at).toDateString() === today.toDateString())
      .reduce((sum, o) => sum + (Number(o.subtotal || 0) - Number(o.discount || 0) - Number(o.tax || 0)), 0);

    const monthlyRevenue = qualifyingOrders
      .filter(o => {
        const oDate = new Date(o.created_at);
        return oDate.getMonth() === today.getMonth() && oDate.getFullYear() === today.getFullYear();
      })
      .reduce((sum, o) => sum + (Number(o.subtotal || 0) - Number(o.discount || 0) - Number(o.tax || 0)), 0);

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
      const dayRevenue = dayOrders.reduce((sum, o) => sum + (Number(o.subtotal || 0) - Number(o.discount || 0) - Number(o.tax || 0)), 0);
      
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
      const monthRevenue = monthOrders.reduce((sum, o) => sum + (Number(o.subtotal || 0) - Number(o.discount || 0) - Number(o.tax || 0)), 0);
      
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
    const totalRevenue = qualifyingOrders.reduce((sum, o) => sum + (Number(o.subtotal || 0) - Number(o.discount || 0) - Number(o.tax || 0)), 0);

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
      
      const monthRevenue = monthOrders.reduce((sum, o) => sum + (Number(o.subtotal || 0) - Number(o.discount || 0) - Number(o.tax || 0)), 0);
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
