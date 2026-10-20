/**
 * Country data for the checkout phone field.
 *
 * The list itself lives in @meruveda/shared so the storefront, the admin
 * panel and the backend all agree on the dial codes and the validation rules.
 * This module re-exports it and adds the frontend-only conveniences.
 *
 * India is the default (this is an Indian GST store). The dial-code selector
 * lets an NRI buyer enter a non-Indian number; the full digits-only phone
 * (dial + national) is what gets stored on the order as `delivery_phone` and
 * inside `shipping_address.phone`, so the backend and Shiprocket both see one
 * canonical value. Non-Indian numbers are accepted at checkout but Shiprocket
 * push will skip fulfilment for them unless an Indian delivery contact is
 * supplied — that is intentional, not a bug.
 */
export {
  COUNTRIES,
  POPULAR_COUNTRY_ISOS,
  DEFAULT_COUNTRY,
  INDIA,
  findCountry,
  countryByDial,
  nationalDigits,
  fullPhoneDigits,
  toE164,
  formatDisplay,
  isValidNational,
  detectCountryFromPaste,
  toStoredPhone,
  phoneVariants,
  isIndianNumber,
} from '@meruveda/shared';

export type { Country } from '@meruveda/shared';
