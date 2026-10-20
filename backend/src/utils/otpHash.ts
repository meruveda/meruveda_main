import crypto from 'crypto';
import { config } from '../config/env';

/**
 * OTP storage hashing.
 *
 * An OTP is a six-digit shared secret that authorises a full account login, so
 * the table must never hold it in a form that a database dump, a stray
 * `SELECT`, a database export or a leaked credential turns
 * straight into a working login.
 *
 * HMAC-SHA256(code, key = pepper) is used rather than a bare SHA-256 because a
 * six-digit code has only 10^6 possible values: a plain digest is trivially
 * reversible by brute force in under a second, and every stored hash would then
 * be rainbow-table-able across accounts. The pepper is a server-side secret
 * that never reaches the database, so a dump alone yields nothing.
 *
 * The phone number is folded into the message so one code cannot be replayed
 * against a different number's row.
 *
 * Verification is constant-time. `===` on a string leaks length and the first
 * differing byte through timing, which turns a 10^6 search space into an
 * average of 10^5 probes.
 */

const DIGEST = 'hex' as const;
const HASH_LENGTH = 64; // sha256 hex chars

function pepper(): string {
  return config.otpHashPepper || 'meruveda-otp-dev-pepper';
}

/** Deterministic hash of a code bound to the phone it was issued for. */
export function hashOtpCode(code: string, phone: string): string {
  const message = `${String(phone).trim()}:${String(code).trim()}`;
  return crypto.createHmac('sha256', pepper()).update(message).digest(DIGEST);
}

/**
 * Constant-time comparison of a submitted code against a stored digest.
 * Returns false for any malformed stored value rather than throwing, so a
 * corrupt row can never authenticate.
 */
export function verifyOtpCode(submitted: string, phone: string, storedHash: unknown): boolean {
  if (typeof storedHash !== 'string' || storedHash.length !== HASH_LENGTH) return false;
  const candidate = Buffer.from(hashOtpCode(submitted, phone), DIGEST);
  const stored = Buffer.from(storedHash, DIGEST);
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

/**
 * True when the deployment has no pepper configured. Hashing still works (it
 * falls back to a fixed development value) but the digests are then only as
 * strong as a value published in the source tree, so the OTP store must be
 * treated as compromised. Used by the env validator to warn at boot.
 */
export function isOtpPepperConfigured(): boolean {
  return Boolean(config.otpHashPepper);
}