/**
 * When is an order's invoice available to the customer?
 *
 * There is no payment gate. The invoice is issued at ORDER CREATION for every
 * order — COD and prepaid alike, paid or not — because a tax invoice documents
 * the sale and the sale happens when the order is placed. So the button is
 * available for every order from the moment it is placed, and the backend
 * endpoint behind it will always have something to serve (or is still
 * generating it).
 */

export interface InvoiceGateInput {
  paymentMethod?: string;
  paymentStatus?: string;
  invoiceStatus?: string;
  status?: string;
}

export function isCodOrder(order: InvoiceGateInput | null | undefined): boolean {
  // Exact stored value, case-insensitively — mirrors the backend decision.
  return String(order?.paymentMethod || "").trim().toLowerCase() === "cod";
}

/**
 * Always true for an order that exists.
 *
 * Kept as a named predicate so the intent is explicit at the call site rather
 * than a payment check being re-invented per page.
 */
export function isInvoiceAvailable(order: InvoiceGateInput | null | undefined): boolean {
  return Boolean(order);
}

/** Only shown while an invoice is still being generated. */
export function invoiceUnavailableNote(order: InvoiceGateInput | null | undefined): string {
  if (isCodOrder(order)) return "Preparing your invoice…";
  return "Preparing your invoice…";
}