// Account service layer — single place where the My Account UI talks to the
// backend. Uses real endpoints when present (orders, reviews, support,
// wishlist, auth) and a versioned localStorage fallback for data the backend
// does not persist yet (address book, payment tokens, return tickets).
// Every method is scoped to the authenticated user; nothing here ever reads
// another user's records.

import axiosInstance from "@/api/axiosInstance";
import type {
  AccountAddress,
  AccountOrder,
  AccountReview,
  AddressType,
  LegacyAddress,
  SavedCard,
} from "@/types/account";

const LS = {
  addresses: "meruveda_addresses_v2",
  cards: "meruveda_cards_v2",
  reviews: "meruveda_reviews_local_v1",
};

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function errMsg(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: { message?: string }; message?: string } }; message?: string };
  return (
    e?.response?.data?.error?.message ||
    e?.response?.data?.message ||
    e?.message ||
    fallback
  );
}

// ------------------------------------------------------------ address mapping

function legacyToAccount(a: LegacyAddress & { houseFlat?: string; street?: string; landmark?: string; pincode?: string }): AccountAddress {
  const line = a.addressLine || [a.houseFlat, a.street].filter(Boolean).join(", ");
  // Try to split "Flat X, Street Y" back into parts.
  const parts = String(line || "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    id: String(a.id || uid("addr")),
    fullName: String(a.fullName || ""),
    houseFlat: String(a.houseFlat || parts[0] || line || ""),
    street: String(a.street || parts.slice(1).join(", ") || ""),
    landmark: String(a.landmark || ""),
    city: String(a.city || ""),
    state: String(a.state || ""),
    pincode: String(a.pincode || a.zipCode || ""),
    phone: String(a.phone || ""),
    type: (["Home", "Work", "Other"].includes(String(a.type)) ? a.type : "Home") as AddressType,
    isDefault: Boolean(a.isDefault),
  };
}

export function formatAddress(a: AccountAddress): string {
  return [a.houseFlat, a.street, a.landmark, `${a.city}, ${a.state} - ${a.pincode}`]
    .filter((s) => s && String(s).trim())
    .join(", ");
}

// ----------------------------------------------------------------- addresses

export const addressService = {
  list(): AccountAddress[] {
    const raw = readLS<Array<AccountAddress | LegacyAddress>>(LS.addresses, []);
    // Migrate legacy keys once.
    if (raw.length === 0 && typeof window !== "undefined") {
      const legacy = localStorage.getItem("meruveda_addresses");
      if (legacy) {
        try {
          const items = JSON.parse(legacy) as LegacyAddress[];
          const migrated = items.map(legacyToAccount);
          writeLS(LS.addresses, migrated);
          return migrated;
        } catch {
          /* ignore */
        }
      }
    }
    return raw.map((a) =>
      "houseFlat" in (a as object) && "pincode" in (a as object)
        ? (a as AccountAddress)
        : legacyToAccount(a as LegacyAddress),
    );
  },
  saveAll(items: AccountAddress[]) {
    writeLS(LS.addresses, items);
    // Keep the old key in sync for checkout code that still reads it.
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "meruveda_addresses",
        JSON.stringify(
          items.map((a) => ({
            id: a.id,
            fullName: a.fullName,
            addressLine: [a.houseFlat, a.street].filter(Boolean).join(", "),
            city: a.city,
            state: a.state,
            zipCode: a.pincode,
            phone: a.phone,
            type: a.type,
            isDefault: a.isDefault,
          })),
        ),
      );
    }
  },
  create(input: Omit<AccountAddress, "id">): AccountAddress {
    const items = addressService.list();
    const created: AccountAddress = { ...input, id: uid("addr"), isDefault: items.length === 0 ? true : input.isDefault };
    const next = created.isDefault ? items.map((a) => ({ ...a, isDefault: false })) : items;
    const updated = [...next, created];
    addressService.saveAll(updated);
    return created;
  },
  update(id: string, patch: Partial<AccountAddress>): AccountAddress[] {
    const items = addressService.list();
    const next = items.map((a) => {
      if (a.id !== id) return patch.isDefault ? { ...a, isDefault: false } : a;
      return { ...a, ...patch };
    });
    addressService.saveAll(next);
    return next;
  },
  remove(id: string): AccountAddress[] {
    const items = addressService.list().filter((a) => a.id !== id);
    if (items.length > 0 && !items.some((a) => a.isDefault)) items[0].isDefault = true;
    addressService.saveAll(items);
    return items;
  },
  setDefault(id: string): AccountAddress[] {
    return addressService.update(id, { isDefault: true });
  },
};

// -------------------------------------------------------------------- orders

export function normalizeOrderStatus(status: unknown): string {
  const s = String(status || "placed").toLowerCase().replace(/[\s-]+/g, "_");
  const map: Record<string, string> = {
    order_placed: "placed",
    pending: "placed",
    payment_pending: "placed",
    confirmed: "confirmed",
    processing: "processing",
    packed: "processing",
    picked_up: "shipped",
    shipped: "shipped",
    in_transit: "shipped",
    out_for_delivery: "out_for_delivery",
    delivered: "delivered",
    cancelled: "cancelled",
    canceled: "cancelled",
    failed: "failed",
    returned: "returned",
    refunded: "refunded",
  };
  return map[s] || s;
}

function mapBackendOrder(bo: Record<string, unknown>): AccountOrder {
  const o = bo as Record<string, any>;
  const items = (o.order_items || []).map((item: any, i: number) => ({
    id: String(item.id || `${o.id}-item-${i}`),
    productId: String(item.product_id || item.id || ""),
    name: String(item.products?.name || item.name || "Product"),
    price: Number(item.price ?? item.products?.selling_price ?? 0),
    quantity: Number(item.quantity ?? 1),
    image: String(
      item.image_url || item.products?.images?.[0]?.url || item.products?.images?.[0] || "/images/placeholder-product.png",
    ),
  }));
  const ship = (o.shipping_address || {}) as Record<string, any>;
  return {
    id: String(o.id),
    orderNumber: String(o.order_number || o.id),
    date: String(o.created_at || new Date().toISOString()),
    items,
    total: Number(o.total ?? o.grand_total ?? 0),
    status: String(o.status || "Placed"),
    normalizedStatus: normalizeOrderStatus(o.status),
    paymentMethod: String(o.payment_method || "—"),
    paymentStatus: o.payment_status ? String(o.payment_status) : undefined,
    shippingAddress: {
      fullName: String(ship.fullName || ship.name || "—"),
      addressLine: String(ship.addressLine || ship.address || ship.street || "—"),
      city: String(ship.city || ""),
      state: String(ship.state || ""),
      zipCode: String(ship.zipCode || ship.zip || ship.pincode || ""),
      phone: String(ship.phone || ""),
    },
    estimatedDelivery: o.estimated_delivery ? String(o.estimated_delivery) : undefined,
    trackingNumber: o.tracking_number ? String(o.tracking_number) : o.awb_code ? String(o.awb_code) : undefined,
    trackingUrl: o.tracking_url ? String(o.tracking_url) : undefined,
    awbCode: o.awb_code ? String(o.awb_code) : undefined,
    courierName: o.courier_name ? String(o.courier_name) : undefined,
    lastTrackingUpdate: o.last_tracking_update ? String(o.last_tracking_update) : undefined,
    trackingHistory: (o.order_tracking_history || o.tracking_history || []) as AccountOrder["trackingHistory"],
    raw: bo,
  };
}

export const orderService = {
  async myOrders(): Promise<AccountOrder[]> {
    try {
      const res = await axiosInstance.get("/orders/my");
      const rows = res.data?.data || [];
      return rows.map(mapBackendOrder);
    } catch (err) {
      throw new Error(errMsg(err, "Could not load your orders."));
    }
  },
  async byId(id: string): Promise<AccountOrder> {
    // Prefer the scoped list (ownership enforced server-side) then fall back
    // to the direct endpoint.
    try {
      const all = await orderService.myOrders();
      const found = all.find((o) => o.id === id || o.orderNumber === id);
      if (found) return found;
    } catch {
      /* fall through to direct fetch */
    }
    try {
      const res = await axiosInstance.get(`/orders/${id}`);
      const row = res.data?.data || res.data;
      return mapBackendOrder(row);
    } catch (err) {
      throw new Error(errMsg(err, "Order not found."));
    }
  },
};

// ------------------------------------------------------------------- reviews

