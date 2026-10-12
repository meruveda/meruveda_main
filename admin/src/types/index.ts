export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuthResponse {
  user: any;
  token: string;
  role: string;
  admin?: AdminUser;
}

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  name?: string;
  avatar?: string;
  role: string;
}

export interface MediaItem {
  id: string;
  filename: string;
  url: string;
  mimetype: string;
  size_bytes: number;
}

export interface BlogPost extends Blog {}

// ===== Category =====
export interface Category {
  id: string
  name: string
  slug: string
  image?: string
  banner?: string
  description?: string
  isFeatured: boolean
  productCount: number
  parentId?: string
  createdAt: string
}

// ===== Review =====
export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export interface Review {
  id: string
  productId: string
  productName: string
  customerId: string
  customerName: string
  rating: number
  title?: string
  body: string
  reply?: string
  status: ReviewStatus
  createdAt: string
  isFeatured?: boolean
}

// ===== Coupon =====
export type CouponType = 'flat' | 'percentage' | 'free_shipping'

export interface Coupon {
  id: string
  code: string
  type: CouponType
  value: number
  maxDiscount?: number
  minPurchase?: number
  usageLimit?: number
  usedCount: number
  isActive: boolean
  expiresAt?: string
  createdAt: string
}

// ===== Blog =====
export type BlogStatus = 'draft' | 'published' | 'scheduled'

export interface Blog {
  id: string
  title: string
  slug: string
  excerpt?: string
  content: string
  featuredImage?: string
  authorId: string
  authorName: string
  status: BlogStatus
  publishedAt?: string
  scheduledAt?: string
  seoTitle?: string
  seoDescription?: string
  tags?: string[]
  createdAt: string
  updatedAt: string
}

// ===== Notification =====
export type NotificationType = 'order' | 'product' | 'customer' | 'system' | 'review'

export interface Notification {
  id: string
  type: NotificationType
  title: string
  message: string
  isRead: boolean
  link?: string
  createdAt: string
}

// ===== Support Ticket =====
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface SupportTicket {
  id: string
  ticketNumber: string
  customerId: string
  customerName: string
  customerEmail: string
  subject: string
  message: string
  reply?: string
  status: TicketStatus
  priority: TicketPriority
  createdAt: string
  updatedAt: string
}

// ===== Activity Log =====
export type ActivityModule =
  | 'products'
  | 'categories'
  | 'orders'
  | 'customers'
  | 'coupons'
  | 'media'
  | 'blog'
  | 'settings'
  | 'admins'
  | 'inventory'
  | 'reviews'

export interface ActivityLog {
  id: string
  adminId: string
  adminName: string
  action: string
  module: ActivityModule
  details?: string
  createdAt: string
}

// ===== Transaction =====
export type TransactionType = 'payment' | 'refund'
export type PaymentMethod = 'cod' | 'upi' | 'card' | 'netbanking' | 'wallet' | 'unknown'
export type TransactionStatus = 'success' | 'pending' | 'failed' | 'refunded' | 'captured' | 'collected' | 'hash_mismatch'

export interface Transaction {
  id: string
  orderId: string
  orderNumber: string
  customerId: string
  customerName: string
  type: TransactionType
  method: PaymentMethod
  amount: number
  status: TransactionStatus
  gatewayRef?: string
  createdAt: string
}

// ===== Analytics =====
export interface RevenueDataPoint {
  date: string
  revenue: number
  orders: number
}

export interface ProductAnalytics {
  productId: string
  productName: string
  sales: number
  revenue: number
}

export interface CategoryAnalytics {
  categoryName: string
  sales: number
  percentage: number
}

export interface AnalyticsSummary {
  totalRevenue: number
  totalOrders: number
  totalCustomers: number
  conversionRate: number
  revenueGrowth: number
  ordersGrowth: number
  customersGrowth: number
  revenueChart: RevenueDataPoint[]
  topProducts: ProductAnalytics[]
  topCategories: CategoryAnalytics[]
}

// ===== Dashboard =====
export interface DashboardStats {
  totalRevenue: number
  shippingCollected?: number
  gstCollected?: number
  todayRevenue: number
  monthlyRevenue: number
  totalOrders: number
  pendingOrders: number
  deliveredOrders: number
  cancelledOrders: number
  totalCustomers: number
  totalProducts: number
  lowStock: number
  outOfStock: number
  revenueChart: RevenueDataPoint[]
  salesChart: { month: string; sales: number }[]
  ordersGraph: { day: string; orders: number }[]
}

// ===== Settings =====
export interface StoreSettings {
  storeName: string
  storeEmail: string
  storePhone: string
  storeAddress: string
  storeWebsite?: string
  currency: string
  timezone: string
  taxRate: number
  shippingCharge: number
  freeShippingAbove: number
  maintenanceMode: boolean
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPassword?: string
  cloudinaryCloudName?: string
  cloudinaryApiKey?: string
  razorpayKeyId?: string
  googleAnalyticsId?: string
  facebookPixelId?: string
  socialLinks: {
    facebook?: string
    instagram?: string
    twitter?: string
    youtube?: string
    linkedin?: string
  }
}


// ===== Inventory =====
export interface InventoryItem {
  productId: string
  productName: string
  sku: string
  thumbnail: string
  currentStock: number
  minimumStock: number
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock'
  lastRestocked?: string
}

export interface StockMovement {
  id: string
  productId: string
  productName: string
  type: 'addition' | 'reduction' | 'adjustment'
  quantity: number
  previousStock: number
  newStock: number
  reason?: string
  adminId: string
  adminName: string
  createdAt: string
}

// ===== Media =====
export interface MediaFile {
  id: string
  name: string
  url: string
  thumbnailUrl?: string
  size: number
  mimeType: string
  folder?: string
  uploadedAt: string
}

export * from './product'
export * from './order'
export * from './customer'
export * from './auth'
