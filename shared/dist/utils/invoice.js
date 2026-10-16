"use strict";
/**
 * Invoice + GST helpers shared by the backend, the storefront and the admin.
 *
 * Everything invoice-related that must agree across packages lives here so the
 * PDF, the checkout summary and the admin can never drift apart.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatInvoiceAmount = exports.computeOrderTotals = exports.splitGst = exports.grossToGst = exports.grossToTaxable = exports.round2 = exports.formatInvoiceNumber = exports.invoiceFyLabel = exports.isIntraState = exports.isRajasthan = exports.DEFAULT_GST_RATE_PERCENT = exports.SELLER_GSTIN = exports.SELLER_STATE = exports.SELLER_STATE_CODE = void 0;
/** Seller state code — Meruveda is registered in Rajasthan (08). */
exports.SELLER_STATE_CODE = '08';
exports.SELLER_STATE = 'Rajasthan';
/** GSTIN printed on every tax invoice. */
exports.SELLER_GSTIN = '08BFPPS7045C1Z4';
/** Default GST rate applied when a product carries no explicit rate. */
exports.DEFAULT_GST_RATE_PERCENT = 5;
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
const isRajasthan = (state) => {
    const s = String(state ?? '').trim().toLowerCase();
    if (!s)
        return false;
    if (RAJASTHAN_ALIASES.has(s))
        return true;
    return s.startsWith('raj') && s.length >= 5;
};
exports.isRajasthan = isRajasthan;
/** True when the buyer is in the seller's own state (CGST + SGST). */
const isIntraState = (state) => (0, exports.isRajasthan)(state);
exports.isIntraState = isIntraState;
/**
 * Indian financial year label for a date. April 1 - March 31, named after the
 * year it starts in: April 2026 -> "26-27", March 2027 -> "26-27".
 *
 * Evaluated in IST (UTC+05:30) so the FY boundary is the Indian one no matter
 * what timezone the server runs in. An invoice generated at 23:00 UTC on
 * 31 March is already 1 April in India and belongs to the new series.
 */
const invoiceFyLabel = (date = new Date()) => {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
    const year = ist.getUTCFullYear();
    const month = ist.getUTCMonth() + 1; // 1..12
    const startYear = month >= 4 ? year : year - 1;
    const yy = (y) => String(y % 100).padStart(2, '0');
    return `${yy(startYear)}-${yy(startYear + 1)}`;
};
exports.invoiceFyLabel = invoiceFyLabel;
/** Full GST-series invoice number, e.g. `MV/26-27/000123`. */
const formatInvoiceNumber = (fy, seq) => `MV/${fy}/${String(seq).padStart(6, '0')}`;
exports.formatInvoiceNumber = formatInvoiceNumber;
/** Round to 2dp without float drift (699 * 5 / 105 === 33.29, not 33.289999). */
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
exports.round2 = round2;
/**
 * GST-inclusive gross -> the taxable value inside it.
 *
 * A 699.00 line at 5% contains 33.29 of tax, leaving 665.71 taxable.
 */
const grossToTaxable = (gross, ratePercent = exports.DEFAULT_GST_RATE_PERCENT) => (0, exports.round2)((Number(gross) || 0) * (100 / (100 + (Number(ratePercent) || 0))));
exports.grossToTaxable = grossToTaxable;
/** GST contained in a gross (taxable-inclusive) amount. */
const grossToGst = (gross, ratePercent = exports.DEFAULT_GST_RATE_PERCENT) => {
    const g = Number(gross) || 0;
    return (0, exports.round2)(g - (0, exports.grossToTaxable)(g, ratePercent));
};
exports.grossToGst = grossToGst;
/**
 * Split an order's total GST into the intra-state (CGST + SGST) or
 * inter-state (IGST) presentation.
 *
 * For intra-state the SECOND half is derived by subtraction
 * (`sgst = total - cgst`) rather than both halves being rounded
 * independently, so the two printed rows always sum back to the tax total and
 * the invoice reconciles with TOTAL to the paisa.
 */
const splitGst = (totalGst, state) => {
    const total = (0, exports.round2)(totalGst);
    if ((0, exports.isIntraState)(state)) {
        // Round the first half to 2dp, then give the remainder to SGST.
        const cgst = (0, exports.round2)(total / 2);
        return { mode: 'intra', cgst, sgst: (0, exports.round2)(total - cgst), igst: 0 };
    }
    return { mode: 'inter', cgst: 0, sgst: 0, igst: total };
};
exports.splitGst = splitGst;
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
const computeOrderTotals = (input) => {
    const subtotal = (0, exports.round2)(input.subtotal);
    const discount = (0, exports.round2)(input.discount || 0);
    const shippingFee = (0, exports.round2)(input.shippingFee || 0);
    const lines = input.lines || [];
    let gross = 0;
    let gst = 0;
    if (lines.length > 0) {
        // Discount is spread across lines in proportion to their gross value.
        for (const line of lines) {
            const lineGross = (0, exports.round2)(line.gross);
            const lineDiscount = subtotal > 0 ? (0, exports.round2)((discount * lineGross) / subtotal) : 0;
            const lineNet = (0, exports.round2)(lineGross - lineDiscount);
            const lineTaxable = (0, exports.grossToTaxable)(lineNet, line.ratePercent ?? exports.DEFAULT_GST_RATE_PERCENT);
            gross = (0, exports.round2)(gross + lineGross);
            gst = (0, exports.round2)(gst + (lineNet - lineTaxable));
        }
    }
    else {
        // No item detail (legacy orders): fall back to the stored order.tax.
        gross = subtotal;
        gst = (0, exports.round2)(input.fallbackGst || 0);
    }
    const shippingRate = input.shippingGstRatePercent || 0;
    const shippingGst = shippingRate > 0 && shippingFee > 0 ? (0, exports.round2)(shippingFee - (0, exports.grossToTaxable)(shippingFee, shippingRate)) : 0;
    // `taxable` is derived from gst rather than summed independently, so the two
    // can never disagree by a paisa after per-line rounding.
    const taxable = (0, exports.round2)(subtotal - discount - gst);
    return { gross, taxable, gst, shippingGst };
};
exports.computeOrderTotals = computeOrderTotals;
/** Format an amount the way it appears on the invoice: `1,234.00`. */
const formatInvoiceAmount = (value) => (Number(value) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});
exports.formatInvoiceAmount = formatInvoiceAmount;
