import React, { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Edit, Calendar, Package, BadgePercent, ShieldAlert, Award } from 'lucide-react'
import { productService } from '../../services/productService'
import { Product } from '../../types'
import { formatCurrency, formatDate } from '@meruveda/shared'
import { StatusBadge } from '../../components/ui/StatusBadge'
import toast from 'react-hot-toast'

export const ProductDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [product, setProduct] = useState<Product | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchProduct = async () => {
      if (!id) return
      try {
        const item = await productService.getProductById(id)
        setProduct(item)
      } catch (err) {
        toast.error('Product not found')
        navigate('/products')
      } finally {
        setIsLoading(false)
      }
    }
    fetchProduct()
  }, [id, navigate])

  if (isLoading || !product) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="animate-pulse text-slate-400">Loading product details...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Title block */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/products"
            className="p-2 bg-white dark:bg-slate-800 border rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="page-title">{product.name}</h1>
            <p className="text-xs text-slate-500 font-mono">SKU: {product.sku}</p>
          </div>
        </div>

        <Link
          to={`/products/${product.id}/edit`}
          className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl"
        >
          <Edit className="h-4 w-4" /> Edit Product
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: General & Media info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Media preview */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title">Product Media</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {product.images.map((img: any) => (
                <div key={img.id} className="relative aspect-square border rounded-xl overflow-hidden group">
                  <img src={img.url} alt="product" className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
          </div>

          {/* Description & Clinical features */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title">Product Description</h3>
            <div className="space-y-3">
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Short Description</h4>
                <p className="text-sm text-slate-700 dark:text-slate-200 mt-1">{product.shortDescription}</p>
              </div>
              <div className="border-t dark:border-slate-800 pt-3">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Long Description</h4>
                <p className="text-sm text-slate-700 dark:text-slate-200 mt-1">{product.longDescription}</p>
              </div>
            </div>
          </div>

          {/* Ayurvedic properties */}
          {(product.ingredients || product.benefits || product.dosage || product.warnings) && (
            <div className="card p-6 space-y-4">
              <h3 className="section-title flex items-center gap-1.5">
                <Award className="h-5 w-5 text-primary-600" /> Ayurvedic Attributes
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {product.ingredients && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase">Ingredients</h4>
                    <p className="text-sm text-slate-700 dark:text-slate-350 mt-1">{product.ingredients}</p>
                  </div>
                )}
                {product.benefits && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase">Benefits</h4>
                    <p className="text-sm text-slate-700 dark:text-slate-350 mt-1">{product.benefits}</p>
                  </div>
                )}
                {product.dosage && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase">Recommended Dosage</h4>
                    <p className="text-sm text-slate-700 dark:text-slate-350 mt-1">{product.dosage}</p>
                  </div>
                )}
                {product.warnings && (
                  <div>
                    <h4 className="text-xs font-semibold text-red-500 uppercase flex items-center gap-1">
                      <ShieldAlert className="h-3.5 w-3.5" /> Warnings & Contraindications
                    </h4>
                    <p className="text-sm text-slate-700 dark:text-slate-350 mt-1">{product.warnings}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Inventory, pricing details & SEO */}
        <div className="space-y-6">
          {/* Inventory info */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title flex items-center gap-1.5">
              <Package className="h-5 w-5 text-slate-400" /> Stock & Category
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Stock Status</span>
                <StatusBadge status={product.stockStatus} />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Current Stock</span>
                <span className="font-semibold text-slate-900 dark:text-white">{product.stock} units</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Min. Alert Stock</span>
                <span className="font-semibold text-slate-900 dark:text-white">{product.minimumStock} units</span>
              </div>
              <div className="border-t dark:border-slate-800 pt-3 flex justify-between text-sm">
                <span className="text-slate-400">Category</span>
                <span className="font-semibold">{product.categoryName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Brand</span>
                <span className="font-semibold">{product.brand}</span>
              </div>
              {product.weight && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Weight</span>
                  <span className="font-semibold">{product.weight}</span>
                </div>
              )}
            </div>
          </div>

          {/* Pricing info */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title flex items-center gap-1.5">
              <BadgePercent className="h-5 w-5 text-slate-400" /> Pricing & Taxation
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Selling Price</span>
                <span className="font-bold text-lg text-primary-600 dark:text-primary-400">
                  {formatCurrency(product.sellingPrice)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">MRP</span>
                <span className="font-semibold text-slate-500 line-through">
                  {formatCurrency(product.mrp)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Discount Applied</span>
                <span className="font-semibold text-green-600">{product.discount}% OFF</span>
              </div>
              <div className="border-t dark:border-slate-800 pt-3 flex justify-between text-sm">
                <span className="text-slate-400">GST Rate</span>
                <span className="font-semibold">{product.gst}%</span>
              </div>
            </div>
          </div>

          {/* Dates & Mfg */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title flex items-center gap-1.5">
              <Calendar className="h-5 w-5 text-slate-400" /> Manufacturing Details
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Expiry Date</span>
                <span className="font-semibold">{formatDate(product.expiryDate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Manufacturer</span>
                <span className="font-semibold text-right max-w-[180px]">{product.manufacturer || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Country of Origin</span>
                <span className="font-semibold">{product.country || '-'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
export default ProductDetailPage
