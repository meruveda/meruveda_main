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
      if (!isAuthRequest) {
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
