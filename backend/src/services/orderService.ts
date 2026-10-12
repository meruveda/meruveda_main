import { supabase } from '../database/supabase';
import { shiprocketOrderService } from './shiprocket/order.service';
import { shiprocketTrackingService } from './shiprocket/tracking.service';
import { shiprocketWebhookService } from './shiprocket/webhook.service';
import { orderNotifyService } from './orderNotifyService';
import { ShiprocketOrderPayload } from './shiprocket/types';
import { config } from '../config/env';

export function isRajasthan(state: string): boolean {
  if (!state) return false;
  const s = state.trim().toLowerCase();
  const validMatches = ['rajasthan', 'rj', 'rajsthan', 'rajasthn', 'rajastan', 'rajasthna', 'rajastran', 'raj'];
  if (validMatches.includes(s)) return true;
  return s.startsWith('raj') && s.length >= 5;
}

export const orderService = {
  async getOrders(params: any) {
    const { status, page = 1, limit = 10, sortBy = 'created_at', sortOrder = 'desc', includeItems, search, paymentMethod, startDate, endDate } = params;

    const selectQuery = includeItems === 'true' 
      ? '*, users(email), order_items(*, products(*))' 
      : '*, users(email)';
    let query = supabase.from('orders').select(selectQuery, { count: 'exact' });

    if (status) query = query.eq('status', status);

    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);

    if (paymentMethod) {
      if (paymentMethod === 'cod') {
        query = query.ilike('payment_method', '%cash%');
      } else if (paymentMethod === 'upi') {
        query = query.ilike('payment_method', '%upi%');
      } else if (paymentMethod === 'card') {
        query = query.ilike('payment_method', '%card%');
      } else {
        query = query.ilike('payment_method', `%${paymentMethod}%`);
      }
    }

    if (search) {
      query = query.or(`order_number.ilike.%${search}%,shipping_address->>fullName.ilike.%${search}%`);
    }

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    query = query
      .order(sortBy as string, { ascending: sortOrder === 'asc' })
      .range(from, to);

    const { data, count, error } = await query;

    if (error) throw error;

    return {
      data,
      total: count,
      page: pageNum,
      limit: limitNum,
      totalPages: count ? Math.ceil(count / limitNum) : 0
    };
  },

  async getOrderById(id: string) {
    const { data, error } = await supabase
      .from('orders')
      .select('*, users(email), order_items(*, products(*)), order_tracking_history(*)')
      .eq('id', id)
      .single();

    if (error || !data) {
      const err = new Error('Order not found');
      (err as any).status = 404;
      throw err;
    }

    return data;
  },

  async createOrder(payload: any, userId?: string) {
    const orderData = { ...payload };
    orderData.user_id = userId;
    orderData.order_number = `MV-${Math.floor(100000 + Math.random() * 900000)}`;
    orderData.status = 'pending';
    
    // Extract items to insert separately
    const items = orderData.items;
    delete orderData.items;

    // Fetch products to compute GST and get details
    let dbProducts: any[] = [];
    if (items && items.length > 0) {
      const productIds = items.map((item: any) => item.product_id).filter(Boolean);
      if (productIds.length > 0) {
        const { data } = await supabase
          .from('products')
          .select('id, name, sku, images, seo_metadata')
          .in('id', productIds);
        dbProducts = data || [];
      }
    }

    // Recalculate subtotal and shipping cost server-side
    const subtotal = Number(orderData.subtotal) || 0;
    const discount = Number(orderData.discount) || 0;
    let shippingFee = subtotal >= 1000 ? 0 : 50;
    
    if (orderData.payment_method === 'Cash On Delivery') {
      shippingFee += 50;
    }
    
    orderData.shipping_fee = shippingFee;
    if (orderData.shipping_cost !== undefined) delete orderData.shipping_cost;
    
    // Recalculate GST/Tax dynamically per item based on products' GST rates
    let gstAmount = 0;
    if (items && items.length > 0) {
      items.forEach((item: any) => {
        const dbProduct = dbProducts.find((p: any) => p.id === item.product_id);
        const itemPrice = Number(item.price) || 0;
        const itemQty = Number(item.quantity) || 1;
        const itemTotal = itemPrice * itemQty;
        
        const itemGstPercent = dbProduct?.seo_metadata?.gst_rate !== undefined 
          ? Number(dbProduct.seo_metadata.gst_rate)
          : (dbProduct?.seo_metadata?.gstRate !== undefined
             ? Number(dbProduct.seo_metadata.gstRate)
             : (dbProduct?.seo_metadata?.gst !== undefined 
                ? Number(dbProduct.seo_metadata.gst) 
                : (dbProduct?.seoMetadata?.gst !== undefined ? Number(dbProduct.seoMetadata.gst) : 5)));
        const itemGstRate = itemGstPercent / 100;
        
        const itemDiscount = subtotal > 0 ? (discount * itemTotal) / subtotal : 0;
        const itemTaxable = itemTotal - itemDiscount;
        const itemGst = (itemTaxable * itemGstRate) / (1 + itemGstRate);
        gstAmount += itemGst;
      });
    }

    // Apply GST on shipping charges if shippingIsTaxable config flag is true
    if (config.shippingIsTaxable && shippingFee > 0) {
      const shippingGstPercent = 18;
      const shippingGstRate = shippingGstPercent / 100;
      const shippingGst = (shippingFee * shippingGstRate) / (1 + shippingGstRate);
      gstAmount += shippingGst;
    }

    orderData.tax = Number(gstAmount.toFixed(2));
    
    // Recalculate total
    orderData.total = Number((subtotal - discount + shippingFee).toFixed(2));
    
    // Ensure billing_address is set, fallback to shipping_address to satisfy NOT NULL constraint
    if (!orderData.billing_address) {
      orderData.billing_address = orderData.shipping_address;
    }
    const billingAddress = orderData.billing_address;

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert(orderData)
      .select()
      .single();

    if (orderError) {
      console.error('Supabase Insert Error:', orderError);
      throw orderError;
    }

    // Insert order items
    if (items && items.length > 0) {

      const orderItems = items.map((item: any) => {
        const dbProduct = dbProducts.find((p: any) => p.id === item.product_id);
        const productName = item.name || item.product_name || dbProduct?.name || "Unknown Product";
        
        let sku = item.sku || dbProduct?.sku || "";
        if (!sku || sku === "") {
          sku = item.product_id ? `SKU-${item.product_id.substring(0, 8).toUpperCase()}` : "";
        }

        const imageUrl = item.image || item.image_url || (dbProduct?.images && dbProduct.images.length > 0 ? (typeof dbProduct.images[0] === 'string' ? dbProduct.images[0] : dbProduct.images[0]?.url) : null);

        return {
          order_id: order.id,
          product_id: item.product_id,
          quantity: item.quantity,
          price: item.price,
          total: item.quantity * item.price,
          product_name: productName,
          sku: sku,
          image_url: imageUrl
        };
      });

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItems);

      if (itemsError) throw itemsError;
      
      // Reduce stock (Production feature)
      for (const item of items) {
        // Fetch current stock
        const { data: prod } = await supabase.from('products').select('stock').eq('id', item.product_id).single();
        if (prod) {
          const newStock = Math.max(0, prod.stock - item.quantity);
          await supabase.from('products').update({ stock: newStock }).eq('id', item.product_id);
        }
      }
    }

    // Log transaction (only for Cash On Delivery on placement. PayU writes its own logs on callback).
    if (order.payment_method === 'Cash On Delivery' || String(order.payment_method).toUpperCase() === 'COD') {
      const txData = {
        user_id: order.user_id,
        order_id: order.id,
        amount: order.total,
        currency: 'INR',
        status: 'pending',
        payment_method: order.payment_method,
        gateway_transaction_id: null,
        metadata: {
          detailed_status: 'pending',
          updated_at: new Date().toISOString()
        }
      };
      await supabase.from('transactions').insert(txData);
    }

    // ============================================
    // Shiprocket Integration
    // ============================================
    // Auto-push: COD orders push immediately on placement. Prepaid (PayU)
    // orders push from the PayU success callback after payment is confirmed.
    // SHIPROCKET_TEST_MODE=true preserves the old behaviour (push on create
    // for testing) without gating production pushes.
    const isCODPlacement =
      order.payment_method === 'Cash On Delivery' || String(order.payment_method).toUpperCase() === 'COD';
    if (config.shiprocketTestMode || isCODPlacement) {
      // Temporarily mark order as processing for testing (PAID)
      // We avoid 'PAID (TEST)' since it violates the DB CHECK constraint for status.
      if (config.shiprocketTestMode) {
        order.status = 'processing';
        await supabase.from('orders').update({ status: 'processing' }).eq('id', order.id);
      }

      try {
        await pushOrderToShiprocket(order.id);
        const { data: refreshed } = await supabase.from('orders').select('shiprocket_order_id, shipment_id').eq('id', order.id).maybeSingle();
        if (refreshed?.shiprocket_order_id) {
          order.shiprocket_order_id = refreshed.shiprocket_order_id;
          order.shipment_id = refreshed.shipment_id;
        }
      } catch (shiprocketErr) {
        console.error(`[Shiprocket] auto-push failed for order ${order.order_number} (${order.id}):`, shiprocketErr);
        // We don't fail the local order creation, just log it.
        // Retry via POST /orders/:id/push-shiprocket or the failed-push cron.
      }
    }

    return order;
  },

  async updateOrderStatus(id: string, status?: string, tracking_number?: string) {
    // 1. Fetch current order state
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !order) {
      throw new Error('Order not found');
    }

    // Normalize status casing to lowercase to match DB check constraint
    const statusToUse = status || order.status;
    const normalizedStatus = statusToUse.toLowerCase();

    // 2. Validate cancellation constraint
    if (normalizedStatus === 'cancelled' && (order.status === 'delivered' || order.status === 'delivered')) {
      throw new Error('Cannot cancel an already delivered order');
    }

    const updateData: any = { status: normalizedStatus };

    // If order is delivered and is COD, automatically mark as paid
    const isCOD = order.payment_method === 'Cash On Delivery' || String(order.payment_method).toUpperCase() === 'COD';
    if (normalizedStatus === 'delivered' && isCOD) {
      updateData.payment_status = 'paid';
      const confirmMsg = `[COD Auto-Confirmed Paid on manual Delivery status update]`;
      updateData.notes = order.notes ? `${order.notes} ${confirmMsg}`.trim() : confirmMsg;

      // Try to insert a success transaction record if one doesn't exist
      try {
        const { data: existingTx } = await supabase
          .from('transactions')
          .select('id')
          .eq('order_id', order.id)
          .eq('status', 'success')
          .maybeSingle();

        if (!existingTx) {
          await supabase.from('transactions').insert({
            user_id: order.user_id,
            order_id: order.id,
            amount: order.total,
            currency: 'INR',
            status: 'success',
            payment_method: order.payment_method,
            gateway_transaction_id: `COD-MANUAL-DELIVERY-${order.order_number}`,
            metadata: {
              detailed_status: 'paid',
              updated_at: new Date().toISOString(),
              source: 'manual_delivered_update'
            }
          });
        }
      } catch (txErr) {
        console.error('[Manual Update] Failed to insert COD transaction:', txErr);
      }
    }

    if (tracking_number) {
      updateData.awb_code = tracking_number;
      // Try to fetch initial tracking details from Shiprocket and sync them
      try {
        const response = await shiprocketTrackingService.trackAwb(tracking_number);
        if (response && response.tracking_data && response.tracking_data.shipment_track && response.tracking_data.shipment_track.length > 0) {
          const track = response.tracking_data.shipment_track[0];
          const payload = {
            awb: track.awb_code,
            current_status: track.current_status,
            shipment_id: track.shipment_id ? String(track.shipment_id) : (track.id ? String(track.id) : null),
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
          // Process webhook logic to update status, scans, etc.
          await shiprocketWebhookService.processWebhook(payload);
          
          // Re-fetch order status to include the updated values from processWebhook
          const { data: updatedOrder } = await supabase
            .from('orders')
            .select('status, tracking_status, last_tracking_update, courier_name, estimated_delivery, tracking_url')
            .eq('id', id)
            .single();
            
          if (updatedOrder) {
            updateData.status = updatedOrder.status;
            updateData.tracking_status = updatedOrder.tracking_status;
            updateData.last_tracking_update = updatedOrder.last_tracking_update;
            updateData.courier_name = updatedOrder.courier_name;
            updateData.estimated_delivery = updatedOrder.estimated_delivery;
            updateData.tracking_url = updatedOrder.tracking_url;
          }
        }
      } catch (srErr) {
        console.error('[Tracking Auto-Sync] Failed to fetch initial tracking from Shiprocket:', srErr);
      }
    }

    let shiprocketResponse = null;

    // 3. If transitioning to Cancelled, sync to Shiprocket
    if (normalizedStatus === 'cancelled') {
      updateData.tracking_status = 'CANCELED';
      updateData.last_tracking_update = new Date().toISOString();

      if (order.awb_code) {
        try {
          shiprocketResponse = await shiprocketOrderService.cancelOrder([order.awb_code]);
        } catch (srErr: any) {
          console.error('[Order Cancel Sync] Failed to cancel in Shiprocket:', srErr);
          // Don't block local cancel, just log
        }
      }
    }

    // 4. Update the database
    const { data, error } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', id)
      .select('*, users(email)')
      .single();

    if (error) throw error;

    // 4b. Push a WhatsApp status update to the customer for the shipment /
    // cancellation milestones. Fire-and-forget: never block the admin action.
    try {
      const notifyKey =
        normalizedStatus === 'shipped' || normalizedStatus === 'out for delivery'
          ? 'shipped'
          : normalizedStatus === 'delivered'
          ? 'delivered'
          : normalizedStatus === 'cancelled'
          ? 'cancelled'
          : null;
      if (notifyKey && notifyKey !== String(order.status || '').toLowerCase()) {
        await orderNotifyService.sendStatusUpdate(id, notifyKey);
      }
    } catch (notifyErr: any) {
      console.error('[OrderStatus] WhatsApp update failed:', notifyErr?.message || notifyErr);
    }

    // 5. Save cancellation to history
    if (status === 'cancelled' || normalizedStatus === 'cancelled') {
      await supabase.from('order_tracking_history').insert({
        order_id: id,
        tracking_status: 'CANCELED',
        activity: 'Order Cancelled (Fulfillment Update)',
        location: 'Platform',
        raw_payload: shiprocketResponse || { info: 'Cancelled locally before AWB assignment' }
      });
    }

    return data;
  },

  async getMyOrders(userId: string) {
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*, products(*)), order_tracking_history(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  },

  async updateOrder(id: string, updates: any) {
    // 1. Fetch current order
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !order) {
      throw new Error('Order not found');
    }

    // 2. Prepare update data
    const updateData: any = {};
    if (updates.status !== undefined) updateData.status = updates.status;
    // NOTE: the orders table stores the courier tracking number in `awb_code`
    // (there is no `tracking_number` column). Map it explicitly so admin
    // tracking updates never 500 on an unknown column.
    if (updates.tracking_number !== undefined) updateData.awb_code = updates.tracking_number;
    if (updates.awb_code !== undefined) updateData.awb_code = updates.awb_code;
    if (updates.shipping_address !== undefined) updateData.shipping_address = updates.shipping_address;
    if (updates.billing_address !== undefined) updateData.billing_address = updates.billing_address;
    if (updates.payment_status !== undefined) updateData.payment_status = updates.payment_status;
    if (updates.payment_method !== undefined) updateData.payment_method = updates.payment_method;
    if (updates.notes !== undefined) updateData.notes = updates.notes;

    // Recalculate financial fields if any of them are changed
    const newSubtotal = updates.subtotal !== undefined ? Number(updates.subtotal) : Number(order.subtotal);
    const newDiscount = updates.discount !== undefined ? Number(updates.discount) : Number(order.discount);
    
    if (updates.subtotal !== undefined || updates.discount !== undefined || updates.shipping_fee !== undefined || updates.shipping_cost !== undefined || updates.payment_method !== undefined) {
      updateData.subtotal = newSubtotal;
      updateData.discount = newDiscount;
      let newShippingFee = newSubtotal >= 1000 ? 0 : 50;
      
      const finalPaymentMethod = updates.payment_method !== undefined ? updates.payment_method : order.payment_method;
      if (finalPaymentMethod === 'Cash On Delivery') {
        newShippingFee += 50;
      }
      
      updateData.shipping_fee = newShippingFee;
      
      // Recalculate GST/Tax dynamically per item based on products' GST rates
      let gstAmount = 0;
      const { data: dbOrderItems } = await supabase
        .from('order_items')
        .select('*, products(seo_metadata)')
        .eq('order_id', id);
        
      if (dbOrderItems && dbOrderItems.length > 0) {
        dbOrderItems.forEach((item: any) => {
          const itemPrice = Number(item.price) || 0;
          const itemQty = Number(item.quantity) || 1;
          const itemTotal = itemPrice * itemQty;
          
          const dbProduct = item.products;
          const itemGstPercent = dbProduct?.seo_metadata?.gst_rate !== undefined 
            ? Number(dbProduct.seo_metadata.gst_rate)
            : (dbProduct?.seo_metadata?.gstRate !== undefined
               ? Number(dbProduct.seo_metadata.gstRate)
               : (dbProduct?.seo_metadata?.gst !== undefined 
                  ? Number(dbProduct.seo_metadata.gst) 
                  : (dbProduct?.seoMetadata?.gst !== undefined ? Number(dbProduct.seoMetadata.gst) : 5)));
          const itemGstRate = itemGstPercent / 100;
          
          const itemDiscount = newSubtotal > 0 ? (newDiscount * itemTotal) / newSubtotal : 0;
          const itemTaxable = itemTotal - itemDiscount;
          const itemGst = (itemTaxable * itemGstRate) / (1 + itemGstRate);
          gstAmount += itemGst;
        });
      } else {
        // Fallback if no items found in DB
        const taxableAmount = newSubtotal - newDiscount;
        const gstRate = 0.05; // Fallback default rate of 5%
        gstAmount = (taxableAmount * gstRate) / (1 + gstRate);
      }

      // Apply GST on shipping charges if shippingIsTaxable config flag is true
      if (config.shippingIsTaxable && newShippingFee > 0) {
        const shippingGstPercent = 18;
        const shippingGstRate = shippingGstPercent / 100;
        const shippingGst = (newShippingFee * shippingGstRate) / (1 + shippingGstRate);
        gstAmount += shippingGst;
      }
      
      updateData.tax = Number(gstAmount.toFixed(2));
      
      // Final total
      updateData.total = Number((newSubtotal - newDiscount + newShippingFee).toFixed(2));
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

     if (updateError) throw updateError;

     // Trigger transaction cancellation status update if order is cancelled or returned
     if (updates.status === 'cancelled' || updates.status === 'returned') {
       await handleTransactionCancellation(id, updates.status);
     }

     return updatedOrder;
   },

    async deleteOrder(id: string) {
      // 1. Delete associated transactions
      const { error: txErr } = await supabase
        .from('transactions')
        .delete()
        .eq('order_id', id);
      if (txErr) throw txErr;

      // 2. Delete associated order_tracking_history
      const { error: trackingErr } = await supabase
        .from('order_tracking_history')
        .delete()
        .eq('order_id', id);
      if (trackingErr) throw trackingErr;

      // 3. Delete associated order_items
      const { error: itemsErr } = await supabase
        .from('order_items')
        .delete()
        .eq('order_id', id);
      if (itemsErr) throw itemsErr;

      // 4. Delete the order itself
      const { error: orderErr } = await supabase
        .from('orders')
        .delete()
        .eq('id', id);
      if (orderErr) throw orderErr;
    }
};

