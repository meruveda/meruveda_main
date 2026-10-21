"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService, AuthUser, SignupData, CustomerProfile } from '@/services/authService';

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /**
   * True when the session is a checkout-only guest session: it may place an
   * order and read that order, and nothing else. It is NOT an account, so it
   * never counts as `isAuthenticated`.
   */
  isGuestSession: boolean;
  /**
   * The customer session created at the checkout contact step.
   *
   * This is what opens the profile area (/account, the order history, the
   * addresses). It exists as soon as the customer presses "Continue" at the
   * checkout - no password, no OTP.
   */
  customerSession: CustomerProfile | null;
  /** True when this browser has a customer session (a profile exists). */
  hasSession: boolean;
  /**
   * True when the session is the checkout-created customer session.
   *
   * The cart and the wishlist stay in localStorage for such a session: they
   * are personal to the browser, and the backend's cart and wishlist belong
   * to a real account.
   */
  isCustomerSession: boolean;
  /** Open (or re-open) the customer session - the checkout "Continue" button. */
  openSession: (
    name: string,
    phone: string,
    email: string,
    extra?: { website?: string; renderedAt?: number },
  ) => Promise<CustomerProfile>;
  /** Close the customer session. The orders stay in the database. */
  closeSession: () => Promise<void>;
  isLoading: boolean;
  /** URL to redirect to after a successful login */
  returnUrl: string | null;
  setReturnUrl: (url: string | null) => void;
  login: (identifier: string, password: string, rememberMe?: boolean) => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
  logout: () => void;
  forgotPassword: (identifier: string) => Promise<void>;
  /** Request a WhatsApp OTP for the checkout form. */
  sendOtp: (phone: string) => Promise<{ expiresInSeconds: number; devOtp?: string }>;
  resendOtp: (phone: string) => Promise<{ expiresInSeconds: number; devOtp?: string }>;
  /** Verify the OTP — registers or logs the customer in and restores the session. */
  verifyOtp: (phone: string, code: string, name?: string) => Promise<void>;
  /**
   * No-OTP checkout sign-up / login. Logs the number in when it already
   * exists, otherwise auto-creates the customer. Session is phone_verified=false
   * until a real OTP verification.
   */
  quickLogin: (phone: string, name: string) => Promise<void>;
  /**
   * Guest checkout: a name and a number, no OTP.
   *
   * Used while WhatsApp phone verification is unavailable. The session is
   * checkout-only: it may place an order and read that order.
   */
  guestCheckout: (
    name: string,
    phone: string,
    extra?: { website?: string; renderedAt?: number },
  ) => Promise<void>;
  /**
   * Whether the checkout asks for an OTP.
   *
   * 'off' means the store is taking guest checkouts (name + number). The
   * answer comes from the server, so switching OTP_MODE back to 'auto'
   * restores the OTP flow with no rebuild.
   */
  getOtpStatus: () => Promise<{
    mode: 'auto' | 'on' | 'off';
    required: boolean;
    guestCheckout: boolean;
    templateAvailable: boolean;
    templateName: string | null;
    reason: string | null;
  }>;
  /**
   * What the checkout needs before it renders: whether an OTP is required.
   *
   * Read at request time from a never-cached public endpoint, so a store-wide
   * switch takes effect on the next page load.
   */
  getOtpConfig: () => Promise<{
    otpRequired: boolean;
    mode: 'auto' | 'on' | 'off';
    guestCheckout: boolean;
    message: string | null;
  }>;
  /** Persist name / email / address collected during checkout. */
  saveProfile: (payload: { name?: string; email?: string; address?: any; phone?: string }) => Promise<void>;
}

