"use client";

/**
 * The store's public configuration, for the client components.
 *
 * The value is read ONCE on the server (the root layout) and handed down, so
 * the header, the footer and the menus know from the very first paint
 * whether the account pages exist - no flash of a "Login" link that is
 * switched off, and no request from the browser.
 *
 * There is no hardcoded flag here: the value comes from the backend's public
 * GET /api/auth/otp/config, exactly like `otpRequired`.
 */

import { createContext, useContext } from "react";

export interface StoreConfigValue {
  /** Are /login, /signup and /account/* switched on? */
  accountPages: boolean;
}

const StoreConfigContext = createContext<StoreConfigValue>({ accountPages: false });

export function StoreConfigProvider({
  accountPages,
  children,
}: StoreConfigValue & { children: React.ReactNode }) {
  return (
    <StoreConfigContext.Provider value={{ accountPages }}>{children}</StoreConfigContext.Provider>
  );
}

export function useStoreConfig(): StoreConfigValue {
  return useContext(StoreConfigContext);
}

/**
 * Are the account pages switched on?
 *
 * A component that shows an account link uses this, so the link disappears
 * together with the page it points at.
 */
export function useAccountPages(): boolean {
  return useContext(StoreConfigContext).accountPages;
}
