// Central account-domain types. Mirrors backend models (User, Address,
// Order, OrderItem, Shipment, Review, Wishlist, PaymentMethod) while staying
// tolerant of backend shape drift. Items are non-returnable (see Shipping
// Policy), so there are no return/refund request types here.

export type AddressType = "Home" | "Work" | "Other";

export interface AccountAddress {
  id: string;
  fullName: string;
  houseFlat: string;
  street: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  type: AddressType;
  isDefault: boolean;
  createdAt?: string;
}

/** Legacy single-line shape (localStorage / old checkout payloads). */
export interface LegacyAddress {
  id?: string;
  fullName?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  type?: string;
  isDefault?: boolean;
}

export type OrderStatus =
  | "placed"
  | "confirmed"
  | "processing"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "failed"
  | "returned"
  | "refunded"
  | string;

export interface AccountOrderItem {
  id: string;
  productId: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
}

export interface AccountOrder {
  id: string;
  orderNumber: string;
  date: string;
  items: AccountOrderItem[];
  total: number;
  status: string;
  normalizedStatus: string;
  paymentMethod: string;
  paymentStatus?: string;
  shippingAddress: {
    fullName: string;
    addressLine: string;
    city: string;
    state: string;
    zipCode: string;
    phone: string;
  };
  estimatedDelivery?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  awbCode?: string;
  courierName?: string;
  lastTrackingUpdate?: string;
  trackingHistory?: Array<{
    activity?: string;
    status?: string;
    location?: string;
    created_at?: string;
    date?: string;
  }>;
  raw?: unknown;
}

export const ORDER_FLOW = [
  "placed",
  "confirmed",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
] as const;

export const ORDER_FLOW_LABELS: Record<string, string> = {
  placed: "Order Placed",
  confirmed: "Order Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
};

export interface AccountReview {
  id: string;
  productId: string;
  productName: string;
  productImage?: string;
  rating: number;
  text: string;
  images?: string[];
  date: string;
  status?: string;
}

export interface SavedCard {
  id: string;
  cardHolder: string;
  masked: string;
  last4: string;
  cardType: "Visa" | "Mastercard" | "RuPay" | "Amex" | "UPI" | "NetBanking";
  expiry?: string;
  isDefault: boolean;
}

export interface DashboardStats {
  totalOrders: number;
  activeOrders: number;
  reviewed: number;
  pendingReviews: number;
  wishlistCount: number;
}

// ---------------------------------------------------------------- validation

const digitsOnly = (v: string) => v.replace(/\D/g, "");

export function normalizePhone10(v: string): string {
  let d = digitsOnly(v);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}

export function isValidPhone(v: string): boolean {
  const d = normalizePhone10(v);
  return /^[6-9]\d{9}$/.test(d);
}

export function isValidPincode(v: string): boolean {
  return /^[1-9][0-9]{5}$/.test(v.trim());
}

export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

/**
 * Synthetic identities the backend assigns to phone-only accounts
 * (`<digits>@meruveda.whatsapp`) — never a real inbox, so the UI must not
 * present them as the customer's email address.
 */
export function isPlaceholderEmail(v?: string | null): boolean {
  if (!v) return true;
  return String(v).trim().toLowerCase().endsWith("@meruveda.whatsapp");
}

/** The customer's real email, or '' when the account only has a placeholder identity. */
export function displayEmail(v?: string | null): string {
  if (!v || isPlaceholderEmail(v)) return "";
  return String(v).trim();
}

export function memberSinceLabel(raw?: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}
