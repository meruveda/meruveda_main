"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService, AuthUser, SignupData } from '@/services/authService';

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
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
  const [isLoading, setIsLoading] = useState(true);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);

  // Restore session on mount
  useEffect(() => {
    const restored = authService.getCurrentUser();
    if (restored) {
      setUser(restored);
    }
    setIsLoading(false);
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
        isAuthenticated: !!user,
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
