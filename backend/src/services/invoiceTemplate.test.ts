import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOrderTotals,
  formatInvoiceAmount,
  grossToGst,
  grossToTaxable,
  round2,
  splitGst,
} from '@meruveda/shared';
import { wrapText } from './invoiceService';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * Money / GST contract tests.
 *
 * These encode the reference invoice's rules:
 *   - prices are GST-INCLUSIVE at 5%  ->  699 contains 33.29 of tax
 *   - GST is charged on goods only, shipping is added flat on top
 *   - Rajasthan (08) -> CGST + SGST, everywhere else -> IGST
 *   - the printed rows must reconcile with TOTAL to the paisa
 */

test('gross -> taxable/GST for the reference case (699 @ 5%)', () => {
  assert.equal(grossToTaxable(699, 5), 665.71);
  assert.equal(grossToGst(699, 5), 33.29);
  // And the pair always re-adds to the gross.
  for (const gross of [699, 1, 99.99, 1299, 3499.5]) {
    assert.equal(round2(grossToTaxable(gross, 5) + grossToGst(gross, 5)), round2(gross), `gross ${gross}`);
  }
});

test('12% and 18% rates work the same way', () => {
  assert.equal(grossToTaxable(1180, 12), 1053.57);
  assert.equal(grossToGst(1180, 12), 126.43);
  assert.equal(grossToGst(1180, 18), 180);
});

test('intra-state split halves sum EXACTLY to the tax total', () => {
  // 10.01 is the classic case: rounding both halves independently gave
  // 5.01 + 5.01 = 10.02 and the invoice stopped reconciling.
  const s = splitGst(10.01, 'Rajasthan');
  assert.equal(s.mode, 'intra');
  assert.equal(round2(s.cgst + s.sgst), 10.01);

  for (const total of [33.29, 10.01, 0.01, 1.005, 66.58, 126.43, 999.99]) {
    const r = splitGst(total, 'Rajasthan');
    assert.equal(round2(r.cgst + r.sgst), round2(total), `split of ${total}`);
    assert.equal(r.sgst, round2(round2(total) - r.cgst));
  }
});

test('inter-state and unknown states print a single IGST line', () => {
  for (const state of ['Maharashtra', '', null, undefined, 'Delhi']) {
    const s = splitGst(33.29, state);
    assert.equal(s.mode, 'inter');
    assert.equal(s.igst, 33.29);
    assert.equal(s.cgst, 0);
    assert.equal(s.sgst, 0);
  }
});

test('order totals reconcile: taxable + GST + shipping === total', () => {
  const cases = [
    { name: '1 item, no shipping', subtotal: 699, discount: 0, shippingFee: 0, gst: 33.29 },
    { name: '1 item + shipping', subtotal: 699, discount: 0, shippingFee: 50, gst: 33.29 },
    { name: 'multi item', subtotal: 699 + 1299 + 3499, discount: 0, shippingFee: 0, gst: 261.76 },
    { name: 'discount', subtotal: 699 + 1299, discount: 200, shippingFee: 0, gst: 85.52 },
    { name: 'discount + shipping', subtotal: 699, discount: 99, shippingFee: 100, gst: 28.62 },
  ];

  // GST is summed per line after each line is rounded to 2dp, so the total can
  // differ from the aggregate figure by a few paisa. That is intentional: the
  // printed per-row "Taxed" values must add up to the printed GST line.
  for (const c of cases) {
    const lines = [];
    let remaining = c.subtotal;
    while (remaining > 0.005) {
      const gross = remaining > 699 ? 699 : round2(remaining);
      lines.push({ gross, ratePercent: 5 });
      remaining = round2(remaining - gross);
    }
    const t = computeOrderTotals({
      subtotal: c.subtotal,
      discount: c.discount,
      shippingFee: c.shippingFee,
      lines,
    });
    const total = round2(c.subtotal - c.discount + c.shippingFee);
    assert.equal(
      round2(t.taxable + t.gst + c.shippingFee),
      total,
      `${c.name}: taxable ${t.taxable} + gst ${t.gst} + ship ${c.shippingFee} !== ${total}`
    );
    const expectedGst = round2(
      lines.reduce((sum, l) => {
        const d = c.subtotal > 0 ? round2((c.discount * l.gross) / c.subtotal) : 0;
        return sum + (round2(l.gross - d) - grossToTaxable(round2(l.gross - d), 5));
      }, 0)
    );
    assert.equal(t.gst, expectedGst, `${c.name}: GST`);
    assert.equal(t.gross, c.subtotal, `${c.name}: gross`);
    // Shipping must never be folded into the taxable base — that double-counted it.
    assert.ok(t.taxable <= round2(c.subtotal - c.discount), `${c.name}: taxable excludes shipping`);
  }
});

test('shipping GST is only included when the flag asks for it', () => {
  const base = { subtotal: 1000, discount: 0, lines: [{ gross: 1000, ratePercent: 5 }] };

  // Flag OFF: GST on goods only, shipping is a flat GST-inclusive charge.
  const flat = computeOrderTotals({ ...base, shippingFee: 50 });
  assert.equal(flat.gst, 47.62, 'GST on goods only');
  assert.equal(flat.shippingGst, 0);
  assert.equal(round2(flat.taxable + flat.gst + 50), 1050);

  // Flag ON: the shipping charge carries its own 18% GST, reported separately
  // rather than added to the goods GST (it is already inside the charge).
  const withShippingGst = computeOrderTotals({
    ...base,
    shippingFee: 59, // 50 + 18% charged on top
    shippingGstRatePercent: 18,
  });
  assert.equal(withShippingGst.gst, 47.62, 'goods GST unchanged');
  assert.equal(withShippingGst.shippingGst, 9, 'shipping GST reported separately');
  assert.equal(
    round2(withShippingGst.taxable + withShippingGst.gst + 59),
    round2(1000 + 59),
    'taxable + GST + the charged shipping === what the customer paid'
  );
});

test('formatInvoiceAmount renders the reference grouping', () => {
  assert.equal(formatInvoiceAmount(0), '0.00');
  assert.equal(formatInvoiceAmount(699), '699.00');
  assert.equal(formatInvoiceAmount(1234.5), '1,234.50');
  assert.equal(formatInvoiceAmount(1234567.891), '12,34,567.89');
  assert.equal(formatInvoiceAmount(null), '0.00');
});

test('wrapText wraps instead of truncating (replaces the old slice())', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const long = 'Keharsh Enterprises Sole Proprietorship S/N 12 Viru City Gym Road Inside Jalori Gate Jodhpur Rajasthan 342001 India';
  const lines = wrapText(font, long, 8.5, 160);

  assert.ok(lines.length > 1, 'long text must wrap onto several lines');
  for (const line of lines) {
    assert.ok(
      font.widthOfTextAtSize(line, 8.5) <= 160,
      `"${line}" is wider than the column — it must wrap, not overflow`
    );
  }
  // Nothing was lost.
  assert.equal(lines.join(' ').replace(/\s+/g, ' '), long);

  // A single word longer than the column is kept whole rather than chopped.
  const single = wrapText(font, 'Supercalifragilistic', 8.5, 10);
  assert.deepEqual(single, ['Supercalifragilistic']);
});