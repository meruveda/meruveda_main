import { readFileSync } from 'fs';
import path from 'path';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import {
  DEFAULT_GST_RATE_PERCENT,
  computeOrderTotals,
  formatInvoiceAmount,
  formatInvoiceNumber,
  grossToTaxable,
  invoiceFyLabel,
  isIntraState,
  round2,
  splitGst,
} from '@meruveda/shared';
import { supabase } from '../database/supabase';
import { config } from '../config/env';
import { hasColumn } from './schemaGuard';

/** Per-channel outcome, mirroring ChannelStatus in invoiceDispatchService. */
type ChannelOutcome = 'sent' | 'failed' | 'skipped' | 'disabled';

/* ------------------------------------------------------------------ */
/* Palette — sampled from the reference invoice's own rendered pixels  */
/* ------------------------------------------------------------------ */
const PURPLE = rgb(0.298, 0.1137, 0.3569);     // #4C1D5B  section bars
const GOLD = rgb(0.4588, 0.3686, 0.0863);      // #755E16  INVOICE wordmark
const WORDMARK = rgb(0.1686, 0.0941, 0.1255);  // #2B1820  MERUVEDA / sign-off
const BODY = rgb(0.2784, 0.3333, 0.4118);      // #475569  body copy
const HEADING = rgb(0.0588, 0.0902, 0.1647);   // #0F172A  labels, values
const BORDER = rgb(0.8863, 0.9098, 0.9412);    // #E2E8F0  card + table rules
const RULE = rgb(0.2, 0.2549, 0.3333);         // #334155  masthead rule
const GREEN = rgb(0.0549, 0.549, 0.2863);       // #0C8C49  PAID stamp
const WHITE = rgb(1, 1, 1);

/* ------------------------------------------------------------------ */
/* Page geometry — US Letter, matching the reference exactly            */
/* ------------------------------------------------------------------ */
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;   // 576
const FOOTER_Y = 96;                      // content never enters this band

const LOGO_PATH = path.resolve(__dirname, '../../assets/meruveda-logo.png');

/**
 * Currency prefix for every printed figure.
 *
 * The reference PDF renders "₹699.00". pdf-lib's standard fonts are WinAnsi
 * only and U+20B9 is NOT in WinAnsi, so the rupee glyph cannot be drawn
 * without embedding a TTF that carries it. We default to "Rs." (the GST
 * convention, and what the previous template used) and allow an override via
 * INVOICE_CURRENCY_SYMBOL once an embeddable font is supplied.
 */
const CURRENCY_PREFIX = (process.env.INVOICE_CURRENCY_SYMBOL ?? 'Rs. ').trim();
const money = (v: unknown) =>
  `${CURRENCY_PREFIX ? CURRENCY_PREFIX + ' ' : ''}${formatInvoiceAmount(Number(v) || 0)}`;

export interface SellerIdentity {
  name: string;
  addressLines: string[];
  gstin: string;
  phone: string;
  email: string;
  website: string;
}

/** Fallbacks so a tax invoice is never printed blank mid-setup. */
const DEFAULT_SELLER = {
  name: 'MERUVEDA WELLNESS',
  address:
    'Keharsh Enterprises (Sole Proprietorship)\n' +
    'S/N. 12, Viru City Gym Road, Inside Jalori Gate,\n' +
    'Jodhpur - 342001, Rajasthan, India',
  gstin: '08BFPPS7045C1Z4',
  phone: '+91 8097147463',
  email: 'customercare@meruvedawellness.com',
  website: 'meruvedawellness.com',
};

let warnedMissingBusinessEnv = false;

/** Seller block for the invoice, resolved from env with hard-coded fallbacks. */
export function getSellerIdentity(): SellerIdentity {
  const name = config.businessName || DEFAULT_SELLER.name;
  const address = config.businessAddress || DEFAULT_SELLER.address;
  const gstin = config.businessGstin || DEFAULT_SELLER.gstin;
  const phone = config.businessPhone || DEFAULT_SELLER.phone;
  if (!warnedMissingBusinessEnv && (!config.businessName || !config.businessGstin)) {
    warnedMissingBusinessEnv = true;
    console.warn(
      '[Invoice] BUSINESS_NAME / BUSINESS_GSTIN not fully set — using built-in defaults. ' +
        'Set them in the Render environment before going live.'
    );
  }
  return {
    name,
    addressLines: String(address).split('\n').map((l) => l.trim()).filter(Boolean),
    gstin,
    phone,
    email: 'customercare@meruvedawellness.com',
    // Never print a localhost URL on a legal document.
    website: DEFAULT_SELLER.website,
  };
}

