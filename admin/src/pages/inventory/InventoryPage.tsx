import React, { useState, useEffect } from 'react'
import { Warehouse, Plus, Minus, Settings2, RefreshCw, History, FileText } from 'lucide-react'
import { inventoryService } from '../../services/inventoryService'
import { InventoryItem, StockMovement } from '../../types'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { formatDateTime } from '@meruveda/shared'
import { Modal } from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import toast from 'react-hot-toast'

export const InventoryPage: React.FC = () => {
  const { admin } = useAuth()
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Tabs state
  const [activeTab, setActiveTab] = useState<'stock' | 'movements'>('stock')

  // Stock Adjustment Modal
  const [isAdjustOpen, setIsAdjustOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [adjustQty, setAdjustQty] = useState(1)
  const [adjustType, setAdjustType] = useState<'addition' | 'reduction' | 'adjustment'>('addition')
  const [adjustReason, setAdjustReason] = useState('')

  const fetchInventoryData = async () => {
    setIsLoading(true)
    try {
      const [inv, movs] = await Promise.all([
        inventoryService.getInventory(),
        inventoryService.getStockMovements(),
      ])
      setInventory(inv)
      setMovements(movs)
    } catch (err) {
      toast.error('Failed to load inventory data')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchInventoryData()
  }, [])

  const openAdjustModal = (item: InventoryItem) => {
    setSelectedItem(item)
    setAdjustQty(1)
    setAdjustType('addition')
    setAdjustReason('')
    setIsAdjustOpen(true)
  }

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedItem || adjustQty <= 0) return

    try {
      await inventoryService.adjustStock(
        selectedItem.productId,
        adjustQty,
        adjustType,
        adjustReason || 'Manual adjustment',
        admin?.name || 'Veda Admin'
      )
      toast.success('Stock adjusted successfully!')
      setIsAdjustOpen(false)
      fetchInventoryData()
    } catch (err) {
      toast.error('Adjustment failed')
    }
  }

  // Summary Metrics
  const totalStockItems = inventory.reduce((sum, item) => sum + item.currentStock, 0)
  const lowStockCount = inventory.filter((item) => item.stockStatus === 'low_stock').length
  const outOfStockCount = inventory.filter((item) => item.stockStatus === 'out_of_stock').length

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="page-title">Inventory Manager</h1>
        <p className="text-sm text-slate-500">Track and manage stock levels, alerts, and transaction logs.</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card p-6 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase">Total Units in Hand</span>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{totalStockItems}</h3>
          </div>
          <div className="p-3 bg-purple-50 dark:bg-purple-950/20 text-primary-600 rounded-2xl">
            <Warehouse className="h-6 w-6" />
          </div>
        </div>

        <div className="card p-6 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase">Low Stock Alerts</span>
            <h3 className="text-2xl font-bold text-amber-600 mt-1">{lowStockCount}</h3>
          </div>
          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 text-amber-600 rounded-2xl">
            <Settings2 className="h-6 w-6" />
          </div>
        </div>

        <div className="card p-6 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase">Out Of Stock</span>
            <h3 className="text-2xl font-bold text-red-500 mt-1">{outOfStockCount}</h3>
          </div>
          <div className="p-3 bg-red-50 dark:bg-red-950/20 text-red-500 rounded-2xl">
            <Minus className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Tab controls */}
      <div className="flex border-b dark:border-slate-800 gap-6 text-sm">
        <button
          onClick={() => setActiveTab('stock')}
          className={`pb-3 font-semibold transition-colors flex items-center gap-1.5 ${
            activeTab === 'stock'
              ? 'border-b-2 border-primary-600 text-primary-600'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <Warehouse className="h-4.5 w-4.5" /> Current Stock
        </button>
        <button
          onClick={() => setActiveTab('movements')}
          className={`pb-3 font-semibold transition-colors flex items-center gap-1.5 ${
            activeTab === 'movements'
              ? 'border-b-2 border-primary-600 text-primary-600'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <History className="h-4.5 w-4.5" /> Stock Movements Log
        </button>
      </div>

      {/* Current Stock Table */}
      {activeTab === 'stock' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 text-slate-500 text-xs font-semibold">
                  <th className="p-4">Product</th>
                  <th className="p-4">SKU</th>
                  <th className="p-4">Stock Level</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Last Restocked</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-350" />
                      Loading inventory levels...
                    </td>
                  </tr>
                ) : (
                  inventory.map((item) => (
                    <tr key={item.productId} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/10">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={item.thumbnail}
                            alt={item.productName}
                            className="h-9 w-9 rounded-lg object-cover bg-slate-50 border"
                          />
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {item.productName}
                          </span>
                        </div>
                      </td>
                      <td className="p-4 text-xs font-mono">{item.sku}</td>
                      <td className="p-4 font-semibold">{item.currentStock} units</td>
                      <td className="p-4">
                        <StatusBadge status={item.stockStatus} />
                      </td>
                      <td className="p-4 text-xs text-slate-500">
                        {item.lastRestocked ? formatDateTime(item.lastRestocked) : '-'}
                      </td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => openAdjustModal(item)}
                          className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl"
                        >
                          <Settings2 className="h-3.5 w-3.5" /> Adjust Stock
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stock Movements Log view */}
      {activeTab === 'movements' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 text-slate-500 text-xs font-semibold">
                  <th className="p-4">Timestamp</th>
                  <th className="p-4">Product</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Qty Changed</th>
                  <th className="p-4">New Level</th>
                  <th className="p-4">Reason / Notes</th>
                  <th className="p-4 text-right">Authorized By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      Loading stock logs...
                    </td>
                  </tr>
                ) : movements.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-slate-400">
                      No stock movement logs found.
                    </td>
                  </tr>
                ) : (
                  movements.map((mov) => (
                    <tr key={mov.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/10">
                      <td className="p-4 text-xs text-slate-500">{formatDateTime(mov.createdAt)}</td>
                      <td className="p-4 font-semibold">{mov.productName}</td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase ${
                            mov.type === 'addition'
                              ? 'text-green-600'
                              : mov.type === 'reduction'
                              ? 'text-red-500'
                              : 'text-blue-600'
                          }`}
                        >
                          {mov.type}
                        </span>
                      </td>
                      <td className="p-4 font-mono font-bold">
                        {mov.type === 'addition' ? '+' : mov.type === 'reduction' ? '-' : ''}
                        {mov.quantity}
                      </td>
                      <td className="p-4 font-semibold">{mov.newStock} units</td>
                      <td className="p-4 text-slate-500">{mov.reason || '-'}</td>
                      <td className="p-4 text-right font-medium">{mov.adminName}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Adjust Stock Modal */}
      <Modal
        isOpen={isAdjustOpen}
        onClose={() => setIsAdjustOpen(false)}
        title={`Adjust Stock — ${selectedItem?.productName}`}
      >
        <form onSubmit={handleAdjustSubmit} className="space-y-4">
          <div className="flex justify-between items-center text-xs text-slate-500 font-semibold bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl">
            <span>Current Stock level:</span>
            <span className="font-bold text-slate-900 dark:text-white">
              {selectedItem?.currentStock} units
            </span>
          </div>

          <div>
            <label className="label">Adjustment Type</label>
            <select
              value={adjustType}
              onChange={(e) => setAdjustType(e.target.value as any)}
              className="input"
            >
              <option value="addition">Add Stock (+)</option>
              <option value="reduction">Remove Stock (-)</option>
              <option value="adjustment">Set Absolute Level (=)</option>
            </select>
          </div>

          <div>
            <label className="label">Quantity</label>
            <input
              type="number"
              required
              min="1"
              value={adjustQty}
              onChange={(e) => setAdjustQty(Number(e.target.value))}
              className="input"
            />
          </div>

          <div>
            <label className="label">Reason / Notes</label>
            <input
              type="text"
              required
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              placeholder="e.g. Monthly restock arrival, Damage deduction, etc."
              className="input"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={() => setIsAdjustOpen(false)}
              className="btn-outline px-4 py-2 text-xs"
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary px-4 py-2 text-xs">
              Confirm Adjustment
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
export default InventoryPage