export const reviewService = {
  async mine(): Promise<AccountReview[]> {
    try {
      const res = await axiosInstance.get("/reviews/my");
      const rows = res.data?.data || [];
      return rows.map((r: any) => ({
        id: String(r.id),
        productId: String(r.product_id),
        productName: String(r.products?.name || r.product_name || "Product"),
        rating: Number(r.rating || 0),
        text: String(r.comment || r.body || ""),
        images: Array.isArray(r.images) ? r.images : [],
        date: String(r.created_at || new Date().toISOString()),
        status: r.status ? String(r.status) : undefined,
      }));
    } catch (err) {
      throw new Error(errMsg(err, "Could not load your reviews."));
    }
  },
  async eligibleProducts(): Promise<Array<{ productId: string; name: string; image: string; orderNumber: string }>> {
    const orders = await orderService.myOrders();
    const seen = new Map<string, { productId: string; name: string; image: string; orderNumber: string }>();
    for (const o of orders) {
      if (o.normalizedStatus !== "delivered") continue;
      for (const it of o.items) {
        if (!seen.has(it.productId)) {
          seen.set(it.productId, { productId: it.productId, name: it.name, image: it.image, orderNumber: o.orderNumber });
        }
      }
    }
    return [...seen.values()];
  },
  async create(productId: string, rating: number, text: string, images: string[] = []) {
    try {
      // NOTE: the `reviews` table has no `images` column — photo URLs are
      // intentionally not sent so text reviews never fail on unknown keys.
      void images;
      const payload: Record<string, unknown> = { product_id: productId, rating, comment: text };
      const res = await axiosInstance.post("/reviews", payload);
      return res.data?.data;
    } catch (err) {
      throw new Error(errMsg(err, "Could not submit your review."));
    }
  },
  async update(id: string, rating: number, text: string) {
    try {
      const res = await axiosInstance.patch(`/reviews/${id}`, { rating, comment: text });
      return res.data?.data;
    } catch (err) {
      throw new Error(errMsg(err, "Could not update your review."));
    }
  },
  async remove(id: string) {
    try {
      await axiosInstance.delete(`/reviews/${id}`);
    } catch (err) {
      throw new Error(errMsg(err, "Could not delete your review."));
    }
  },
};

// ------------------------------------------------------------------- payments

function detectCardType(digits: string): SavedCard["cardType"] {
  if (/^4/.test(digits)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "Mastercard";
  if (/^3[47]/.test(digits)) return "Amex";
  if (/^(60|65|81|82)/.test(digits)) return "RuPay";
  return "RuPay";
}

export const paymentService = {
  list(): SavedCard[] {
    const items = readLS<SavedCard[]>(LS.cards, []);
    if (items.length > 0) return items;
    if (typeof window !== "undefined") {
      // Migrate the pre-existing demo key once, then drop it.
      try {
        const legacyRaw = localStorage.getItem("meruveda_cards");
        if (legacyRaw) {
          const legacy = JSON.parse(legacyRaw) as Array<{ id: string; cardHolder: string; cardNumber: string; cardType: SavedCard["cardType"]; expiry: string; isDefault: boolean }>;
          const migrated: SavedCard[] = legacy.map((c) => ({
            id: c.id,
            cardHolder: c.cardHolder,
            masked: c.cardNumber,
            last4: (c.cardNumber.match(/(\d{4})\s*$/)?.[1] || "••••"),
            cardType: c.cardType,
            expiry: c.expiry,
            isDefault: c.isDefault,
          }));
          writeLS(LS.cards, migrated);
          return migrated;
        }
      } catch {
        /* ignore */
      }
    }
    return [];
  },
  saveAll(items: SavedCard[]) {
    writeLS(LS.cards, items);
  },
  add(cardHolder: string, number: string, expiry: string): SavedCard {
    const digits = number.replace(/\D/g, "");
    const last4 = digits.slice(-4);
    const items = paymentService.list();
    const created: SavedCard = {
      id: uid("card"),
      cardHolder: cardHolder.trim(),
      masked: `•••• •••• •••• ${last4}`,
      last4,
      cardType: detectCardType(digits),
      expiry: expiry.trim(),
      isDefault: items.length === 0,
    };
    const next = [...items.map((c) => (created.isDefault ? { ...c, isDefault: false } : c)), created];
    paymentService.saveAll(next);
    return created;
  },
  remove(id: string): SavedCard[] {
    const items = paymentService.list().filter((c) => c.id !== id);
    if (items.length > 0 && !items.some((c) => c.isDefault)) items[0].isDefault = true;
    paymentService.saveAll(items);
    return items;
  },
  setDefault(id: string): SavedCard[] {
    const items = paymentService.list().map((c) => ({ ...c, isDefault: c.id === id }));
    paymentService.saveAll(items);
    return items;
  },
};

export function validateNewCard(cardHolder: string, number: string, expiry: string): string | null {
  if (cardHolder.trim().length < 2) return "Enter the name on the card.";
  const digits = number.replace(/\D/g, "");
  if (!/^\d{15,16}$/.test(digits)) return "Enter a valid 15–16 digit card number.";
  const m = expiry.trim().match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
  if (!m) return "Expiry must be MM/YY.";
  const yy = 2000 + Number(m[2]);
  const mm = Number(m[1]);
  const now = new Date();
  if (yy < now.getFullYear() || (yy === now.getFullYear() && mm < now.getMonth() + 1)) {
    return "This card has expired.";
  }
  return null;
}
