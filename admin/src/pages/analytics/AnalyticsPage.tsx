import React, { useState, useEffect } from 'react'
import { BarChart3, TrendingUp, ShoppingBag, Users, Percent, Download, RefreshCw, ExternalLink, Eye, Monitor, Smartphone, Tablet } from 'lucide-react'
import { analyticsService, TrafficStats } from '../../services/analyticsService'
import { orderService } from '../../services/orderService'
import { AnalyticsSummary } from '../../types'
import { formatCurrency, formatNumber } from '@meruveda/shared'
import { VERCEL_ANALYTICS_URL } from '../../constants/config'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import toast from 'react-hot-toast'

export const AnalyticsPage: React.FC = () => {
  const [data, setData] = useState<AnalyticsSummary | null>(null)
  const [visitors, setVisitors] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // First-party storefront traffic (page_views table, delta 009).
  const [traffic, setTraffic] = useState<TrafficStats | null>(null)
  const [trafficRange, setTrafficRange] = useState<'7d' | '30d'>('7d')
  const [trafficLoading, setTrafficLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [summary, visitorStats] = await Promise.all([
          analyticsService.getSummary(),
          analyticsService.getVisitorStats(),
        ])
        setData(summary)
        setVisitors(visitorStats)
      } catch (err) {
        toast.error('Failed to load reports')
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, [])

  useEffect(() => {
    let cancelled = false
    setTrafficLoading(true)
    analyticsService
      .getTraffic(trafficRange)
      .then((stats) => {
        if (!cancelled) setTraffic(stats)
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load traffic stats')
      })
      .finally(() => {
        if (!cancelled) setTrafficLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [trafficRange])

  const COLORS = ['#7C3AED', '#3B82F6', '#10B981', '#F59E0B']

  const handleExportExcel = async () => {
    const toastId = toast.loading('Generating Excel audit report...')
    try {
      const orders = await orderService.getAllOrders({ includeItems: 'true' })

      if (!orders || orders.length === 0) {
        toast.dismiss(toastId)
        toast.error('No orders found to export')
        return
      }

      // Sheet 1: one row per order line item (uses the mapped camelCase shape).
      const lineRows: Record<string, string | number>[] = []
      const productSummary: Record<string, { name: string; sku: string; qty: number; revenue: number }> = {}

      orders.forEach((order: any) => {
        const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString() : ''
        const customerName = order.shippingAddress?.fullName || order.customerName || 'Customer'
        const items = Array.isArray(order.items) ? order.items : []
        items.forEach((item: any) => {
          const qty = Number(item.quantity || 0)
          const unitPrice = Number(item.price || 0)
          lineRows.push({
            'Order Number': order.orderNumber || '',
            'Order Date': orderDate,
            Customer: customerName,
            SKU: item.sku || '',
            'Product Name': item.productName || '',
            Quantity: qty,
            'Unit Price': unitPrice,
            Discount: Number(order.discount || 0),
            'Line Total': qty * unitPrice,
            'Payment Status': order.paymentStatus || '',
            'Payment Method': order.paymentMethod || '',
            'Order Status': order.status || '',
          })
          const key = item.sku || item.productName || 'UNKNOWN'
          if (!productSummary[key]) {
            productSummary[key] = { name: item.productName || 'N/A', sku: item.sku || 'N/A', qty: 0, revenue: 0 }
          }
          productSummary[key].qty += qty
          productSummary[key].revenue += qty * unitPrice
        })
      })

      const summaryRows = Object.values(productSummary).map((s) => ({
        'Product Name': s.name,
        SKU: s.sku,
        'Total Units Sold': s.qty,
        'Total Revenue': s.revenue,
      }))

      const { writeWorkbook, excelFileName } = await import('../../utils/exportExcel')
      await writeWorkbook(
        { 'Line Items': lineRows, 'Product Summary': summaryRows },
        excelFileName('MeruVeda_Sales_Audit_Report'),
      )

      toast.dismiss(toastId)
      toast.success('Excel audit report downloaded successfully!')
    } catch (error) {
      console.error(error)
      toast.dismiss(toastId)
      toast.error('Failed to generate Excel audit report')
    }
  }

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-slate-350" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="text-sm text-slate-500">Storefront traffic, conversions, and best-selling products.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportExcel}
            className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl shadow-glow"
          >
            <Download className="h-4 w-4" /> Export Audit Report (Excel)
          </button>
        </div>
      </div>

      {/* ---- Storefront Traffic (first-party pageviews, delta 009) ---- */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="section-title">Storefront Traffic</h2>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              {(['7d', '30d'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setTrafficRange(r)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                    trafficRange === r
                      ? 'bg-primary-600 text-white'
                      : 'bg-white dark:bg-slate-900 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {r === '7d' ? '7 days' : '30 days'}
                </button>
              ))}
            </div>
            {VERCEL_ANALYTICS_URL && (
              <a
                href={VERCEL_ANALYTICS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl"
              >
                <ExternalLink className="h-4 w-4" /> Open Vercel Analytics
              </a>
            )}
          </div>
        </div>

        {trafficLoading ? (
          <div className="flex h-40 items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-slate-300" />
          </div>
        ) : (
          <>
            {/* Traffic KPI cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="card p-6 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-400 font-semibold uppercase">Page Views</span>
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                    {formatNumber(traffic?.totalViews || 0)}
                  </h3>
                  <span className="text-xs text-slate-400">Last {traffic?.range || trafficRange}</span>
                </div>
                <div className="p-3 bg-purple-50 dark:bg-purple-950/20 text-primary-600 rounded-2xl">
                  <Eye className="h-6 w-6" />
                </div>
              </div>
              <div className="card p-6 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-400 font-semibold uppercase">Unique Sessions</span>
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                    {formatNumber(traffic?.uniqueSessions || 0)}
                  </h3>
                  <span className="text-xs text-slate-400">Distinct visitors</span>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-blue-950/20 text-blue-600 rounded-2xl">
                  <Users className="h-6 w-6" />
                </div>
              </div>
              <div className="card p-6 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-400 font-semibold uppercase">Device Split</span>
                  <div className="mt-2 space-y-1">
                    {Object.entries(traffic?.deviceSplit || {}).map(([device, count]) => (
                      <div key={device} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        {device === 'mobile' ? <Smartphone className="h-3.5 w-3.5" /> : device === 'tablet' ? <Tablet className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
                        <span className="capitalize">{device}</span>
                        <span className="font-semibold">{formatNumber(count as number)}</span>
                      </div>
                    ))}
                    {Object.keys(traffic?.deviceSplit || {}).length === 0 && (
                      <span className="text-xs text-slate-400">No data yet</span>
                    )}
                  </div>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-950/20 text-green-600 rounded-2xl">
                  <Monitor className="h-6 w-6" />
                </div>
              </div>
            </div>

            {/* Daily views line chart + top pages */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="card p-6 lg:col-span-2 space-y-4">
                <h3 className="section-title">Daily Page Views</h3>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={traffic?.daily || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-slate-100 dark:stroke-slate-800" />
                      <XAxis dataKey="date" className="text-[10px] fill-slate-400" tickFormatter={(d: string) => d.slice(5)} />
                      <YAxis className="text-[10px] fill-slate-400" allowDecimals={false} />
                      <Tooltip />
                      <Area type="monotone" dataKey="views" stroke="#7C3AED" fill="#7C3AED" fillOpacity={0.15} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card p-6 space-y-4">
                <h3 className="section-title">Top Pages</h3>
                {(traffic?.topPages || []).length === 0 ? (
                  <p className="text-sm text-slate-400">No page views recorded yet.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-400 border-b border-slate-100 dark:border-slate-800">
                        <th className="pb-2 font-semibold">Path</th>
                        <th className="pb-2 font-semibold text-right">Views</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traffic!.topPages.map((p) => (
                        <tr key={p.path} className="border-b border-slate-50 dark:border-slate-800/50 last:border-0">
                          <td className="py-2 pr-2 text-slate-600 dark:text-slate-300 font-mono truncate max-w-[180px]" title={p.path}>
                            {p.path}
                          </td>
                          <td className="py-2 text-right font-semibold text-slate-900 dark:text-white">
                            {formatNumber(p.views)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ---- Sales KPI cards ---- */}
      <h2 className="section-title pt-2">Sales Overview</h2>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="card p-6 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase">Total Sales Revenue</span>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {formatCurrency(data.totalRevenue)}
            </h3>
            {data.revenueGrowth > 0 ? (
              <span className="text-xs text-green-500 font-medium inline-flex items-center gap-0.5">
                +{data.revenueGrowth}% vs last month
              </span>
            ) : (
              <span className="text-xs text-slate-400">No comparison data yet</span>
            )}
          </div>
          <div className="p-3 bg-purple-50 dark:bg-purple-950/20 text-primary-600 rounded-2xl">
            <TrendingUp className="h-6 w-6" />
          </div>
        </div>

        <div className="card p-6 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase">Fulfillments count</span>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {data.totalOrders}
            </h3>
            {data.ordersGrowth > 0 ? (
              <span className="text-xs text-green-500 font-medium inline-flex items-center gap-0.5">
                +{data.ordersGrowth}% vs last month
              </span>
            ) : (
              <span className="text-xs text-slate-400">No comparison data yet</span>
            )}
          </div>
          <div className="p-3 bg-blue-50 dark:bg-blue-950/20 text-blue-600 rounded-2xl">
            <ShoppingBag className="h-6 w-6" />
          </div>
        </div>

        <div className="card p-6 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase">Traffic Visitors</span>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {data.totalCustomers}
            </h3>
            {data.customersGrowth > 0 ? (
              <span className="text-xs text-green-500 font-medium inline-flex items-center gap-0.5">
                +{data.customersGrowth}% vs last month
              </span>
            ) : (
              <span className="text-xs text-slate-400">No comparison data yet</span>
            )}
          </div>
          <div className="p-3 bg-green-50 dark:bg-green-950/20 text-green-600 rounded-2xl">
            <Users className="h-6 w-6" />
          </div>
        </div>

        <div className="card p-6 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase">Conversion Rate</span>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {data.conversionRate}%
            </h3>
            <span className="text-xs text-slate-400">Average Cart Checkout Success</span>
          </div>
          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 text-amber-600 rounded-2xl">
            <Percent className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Grid: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Visitor stats chart */}
        <div className="card p-6 lg:col-span-2 space-y-4">
          <h3 className="section-title">Unique Monthly Visitors</h3>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={visitors} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-100 dark:stroke-slate-800" />
                <XAxis dataKey="month" className="text-[10px] fill-slate-400" />
                <YAxis className="text-[10px] fill-slate-400" />
                <Tooltip />
                <Bar dataKey="visitors" fill="#7C3AED" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Categories Sales donut */}
        <div className="card p-6 lg:col-span-1 space-y-4">
          <h3 className="section-title">Sales by Category</h3>
          <div className="h-[220px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.topCategories}
                  dataKey="sales"
                  nameKey="categoryName"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={4}
                >
                  {data.topCategories.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            {data.topCategories.map((c, i) => (
              <div key={c.categoryName} className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                <span className="truncate text-slate-500">{c.categoryName} ({c.percentage}%)</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
export default AnalyticsPage
