import { SHIPROCKET_BASE_URL, ENDPOINTS } from './constants';
import { ShiprocketLoginResponse } from './types';

// NOTE — Serverless cold-start limitation:
// These module-level variables cache the Shiprocket JWT token in memory.
// In a traditional always-on server this works well (token survives across requests).
// In a serverless environment (e.g. Vercel Functions), each cold start creates a new
// module instance, so the cache is lost and every cold-started request triggers a fresh
// login round-trip to Shiprocket.
// This is functionally correct but adds latency and could hit Shiprocket's login rate
// limits under high cold-start frequency. If that becomes an issue post-launch, replace
// these variables with a short-lived entry in a Supabase table (e.g. `shiprocket_tokens`)
// so the token persists across function instances.
let cachedToken: string | null = null;
let tokenExpiryTime: number | null = null;

export const shiprocketAuth = {
  async login(): Promise<string> {
    // If token exists and is valid (with a 5-minute buffer)
    if (cachedToken && tokenExpiryTime && Date.now() < tokenExpiryTime - 5 * 60 * 1000) {
      return cachedToken;
    }

    const email = process.env.SHIPROCKET_EMAIL;
    const password = process.env.SHIPROCKET_PASSWORD;

    if (!email || !password) {
      throw new Error('Shiprocket credentials are not configured in environment variables.');
    }

    try {
      const response = await fetch(`${SHIPROCKET_BASE_URL}${ENDPOINTS.LOGIN}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Shiprocket Auth Failed: ${err}`);
      }

      const data = (await response.json()) as ShiprocketLoginResponse;
      
      cachedToken = data.token;
      // Shiprocket tokens typically expire in 24 hours. We'll set expiry to 23 hours to be safe.
      tokenExpiryTime = Date.now() + 23 * 60 * 60 * 1000;

      return cachedToken;
    } catch (error) {
      console.error('Shiprocket Login Error:', error);
      throw error;
    }
  },
  
  clearToken() {
    cachedToken = null;
    tokenExpiryTime = null;
  }
};
