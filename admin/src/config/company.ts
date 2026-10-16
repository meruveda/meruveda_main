/**
 * Seller identity shown in the admin UI.
 *
 * Mirrors SELLER_* in @meruveda/shared and BUSINESS_* on the backend, which is
 * what the PDF generator actually prints. This copy exists only for admin
 * display (e.g. the GSTIN column on the transactions export); the tax document
 * itself is rendered by the backend, never from here.
 */
export const COMPANY_CONFIG = {
  name: 'MERUVEDA WELLNESS',
  addressLine1: 'Keharsh Enterprises (Sole Proprietorship)',
  addressLine2: 'S/N. 12, Viru City Gym Road, Inside Jalori Gate, Jodhpur - 342001, Rajasthan, India',
  phone: '+91 8097147463',
  email: 'customercare@meruvedawellness.com',
  website: 'meruvedawellness.com',
  gstin: '08BFPPS7045C1Z4'
}