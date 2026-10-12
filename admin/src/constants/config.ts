// ==========================================
// Application Configuration Constants
// ==========================================

/** Customer website URL — set VITE_CUSTOMER_WEBSITE_URL env var in production */
export const CUSTOMER_WEBSITE_URL = import.meta.env.VITE_CUSTOMER_WEBSITE_URL || '/'

/** Admin app base path */
export const ADMIN_BASE_PATH = '/admin'

/** API base URL — switch to real backend URL when ready */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

/** App metadata */
export const APP_NAME = 'MeruVeda Admin'
export const APP_VERSION = '1.0.0'

/** Pagination defaults */
export const DEFAULT_PAGE_SIZE = 10
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

/** Upload limits */
export const MAX_FILE_SIZE_MB = 5
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/** Currency */
export const CURRENCY_SYMBOL = '₹'
export const CURRENCY_CODE = 'INR'

/** Date format */
export const DATE_FORMAT = 'dd MMM yyyy'
export const DATETIME_FORMAT = 'dd MMM yyyy, hh:mm a'
