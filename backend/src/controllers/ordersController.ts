import { Request, Response, NextFunction } from 'express';
import { orderService, pushOrderToShiprocket, retryFailedShiprocketPushes } from '../services/orderService';
import { postOrderConfirmed, isCodOrder, sendOrderConfirmationText } from '../services/postOrderConfirmed';
import { invoiceDispatchService, deriveInvoiceStatus } from '../services/invoiceDispatchService';
import { supabase } from '../database/supabase';
import { hasColumn } from '../services/schemaGuard';
import { normalizePhone } from '../services/whatsappService';
import { verifyToken } from '../utils/jwt';
import { keepAlive } from '../utils/keepAlive';
import { config, invoiceWhatsapp } from '../config/env';
import { timingSafeEqualStr } from '../utils/timingSafe';
import { shiprocketTrackingService } from '../services/shiprocket/tracking.service';
import { shiprocketWebhookService } from '../services/shiprocket/webhook.service';
import { downloadInvoicePdf, readInvoiceState } from '../services/invoiceStore';

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

    // Every order is invoiced the moment it is created — COD and prepaid alike,
    // paid or not. A tax invoice documents the sale, and the sale happens when
    // the order is placed; waiting for a payment callback used to leave prepaid
    // checkouts with no invoice at all if the customer abandoned the PayU page.
    //
    // The PayU success callback therefore does NOT issue an invoice; it only
    // records payment. It cannot double-issue, because the claim below is
    // atomic and the callback would find it already taken.
    const { data: placedOrder } = await supabase
      .from('orders')
      .select('*')
      .eq('id', data.id)
      .maybeSingle();
    if (isCodOrder(data)) {
      // Confirmation text is a courtesy; the invoice is the dispatcher's job.
      keepAlive(sendOrderConfirmationText(placedOrder));
    }
    // keepAlive, not a bare .catch(): on Vercel an un-awaited promise is torn
    // down when the response flushes, which killed invoice dispatch mid-render
    // with nothing recorded. waitUntil() extends the invocation instead.
    keepAlive(postOrderConfirmed(data.id, { source: 'order_placement' }));

    // Opportunistic delivery sweep. When the WhatsApp slot was empty at issue
    // time (Meta is not active yet) those invoices are simply waiting; once the
    // slot is filled in, the next order placed picks them up. This runs inside
    // waitUntil so it never touches the response, and it no-ops immediately when
    // the slot is still empty — so the daily cron can stay fail-closed.
    keepAlive(
      invoiceDispatchService
        .retryPendingInvoices(5)
        .catch((err: any) => console.error('[Invoice] backfill sweep failed:', err?.message || err))
    );

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
 * Read the delivery-tracking columns that may not exist yet.
 *
/**
 * Serve the invoice PDF for one order.
 *
 * ONE invoice, ONE template: this is the same file that was sent over WhatsApp
 * and email, and the same one the admin sees. There is no separate rendering
 * path for the customer or the admin.
 *
 * Order of precedence:
 *   1. the stored PDF named in `state.json` — an issued invoice is a legal
 *      document and must NEVER be re-rendered; regenerating after an amount
 *      change would silently produce a different document under the same number.
 *   2. no state.json yet -> run the same automatic claim path that fires at
 *      order creation, then serve what it stored.
 *
 * There is no payment gate. An invoice is issued at order creation for every
 * order, COD and prepaid, paid or not, so every order has a downloadable
 * invoice from the moment it is placed.
 */