/* ------------------------------------------------------------------ */
/* Text helpers — wrapping instead of truncation                       */
/* ------------------------------------------------------------------ */

/**
 * Greedy word wrap using real glyph widths. Replaces the old
 * `String(x).slice(0, 64)` which silently chopped long addresses and product
 * names mid-word.
 */
export function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draw wrapped text and return the next free `yTop`.
 *
 * The whole template is laid out in "y measured down from the top of the page"
 * space (which is how the reference PDF expresses its own coordinates) and
 * converted to PDF user space inside `at()`. A baseline sits `size` below the
 * slot top, matching how the browser that produced the reference positioned
 * its text.
 */
function drawWrapped(
  page: PDFPage,
  text: string,
  opts: { x: number; yTop: number; size: number; maxWidth: number; font: PDFFont; color: any; lineGap?: number },
): number {
  const { x, yTop, size, maxWidth, font, color } = opts;
  const gap = opts.lineGap ?? size * 1.55;
  const at = (y: number) => 792 - y;
  let cursor = yTop;
  for (const line of wrapText(font, text, size, maxWidth)) {
    page.drawText(line, { x, y: at(cursor + size), size, font, color });
    cursor += gap;
  }
  return cursor;
}

/* ------------------------------------------------------------------ */
/* Order loading                                                      */
/* ------------------------------------------------------------------ */

/** Resolve the GST rate for every line item (per product, default 5%). */
function rateOfProduct(product: any): number {
  const m = product?.seo_metadata || product?.seoMetadata || {};
  const raw = m.gst_rate ?? m.gstRate ?? m.gst;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_GST_RATE_PERCENT;
}

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
    // Distinguish "no such order" from "the query itself was rejected" so a
    // schema mistake is never again reported as a missing order.
    const err = new Error(
      error
        ? `Could not load order for invoicing: ${error.code || ''} ${error.message}`.trim()
        : 'Order not found'
    );
    (err as any).status = error ? 500 : 404;
    throw err;
  }
  return data;
}

/** Best-effort buyer address: billing first, then shipping. */
function buyerOf(order: any) {
  const bill = order.billing_address || {};
  const ship = order.shipping_address || {};
  return {
    fullName: bill.fullName || ship.fullName || 'Customer',
    addressLines: String(bill.addressLine || ship.addressLine || '')
      .split(/[,\n]/)
      .map((l: string) => l.trim())
      .filter(Boolean),
    city: bill.city || ship.city || '',
    state: bill.state || ship.state || '',
    zipCode: bill.zipCode || ship.zipCode || '',
    phone: bill.phone || ship.phone || '',
    email: order.users?.email || order.user_email || '',
  };
}

/** True when the order was paid online (PayU) rather than on delivery. */
function isPrepaid(order: any): boolean {
  return !/cash|\bcod\b/i.test(String(order.payment_method || ''));
}

function isPaid(order: any): boolean {
  return String(order.payment_status || '').toLowerCase() === 'paid';
}

const formatDate = (d: Date) =>
  d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

/* ------------------------------------------------------------------ */
/* The template                                                        */
/* ------------------------------------------------------------------ */

/**
 * Render the printable tax invoice.
 *
 * Geometry, fonts, colours and copy are taken directly from the reference
 * invoice (Invoice MV-139559.pdf) — US Letter, 18pt margins, purple #4C1D5B
 * section bars, Georgia serif for the wordmark / title / sign-off, and a
 * monospace face for every figure.
 *
 * Section order:
 *   header    logo + "INVOICE" wordmark bar, MERUVEDA WELLNESS + seller block
 *   meta box  DATE / INVOICE # / ORDER # / DUE DATE   (top-right)
 *   rule
 *   BILL TO   purple-headed card
 *   items     Description | SKU | Qty | Taxed | Amount
 *   notes     OTHER COMMENTS & NOTES + PAYMENT DETAILS
 *   totals    Subtotal / Taxable / GST / Shipping / TOTAL (right column)
 *   footer    contact email + "Thank You For Your Business!"
 *
 * All numbers are monospace so decimal columns line up, exactly as in the
 * reference.
 */
