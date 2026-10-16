import { Request, Response, NextFunction } from 'express';
import { orderService, pushOrderToShiprocket, retryFailedShiprocketPushes } from '../services/orderService';
import { postOrderConfirmed, isCodOrder, sendOrderConfirmationText } from '../services/postOrderConfirmed';
import { invoiceDispatchService, deriveInvoiceStatus } from '../services/invoiceDispatchService';
import { getLogEntry } from '../services/whatsappService';
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
 * Read the delivery-tracking columns that may not exist yet.
 *
 * A deployment can be running this code before the migration has been applied,
 * and every one of these is optional for rendering the status card. The column
 * list is built dynamically so a missing column degrades to `undefined` instead
 * of failing the whole query with 42703.
 */
async function optionalInvoiceTracking(orderId: string): Promise<Record<string, unknown>> {
  const optional = [
    'invoice_attempts',
    'invoice_whatsapp_status',
    'invoice_email_status',
  ];
  const present: string[] = [];
  for (const column of optional) {
    if (await hasColumn('orders', column)) present.push(column);
  }
  if (present.length === 0) return {};

  const { data } = await supabase.from('orders').select(present.join(', ')).eq('id', orderId).maybeSingle();
  return (data as unknown as Record<string, unknown>) || {};
}

/**
 * Serve the invoice PDF for one order.
 *
 * ONE invoice, ONE template: this is the same file that was sent over WhatsApp
 * and email, and the same one the admin sees. There is no separate rendering
 * path for the customer or the admin.
 *
 * Order of precedence:
 *   1. stored PDF — an issued invoice is a legal document and must NEVER be
 *      re-rendered; regenerating after an amount change would silently produce a
 *      different document under the same number.
 *   2. no PDF yet and the order is billable -> generate ONCE through the same
 *      claim path the automatic trigger uses, store it, then serve it.
 *   3. no PDF and the order is not billable (unpaid prepaid) -> 409, so the
 *      customer sees "awaiting payment" instead of an invoice for goods that
 *      have not been paid for.
 */
