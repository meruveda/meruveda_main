export const ROUTES = {
  // Auth
  LOGIN: '/login',

  // Main
  DASHBOARD: '/dashboard',

  // Catalog
  PRODUCTS: '/products',
  PRODUCTS_ADD: '/products/add',
  PRODUCTS_EDIT: '/products/:id/edit',
  PRODUCTS_VIEW: '/products/:id',

  CATEGORIES: '/categories',

  INVENTORY: '/inventory',

  // Commerce
  ORDERS: '/orders',
  ORDERS_DETAIL: '/orders/:id',

  CUSTOMERS: '/customers',
  CUSTOMERS_PROFILE: '/customers/:id',

  REVIEWS: '/reviews',
  COUPONS: '/coupons',

  // Content
  MEDIA: '/media',
  JOURNAL: '/journal',
  JOURNAL_ADD: '/journal/add',
  JOURNAL_EDIT: '/journal/:id/edit',
  BANNERS: '/banners',

  // Reporting
  ANALYTICS: '/analytics',
  TRANSACTIONS: '/transactions',

  // Operations
  NOTIFICATIONS: '/notifications',
  SUPPORT: '/support',
  ADMINS: '/users',
  SETTINGS: '/settings',
  ACTIVITY: '/activity',
} as const

/** Helper to build dynamic routes */
export const buildRoute = (route: string, params: Record<string, string>) => {
  let result = route
  Object.entries(params).forEach(([key, value]) => {
    result = result.replace(`:${key}`, value)
  })
  return result
}
