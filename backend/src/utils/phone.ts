/**
 * Mobile-number helpers for password authentication.
 *
 * Indian mobile numbers reach the `users.phone` column in several legacy
 * formats (`9876543210`, `919876543210`, `+919876543210`, `+91 98765 43210`)
 * depending on which flow created the account (password signup, WhatsApp OTP,
 * checkout profile). All auth lookups funnel through here so login works no
 * matter which variant is stored, while every NEW write uses one canonical
 * digits-only form (`91XXXXXXXXXX`, matching whatsappService.normalizePhone).
 */

export const PLACEHOLDER_EMAIL_DOMAIN = 'meruveda.whatsapp';

/** Placeholder identity kept for phone-only accounts (users.email is NOT NULL + UNIQUE). */
export const placeholderEmailFor = (canonicalPhone: string): string =>
  `${canonicalPhone}@${PLACEHOLDER_EMAIL_DOMAIN}`;

/** True for synthetic `@meruveda.whatsapp` identities — never a real inbox. */
export const isPlaceholderEmail = (email?: string | null): boolean => {
  if (!email) return true;
  return String(email).trim().toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
};

/** Strip to the 10-digit national number, or '' when the input isn't Indian-mobile-shaped. */
export const normalizePhone10 = (raw?: string | null): string => {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
};

/** Indian mobile validation: 10 digits starting with 6-9. */
export const isValidPhone10 = (raw?: string | null): boolean => {
  const d = normalizePhone10(raw);
  return /^[6-9]\d{9}$/.test(d);
};

/** Canonical stored form for new writes: digits-only `91XXXXXXXXXX`. */
export const canonicalPhone = (raw?: string | null): string => {
  const d = normalizePhone10(raw);
  return d ? `91${d}` : '';
};

/**
 * Every legacy `users.phone` spelling a 10-digit number may be stored under,
 * so a login-time `.in('phone', variants)` matches all of them.
 */
export const phoneVariants = (raw?: string | null): string[] => {
  const d = normalizePhone10(raw);
  if (!d) return [];
  const spaced = `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  const variants = new Set([
    d,
    `91${d}`,
    `+91${d}`,
    `+91 ${d}`,
    `+91-${d}`,
    spaced,
    `0${d}`,
  ]);
  return [...variants];
};

export const isValidEmail = (raw?: string | null): boolean => {
  if (!raw) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(raw).trim());
};

/**
 * Classify a free-form login identifier.
 * Returns `{ kind: 'phone', phone10 }` for mobile input, `{ kind: 'email', email }` otherwise.
 */
export const classifyIdentifier = (
  raw?: string | null
): { kind: 'phone'; phone10: string } | { kind: 'email'; email: string } => {
  const value = String(raw || '').trim();
  if (isValidPhone10(value)) return { kind: 'phone', phone10: normalizePhone10(value) };
  return { kind: 'email', email: value };
};
