"use client";

import { useEffect } from "react";

// Startup cleanup: earlier builds kept a saved-card "vault" in localStorage
// under `meruveda_cards` (older variant held a full PAN) and
// `meruveda_cards_v2` (name, expiry, last4). The feature has been removed —
// this wipes any leftover vault keys so stored card data leaves users'
// browsers the first time the app loads after updating. Idempotent.
const VAULT_KEY = /^meruveda_.*(card|vault)/i; // "card" ≠ shopping "cart"

export default function CardVaultCleanup() {
  useEffect(() => {
    try {
      Object.keys(localStorage)
        .filter((key) => VAULT_KEY.test(key))
        .forEach((key) => localStorage.removeItem(key));
    } catch {
      // storage unavailable (private mode / disabled cookies) — nothing to clean
    }
  }, []);

  return null;
}
