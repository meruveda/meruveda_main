import axios from 'axios';

/**
 * In the browser ALWAYS call the same-origin `/api` path — the platform
 * rewrite (vercel.json) or the Next dev rewrite forwards it to the backend.
 * An absolute NEXT_PUBLIC_API_URL baked in at build time turns every call
 * from www into a cross-origin request to the apex host, and with no CORS
 * headers the browser blocks it and axios reports a bare "Network Error".
 * The absolute URL is kept for SSR only (relative paths have no origin).
 */
const API_BASE_URL =
  typeof window === 'undefined' ? (process.env.NEXT_PUBLIC_API_URL || '/api') : '/api';

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  /**
   * The customer session (the profile created at the checkout contact step)
   * lives in an httpOnly cookie. In production the API is on the SAME origin
   * (the platform rewrite forwards /api/* to the backend), so the browser
   * attaches the cookie on its own. In local development the API is on
   * another port, and without this the cookie would never be sent - the
   * session would exist but every request would look like a visitor with no
   * session.
   */
  withCredentials: true,
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
    /**
     * "Is there a session?" is a question, not a failure.
     *
     * The storefront asks the backend on every page load whether this browser
     * has a customer session. A visitor without one gets a 401 with the code
     * NO_SESSION - and that must NOT be treated as an expired session: the
     * interceptor would wipe the (empty) session and RELOAD the page, which
     * is an endless reload loop.
     */
    if (code === 'NO_SESSION' || code === 'SESSION_EXPIRED') {
      return Promise.reject(error);
    }
    if (error.response && error.response.status === 401) {
      // A checkout-only GUEST session must never be wiped by a 401: the
      // visitor is not logged in and does not want to be, and reloading the
      // page would throw away the checkout they are in the middle of.
      if (isGuestToken()) {
        return Promise.reject(error);
      }
      const isAuthRequest = error.config && (
        error.config.url.includes('/auth/login') ||
        error.config.url.includes('/auth/register') ||
        error.config.url.includes('/auth/forgot-password') ||
        error.config.url.includes('/account/session')
      );
      if (!isAuthRequest && typeof window !== 'undefined') {
        localStorage.removeItem('meruveda_auth_token');
        localStorage.removeItem('meruveda_user');
        document.cookie = 'meruveda_auth_token=; path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax';
        document.cookie = 'mv_customer_session=; path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax';
        window.location.reload();
        // Return a pending promise to prevent unhandled rejection/errors during page reload
        return new Promise(() => {});
      }
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;
