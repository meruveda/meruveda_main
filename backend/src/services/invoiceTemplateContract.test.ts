/**
 * Template contract for the ONE invoice document.
 *
 * Requirement: "one invoice, one template, everywhere" — the same PDF for the
 * WhatsApp auto-send, the customer download and the admin view. These tests pin
 * the structural elements of the reference layout so that:
 *   - a second/older template cannot quietly appear alongside this one, and
 *   - an element of the reference (logo, gold INVOICE wordmark, meta box, seller
 *     block + GSTIN, BILL TO, SKU/Taxed columns, Taxable/GST totals, notes box,
 *     PAID/COD wording, footer) cannot be dropped in a refactor.
 *
 * PDF text is stored compressed inside content streams, so the assertions decode
 * the streams rather than searching the raw bytes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import path from 'path';
import zlib from 'zlib';
import { generateInvoicePdf } from './invoiceService';

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
  payu_mihpayid: '',
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

/**
 * Pull every string drawn on the page out of a generated PDF.
 *
 * Two things make this non-trivial:
 *   - content streams are Flate-compressed, and the embedded logo is binary that
 *     can itself contain the bytes "stream"/"endstream", so offsets cannot be
 *     trusted; each candidate is inflated and kept only if it decodes to a real
 *     content stream (one containing PDF text operators).
 *   - pdf-lib writes drawn text as HEX strings — `<4D45525556454441...> Tj` — not
 *     as literal `(text)`, so a naive search for the words finds nothing at all.
 */
function drawnText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const streams: string[] = [];

  const looksLikeContent = (s: string) => /\bT[jJ]\b/.test(s) || /(^|\s)BT(\s|$)/.test(s);

  const MARKER = 'stream\n';
  let cursor = 0;
  for (;;) {
    const at = raw.indexOf(MARKER, cursor);
    if (at < 0) break;
    if (raw.slice(Math.max(0, at - 3), at).endsWith('end')) {
      cursor = at + MARKER.length;
      continue;
    }

    const dict = raw.slice(Math.max(0, at - 300), at);
    const declared = /\/Length\s+(\d+)/.exec(dict);
    const start = at + MARKER.length;
    const endAt = raw.indexOf('endstream', start);

    const candidates: number[] = [];
    if (declared) candidates.push(Number(declared[1]));
    if (endAt > start) candidates.push(endAt - start);
    candidates.push(65536);

    for (const len of candidates) {
      if (len <= 0) continue;
      let text: string;
      try {
        text = zlib.inflateSync(Buffer.from(raw.slice(start, start + len), 'latin1')).toString('latin1');
      } catch {
        continue; // wrong length, try the next candidate
      }
      if (looksLikeContent(text)) {
        streams.push(text);
        break;
      }
    }
    cursor = endAt > start ? endAt + 9 : at + MARKER.length;
  }

  // Decode <hex> Tj / TJ operands, plus any literal (text) Tj for completeness.
  const decoded: string[] = [];
  for (const stream of streams) {
    for (const m of stream.matchAll(/<([0-9A-Fa-f\s]+)>\s*T[jJ]/g)) {
      const hex = m[1].replace(/\s+/g, '');
      if (hex.length % 2 !== 0) continue;
      let out = '';
      for (let i = 0; i < hex.length; i += 2) {
        out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
      decoded.push(out);
    }
    for (const m of stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      decoded.push(m[1].replace(/\\(.)/g, '$1'));
    }
  }
  return decoded.join('\n');
}

