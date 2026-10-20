import axiosInstance from '../api/axiosInstance';

export type UserRole = 'customer' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  avatar?: string;
  phone?: string;
  /** Saved by PUT /auth/profile during checkout; carries the address book. */
  address?: any;
  /**
   * 'guest' = a checkout-only session. It may place an order and read that
   * order; it may not read the account history, the addresses or the
   * profile.
   */
  scope?: 'guest' | 'full';
  /** False when the number was never proven (a guest checkout). */
  phone_verified?: boolean;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
  role: UserRole;
}

export interface SignupData {
  phone: string;
  password: string;
  firstName: string;
  lastName: string;
  email?: string;
}

const TOKEN_KEY = 'meruveda_auth_token';
const USER_KEY = 'meruveda_user';

function persistSession(token: string, user: AuthUser, rememberMe = true) {
  const storage = rememberMe ? localStorage : sessionStorage;
  storage.setItem(TOKEN_KEY, token);
  storage.setItem(USER_KEY, JSON.stringify(user));

  // Always keep in localStorage for consistency across tabs
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));

  if (typeof window !== 'undefined') {
    const maxAge = rememberMe ? 30 * 24 * 60 * 60 : '';
    document.cookie = `${TOKEN_KEY}=${token}; path=/; SameSite=Lax${maxAge ? `; max-age=${maxAge}` : ''}`;
  }
}

function unwrapError(error: any): never {
  if (error?.response?.data?.error?.message) throw new Error(error.response.data.error.message);
  if (error?.response?.data?.message) throw new Error(error.response.data.message);
  throw error;
}

