export type ProductStatus = 'active' | 'inactive' | 'archived'
export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock'

export interface ProductImage {
  id: string
  url: string
  alt?: string
}

export interface Product {
  id: string
  name: string
  slug: string
  categoryId: string
  categoryName: string
  subcategoryId?: string
  subcategoryName?: string
  brand: string
  sku: string
  mrp: number
  sellingPrice: number
  discount: number
  stock: number
  minimumStock: number
  thumbnail: string
  images: ProductImage[]
  shortDescription: string
  longDescription: string
  ingredients?: string
  benefits?: string
  dosage?: string
  warnings?: string
  expiryDate?: string
  manufacturer?: string
  country?: string
  gst: number
  gstRate?: number
  gst_rate?: number
  weight?: string
  length?: number
  breadth?: number
  height?: number
  hsn?: string
  hsnCode?: string
  hsn_code?: string
  seoTitle?: string
  seoDescription?: string
  isFeatured: boolean
  isTrending: boolean
  isBestSeller: boolean
  isRecommended: boolean
  status: ProductStatus
  stockStatus: StockStatus
  createdAt: string
  updatedAt: string
}

export interface ProductFilters {
  search?: string
  categoryId?: string
  brand?: string
  stockStatus?: StockStatus
  status?: ProductStatus
  minPrice?: number
  maxPrice?: number
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}