export async function generateInvoicePdf(order: any): Promise<Buffer> {
  const doc = await PDFDocument.create();

  // ORDER MATTERS. pdf-lib assigns object tags in creation order, but
  // embedFont() is lazy (the ref is only minted when the font is first drawn)
  // while embedPng() is immediate. If the image is created first its tag lands
  // where the fonts' tags are computed, and the page's /Font resource dictionary
  // ends up with keys that do not match the /Fn names used in the content
  // stream — text drawn with a missing resource is silently dropped by some
  // renderers (it rendered in some, vanished in others). Creating the image
  // BEFORE the fonts keeps every tag unique and the two in sync.
  let logo: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  try {
    logo = await doc.embedPng(readFileSync(LOGO_PATH));
  } catch {
    console.warn('[Invoice] logo asset missing at', LOGO_PATH, '— printing without it.');
  }

  const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sansItalic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const monoBold = await doc.embedFont(StandardFonts.CourierBold);

  const orderNumber: string = order.order_number || 'MV-000000';
  const invoiceNumber: string = order.invoice_number || buildInvoiceNumber(orderNumber);
  const issued = order.invoice_issued_at ? new Date(order.invoice_issued_at) : new Date();
  const orderDate = order.created_at ? new Date(order.created_at) : issued;
  const issueDate = Number.isNaN(issued.getTime()) ? new Date() : issued;
  const dateOfOrder = Number.isNaN(orderDate.getTime()) ? issueDate : orderDate;

  const prepaid = isPrepaid(order);
  const paid = isPaid(order);
  const buyer = buyerOf(order);
  const seller = getSellerIdentity();

  /* ---------------- money ---------------- */
  const items: any[] = Array.isArray(order.order_items) ? order.order_items : [];
  const lines = items.map((item) => ({
    name: item.product_name || 'Item',
    sku: item.sku || '-',
    qty: Number(item.quantity) || 1,
    gross: round2((Number(item.price) || 0) * (Number(item.quantity) || 1)),
    rate: rateOfProduct(item.products),
  }));

  const totals = computeOrderTotals({
    subtotal: Number(order.subtotal) || 0,
    discount: Number(order.discount) || 0,
    shippingFee: Number(order.shipping_fee) || 0,
    fallbackGst: Number(order.tax) || 0,
    lines,
    shippingGstRatePercent: config.shippingIsTaxable ? 18 : 0,
  });
  const gst = splitGst(totals.gst, buyer.state);
  const shippingFee = round2(Number(order.shipping_fee) || 0);
  const discount = round2(Number(order.discount) || 0);
  // Reference semantics: "Taxable" is the GST-INCLUSIVE amount the tax is
  // charged on, and the GST line is labelled "(Included)" and never added on.
  // "Taxable" on a GST invoice is the value EXCLUDING tax. It must equal the sum
  // of the per-line "Taxed" column, otherwise the same document contradicts
  // itself (lines showed 950.48 while this row showed the 998 gross) and the
  // taxable value + GST would no longer reconcile to the gross.
  const taxableBase = round2(totals.taxable);
  const grandTotal = Number(order.total) || round2(totals.gross - discount + shippingFee);

  /* ---------------- page / cursor ---------------- */
  // Laid out top-down in "y from the top of the page", converted on the way
  // out — the same coordinate space the reference PDF uses.
  let page = doc.addPage([PAGE_W, PAGE_H]);
  // The masthead is emitted last (see drawMasthead) so it is never buried under
  // later fills; it must therefore always target the FIRST page, not whichever
  // page the item loop happened to break onto.
  const firstPage = page;
  let y = MARGIN;
  const Y = (yTop: number) => PAGE_H - yTop;
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = MARGIN;
  };

  const RIGHT = PAGE_W - MARGIN;          // 594
  const BOTTOM_LIMIT = 700;                // footer band starts here

  /* ================= 1. masthead ================= */
  if (logo) {
    const lw = 132;
    page.drawImage(logo, { x: MARGIN + 8, y: Y(MARGIN + 10 + (lw * logo.height) / logo.width), width: lw, height: (lw * logo.height) / logo.width });
  }
  /**
   * The masthead wordmark and the DATE / INVOICE # / ORDER # / DUE DATE box.
   *
   * Deferred to the end of the layout on purpose: emitting them last keeps
   * them above everything else and sidesteps a pdf-lib resource-ordering
   * quirk where early text on the page could be dropped by strict renderers.
   */
  const drawMasthead = () => {
  page = firstPage;
  const title = 'INVOICE';
  page.drawText(title, {
    x: RIGHT - serif.widthOfTextAtSize(title, 34),
    y: Y(50),
    size: 34,
    font: serif,
    color: GOLD,
  });

  /* ---- meta box (top-right) ---- */
  const metaW = 150;
  const metaX = RIGHT - metaW;
  const metaRowH = 22;
  const metaRows: Array<[string, string]> = [
    ['DATE', formatDate(issueDate)],
    ['INVOICE #', invoiceNumber],
    ['ORDER #', orderNumber],
    ['DUE DATE', formatDate(dateOfOrder)],
  ];
  const metaTop = 70;
  // Card background FIRST, then the zebra stripes, then the text, then the
  // border — a fill emitted after the labels would paint straight over them.
  page.drawRectangle({
    x: metaX, y: Y(metaTop + metaRows.length * metaRowH),
    width: metaW, height: metaRows.length * metaRowH, color: WHITE,
  });
  metaRows.forEach(([, ], i) => {
    if (i % 2 !== 1) return;
    const ry = metaTop + i * metaRowH;
    page.drawRectangle({ x: metaX, y: Y(ry + metaRowH), width: metaW, height: metaRowH, color: BORDER });
  });
  metaRows.forEach(([label, value], i) => {
    const ry = metaTop + i * metaRowH;
    page.drawText(label, { x: metaX + 10, y: Y(ry + 15), size: 9, font: sansBold, color: HEADING });
    page.drawText(value, {
      x: metaX + metaW - 10 - mono.widthOfTextAtSize(value, 9),
      y: Y(ry + 15), size: 9, font: mono, color: HEADING,
    });
  });
  page.drawRectangle({
    x: metaX, y: Y(metaTop + metaRows.length * metaRowH),
    width: metaW, height: metaRows.length * metaRowH,
    borderColor: BORDER, borderWidth: 0.8,
  });
  };

  /* ---- seller block ---- */
  y = 95;
  page.drawText(seller.name, { x: MARGIN, y: Y(y), size: 15, font: serif, color: WORDMARK });
  y += 23;
  const sellerLines = [...seller.addressLines];
  for (const line of sellerLines) {
    page.drawText(line, { x: MARGIN, y: Y(y), size: 9, font: sans, color: BODY });
    y += 14;
  }
  y += 6;
  page.drawText(`Phone: ${seller.phone}   |   Email: ${seller.email}`, {
    x: MARGIN, y: Y(y), size: 9, font: sans, color: BODY,
  });
  y += 14;
  page.drawText(`Website: ${seller.website}`, { x: MARGIN, y: Y(y), size: 9, font: sans, color: BODY });
  y += 15;
  page.drawText(`GSTIN: ${seller.gstin}`, { x: MARGIN, y: Y(y), size: 9, font: monoBold, color: HEADING });

  /* ---- rule ---- */
  page.drawLine({
    start: { x: MARGIN, y: Y(209) }, end: { x: RIGHT, y: Y(209) },
    thickness: 0.8, color: RULE,
  });

  /* ================= 2. BILL TO card ================= */
  const cardX = MARGIN;
  const cardW = 300;
  const cardHeadH = 22;
  const buyerLines = [
    buyer.fullName,
    ...buyer.addressLines,
    [buyer.city, buyer.state, buyer.zipCode].filter(Boolean).join(', '),
    ...(buyer.phone ? [`Phone: ${buyer.phone}`] : []),
  ].filter(Boolean);

  // Measure first so the card is never shorter than its own content.
  const buyerWrapped: Array<{ text: string; bold: boolean }> = [];
  for (const [i, line] of buyerLines.entries()) {
    const f = i === 0 ? sansBold : sans;
    for (const t of wrapText(f, line, 9, cardW - 24)) buyerWrapped.push({ text: t, bold: i === 0 });
  }
  const cardBodyH = 14 + buyerWrapped.length * 14 + 12;
  const cardTop = 244;

  page.drawRectangle({ x: cardX, y: Y(cardTop + cardHeadH), width: cardW, height: cardHeadH, color: PURPLE });
  page.drawText('BILL TO', { x: cardX + 12, y: Y(cardTop + 15), size: 9, font: sansBold, color: WHITE });
  page.drawRectangle({
    x: cardX, y: Y(cardTop + cardHeadH + cardBodyH), width: cardW, height: cardBodyH,
    borderColor: BORDER, borderWidth: 0.8, color: WHITE,
  });
  let by = cardTop + cardHeadH + 20;
  for (const l of buyerWrapped) {
    page.drawText(l.text, {
      x: cardX + 12, y: Y(by), size: 9, font: l.bold ? sansBold : sans, color: l.bold ? HEADING : BODY,
    });
    by += 14;
  }
  y = cardTop + cardHeadH + cardBodyH + 26;

  /* ================= 3. items table ================= */
  // Widths are sized for the widest realistic figure: the Taxed column has to hold
  // "Rs. 12,345.67" (12 monospace chars) without bleeding into Qty.
  const cols = [
    { key: 'Description', x: MARGIN, w: 282, align: 'l' as const },
    { key: 'SKU', x: MARGIN + 282, w: 80, align: 'l' as const },
    { key: 'Qty', x: MARGIN + 362, w: 35, align: 'r' as const },
    { key: 'Taxed', x: MARGIN + 397, w: 90, align: 'r' as const },
    { key: 'Amount', x: MARGIN + 487, w: RIGHT - (MARGIN + 487), align: 'r' as const },
  ];
  const headH = 22;

  const drawTableHeader = (pg: PDFPage, atTop: number) => {
    cols.forEach((c) => {
      pg.drawRectangle({ x: c.x, y: Y(atTop + headH), width: c.w, height: headH, color: PURPLE });
      const tw = sansBold.widthOfTextAtSize(c.key, 9);
      pg.drawText(c.key, {
        x: c.align === 'r' ? c.x + c.w - 10 - tw : c.x + 10,
        y: Y(atTop + 15), size: 9, font: sansBold, color: WHITE,
      });
    });
  };

  drawTableHeader(page, y);
  y += headH;

  if (lines.length === 0) {
    page.drawRectangle({ x: MARGIN, y: Y(y + 28), width: RIGHT - MARGIN, height: 28, borderColor: BORDER, borderWidth: 0.8 });
    page.drawText('No items', { x: MARGIN + 12, y: Y(y + 18), size: 9, font: sans, color: BODY });
    y += 28;
  }

  for (const line of lines) {
    const descLines = wrapText(sans, line.name, 9, cols[0].w - 24);
    const rowH = Math.max(30, descLines.length * 13 + 14);

    // Never split a row, and never let the totals land on top of the table.
    if (y + rowH > BOTTOM_LIMIT - 200) {
      newPage();
      drawTableHeader(page, y);
      y += headH;
    }

    page.drawRectangle({
      x: MARGIN, y: Y(y + rowH), width: RIGHT - MARGIN, height: rowH,
      borderColor: BORDER, borderWidth: 0.8, color: WHITE,
    });
    descLines.forEach((t, i) =>
      page.drawText(t, { x: MARGIN + 12, y: Y(y + 19 + i * 13), size: 9, font: sans, color: BODY })
    );

    let skuSize = 9;
    while (skuSize > 5 && mono.widthOfTextAtSize(line.sku, skuSize) > cols[1].w - 20) skuSize -= 0.5;
    page.drawText(line.sku, { x: cols[1].x + 10, y: Y(y + 19), size: skuSize, font: mono, color: BODY });

    const qty = String(line.qty);
    page.drawText(qty, {
      x: cols[2].x + cols[2].w - 10 - mono.widthOfTextAtSize(qty, 9),
      y: Y(y + 19), size: 9, font: mono, color: BODY,
    });

    // "Taxed" = the taxable value inside the GST-inclusive line amount.
    // Shrink rather than overflow into the Qty column.
    const taxedStr = money(grossToTaxable(line.gross, line.rate));
    let taxedSize = 9;
    while (taxedSize > 5 && mono.widthOfTextAtSize(taxedStr, taxedSize) > cols[3].w - 12) {
      taxedSize -= 0.5;
    }
    page.drawText(taxedStr, {
      x: cols[3].x + cols[3].w - 8 - mono.widthOfTextAtSize(taxedStr, taxedSize),
      y: Y(y + 19), size: taxedSize, font: mono, color: BODY,
    });

    const amt = money(line.gross);
    let amtSize = 9;
    while (amtSize > 5 && monoBold.widthOfTextAtSize(amt, amtSize) > cols[4].w - 12) {
      amtSize -= 0.5;
    }
    page.drawText(amt, {
      x: cols[4].x + cols[4].w - 8 - monoBold.widthOfTextAtSize(amt, amtSize),
      y: Y(y + 19), size: amtSize, font: monoBold, color: BODY,
    });

    y += rowH;
  }

  /* ================= 4. notes (left) + totals (right) ================= */
  const gutter = 18;
  const notesW = 300;
  const notesX = MARGIN;
  const totalsX = notesX + notesW + gutter;
  const totalsW = RIGHT - totalsX;

  const noteLines: Array<{ text: string; font: 'sans' | 'bold'; color: any }> = [];
  if (order.payu_mihpayid) {
    noteLines.push({ text: `Payment Reference: ${order.payu_mihpayid}`, font: 'sans', color: BODY });
  }
  if (order.notes) noteLines.push({ text: `Customer Note: ${order.notes}`, font: 'bold', color: BODY });
  noteLines.push(
    { text: paid ? '1. This invoice has been PAID in full.' : '1. Total payment due upon receipt.', font: 'sans', color: BODY },
    { text: '2. Please include the invoice number with your payment.', font: 'sans', color: BODY }
  );
  const methodLine = `Method: ${String(order.payment_method || (prepaid ? 'PayOnline (via PayU)' : 'Cash on Delivery'))}`;

  // Totals rows decide how tall the right-hand table is.
  const totalRows: Array<[string, string, boolean]> = [];
  totalRows.push(['Subtotal', money(totals.gross), false]);
  if (discount > 0) {
    totalRows.push([
      `Discount${order.coupon_code ? ` (${order.coupon_code})` : ''}`,
      `- ${money(discount)}`,
      false,
    ]);
  }
  totalRows.push(['Taxable', money(taxableBase), false]);
  if (gst.mode === 'intra') {
    totalRows.push(['CGST (Included)', money(gst.cgst), false]);
    totalRows.push(['SGST (Included)', money(gst.sgst), false]);
  } else {
    totalRows.push(['IGST (Included)', money(gst.igst), false]);
  }
  totalRows.push(['Shipping', shippingFee === 0 ? 'FREE' : money(shippingFee), false]);
  totalRows.push(['TOTAL', money(grandTotal), true]);
  const totalRowH = paid ? 26 : 30;
  const totalsH = 22 + totalRows.length * totalRowH + 10;

  const wrappedNotes: string[] = [];
  for (const l of noteLines) {
    const f = l.font === 'bold' ? sansBold : sans;
    for (const t of wrapText(f, l.text, 9, notesW - 24)) wrappedNotes.push(t);
  }
  const notesH = 22 + 14 + wrappedNotes.length * 14 + 18 + 22 + 14 + 10;

  if (y + Math.max(notesH, totalsH) > BOTTOM_LIMIT) {
    newPage();
    drawTableHeader(page, y);
    y += headH;
  }

  // ---- notes card ----
  let ny = y + 22;
  page.drawRectangle({ x: notesX, y: Y(y + 22), width: notesW, height: 22, color: PURPLE });
  page.drawText('OTHER COMMENTS & NOTES', {
    x: notesX + 12, y: Y(y + 15), size: 9, font: sansBold, color: WHITE,
  });
  page.drawRectangle({
    x: notesX, y: Y(y + notesH), width: notesW, height: notesH,
    borderColor: BORDER, borderWidth: 0.8, color: WHITE,
  });
  ny += 14;
  for (const t of wrappedNotes) {
    page.drawText(t, { x: notesX + 12, y: Y(ny), size: 9, font: sans, color: BODY });
    ny += 14;
  }
  ny += 10;
  page.drawText('PAYMENT DETAILS:', { x: notesX + 12, y: Y(ny), size: 9, font: sansBold, color: HEADING });
  ny += 15;
  page.drawText(methodLine, { x: notesX + 12, y: Y(ny), size: 9, font: sans, color: BODY });
  if (paid) {
    ny += 14;
    page.drawText('PAID', { x: notesX + 12, y: Y(ny), size: 9, font: sansBold, color: GREEN });
  }

  // ---- totals table ----
  let ty = y;
  page.drawRectangle({
    x: totalsX, y: Y(totalsH + 22), width: totalsW, height: totalsH + 22,
    borderColor: BORDER, borderWidth: 0.8, color: WHITE,
  });
  totalRows.forEach(([label, value, bold], i) => {
    const ry = ty + 22 + i * totalRowH;
    if (i % 2 === 0) {
      page.drawRectangle({ x: totalsX, y: Y(ry + totalRowH), width: totalsW, height: totalRowH, color: BORDER });
    }
    page.drawLine({
      start: { x: totalsX, y: Y(ry + totalRowH) }, end: { x: totalsX + totalsW, y: Y(ry + totalRowH) },
      thickness: 0.8, color: BORDER,
    });
    const f = bold ? sansBold : sans;
    const mf = bold ? monoBold : mono;
    const size = bold ? 10.5 : 9;
    page.drawText(label, {
      x: totalsX + totalsW - 14 - mf.widthOfTextAtSize(value, size) - 10 - f.widthOfTextAtSize(label, size),
      y: Y(ry + totalRowH / 2 + 3), size, font: f, color: HEADING,
    });
    page.drawText(value, {
      x: totalsX + totalsW - 14 - mf.widthOfTextAtSize(value, size),
      y: Y(ry + totalRowH / 2 + 3), size, font: mf, color: HEADING,
    });
  });

  drawMasthead();

  /* ================= 5. footer ================= */
  const f1 = 'If you have any questions about this invoice, please contact';
  page.drawText(f1, {
    x: (PAGE_W - sansItalic.widthOfTextAtSize(f1, 10.5)) / 2, y: Y(724), size: 10.5, font: sansItalic, color: BODY,
  });
  page.drawText(seller.email, {
    x: (PAGE_W - sansBold.widthOfTextAtSize(seller.email, 10.5)) / 2, y: Y(746), size: 10.5, font: sansBold, color: HEADING,
  });
  const f3 = 'Thank You For Your Business!';
  page.drawText(f3, {
    x: (PAGE_W - serif.widthOfTextAtSize(f3, 14)) / 2, y: Y(770), size: 14, font: serif, color: WORDMARK,
  });

  // useObjectStreams:false keeps the xref table and every object in plain
  // sight. Some viewers (and a few mail/WhatsApp PDF renderers) silently drop
  // content that lives inside a compressed object stream, and an invoice is
  // the worst possible place for that to happen.
  const bytes = await doc.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}

