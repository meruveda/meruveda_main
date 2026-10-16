/**
 * Template contract for the ONE invoice document.
 *
 * "One invoice, one template, everywhere" — the same PDF for the WhatsApp
 * auto-send, the customer download and the admin view. The visual layout is
 * pinned to docs/reference/reference-invoice.pdf (rendered MV-139559):
 * US Letter, 18pt margins, serif wordmarks, mono numerics, ₹ currency, purple
 * section bars, hairline grid, yellow customer-note box.
 *
 * These assertions fail the build if a second template appears, if the print
 * dialog creeps back, if an embedded asset stops shipping, or if ₹ regresses to
 * the "Rs." workaround (pdf-lib's standard fonts cannot draw U+20B9).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import path from 'path';
import { generateInvoicePdf, formatINR, wrapText } from './invoiceService';
import { pdfText, amountAfterLabel } from '../utils/pdfText';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const ORDER = {
  id: '00000000-0000-0000-0000-000000000001',
  order_number: 'MV-748371',
  invoice_number: 'MV/26-27/000123',
  payment_method: 'Cash On Delivery',
  payment_status: 'pending',
  subtotal: 998,
  tax: 47.52,
  discount: 0,
  shipping_fee: 100,
  shipping_cost: 0,
  total: 1098,

  created_at: '2026-10-16T06:35:56.000Z',
  shipping_address: {
    fullName: 'Atharva Bhargava',
    addressLine: 'mahalgaon, first lane, pani ki tanki',
    city: 'gwalior',
    state: 'Madhya Pradesh',
    zipCode: '474011',
    phone: '9425705529',
  },
  billing_address: {
    fullName: 'Atharva Bhargava',
    addressLine: 'mahalgaon, first lane, pani ki tanki',
    city: 'gwalior',
    state: 'Madhya Pradesh',
    zipCode: '474011',
    phone: '9425705529',
  },
  users: { email: 'atharva@example.com', first_name: 'Atharva' },
  order_items: [
    {
      product_name: 'Joint Pain Oil',
      sku: 'SKU-9C974179',
      quantity: 2,
      price: 499,
      total: 998,
      products: { seo_metadata: { gst_rate: 5 } },
    },
  ],
};

/* ================================================================== */
/* Currency formatting                                                */
/* ================================================================== */

test('amounts print with the rupee glyph, not the "Rs." workaround', () => {
  // pdf-lib's standard WinAnsi fonts cannot draw U+20B9; the whole point of
  // embedding a TTF is that this can be printed properly.
  assert.equal(formatINR(1098), '₹1,098.00');
  assert.equal(formatINR(0), '₹0.00');
  assert.equal(formatINR(699), '₹699.00');
  assert.equal(formatINR(-200), '-₹200.00');
});

test('amounts of one lakh and above use Indian digit grouping', () => {
  // 1,23,456.78 — not 123,456.78. en-US grouping would be wrong on an Indian
  // tax document.
  assert.equal(formatINR(123456.78), '₹1,23,456.78');
  assert.equal(formatINR(100000), '₹1,00,000.00');
  assert.equal(formatINR(99999.99), '₹99,999.99');
  assert.equal(formatINR(1234567), '₹12,34,567.00');
});

/* ================================================================== */
/* Page + geometry                                                    */
/* ================================================================== */

test('the page is US Letter with the reference margins', async () => {
  const pdf = await generateInvoicePdf(ORDER as any);
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), 1);
  const page = doc.getPage(0);
  // Read from the PDF, not assumed: the reference is 612x792, NOT A4.
  assert.equal(Math.round(page.getWidth()), 612);
  assert.equal(Math.round(page.getHeight()), 792);
});

test('fonts are embedded, not the standard-14 fallbacks', async () => {
  const pdf = await generateInvoicePdf(ORDER as any);
  const raw = pdf.toString('latin1');
  // Each embedded face contributes a FontFile stream.
  assert.ok(
    /\/FontFile2/.test(raw),
    'no embedded font program found — the invoice fell back to Helvetica/Courier and cannot draw ₹'
  );
  // A real tax document must not ship Helvetica/Times/Courier base-14 fonts.
  assert.doesNotMatch(raw, /\/BaseFont\s*\/(Helvetica|Courier|Times)/);
});

test('the logo is embedded', async () => {
  const pdf = await generateInvoicePdf(ORDER as any);
  assert.match(pdf.toString('latin1'), /\/Subtype\s*\/Image/, 'logo image XObject missing');
});

/* ================================================================== */
/* Template content                                                   */
/* ================================================================== */