// ------------------------------------------------------------------
// Context
// ------------------------------------------------------------------

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ------------------------------------------------------------------
// Provider
// ------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  /**
   * True when the session is a checkout-only GUEST session.
   *
   * A guest session may place an order and read that order. It is NOT an
   * account: the cart, the wishlist, the order history, the address book and
   * the header must all treat it exactly like a logged-out visitor, or the
   * guest token hits endpoints that refuse it and the storefront breaks.
   */
  const isGuestSession = user?.scope === 'guest';
  /**
   * The customer session (the profile created at the checkout).
   *
   * It is restored on every page load by asking the backend, because the
   * session itself lives in an httpOnly cookie: the page cannot read it, it
   * can only ask "is there a session, and whose profile is it?".
   */
  const [customerSession, setCustomerSession] = useState<CustomerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);

  // Restore the session on mount
  useEffect(() => {
    const restored = authService.getCurrentUser();
    if (restored) {
      setUser(restored);
    }
    setIsLoading(false);
  }, []);

  /**
   * Ask the backend whether this browser has a customer session.
   *
   * It is asked once per page load, and the answer is what decides whether
   * the account icon is shown at all.
   */
  useEffect(() => {
    let cancelled = false;
    authService
      .getSession()
      .then((profile) => {
        if (!cancelled) setCustomerSession(profile);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Open the customer session - the checkout "Continue" button.
   *
   * The profile is created automatically when the number is new, and the
   * session sees only what this browser created.
   */
  const openSession = useCallback(
    async (name: string, phone: string, email: string, extra?: { website?: string; renderedAt?: number }) => {
      const { profile } = await authService.openSession(name, phone, email, extra);
      setCustomerSession(profile);
      const restored = authService.getCurrentUser();
      if (restored) setUser(restored);
      return profile;
    },
    [],
  );

  /** Close the session. The orders stay in the database. */
  const closeSession = useCallback(async () => {
    await authService.closeSession();
    setCustomerSession(null);
    setUser(null);
    setReturnUrl(null);
  }, []);

  const login = useCallback(async (identifier: string, password: string, rememberMe = false) => {
    const { user: loggedInUser } = await authService.login(identifier, password, rememberMe);
    setUser(loggedInUser);
  }, []);

  const signup = useCallback(async (data: SignupData) => {
    const { user: newUser } = await authService.signup(data);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    authService.logout();
    setUser(null);
    setReturnUrl(null);
  }, []);

  const forgotPassword = useCallback(async (identifier: string) => {
    await authService.forgotPassword(identifier);
  }, []);

  const sendOtp = useCallback(async (phone: string) => authService.sendOtp(phone), []);

  const resendOtp = useCallback(async (phone: string) => authService.resendOtp(phone), []);

  const verifyOtp = useCallback(async (phone: string, code: string, name?: string) => {
    const { user: verifiedUser } = await authService.verifyOtp(phone, code, name);
    setUser(verifiedUser);
  }, []);

  const quickLogin = useCallback(async (phone: string, name: string) => {
    const { user: quickUser } = await authService.quickLogin(phone, name);
    setUser(quickUser);
  }, []);

  const guestCheckout = useCallback(
    async (name: string, phone: string, extra?: { website?: string; renderedAt?: number }) => {
      const { user: guestUser } = await authService.guestCheckout(name, phone, extra);
      setUser(guestUser);
    },
    [],
  );

  const getOtpStatus = useCallback(() => authService.getOtpStatus(), []);

  const getOtpConfig = useCallback(() => authService.getOtpConfig(), []);

  const saveProfile = useCallback(async (payload: { name?: string; email?: string; address?: any; phone?: string }) => {
    await authService.saveProfile(payload);
    // Refresh the in-memory user so later steps see the saved details.
    const refreshed = authService.getCurrentUser();
    if (refreshed) setUser(refreshed);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        /**
         * A customer counts as signed in when there is a session: a full
         * login, or the profile created at the checkout contact step.
         */
        isAuthenticated: !!user && !isGuestSession,
        isGuestSession,
        customerSession,
        hasSession: !!customerSession,
        isCustomerSession: user?.scope === 'customer',
        openSession,
        closeSession,
        isLoading,
        returnUrl,
        setReturnUrl,
        login,
        signup,
        logout,
        forgotPassword,
        sendOtp,
        resendOtp,
        verifyOtp,
        quickLogin,
        guestCheckout,
        getOtpStatus,
        getOtpConfig,
        saveProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ------------------------------------------------------------------
// Hook
// ------------------------------------------------------------------

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