/* ------------------------------------------------------------------ */
/* Invoice number                                                      */
/* ------------------------------------------------------------------ */

/**
 * Legacy fallback used only when the claim RPC is unavailable (the SQL
 * migration has not been applied). Deterministic per order so a regeneration
 * never invents a second number, and shaped like the real series.
 */
export function buildInvoiceNumber(orderNumber: string, issuedAt: Date = new Date()): string {
  const digest = Math.abs(
    String(orderNumber || '').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)
  );
  return formatInvoiceNumber(invoiceFyLabel(issuedAt), (digest % 900000) + 100000);
}

/**
 * Claim this order atomically and take its invoice number from the FY series.
 *
 * `claim_invoice()` (backend/sql/migrations/2026-10-15_invoice_automation.sql)
 * does both in one transaction, so there is no window in which an order is
 * claimed but unnumbered, and no window in which a sequence value is consumed
 * but not persisted. The FY is derived from the invoice date at allocation
 * time (April-March), never hardcoded.
 *
 * Returns null when another worker already claimed the order — callers treat
 * that as "already handled", not as an error. That null is the whole
 * once-only guarantee: a PayU double-POST, a parallel cron sweep and the
 * original trigger all race here and exactly one of them wins.
 */
export async function claimInvoiceNumber(order: {
  id: string;
  invoice_number?: string | null;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('claim_invoice', { p_order_id: order.id });
    if (error) throw new Error(error.message);
    if (data) {
      (order as any).invoice_number = data;
      return String(data);
    }
    return null; // already claimed by someone else
  } catch (err: any) {
    // Degraded mode: the migration has not been applied, so there is no atomic
    // claim and no real series. We still produce a stable number so the rest of
    // the pipeline works, but it is NOT gapless and NOT race-safe — which is
    // exactly why the boot-time schema audit refuses to start.
    console.error(
      `[Invoice] claim_invoice RPC unavailable (${err?.message || err}) — is ` +
        'backend/sql/migrations/2026-10-15_invoice_automation.sql applied? ' +
        'Falling back to NON-ATOMIC legacy numbering; the once-only guarantee does not hold.'
    );
    const legacy = order.invoice_number || buildInvoiceNumber(String((order as any).order_number || ''));
    (order as any).invoice_number = legacy;
    try {
      // Deliberately claims, does not "send": delivery is recorded separately by
      // markInvoiceSent() once a channel actually succeeded.
      await supabase
        .from('orders')
        .update({ invoice_number: legacy, invoice_claimed_at: new Date().toISOString() })
        .eq('id', order.id)
        .is('invoice_number', null);
    } catch (persistErr: any) {
      console.error('[Invoice] could not persist fallback invoice number:', persistErr?.message || persistErr);
    }
    return legacy;
  }
}

