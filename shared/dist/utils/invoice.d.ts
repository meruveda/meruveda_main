/**
 * Invoice + GST helpers shared by the backend, the storefront and the admin.
 *
 * Everything invoice-related that must agree across packages lives here so the
 * PDF, the checkout summary and the admin can never drift apart.
 */
/** Seller state code — Meruveda is registered in Rajasthan (08). */
export declare const SELLER_STATE_CODE = "08";
export declare const SELLER_STATE = "Rajasthan";
/** GSTIN printed on every tax invoice. */
export declare const SELLER_GSTIN = "08BFPPS7045C1Z4";
/** Default GST rate applied when a product carries no explicit rate. */
export declare const DEFAULT_GST_RATE_PERCENT = 5;
/**
 * True only when the buyer's state is unambiguously Rajasthan (intra-state,
 * CGST + SGST).
 *
 * A BLANK or unknown state returns FALSE — the caller is expected to reject the
 * checkout before it ever gets here. Defaulting a blank state to "intra-state"
 * silently under-declared IGST on real invoices, so an unknown state is treated
 * as inter-state (IGST), which is the safe/conservative treatment.
 */
export declare const isRajasthan: (state?: string | null) => boolean;
/** True when the buyer is in the seller's own state (CGST + SGST). */
export declare const isIntraState: (state?: string | null) => boolean;
/**
 * Indian financial year label for a date. April 1 - March 31, named after the
 * year it starts in: April 2026 -> "26-27", March 2027 -> "26-27".
 *
 * Evaluated in IST (UTC+05:30) so the FY boundary is the Indian one no matter
 * what timezone the server runs in. An invoice generated at 23:00 UTC on
 * 31 March is already 1 April in India and belongs to the new series.
 */
export declare const invoiceFyLabel: (date?: Date) => string;
/** Full GST-series invoice number, e.g. `MV/26-27/000123`. */
export declare const formatInvoiceNumber: (fy: string, seq: number) => string;
/** Round to 2dp without float drift (699 * 5 / 105 === 33.29, not 33.289999). */
export declare const round2: (value: number) => number;
/**
 * GST-inclusive gross -> the taxable value inside it.
 *
 * A 699.00 line at 5% contains 33.29 of tax, leaving 665.71 taxable.
 */
export declare const grossToTaxable: (gross: number, ratePercent?: number) => number;
/** GST contained in a gross (taxable-inclusive) amount. */
export declare const grossToGst: (gross: number, ratePercent?: number) => number;
/**
 * Split an order's total GST into the intra-state (CGST + SGST) or
 * inter-state (IGST) presentation.
 *
 * For intra-state the SECOND half is derived by subtraction
 * (`sgst = total - cgst`) rather than both halves being rounded
 * independently, so the two printed rows always sum back to the tax total and
 * the invoice reconciles with TOTAL to the paisa.
 */
export declare const splitGst: (totalGst: number, state?: string | null) => {
    mode: "intra" | "inter";
    cgst: number;
    sgst: number;
    igst: number;
};
/** Per-order item view used by both the PDF renderer and the totals. */
export interface InvoiceLineTotals {
    /** Sum of the GST-inclusive line amounts, before any discount. */
    gross: number;
    /** Goods value that GST is charged on, GST INCLUSIVE and after discount. */
    taxable: number;
    /** GST contained in `taxable`, at the weighted per-item rate. */
    gst: number;
    /** GST on the shipping charge — only non-zero when SHIPPING_IS_TAXABLE is on. */
    shippingGst: number;
}
/**
 * Derive gross / taxable / gst for one order.
 *
 * GST is charged on goods only. Shipping is added flat on top of the
 * GST-inclusive goods total, which is what the reference template shows, so the
 * printed rows always satisfy:
 *
 *     taxable + gst + shippingFee === subtotal - discount + shippingFee
 *
 * i.e. `taxable + gst === subtotal - discount` EXACTLY, to the paisa. Shipping
 * is deliberately NOT folded into `taxable`: doing so double-counted it and
 * made the invoice fail to reconcile with TOTAL.
 *
 * When `shippingGstRatePercent` is non-zero the shipping charge carries its own
 * GST, which is reported separately in `shippingGst` (still inside the charged
 * shippingFee) instead of being added to `gst`.
 */
export declare const computeOrderTotals: (input: {
    subtotal: number;
    discount?: number;
    shippingFee?: number;
    /** Pre-computed GST from the order row, used when per-item rates are unknown. */
    fallbackGst?: number;
    /** Per-item gross amount and its GST rate percent. */
    lines?: Array<{
        gross: number;
        ratePercent?: number;
    }>;
    shippingGstRatePercent?: number;
}) => InvoiceLineTotals;
/** Format an amount the way it appears on the invoice: `1,234.00`. */
export declare const formatInvoiceAmount: (value: number | string | null | undefined) => string;
