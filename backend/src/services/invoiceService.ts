import { readFileSync } from 'fs';
import path from 'path';
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  Color,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  rgb,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  computeOrderTotals,
  formatInvoiceAmount,
  formatInvoiceNumber,
  grossToGst,
  grossToTaxable,
  invoiceFyLabel,
  isIntraState,
  round2,
  splitGst,
} from '@meruveda/shared';
import { supabase } from '../database/supabase';
import { config, storefrontUrl } from '../config/env';
import {
  allocateInvoiceNumber,
  claimInvoice,
  freshChannelState,
  patchChannel,
  readInvoiceState,
  writeInvoiceState,
} from './invoiceStore';

/** Per-channel outcome, mirroring ChannelStatus in invoiceDispatchService. */
type ChannelOutcome = 'sent' | 'failed' | 'skipped' | 'disabled';

/* =============================================================================
 * GEOMETRY + PALETTE — sampled from docs/reference/reference-invoice.pdf
 * (rendered MV-139559), NOT eyeballed. Page is US Letter, margin 18pt.
 * ========================================================================== */
const PAGE_W = 612; // 8.5in
const PAGE_H = 792; // 11in
const MARGIN = 18;
const RIGHT = PAGE_W - MARGIN; // 594
const CONTENT_W = RIGHT - MARGIN; // 576

const hex = (h: string): Color => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const PURPLE = hex('#4c1d5b'); // BILL TO / NOTES / table header bars
const BORDER = hex('#e2e8f0'); // every hairline + row separator
const GOLD = hex('#755e16'); // INVOICE wordmark
const MAROON = hex('#2b1820'); // brand serif lines
const BODY_GREY = hex('#475569'); // seller block body
const SLATE = hex('#334155'); // table labels, notes body
const INK = hex('#0f172a'); // TOTAL row, footer email
const SLATE_DARK = hex('#1e293b'); // GSTIN, BILL TO body
const BROWN = hex('#78350f'); // customer note text
const NOTE_EDGE = hex('#fde68a'); // customer note box border
const DARK_GREY = hex('#272d37'); // "PAYMENT DETAILS:"
const WHITE = hex('#ffffff');

const HAIRLINE = 0.8;
const ITEM_ROW_H = 24.8;
const TOTAL_ROW_H = 24.8;
const TOTAL_ROW_H_BIG = 30.8;

/* Column geometry — verbatim from the reference. */
const COL = {
  desc: [MARGIN, 323.2],
  sku: [323.2, 413.2],
  qty: [413.2, 458.2],
  taxed: [458.2, 504.0],
  amount: [504.0, RIGHT],
};
const NOTES_X = MARGIN;
const NOTES_W = 276;
const TOTAL_X = 318.8;
const TOTAL_LABEL_W = 138.8;
const TOTAL_VAL_W = 136.5;

/* =============================================================================
 * ASSETS — logo + fonts. All resolved relative to the running module so the
 * same paths work from src/ and from dist/ on Vercel.
 * ========================================================================== */
function asset(candidates: string[]): Buffer | null {
  for (const c of candidates) {
    try {
      return readFileSync(c);
    } catch {
      /* next */
    }
  }
  return null;
}

// __dirname is backend/src/services or backend/dist/services.
const assetRoot = (rel: string) => [
  path.resolve(__dirname, `../assets/${rel}`), // dist/assets (copy-assets.cjs)
  path.resolve(__dirname, `../../assets/${rel}`), // assets/ (source tree)
];

const FONT_FILES = {
  serifBold: 'fonts/SourceSerif4-Bold.ttf', // stands in for Georgia Bold
  sans: 'fonts/NotoSans-Regular.ttf',
  sansBold: 'fonts/NotoSans-Bold.ttf',
  mono: 'fonts/NotoSansMono-Regular.ttf', // stands in for Consolas
  monoBold: 'fonts/NotoSansMono-Bold.ttf',
};

interface Fonts {
  serifBold: PDFFont;
  sans: PDFFont;
  sansBold: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
}

async function loadFonts(doc: PDFDocument): Promise<Fonts | null> {
  doc.registerFontkit(fontkit as any);
  const missing: string[] = [];
  const out: any = {};
  for (const [key, rel] of Object.entries(FONT_FILES)) {
    const bytes = asset(assetRoot(rel));
    if (!bytes) {
      missing.push(rel);
      continue;
    }
    try {
      out[key] = await doc.embedFont(bytes, { subset: true });
    } catch (err: any) {
      missing.push(`${rel} (${err?.message || err})`);
    }
  }
  if (missing.length) {
    console.error(
      `[Invoice] FONTS MISSING — the invoice will fall back to Helvetica/Courier and cannot draw ₹. ` +
        `Missing or unreadable: ${missing.join(', ')}. Looked under: ${assetRoot('fonts/...').join(' , ')}`
    );
    return null;
  }
  return out as Fonts;
}

/* =============================================================================
 * Seller identity
 * ========================================================================== */