export async function pushOrderToShiprocket(orderId: string) {
  const { data: order, error: fetchErr } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (fetchErr || !order) throw new Error('Order not found for Shiprocket push');
  if ((order as any).shiprocket_order_id) {
    console.log(`[Shiprocket] order ${order.order_number} already pushed (sr_order_id=${(order as any).shiprocket_order_id}), skipping.`);
    return { skipped: true, shiprocket_order_id: (order as any).shiprocket_order_id };
  }

  const { data: dbItems } = await supabase.from('order_items').select('*').eq('order_id', orderId);
  const items = dbItems || [];
  if (items.length === 0 || !order.shipping_address) {
    throw new Error('Order has no items or shipping address; cannot push to Shiprocket');
  }

  const productIds = items.map((i: any) => i.product_id).filter(Boolean);
  const { data: products } = await supabase
    .from('products')
    .select('id, name, sku, weight, length, breadth, height, hsn')
    .in('id', productIds);

  const shiprocketItems = items.map((item: any) => {
    const prod: any = products?.find((p: any) => p.id === item.product_id) || {};
    return {
      name: (prod.name || item.product_name || 'Product').slice(0, 100),
      sku: prod.sku || item.sku || `SKU-${String(item.product_id || 'NA').substring(0, 8).toUpperCase()}`,
      units: Number(item.quantity) || 1,
      selling_price: Number(item.price) || 0,
      discount: 0,
      tax: '',
      hsn: prod.hsn || '',
    };
  });

  let totalWeight = 0;
  let maxLength = 10;
  let maxBreadth = 10;
  let maxHeight = 10;
  if (products) {
    products.forEach((p: any) => {
      const itemQty = items.find((i: any) => i.product_id === p.id)?.quantity || 1;
      totalWeight += (Number(p.weight) || 0.5) * itemQty;
      maxLength = Math.max(maxLength, Number(p.length) || 10);
      maxBreadth = Math.max(maxBreadth, Number(p.breadth) || 10);
      maxHeight += (Number(p.height) || 0) * itemQty;
    });
  }
  maxHeight = Math.max(10, maxHeight);
  totalWeight = Math.max(0.1, Number(totalWeight.toFixed(2)));

  const billing = order.billing_address || order.shipping_address;
  const shipping = order.shipping_address;
  const normalizePhone10 = (v: any) => {
    let d = String(v || '').replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d;
  };
  const pickupLocation = process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary';
  if (!process.env.SHIPROCKET_PICKUP_LOCATION) {
    console.warn('[Shiprocket] SHIPROCKET_PICKUP_LOCATION is not set — falling back to "Primary". It must match the dashboard name exactly.');
  }
  const isCOD = order.payment_method === 'Cash On Delivery' || String(order.payment_method).toUpperCase() === 'COD';

  const srPayload: ShiprocketOrderPayload = {
    order_id: order.order_number,
    order_date: new Date(order.created_at || Date.now()).toISOString().split('T')[0],
    pickup_location: pickupLocation,
    channel_id: process.env.SHIPROCKET_CHANNEL_ID || '',
    billing_customer_name: (billing.fullName || shipping.fullName || 'Customer').slice(0, 50),
    billing_last_name: '',
    billing_address: billing.addressLine || shipping.addressLine || '',
    billing_city: billing.city || shipping.city || '',
    billing_pincode: billing.zipCode || shipping.zipCode || '',
    billing_state: billing.state || shipping.state || '',
    billing_country: 'India',
    billing_email: order.user_email || 'customer@meruveda.com',
    billing_phone: normalizePhone10(billing.phone || shipping.phone),
    shipping_is_billing: true,
    shipping_customer_name: (shipping.fullName || 'Customer').slice(0, 50),
    shipping_last_name: '',
    shipping_address: shipping.addressLine || '',
    shipping_address_2: '',
    shipping_city: shipping.city || '',
    shipping_pincode: shipping.zipCode || '',
    shipping_country: 'India',
    shipping_state: shipping.state || '',
    shipping_email: order.user_email || 'customer@meruveda.com',
    shipping_phone: normalizePhone10(shipping.phone),
    order_items: shiprocketItems,
    payment_method: isCOD ? 'COD' : 'Prepaid',
    shipping_charges: Number(order.shipping_fee ?? 0),
    giftwrap_charges: 0,
    transaction_charges: 0,
    total_discount: 0,
    sub_total: Number(order.total) || 0,
    length: maxLength,
    breadth: maxBreadth,
    height: maxHeight,
    weight: totalWeight,
  };

  console.log(`[Shiprocket] pushing order ${order.order_number} (${order.id}) payment=${srPayload.payment_method} pickup=${pickupLocation} weight=${totalWeight} items=${shiprocketItems.length}`);
  const srResponse = await shiprocketOrderService.createOrder(srPayload);
  console.log(`[Shiprocket] push response for ${order.order_number}:`, JSON.stringify(srResponse).slice(0, 1000));

  if (srResponse && (srResponse as any).order_id) {
    // Guarded write: only claim the IDs if no concurrent push (webhook
    // retry, manual push, cron) already stored them. Prevents a slower
    // duplicate response from dissociating the order from the first shipment.
    const { data: claimed } = await supabase.from('orders').update({
      shiprocket_order_id: String((srResponse as any).order_id),
      shipment_id: String((srResponse as any).shipment_id || ''),
      pickup_location: pickupLocation,
      tracking_status: 'NEW',
      last_tracking_update: new Date().toISOString(),
    }).eq('id', order.id).is('shiprocket_order_id', null).select('id');
    if (!claimed || claimed.length === 0) {
      console.log(`[Shiprocket] order ${order.order_number} was already claimed by a concurrent push; keeping existing IDs.`);
      return { skipped: true, shiprocket_order_id: (await supabase.from('orders').select('shiprocket_order_id').eq('id', order.id).maybeSingle()).data?.shiprocket_order_id };
    }
    return srResponse;
  }
  throw new Error(`Shiprocket create returned no order_id: ${JSON.stringify(srResponse).slice(0, 500)}`);
}

