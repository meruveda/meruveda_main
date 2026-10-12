import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

axiosInstance.interceptors.request.use(
  (config) => {
    // Need to handle both client side (localStorage) and SSR
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('meruveda_auth_token');
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      const isAuthRequest = error.config && (
        error.config.url.includes('/auth/login') ||
        error.config.url.includes('/auth/register') ||
        error.config.url.includes('/auth/forgot-password')
      );
      if (!isAuthRequest && typeof window !== 'undefined') {
        localStorage.removeItem('meruveda_auth_token');
        localStorage.removeItem('meruveda_user');
        document.cookie = 'meruveda_auth_token=; path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax';
        window.location.reload();
        // Return a pending promise to prevent unhandled rejection/errors during page reload
        return new Promise(() => {});
      }
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;
