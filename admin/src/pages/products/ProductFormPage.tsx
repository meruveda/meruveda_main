import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Save, Sparkles, ImagePlus, X, Link2, Upload } from 'lucide-react'
import { productService } from '../../services/productService'
import { categoryService } from '../../services/categoryService'
import { mediaService } from '../../services/mediaService'
import { Category, Product, ProductStatus } from '../../types'
import toast from 'react-hot-toast'
import { RichTextEditor } from '../../components/RichTextEditor'
import { MediaLibrarySelectModal } from '../../components/ui/MediaLibrarySelectModal'

export const ProductFormPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isEditMode = !!id

  const [categories, setCategories] = useState<Category[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Form states
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('MeruVeda')
  const [sku, setSku] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [mrp, setMrp] = useState(0)
  const [sellingPrice, setSellingPrice] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [stock, setStock] = useState(0)
  const [minimumStock, setMinimumStock] = useState(10)
  const [images, setImages] = useState<{ id: string; url: string; file?: File }[]>([])
  const [urlInput, setUrlInput] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [shortDescription, setShortDescription] = useState('')
  const [longDescription, setLongDescription] = useState('')
  const [ingredients, setIngredients] = useState('')
  const [benefits, setBenefits] = useState('')
  const [dosage, setDosage] = useState('')
  const [warnings, setWarnings] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [manufacturer, setManufacturer] = useState('MeruVeda Organics Pvt Ltd')
  const [country, setCountry] = useState('India')
  const [gst, setGst] = useState(12)
  const [weight, setWeight] = useState('')
  const [length, setLength] = useState(10)
  const [breadth, setBreadth] = useState(10)
  const [height, setHeight] = useState(10)
  const [hsn, setHsn] = useState('')
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDescription, setSeoDescription] = useState('')
  const [isFeatured, setIsFeatured] = useState(false)
  const [isTrending, setIsTrending] = useState(false)
  const [isBestSeller, setIsBestSeller] = useState(false)
  const [isRecommended, setIsRecommended] = useState(false)
  const [status, setStatus] = useState<ProductStatus>('active')
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false)

  // Auto calculate discount percentage when MRP and Selling price change
  useEffect(() => {
    if (mrp > 0 && sellingPrice > 0) {
      const percentage = Math.round(((mrp - sellingPrice) / mrp) * 100)
      setDiscount(Math.max(0, percentage))
    } else {
      setDiscount(0)
    }
  }, [mrp, sellingPrice])

  // Image helpers
  const addImageFromFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Only image files are accepted.')
      return
    }
    const url = URL.createObjectURL(file)
    setImages((prev) => [...prev, { id: `img-${Date.now()}-${Math.random()}`, url, file }])
  }, [])

  const addImageFromUrl = () => {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    if (!trimmed.startsWith('http')) {
      toast.error('Please enter a valid URL starting with http.')
      return
    }
    setImages((prev) => [...prev, { id: `img-${Date.now()}`, url: trimmed }])
    setUrlInput('')
    toast.success('Image URL added!')
  }

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    Array.from(e.dataTransfer.files).forEach(addImageFromFile)
  }, [addImageFromFile])

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const list = await categoryService.getCategories()
        setCategories(list)
        if (list.length > 0 && !categoryId) {
          setCategoryId(list[0].id)
        }
      } catch (err) {
        toast.error('Failed to load categories')
      }
    }

    const loadProductDetails = async () => {
      if (!id) return
      setIsLoading(true)
      try {
        const item = await productService.getProductById(id)
        setName(item.name)
        setBrand(item.brand)
        setSku(item.sku)
        setCategoryId(item.categoryId)
        setMrp(item.mrp)
        setSellingPrice(item.sellingPrice)
        setStock(item.stock)
        setMinimumStock(item.minimumStock)
        const loadedImages: { id: string; url: string }[] = []
        if (item.thumbnail) loadedImages.push({ id: 'img-thumb', url: item.thumbnail })
        if (item.images) {
          item.images.forEach((img: any, i: number) => {
            if (img.url !== item.thumbnail) {
              loadedImages.push({ id: `img-${i}`, url: img.url })
            }
          })
        }
        setImages(loadedImages)
        setShortDescription(item.shortDescription)
        setLongDescription(item.longDescription)
        setIngredients(item.ingredients || '')
        setBenefits(item.benefits || '')
        setDosage(item.dosage || '')
        setWarnings(item.warnings || '')
        setExpiryDate(item.expiryDate || '')
        setManufacturer(item.manufacturer || '')
        setCountry(item.country || '')
        const gstVal = item.gst_rate !== undefined ? item.gst_rate : (item.gstRate !== undefined ? item.gstRate : item.gst);
        setGst(gstVal !== undefined ? Number(gstVal) : 12)
        setWeight(item.weight || '')
        setLength(item.length || 10)
        setBreadth(item.breadth || 10)
        setHeight(item.height || 10)
        setHsn(item.hsn || item.hsn_code || item.hsnCode || '')
        setSeoTitle(item.seoTitle || '')
        setSeoDescription(item.seoDescription || '')
        setIsFeatured(item.isFeatured)
        setIsTrending(item.isTrending)
        setIsBestSeller(item.isBestSeller)
        setIsRecommended(item.isRecommended)
        setStatus(item.status)
      } catch (err) {
        toast.error('Product not found')
        navigate('/products')
      } finally {
        setIsLoading(false)
      }
    }

    loadCategories()
    loadProductDetails()
  }, [id, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !sku || !categoryId) {
      toast.error('Please fill in all mandatory fields.')
      return
    }
    if (images.length === 0) {
      toast.error('Please add at least one product image.')
      return
    }

    const categoryName = categories.find((c) => c.id === categoryId)?.name || 'General'

    setIsLoading(true)
    try {
      const uploadedImages = await Promise.all(
        images.map(async (img) => {
          if (img.file) {
            try {
              const uploaded = await mediaService.uploadFile(img.file, 'general-media');
              return { id: uploaded.id || img.id, url: uploaded.url || uploaded.public_url, alt: name };
            } catch (err) {
              console.error('Failed to upload image', err);
              throw new Error('Failed to upload one or more images');
            }
          }
          return { id: img.id, url: img.url, alt: name };
        })
      );

      const payload = {
        name,
        brand,
        sku,
        categoryId,
        categoryName,
        mrp,
        sellingPrice,
        discount,
        stock,
        minimumStock,
        thumbnail: uploadedImages[0]?.url || '',
        images: uploadedImages,
        shortDescription,
        longDescription,
        ingredients: ingredients || undefined,
        benefits: benefits || undefined,
        dosage: dosage || undefined,
        warnings: warnings || undefined,
        expiryDate: expiryDate || undefined,
        manufacturer: manufacturer || undefined,
        country: country || undefined,
        gst,
        gst_rate: gst,
        gstRate: gst,
        weight: weight || undefined,
        length,
        breadth,
        height,
        hsn: hsn || undefined,
        hsn_code: hsn || undefined,
        hsnCode: hsn || undefined,
        seoTitle: seoTitle || undefined,
        seoDescription: seoDescription || undefined,
        isFeatured,
        isTrending,
        isBestSeller,
        isRecommended,
        status,
      }

      if (isEditMode && id) {
        await productService.updateProduct(id, payload)
        toast.success('Product updated successfully!')
      } else {
        await productService.createProduct(payload)
        toast.success('Product created successfully!')
      }
      navigate('/products')
    } catch (err: any) {
      toast.error(err.message || 'Operation failed')
    } finally {
      setIsLoading(false)
    }
  }

  // Auto generate SEO title and description from name/description
  const handleAutoSEO = () => {
    if (!name) {
      toast.error('Please input a product name first.')
      return
    }
    setSeoTitle(`${name} | Buy Authentic Ayurvedic ${brand}`)
    setSeoDescription(
      shortDescription ||
        `Shop premium ${name} formulated by ${brand}. 100% organic, traditional recipe. Fast delivery across India.`
    )
    toast.success('SEO metadata generated!')
  }

  return (
    <div className="space-y-6">
      {/* Page Title & Back */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/products"
            className="p-2 bg-white dark:bg-slate-800 border rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="page-title">{isEditMode ? 'Edit Product' : 'Add New Product'}</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6 pb-12">
        {/* Left Column: General info & descriptions */}
        <div className="lg:col-span-2 space-y-6">
          {/* Card: Basic Details */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title">Product Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Product Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ashwagandha Gold Capsules"
                  className="input"
                />
              </div>

              <div>
                <label className="label">SKU Code *</label>
                <input
                  type="text"
                  required
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="e.g. MV-ASH-001"
                  className="input"
                />
              </div>

              <div>
                <label className="label">Category *</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="input"
                >
                  <option value="" disabled className="bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100">
                    Select a Category
                  </option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id} className="bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100">
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Brand</label>
                <input
                  type="text"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="MeruVeda"
                  className="input"
                />
              </div>
            </div>

            <div>
              <label className="label">Short Description *</label>
              <textarea
                required
                value={shortDescription}
                onChange={(e) => setShortDescription(e.target.value)}
                placeholder="A brief summary for category listings..."
                className="input h-20"
              />
            </div>

            <div>
              <label className="label font-semibold mb-1 block">Long Description *</label>
              <RichTextEditor
                value={longDescription}
                onChange={setLongDescription}
                placeholder="Full details, directions, history, description..."
              />
            </div>
          </div>

          {/* Card: Ayurvedic formulation details */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title">Ayurvedic Formulation (Optional)</h3>
            <div className="space-y-4">
              <div>
                <label className="label">Ingredients</label>
                <textarea
                  value={ingredients}
                  onChange={(e) => setIngredients(e.target.value)}
                  placeholder="e.g. Swarna Bhasma (0.1mg), Ashwagandha Root Extract (500mg)..."
                  className="input h-20"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Benefits</label>
                  <textarea
                    value={benefits}
                    onChange={(e) => setBenefits(e.target.value)}
                    placeholder="e.g. Stress relief, boosts stamina..."
                    className="input h-20"
                  />
                </div>
                <div>
                  <label className="label">Dosage Instructions</label>
                  <textarea
                    value={dosage}
                    onChange={(e) => setDosage(e.target.value)}
                    placeholder="e.g. 1-2 capsules twice a day with warm milk..."
                    className="input h-20"
                  />
                </div>
              </div>
              <div>
                <label className="label">Warnings & Cautionary advice</label>
                <input
                  type="text"
                  value={warnings}
                  onChange={(e) => setWarnings(e.target.value)}
                  placeholder="e.g. Consult physician if pregnant or lactating."
                  className="input"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Pricing, Inventory & Settings */}
        <div className="space-y-6">
          {/* Card: Pricing */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title">Pricing & Taxation</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">MRP (₹)</label>
                <input
                  type="number"
                  min="0"
                  value={mrp || ''}
                  onChange={(e) => setMrp(e.target.value ? Number(e.target.value) : 0)}
                  onWheel={(e) => e.currentTarget.blur()}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Selling Price (₹)</label>
                <input
                  type="number"
                  min="0"
                  value={sellingPrice || ''}
                  onChange={(e) => setSellingPrice(e.target.value ? Number(e.target.value) : 0)}
                  onWheel={(e) => e.currentTarget.blur()}
                  className="input"
                />
              </div>
            </div>
            <div className="flex justify-between items-center text-xs text-slate-500 font-semibold bg-slate-50 dark:bg-slate-800/40 p-2 rounded-lg">
              <span>Calculated Discount:</span>
              <span className="text-green-600 font-bold">{discount}% OFF</span>
            </div>

            <div>
              <label className="label">GST Rate (%)</label>
              <select value={gst} onChange={(e) => setGst(Number(e.target.value))} className="input">
                <option value={5}>5% (Basic Ayurvedic)</option>
                <option value={12}>12% (Standard Ayurvedic)</option>
                <option value={18}>18% (Skincare/Cosmetics)</option>
              </select>
            </div>
          </div>

          {/* Card: Stock and specs */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title">Inventory & Specs</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Current Stock</label>
                <input
                  type="number"
                  min="0"
                  value={stock || ''}
                  onChange={(e) => setStock(e.target.value ? Number(e.target.value) : 0)}
                  onWheel={(e) => e.currentTarget.blur()}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Min. Stock Alert</label>
                <input
                  type="number"
                  min="0"
                  value={minimumStock || ''}
                  onChange={(e) => setMinimumStock(e.target.value ? Number(e.target.value) : 0)}
                  onWheel={(e) => e.currentTarget.blur()}
                  className="input"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Weight (kg) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={weight || ''}
                  onChange={(e) => setWeight(e.target.value)}
                  onWheel={(e) => e.currentTarget.blur()}
                  placeholder="e.g. 0.5"
                  className="input"
                />
              </div>
              <div>
                <label className="label">Dimensions L x B x H (cm) *</label>
                <div className="flex gap-2">
                  <input type="number" value={length || ''} onChange={(e) => setLength(e.target.value ? Number(e.target.value) : 0)} onWheel={(e) => e.currentTarget.blur()} placeholder="L" className="input px-2" />
                  <input type="number" value={breadth || ''} onChange={(e) => setBreadth(e.target.value ? Number(e.target.value) : 0)} onWheel={(e) => e.currentTarget.blur()} placeholder="B" className="input px-2" />
                  <input type="number" value={height || ''} onChange={(e) => setHeight(e.target.value ? Number(e.target.value) : 0)} onWheel={(e) => e.currentTarget.blur()} placeholder="H" className="input px-2" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">HSN Code</label>
                <input type="text" value={hsn} onChange={(e) => setHsn(e.target.value)} placeholder="e.g. 30049011" className="input" />
              </div>
              <div>
                <label className="label">Expiry Date</label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="input"
                />
              </div>
            </div>

            {/* ── Product Images Uploader ─────────────────────── */}
            <div className="space-y-3">
              <label className="label">Product Images *</label>

              {/* Drag & Drop Zone */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileInputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-2xl p-6 cursor-pointer transition-all duration-200 ${
                  isDragging
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/20'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 hover:border-primary-400 hover:bg-primary-50/30 dark:hover:bg-primary-950/10'
                }`}
              >
                <div className="p-3 bg-primary-100 dark:bg-primary-900/30 rounded-xl">
                  <Upload className="h-6 w-6 text-primary-600 dark:text-primary-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {isDragging ? 'Drop images here!' : 'Drag & drop images'}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">or click to browse files from your computer</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    Array.from(e.target.files || []).forEach(addImageFromFile)
                    e.target.value = ''
                  }}
                />
              </div>

              {/* URL input fallback */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addImageFromUrl())}
                    placeholder="Or paste an image URL and press Enter"
                    className="input pl-8 text-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={addImageFromUrl}
                  className="btn-outline px-3 py-2 text-xs rounded-xl whitespace-nowrap"
                >
                  Add URL
                </button>
                <button
                  type="button"
                  onClick={() => setIsMediaModalOpen(true)}
                  className="btn-primary px-3 py-2 text-xs rounded-xl whitespace-nowrap"
                >
                  Select from Library
                </button>
              </div>

              {/* Image Preview Grid */}
              {images.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {images.map((img, index) => (
                    <div key={img.id} className="relative group aspect-square rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                      <img
                        src={img.url}
                        alt={`Product image ${index + 1}`}
                        className="h-full w-full object-cover"
                      />
                      {index === 0 && (
                        <span className="absolute bottom-1 left-1 text-[9px] bg-primary-600 text-white px-1.5 py-0.5 rounded-md font-bold uppercase">
                          Main
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeImage(img.id)}
                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 transition-all"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 transition-all"
                  >
                    <ImagePlus className="h-5 w-5 text-slate-400" />
                  </div>
                </div>
              )}

              {images.length === 0 && (
                <p className="text-xs text-slate-400 text-center">No images added yet. The first image becomes the main thumbnail.</p>
              )}
            </div>
          </div>

          {/* Card: Badging settings & Status */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title">Promotions & Status</h3>
            <div className="grid grid-cols-2 gap-2 text-xs font-semibold">
              <label className="flex items-center gap-2 p-2 hover:bg-slate-50 dark:hover:bg-slate-700/30 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={isFeatured}
                  onChange={(e) => setIsFeatured(e.target.checked)}
                  className="rounded text-primary-600 focus:ring-primary-500 h-4 w-4"
                />
                <span>Featured</span>
              </label>
              <label className="flex items-center gap-2 p-2 hover:bg-slate-50 dark:hover:bg-slate-700/30 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={isTrending}
                  onChange={(e) => setIsTrending(e.target.checked)}
                  className="rounded text-primary-600 focus:ring-primary-500 h-4 w-4"
                />
                <span>Trending</span>
              </label>
              <label className="flex items-center gap-2 p-2 hover:bg-slate-50 dark:hover:bg-slate-700/30 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={isBestSeller}
                  onChange={(e) => setIsBestSeller(e.target.checked)}
                  className="rounded text-primary-600 focus:ring-primary-500 h-4 w-4"
                />
                <span>Best Seller</span>
              </label>
              <label className="flex items-center gap-2 p-2 hover:bg-slate-50 dark:hover:bg-slate-700/30 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={isRecommended}
                  onChange={(e) => setIsRecommended(e.target.checked)}
                  className="rounded text-primary-600 focus:ring-primary-500 h-4 w-4"
                />
                <span>Recommended</span>
              </label>
            </div>

            <div>
              <label className="label">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ProductStatus)}
                className="input"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>



          {/* Action buttons */}
          <div className="flex gap-3">
            <button
               type="button"
               onClick={() => navigate('/products')}
               className="btn-outline flex-1 justify-center py-2.5"
             >
               Cancel
             </button>
             <button
               type="submit"
               disabled={isLoading}
               className="btn-primary flex-1 justify-center py-2.5 inline-flex items-center gap-1.5"
             >
               <Save className="h-4 w-4" /> {isLoading ? 'Saving...' : 'Save Product'}
             </button>
           </div>
         </div>
       </form>

       <MediaLibrarySelectModal
         isOpen={isMediaModalOpen}
         onClose={() => setIsMediaModalOpen(false)}
         onSelect={(url) => setImages((prev) => [...prev, { id: `img-media-${Date.now()}`, url }])}
       />
     </div>
   )
 }
 export default ProductFormPage
