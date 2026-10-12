export interface Customer {
  id: string
  name: string
  email: string
  phone?: string
  city?: string
  avatar?: string
  isActive: boolean
  isBlocked: boolean
  totalOrders: number
  lifetimeSpend: number
  lastLogin?: string
  createdAt: string
}

export interface CustomerAddress {
  id: string
  customerId: string
  fullName: string
  phone: string
  addressLine1: string
  addressLine2?: string
  city: string
  state: string
  pincode: string
  country: string
  isDefault: boolean
}

export interface CustomerFilters {
  search?: string
  isBlocked?: boolean
  page?: number
  limit?: number
}
