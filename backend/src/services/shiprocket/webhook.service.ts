import { supabase } from '../../database/supabase';
import { orderNotifyService } from '../orderNotifyService';
import { hasColumn } from '../schemaGuard';

export const shiprocketWebhookService = {
  /**
   * Handle incoming webhook from Shiprocket
   */
  async processWebhook(payload: any) {
    try {
      // 1. Validate payload
      const awb = payload.awb || payload.awb_code;
      const currentStatus = payload.current_status || payload.status;
      const shipmentId = payload.shipment_id ? String(payload.shipment_id) : null;
      const srOrderId = payload.sr_order_id ? String(payload.sr_order_id) : null;

      if (!awb && !shipmentId && !srOrderId) {
        console.warn('[Webhook] Invalid payload: Missing tracking identifiers (awb, shipment_id, sr_order_id)');
        return { success: false, error: 'Missing tracking identifiers' };
      }

      // 2. Fetch the corresponding order
      let query = supabase.from('orders').select('*');
      if (awb) {
        query = query.eq('awb_code', awb);
      } else if (shipmentId) {
        query = query.eq('shipment_id', shipmentId);
      } else {
        query = query.eq('shiprocket_order_id', srOrderId);
      }

      const { data: order, error: fetchError } = await query.maybeSingle();

      if (fetchError) {
        console.error('[Webhook] Error fetching order:', fetchError);
        throw fetchError;
      }

      if (!order) {
        console.warn(`[Webhook] No matching order found for AWB: ${awb}, Shipment ID: ${shipmentId}, SR Order ID: ${srOrderId}`);
        return { success: false, error: 'Order not found' };
      }

      // Guard: if we looked up by AWB, verify the stored awb_code matches (or is unset).
      // This prevents updating the wrong order when Shiprocket returns data for a different shipment.
      if (awb && order.awb_code && order.awb_code !== awb) {
        console.error(`[Webhook] AWB MISMATCH — queried AWB ${awb} but found order ${order.order_number} (${order.id}) with awb_code=${order.awb_code}. Aborting update to prevent cross-order contamination.`);
        return { success: false, error: 'AWB mismatch — wrong order resolved' };
      }

      // 3. Extract webhook metadata
      const courierName = payload.courier || payload.courier_name || order.courier_name;
      const etd = payload.etd || payload.expected_delivery || payload.estimated_delivery;
      
      // Determine the timestamp of the event (or use current time if not provided)
      let eventTimestampStr = new Date().toISOString();
      let eventTimestamp = Date.now();
      
      if (payload.current_timestamp && typeof payload.current_timestamp === 'string') {
        // Parse "DD MM YYYY HH:mm:ss"
        const parts = payload.current_timestamp.split(' ');
        if (parts.length === 4) {
          const [d, m, y, time] = parts;
          const parsed = new Date(`${y}-${m}-${d}T${time}+05:30`);
          if (!isNaN(parsed.getTime())) {
            eventTimestampStr = parsed.toISOString();
            eventTimestamp = parsed.getTime();
          }
        }
      }

      // 4. Map Shiprocket statuses to internal statuses
      const statusMapping: Record<string, string> = {
        'NEW': 'pending',
        'INVOICED': 'processing',
        'PICKUP SCHEDULED': 'processing',
        'AWB ASSIGNED': 'processing',
        'PICKED UP': 'shipped',
        'IN TRANSIT': 'shipped',
        'OUT FOR DELIVERY': 'shipped',
        'DELIVERED': 'delivered',
        'FAILED': 'processing',
        'UNDELIVERED': 'processing',
        'RTO INITIATED': 'processing',
        'RTO DELIVERED': 'processing',
        'CANCELED': 'cancelled',
        'CANCELLED': 'cancelled'
      };

      const normalizedStatus = String(currentStatus).toUpperCase();
      const internalStatus = statusMapping[normalizedStatus] || order.status;

      // 5. Handle duplicate events and insert tracking history using the scans array
      const scans = Array.isArray(payload.scans) ? payload.scans : [];
      if (scans.length > 0) {
        for (const scan of scans) {
          const scanDate = scan.date; // e.g. "2023-05-19 11:59:16"
          const scanActivity = scan.activity;
          const scanLocation = scan.location;
          const scanStatus = scan['sr-status-label'];

          // Deduplicate using date + activity
          const { data: existingHistory } = await supabase
            .from('order_tracking_history')
            .select('id')
            .eq('order_id', order.id)
            .eq('activity', scanActivity)
            .eq('created_at', scanDate)
            .maybeSingle();

          if (!existingHistory) {
            await supabase.from('order_tracking_history').insert({
              order_id: order.id,
              tracking_status: scanStatus || currentStatus,
              location: scanLocation,
              activity: scanActivity,
              raw_payload: scan,
              created_at: scanDate
            });
          }
        }
      }

      // 6. Ensure older webhook events do not overwrite a newer shipment status
      const lastSyncTime = order.last_tracking_update ? new Date(order.last_tracking_update).getTime() : 0;
      if (eventTimestamp >= lastSyncTime) {
        const updateData: any = {
          tracking_status: currentStatus,
          shipment_status: currentStatus,
          status: internalStatus,
          last_tracking_update: eventTimestampStr
        };

        if (awb) updateData.awb_code = awb;
        if (courierName) updateData.courier_name = courierName;
        if (etd) updateData.estimated_delivery = etd;
        if (payload.tracking_url) updateData.tracking_url = payload.tracking_url;
        if (normalizedStatus === 'DELIVERED') {
          // `orders.delivered_at` arrives in delta 006 — only write it when the
          // column exists, otherwise the whole status update would be rejected.
          if (await hasColumn('orders', 'delivered_at')) {
            updateData.delivered_at = eventTimestampStr;
          }
          
          // Auto-confirm COD payment
          const isCOD = order.payment_method === 'Cash On Delivery' || String(order.payment_method).toUpperCase() === 'COD';
          if (isCOD) {
            // Check if it's already paid to avoid double updates
            if (order.payment_status !== 'paid') {
              updateData.payment_status = 'paid';
              
              // Log/Store the timestamp of auto-confirmation in notes
              const confirmMsg = `[COD Auto-Confirmed Paid at ${eventTimestampStr}]`;
              updateData.notes = order.notes ? `${order.notes} ${confirmMsg}`.trim() : confirmMsg;
              
              console.log(`[Shiprocket Webhook] COD Order ${order.id} (${order.order_number}) automatically marked as PAID on delivery.`);
              
              // Record payment transaction and tracking history entry
              try {
                const { data: existingTx } = await supabase
                  .from('transactions')
                  .select('id')
                  .eq('order_id', order.id)
                  .maybeSingle();

                const txData = {
                  user_id: order.user_id,
                  order_id: order.id,
                  amount: order.total,
                  currency: 'INR',
                  status: 'success',
                  payment_method: order.payment_method,
                  gateway_transaction_id: `COD-DELIVERY-${order.order_number}`,
                  metadata: {
                    detailed_status: 'collected',
                    auto_confirmed: true,
                    confirmed_at: eventTimestampStr,
                    source: 'shiprocket_delivered_webhook'
                  }
                };

                if (existingTx) {
                  await supabase
                    .from('transactions')
                    .update(txData)
                    .eq('id', existingTx.id);
                } else {
                  await supabase
                    .from('transactions')
                    .insert(txData);
                }
                
                await supabase.from('order_tracking_history').insert({
                  order_id: order.id,
                  tracking_status: 'paid',
                  activity: 'COD Payment Auto-Confirmed',
                  location: 'Shiprocket Webhook',
                  raw_payload: { eventTimestampStr, currentStatus },
                  created_at: eventTimestampStr
                });
              } catch (txErr) {
                console.error('[Webhook] Failed to insert COD transaction or tracking record:', txErr);
              }
            }
          }
        }

        const { error: updateError } = await supabase
          .from('orders')
          .update(updateData)
          .eq('id', order.id);

        if (updateError) {
          console.error('[Webhook] Failed to update order status:', updateError);
          throw updateError;
        }

        // 6b. Push a WhatsApp update to the customer (shipped / out for
        // delivery / delivered / cancelled). Deduplicated per order+status and
        // never allowed to break webhook processing.
        try {
          const notifyKey =
            normalizedStatus === 'OUT FOR DELIVERY'
              ? 'out-for-delivery'
              : ['PICKED UP', 'IN TRANSIT'].includes(normalizedStatus)
              ? 'shipped'
              : normalizedStatus === 'DELIVERED'
              ? 'delivered'
              : ['CANCELED', 'CANCELLED'].includes(normalizedStatus)
              ? 'cancelled'
              : null;

          if (notifyKey && notifyKey !== String(order.status || '').toLowerCase()) {
            await orderNotifyService.sendStatusUpdate(order.id, notifyKey);
          }
        } catch (notifyErr: any) {
          console.error('[Webhook] WhatsApp status update failed:', notifyErr?.message || notifyErr);
        }
      } else {
        console.log(`[Webhook] Ignored out-of-order event. Event time: ${eventTimestampStr}, Last sync time: ${order.last_tracking_update}`);
      }

      return { success: true };
    } catch (error: any) {
      console.error('[Webhook] Webhook processing crashed:', error);
      // Return success: false, but don't bubble up to let the controller respond quickly
      return { success: false, error: error.message };
    }
  }
};