const DEFAULT_SELLER = {
  name: 'MERUVEDA WELLNESS',
  legal: 'Keharsh Enterprises (Sole Proprietorship)',
  address: [
    'S/N. 12, Viru City Gym Road, Inside Jalori Gate,',
    'Jodhpur - 342001, Rajasthan, India',
  ],
  phone: '+91 8097147463',
  email: 'customercare@meruvedawellness.com',
  // Real production domain. `storefrontUrl` defaults to
  // https://meruvedawellness.com and only honours FRONTEND_URL when it is set
  // and is not a local dev host — a legal document must never print localhost.
  website: storefrontUrl.replace(/^https?:\/\//, ''),
  gstin: '08BFPPS7045C1Z4',
};

let warnedMissingBusinessEnv = false;

export function getSellerIdentity() {
  const address = config.businessAddress || DEFAULT_SELLER.address.join('\n');
  const gstin = config.businessGstin || DEFAULT_SELLER.gstin;
  const phone = config.businessPhone || DEFAULT_SELLER.phone;
  if (!warnedMissingBusinessEnv && (!config.businessName || !config.businessGstin)) {
    warnedMissingBusinessEnv = true;
    console.error(
      '[Invoice] BUSINESS_NAME / BUSINESS_GSTIN not fully set — using built-in defaults. ' +
        'Set them in the Vercel environment before going live.'
    );
  }
  return {
    name: (config.businessName || DEFAULT_SELLER.name).toUpperCase(),
    legal: DEFAULT_SELLER.legal,
    address: address.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    phone,
    email: config.businessEmail || DEFAULT_SELLER.email,
    website: DEFAULT_SELLER.website,
    gstin,
  };
}

/* =============================================================================
 * Text helpers
 * ========================================================================== */

/** Greedy word wrap that never truncates. */
export function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of String(text ?? '').split(/\r?\n/)) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Indian digit grouping: 1,23,456.78 (last three, then pairs).
 *
 * The reference prints ₹699.00 because the amount is small; anything at or above
 * one lakh must group as 1,23,456.00, which toLocaleString('en-IN') would render
 * but standard en-US formatting would not.
 */
export function formatINR(value: number): string {
  const v = round2(Number(value) || 0);
  const negative = v < 0;
  const [whole, frac = '00'] = Math.abs(v).toFixed(2).split('.');
  let grouped = whole;
  if (whole.length > 3) {
    const last3 = whole.slice(-3);
    const rest = whole.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  return `${negative ? '-' : ''}₹${grouped}.${frac}`;
}

/** Reference date format: M/D/YYYY. */
function fmtDate(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const y = d.getFullYear();
  return `${m}/${day}/${y}`;
}

/**
 * Draw text with a real italic slant.
 *
 * No italic face ships with the chosen OFL families, and downloading one was not
 * possible from the available sources. PDF renders glyphs through Tm x CTM, so
 * applying a skew to the graphics state shears the text itself — a genuine
 * oblique. tan(12 deg) = 0.2126.
 *
 * `o.y` is the text TOP, matching `text()`; pdf-lib's `y` is a baseline measured
 * from the page bottom, hence the conversion.
 */
function italic(
  page: PDFPage,
  text: string,
  o: { x: number; y: number; size: number; font: PDFFont; color: Color; align?: 'l' | 'c' | 'r' }
) {
  const slant = 0.2126;
  const width = o.font.widthOfTextAtSize(text, o.size);
  const x = o.align === 'r' ? o.x - width : o.align === 'c' ? o.x - width / 2 : o.x;
  const baseline = PAGE_H - o.y - o.size;
  // Shear about the baseline so the text leans but stays on its line.
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, slant, 1, -slant * baseline, 0));
  page.drawText(text, { x, y: baseline, size: o.size, font: o.font, color: o.color });
  page.pushOperators(popGraphicsState());
}

/* =============================================================================
 * Load
 * ========================================================================== */

/**
 * Load an order shaped for invoicing: line items joined to their products so the
 * per-item GST rate is known.
 *
 * `seo_metadata` is the real column name. A camelCase `seoMetadata` in this list
 * made PostgREST reject the whole query with 42703, so `data` came back null and
 * this function threw "Order not found" for EVERY order — which surfaced as the
 * invoice endpoint answering 404 for orders that plainly existed, and as the
 * automatic trigger failing for all of them. Only snake_case columns belong here.
 */
export async function getOrderForInvoice(orderId: string) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*, products(id, name, sku, seo_metadata)), users(email, first_name, last_name, phone)')
    .eq('id', orderId)
    .single();

  if (error || !data) {
    const err = new Error(
      error ? `Could not load order for invoicing: ${error.code || ''} ${error.message}`.trim() : 'Order not found'
    );
    (err as any).status = error ? 500 : 404;
    throw err;
  }
  return data;
}

