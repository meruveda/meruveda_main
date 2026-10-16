/**
 * Invoice + GST helpers shared by the backend, the storefront and the admin.
 *
 * Everything invoice-related that must agree across packages lives here so the
 * PDF, the checkout summary and the admin can never drift apart.
 */

/** Seller state code — Meruveda is registered in Rajasthan (08). */
export const SELLER_STATE_CODE = '08';
export const SELLER_STATE = 'Rajasthan';

/** GSTIN printed on every tax invoice. */
export const SELLER_GSTIN = '08BFPPS7045C1Z4';

/** Default GST rate applied when a product carries no explicit rate. */
export const DEFAULT_GST_RATE_PERCENT = 5;

/**
 * Spellings of "Rajasthan" that real checkouts produce. Free-text state fields
 * are always a source of typos ("Rajsthan"), so the invoice must treat any of
 * these as intra-state rather than falling through to IGST.
 */
const RAJASTHAN_ALIASES = new Set([
  'rajasthan',
  'rajastan',
  'rajsthan',
  'rajasthn',
  'rajasthna',
  'rajastran',
  'raj',
  'rj',
]);

/**
 * True only when the buyer's state is unambiguously Rajasthan (intra-state,
 * CGST + SGST).
 *
 * A BLANK or unknown state returns FALSE — the caller is expected to reject the
 * checkout before it ever gets here. Defaulting a blank state to "intra-state"
 * silently under-declared IGST on real invoices, so an unknown state is treated
 * as inter-state (IGST), which is the safe/conservative treatment.
 */
export const isRajasthan = (state?: string | null): boolean => {
  const s = String(state ?? '').trim().toLowerCase();
  if (!s) return false;
  if (RAJASTHAN_ALIASES.has(s)) return true;
  return s.startsWith('raj') && s.length >= 5;
};

/** True when the buyer is in the seller's own state (CGST + SGST). */
export const isIntraState = (state?: string | null): boolean => isRajasthan(state);

/**
 * Indian financial year label for a date. April 1 - March 31, named after the
 * year it starts in: April 2026 -> "26-27", March 2027 -> "26-27".
 *
 * Evaluated in IST (UTC+05:30) so the FY boundary is the Indian one no matter
 * what timezone the server runs in. An invoice generated at 23:00 UTC on
 * 31 March is already 1 April in India and belongs to the new series.
 */
export const invoiceFyLabel = (date: Date = new Date()): string => {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth() + 1; // 1..12
  const startYear = month >= 4 ? year : year - 1;
  const yy = (y: number) => String(y % 100).padStart(2, '0');
  return `${yy(startYear)}-${yy(startYear + 1)}`;
};

/** Full GST-series invoice number, e.g. `MV/26-27/000123`. */
export const formatInvoiceNumber = (fy: string, seq: number): string =>
  `MV/${fy}/${String(seq).padStart(6, '0')}`;

/** Round to 2dp without float drift (699 * 5 / 105 === 33.29, not 33.289999). */
export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * GST-inclusive gross -> the taxable value inside it.
 *
 * A 699.00 line at 5% contains 33.29 of tax, leaving 665.71 taxable.
 */
export const grossToTaxable = (gross: number, ratePercent: number = DEFAULT_GST_RATE_PERCENT): number =>
  round2((Number(gross) || 0) * (100 / (100 + (Number(ratePercent) || 0))));

/** GST contained in a gross (taxable-inclusive) amount. */
export const grossToGst = (gross: number, ratePercent: number = DEFAULT_GST_RATE_PERCENT): number => {
  const g = Number(gross) || 0;
  return round2(g - grossToTaxable(g, ratePercent));
};

/**
 * Split an order's total GST into the intra-state (CGST + SGST) or
 * inter-state (IGST) presentation.
 *
 * For intra-state the SECOND half is derived by subtraction
 * (`sgst = total - cgst`) rather than both halves being rounded
 * independently, so the two printed rows always sum back to the tax total and
 * the invoice reconciles with TOTAL to the paisa.
 */
export const splitGst = (
  totalGst: number,
  state?: string | null
): { mode: 'intra' | 'inter'; cgst: number; sgst: number; igst: number } => {
  const total = round2(totalGst);
  if (isIntraState(state)) {
    // Round the first half to 2dp, then give the remainder to SGST.
    const cgst = round2(total / 2);
    return { mode: 'intra', cgst, sgst: round2(total - cgst), igst: 0 };
  }
  return { mode: 'inter', cgst: 0, sgst: 0, igst: total };
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
export const computeOrderTotals = (input: {
  subtotal: number;
  discount?: number;
  shippingFee?: number;
  /** Pre-computed GST from the order row, used when per-item rates are unknown. */
  fallbackGst?: number;
  /** Per-item gross amount and its GST rate percent. */
  lines?: Array<{ gross: number; ratePercent?: number }>;
  shippingGstRatePercent?: number;
}): InvoiceLineTotals => {
  const subtotal = round2(input.subtotal);
  const discount = round2(input.discount || 0);
  const shippingFee = round2(input.shippingFee || 0);

  const lines = input.lines || [];
  let gross = 0;
  let gst = 0;

  if (lines.length > 0) {
    // Discount is spread across lines in proportion to their gross value.
    for (const line of lines) {
      const lineGross = round2(line.gross);
      const lineDiscount = subtotal > 0 ? round2((discount * lineGross) / subtotal) : 0;
      const lineNet = round2(lineGross - lineDiscount);
      const lineTaxable = grossToTaxable(lineNet, line.ratePercent ?? DEFAULT_GST_RATE_PERCENT);
      gross = round2(gross + lineGross);
      gst = round2(gst + (lineNet - lineTaxable));
    }
  } else {
    // No item detail (legacy orders): fall back to the stored order.tax.
    gross = subtotal;
    gst = round2(input.fallbackGst || 0);
  }

  const shippingRate = input.shippingGstRatePercent || 0;
  const shippingGst =
    shippingRate > 0 && shippingFee > 0 ? round2(shippingFee - grossToTaxable(shippingFee, shippingRate)) : 0;

  // `taxable` is derived from gst rather than summed independently, so the two
  // can never disagree by a paisa after per-line rounding.
  const taxable = round2(subtotal - discount - gst);

  return { gross, taxable, gst, shippingGst };
};

/** Format an amount the way it appears on the invoice: `1,234.00`. */
export const formatInvoiceAmount = (value: number | string | null | undefined): string =>
  (Number(value) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });