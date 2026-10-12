import React, { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Package,
  Plus,
  Search,
  Filter,
  Trash2,
  Copy,
  Eye,
  Edit,
  Download,
  Upload,
  RefreshCw,
  FolderOpen,
} from 'lucide-react'
import { productService } from '../../services/productService'
import { categoryService } from '../../services/categoryService'
import { Product, Category, ProductStatus } from '../../types'
import { formatCurrency } from '@meruveda/shared'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { ConfirmDialog } from '../../components/ui/Modal'
import toast from 'react-hot-toast'

export const ProductsPage: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Filters state
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState(searchParams.get('category') || '')
  const [status, setStatus] = useState<ProductStatus | ''>('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // Modal dialog triggers
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false)

  const fetchProducts = async () => {
    setIsLoading(true)
    try {
      const response = await productService.getProducts({
        search,
        categoryId,
        status: status || undefined,
        limit: 100, // Fetch all for easy client rendering in mock mode
      })
      setProducts(response)
    } catch (err) {
      toast.error('Failed to load products')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    const fetchCats = async () => {
      try {
        const cats = await categoryService.getCategories()
        setCategories(cats)
      } catch (err) {
        console.error(err)
      }
    }
    fetchCats()
  }, [])

  useEffect(() => {
    fetchProducts()
  }, [search, categoryId, status])

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await productService.deleteProduct(deleteId)
      toast.success('Product deleted successfully')
      fetchProducts()
    } catch (err) {
      toast.error('Failed to delete product')
    } finally {
      setDeleteId(null)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return
    try {
      await productService.bulkDeleteProducts(selectedIds)
      toast.success('Selected products deleted')
      setSelectedIds([])
      fetchProducts()
    } catch (err) {
      toast.error('Failed to delete selected products')
    } finally {
      setIsBulkDeleteOpen(false)
    }
  }

  const handleDuplicate = async (id: string) => {
    try {
      await productService.duplicateProduct(id)
      toast.success('Product duplicated successfully')
      fetchProducts()
    } catch (err) {
      toast.error('Failed to duplicate product')
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const toggleSelectAll = () => {
    if (selectedIds.length === products.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(products.map((p) => p.id))
    }
  }

  // Export the full filtered catalog (not just the visible page) as .xlsx
  const [isExporting, setIsExporting] = useState(false)
  const exportToExcel = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const all = await productService.getAllProducts({
        search: search.trim() || undefined,
        categoryId: categoryId || undefined,
        status: status || undefined,
      })
      if (all.length === 0) {
        toast.error('No products to export')
        return
      }
      const rows = all.map((p) => ({
        ID: p.id,
        Name: p.name,
        SKU: p.sku,
        Brand: p.brand || '',
        Category: p.categoryName || '',
        MRP: p.mrp,
        'Selling Price': p.sellingPrice,
        'Discount %': p.discount,
        Stock: p.stock,
        'GST %': p.gst ?? p.gst_rate ?? p.gstRate ?? '',
        'HSN Code': p.hsn || p.hsn_code || p.hsnCode || '',
        Status: p.status,
        'Stock Status': p.stockStatus,
      }))
      const { writeWorkbook, excelFileName } = await import('../../utils/exportExcel')
      await writeWorkbook({ Products: rows }, excelFileName('MeruVeda_Products'))
      toast.success(`Exported ${all.length} products to Excel!`)
    } catch (err) {
      console.error('Products Excel export failed', err)
      toast.error('Failed to export products')
    } finally {
      setIsExporting(false)
    }
  }

  // Simple Mock CSV Import trigger
  const triggerCSVImport = () => {
    toast.success('Ready to upload CSV. Database integration is ready!')
  }

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Products Catalog</h1>
          <p className="text-sm text-slate-500">Manage products pricing, stock, attributes, and categories.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={exportToExcel}
            disabled={isExporting}
            className="btn-secondary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl disabled:opacity-50"
          >
            {isExporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isExporting ? 'Preparing…' : 'Export Excel'}
          </button>
          <Link
            to="/products/add"
            className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl shadow-glow"
          >
            <Plus className="h-4 w-4" /> Add Product
          </Link>
        </div>
      </div>

      {/* Filters bar */}
      <div className="card p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products by SKU, name, brand..."
            className="input pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
          <div className="flex items-center gap-1.5">
            <FolderOpen className="h-4 w-4 text-slate-400" />
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="input py-1.5 pr-8 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="h-4 w-4 text-slate-400" />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProductStatus | '')}
              className="input py-1.5 pr-8 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          {selectedIds.length > 0 && (
            <button
              onClick={() => setIsBulkDeleteOpen(true)}
              className="btn-danger inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-xl"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete ({selectedIds.length})
            </button>
          )}
        </div>
      </div>

      {/* Products table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 text-slate-500 text-xs font-semibold">
                <th className="p-4 w-12 text-center">
                  <input
                    type="checkbox"
                    checked={products.length > 0 && selectedIds.length === products.length}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 h-4 w-4"
                  />
                </th>
                <th className="p-4">Product</th>
                <th className="p-4">SKU</th>
                <th className="p-4">Category</th>
                <th className="p-4">Price</th>
                <th className="p-4">Stock</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-300" />
                    Loading catalog data...
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-400">
                    No products found matching filters.
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/10">
                    <td className="p-4 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 h-4 w-4"
                      />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={p.thumbnail}
                          alt={p.name}
                          className="h-10 w-10 rounded-lg object-cover bg-slate-50 border"
                        />
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white line-clamp-1">
                            {p.name}
                          </p>
                          <p className="text-xs text-slate-400 capitalize">{p.brand}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-xs font-mono">{p.sku}</td>
                    <td className="p-4">
                      {p.categoryName && p.categoryName !== 'No category' ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-50 dark:bg-primary-950/20 text-primary-600 dark:text-primary-400">
                          {p.categoryName}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500">
                          No category
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {formatCurrency(p.sellingPrice)}
                        </span>
                        {p.discount > 0 && (
                          <span className="text-[10px] text-slate-400 line-through">
                            {formatCurrency(p.mrp)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span className="font-semibold">{p.stock} units</span>
                        <span className="text-[10px]">
                          <StatusBadge status={p.stockStatus} className="py-0 px-1.5" />
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Link
                          to={`/products/${p.id}`}
                          title="View Details"
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 hover:text-primary-600"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                        <Link
                          to={`/products/${p.id}/edit`}
                          title="Edit"
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 hover:text-blue-600"
                        >
                          <Edit className="h-4 w-4" />
                        </Link>
                        <button
                          onClick={() => handleDuplicate(p.id)}
                          title="Duplicate"
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 hover:text-green-600"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(p.id)}
                          title="Delete"
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 hover:text-red-500"
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

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Product"
        message="Are you sure you want to permanently delete this product? This action cannot be undone."
        isDestructive
      />

      {/* Bulk Delete Confirmation */}
      <ConfirmDialog
        isOpen={isBulkDeleteOpen}
        onClose={() => setIsBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        title="Delete Selected Products"
        message={`Are you sure you want to permanently delete the ${selectedIds.length} selected products?`}
        isDestructive
      />
    </div>
  )
}
export default ProductsPage
