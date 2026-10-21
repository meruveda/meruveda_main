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
        // A checkout-only GUEST token is sent to the checkout, the order and
        // the payment endpoints ONLY. The cart, the wishlist and the account
        // endpoints refuse it, and calling them with it would make every
        // add-to-cart fail.
        if (!isGuestToken() || guestTokenAllowed(config.url || '')) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/** True when the stored session is a checkout-only guest session. */
function isGuestToken(): boolean {
  try {
    const raw = localStorage.getItem('meruveda_user');
    if (!raw) return false;
    const user = JSON.parse(raw);
    return user?.scope === 'guest';
  } catch {
    return false;
  }
}

/**
 * The endpoints a guest token may be sent to.
 *
 * Creating the order, starting the payment, checking serviceability and
 * saving the checkout profile. Nothing else.
 */
const GUEST_TOKEN_PATHS = [
  '/orders',
  '/payu',
  '/shiprocket/serviceability',
  '/auth/profile',
  '/auth/otp',
  '/auth/guest',
];

function guestTokenAllowed(url: string): boolean {
  const path = url.split('?')[0];
  return GUEST_TOKEN_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    // A guest token hitting an account-only endpoint is EXPECTED, not a
    // session problem: it must not log the visitor out, reload the page or
    // raise an alert. The storefront simply keeps using the local cart.
    const code = error?.response?.data?.code || error?.response?.data?.error?.code;
    if (code === 'GUEST_SCOPE') {
      return Promise.reject(error);
    }
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