function isPrepaid(order: any): boolean {
  return /payu|payonline|prepaid|online|upi|card/i.test(String(order?.payment_method || ''));
}
function isPaid(order: any): boolean {
  return String(order?.payment_status || '').toLowerCase() === 'paid';
}
function gstRateOf(item: any): number {
  const n = Number(item?.products?.seo_metadata?.gst_rate);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/* =============================================================================
 * Render
 * ========================================================================== */

/**
 * Render the printable tax invoice.
 *
 * Layout follows docs/reference/reference-invoice.pdf (MV-139559) exactly:
 * US Letter, 18pt margins, Georgia-style serif wordmarks, Consolas-style mono
 * numerics, ₹ currency, purple section bars, hairline grid, and the yellow
 * customer-note box. Business logic (FY number, tax split, reconciliation) is
 * untouched.
 */
export async function generateInvoicePdf(order: any): Promise<Buffer> {
  const doc = await PDFDocument.create();

  const fonts = await loadFonts(doc);
  // Without embedded fonts we still produce a valid PDF; it just cannot draw ₹
  // and will look like the old template. Loud above, degraded here on purpose so
  // a missing asset never fails an invoice outright.
  const F = fonts;
  const fallback = async () => {
    const { StandardFonts } = await import('pdf-lib');
    return {
      serifBold: await doc.embedFont(StandardFonts.TimesRomanBold),
      sans: await doc.embedFont(StandardFonts.Helvetica),
      sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
      mono: await doc.embedFont(StandardFonts.Courier),
      monoBold: await doc.embedFont(StandardFonts.CourierBold),
    } as Fonts;
  };
  const f: Fonts = F ?? (await fallback());
  const hasRupee = !!F;

  const rupee = (v: number) => (hasRupee ? formatINR(v) : `Rs. ${formatInvoiceAmount(v)}`);

  let page = doc.addPage([PAGE_W, PAGE_H]);

  // ---- data ----
  const seller = getSellerIdentity();
  const orderNumber: string = order.order_number || 'MV-000000';
  const invoiceNumber: string = order.invoice_number || buildInvoiceNumber(orderNumber);
  const issued = order.invoice_issued_at ? new Date(order.invoice_issued_at) : new Date();
  const orderDate = order.created_at ? new Date(order.created_at) : issued;
  const issueDate = Number.isNaN(issued.getTime()) ? new Date() : issued;
  const dateOfOrder = Number.isNaN(orderDate.getTime()) ? issueDate : orderDate;

  const prepaid = isPrepaid(order);
  const paid = isPaid(order);
  const bill = order.billing_address && Object.keys(order.billing_address).length ? order.billing_address : {};
  const ship = order.shipping_address && Object.keys(order.shipping_address).length ? order.shipping_address : {};
  const addr: any = { ...ship, ...bill, state: bill.state || ship.state };
  const buyer = {
    name: String(addr.fullName || 'Customer'),
    lines: [
      String(addr.addressLine || addr.addressLine2 || '').trim(),
      [addr.city, addr.state, addr.zipCode || addr.pincode].filter(Boolean).join(', '),
    ].filter(Boolean),
    phone: String(addr.phone || ''),
  };

  const items: any[] = Array.isArray(order.order_items) && order.order_items.length
    ? order.order_items
    : [{ product_name: 'Order total', sku: '', quantity: 1, price: order.subtotal || 0, total: order.subtotal || 0 }];

  const shippingFee = round2(Number(order.shipping_fee ?? order.shipping_cost) || 0);
  const discount = round2(Number(order.discount) || 0);
  const totals = computeOrderTotals({
    subtotal: Number(order.subtotal) || 0,
    discount,
    shippingFee,
    fallbackGst: Number(order.tax) || 0,
    lines: items.map((i) => ({ gross: Number(i.total) || Number(i.price) * Number(i.quantity) || 0, ratePercent: gstRateOf(i) })),
  });
  const gst = splitGst(totals.gst, addr.state);
  // "Taxable" is EXCLUDING tax, so it agrees with the per-line Taxed column and
  // Taxable + GST === Subtotal.
  const taxableBase = round2(totals.taxable);
  const grandTotal = Number(order.total) || round2(totals.gross - discount + shippingFee);

  /* ---------------- primitives ---------------- */
  const rule = (x: number, y: number, w: number, color: Color = BORDER, h = HAIRLINE) =>
    page.drawRectangle({ x, y: PAGE_H - y - h, width: w, height: h, color });

  const fillRect = (x: number, y: number, w: number, h: number, color: Color) =>
    page.drawRectangle({ x, y: PAGE_H - y - h, width: w, height: h, color });

  /** Draw with y given as the text TOP (like the reference's coordinates). */
  const text = (
    s: string,
    o: { x: number; y: number; size: number; font: PDFFont; color: any; align?: 'l' | 'c' | 'r' }
  ) => {
    const w = o.font.widthOfTextAtSize(s, o.size);
    const x = o.align === 'r' ? o.x - w : o.align === 'c' ? o.x - w / 2 : o.x;
    page.drawText(s, { x, y: PAGE_H - o.y - o.size, size: o.size, font: o.font, color: o.color });
  };

  /* ================= HEADER ================= */
  // Logo, reference size 99.8 x 42 at (18, 18).
  const logoBytes = asset(assetRoot('meruveda-logo.png'));
  if (logoBytes) {
    try {
      // Create BEFORE the fonts so every resource tag stays in sync (a font tag
      // added after an image can desync the /Font resource dictionary and text
      // silently vanishes in some renderers).
      await doc.embedPng(logoBytes);
      const img = await doc.embedPng(logoBytes);
      const scale = Math.min(99.8 / img.width, 42 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: MARGIN, y: PAGE_H - 18 - h, width: w, height: h });
    } catch (err: any) {
      console.error('[Invoice] logo present but unreadable as PNG:', err?.message || err);
    }
  } else {
    console.error(
      `[Invoice] LOGO MISSING — the invoice will render without it. Looked in: ${assetRoot('meruveda-logo.png').join(' , ')}`
    );
  }

  // INVOICE wordmark: 36pt serif bold, dark gold, right-aligned to the margin.
  text('INVOICE', { x: RIGHT, y: 15, size: 36, font: f.serifBold, color: GOLD, align: 'r' });
  // GST requires the document to be labelled a tax invoice; tiny and grey so it
  // stays a caption rather than a second headline.
  text('TAX INVOICE', { x: RIGHT, y: 54, size: 7.5, font: f.sans, color: BODY_GREY, align: 'r' });

  /* ---- info box: DATE / INVOICE # / ORDER # / DUE DATE ---- */
  const infoX = 439.5;
  const infoW = RIGHT - infoX;
  const lblW = 64.5;
  const infoY = 66;
  const infoRowH = 21.8;
  const infoRows: Array<[string, string]> = [
    ['DATE', fmtDate(issueDate)],
    ['INVOICE #', invoiceNumber],
    ['ORDER #', orderNumber],
    ['DUE DATE', fmtDate(dateOfOrder)],
  ];
  infoRows.forEach(([label, value], i) => {
    const y = infoY + i * infoRowH;
    // Cell background FIRST, then the hairlines, then the text — a fill painted
    // after the labels would hide them completely.
    fillRect(infoX, y, lblW, infoRowH, WHITE);
    fillRect(infoX + lblW, y, infoW - lblW, infoRowH, WHITE);
    if (i > 0) {
      rule(infoX, y, infoW);
      rule(infoX + lblW, y, infoW - lblW);
    }
    text(label, { x: infoX + 9.7, y: y + 6.2, size: 9, font: f.sansBold, color: hex('#000000') });
    // The real FY series (MV/26-27/000123) is longer than the reference sample
    // (MV-139559), so shrink to fit rather than letting it collide with the label
    // column or run off the right margin.
    const valRight = infoX + infoW - 9.7;
    const avail = infoW - lblW - 19.4;
    let vSize = 9;
    while (vSize > 6 && f.mono.widthOfTextAtSize(value, vSize) > avail) vSize -= 0.5;
    text(value, { x: valRight, y: y + 6.2 + (9 - vSize), size: vSize, font: f.mono, color: hex('#000000'), align: 'r' });
  });
  const infoH = infoRows.length * infoRowH;
  // Outer border: verticals + bottom hairline.
  rule(infoX, infoY, HAIRLINE, BORDER, infoH);
  rule(infoX + lblW, infoY, HAIRLINE, BORDER, infoH);
  rule(RIGHT - HAIRLINE, infoY, HAIRLINE, BORDER, infoH);
  rule(infoX, infoY + infoH, infoW);

  /* ---- seller block ---- */
  let sy = 74;
  text(seller.name, { x: MARGIN, y: sy, size: 15, font: f.serifBold, color: MAROON });
  sy += 25.8;
  // The address is wrapped, not pre-split: BUSINESS_ADDRESS is a single string in
  // env, and the reference packs as much per line as fits, so a configured
  // address of any length wraps the same way the reference sample did.
  const sellerBlockW = 306; // reference seller column width (widest line is the Phone|Email row)
  const sellerLines: Array<[string, boolean]> = [
    [seller.legal, false],
    ...wrapText(f.sans, seller.address.join(', ').replace(/,\s*,/g, ','), 9, sellerBlockW).map(
      (a) => [a, false] as [string, boolean]
    ),
    [`Phone: ${seller.phone} | Email: ${seller.email}`, false],
    [`Website: ${seller.website}`, false],
    [`GSTIN: ${seller.gstin}`, true],
  ];
  for (const [line, bold] of sellerLines) {
    text(line, { x: MARGIN, y: sy, size: 9, font: bold ? f.sansBold : f.sans, color: bold ? SLATE_DARK : BODY_GREY });
    sy += 15.4;
  }

  // Full-width rule under the seller block.
  const ruleY = Math.max(sy + 8, 209.2);
  rule(MARGIN, ruleY, CONTENT_W, SLATE);

  /* ================= BILL TO ================= */
  const btX = MARGIN;
  const btW = 288;
  let y = ruleY + 30.8;
  fillRect(btX, y, btW, 21, PURPLE);
  text('BILL TO', { x: btX + 9, y: y + 5.3, size: 9, font: f.sansBold, color: WHITE });
  const btBodyTop = y + 21;

  const btLines: Array<[string, boolean]> = [
    [buyer.name, true],
    ...buyer.lines.map((l) => [l, false] as [string, boolean]),
    [`Phone: ${buyer.phone}`, true],
  ];
  let btH = 11;
  for (const [line, i] of btLines.map((l, k) => [l, k] as [any, number])) {
    btH += wrapText(f.sans, line, 9, btW - 20).length * 14.4;
    // The Phone line gets the extra gap the reference shows before it.
    if (i === btLines.length - 1) btH += 4.4;
  }
  btH += 12;
  fillRect(btX, btBodyTop, btW, btH, WHITE);
  rule(btX, btBodyTop, HAIRLINE, BORDER, btH);
  rule(btX + btW - HAIRLINE, btBodyTop, HAIRLINE, BORDER, btH);
  rule(btX, btBodyTop + btH, btW);
  let by = btBodyTop + 11.3;
  for (const [line, bold] of btLines) {
    for (const ln of wrapText(f.sans, line, 9, btW - 20)) {
      text(ln, { x: btX + 9.8, y: by, size: 9, font: bold ? f.sansBold : f.sans, color: bold ? INK : SLATE_DARK });
      by += 14.4;
    }
    if (line === btLines[btLines.length - 1][0]) by += 4.4;
  }
  y = btBodyTop + btH;

  /* ================= ITEMS TABLE ================= */
  const headerH = 21.8;
  let cy = y + 26.6; // reference gap between BILL TO and the table

  const colMid = (c: number[]) => (c[0] + c[1]) / 2;

  const drawTableHeader = (yy: number) => {
    const keys: Array<[string, number[], 'l' | 'c' | 'r']> = [
      ['Description', COL.desc, 'l'],
      ['SKU', COL.sku, 'c'],
      ['Qty', COL.qty, 'c'],
      ['Taxed', COL.taxed, 'c'],
      ['Amount', COL.amount, 'r'],
    ];
    fillRect(MARGIN, yy, CONTENT_W, headerH, PURPLE);
    for (const [label, col, align] of keys) {
      const ax = align === 'l' ? col[0] + 9.8 : align === 'r' ? col[1] - 9.8 : colMid(col);
      text(label, { x: ax, y: yy + 5.3, size: 9, font: f.sansBold, color: WHITE, align });
    }
    // Vertical hairlines between columns, as in the reference header band.
    for (const col of [COL.sku, COL.qty, COL.taxed, COL.amount]) rule(col[0], yy, HAIRLINE, WHITE, headerH);
    rule(MARGIN, yy, HAIRLINE, WHITE, headerH);
    rule(RIGHT - HAIRLINE, yy, HAIRLINE, WHITE, headerH);
    return yy + headerH;
  };

  const FOOTER_BLOCK = 96; // room reserved for the two-column bottom + footer
  cy = drawTableHeader(cy);

  for (const item of items) {
    const gross = Number(item.total) || Number(item.price) * Number(item.quantity) || 0;
    const qty = Number(item.quantity) || 0;
    const descLines = wrapText(f.sans, String(item.product_name || ''), 9, COL.desc[1] - COL.desc[0] - 20);
    const rowH = Math.max(ITEM_ROW_H, descLines.length * 12.6 + 11);

    // Page break: never let a row collide with the bottom block, and always
    // repeat the header on the new page.
    if (cy + rowH > PAGE_H - 150) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      cy = drawTableHeader(MARGIN + 8);
    }

    fillRect(MARGIN, cy, CONTENT_W, rowH, WHITE);
    let dy = cy + (rowH - descLines.length * 12.6) / 2 + 1;
    for (const ln of descLines) {
      text(ln, { x: COL.desc[0] + 12, y: dy, size: 9, font: f.sans, color: hex('#000000') });
      dy += 12.6;
    }
    const midY = cy + (rowH - 9) / 2;
    if (item.sku) {
      text(String(item.sku), { x: colMid(COL.sku), y: midY, size: 9, font: f.mono, color: hex('#000000'), align: 'c' });
    }
    text(String(qty), { x: colMid(COL.qty), y: midY, size: 9, font: f.sans, color: hex('#000000'), align: 'c' });
    text('X', { x: colMid(COL.taxed), y: midY, size: 9, font: f.sans, color: hex('#000000'), align: 'c' });
    text(rupee(gross), { x: COL.amount[1] - 12.7, y: midY, size: 9, font: f.mono, color: hex('#000000'), align: 'r' });

    // Hairline grid: verticals between columns + bottom border of the row.
    rule(COL.sku[0], cy, HAIRLINE, BORDER, rowH);
    rule(COL.qty[0], cy, HAIRLINE, BORDER, rowH);
    rule(COL.taxed[0], cy, HAIRLINE, BORDER, rowH);
    rule(COL.amount[0], cy, HAIRLINE, BORDER, rowH);
    rule(MARGIN, cy + rowH, CONTENT_W);
    cy += rowH;
  }

  /* ================= BOTTOM: NOTES (left) + TOTALS (right) ================= */
  const bottomY = cy + 30.4;

  /* ---- notes ---- */
  const barH = 21;
  fillRect(NOTES_X, bottomY, NOTES_W, barH, PURPLE);
  text('OTHER COMMENTS & NOTES', { x: NOTES_X + 9, y: bottomY + 5.3, size: 9, font: f.sansBold, color: WHITE });

  const noteBodyTop = bottomY + barH;
  const innerPad = 10;

  // Numbered list + payment details, measured first so the box can be sized.
  const numbered: string[] = prepaid
    ? ['1. Payment received in full. Thank you.']
    : ['1. Total payment due upon delivery.', '2. Please include the invoice number with your payment.'];

  const listLines: string[] = [];
  for (const n of numbered) listLines.push(...wrapText(f.sans, n, 9, NOTES_W - 20));

  // Payment reference / customer note. The raw "[PayU mihpayid: ...]" string must
  // never be printed — it is an internal marker, and mihpayid has its own column.
  const rawNote = String(order.notes || '').trim();
  const rawNoteClean = rawNote.replace(/\[PayU mihpayid:[^\]]*\]/gi, '').trim();
  const refLine = prepaid && order.payu_mihpayid ? `Payment Ref: PayU ${order.payu_mihpayid}` : '';
  const noteText = refLine || rawNoteClean;

  const noteBoxH = noteText ? 27.8 : 0;
  const listY0 = noteBodyTop + innerPad + (noteText ? noteBoxH + 12 : 0);
  const listH = listLines.length * 14.4;
  const methodLabelY = listY0 + listH + 6;
  const methodValueY = methodLabelY + 14;
  // Must enclose the Method value line too, or the box border cuts through it.
  const notesH = innerPad + (noteText ? noteBoxH + 12 : 0) + listH + 6 + 14 + 14 + innerPad;

  fillRect(NOTES_X, noteBodyTop, NOTES_W, notesH, WHITE);
  rule(NOTES_X, noteBodyTop, HAIRLINE, BORDER, notesH);
  rule(NOTES_X + NOTES_W - HAIRLINE, noteBodyTop, HAIRLINE, BORDER, notesH);
  rule(NOTES_X, noteBodyTop + notesH, NOTES_W);

  if (noteText) {
    // Light-yellow highlighted note box.
    const nbX = NOTES_X + 10;
    const nbW = NOTES_W - 20;
    fillRect(nbX, noteBodyTop + innerPad, nbW, noteBoxH, hex('#fffbeb'));
    page.drawRectangle({
      x: nbX,
      y: PAGE_H - noteBodyTop - innerPad - noteBoxH,
      width: nbW,
      height: noteBoxH,
      borderColor: NOTE_EDGE,
      borderWidth: 1,
      color: hex('#fffbeb'),
    });
    const prefix = refLine ? 'Payment Ref: ' : 'Customer Note: ';
    const body = refLine ? `PayU ${order.payu_mihpayid}` : noteText;
    const maxNoteW = nbW - 20;
    const italicFont = f.sansBold;
    const prefixW = italicFont.widthOfTextAtSize(prefix, 9);
    const bodyLines = wrapText(italicFont, body, 9, maxNoteW - prefixW);
    const first = bodyLines.shift() ?? '';
    italic(page, `${prefix}${first}`, {
      x: nbX + 10,
      y: noteBodyTop + innerPad + 9.5,
      size: 9,
      font: italicFont,
      color: BROWN,
    });
    let ny = noteBodyTop + innerPad + 9.5 + 14.4;
    for (const ln of bodyLines) {
      italic(page, ln, { x: nbX + 10, y: ny, size: 9, font: italicFont, color: BROWN });
      ny += 14.4;
    }
  }

  let ny2 = listY0;
  for (const ln of listLines) {
    text(ln, { x: NOTES_X + 9.8, y: ny2, size: 9, font: f.sans, color: SLATE });
    ny2 += 14.4;
  }
  text('PAYMENT DETAILS:', { x: NOTES_X + 9.8, y: methodLabelY, size: 9, font: f.sansBold, color: DARK_GREY });
  text(`Method: ${String(order.payment_method || (prepaid ? 'PayOnline (via PayU)' : 'Cash On Delivery'))}`, {
    x: NOTES_X + 9.8,
    y: methodValueY,
    size: 9,
    font: f.sans,
    color: SLATE,
  });

  /* ---- totals ---- */
  const totalRows: Array<[string, string, boolean]> = [];
  totalRows.push(['Subtotal', rupee(totals.gross - discount), false]);
  totalRows.push(['Taxable', rupee(taxableBase), false]);
  if (gst.mode === 'intra') {
    totalRows.push(['CGST (Included)', rupee(gst.cgst), false]);
    totalRows.push(['SGST (Included)', rupee(gst.sgst), false]);
  } else {
    totalRows.push(['IGST (Included)', rupee(gst.igst), false]);
  }
  if (discount > 0) totalRows.push(['Discount', `- ${rupee(discount)}`, false]);
  totalRows.push(['Shipping', shippingFee === 0 ? 'FREE' : rupee(shippingFee), false]);
  totalRows.push(['TOTAL', rupee(grandTotal), true]);

  const totalsH =
    (totalRows.length - 1) * TOTAL_ROW_H + TOTAL_ROW_H_BIG + (prepaid || !prepaid ? 22 : 0);
  const gridBottom = bottomY + totalsH;

  let ty = bottomY;
  totalRows.forEach(([label, value, big], i) => {
    const rowH = big ? TOTAL_ROW_H_BIG : TOTAL_ROW_H;
    const labelSize = big ? 10.5 : 9;
    const valueFont = big ? f.monoBold : f.mono;
    const valueSize = big ? 10.5 : 9;
    const midY = ty + (rowH - labelSize) / 2 - 1;

    text(label, {
      x: TOTAL_X + TOTAL_LABEL_W - 12,
      y: midY,
      size: labelSize,
      font: f.sansBold,
      color: big ? INK : SLATE,
      align: 'r',
    });
    text(value, {
      x: TOTAL_X + TOTAL_LABEL_W + TOTAL_VAL_W - 12.7,
      y: midY,
      size: valueSize,
      font: valueFont,
      color: big ? INK : hex('#000000'),
      align: 'r',
    });

    // Grid: verticals + the heavier rule above TOTAL.
    rule(TOTAL_X, ty, HAIRLINE, BORDER, rowH);
    rule(TOTAL_X + TOTAL_LABEL_W, ty, HAIRLINE, BORDER, rowH);
    rule(RIGHT - HAIRLINE, ty, HAIRLINE, BORDER, rowH);
    rule(TOTAL_X, ty + rowH - HAIRLINE, TOTAL_LABEL_W + TOTAL_VAL_W, big ? SLATE : BORDER, big ? 1.2 : HAIRLINE);

    ty += rowH;
  });

  // Payment-state marker next to the totals.
  const marker = paid ? 'PAID' : 'AMOUNT DUE ON DELIVERY';
  text(marker, {
    x: TOTAL_X + TOTAL_LABEL_W + TOTAL_VAL_W - 12.7,
    y: ty + 5,
    size: 7.5,
    font: f.sansBold,
    color: paid ? hex('#0c8c49') : BROWN,
    align: 'r',
  });

  /* ================= FOOTER ================= */
  const footerTop = Math.max(gridBottom, noteBodyTop + notesH) + 49;
  const cx = PAGE_W / 2;
  italic(page, 'If you have any questions about this invoice, please contact', {
    x: cx,
    y: footerTop,
    size: 10.5,
    font: f.sans,
    color: SLATE,
    align: 'c',
  });
  text(seller.email, { x: cx, y: footerTop + 18, size: 10.5, font: f.sansBold, color: INK, align: 'c' });
  text('Thank You For Your Business!', {
    x: cx,
    y: footerTop + 36.9,
    size: 13.5,
    font: f.serifBold,
    color: MAROON,
    align: 'c',
  });

  const bytes = await doc.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}

