/**
 * When is an order's invoice available to the customer?
 *
 * Mirrors the backend rule in postOrderConfirmed.ts#isInvoiceEligible so the
 * button never appears for an invoice the endpoint would refuse to produce.
 *
 *   Cash on Delivery — billable from the moment the order is placed; the invoice
 *                      states the amount due on delivery.
 *   Prepaid (PayU)   — billable only once the callback has verified payment.
 */
export interface InvoiceGateInput {
  paymentMethod?: string;
  paymentStatus?: string;
  invoiceStatus?: string;
  status?: string;
}

export function isCodOrder(order: InvoiceGateInput | null | undefined): boolean {
  return /cash|\bcod\b/i.test(String(order?.paymentMethod || ""));
}

export function isInvoiceAvailable(order: InvoiceGateInput | null | undefined): boolean {
  if (!order) return false;
  // An already-delivered invoice is available regardless of the payment gate:
  // a customer coming back later must still be able to fetch it.
  if (order.invoiceStatus === "sent") return true;
  if (isCodOrder(order)) return true;
  return String(order.paymentStatus || "") === "paid";
}

/** Short explanation shown in place of the button when it is not available. */
export function invoiceUnavailableNote(order: InvoiceGateInput | null | undefined): string {
  if (isCodOrder(order)) return "Invoice is being generated…";
  const status = String(order?.paymentStatus || "").toLowerCase();
  if (status === "failed") return "Payment failed — no invoice issued";
  return "Invoice available after payment";
}