export async function retryFailedShiprocketPushes(limit = 20) {
  const { data: pending } = await supabase
    .from('orders')
    .select('id, order_number, status, payment_status, payment_method, created_at')
    .is('shiprocket_order_id', null)
    .in('status', ['processing', 'confirmed', 'pending'])
    .order('created_at', { ascending: true })
    .limit(limit);
  // Only push orders eligible for fulfilment: paid orders (any method) plus
  // COD orders (paid on delivery). Unpaid `pending` / `pending_payment`
  // checkouts are skipped so retries never ship orders prematurely.
  const eligible = (pending || []).filter((o: any) => {
    const method = String(o.payment_method || '').toUpperCase();
    const isCOD = method.includes('COD') || method.includes('CASH');
    if (isCOD) return o.status !== 'pending_payment';
    return o.payment_status === 'paid';
  });
  const results: Array<{ orderId: string; ok: boolean; error?: string }> = [];
  for (const o of eligible || []) {
    try {
      await pushOrderToShiprocket(o.id);
      results.push({ orderId: o.id, ok: true });
    } catch (err: any) {
      console.error(`[Shiprocket] retry failed for ${o.order_number}:`, err?.message || err);
      results.push({ orderId: o.id, ok: false, error: err?.message || 'push failed' });
    }
  }
  return results;
}

export async function handleTransactionCancellation(orderId: string, orderStatus: string) {
  try {
    const { data: tx } = await supabase
      .from('transactions')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();

    if (tx) {
      if (tx.status === 'success') {
        // Successfully paid/captured -> transition to refunded (refund_pending)
        await supabase
          .from('transactions')
          .update({
            status: 'refunded',
            metadata: {
              ...tx.metadata,
              detailed_status: 'refund_pending',
              cancelled_at: new Date().toISOString(),
              cancellation_reason: orderStatus
            }
          })
          .eq('id', tx.id);
      } else {
        // Pending or failed -> transition to failed (cancelled)
        await supabase
          .from('transactions')
          .update({
            status: 'failed',
            metadata: {
              ...tx.metadata,
              detailed_status: 'cancelled',
              cancelled_at: new Date().toISOString(),
              cancellation_reason: orderStatus
            }
          })
          .eq('id', tx.id);
      }
    }
  } catch (err) {
    console.error('[Cancellation Transaction] Failed to update transaction status:', err);
  }
}