/* =============================================================================
 * Invoice number — business logic, unchanged
 * ========================================================================== */

/**
 * Last-resort identifier when the FY series cannot be allocated at all.
 *
 * An order must never be left without an invoice, so we fall back to the order
 * number rather than failing. It is not part of the `MV/<FY>/<000123>` series,
 * it is logged loudly, and it is stable — a later sweep will not renumber it.
 */
export function buildInvoiceNumber(orderNumber: string, issuedAt: Date = new Date()): string {
  const digest = Math.abs(
    String(orderNumber || '').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)
  );
  return formatInvoiceNumber(invoiceFyLabel(issuedAt), (digest % 900000) + 100000);
}

/**
 * Wording that must never claim something untrue.
 *
 * A tax invoice is a legal document: it may only state a payment fact that was
 * actually true at the moment it was issued. So COD says the amount is due on
 * delivery, a verified-paid prepaid order is stamped PAID with its PayU
 * reference, and an unpaid prepaid order stays deliberately neutral — no PAID
 * stamp and no reference, because neither is established yet.
 */
export function paymentWordingFor(order: {
  payment_method?: string | null;
  payment_status?: string | null;
  payu_mihpayid?: string | null;
  notes?: string | null;
}): { mode: 'cod' | 'prepaid'; paid: boolean; reference: string | null; wording: string } {
  const isCod = isCodOrder(order);
  if (isCod) {
    return { mode: 'cod', paid: false, reference: null, wording: 'Amount due on delivery' };
  }
  const paid = isPaid(order);
  if (paid) {
    return {
      mode: 'prepaid',
      paid: true,
      reference: payuReferenceFor(order),
      wording: 'PAID',
    };
  }
  return { mode: 'prepaid', paid: false, reference: null, wording: 'Payment: Online (via PayU)' };
}