export const authService = {
  /**
   * Mobile-first login. `identifier` is the 10-digit mobile number (primary)
   * or, for legacy accounts, the email address. The backend auto-detects the
   * kind — the payload key is only a hint.
   */
  login: async (identifier: string, password: string, rememberMe = false): Promise<AuthResponse> => {
    try {
      const response = await axiosInstance.post('/auth/login', { identifier, password });
      const { token, user } = response.data;

      const storage = rememberMe ? localStorage : sessionStorage;
      storage.setItem(TOKEN_KEY, token);
      storage.setItem(USER_KEY, JSON.stringify(user));
      
      // Always keep in localStorage for consistency across tabs
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));

      if (typeof window !== 'undefined') {
        const maxAge = rememberMe ? 30 * 24 * 60 * 60 : ''; 
        document.cookie = `${TOKEN_KEY}=${token}; path=/; SameSite=Lax${maxAge ? `; max-age=${maxAge}` : ''}`;
      }

      return { user, token, role: user.role };
    } catch (error: any) {
      if (error.response?.data?.error?.message) {
        throw new Error(error.response.data.error.message);
      }
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      }
      throw error;
    }
  },

  signup: async (data: SignupData): Promise<AuthResponse> => {
    try {
      const response = await axiosInstance.post('/auth/register', data);
      const { token, user } = response.data;

      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));

      if (typeof window !== 'undefined') {
        document.cookie = `${TOKEN_KEY}=${token}; path=/; SameSite=Lax`;
      }

      return { user, token, role: user.role };
    } catch (error: any) {
      if (error.response?.data?.error?.message) {
        throw new Error(error.response.data.error.message);
      }
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      }
      throw error;
    }
  },

  /**
   * Password recovery for mobile-first accounts. The reset link is delivered
   * to the account's registered email address (kept as the secure recovery
   * channel) — see the forgot-password page copy. Never reveals whether the
   * identifier has an account; the backend always replies success.
   */
  forgotPassword: async (identifier: string): Promise<void> => {
    try {
      await axiosInstance.post('/auth/forgot-password', { identifier });
    } catch (error: any) {
      unwrapError(error);
    }
  },

  // ---------------- WhatsApp OTP (used by the checkout form) ----------------

  /** Request an OTP for a mobile number. */
  sendOtp: async (phone: string): Promise<{ expiresInSeconds: number; devOtp?: string }> => {
    try {
      const response = await axiosInstance.post('/auth/otp/send', { phone });
      return response.data;
    } catch (error: any) {
      unwrapError(error);
    }
  },

  /** Alias kept so resend failures surface the same way as send failures. */
  resendOtp: async (phone: string): Promise<{ expiresInSeconds: number; devOtp?: string }> => {
    try {
      const response = await axiosInstance.post('/auth/otp/resend', { phone });
      return response.data;
    } catch (error: any) {
      unwrapError(error);
    }
  },

  /**
   * Verify the OTP. On success the backend auto-registers an unknown number or
   * logs an existing customer in — both return a JWT which is persisted here.
   */
  verifyOtp: async (phone: string, code: string, name?: string): Promise<AuthResponse> => {
    try {
      const response = await axiosInstance.post('/auth/otp/verify', { phone, code, name });
      const { token, user } = response.data;
      persistSession(token, user, true);
      return { user, token, role: user.role };
    } catch (error: any) {
      unwrapError(error);
    }
  },

  /**
   * No-OTP checkout sign-up / login. Backend logs the number in if it already
   * exists, otherwise auto-creates the customer. The session it returns is
   * marked phone_verified=false until a real OTP verification flips the flag.
   */
  quickLogin: async (phone: string, name: string): Promise<AuthResponse> => {
    try {
      const response = await axiosInstance.post('/auth/quick-login', { phone, name });
      const { token, user } = response.data;
      persistSession(token, user, true);
      return { user, token, role: user.role };
    } catch (error: any) {
      unwrapError(error);
    }
  },

  /**
   * Guest checkout: a name and a number, no OTP.
   *
   * Used while WhatsApp phone verification is unavailable. The session it
   * returns is a checkout-only guest session: it may place an order and read
   * that order, and it can never read an existing account's data.
   */
  guestCheckout: async (
    name: string,
    phone: string,
    extra?: { website?: string; renderedAt?: number },
  ): Promise<AuthResponse> => {
    try {
      const response = await axiosInstance.post('/auth/guest', { name, phone, ...extra });
      const { token, user } = response.data;
      persistSession(token, user, true);
      return { user, token, role: user.role };
    } catch (error: any) {
      unwrapError(error);
    }
  },

  /**
   * Whether the checkout asks for an OTP.
   *
   * 'off' means the store is taking guest checkouts (name + number) while a
   * WhatsApp template is reviewed. The answer comes from the server, so
   * switching OTP_MODE back to 'auto' restores the OTP flow with no rebuild.
   */
  getOtpStatus: async (): Promise<{
    mode: 'auto' | 'on' | 'off';
    required: boolean;
    guestCheckout: boolean;
    templateAvailable: boolean;
    templateName: string | null;
    reason: string | null;
  }> => {
    try {
      const response = await axiosInstance.get('/auth/otp/status');
      const d = response.data?.data || {};
      return {
        mode: d.mode || 'auto',
        required: Boolean(d.required),
        guestCheckout: Boolean(d.guestCheckout),
        templateAvailable: Boolean(d.templateAvailable),
        templateName: d.templateName || null,
        reason: d.reason || null,
      };
    } catch {
      // If the status cannot be read, keep the OTP flow: it is the safe
      // default, and the customer can still check out.
      return {
        mode: 'auto',
        required: true,
        guestCheckout: false,
        templateAvailable: false,
        templateName: null,
        reason: null,
      };
    }
  },

  /**
   * What the checkout needs before it renders.
   *
   * Read at request time from a never-cached public endpoint, so a
   * store-wide switch (OTP_MODE=off while a WhatsApp template is reviewed)
   * takes effect on the next page load - no rebuild, no hardcoded env var.
   */
  getOtpConfig: async (): Promise<{
    otpRequired: boolean;
    mode: 'auto' | 'on' | 'off';
    guestCheckout: boolean;
    message: string | null;
  }> => {
    try {
      const response = await axiosInstance.get('/auth/otp/config');
      const d = response.data?.data || {};
      return {
        otpRequired: d.otpRequired !== false,
        mode: d.mode || 'auto',
        guestCheckout: Boolean(d.guestCheckout),
        message: d.message || null,
      };
    } catch {
      // If the config cannot be read, keep the OTP flow: it is the safe
      // default, and the customer can still check out.
      return { otpRequired: true, mode: 'auto', guestCheckout: false, message: null };
    }
  },

  /** Persist the name / email / address collected in the checkout form. */
  saveProfile: async (payload: {
    name?: string;
    email?: string;
    address?: any;
    phone?: string;
  }): Promise<void> => {
    try {
      const response = await axiosInstance.put('/auth/profile', payload);
      const user = response.data?.user;
      if (user && typeof window !== 'undefined') {
        const existing = localStorage.getItem(USER_KEY);
        const parsed = existing ? JSON.parse(existing) : {};
        localStorage.setItem(
          USER_KEY,
          JSON.stringify({ ...parsed, ...user, firstName: user.firstName ?? parsed.firstName, lastName: user.lastName ?? parsed.lastName })
        );
      }
    } catch (error: any) {
      unwrapError(error);
    }
  },
  resetPassword: async (token: string, newPassword: string): Promise<void> => {
    try {
      await axiosInstance.post('/auth/reset-password', { token, newPassword });
    } catch (error: any) {
      if (error.response?.data?.error?.message) {
        throw new Error(error.response.data.error.message);
      }
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      }
      throw error;
    }
  },

  getCurrentUser: (): AuthUser | null => {
    try {
      if (typeof window === 'undefined') return null;
      const token = localStorage.getItem(TOKEN_KEY);
      const userData = localStorage.getItem(USER_KEY);
      if (!token || !userData) return null;
      return JSON.parse(userData) as AuthUser;
    } catch {
      return null;
    }
  },

  getToken: (): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  },

  logout: (): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    document.cookie = `${TOKEN_KEY}=; path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax`;
  },

  hasRole: (role: UserRole): boolean => {
    const user = authService.getCurrentUser();
    return user?.role === role;
  },
};
