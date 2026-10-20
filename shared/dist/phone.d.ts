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
export declare const COUNTRIES: Country[];
/** The countries offered at the top of the dropdown, in this order. */
export declare const POPULAR_COUNTRY_ISOS: string[];
export declare const DEFAULT_COUNTRY: Country;
export declare const INDIA: Country;
export declare function findCountry(iso: string): Country;
export declare function countryByDial(dial: string): Country | undefined;
/** Digits-only national number, clamped to the country's length. */
export declare function nationalDigits(value: string, country: Country): string;
/** Full E.164 digits: dial code digits + national digits, e.g. "919876543210". */
export declare function fullPhoneDigits(national: string, country: Country): string;
/** The E.164 form with the plus sign, e.g. "+919876543210". */
export declare function toE164(national: string, country: Country): string;
/** The human-readable form, e.g. "+91 98765 43210". */
export declare function formatDisplay(national: string, country: Country): string;
/**
 * Is this national number valid for the country?
 *
 * India keeps the classic 6-9 starting mobile rule; every other country is
 * checked for the exact national length (and E.164's 8-15 digit range).
 */
export declare function isValidNational(national: string, country: Country): boolean;
/**
 * Detect the country from a pasted value.
 *
 * Handles "+91 98765 43210", "919876543210", "09876543210" and a bare
 * 10-digit Indian number. Returns the country and the national digits, or
 * null when the value cannot be attributed to a country.
 */
export declare function detectCountryFromPaste(raw: string): {
    country: Country;
    national: string;
} | null;
/**
 * The form written to the database.
 *
 * Indian numbers keep the 10-digit national form (that is what every
 * existing row holds). Every other country is stored with its country code,
 * e.g. "+971501234567".
 */
export declare function toStoredPhone(national: string, country: Country): string;
/**
 * Every spelling of a number that may be stored for the same subscriber.
 *
 * Login lookups use this so an account created by one flow is still found by
 * another: 10 digits, 91+10, +91+10, spaced, hyphenated, 0-prefixed, and the
 * E.164 form for other countries.
 */
export declare function phoneVariants(raw?: string | null): string[];
/** True when the number belongs to India. */
export declare function isIndianNumber(raw?: string | null): boolean;
/**
 * The canonical stored form for any country.
 *
 * Indian numbers become `91XXXXXXXXXX` (the historic `users.phone` format,
 * so no existing account breaks); every other country becomes
 * `+<country code><national>`. Returns '' when the input is not a usable
 * phone number.
 */
export declare function canonicalPhoneAny(raw?: string | null): string;
/** True when the value is a usable phone number from any supported country. */
export declare function isValidPhoneAny(raw?: string | null): boolean;