/** COD decided on the exact stored `payment_method` value, case-insensitively. */
export function isCodOrder(order: { payment_method?: string | null }): boolean {
  return String(order?.payment_method || '').trim().toLowerCase() === 'cod';
}

/**
 * The PayU reference, taken from whatever the success callback already stored.
 *
 * No dedicated column is assumed: `payu_mihpayid` is read when present, and
 * otherwise the marker the callback writes into `notes` is parsed. Returns null
 * rather than guessing when neither is available.
 */
export function payuReferenceFor(order: { payu_mihpayid?: string | null; notes?: string | null }): string | null {
  const direct = String(order?.payu_mihpayid || '').trim();
  if (direct) return direct;
  const notes = String(order?.notes || '');
  const match = notes.match(/\[PayU\s*mihpayid:\s*([^\]]+)\]/i);
  return match ? match[1].trim() : null;
}

/**
 * Claim this order and take its invoice number from the FY series.
 *
 * Atomicity comes from Storage, not from a database function: `claimInvoice()`
 * creates `invoices/<order_id>/claim` with `upsert:false`, so when the order
 * creation trigger, a PayU callback and the cron sweep all race, exactly one
 * create succeeds. The losers read `state.json` and return the number already
 * issued — never a second one.
 *
 * Returns null when another worker already claimed the order; callers treat
 * that as "already handled", not as an error.
 */