export const downloadInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const { data: orderRow, error: queryError } = await supabase
      .from('orders')
      .select('id, user_id, order_number')
      .eq('id', id)
      .maybeSingle();

    if (queryError) {
      // A schema/behaviour failure is NOT a missing order.
      console.error(`[Invoice] order lookup failed for ${id}:`, queryError.message);
      return res.status(503).json({
        error: {
          message: `Could not read this order (${queryError.code || 'database error'}).`,
        },
      });
    }
    // 404 now means exactly one thing: there is genuinely no such order.
    if (!orderRow) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    // The order's own customer, or any admin. Nothing else can read it.
    if (req.user?.role !== 'admin' && orderRow.user_id !== req.user?.id) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }

    const send = (bytes: Buffer, invoiceNumber?: string | null) => {
      // The filename carries the invoice number the customer can quote, falling
      // back to the order number before one has been allocated.
      const label = String(invoiceNumber || orderRow.order_number || id).replace(/[^A-Za-z0-9._-]+/g, '_');
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Invoice-${label}.pdf"`,
        // Invoices contain PII — never let a shared proxy cache them.
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': String(bytes.length),
      });
      return res.send(bytes);
    };

    /* ---- 1. the stored file, when one exists ---- */
    const state = await readInvoiceState(orderRow.id);
    if (state?.pdfPath) {
      const stored = await downloadInvoicePdf(state.pdfPath);
      if (stored) return send(stored, state.invoiceNumber);

      // Already-issued invoices must not be re-rendered; say why instead.
      console.error(
        `[Invoice] stored PDF for ${state.invoiceNumber} is no longer readable — NOT regenerating.`
      );
      return res.status(410).json({
        error: {
          message:
            'This invoice was already issued and its stored file is no longer available. Contact support for a copy.',
        },
      });
    }

    /* ---- 2. not issued yet: generate synchronously, then serve ---- */
    // Generation happens INSIDE this request, not fire-and-forget. On Vercel an
    // un-awaited background promise is torn down when the response flushes, so
    // "kick it off and hope" left orders with a claim and no invoice. Now the
    // first click either returns the PDF or returns the real reason.
    let dispatch;
    try {
      dispatch = await invoiceDispatchService.sendInvoiceAuto(orderRow.id);
    } catch (err: any) {
      const reason = err?.reason || err?.message || 'The invoice could not be generated.';
      console.error(`[invoice] step=dispatch order=${orderRow.id} reason=${reason}`, err?.stack || err);
      return res.status(500).json({ error: { message: reason } });
    }

    // Another worker is rendering this exact invoice right now. That is a retry,
    // not a failure, so it must not surface as an error toast.
    if (dispatch.busy) {
      res.set('Retry-After', String(dispatch.retryAfterSeconds ?? 3));
      return res.status(202).json({
        error: {
          message: `Your invoice is being prepared. Please try again in ${dispatch.retryAfterSeconds ?? 3} seconds.`,
          retryable: true,
        },
      });
    }

    const freshState = await readInvoiceState(orderRow.id);
    if (freshState?.pdfPath) {
      const stored = await downloadInvoicePdf(freshState.pdfPath);
      if (stored) return send(stored, freshState.invoiceNumber);
    }

    // A real, specific reason — "Font file missing", "Storage upload failed" —
    // rather than a generic message the customer can do nothing about.
    if (dispatch.reason) {
      console.error(
        `[invoice] step=${dispatch.step || 'unknown'} order=${orderRow.id} reason=${dispatch.reason}`
      );
      return res.status(500).json({ error: { message: dispatch.reason } });
    }

    return res.status(500).json({
      error: { message: 'The invoice could not be generated. Please try again.' },
    });
  } catch (error: any) {
    if (error.status === 404) {
      return res.status(404).json({ error: { message: error.message } });
    }
    next(error);
  }
};

/**
 * Read-only invoice status for the admin Orders UI.
 *
 * Deliberately does NOT send anything. Invoice delivery is fully automatic (it
 * fires at order creation for every order) with a sweep retrying up to
 * MAX_INVOICE_ATTEMPTS times; a manual "resend" endpoint is a second way to
 * deliver the same tax document and therefore a second way to double-send it.
 *
 * A missing `state.json` is "Pending", not an error: the order was placed and
 * the invoice has not been issued yet.
 */
export const invoiceStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const { data: orderRow, error: lookupError } = await supabase
      .from('orders')
      .select('id, user_id, order_number')
      .eq('id', id)
      .maybeSingle();

    if (lookupError) {
      console.error(`[Invoice] status lookup failed for ${id}:`, lookupError.message);
      return res.status(503).json({
        error: {
          message: `Could not read this order (${lookupError.code || 'database error'}).`,
        },
      });
    }
    if (!orderRow) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    if (req.user?.role !== 'admin' && orderRow.user_id !== req.user?.id) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }

    const state = await readInvoiceState(orderRow.id);
    const status = deriveInvoiceStatus(state);
    const whatsapp = state?.channels?.whatsapp;

    res.json({
      data: {
        orderNumber: orderRow.order_number,
        invoiceNumber: state?.invoiceNumber || null,
        issuedAt: state?.issuedAt || null,
        // Object path, not a URL. The admin renders it as plain text and the
        // download endpoint resolves it.
        invoiceUrl: state?.pdfPath || null,
        status: status.status,
        sentAt: status.sentAt,
        error: status.error,
        attempts: status.attempts,
        maxAttempts: invoiceDispatchService.MAX_INVOICE_ATTEMPTS,
        // "Not configured" is a first-class state: the Meta slot is empty, so
        // the invoice was issued but WhatsApp was skipped quietly.
        whatsapp: whatsapp?.status ?? (invoiceWhatsapp.configured ? 'pending' : 'not_configured'),
        whatsappError: whatsapp?.lastError || null,
        adminCopy: state?.channels?.whatsapp?.status === 'sent' ? 'sent' : null,
      },
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
