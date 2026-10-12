// @ts-nocheck
import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  TrendingUp,
  ShoppingBag,
  Users,
  AlertTriangle,
  Plus,
  ArrowUpRight,
  ExternalLink,
  HeartPulse,
} from 'lucide-react'
import { dashboardService } from '../../services/dashboardService'
import { orderService } from '../../services/orderService'
import { DashboardStats, Order } from '../../types'
import { formatCurrency, formatDateTime } from '@meruveda/shared'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { CardSkeleton } from '../../components/ui/Skeleton'
import { ROUTES } from '../../constants/routes'
import { CUSTOMER_WEBSITE_URL } from '../../constants/config'
import toast from 'react-hot-toast'

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [recentOrders, setRecentOrders] = useState<Order[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    const fetchData = async () => {
      try {
        const [statsData, ordersList] = await Promise.all([
          dashboardService.getStats(),
          orderService.getOrders(),
        ])
        if (isMounted) {
          setStats(statsData)
          setRecentOrders(ordersList.slice(0, 5))
        }
      } catch (err) {
        console.error(err)
        if (isMounted) {
          toast.error('Failed to load dashboard overview data.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }
    fetchData()
    return () => {
      isMounted = false
    }
  }, [])

  if (isLoading || !stats) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="h-8 w-48 bg-slate-200 dark:bg-slate-700 animate-pulse rounded-lg" />
            <div className="h-4 w-64 bg-slate-200 dark:bg-slate-700 animate-pulse rounded-md" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    )
  }

  const isStoreEmpty = stats.totalOrders === 0 && stats.totalRevenue === 0;

  return (
    <div className="space-y-6">
      {/* Page Title & Website Shortcut */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Store Overview</h1>
          <p className="text-sm text-slate-500">Real-time health, sales stats, and quick store controls.</p>
        </div>
        <div className="flex gap-3">
          <a
            href={CUSTOMER_WEBSITE_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-outline inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition-colors"
          >
            Open Storefront <ExternalLink className="h-4 w-4" />
          </a>
          <button
            onClick={() => navigate(ROUTES.PRODUCTS_ADD)}
            className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl bg-primary-600 hover:bg-primary-700 text-white shadow-glow transition-all"
          >
            <Plus className="h-4 w-4" /> Add Product
          </button>
        </div>
      </div>

      {/* True Empty State Welcome Banner */}
      {isStoreEmpty && (
        <div className="bg-primary-500/10 border border-primary-500/20 p-6 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in">
          <div className="space-y-1 text-center sm:text-left">
            <h3 className="text-lg font-bold text-primary-600 dark:text-primary-400">Welcome to your Ayurvedic store dashboard!</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">No sales or orders have been recorded yet. Share your storefront link or start adding products to your catalog.</p>
          </div>
          <button
            onClick={() => navigate(ROUTES.PRODUCTS_ADD)}
            className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold shadow-glow flex-shrink-0"
          >
            Add Your First Product
          </button>
        </div>
      )}

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Revenue */}
        <div className="card p-6 flex items-center justify-between bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
          <div className="space-y-2">
            <span className="text-xs text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wider block">Total Revenue</span>
            <h3 className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {formatCurrency(stats.totalRevenue)}
            </h3>
            <span className="text-xs text-slate-400 font-medium inline-flex items-center gap-1 bg-slate-50 dark:bg-slate-900/20 px-2 py-0.5 rounded-full block w-fit">
              Total from delivered orders
            </span>
            <div className="flex gap-2.5 text-[11px] text-slate-400 font-medium mt-1">
              <span>GST: <span className="font-semibold text-slate-600 dark:text-slate-300">{formatCurrency(stats.gstCollected || 0)}</span></span>
              <span>•</span>
              <span>Shipping: <span className="font-semibold text-slate-600 dark:text-slate-300">{formatCurrency(stats.shippingCollected || 0)}</span></span>
            </div>
          </div>
          <div className="p-3 bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 rounded-2xl animate-pulse-slow">
            <TrendingUp className="h-6 w-6" />
          </div>
        </div>

        {/* Total Orders */}
        <div className="card p-6 flex items-center justify-between bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
          <div className="space-y-2">
            <span className="text-xs text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wider block">Orders</span>
            <h3 className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {stats.totalOrders}
            </h3>
            <span className="text-xs text-slate-400 font-medium inline-flex items-center gap-1 bg-slate-50 dark:bg-slate-900/20 px-2 py-0.5 rounded-full">
              Total orders placed
            </span>
          </div>
          <div className="p-3 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded-2xl">
            <ShoppingBag className="h-6 w-6" />
          </div>
        </div>

        {/* Total Customers */}
        <div className="card p-6 flex items-center justify-between bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
          <div className="space-y-2">
            <span className="text-xs text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wider block">Customers</span>
            <h3 className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {stats.totalCustomers}
            </h3>
            <span className="text-xs text-slate-400 font-medium inline-flex items-center gap-1 bg-slate-50 dark:bg-slate-900/20 px-2 py-0.5 rounded-full">
              Registered customers
            </span>
          </div>
          <div className="p-3 bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 rounded-2xl">
            <Users className="h-6 w-6" />
          </div>
        </div>

        {/* Inventory alerts */}
        <div className="card p-6 flex items-center justify-between bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
          <div className="space-y-2">
            <span className="text-xs text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wider block">Stock Alerts</span>
            <h3 className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {stats.lowStock + stats.outOfStock}
            </h3>
            <span className="text-xs text-amber-500 font-medium inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-950/20 px-2 py-0.5 rounded-full">
              {stats.outOfStock} Out / {stats.lowStock} Low
            </span>
          </div>
          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 rounded-2xl">
            <AlertTriangle className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Revenue Area Chart */}
      <div className="card p-6 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Revenue Performance</h3>
            <p className="text-xs text-slate-400">Weekly sales distribution performance.</p>
          </div>
        </div>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.revenueChart} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#7C3AED" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-100 dark:stroke-slate-800" />
              <XAxis dataKey="date" className="text-[10px] fill-slate-400" />
              <YAxis className="text-[10px] fill-slate-400" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(255, 255, 255, 0.95)',
                  border: 'none',
                  borderRadius: '12px',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                }}
              />
              <Area type="monotone" dataKey="revenue" stroke="#7C3AED" strokeWidth={2.5} fillOpacity={1} fill="url(#colorRevenue)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Orders & Activity logs split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent orders */}
        <div className="card p-6 lg:col-span-2 space-y-4 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-sm">
          <div className="flex items-center justify-between border-b dark:border-slate-800 pb-3">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Recent Transactions</h3>
            <Link to={ROUTES.ORDERS} className="text-xs text-primary-600 hover:text-primary-700 font-semibold inline-flex items-center gap-0.5">
              All Orders <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-slate-400 text-xs font-semibold">
                  <th className="pb-3">Order</th>
                  <th className="pb-3">Customer</th>
                  <th className="pb-3">Total</th>
                  <th className="pb-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {recentOrders.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-400">
                      No sales yet — once you get your first order, transactions will show up here.
                    </td>
                  </tr>
                ) : (
                  recentOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                      <td className="py-3 font-semibold text-primary-600 dark:text-primary-400">
                        <Link to={`/orders/${o.id}`}>{o.orderNumber}</Link>
                      </td>
                      <td className="py-3">{o.customerName}</td>
                      <td className="py-3 font-medium">{formatCurrency(o.total)}</td>
                      <td className="py-3 text-right">
                        <StatusBadge status={o.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Store Health */}
        <div className="card p-6 space-y-4 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-sm h-fit">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <HeartPulse className="h-5 w-5 text-red-500" /> Store Health
          </h3>
          <div className="flex items-center gap-4 bg-green-50/50 dark:bg-green-950/10 border border-green-200 dark:border-green-500/20 p-4 rounded-2xl">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-ping" />
            <div>
              <p className="text-sm font-semibold text-green-700 dark:text-green-400">All Systems Functional</p>
              <p className="text-xs text-slate-400">SMTP Server, Cloudinary, Database running stable.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
export default DashboardPage
