// Country data for the checkout phone field.
//
// India is first and the default — this is an Indian GST store, and every
// Shiprocket push, invoice and WhatsApp OTP path is built around +91. The
// other entries exist so an NRI buyer can still place an order: their number
// is stored correctly (dial code + national digits), while Shiprocket push
// gracefully records "Non-Indian phone number" and skips fulfilment for those
// orders (the admin fulfils them manually).
//
// `digits` is the NATIONAL number length (excluding the country code), used
// for input maxLength + validation. `format` groups the national digits for
// display only.

export interface Country {
  iso: string; // ISO 3166-1 alpha-2, lowercased
  name: string;
  dial: string; // with leading +, e.g. "+91"
  digits: number; // national number length
  format?: (national: string) => string; // display grouping
}

export const COUNTRIES: Country[] = [
  {
    iso: "in",
    name: "India",
    dial: "+91",
    digits: 10,
    format: (n) => n.replace(/(\d{5})(\d{0,5})/, (_, a, b) => (b ? `${a} ${b}` : a)),
  },
  { iso: "ae", name: "UAE", dial: "+971", digits: 9, format: (n) => n.replace(/(\d{2})(\d{3})(\d{4})/, "$1 $2 $3") },
  { iso: "us", name: "United States", dial: "+1", digits: 10, format: (n) => n.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3") },
  { iso: "gb", name: "United Kingdom", dial: "+44", digits: 10, format: (n) => n.replace(/(\d{4})(\d{6})/, "$1 $2") },
  { iso: "sg", name: "Singapore", dial: "+65", digits: 8, format: (n) => n.replace(/(\d{4})(\d{4})/, "$1 $2") },
  { iso: "au", name: "Australia", dial: "+61", digits: 9, format: (n) => n.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3") },
  { iso: "ca", name: "Canada", dial: "+1", digits: 10, format: (n) => n.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3") },
  { iso: "sa", name: "Saudi Arabia", dial: "+966", digits: 9, format: (n) => n.replace(/(\d{2})(\d{3})(\d{4})/, "$1 $2 $3") },
  { iso: "de", name: "Germany", dial: "+49", digits: 10 },
  { iso: "fr", name: "France", dial: "+33", digits: 9 },
];

export const DEFAULT_COUNTRY = COUNTRIES[0];

export function findCountry(iso: string): Country {
  return COUNTRIES.find((c) => c.iso === iso.toLowerCase()) || DEFAULT_COUNTRY;
}

/** Digits-only national number, maxLength-clamped. */
export function nationalDigits(value: string, country: Country): string {
  return (value || "").replace(/\D/g, "").slice(0, country.digits);
}

/** Full digits-only phone: dial code digits + national digits, e.g. "919876543210". */
export function fullPhoneDigits(national: string, country: Country): string {
  return (country.dial.replace(/\D/g, "") + nationalDigits(national, country)).trim();
}

export function isValidNational(national: string, country: Country): boolean {
  const d = nationalDigits(national, country);
  // India: classic 6-9 starting mobile rule. Others: exact national length.
  if (country.iso === "in") return /^[6-9]\d{9}$/.test(d);
  return d.length === country.digits;
}
