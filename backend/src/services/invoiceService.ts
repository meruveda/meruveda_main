import { PDFDocument, StandardFonts, rgb, PDFPage } from 'pdf-lib';
import { supabase } from '../database/supabase';

const BRAND = rgb(0.169, 0.094, 0.125); // deep purple #2B1820
const GOLD = rgb(0.753, 0.619, 0.353); // #C09E5A
const GREY = rgb(0.42, 0.42, 0.42);
const WHITE = rgb(1, 1, 1);

const money = (value: any) => `Rs. ${Number(value || 0).toFixed(2)}`;

const SELLER = {
  name: 'MeruVeda Wellness',
  line1: 'Keharsh Enterprises (Sole Proprietorship)',
  line2: 'S/N. 12, Viru City Gym Road, Inside Jalori Gate,',
  line3: 'Jodhpur - 342001, Rajasthan, India',
  gstin: process.env.GSTIN || '08BFPPS7045C1Z4',
  email: 'customercare@meruvedawellness.com',
  website: process.env.FRONTEND_URL || 'https://meruvedawellness.com',
};

/** Load an order with items + buyer details, shaped for invoicing. */
export async function getOrderForInvoice(orderId: string) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*), users(email, first_name, last_name, phone)')
    .eq('id', orderId)
    .single();

  if (error || !data) {
    const err = new Error('Order not found');
    (err as any).status = 404;
    throw err;
  }
  return data;
}

function drawHeader(page: PDFPage, width: number, orderNumber: string, createdAt: string) {
  page.drawRectangle({ x: 0, y: 762, width, height: 80, color: BRAND });
  page.drawText(SELLER.name, { x: 40, y: 806, size: 22, color: WHITE });
  page.drawText('Ayurvedic Wellness', { x: 40, y: 788, size: 10, color: GOLD });
  page.drawText('TAX INVOICE', { x: width - 140, y: 806, size: 16, color: WHITE });
  page.drawText(`#${orderNumber}`, { x: width - 140, y: 788, size: 11, color: GOLD });
  page.drawText(createdAt, { x: width - 140, y: 772, size: 9, color: WHITE });
}

/**
 * Render the ordered items into a printable A4 invoice PDF.
 * Uses only the standard Helvetica fonts so it needs no font assets at runtime.
 */