export const downloadInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Probe the optional invoice columns first so a missing migration produces
    // an actionable 503 instead of a 404 that reads as "order not found".
    const hasInvoiceNumber = await hasColumn('orders', 'invoice_number');
    if (!hasInvoiceNumber) {
      console.error(
        '[Invoice] orders.invoice_number does not exist — apply ' +
          'backend/sql/migrations/2026-10-15_invoice_automation.sql'
      );
      return res.status(503).json({
        error: {
          message:
            'Invoice storage is not configured on this server: the database migration ' +
            '2026-10-15_invoice_automation.sql has not been applied. No invoice can be served yet.',
        },
      });
    }

    const { data: orderRow, error: queryError } = await supabase
      .from('orders')
      .select('id, user_id, order_number, payment_method, payment_status, invoice_url, invoice_number')
      .eq('id', id)
      .maybeSingle();

    if (queryError) {
      // Schema/behaviour failure, NOT a missing order.
      console.error(`[Invoice] order lookup failed for ${id}:`, queryError.message);
      return res.status(503).json({
        error: {
          message: `Could not read this order (${queryError.code || 'database error'}). The order may exist; the database schema is incomplete.`,
        },
      });
    }
    if (!orderRow) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    // The order's own customer, or any admin. Nothing else can read it.
    if (req.user?.role !== 'admin' && orderRow.user_id !== req.user?.id) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }

    const send = (bytes: Buffer) => {
      // Filename carries the order number, which is what the customer knows.
      // Slash-free by construction (MV-748371), but sanitise defensively.
      const safe = String(orderRow.order_number || id).replace(/[^A-Za-z0-9._-]+/g, '_');
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Invoice-${safe}.pdf"`,
        // Invoices contain PII — never let a shared proxy cache them.
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': String(bytes.length),
      });
      return res.send(bytes);
    };

    /* ---- 1. the stored file, when one exists ---- */
    if (orderRow.invoice_url && config.invoiceStorageBucket) {
      const { data, error } = await supabase.storage
        .from(config.invoiceStorageBucket)
        .download(orderRow.invoice_url);
      if (!error && data) {
        // Must set the PDF headers here too: without them Express sends a
        // Buffer as application/octet-stream with no filename, so an
        // anchor-based download loses the Content-Disposition.
        return send(Buffer.from(await data.arrayBuffer()));
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
              'This invoice was already issued and its stored file is no longer available. Contact support for a copy.',
          },
        });
      }
    }

    /* ---- 2. not issued yet: is this order billable at all? ---- */
    // COD is billable from the moment the order is placed — the invoice states
    // the amount due on delivery. Prepaid is billable only once PayU has
    // verified payment, which postOrderConfirmed enforces on the callback.
    const isCod = /cash|\bcod\b/i.test(String(orderRow.payment_method || ''));
    if (!isCod && String(orderRow.payment_status || '') !== 'paid') {
      return res.status(409).json({
        error: {
          message: 'The invoice will be available after payment is verified.',
        },
      });
    }

    /* ---- 3. generate ONCE through the same claim path, then serve ---- */
    // sendInvoiceAuto is atomic: whoever claims the order generates the PDF.
    // If the automatic trigger or the cron already claimed it, this call is a
    // no-op and we simply serve whatever was stored. That is what keeps a
    // customer clicking "Download" from ever producing a second invoice.
    const dispatch = await invoiceDispatchService.sendInvoiceAuto(orderRow.id);
    if (dispatch.reason && !dispatch.invoiceUrl) {
      console.error(`[Invoice] on-demand generation failed for ${orderRow.order_number}: ${dispatch.reason}`);
      return res.status(503).json({
        error: {
          message: `The invoice could not be generated yet: ${dispatch.reason}`,
        },
      });
    }

    if (dispatch.invoiceUrl && config.invoiceStorageBucket) {
      const { data, error } = await supabase.storage
        .from(config.invoiceStorageBucket)
        .download(dispatch.invoiceUrl);
      if (!error && data) {
        return send(Buffer.from(await data.arrayBuffer()));
      }
      console.warn(`[Invoice] freshly generated PDF not readable from storage: ${error?.message}`);
    }

    // Last resort, and only for an order with no number issued yet: render it
    // now without persisting. Never reached once the migration is applied,
    // because step 3 always claims and stores first.
    if (dispatch.invoiceNumber && dispatch.skipped) {
      const order = await getOrderForInvoice(id as string);
      return send(await generateInvoicePdf(order));
    }

    return res.status(503).json({
      error: {
        message: 'The invoice is being generated. Try again in a moment.',
      },
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
 * Deliberately does NOT send anything. Invoice delivery is fully automatic
 * (COD at placement, PayU on verified callback) with a cron sweep retrying up
 * to MAX_INVOICE_ATTEMPTS times; a manual "resend" endpoint is a second way to
 * deliver the same tax document and therefore a second way to double-send it.
 */
export const invoiceStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const { data: orderRow, error: lookupError } = await supabase
      .from('orders')
      .select('id, user_id, order_number, invoice_number, invoice_url, invoice_sent_at, invoice_error')
      .eq('id', id)
      .maybeSingle();

    if (lookupError) {
      console.error(`[Invoice] status lookup failed for ${id}:`, lookupError.message);
      return res.status(503).json({
        error: {
          message: `Could not read this order (${lookupError.code || 'database error'}). The database schema is incomplete.`,
        },
      });
    }
    if (!orderRow) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    if (req.user?.role !== 'admin' && orderRow.user_id !== req.user?.id) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }

    // The channel log is the source of truth for per-recipient delivery.
    const whatsapp = await getLogEntry('invoice_customer', `invoice_customer:${id}`);
    const adminCopy = await getLogEntry('invoice_admin', `invoice_admin:${id}`);

    const extra = await optionalInvoiceTracking(id as string);
    const status = deriveInvoiceStatus({
      invoice_sent_at: orderRow.invoice_sent_at,
      invoice_error: orderRow.invoice_error,
      ...extra,
    });

    res.json({
      data: {
        orderNumber: orderRow.order_number,
        invoiceNumber: orderRow.invoice_number,
        // Object path, not a URL. The admin renders it as plain text and the
        // download endpoint resolves it.
        invoiceUrl: orderRow.invoice_url,
        status: status.status,
        sentAt: status.sentAt,
        error: status.error,
        attempts: status.attempts,
        maxAttempts: invoiceDispatchService.MAX_INVOICE_ATTEMPTS,
        whatsapp: whatsapp?.status || null,
        whatsappError: whatsapp?.error || null,
        adminCopy: adminCopy?.status || null,
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
