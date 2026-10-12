import React, { useState, useEffect } from 'react'
import { Plus, Ticket, ToggleLeft, ToggleRight, Trash2, RefreshCw } from 'lucide-react'
import { couponService } from '../../services/couponService'
import { Coupon, CouponType } from '../../types'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { formatDate, formatCurrency } from '@meruveda/shared'
import { Modal, ConfirmDialog } from '../../components/ui/Modal'
import toast from 'react-hot-toast'

export const CouponsPage: React.FC = () => {
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Modal creation states
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Form states
  const [code, setCode] = useState('')
  const [type, setType] = useState<CouponType>('percentage')
  const [value, setValue] = useState(0)
  const [maxDiscount, setMaxDiscount] = useState(0)
  const [minPurchase, setMinPurchase] = useState(0)
  const [usageLimit, setUsageLimit] = useState(100)
  const [expiresAt, setExpiresAt] = useState('')

  const fetchCoupons = async () => {
    setIsLoading(true)
    try {
      const data = await couponService.getCoupons()
      setCoupons(data)
    } catch (err) {
      toast.error('Failed to load coupons')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchCoupons()
  }, [])

  const openAdd = () => {
    setCode('')
    setType('percentage')
    setValue(10)
    setMaxDiscount(500)
    setMinPurchase(999)
    setUsageLimit(100)
    setExpiresAt('')
    setIsAddOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code) {
      toast.error('Coupon code is mandatory')
      return
    }

    const payload = {
      code: code.toUpperCase(),
      type,
      value,
      maxDiscount: maxDiscount || undefined,
      minPurchase: minPurchase || undefined,
      usageLimit: usageLimit || undefined,
      isActive: true,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    }

    try {
      await couponService.createCoupon(payload)
      toast.success('Coupon created successfully!')
      setIsAddOpen(false)
      fetchCoupons()
    } catch (err) {
      toast.error('Failed to create coupon')
    }
  }

  const handleToggle = async (id: string, current: boolean) => {
    try {
      await couponService.updateCouponStatus(id, !current)
      toast.success(current ? 'Coupon disabled' : 'Coupon enabled')
      fetchCoupons()
    } catch (err) {
      toast.error('Failed to toggle status')
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await couponService.deleteCoupon(deleteId)
      toast.success('Coupon deleted successfully')
      fetchCoupons()
    } catch (err) {
      toast.error('Failed to delete coupon')
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Discount Coupons</h1>
          <p className="text-sm text-slate-500">Configure promotional campaigns, flat discounts, and free shipping.</p>
        </div>
        <button
          onClick={openAdd}
          className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl"
        >
          <Plus className="h-4 w-4" /> Add Coupon
        </button>
      </div>

      {/* Coupons List */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 text-slate-500 text-xs font-semibold">
                <th className="p-4">Coupon Code</th>
                <th className="p-4">Discount Details</th>
                <th className="p-4">Constraints</th>
                <th className="p-4">Usage Count</th>
                <th className="p-4">Expiry Date</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-350" />
                    Loading coupons...
                  </td>
                </tr>
              ) : coupons.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400">
                    No coupons created.
                  </td>
                </tr>
              ) : (
                coupons.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/10">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-50 dark:bg-purple-950/20 text-primary-600 rounded-lg">
                          <Ticket className="h-4.5 w-4.5" />
                        </div>
                        <span className="font-bold text-slate-900 dark:text-white font-mono uppercase">
                          {c.code}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      {c.type === 'percentage' ? (
                        <span className="font-semibold">{c.value}% OFF Discount</span>
                      ) : c.type === 'flat' ? (
                        <span className="font-semibold">{formatCurrency(c.value)} FLAT Discount</span>
                      ) : (
                        <span className="font-semibold">FREE Shipping coupon</span>
                      )}
                    </td>
                    <td className="p-4 text-xs text-slate-500 space-y-0.5">
                      {c.minPurchase ? <p>Min Purchase: {formatCurrency(c.minPurchase)}</p> : null}
                      {c.maxDiscount ? <p>Max Discount: {formatCurrency(c.maxDiscount)}</p> : null}
                      {c.usageLimit ? <p>Limit: {c.usageLimit} uses</p> : null}
                    </td>
                    <td className="p-4 font-semibold">{c.usedCount} uses</td>
                    <td className="p-4 text-xs text-slate-500">
                      {c.expiresAt ? formatDate(c.expiresAt) : 'Never'}
                    </td>
                    <td className="p-4">
                      <StatusBadge status={c.isActive ? 'active' : 'inactive'} />
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => handleToggle(c.id, c.isActive)}
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500"
                          title={c.isActive ? 'Disable Coupon' : 'Enable Coupon'}
                        >
                          {c.isActive ? (
                            <ToggleRight className="h-5 w-5 text-green-600" />
                          ) : (
                            <ToggleLeft className="h-5 w-5 text-slate-400" />
                          )}
                        </button>
                        <button
                          onClick={() => setDeleteId(c.id)}
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 hover:text-red-500"
                          title="Delete Coupon"
                        >
                          <Trash2 className="h-4.5 w-4.5" />
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

      {/* Add Coupon Modal */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="Create Discount Coupon">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Coupon Code *</label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. VEDA20"
                className="input font-mono uppercase"
              />
            </div>

            <div>
              <label className="label">Discount Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as CouponType)}
                className="input"
              >
                <option value="percentage">Percentage (%)</option>
                <option value="flat">Flat Cash (₹)</option>
                <option value="free_shipping">Free Shipping</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Value</label>
              <input
                type="number"
                min="0"
                disabled={type === 'free_shipping'}
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
                className="input"
              />
            </div>
            <div>
              <label className="label">Min. Purchase (₹)</label>
              <input
                type="number"
                min="0"
                value={minPurchase}
                onChange={(e) => setMinPurchase(Number(e.target.value))}
                className="input"
              />
            </div>
            <div>
              <label className="label">Max. Discount (₹)</label>
              <input
                type="number"
                min="0"
                disabled={type === 'flat' || type === 'free_shipping'}
                value={maxDiscount}
                onChange={(e) => setMaxDiscount(Number(e.target.value))}
                className="input"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Usage Limit (Uses)</label>
              <input
                type="number"
                min="1"
                value={usageLimit}
                onChange={(e) => setUsageLimit(Number(e.target.value))}
                className="input"
              />
            </div>
            <div>
              <label className="label">Expiry Date</label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="input"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={() => setIsAddOpen(false)}
              className="btn-outline px-4 py-2 text-xs"
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary px-4 py-2 text-xs">
              Create Campaign
            </button>
          </div>
        </form>
      </Modal>

      {/* Confirm deletion */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Coupon"
        message="Are you sure you want to permanently delete this coupon? Active customer carts using this code will fail checkout."
        isDestructive
      />
    </div>
  )
}
export default CouponsPage
