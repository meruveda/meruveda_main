import { Request, Response } from 'express';
import { 
  shiprocketCourierService, 
  shiprocketWebhookService, 
  shiprocketPickupService, 
  shiprocketLabelService, 
  shiprocketTrackingService, 
  shiprocketOrderService 
} from '../services/shiprocket';
import { supabase } from '../database/supabase';
import { handleTransactionCancellation } from '../services/orderService';

export const shiprocketController = {
  /**
   * Check courier serviceability for a pincode
   */
  async checkServiceability(req: Request, res: Response) {
    try {
      const { delivery_postcode, weight, cod } = req.query;
      
      if (!delivery_postcode) {
        return res.status(400).json({ success: false, message: 'delivery_postcode is required' });
      }

      const response = await shiprocketCourierService.checkServiceability({
        pickup_postcode: process.env.SHIPROCKET_PICKUP_PINCODE || '342001', // fallback to Jodhpur zipcode from screenshot
        delivery_postcode: String(delivery_postcode),
        weight: Number(weight) || 0.5,
        cod: Number(cod) === 1 ? 1 : 0
      });

      return res.status(200).json({ success: true, data: response });
    } catch (error: any) {
      console.error('Serviceability check failed:', error);
      const status = error.status === 401 || error.status === 403 ? 502 : (error.status || 500);
      return res.status(status).json({ success: false, message: error.message });
    }
  },

  /**
   * Generate AWB for a shipment
   */
  async generateAwb(req: Request, res: Response) {
    try {
      const { shipmentId, courierId } = req.body;

      if (!shipmentId) {
        return res.status(400).json({ success: false, message: 'shipmentId is required' });
      }

      const response = await shiprocketCourierService.generateAwb(shipmentId, courierId);

      const awbCode = response?.response?.data?.awb_code;
      const courierName = response?.response?.data?.courier_name;

      if (awbCode) {
        // Update database
        const { error } = await supabase
          .from('orders')
          .update({
            awb_code: awbCode,
            courier_name: courierName || 'Shiprocket Courier',
            tracking_status: 'AWB ASSIGNED',
            last_tracking_update: new Date().toISOString()
          })
          .eq('shipment_id', String(shipmentId));

        if (error) {
          console.error('Error updating order AWB in DB:', error);
        }
      }

      return res.status(200).json({ success: true, data: response });
    } catch (error: any) {
      console.error('Generate AWB failed:', error);
      const status = error.status === 401 || error.status === 403 ? 502 : (error.status || 500);
      return res.status(status).json({ success: false, message: error.message });
    }
  },

  /**
   * Schedule pickup for a shipment
   */
  async schedulePickup(req: Request, res: Response) {
    try {
      const { shipmentId } = req.body;

      if (!shipmentId) {
        return res.status(400).json({ success: false, message: 'shipmentId is required' });
      }

      const response = await shiprocketPickupService.schedulePickup(shipmentId);

      // Update pickup status in DB
      const { error } = await supabase
        .from('orders')
        .update({
          pickup_status: 'SCHEDULED',
          tracking_status: 'PICKUP SCHEDULED',
          last_tracking_update: new Date().toISOString()
        })
        .eq('shipment_id', String(shipmentId));

      if (error) {
        console.error('Error updating order pickup status in DB:', error);
      }

      return res.status(200).json({ success: true, data: response });
    } catch (error: any) {
      console.error('Schedule pickup failed:', error);
      const status = error.status === 401 || error.status === 403 ? 502 : (error.status || 500);
      return res.status(status).json({ success: false, message: error.message });
    }
  },

  /**
   * Track AWB
   */
  async trackShipment(req: Request, res: Response) {
    try {
      const { awb } = req.params;

      if (!awb) {
        return res.status(400).json({ success: false, message: 'AWB is required' });
      }

      const response = await shiprocketTrackingService.trackAwb(String(awb));

      // Automatically sync tracking data to the database
      if (response && response.tracking_data && response.tracking_data.shipment_track && response.tracking_data.shipment_track.length > 0) {
        const track = response.tracking_data.shipment_track[0];
        const payload = {
          // IMPORTANT: Always use the AWB we *queried* (from req.params), NOT track.awb_code
          // from the Shiprocket response. Shiprocket sometimes returns null or a different AWB
          // in the payload, which would cause processWebhook to fall through to shipment_id and
          // potentially update the WRONG order.
          awb: awb,
          current_status: track.current_status,
          // Only set shipment_id if explicitly present — do NOT fall back to track.id
          // (track.id is the Shiprocket tracking record ID, not the shipment ID)
          shipment_id: track.shipment_id ? String(track.shipment_id) : null,
          sr_order_id: track.order_id ? String(track.order_id) : null,
          courier: track.courier_name,
          expected_delivery: track.etd,
          tracking_url: track.tracking_url,
          scans: (track.scans || []).map((scan: any) => ({
            date: scan.date,
            activity: scan.activity,
            location: scan.location,
            'sr-status-label': scan.status
          }))
        };
        await shiprocketWebhookService.processWebhook(payload);
      }

      return res.status(200).json({ success: true, data: response });
    } catch (error: any) {
      console.error('Tracking fetch failed:', error);
      const status = error.status === 401 || error.status === 403 ? 502 : (error.status || 500);
      return res.status(status).json({ success: false, message: error.message });
    }
  },

  /**
   * Download Label
   */
  async getLabel(req: Request, res: Response) {
    try {
      const { shipmentId } = req.params;

      if (!shipmentId) {
        return res.status(400).json({ success: false, message: 'shipmentId is required' });
      }

      const response = await shiprocketLabelService.generateLabel(String(shipmentId));
      return res.status(200).json({ success: true, data: response });
    } catch (error: any) {
      console.error('Label generation failed:', error);
      const status = error.status === 401 || error.status === 403 ? 502 : (error.status || 500);
      return res.status(status).json({ success: false, message: error.message });
    }
  },

  /**
   * Download Invoice
   */
  async getInvoice(req: Request, res: Response) {
    try {
      const { shipmentId } = req.params;
      const user = (req as any).user;

      if (!shipmentId) {
        return res.status(400).json({ success: false, message: 'shipmentId is required' });
      }

      // Fetch the order to get the correct Shiprocket Order ID
      const { data: order, error } = await supabase
        .from('orders')
        .select('shiprocket_order_id, user_id')
        .eq('shipment_id', shipmentId)
        .maybeSingle();

      if (error || !order || !order.shiprocket_order_id) {
        return res.status(404).json({ success: false, message: 'Matching Shiprocket order not found' });
      }

      // Authorize: user must be admin or the owner of the order
      if (user.role !== 'admin' && order.user_id !== user.id) {
        return res.status(403).json({ success: false, message: 'Unauthorized access to this invoice' });
      }

      const response = await shiprocketLabelService.generateInvoice([order.shiprocket_order_id]);
      return res.status(200).json({ success: true, data: response });
    } catch (error: any) {
      console.error('Invoice generation failed:', error);
      const status = error.status === 401 || error.status === 403 ? 502 : (error.status || 500);
      return res.status(status).json({ success: false, message: error.message });
    }
  },

  /**
   * Cancel Order
   */
  async cancelOrder(req: Request, res: Response) {
    try {
      const { orderId } = req.body;

      if (!orderId) {
        return res.status(400).json({ success: false, message: 'orderId is required' });
      }

      // Fetch the order details
      const { data: order, error: fetchErr } = await supabase
        .from('orders')
        .select('id, awb_code, status, shiprocket_order_id, user_id')
        .eq('id', orderId)
        .maybeSingle();

      if (fetchErr || !order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }

      // Ensure the requesting user owns the order (or is an admin)
      const user = req.user;
      if (order.user_id !== user?.id && user?.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Forbidden - You do not own this order' });
      }

      if (order.status === 'Delivered') {
        return res.status(400).json({ success: false, message: 'Cannot cancel an already delivered order' });
      }

      let shiprocketResponse = null;

      // Only call Shiprocket Cancel if we actually have an AWB code to cancel
      if (order.awb_code) {
        shiprocketResponse = await shiprocketOrderService.cancelOrder([order.awb_code]);
      } else if (order.shiprocket_order_id) {
        shiprocketResponse = await shiprocketOrderService.cancelOrderByIds([order.shiprocket_order_id]);
      } else {
        console.log(`[Cancel Order] Order ${orderId} has no assigned Shiprocket order yet. Cancelling locally only.`);
      }

      // Update Database status
      const { error: updateErr } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          tracking_status: 'CANCELED',
          last_tracking_update: new Date().toISOString()
        })
        .eq('id', order.id);

      if (updateErr) throw updateErr;

      // Update transaction status on cancel
      await handleTransactionCancellation(order.id, 'cancelled');

      // Add to tracking history
      await supabase.from('order_tracking_history').insert({
        order_id: order.id,
        tracking_status: 'CANCELED',
        activity: 'Order Cancelled',
        location: 'Platform',
        raw_payload: shiprocketResponse || { info: 'Cancelled locally before AWB assignment' }
      });

      return res.status(200).json({ 
        success: true, 
        message: 'Order cancelled successfully', 
        shiprocketResponse 
      });
    } catch (error: any) {
      console.error('Cancel order failed:', error);
      const status = error.status === 401 || error.status === 403 ? 502 : (error.status || 500);
      return res.status(status).json({ success: false, message: error.message });
    }
  },

  /**
   * Incoming Shiprocket webhook
   */
  async webhook(req: Request, res: Response) {
    try {
      const token = req.headers['x-api-key'];
      const webhookToken = process.env.SHIPROCKET_WEBHOOK_TOKEN;
      
      if (!webhookToken || token !== webhookToken) {
        return res.status(401).json({ success: false, message: 'Unauthorized webhook' });
      }

      // processWebhook runs asynchronously or safely catches its own errors
      await shiprocketWebhookService.processWebhook(req.body);
      
      return res.status(200).json({ success: true });
    } catch (error: any) {
      console.error('Webhook processing failed:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }
};

if (!process.env.SHIPROCKET_WEBHOOK_TOKEN) {
  console.warn('\n[Warning] SHIPROCKET_WEBHOOK_TOKEN is not set. All incoming Shiprocket webhooks will be rejected with 401 Unauthorized until configured.\n');
}


