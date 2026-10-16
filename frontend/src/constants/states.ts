/**
 * Canonical list of Indian states and Union Territories.
 *
 * This mirrors `INDIAN_STATES` in backend/src/services/orderService.ts, which is
 * the list the API accepts. The backend refuses to treat an unknown state name as
 * a known one, and it is what decides CGST/SGST (Rajasthan) vs IGST (everywhere
 * else) on the tax invoice. So a state outside this list can never produce a
 * correct invoice — it must be rejected in the UI rather than warned about later.
 */
export const INDIAN_STATES: readonly string[] = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

/** True when `state` is a name the backend recognises (trimmed, case-insensitive). */
export function isIndianState(state: string | null | undefined): boolean {
  const value = (state || "").trim().toLowerCase();
  if (!value) return false;
  return INDIAN_STATES.some((s) => s.toLowerCase() === value);
}