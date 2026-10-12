import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CreditCard, Search, ArrowUpRight, ArrowDownLeft, RefreshCw } from 'lucide-react'
import { transactionService } from '../../services/transactionService'
import { Transaction } from '../../types'
import { formatCurrency, formatDateTime } from '@meruveda/shared'
import { StatusBadge } from '../../components/ui/StatusBadge'
import toast from 'react-hot-toast'
import { orderService } from '../../services/orderService'
import { COMPANY_CONFIG } from '../orders/OrderDetailPage'

export const TransactionsPage: React.FC = () => {
  const [txns, setTxns] = useState<Transaction[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Filters state
  const [type, setType] = useState<'payment' | 'refund' | ''>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  const fetchTransactions = async () => {
    setIsLoading(true)
    try {
      const params: any = {}
      if (type) params.type = type
      if (startDate) params.startDate = new Date(startDate).toISOString()
      if (endDate) params.endDate = new Date(endDate).toISOString()
      const data = await transactionService.getTransactions(params)
      setTxns(data)
    } catch (err) {
      toast.error('Failed to load transaction logs')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchTransactions()
  }, [type, startDate, endDate])

  const exportCSV = async () => {
    const toastId = toast.loading('Preparing transactions Excel report...')
    try {
      const all = await transactionService.getAllTransactions({
        ...(type ? { type } : {}),
        ...(startDate ? { startDate: new Date(startDate).toISOString() } : {}),
        ...(endDate ? { endDate: new Date(endDate).toISOString() } : {}),
      })
      if (all.length === 0) {
        toast.dismiss(toastId)
        toast.error('No transactions to export.')
        return
      }

      const rows = all.map((t) => ({
        'Transaction ID': t.id,
        'Order Number': t.orderNumber,
        Type: t.type,
        'Payment Method': t.method,
        'Gateway Reference': t.gatewayRef || '',
        Amount: t.amount,
        Timestamp: t.createdAt,
        Status: t.status,
      }))

      const { writeWorkbook, excelFileName } = await import('../../utils/exportExcel')
      await writeWorkbook({ Transactions: rows }, excelFileName('transactions_export'))

      toast.dismiss(toastId)
      toast.success('Transactions Excel report exported successfully!')
    } catch (err) {
      toast.dismiss(toastId)
      toast.error('Failed to export transactions.')
      console.error(err)
    }
  }

  const exportGSTReport = async () => {
    const toastId = toast.loading('Preparing CA-Ready GST Report...')
    try {
      // Fetch ALL orders for the selected date range (page-walked, not capped).
      const params: Record<string, string> = { includeItems: 'true' }
      if (startDate) params.startDate = new Date(startDate).toISOString()
      if (endDate) params.endDate = new Date(endDate).toISOString()

      const orders = await orderService.getAllOrders(params)

      if (!orders || orders.length === 0) {
        toast.dismiss(toastId)
        toast.error('No orders found for the selected date range.')
        return
      }

      const COMPANY_GSTIN = COMPANY_CONFIG.gstin || 'GSTIN_PENDING'

      const rows = orders.map((order: any) => {
        const state = order.shippingAddress?.state || ''
        const s = state.trim().toLowerCase()
        const validMatches = ['rajasthan', 'rj', 'rajsthan', 'rajasthn', 'rajastan', 'rajasthna', 'rajastran', 'raj']
        const isIntraState = validMatches.includes(s) || (s.startsWith('raj') && s.length >= 5)

        const customerName = order.shippingAddress?.fullName || order.customerName || 'Guest'
        const invoiceNum = order.orderNumber
        const invoiceDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString() : ''

        const items = Array.isArray(order.items) ? order.items : []
        const productNames = items.map((item: any) => item.productName || 'Unknown Product').join(' | ') || 'N/A'
        const hsnCodes = items.map((item: any) => item.hsn || '').filter(Boolean).join(' | ') || 'N/A'

        const taxableValue = Number(order.subtotal || 0) - Number(order.discount || 0)

        const uniqueRates = Array.from(new Set(items.map((item: any) => Number(item.gst ?? 5))))
        const gstRateStr = uniqueRates.length > 0 ? uniqueRates.join('% & ') + '%' : '5%'

        const totalTax = Number(order.tax || 0)
        const cgst = isIntraState ? totalTax / 2 : 0
        const sgst = isIntraState ? totalTax / 2 : 0
        const igst = isIntraState ? 0 : totalTax

        return {
          'Invoice Number': invoiceNum,
          'Invoice Date': invoiceDate,
          'Order Number': order.orderNumber,
          'Customer Name': customerName,
          'Customer State': state || 'N/A',
          'Product Name(s)': productNames,
          'HSN/SAC Code(s)': hsnCodes,
          'Taxable Value (INR)': Number(taxableValue.toFixed(2)),
          'GST Rate (%)': gstRateStr,
          'CGST Amount (INR)': Number(cgst.toFixed(2)),
          'SGST Amount (INR)': Number(sgst.toFixed(2)),
          'IGST Amount (INR)': Number(igst.toFixed(2)),
          'Shipping Charges (INR)': Number(Number(order.shippingCharge || 0).toFixed(2)),
          'Total Invoice Value (INR)': Number(Number(order.total || 0).toFixed(2)),
          'Payment Status': order.paymentStatus || 'N/A',
          'Payment Method': order.paymentMethod || 'N/A',
        }
      })

      const metaRows = [
        {
          'Report': 'MERUVEDA WELLNESS - GST REPORT',
          'GSTIN': COMPANY_GSTIN,
          'Date Range': `${startDate || 'All'} to ${endDate || 'All'}`,
          'Generated On': new Date().toLocaleString(),
        },
      ]

      const { writeWorkbook } = await import('../../utils/exportExcel')
      await writeWorkbook(
        { 'GSTR-1': rows, 'Report Info': metaRows },
        `gstr1_report_${startDate || 'all'}_to_${endDate || 'all'}.xlsx`,
      )

      toast.dismiss(toastId)
      toast.success('GSTR-1 CA-Ready report exported successfully!')
    } catch (err: any) {
      toast.dismiss(toastId)
      toast.error('Failed to export GST report.')
      console.error(err)
    }
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Transaction Log</h1>
          <p className="text-sm text-slate-500">Audit gateway captures, refund logs, payment methods, and UPI payouts.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCSV}
            className="btn-secondary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl"
          >
            Export Excel Report
          </button>
          <button
            onClick={exportGSTReport}
            className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl"
          >
            Export GST Report (Excel)
          </button>
        </div>
      </div>

      {/* Filters bar */}
      <div className="card p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-slate-400 font-medium">Filter Type:</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as any)}
            className="input py-1.5 pr-8 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          >
            <option value="">All Transactions</option>
            <option value="payment">Captured Payments Only</option>
            <option value="refund">Refunds Only</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-slate-400 font-medium">From:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input py-1 px-2 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-slate-400 font-medium">To:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input py-1 px-2 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
            />
          </div>
          {(startDate || endDate) && (
            <button
              onClick={() => {
                setStartDate('')
                setEndDate('')
              }}
              className="text-red-500 hover:text-red-700 font-semibold px-2"
            >
              Clear dates
            </button>
          )}
        </div>
      </div>

      {/* Transactions Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 text-slate-500 text-xs font-semibold">
                <th className="p-4">Transaction Details</th>
                <th className="p-4">Order Link</th>
                <th className="p-4">Payment Method</th>
                <th className="p-4">Gateway Reference</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Timestamp</th>
                <th className="p-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-350" />
                    Loading logs...
                  </td>
                </tr>
              ) : txns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400">
                    No transactions captured.
                  </td>
                </tr>
              ) : (
                txns.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/10">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-2 rounded-lg ${
                            t.type === 'payment'
                              ? 'bg-green-50 dark:bg-green-950/20 text-green-600'
                              : 'bg-red-50 dark:bg-red-950/20 text-red-500'
                          }`}
                        >
                          {t.type === 'payment' ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white capitalize">{t.type}</p>
                          <p className="text-[10px] text-slate-400">{t.customerName}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-primary-600 dark:text-primary-400 font-semibold">
                      <Link to={`/orders/${t.orderId}`}>{t.orderNumber}</Link>
                    </td>
                    <td className="p-4">
                      <span className="text-xs uppercase font-semibold text-slate-700 dark:text-slate-300">
                        {t.method}
                      </span>
                    </td>
                    <td className="p-4 font-mono text-xs text-slate-500">{t.gatewayRef || '-'}</td>
                    <td
                      className={`p-4 font-bold ${
                        t.type === 'payment' ? 'text-slate-950 dark:text-slate-100' : 'text-red-500'
                      }`}
                    >
                      {t.type === 'payment' ? '' : '-'}
                      {formatCurrency(t.amount)}
                    </td>
                    <td className="p-4 text-xs text-slate-500">{formatDateTime(t.createdAt)}</td>
                    <td className="p-4 text-right">
                      <StatusBadge status={t.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
export default TransactionsPage