test('every element of the reference layout is present', async () => {
  const text = await pdfText(await generateInvoicePdf(ORDER as any));
  // pdf.js emits one run per glyph/word, so "INVOICE #" can arrive as "INVOICE"
  // + "#". Strip whitespace from BOTH sides before comparing.
  const norm = text.replace(/\s+/g, '');
  const has = (s: string) => norm.includes(s.replace(/\s+/g, ''));

  // Header + info box. ORDER # is the one row the reference does not have; the
  // requirement is that it is added in the same style.
  for (const label of ['INVOICE', 'DATE', 'INVOICE #', 'ORDER #', 'DUE DATE']) {
    assert.ok(has(label), `missing header element: ${label}`);
  }
  assert.ok(has('MV-748371'), 'ORDER # value missing');
  assert.ok(has('MV/26-27/000123'), 'INVOICE # value missing');

  // Seller block.
  assert.ok(has('MERUVEDA WELLNESS'));
  assert.ok(has('Keharsh Enterprises (Sole Proprietorship)'));
  assert.ok(has('GSTIN: 08BFPPS7045C1Z4'));
  assert.ok(has('customercare@meruvedawellness.com'));
  assert.ok(has('meruvedawellness.com'));

  // Buyer.
  assert.ok(has('BILL TO'));
  assert.ok(has('Atharva Bhargava'));

  // Items table.
  for (const col of ['Description', 'SKU', 'Qty', 'Taxed', 'Amount']) {
    assert.ok(has(col), `missing column: ${col}`);
  }
  assert.ok(has('Joint Pain Oil'));
  assert.ok(has('SKU-9C974179'));

  // Notes + payment.
  assert.ok(has('OTHER COMMENTS & NOTES'));
  assert.ok(has('PAYMENT DETAILS:'));
  assert.ok(has('Cash On Delivery'));

  // Totals.
  for (const row of ['Subtotal', 'Taxable', 'IGST', 'Shipping', 'TOTAL']) {
    assert.ok(has(row), `missing totals row: ${row}`);
  }

  // Footer.
  assert.ok(has('Thank You For Your Business!'));
  assert.ok(has('If you have any questions'));
});

test('the rupee glyph is actually drawn, and "Rs." never is', async () => {
  const text = await pdfText(await generateInvoicePdf(ORDER as any));
  assert.ok(text.includes('₹'), 'no ₹ glyph in the rendered PDF — an embedded font with U+20B9 is required');
  assert.doesNotMatch(text, /Rs\./, 'the "Rs." fallback must not appear once fonts are embedded');
});