test('the invoice renders every element of the reference template', async () => {
  const pdf = await generateInvoicePdf(ORDER as any);
  const text = drawnText(pdf);

  // Wordmark + meta box
  assert.match(text, /INVOICE/);
  assert.match(text, /DATE/);
  assert.match(text, /INVOICE #/);
  assert.match(text, /ORDER #/);
  assert.match(text, /DUE DATE/);

  // Seller identity. GSTIN digits are drawn as separate runs in some fonts, so
  // assert on a distinctive fragment rather than the whole 15-char string.
  assert.match(text, /08BFPPS7045C1Z4|08BFPPS7045C1Z/);

  // Bill-to card
  assert.match(text, /BILL TO/);
  assert.match(text, /Madhya Pradesh/);

  // Item table columns
  assert.match(text, /Description/);
  assert.match(text, /SKU/);
  assert.match(text, /Qty/);
  assert.match(text, /Taxed/);
  assert.match(text, /Joint Pain Oil/);
  assert.match(text, /SKU-9C974179/);

  // Totals block. Madhya Pradesh is out of state, so this must be IGST — never
  // CGST/SGST. This is the assertion that would catch a seller-state regression.
  assert.match(text, /Taxable/);
  assert.match(text, /IGST/);
  assert.doesNotMatch(text, /CGST/);
  assert.doesNotMatch(text, /SGST/);
  assert.match(text, /Shipping/);
  assert.match(text, /TOTAL/);

  // Notes box + payment wording
  assert.match(text, /OTHER COMMENTS & NOTES/);
  assert.match(text, /PAYMENT DETAILS/);

  // Footer
  assert.match(text, /Thank You For Your Business!/);
});

test('the totals block reconciles: Taxable + IGST === Subtotal, + Shipping === TOTAL', async () => {
  const text = drawnText(await generateInvoicePdf(ORDER as any));

  // Pull the amounts straight off the rendered document. Column values follow
  // their labels, so find each label and take the next money-looking token.
  const moneyAfter = (label: string) => {
    const at = text.indexOf(label);
    assert.notEqual(at, -1, `missing totals row: ${label}`);
    const rest = text.slice(at + label.length);
    const m = /Rs\.\s*([\d,]+\.\d{2})/.exec(rest);
    assert.ok(m, `no amount after "${label}"`);
    return Number(m[1].replace(/,/g, ''));
  };

  const subtotal = moneyAfter('Subtotal');
  const taxable = moneyAfter('Taxable');
  const igst = moneyAfter('IGST');
  const shipping = moneyAfter('Shipping');
  const total = moneyAfter('TOTAL');

  assert.equal(subtotal, 998, '2 x 499');
  assert.equal(taxable, 950.48, 'Taxable is EXCLUDING tax, matching the per-line Taxed column');
  assert.equal(igst, 47.52, 'IGST at 5% grossed up from 998');
  assert.equal(shipping, 100);
  assert.equal(total, 1098);

  // The whole point of a tax invoice: these must add up, on the document.
  assert.equal(taxable + igst, subtotal, 'Taxable + IGST must equal the Subtotal');
  assert.equal(subtotal + shipping, total, 'Subtotal + Shipping must equal the TOTAL');

  // And the per-line "Taxed" column must agree with the Taxable row.
  const lineTaxed = moneyAfter('Taxed');
  assert.equal(lineTaxed, taxable, 'line Taxed column must match the Taxable row');
});

test('COD invoices are NOT stamped PAID, prepaid ones are', async () => {
  const cod = drawnText(await generateInvoicePdf(ORDER as any));
  // COD is unpaid until delivery, so a PAID stamp would be a false document.
  assert.doesNotMatch(cod, /(^|[^A-Z])PAID([^A-Z]|$)/);
  assert.match(cod, /Cash On Delivery|Cash on Delivery/i);

  const prepaid = drawnText(
    await generateInvoicePdf({
      ...ORDER,
      payment_method: 'PayOnline (via PayU)',
      payment_status: 'paid',
      payu_mihpayid: '29972971247',
    } as any)
  );
  assert.match(prepaid, /PAID/);
  // The PayU reference goes in the notes box, not concatenated into order notes.
  assert.match(prepaid, /29972971247/);
});

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
  // These render *components*, not PDFs. A template here is what produced the
  // bug where "Download invoice" silently printed the orders page instead.
  const candidates = [
    'frontend/src/app/account/orders/[id]/page.tsx',
    'frontend/src/app/account/orders/page.tsx',
    'frontend/src/app/account/orders/page.tsx',
    'admin/src/pages/orders/OrderDetailPage.tsx',
  ];
  for (const rel of new Set(candidates)) {
    const file = path.resolve(__dirname, '../../..', rel);
    const code = readFileSync(file, 'utf8')
      // Strip comments: the code deliberately *documents* the removed behaviour.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    assert.doesNotMatch(code, /window\.print\(/, `${rel} must not render via the print dialog`);
    assert.doesNotMatch(code, /print=1/, `${rel} must not drive an invoice print route`);
    assert.doesNotMatch(
      code,
      /hidden print:block/,
      `${rel} must not contain a print-only invoice template`
    );
  }
});