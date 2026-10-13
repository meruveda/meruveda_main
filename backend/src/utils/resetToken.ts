import crypto from 'crypto';

/**
 * Password-reset token helpers.
 *
 * The raw token only ever exists in the customer's inbox and in the email link.
 * What lands in the database is its SHA-256 hash, so a leaked users table (or a
 * stolen service-role key) does not hand out working reset links — the hash
 * cannot be reversed into the token the reset endpoint expects.
 *
 * The token itself is 32 bytes from crypto.randomBytes (256 bits of entropy),
 * compared/stored as hex. Lookups therefore never depend on string equality of
 * a secret, and the stored value is not a usable credential.
 */

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Fresh 32-byte token, hex encoded (64 chars). Sent to the user once. */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** SHA-256 hex digest — what we persist in users.reset_password_token. */
export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Absolute link the customer clicks, built from the configured frontend URL. */
export function buildResetLink(frontendUrl: string, token: string): string {
  const base = (frontendUrl || '').replace(/\/+$/, '');
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}