/** Release a failed claim so the retry sweep can run again. Number is KEPT. */
export async function releaseInvoiceClaim(orderId: string, reason: string): Promise<void> {
  const message = String(reason).slice(0, 500);
  try {
    await supabase.rpc('release_invoice_claim', { p_order_id: orderId, p_reason: message });
  } catch {
    await supabase
      .from('orders')
      .update({ invoice_claimed_at: null, invoice_error: message })
      .eq('id', orderId);
  }
}

/**
 * Record the delivery outcome. This is the ONLY writer of invoice_sent_at, so
 * "Sent" in the admin panel means a channel really accepted the document —
 * claiming the order no longer masquerades as delivering it.
 */
export async function markInvoiceSent(
  orderId: string,
  statuses: { whatsapp?: ChannelOutcome | null; email?: ChannelOutcome | null } = {}
): Promise<void> {
  const whatsapp = statuses.whatsapp ?? null;
  const email = statuses.email ?? null;
  try {
    await supabase.rpc('mark_invoice_sent', {
      p_order_id: orderId,
      p_whatsapp: whatsapp,
      p_email: email,
    });
  } catch {
    await supabase
      .from('orders')
      .update({
        invoice_sent_at: new Date().toISOString(),
        invoice_error: null,
        ...(whatsapp ? { invoice_whatsapp_status: whatsapp } : {}),
        ...(email ? { invoice_email_status: email } : {}),
      })
      .eq('id', orderId);
  }
}

/** Persist the last failure reason so the admin card and the sweep can see it. */
export async function recordInvoiceError(orderId: string, reason: string): Promise<void> {
  try {
    if (await hasColumn('orders', 'invoice_error')) {
      await supabase
        .from('orders')
        .update({ invoice_error: String(reason).slice(0, 500) })
        .eq('id', orderId);
    }
  } catch (err: any) {
    console.error('[Invoice] could not persist invoice_error:', err?.message || err);
  }
}

export const invoiceService = {
  getOrderForInvoice,
  generateInvoicePdf,
  buildInvoiceNumber,
  claimInvoiceNumber,
  releaseInvoiceClaim,
  markInvoiceSent,
  recordInvoiceError,
  getSellerIdentity,
  wrapText,
};
