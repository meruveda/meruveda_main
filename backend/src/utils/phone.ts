/**
 * Mobile-number helpers for password authentication.
 *
 * Indian mobile numbers reach the `users.phone` column in several legacy
 * formats (`9876543210`, `919876543210`, `+919876543210`, `+91 98765 43210`)
 * depending on which flow created the account (password signup, WhatsApp OTP,
 * checkout profile). All auth lookups funnel through here so login works no
 * matter which variant is stored, while every NEW write uses one canonical
 * digits-only form (`91XXXXXXXXXX`, matching whatsappService.normalizePhone).
 *
 * Numbers from other countries are stored as `+<country code><national>` and
 * are matched through the shared country list.
 */
import {
  canonicalPhoneAny as sharedCanonicalPhoneAny,
  detectCountryFromPaste,
  isValidPhoneAny as sharedIsValidPhoneAny,
} from '@meruveda/shared';

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

/**
 * Validation for any country.
 *
 * An Indian number must still start with 6-9; a number from another country
 * must have the exact national length for that country. Returns the canonical
 * stored form, or '' when the input is not a usable phone number.
 *
 * The rule itself lives in @meruveda/shared, so the storefront and the API
 * always agree on what a valid number is.
 */
export const canonicalPhoneAny = sharedCanonicalPhoneAny;

/** True when the value is a usable phone number from any supported country. */
export const isValidPhoneAny = sharedIsValidPhoneAny;

/** Canonical stored form for new writes: digits-only `91XXXXXXXXXX`. */
export const canonicalPhone = (raw?: string | null): string => {
  const d = normalizePhone10(raw);
  return d ? `91${d}` : '';
};

/**
 * Every legacy `users.phone` spelling a 10-digit number may be stored under,
 * so a login-time `.in('phone', variants)` matches all of them.
 *
 * Non-Indian numbers are included too: they are stored as `+<code><national>`,
 * and every plausible spelling of that is matched as well, so a customer who
 * signed up from the UAE can still sign in from India.
 */
export const phoneVariants = (raw?: string | null): string[] => {
  const value = String(raw || '').trim();
  if (!value) return [];

  const variants = new Set<string>();
  const add = (v: string) => {
    if (v) variants.add(v);
  };

  // An explicit international number.
  if (value.startsWith('+')) {
    const digits = value.replace(/\D/g, '');
    add(value);
    add(digits);
    const detected = detectCountryFromPaste(value);
    if (detected) {
      add(detected.national);
      add(`+${detected.country.dial.replace(/\D/g, '')}${detected.national}`);
    }
    return [...variants];
  }

  const detected = detectCountryFromPaste(value);
  if (detected) {
    const { country, national } = detected;
    const cd = country.dial.replace(/\D/g, '');
    add(national);
    add(`${cd}${national}`);
    add(`+${cd}${national}`);
    add(country.format ? country.format(national) : national);
    if (country.iso === 'in') {
      // The historic spellings of an Indian number, all of which are still in
      // the users table.
      add(`+91 ${national.slice(0, 5)} ${national.slice(5)}`);
      add(`+91-${national}`);
      add(`0${national}`);
    }
    return [...variants];
  }

  // Unrecognised: fall back to the raw digit forms so an unusual stored
  // value is still matched exactly.
  const d = normalizePhone10(value);
  if (d) {
    add(d);
    add(`91${d}`);
    add(`+91${d}`);
    add(`+91 ${d.slice(0, 5)} ${d.slice(5)}`);
    add(`+91-${d}`);
    add(`0${d}`);
  }
  return [...variants];
};

export const isValidEmail = (raw?: string | null): boolean => {
  if (!raw) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(raw).trim());
};

/**
 * Classify a free-form login identifier.
 *
 * Returns `{ kind: 'phone', phone }` when the input is a usable phone number
 * from any supported country, and `{ kind: 'email', email }` otherwise. The
 * phone branch keeps the value as the customer typed it (minus formatting),
 * because `phoneVariants` needs the country information in it.
 */
export const classifyIdentifier = (
  raw?: string | null
): { kind: 'phone'; phone: string } | { kind: 'email'; email: string } => {
  const value = String(raw || '').trim();
  if (isValidPhoneAny(value)) return { kind: 'phone', phone: value };
  return { kind: 'email', email: value };
};
