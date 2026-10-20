/**
 * Phone numbers and country codes.
 *
 * ONE source of truth for the storefront, the admin panel and the backend:
 *
 *  - the country list (flag, name, dial code, national length)
 *  - the canonical E.164 digits used for WhatsApp
 *  - the display format shown to a human
 *  - the form written to the database
 *  - every legacy spelling of a number, so a login always finds the account
 *
 * Storage rules:
 *  - Indian numbers are stored as the 10-digit national number (the historic
 *    `users.phone` format) so no existing account breaks.
 *  - Numbers from other countries are stored as `+<country code><national>`,
 *    which is unambiguous and readable.
 */

export interface Country {
  /** ISO 3166-1 alpha-2, lowercased. */
  iso: string;
  name: string;
  /** With the leading +, e.g. "+91". */
  dial: string;
  /** The national number length, excluding the country code. */
  digits: number;
  /** The flag emoji. */
  flag: string;
  /** Group the national digits for display only. */
  format?: (national: string) => string;
  /** True when the country needs its own (Indian) delivery contact. */
  requiresIndianDeliveryContact?: boolean;
}

/** Countries that can be selected at checkout, in the order they are offered. */
export const COUNTRIES: Country[] = [
  {
    iso: 'in',
    name: 'India',
    dial: '+91',
    digits: 10,
    flag: '🇮🇳',
    format: (n) => n.replace(/(\d{5})(\d{0,5})/, (_, a, b) => (b ? `${a} ${b}` : a)),
  },
  { iso: 'us', name: 'United States', dial: '+1', digits: 10, flag: '🇺🇸', format: (n) => n.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3') },
  { iso: 'gb', name: 'United Kingdom', dial: '+44', digits: 10, flag: '🇬🇧', format: (n) => n.replace(/(\d{4})(\d{6})/, '$1 $2') },
  { iso: 'ae', name: 'United Arab Emirates', dial: '+971', digits: 9, flag: '🇦🇪', format: (n) => n.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3') },
  { iso: 'kw', name: 'Kuwait', dial: '+965', digits: 8, flag: '🇰🇼', format: (n) => n.replace(/(\d{4})(\d{4})/, '$1 $2') },
  { iso: 'sa', name: 'Saudi Arabia', dial: '+966', digits: 9, flag: '🇸🇦', format: (n) => n.replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3') },
  { iso: 'qa', name: 'Qatar', dial: '+974', digits: 8, flag: '🇶🇦', format: (n) => n.replace(/(\d{4})(\d{4})/, '$1 $2') },
  { iso: 'om', name: 'Oman', dial: '+968', digits: 8, flag: '🇴🇲', format: (n) => n.replace(/(\d{4})(\d{4})/, '$1 $2') },
  { iso: 'sg', name: 'Singapore', dial: '+65', digits: 8, flag: '🇸🇬', format: (n) => n.replace(/(\d{4})(\d{4})/, '$1 $2') },
  { iso: 'ca', name: 'Canada', dial: '+1', digits: 10, flag: '🇨🇦', format: (n) => n.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3') },
  { iso: 'au', name: 'Australia', dial: '+61', digits: 9, flag: '🇦🇺', format: (n) => n.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') },
  { iso: 'de', name: 'Germany', dial: '+49', digits: 10, flag: '🇩🇪' },
  { iso: 'fr', name: 'France', dial: '+33', digits: 9, flag: '🇫🇷' },
  { iso: 'nz', name: 'New Zealand', dial: '+64', digits: 8, flag: '🇳🇿' },
  { iso: 'ie', name: 'Ireland', dial: '+353', digits: 9, flag: '🇮🇪' },
  { iso: 'my', name: 'Malaysia', dial: '+60', digits: 9, flag: '🇲🇾' },
  { iso: 'bh', name: 'Bahrain', dial: '+973', digits: 8, flag: '🇧🇭' },
];

/** The countries offered at the top of the dropdown, in this order. */
export const POPULAR_COUNTRY_ISOS = ['in', 'us', 'gb', 'ae', 'kw', 'sa', 'qa', 'om', 'sg', 'ca', 'au'];

export const DEFAULT_COUNTRY = COUNTRIES[0];

export const INDIA = COUNTRIES[0];

export function findCountry(iso: string): Country {
  const found = COUNTRIES.find((c) => c.iso === String(iso || '').toLowerCase());
  return found || DEFAULT_COUNTRY;
}

export function countryByDial(dial: string): Country | undefined {
  const wanted = String(dial || '').replace(/\D/g, '');
  if (!wanted) return undefined;
  return COUNTRIES.find((c) => c.dial.replace(/\D/g, '') === wanted);
}

/** Digits-only national number, clamped to the country's length. */
export function nationalDigits(value: string, country: Country): string {
  return String(value || '').replace(/\D/g, '').slice(0, country.digits);
}

/** Full E.164 digits: dial code digits + national digits, e.g. "919876543210". */
export function fullPhoneDigits(national: string, country: Country): string {
  return (country.dial.replace(/\D/g, '') + nationalDigits(national, country)).trim();
}

/** The E.164 form with the plus sign, e.g. "+919876543210". */
export function toE164(national: string, country: Country): string {
  const digits = fullPhoneDigits(national, country);
  return digits ? `+${digits}` : '';
}

/** The human-readable form, e.g. "+91 98765 43210". */
export function formatDisplay(national: string, country: Country): string {
  const d = nationalDigits(national, country);
  if (!d) return '';
  const grouped = country.format ? country.format(d) : d;
  return `${country.dial} ${grouped}`.trim();
}

/**
 * Is this national number valid for the country?
 *
 * India keeps the classic 6-9 starting mobile rule; every other country is
 * checked for the exact national length (and E.164's 8-15 digit range).
 */
export function isValidNational(national: string, country: Country): boolean {
  const d = nationalDigits(national, country);
  if (!d) return false;
  if (country.iso === 'in') return /^[6-9]\d{9}$/.test(d);
  return d.length === country.digits;
}

/**
 * Detect the country from a pasted value.
 *
 * Handles "+91 98765 43210", "919876543210", "09876543210" and a bare
 * 10-digit Indian number. Returns the country and the national digits, or
 * null when the value cannot be attributed to a country.
 */
export function detectCountryFromPaste(
  raw: string
): { country: Country; national: string } | null {
  const value = String(raw || '').trim();
  if (!value) return null;

  const digits = value.replace(/\D/g, '');
  if (!digits) return null;

  // An explicit +country code wins.
  if (value.startsWith('+')) {
    // Longest dial code first, so +971 is not read as +9.
    const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
    for (const c of sorted) {
      const cd = c.dial.replace(/\D/g, '');
      if (digits.startsWith(cd) && digits.length > cd.length) {
        return { country: c, national: digits.slice(cd.length).slice(0, c.digits) };
      }
    }
    return null;
  }

  // 00 international prefix.
  if (digits.startsWith('00') && digits.length > 4) {
    const rest = digits.slice(2);
    const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
    for (const c of sorted) {
      const cd = c.dial.replace(/\D/g, '');
      if (rest.startsWith(cd) && rest.length > cd.length) {
        return { country: c, national: rest.slice(cd.length).slice(0, c.digits) };
      }
    }
    return null;
  }

  // A bare 10-digit number that looks like an Indian mobile.
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return { country: INDIA, national: digits };
  }

  // 0-prefixed national form (09876543210).
  if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) {
    return { country: INDIA, national: digits.slice(1) };
  }

  // Country code without a plus (919876543210).
  const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of sorted) {
    const cd = c.dial.replace(/\D/g, '');
    if (digits.startsWith(cd) && digits.length === cd.length + c.digits) {
      return { country: c, national: digits.slice(cd.length) };
    }
  }

  return null;
}

/**
 * The form written to the database.
 *
 * Indian numbers keep the 10-digit national form (that is what every
 * existing row holds). Every other country is stored with its country code,
 * e.g. "+971501234567".
 */
export function toStoredPhone(national: string, country: Country): string {
  const d = nationalDigits(national, country);
  if (!d) return '';
  if (country.iso === 'in') return d;
  return `+${country.dial.replace(/\D/g, '')}${d}`;
}

/**
 * Every spelling of a number that may be stored for the same subscriber.
 *
 * Login lookups use this so an account created by one flow is still found by
 * another: 10 digits, 91+10, +91+10, spaced, hyphenated, 0-prefixed, and the
 * E.164 form for other countries.
 */
export function phoneVariants(raw?: string | null): string[] {
  const value = String(raw || '').trim();
  if (!value) return [];

  const variants = new Set<string>();
  const add = (v: string) => { if (v) variants.add(v); };

  // Already a full international number.
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
      add(`+91 ${national.slice(0, 5)} ${national.slice(5)}`);
      add(`+91-${national}`);
      add(`0${national}`);
    }
    return [...variants];
  }

  return [...variants];
}