export async function claimInvoiceNumber(order: {
  id: string;
  order_number?: string | null;
  invoice_number?: string | null;
}): Promise<string | null> {
  const orderId = order.id;
  const issuedAt = new Date();

  const existing = await readInvoiceState(orderId);
  if (existing?.invoiceNumber) return existing.invoiceNumber;

  const won = await claimInvoice(orderId, {
    orderNumber: order.order_number || null,
    claimedAt: issuedAt.toISOString(),
  });
  if (!won) {
    // Lost the race, or storage is unavailable. Either way: do NOT issue.
    const settled = await readInvoiceState(orderId);
    return settled?.invoiceNumber ?? null;
  }

  let invoiceNumber: string;
  try {
    invoiceNumber = await allocateInvoiceNumber(issuedAt);
  } catch (err: any) {
    // Never leave an order without an invoice: fall back to the order number.
    invoiceNumber = String(order.order_number || '') || buildInvoiceNumber(String(order.order_number || ''));
    console.error(
      `[Invoice] FY series allocation failed for order ${orderId} (${err?.message || err}) — ` +
        `falling back to the order number ${invoiceNumber} as the invoice number.`
    );
  }

  (order as any).invoice_number = invoiceNumber;
  return invoiceNumber;
}

/**
 * Persist the issued invoice's identity and payment wording.
 *
 * Written after the claim and before delivery so a crash between the two still
 * leaves a readable record of what the customer was issued.
 */
