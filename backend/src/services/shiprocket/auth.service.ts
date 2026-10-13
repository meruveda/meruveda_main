import { SHIPROCKET_BASE_URL, ENDPOINTS } from './constants';
import { ShiprocketLoginResponse } from './types';
import { kv } from '../kv';

// Shiprocket JWT cache.
//
// Fast path: a per-process memo avoids a Redis round-trip on every request
// while an instance is warm. Slow path: Upstash KV (when configured) shares
// the token across Vercel serverless instances so cold starts don't each
// trigger a fresh Shiprocket login. Without Upstash, each cold start logs in
// once — functionally correct, just an extra round-trip.
const KV_KEY = 'shiprocket:token';
const TOKEN_TTL_MS = 10 * 24 * 60 * 60 * 1000; // cached ~10 days
const BUFFER_MS = 5 * 60 * 1000; // re-login 5 min before recorded expiry

let memo: { token: string; exp: number } | null = null;

interface CachedToken { token: string; exp: number }

export const shiprocketAuth = {
  async login(): Promise<string> {
    if (memo && Date.now() < memo.exp - BUFFER_MS) {
      return memo.token;
    }

    try {
      const stored = await kv.get(KV_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as CachedToken;
        if (parsed?.token && Date.now() < parsed.exp - BUFFER_MS) {
          memo = parsed;
          return parsed.token;
        }
      }
    } catch {
      // KV unavailable — fall through to a fresh login.
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

      memo = { token: data.token, exp: Date.now() + TOKEN_TTL_MS };
      try {
        await kv.set(KV_KEY, JSON.stringify(memo), TOKEN_TTL_MS);
      } catch (kvErr: any) {
        console.warn('[ShiprocketAuth] KV cache write failed:', kvErr?.message || kvErr);
      }

      return memo.token;
    } catch (error) {
      console.error('Shiprocket Login Error:', error);
      throw error;
    }
  },
  
  clearToken() {
    memo = null;
    kv.del(KV_KEY).catch(() => { /* best-effort */ });
  }
};
