import { Request, Response, NextFunction } from 'express';
import { orderService, pushOrderToShiprocket, retryFailedShiprocketPushes } from '../services/orderService';
import { postOrderConfirmed, isCodOrder, sendOrderConfirmationText } from '../services/postOrderConfirmed';
import { invoiceDispatchService } from '../services/invoiceDispatchService';
import { supabase } from '../database/supabase';
import { normalizePhone } from '../services/whatsappService';
import { hasColumn } from '../services/schemaGuard';
import { verifyToken } from '../utils/jwt';
import { config } from '../config/env';
import { timingSafeEqualStr } from '../utils/timingSafe';
import { shiprocketTrackingService } from '../services/shiprocket/tracking.service';
import { shiprocketWebhookService } from '../services/shiprocket/webhook.service';
import { getOrderForInvoice, generateInvoicePdf } from '../services/invoiceService';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await orderService.getOrders(req.query);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = await orderService.getOrderById(id as string);
    // Ownership check: shoppers may only fetch their own orders; admins any.
    if (req.user?.role !== 'admin' && (data as any)?.user_id !== req.user?.id) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    res.json({ data });
  } catch (error: any) {
    if (error.status === 404) {
      return res.status(404).json({ error: { message: error.message } });
    }
    next(error);
  }
};

export const createOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await orderService.createOrder(req.body, req.user?.id);

    // Cash on Delivery is the ONLY method that reaches the post-confirmation
    // hook from here. A prepaid order is invoiced exclusively from the verified
    // PayU callback — firing here too used to produce a second invoice attempt
    // (on an unverified, unpaid order) for every prepaid checkout.
    if (isCodOrder(data)) {
      const { data: confirmationOrder } = await supabase
        .from('orders')
        .select('*')
        .eq('id', data.id)
        .maybeSingle();
      // Confirmation text is a courtesy; the invoice is the dispatcher's job.
      sendOrderConfirmationText(confirmationOrder).catch((err: any) =>
        console.error('[Orders] order confirmation text failed:', err?.message || err)
      );
      postOrderConfirmed(data.id, { source: 'cod_placement' }).catch((postErr: any) => {
        console.error('[Orders] postOrderConfirmed failed:', postErr?.message || postErr);
      });
    }

    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
};

/**
 * PUBLIC guest order lookup — order number (or id) + mobile number, no login.
 * Powers the /track page.
 */