export async function writeInvoiceIssue(
  orderId: string,
  invoiceNumber: string,
  order: any
): Promise<boolean> {
  const payment = paymentWordingFor(order);
  const written = await writeInvoiceState(orderId, {
    invoiceNumber,
    orderNumber: String(order?.order_number || ''),
    issuedAt: new Date().toISOString(),
    pdfPath: null,
    payment,
    channels: { whatsapp: freshChannelState(), email: freshChannelState() },
  });
  if (written) (order as any).invoice_issued_at = new Date().toISOString();
  return written;
}

/** Record the outcome of a delivery attempt on the channel it belongs to. */
export async function markInvoiceSent(
  orderId: string,
  statuses: { whatsapp?: ChannelOutcome | null; email?: ChannelOutcome | null } = {}
): Promise<void> {
  const at = new Date().toISOString();
  if (statuses.whatsapp) {
    await patchChannel(orderId, 'whatsapp', {
      status: statuses.whatsapp === 'sent' ? 'sent' : 'failed',
      sentAt: statuses.whatsapp === 'sent' ? at : null,
      lastAttemptAt: at,
    });
  }
  if (statuses.email) {
    await patchChannel(orderId, 'email', {
      status: statuses.email === 'sent' ? 'sent' : 'failed',
      sentAt: statuses.email === 'sent' ? at : null,
      lastAttemptAt: at,
    });
  }
}

