import crypto from 'crypto';

/**
 * Constant-time string comparison for secrets (webhook tokens, cron secrets,
 * PayU hashes). Plain `===` short-circuits on the first differing byte, which
 * leaks a timing oracle to an attacker probing the value byte by byte.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  // timingSafeEqual throws on length mismatch — hash both sides to a fixed
  // length first so length itself is not leaked.
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB) && bufA.length === bufB.length;
}
