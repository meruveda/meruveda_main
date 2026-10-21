import axios from 'axios'
import { API_BASE_URL } from '../constants/config'

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor to attach bearer token
axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('admin_token')
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      const isAuthRequest = error.config && (
        error.config.url.includes('/auth/login') ||
        error.config.url.includes('/auth/register')
      );

      // A GUEST_SCOPE 401 means the session is a checkout-only guest token,
      // not an admin session. The admin app has no business with one, so it
      // says so plainly and goes to the admin login - instead of silently
      // wiping the stored session and leaving the operator staring at a blank
      // page with no explanation.
      const code = error.response.data?.code || error.response.data?.error?.code
      if (code === 'GUEST_SCOPE') {
        localStorage.removeItem('admin_token')
        localStorage.removeItem('admin_user')
        const message = 'Admin login required.'
        try {
          sessionStorage.setItem('meruveda_admin_notice', message)
        } catch {
          /* storage unavailable */
        }
        window.location.href = '/admin/login'
        return new Promise(() => {})
      }

      if (!isAuthRequest) {
        // A normal expired or invalid admin token: the session is wiped and
        // the operator is sent to the admin login.
        localStorage.removeItem('admin_token')
        localStorage.removeItem('admin_user')
        // The admin app is served under /admin (see BrowserRouter basename and
        // the Vite base) — a bare /login would send users to the storefront.
        window.location.href = '/admin/login'
        // Return a pending promise to prevent unhandled rejection/errors during redirect
        return new Promise(() => {})
      }
    }
    return Promise.reject(error)
  }
)

export default axiosInstance
