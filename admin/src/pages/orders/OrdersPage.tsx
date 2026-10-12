import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingCart, Search, Eye, Filter, RefreshCw, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { orderService } from '../../services/orderService'
import { Order, OrderStatus } from '../../types'
import { formatCurrency, formatDateTime } from '@meruveda/shared'
import { StatusBadge } from '../../components/ui/StatusBadge'
import toast from 'react-hot-toast'

export const OrdersPage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)

  // Filters state
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<OrderStatus | ''>('')
  const [paymentMethod, setPaymentMethod] = useState('')

  const fetchOrders = async () => {
    setIsLoading(true)
    try {
      const data = await orderService.getOrders({
        search,
        status: status || undefined,
        paymentMethod: paymentMethod || undefined,
        page,
        limit,
      })
      setOrders(data)
    } catch (err) {
      toast.error('Failed to load orders')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    setPage(1)
  }, [search, status, paymentMethod])

  useEffect(() => {
    fetchOrders()
  }, [search, status, paymentMethod, page, limit])

  // Items are non-returnable (see Shipping Policy): no returned/refunded
  // management — historical rows with those statuses still render elsewhere.
  const orderStatuses: OrderStatus[] = [
    'pending',
    'confirmed',
    'packed',
    'shipped',
    'delivered',
    'cancelled',
  ]

  /** Export all filtered orders (page-walked) as a real .xlsx workbook. */
  const handleExport = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const all = await orderService.getAllOrders({
        search: search.trim() || undefined,
        status: status || undefined,
        paymentMethod: paymentMethod || undefined,
        includeItems: 'true',
      })
      if (all.length === 0) {
        toast.error('There are no orders to export')
        return
      }
      const rows = all.map((o) => ({
        'Order Number': o.orderNumber,
        'Order Date': o.createdAt ? new Date(o.createdAt).toLocaleString() : '',
        Customer: o.customerName,
        Email: o.customerEmail,
        Phone: o.customerPhone,
        Items: o.items.map((i) => `${i.productName} x${i.quantity}`).join(' | '),
        Subtotal: o.subtotal,
        Discount: o.discount,
        Tax: o.tax,
        Shipping: o.shippingCharge,
        Total: o.total,
        'Payment Method': o.paymentMethod,
        'Payment Status': o.paymentStatus,
        Status: o.status,
        'Tracking Number': o.trackingNumber || o.awbCode || '',
      }))
      const { writeWorkbook, excelFileName } = await import('../../utils/exportExcel')
      await writeWorkbook({ Orders: rows }, excelFileName('meruveda-orders'))
      toast.success(`Exported ${all.length} orders to Excel`)
    } catch (err) {
      console.error('Orders Excel export failed', err)
      toast.error('Failed to export orders')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Orders Management</h1>
          <p className="text-sm text-slate-500">View order timelines, update fulfillment status, and generate invoices.</p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={isLoading || isExporting}
          className="btn-secondary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl disabled:opacity-50"
        >
          {isExporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {isExporting ? 'Preparing…' : 'Export Excel'}
        </button>
      </div>

      {/* Filters bar */}
      <div className="card p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by order #, customer name..."
            className="input pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
          <div className="flex items-center gap-1.5">
            <Filter className="h-4 w-4 text-slate-400" />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as OrderStatus | '')}
              className="input py-1.5 pr-8 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              <option value="">All Statuses</option>
              {orderStatuses.map((st) => (
                <option key={st} value={st} className="capitalize">
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="input py-1.5 pr-8 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              <option value="">All Payments</option>
              <option value="cod">Cash on Delivery (COD)</option>
              <option value="upi">UPI</option>
              <option value="card">Card Payment</option>
            </select>
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 text-slate-500 text-xs font-semibold">
                <th className="p-4">Order Number</th>
                <th className="p-4">Customer</th>
                <th className="p-4">Order Date</th>
                <th className="p-4">Total Price</th>
                <th className="p-4">Payment</th>
                <th className="p-4">Fulfillment Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-350" />
                    Loading orders...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400">
                    No orders found matching filters.
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/10">
                    <td className="p-4 font-bold text-primary-600 dark:text-primary-400">
                      <Link to={`/orders/${o.id}`}>{o.orderNumber}</Link>
                    </td>
                    <td className="p-4">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{o.customerName}</p>
                        <p className="text-[10px] text-slate-400">{o.customerEmail}</p>
                      </div>
                    </td>
                    <td className="p-4 text-slate-600 dark:text-slate-350">
                      {formatDateTime(o.createdAt)}
                    </td>
                    <td className="p-4 font-semibold">{formatCurrency(o.total)}</td>
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span className="text-xs uppercase font-semibold text-slate-700 dark:text-slate-300">
                          {o.paymentMethod}
                        </span>
                        <span
                          className={`text-[10px] font-bold ${
                            o.paymentStatus === 'paid' ? 'text-green-600' : 'text-amber-500'
                          }`}
                        >
                          {o.paymentStatus}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="p-4 text-right">
                      <Link
                        to={`/orders/${o.id}`}
                        className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl"
                      >
                        <Eye className="h-3.5 w-3.5" /> View Details
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        <div className="flex items-center justify-between p-4 border-t border-slate-100 dark:border-slate-800 text-xs bg-slate-50/30 dark:bg-slate-900/10">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Show</span>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value))
                setPage(1)
              }}
              className="input py-1 px-2 pr-6 rounded-lg text-xs"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="text-slate-500">orders per page</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 bg-white dark:bg-slate-800 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-500"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Page {page}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={orders.length < limit}
              className="p-1.5 bg-white dark:bg-slate-800 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-500"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
export default OrdersPage
