export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned'
  | 'refunded'

export interface OrderItem {
  id: string
  productId: string
  productName: string
  thumbnail: string
  sku: string
  quantity: number
  mrp: number
  price: number
  discount: number
  hsn?: string
  gst?: number
}

export interface ShippingAddress {
  fullName: string
  phone: string
  addressLine1: string
  addressLine2?: string
  city: string
  state: string
  pincode: string
  country: string
}

export interface Order {
  id: string
  orderNumber: string
  customerId: string
  customerName: string
  customerEmail: string
  customerPhone: string
  items: OrderItem[]
  shippingAddress: ShippingAddress
  billingAddress?: ShippingAddress | null
  subtotal: number
  shippingCharge: number
  discount: number
  tax: number
  total: number
  paymentMethod: string
  paymentStatus: 'paid' | 'pending' | 'failed' | 'refunded'
  paymentGatewayRef?: string
  status: OrderStatus
  trackingNumber?: string
  shiprocketOrderId?: string
  shipmentId?: string
  awbCode?: string
  courierName?: string
  trackingUrl?: string
  trackingStatus?: string
  pickupLocation?: string
  pickupStatus?: string | null
  shippingCost?: number
  manifestUrl?: string
  labelUrl?: string
  invoiceUrl?: string
  lastTrackingSync?: string
  notes?: string
  /** Delta 010 — null/undefined when that migration has not been applied yet. */
  invoiceSentAt?: string | null
  invoiceError?: string | null
  invoiceStatus?: 'sent' | 'failed' | 'not_sent'
  /** Delta 010 — 'pushed' | 'failed' | 'in_progress' | null (never attempted). */
  shiprocketPushStatus?: string | null
  shiprocketPushError?: string | null
  shiprocketPushedAt?: string | null
  orderTrackingHistory?: Array<{ id: string; activity?: string; location?: string; created_at?: string }>
  createdAt: string
  updatedAt: string
}

export interface OrderFilters {
  search?: string
  status?: OrderStatus
  paymentMethod?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}

export interface OrderTimeline {
  status: OrderStatus
  timestamp: string
  note?: string
}