export const trackOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderRef = String(req.query.order || req.query.orderNumber || '').trim();
    const phone = normalizePhone(String(req.query.phone || req.query.mobile || ''));

    if (!orderRef || !phone) {
      return res.status(400).json({ error: { message: 'Order number and mobile number are required.' } });
    }

    // `orders.delivered_at` lands in delta 006 — skip it while that is pending so
    // the whole lookup still succeeds and the date simply comes back null.
    const deliveredColumn = (await hasColumn('orders', 'delivered_at')) ? 'delivered_at, ' : '';

    // A non-UUID reference inside `id.eq.<value>` makes PostgREST reject the whole
    // filter ("invalid input syntax for type uuid"), which would 500 every lookup
    // by plain order number. Only add the id branch when the value really is one,
    // and drop characters that would break the or() expression.
    const safeRef = orderRef.replace(/[^A-Za-z0-9_-]/g, '');
    if (!safeRef) {
      return res.status(400).json({ error: { message: 'Order number and mobile number are required.' } });
    }
    const lookupFilter = UUID_PATTERN.test(safeRef)
      ? `order_number.eq.${safeRef},id.eq.${safeRef}`
      : `order_number.eq.${safeRef}`;

    const { data, error } = await supabase
      .from('orders')
      .select(`id, order_number, status, payment_status, created_at, ${deliveredColumn}awb_code, courier_name, tracking_url, tracking_status, estimated_delivery, last_tracking_update, shipping_address, order_tracking_history(*)`)
      .or(lookupFilter)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const order: any = data;
    if (!order) {
      return res.status(404).json({ error: { message: 'No order found for these details.' } });
    }

    const orderPhone = normalizePhone(order.shipping_address?.phone || '');
    if (!orderPhone || orderPhone !== phone) {
      // Same message as "not found" so the endpoint cannot be used to enumerate orders.
      return res.status(404).json({ error: { message: 'No order found for these details.' } });
    }

    res.json({
      data: {
        order_number: order.order_number,
        status: order.status,
        payment_status: order.payment_status,
        created_at: order.created_at,
        delivered_at: order.delivered_at ?? null,
        awb_code: order.awb_code,
        courier_name: order.courier_name,
        tracking_url: order.tracking_url,
        tracking_status: order.tracking_status,
        estimated_delivery: order.estimated_delivery,
        last_tracking_update: order.last_tracking_update,
        shipping_address: {
          city: order.shipping_address?.city,
          state: order.shipping_address?.state,
          zipCode: order.shipping_address?.zipCode,
        },
        tracking_history: (order.order_tracking_history || [])
          .slice()
          .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUBLIC live AWB lookup — tracking ID entered manually on /track.
 * Calls Shiprocket live and syncs the matching local order (if any).
 */
export const trackByAwb = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const awb = String(req.query.awb || req.query.trackingId || '').trim();
    if (!awb) {
      return res.status(400).json({ error: { message: 'Please enter a tracking ID (AWB).' } });
    }
    if (!/^[A-Za-z0-9]{6,30}$/.test(awb)) {
      return res.status(400).json({ error: { message: 'That tracking ID looks invalid. AWBs are usually 6+ letters/digits.' } });
    }
    let live: any;
    try {
      live = await shiprocketTrackingService.trackAwb(awb);
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (err?.status === 404 || /not found|invalid|no data/i.test(msg)) {
        return res.status(404).json({ error: { message: 'No shipment found for this tracking ID. Check the AWB and try again.' } });
      }
      throw err;
    }
    const track = live?.tracking_data?.shipment_track?.[0];
    if (!track) {
      return res.status(404).json({ error: { message: 'No shipment found for this tracking ID. Check the AWB and try again.' } });
    }
    try {
      await shiprocketWebhookService.processWebhook({
        awb,
        current_status: track.current_status,
        shipment_id: track.shipment_id ? String(track.shipment_id) : null,
        sr_order_id: track.order_id ? String(track.order_id) : null,
        courier: track.courier_name,
        expected_delivery: track.etd,
        tracking_url: track.tracking_url,
        scans: (track.scans || []).map((scan: any) => ({
          date: scan.date,
          activity: scan.activity,
          location: scan.location,
          'sr-status-label': scan.status,
        })),
      });
    } catch (syncErr) {
      console.error('[Track AWB] DB sync failed:', syncErr);
    }
    res.json({
      data: {
        awb_code: track.awb_code || awb,
        courier_name: track.courier_name || null,
        current_status: track.current_status || null,
        status: track.current_status || null,
        tracking_status: track.current_status || null,
        estimated_delivery: track.etd || null,
        tracking_url: track.tracking_url || null,
        origin: track.origin || null,
        destination: track.destination || null,
        scans: track.scans || [],
        tracking_history: (track.scans || []).map((scan: any) => ({
          activity: scan.activity,
          location: scan.location,
          created_at: scan.date,
        })),
      },
      live: true,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Serve the invoice PDF for one order.
 *
 * The PDF stored in Supabase is returned whenever it exists — an issued invoice
 * is a legal document and must never be re-rendered, because a regeneration
 * after an amount change would silently produce a DIFFERENT document under the
 * SAME invoice number.
 *
 * The render path is kept only as a fallback for orders invoiced before storage
 * existed, and only when the order has no number yet (so nothing is issued).
 */
export const downloadInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { data: orderRow } = await supabase
      .from('orders')
      .select('id, user_id, order_number, invoice_url, invoice_number')
      .eq('id', id)
      .maybeSingle();
    if (!orderRow) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    if (req.user?.role !== 'admin' && orderRow.user_id !== req.user?.id) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }

    // The GST invoice number is the document's legal identity, so it wins over the
    // order number in the filename. Slashes in the series must not create folders.
    const safeInvoice = String(orderRow.invoice_number || orderRow.order_number).replace(
      /[^A-Za-z0-9._-]+/g,
      '_'
    );
    const headers: Record<string, string> = {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Invoice-${safeInvoice}.pdf"`,
      // Invoices contain PII — never let a shared proxy cache them.
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    };

    if (orderRow.invoice_url && config.invoiceStorageBucket) {
      const { data, error } = await supabase.storage
        .from(config.invoiceStorageBucket)
        .download(orderRow.invoice_url);
      if (!error && data) {
        const bytes = Buffer.from(await data.arrayBuffer());
        headers['Content-Length'] = String(bytes.length);
        // Must set the PDF headers here too: without them Express sends a Buffer
        // as application/octet-stream with no filename, so an anchor-based
        // download (and any "open in new tab") loses the Content-Disposition.
        res.set(headers);
        return res.send(bytes);
      }
      console.warn(
        `[Invoice] stored PDF unavailable for order ${orderRow.order_number} (${error?.message}) — ` +
          (orderRow.invoice_number ? 'NOT regenerating: this invoice has already been issued.' : 'rendering a new one.')
      );
      // Already-issued invoices must not be re-rendered; tell the caller why.
      if (orderRow.invoice_number) {
        return res.status(410).json({
          error: {
            message:
              'This invoice was already issued and its stored file is no longer available. Re-issue a copy from the admin order page.',
          },
        });
      }
    }

    // Fallback: no stored file AND no number issued yet (legacy order).
    const order = await getOrderForInvoice(id as string);
    const pdf = await generateInvoicePdf(order);
    headers['Content-Length'] = String(pdf.length);
    res.set(headers);
    return res.send(pdf);
  } catch (error: any) {
    if (error.status === 404) {
      return res.status(404).json({ error: { message: error.message } });
    }
    next(error);
  }
};

/** Regenerate + resend the PDF invoice over WhatsApp (customer and admin). */
export const resendInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Owner-or-admin check (mirrors the Shiprocket invoice endpoint).
    const { data: orderRow } = await supabase
      .from('orders')
      .select('id, user_id')
      .eq('id', id)
      .maybeSingle();
    if (!orderRow) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    if (req.user?.role !== 'admin' && orderRow.user_id !== req.user?.id) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }

    const result = await invoiceDispatchService.resendInvoiceDispatch(id as string);
    const channels = [result.email, result.whatsapp]
      .filter((s) => s === 'sent')
      .length;
    res.json({
      data: result,
      message:
        channels > 0
          ? `Invoice ${result.invoiceNumber} resent (${[result.email === 'sent' && 'email', result.whatsapp === 'sent' && 'WhatsApp'].filter(Boolean).join(' + ')}).`
          : `Invoice could not be resent: ${result.reason || 'no channel available'}`,
    });
  } catch (error: any) {
    if (error.status === 404) {
      return res.status(404).json({ error: { message: error.message } });
    }
    next(error);
  }
};