export async function generateInvoicePdf(order: any): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const width = 595;
  const height = 842;
  const page = doc.addPage([width, height]);

  const orderNumber = order.order_number || 'MV-000000';
  const createdDate = order.created_at ? new Date(order.created_at) : null;
  const created =
    createdDate && !Number.isNaN(createdDate.getTime())
      ? createdDate.toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : 'Date unavailable';

  drawHeader(page, width, orderNumber, created);

  // ---- Seller / buyer blocks ----
  // Fixed template: header + From / Bill To / Ship To + items + totals.
  let y = 730;
  page.drawText('From', { x: 40, y, size: 9, font: bold, color: GREY });
  y -= 14;
  [SELLER.name, SELLER.line1, SELLER.line2, SELLER.line3, `GSTIN: ${SELLER.gstin}`, SELLER.email, SELLER.website].forEach((line) => {
    page.drawText(line, { x: 40, y, size: 10, font: helv, color: BRAND });
    y -= 13;
  });

  const bill = order.billing_address || {};
  const ship = order.shipping_address || {};
  const hasSeparateShipping = Boolean(order.shipping_address) && JSON.stringify(bill) !== JSON.stringify(ship);
  const buyer = {
    fullName: bill.fullName || ship.fullName || 'Customer',
    addressLine: bill.addressLine || ship.addressLine || '',
    city: bill.city || ship.city || '',
    state: bill.state || ship.state || '',
    zipCode: bill.zipCode || ship.zipCode || '',
    phone: bill.phone || ship.phone || '',
  };
  const buyerLines = [
    buyer.fullName,
    buyer.addressLine,
    `${buyer.city}${buyer.state ? ', ' + buyer.state : ''}${buyer.zipCode ? ' - ' + buyer.zipCode : ''}`,
    buyer.phone ? `Phone: ${buyer.phone}` : '',
    order.users?.email ? `Email: ${order.users.email}` : '',
  ].filter(Boolean);

  let by = 730;
  page.drawText('Bill To', { x: 300, y: by, size: 9, font: bold, color: GREY });
  by -= 14;
  buyerLines.forEach((line) => {
    page.drawText(String(line).slice(0, 60), { x: 300, y: by, size: 10, font: helv, color: BRAND });
    by -= 13;
  });
  if (hasSeparateShipping) {
    by -= 4;
    page.drawText('Ship To', { x: 300, y: by, size: 9, font: bold, color: GREY });
    by -= 14;
    const shipLines = [
      ship.fullName || '',
      ship.addressLine || '',
      `${ship.city || ''}${ship.state ? ', ' + ship.state : ''}${ship.zipCode ? ' - ' + ship.zipCode : ''}`,
      ship.phone ? `Phone: ${ship.phone}` : '',
    ].filter(Boolean);
    shipLines.forEach((line) => {
      page.drawText(String(line).slice(0, 60), { x: 300, y: by, size: 10, font: helv, color: BRAND });
      by -= 13;
    });
  }

  // ---- Items table ----
  // Same template on every page: repeat the header row when items overflow
  // one A4 page so long orders are never clipped.
  const drawTableHeader = (pg: PDFPage, atY: number) => {
    pg.drawRectangle({ x: 40, y: atY - 4, width: width - 80, height: 22, color: GOLD });
    pg.drawText('Item', { x: cols.name, y: atY + 3, size: 10, font: bold, color: WHITE });
    pg.drawText('Qty', { x: cols.qty, y: atY + 3, size: 10, font: bold, color: WHITE });
    pg.drawText('Rate', { x: cols.rate, y: atY + 3, size: 10, font: bold, color: WHITE });
    pg.drawText('Amount', { x: cols.amount, y: atY + 3, size: 10, font: bold, color: WHITE });
  };

  y = Math.min(y, by) - 24;
  const cols = { name: 48, qty: 330, rate: 390, amount: 470 };
  let currentPage = page;
  drawTableHeader(currentPage, y);

  y -= 24;
  const items: any[] = order.order_items || [];
  const newPage = () => {
    currentPage = doc.addPage([width, height]);
    y = height - 60;
    drawTableHeader(currentPage, y);
    y -= 24;
  };
  items.forEach((item) => {
    if (y < 260) newPage(); // keep room for totals + footer
    const label = (item.product_name || 'Item').slice(0, 42);
    const qty = Number(item.quantity) || 1;
    const price = Number(item.price) || 0;
    currentPage.drawText(label, { x: cols.name, y, size: 10, font: helv, color: BRAND });
    currentPage.drawText(String(qty), { x: cols.qty, y, size: 10, font: helv, color: BRAND });
    currentPage.drawText(money(price), { x: cols.rate, y, size: 10, font: helv, color: BRAND });
    currentPage.drawText(money(Number(item.total) || qty * price), { x: cols.amount, y, size: 10, font: helv, color: BRAND });
    currentPage.drawLine({
      start: { x: 40, y: y - 6 },
      end: { x: width - 40, y: y - 6 },
      thickness: 0.5,
      color: rgb(0.9, 0.9, 0.9),
    });
    y -= 22;
  });

  // ---- Totals ----
  if (y < 220) newPage();
  y -= 12;
  const totals: Array<[string, string]> = [
    ['Subtotal', money(order.subtotal)],
    [`Discount${order.discount ? '' : ''}`, `- ${money(order.discount)}`],
    ['Tax (GST)', money(order.tax)],
    ['Shipping', Number(order.shipping_fee) === 0 ? 'FREE' : money(order.shipping_fee)],
  ];
  totals.forEach(([label, value]) => {
    currentPage.drawText(label, { x: 340, y, size: 10, font: helv, color: GREY });
    currentPage.drawText(value, { x: 455, y, size: 10, font: helv, color: BRAND });
    y -= 16;
  });

  y -= 4;
  currentPage.drawRectangle({ x: 330, y: y - 8, width: 225, height: 26, color: BRAND });
  currentPage.drawText('TOTAL', { x: 340, y: y, size: 12, font: bold, color: WHITE });
  currentPage.drawText(money(order.total), { x: 455, y: y, size: 12, font: bold, color: GOLD });

  // ---- Payment / footer ----
  y -= 44;
  currentPage.drawText(`Payment method: ${order.payment_method || '-'}`, {
    x: 40, y, size: 10, font: helv, color: BRAND,
  });
  y -= 14;
  currentPage.drawText(`Payment status: ${(order.payment_status || 'pending').toUpperCase()}`, {
    x: 40, y, size: 10, font: helv, color: BRAND,
  });

  if (order.awb_code) {
    y -= 14;
    currentPage.drawText(`Tracking (AWB): ${order.awb_code}${order.courier_name ? ` — ${order.courier_name}` : ''}`, {
      x: 40, y, size: 10, font: helv, color: BRAND,
    });
  }

  y -= 30;
  currentPage.drawText('Thank you for shopping with MeruVeda.', { x: 40, y, size: 11, font: bold, color: GOLD });
  y -= 14;
  currentPage.drawText(
    'This is a computer generated invoice and does not require a physical signature.',
    { x: 40, y, size: 8, font: helv, color: GREY }
  );

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

export const invoiceService = {
  getOrderForInvoice,
  generateInvoicePdf,
};