/**
 * Release a failed issue so the retry sweep can run again.
 *
 * The claim marker is deliberately KEPT: an invoice number, once printed, can
 * never be reused or re-allocated, and keeping the claim is what stops a retry
 * from issuing a second tax document for the same order.
 */
export async function releaseInvoiceClaim(orderId: string, reason: string): Promise<void> {
  await patchChannel(orderId, 'whatsapp', { lastError: String(reason).slice(0, 500) });
  await patchChannel(orderId, 'email', { lastError: String(reason).slice(0, 500) });
}

/** Persist the last failure reason so the admin card and the sweep can see it. */
export async function recordInvoiceError(orderId: string, reason: string): Promise<void> {
  const message = String(reason).slice(0, 500);
  await patchChannel(orderId, 'whatsapp', { lastError: message });
  await patchChannel(orderId, 'email', { lastError: message });
}

export const invoiceService = {
  getOrderForInvoice,
  generateInvoicePdf,
  buildInvoiceNumber,
  claimInvoiceNumber,
  writeInvoiceIssue,
  releaseInvoiceClaim,
  markInvoiceSent,
  recordInvoiceError,
  getSellerIdentity,
  wrapText,
  formatINR,
  isCodOrder,
  paymentWordingFor,
  payuReferenceFor,
};