/** Manual fallback: push one order to Shiprocket (admin). */
export const pushToShiprocket = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await pushOrderToShiprocket(id as string);
    res.json({ data: result, message: 'Order pushed to Shiprocket.' });
  } catch (error: any) {
    console.error(`[Shiprocket] manual push failed for order ${req.params.id}:`, error?.message || error);
    res.status(502).json({ error: { message: error?.message || 'Shiprocket push failed. Check server logs.' } });
  }
};

/** Retry failed pushes (admin JWT or cron with CRON_SECRET — no user session needed). */
export const retryShiprocketPushes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cronSecret = config.cronSecret;
    const authHeader = String(req.headers.authorization || '');
    // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; the ?secret=
    // fallback matches /api/jobs/* and makes manual curl runs possible.
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const provided = bearer || String(req.query.secret || '');
    const isCron = !!cronSecret && provided !== '' && timingSafeEqualStr(provided, cronSecret);
    // Optional admin JWT: this route sits before requireAuth so cron can pass.
    let isAdmin = req.user?.role === 'admin';
    if (!isAdmin && !isCron && authHeader.startsWith('Bearer ')) {
      try {
        isAdmin = (verifyToken(authHeader.slice(7)) as any)?.role === 'admin';
      } catch {
        isAdmin = false;
      }
    }
    if (!isAdmin && !isCron) {
      return res.status(401).json({ error: { message: 'Unauthorized' } });
    }
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const results = await retryFailedShiprocketPushes(limit);
    res.json({ data: results });
  } catch (error) {
    next(error);
  }
};

export const updateOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status, tracking_number } = req.body;
    const data = await orderService.updateOrderStatus(id as string, status, tracking_number);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const getMyOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: { message: 'Unauthorized' } });
    }
    // Unverified quick-login sessions may place orders but must not browse
    // order history (which embeds full shipping addresses + phone numbers).
    if (req.user?.phone_verified === false) {
      return res.status(403).json({
        error: { message: 'Please verify your mobile number to view your order history.' },
      });
    }
    const data = await orderService.getMyOrders(userId);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const updateOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = await orderService.updateOrder(id as string, req.body);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const deleteOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await orderService.deleteOrder(id as string);
    res.json({ message: 'Order deleted successfully' });
  } catch (error) {
    next(error);
  }
};