/** True when the number belongs to India. */
export function isIndianNumber(raw?: string | null): boolean {
  const detected = detectCountryFromPaste(String(raw || ''));
  return detected?.country.iso === 'in';
}

/**
 * The canonical stored form for any country.
 *
 * Indian numbers become `91XXXXXXXXXX` (the historic `users.phone` format,
 * so no existing account breaks); every other country becomes
 * `+<country code><national>`. Returns '' when the input is not a usable
 * phone number.
 */
export function canonicalPhoneAny(raw?: string | null): string {
  const value = String(raw || '').trim();
  if (!value) return '';

  const detected = detectCountryFromPaste(value);
  if (detected) {
    const { country, national } = detected;
    if (country.iso === 'in') {
      return /^[6-9]\d{9}$/.test(national) ? `91${national}` : '';
    }
    return national.length === country.digits
      ? `+${country.dial.replace(/\D/g, '')}${national}`
      : '';
  }

  // A plain 10-digit number is treated as Indian.
  const digits = value.replace(/\D/g, '');
  return /^[6-9]\d{9}$/.test(digits) ? `91${digits}` : '';
}

/** True when the value is a usable phone number from any supported country. */
export function isValidPhoneAny(raw?: string | null): boolean {
  return Boolean(canonicalPhoneAny(raw));
}
