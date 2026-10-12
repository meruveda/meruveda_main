import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Users, Search, ShieldAlert, Trash2, Eye, RefreshCw, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import { customerService } from '../../services/customerService'
import { Customer } from '../../types'
import { formatCurrency, formatDate } from '@meruveda/shared'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { ConfirmDialog } from '../../components/ui/Modal'
import toast from 'react-hot-toast'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
const DEFAULT_PAGE_SIZE = 25

const PLACEHOLDER_EMAIL_DOMAIN = 'meruveda.whatsapp'

const isPlaceholderEmail = (email?: string | null): boolean => {
  if (!email) return true
  return String(email).trim().toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`)
}

/** Name -> real-email prefix -> phone -> 'Unknown', so no directory row is ever blank. */
const displayNameOf = (c: { name?: string; email?: string; phone?: string }): string => {
  const name = (c.name || '').trim()
  if (name && name !== 'Guest Customer') return name
  const email = (c.email || '').trim()
  if (email && !isPlaceholderEmail(email)) {
    const prefix = email.split('@')[0].replace(/[._-]+/g, ' ').trim()
    if (prefix) return prefix
  }
  if ((c.phone || '').trim()) return `Customer ${c.phone!.trim().slice(-5)}`
  return name || 'Unknown'
}

const displayEmailOf = (c: { email?: string; phone?: string }): string => {
  const email = (c.email || '').trim()
  if (email && !isPlaceholderEmail(email)) return email
  return (c.phone || '').trim() || '—'
}

export const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)

  // Search & Filters
  const [search, setSearch] = useState('')

  // Modals state
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [blockId, setBlockId] = useState<string | null>(null)

  const fetchCustomers = async () => {
    setIsLoading(true)
    try {
      const result = await customerService.getCustomersPage({
        page,
        limit: pageSize,
        search: search.trim() || undefined,
      })
      setCustomers(result.items)
      setTotal(result.total)
      setTotalPages(Math.max(1, result.totalPages))
    } catch (err) {
      toast.error('Failed to load customers')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // Debounce keystrokes so typing a name doesn't storm the API (and so a
    // slow earlier request can't overwrite a newer one).
    const t = setTimeout(() => {
      fetchCustomers();
    }, 300);
    return () => clearTimeout(t);
  }, [page, search, pageSize])

  useEffect(() => {
    setPage(1)
  }, [search, pageSize])

  const handleBlockToggle = async () => {
    if (!blockId) return
    try {
      const updated = await customerService.toggleBlockCustomer(blockId)
      toast.success(updated.isBlocked ? 'Customer blocked' : 'Customer unblocked')
      fetchCustomers()
    } catch (err) {
      toast.error('Failed to update customer block status')
    } finally {
      setBlockId(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await customerService.deleteCustomer(deleteId)
      toast.success('Customer deleted successfully')
      fetchCustomers()
    } catch (err) {
      toast.error('Failed to delete customer')
    } finally {
      setDeleteId(null)
    }
  }

  /**
   * Downloads every customer (all pages, honouring the active search) as a
   * real Excel workbook. `xlsx` is imported lazily so it never weighs down the
   * initial admin bundle. Download is triggered via Blob + temporary anchor
   * tag (with the correct .xlsx MIME type) for reliable cross-browser saves.
   */
  const handleExport = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const all = await customerService.getAllCustomers(search.trim() || undefined)
      if (all.length === 0) {
        toast.error('There are no customers to export')
        return
      }

      const rows = all.map((c) => {
        // The raw directory row carries the full user record (names, dates, ids);
        // the mapped Customer type only exposes the display subset.
        const raw = c as Customer & Record<string, any>
        const lastActivity = raw.lastLogin || raw.last_login
        return {
          'Customer ID': raw.id,
          'First Name': raw.first_name || '',
          'Last Name': raw.last_name || '',
          'Display Name': displayNameOf(c),
          Email: isPlaceholderEmail(c.email) ? '' : c.email || '',
          Phone: c.phone || '',
          City: c.city || '',
          'Account Role': raw.role || 'customer',
          'Joined On': raw.createdAt || raw.created_at ? formatDate(raw.createdAt || raw.created_at) : '-',
          'Orders Count': Number(c.totalOrders ?? 0),
          'Lifetime Spend (₹)': Number(c.lifetimeSpend ?? 0),
          'Last Activity': lastActivity ? formatDate(lastActivity) : '-',
          Status: c.isBlocked ? 'Blocked' : 'Active',
        }
      })

      const { writeWorkbook, excelFileName } = await import('../../utils/exportExcel')
      await writeWorkbook({ Customers: rows }, excelFileName('customers'))
      toast.success(`Exported all ${all.length} customers to Excel`)
    } catch (err) {
      console.error('Customer Excel export failed', err)
      toast.error('Failed to export customers')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="page-title">Customers Directory</h1>
        <p className="text-sm text-slate-500">Monitor client metrics, spend volumes, profiles, and blocks.</p>
      </div>

      {/* Toolbar filter */}
      <div className="card p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-85 text-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer name, email, phone..."
            className="input pl-9"
          />
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={isLoading || isExporting}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          {isExporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {isExporting ? 'Preparing…' : `Export all${total ? ` (${total})` : ''}`}
        </button>
      </div>

      {/* Customers Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 text-slate-500 text-xs font-semibold">
                <th className="p-4">Customer Details</th>
                <th className="p-4">Orders Count</th>
                <th className="p-4">Lifetime Spend</th>
                <th className="p-4">Last Activity</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-350" />
                    Loading directory...
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-slate-400">
                    No customers found matching queries.
                  </td>
                </tr>
              ) : (
                customers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/10">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={c.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop'}
                          alt={displayNameOf(c)}
                          className="h-9 w-9 rounded-full object-cover border"
                        />
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">{displayNameOf(c)}</p>
                          <p className="text-xs text-slate-400">{displayEmailOf(c)}</p>
                          {c.phone && <p className="text-[10px] text-slate-400">{c.phone}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="p-4 font-semibold">{c.totalOrders} orders</td>
                    <td className="p-4 font-bold text-slate-950 dark:text-slate-100">
                      {formatCurrency(c.lifetimeSpend)}
                    </td>
                    <td className="p-4 text-xs text-slate-500">{formatDate(c.lastLogin)}</td>
                    <td className="p-4">
                      <StatusBadge status={c.isBlocked ? 'cancelled' : 'active'} />
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Link
                          to={`/customers/${c.id}`}
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 hover:text-primary-600"
                          title="View Profile"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                        <button
                          onClick={() => setBlockId(c.id)}
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 hover:text-amber-500"
                          title={c.isBlocked ? 'Unblock Customer' : 'Block Customer'}
                        >
                          <ShieldAlert className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(c.id)}
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 hover:text-red-500"
                          title="Delete Customer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1 text-xs">
          <span className="text-slate-500">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} customer{total === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-slate-500">
              Rows
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="input py-1 px-2 text-xs"
                aria-label="Customers per page"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || isLoading}
              className="p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-500"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
              className="p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-500"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Confirm Deletion */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Customer Account"
        message="Are you sure you want to permanently delete this customer account? This clears their profile details and address configurations."
        isDestructive
      />

      {/* Confirm Block */}
      <ConfirmDialog
        isOpen={!!blockId}
        onClose={() => setBlockId(null)}
        onConfirm={handleBlockToggle}
        title="Toggle Customer Block status"
        message="Are you sure you want to update this customer block status? Blocked customers cannot login or checkout from storefronts."
      />
    </div>
  )
}
export default CustomersPage