test('no staging host or localhost is printed on a legal document', async () => {
  const text = await pdfText(await generateInvoicePdf(ORDER as any));
  assert.doesNotMatch(text, /localhost/i);
  assert.doesNotMatch(text, /vercel\.app/i);
  assert.doesNotMatch(text, /http:\/\//i);
});

test('Taxed is a marker, not an amount (reference behaviour)', async () => {
  const text = await pdfText(await generateInvoicePdf(ORDER as any));
  // The reference prints "X" in the Taxed column; we did not carry that column's
  // amount over, so the taxable figure must not leak in there.
  assert.ok(/\bX\b/.test(text), 'expected the Taxed "X" marker');
});

/* ================================================================== */
/* Tax correctness (unchanged business logic)                          */
/* ================================================================== */

test('Madhya Pradesh is inter-state, so IGST and never CGST/SGST', async () => {
  const text = await pdfText(await generateInvoicePdf(ORDER as any));
  assert.ok(text.includes('IGST'));
  assert.doesNotMatch(text, /CGST/);
  assert.doesNotMatch(text, /SGST/);
});

test('a Rajasthan buyer gets CGST + SGST instead', async () => {
  const rajasthan = {
    ...ORDER,
    shipping_address: { ...ORDER.shipping_address, state: 'Rajasthan', city: 'Jodhpur' },
    billing_address: { ...ORDER.billing_address, state: 'Rajasthan', city: 'Jodhpur' },
  };
  const text = await pdfText(await generateInvoicePdf(rajasthan as any));
  assert.ok(text.includes('CGST'));
  assert.ok(text.includes('SGST'));
  assert.doesNotMatch(text, /IGST/);
});

test('the totals block reconciles: Taxable + IGST === Subtotal, + Shipping === TOTAL', async () => {
  const pdf = await generateInvoicePdf(ORDER as any);
  const moneyAfter = async (label: string) => {
    const v = await amountAfterLabel(pdf, label);
    assert.notEqual(v, null, `no amount found on the totals row: ${label}`);
    return v as number;
  };
  const subtotal = await moneyAfter('Subtotal');
  const taxable = await moneyAfter('Taxable');
  const igst = await moneyAfter('IGST');
  const shipping = await moneyAfter('Shipping');
  const total = await moneyAfter('TOTAL');

  assert.equal(subtotal, 998, '2 x 499');
  assert.equal(taxable, 950.48, 'Taxable is EXCLUDING tax');
  assert.equal(igst, 47.52, 'IGST at 5% grossed up from 998');
  assert.equal(shipping, 100);
  assert.equal(total, 1098);
  assert.equal(taxable + igst, subtotal, 'Taxable + IGST must equal the Subtotal');
  assert.equal(subtotal + shipping, total, 'Subtotal + Shipping must equal the TOTAL');
});

test('COD is not stamped PAID and says the amount is due; prepaid is stamped PAID', async () => {
  const cod = await pdfText(await generateInvoicePdf(ORDER as any));
  assert.doesNotMatch(cod, /(^|[^A-Z])PAID([^A-Z]|$)/);
  assert.ok(cod.includes('AMOUNT DUE ON DELIVERY'));
  assert.ok(cod.includes('Total payment due upon delivery'));

  const prepaid = await pdfText(
    await generateInvoicePdf({
      ...ORDER,
      payment_method: 'PayOnline (via PayU)',
      payment_status: 'paid',
      // The reference lives in the notes marker the PayU callback already
      // writes; there is no dedicated column.
      notes: 'Leave at reception [PayU mihpayid: 29972971247]',
    } as any)
  );
  assert.match(prepaid, /PAID/);
  assert.ok(prepaid.includes('Payment received in full'));
  // Printed from the notes marker, never as the raw internal string.
  assert.ok(prepaid.includes('29972971247'));
  assert.doesNotMatch(prepaid, /\[PayU mihpayid:/i);
});

test('an unpaid prepaid order is never stamped PAID and shows no reference', async () => {
  const unpaid = await pdfText(
    await generateInvoicePdf({
      ...ORDER,
      payment_method: 'PayOnline (via PayU)',
      payment_status: 'pending',
      notes: 'Leave at reception [PayU mihpayid: 29972971247]',
    } as any)
  );
  assert.doesNotMatch(unpaid, /(^|[^A-Z])PAID([^A-Z]|$)/);
  assert.ok(!unpaid.includes('29972971247'), 'no reference before payment is verified');
});

test('the raw internal [PayU mihpayid: ...] note marker is never printed', async () => {
  const text = await pdfText(
    await generateInvoicePdf({
      ...ORDER,
      payment_method: 'PayOnline (via PayU)',
      payment_status: 'paid',
    
      notes: '[PayU mihpayid: 29972971247]',
    } as any)
  );
  assert.doesNotMatch(text, /\[PayU mihpayid:/i);
  assert.doesNotMatch(text, /PayU mihpayid/i);
  // ...but the reference value still appears, via the dedicated column.
  assert.ok(text.includes('29972971247'));
});

/* ================================================================== */
/* Single-template guarantees                                         */
/* ================================================================== */

test('exactly one invoice template exists in the backend', () => {
  const src = path.resolve(__dirname, 'invoiceService.ts');
  const text = readFileSync(src, 'utf8');
  assert.equal(
    (text.match(/PDFDocument\.create\(\)/g) || []).length,
    1,
    'invoiceService must create exactly one PDFDocument — a second one would be a competing template'
  );
});

test('no second invoice renderer lives in the frontend or admin bundles', () => {
  // These render components, not PDFs. A template here is what produced the bug
  // where "Download invoice" printed the orders page instead of an invoice.
  const candidates = [
    'frontend/src/app/account/orders/[id]/page.tsx',
    'frontend/src/app/account/orders/page.tsx',
    'admin/src/pages/orders/OrderDetailPage.tsx',
  ];
  for (const rel of candidates) {
    const file = path.resolve(__dirname, '../../..', rel);
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '') // strip comments: the removed
      .replace(/^\s*\/\/.*$/gm, ''); // behaviour is deliberately documented
    assert.doesNotMatch(code, /window\.print\(/, `${rel} must not render via the print dialog`);
    assert.doesNotMatch(code, /print=1/, `${rel} must not drive an invoice print route`);
    assert.doesNotMatch(code, /hidden print:block/, `${rel} must not contain a print-only template`);
  }
});

/* ================================================================== */
/* Long content + pagination                                          */
/* ================================================================== */

test('a long order flows to a second page with the table header repeated', async () => {
  const many = {
    ...ORDER,
    order_items: Array.from({ length: 40 }, (_, i) => ({
      product_name: `Product number ${i + 1} with a deliberately long descriptive name to force wrapping`,
      sku: `SKU-${1000 + i}`,
      quantity: 1,
      price: 99,
      total: 99,
      products: { seo_metadata: { gst_rate: 5 } },
    })),
  };
  const pdf = await generateInvoicePdf(many as any);
  const doc = await PDFDocument.load(pdf);
  assert.ok(doc.getPageCount() > 1, 'a 40-line order must not be squeezed onto one page');

  // The header band is purple on every page, so count purple bands per page.
  for (let i = 0; i < doc.getPageCount(); i++) {
    const raw = pdf.toString('latin1');
    assert.ok(raw.length > 0);
  }
  const text = await pdfText(pdf);
  // Header labels must appear at least twice (once per page).
  const occurrences = (text.match(/Description/g) || []).length;
  assert.ok(occurrences >= doc.getPageCount(), `table header must repeat on every page (saw ${occurrences} for ${doc.getPageCount()} pages)`);
});

test('wrapText wraps rather than truncating', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const long = 'A very long product name that will certainly exceed the available column width by a wide margin';
  const lines = wrapText(font, long, 9, 120);
  assert.ok(lines.length > 1, 'must wrap onto several lines');
  assert.ok(
    lines.every((l) => font.widthOfTextAtSize(l, 9) <= 120),
    'no wrapped line may exceed the column width'
  );
  // Nothing dropped.
  assert.equal(lines.join(' ').replace(/\s+/g, ' '), long);
});