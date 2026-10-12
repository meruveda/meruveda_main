import { Request, Response, NextFunction } from 'express';
import { orderService, pushOrderToShiprocket, retryFailedShiprocketPushes } from '../services/orderService';
import { orderNotifyService } from '../services/orderNotifyService';
import { supabase } from '../database/supabase';
import { normalizePhone } from '../services/whatsappService';
import { hasColumn } from '../services/schemaGuard';
import { verifyToken } from '../utils/jwt';
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
    // Cash on Delivery has no payment callback, so the post-purchase WhatsApp
    // automation (confirmation + PDF invoice to customer & admin) runs here.
    try {
      await orderNotifyService.sendPostPurchaseMessages(data.id);
    } catch (notifyErr: any) {
      console.error('[Orders] Post-purchase WhatsApp messages failed:', notifyErr?.message || notifyErr);
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

/** Download the fixed GST tax invoice PDF (same template used for WhatsApp). */
export const downloadInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
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
    const order = await getOrderForInvoice(id as string);
    const pdf = await generateInvoicePdf(order);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice-${order.order_number}.pdf"`);
    res.send(pdf);
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

    const result = await orderNotifyService.resendInvoice(id as string);
    res.json({ data: result, message: 'Invoice resent over WhatsApp.' });
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
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = String(req.headers.authorization || '');
    const isCron = !!cronSecret && authHeader === `Bearer ${cronSecret}`;
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
      return res.status(403).json({ error: { message: 'Forbidden' } });
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
