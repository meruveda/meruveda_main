import * as ordersRepo from '../database/repos/orders';
import * as productsRepo from '../database/repos/products';
import * as transactionsRepo from '../database/repos/transactions';
import * as couponsRepo from '../database/repos/coupons';
import * as trackingRepo from '../database/repos/tracking';
import { withTransaction } from '../database/db';
import { addressService } from './addressService';
import { shiprocketOrderService } from './shiprocket/order.service';
import {
  MAX_PUSH_ATTEMPTS,
  alertAdminOfTerminalFailure,
  decorateOrderForAdmin,
  decorateOrdersForAdmin,
  nextAttemptAt,
  recordTimelineEvent,
} from './shiprocketAutomation';
import { getInvoiceTemplate } from './whatsappTemplateResolver';
import { shiprocketTrackingService } from './shiprocket/tracking.service';
import { shiprocketWebhookService } from './shiprocket/webhook.service';
import { orderNotifyService } from './orderNotifyService';
import { ShiprocketOrderPayload } from './shiprocket/types';
import { hasColumn } from './schemaGuard';
import { config } from '../config/env';
import { computeOrderTotals, isRajasthan, round2 } from '@meruveda/shared';
import { normalizePhone } from './whatsappService';

/**
 * Re-exported so existing callers keep working; the single implementation now
 * lives in @meruveda/shared and is used by the invoice renderer too.
 *
 * IMPORTANT behavioural change: an EMPTY/UNKNOWN state returns false (=> IGST).
 * The old copy returned true for a blank state, which printed CGST+SGST on
 * orders that had no usable state and under-declared IGST.
 */
export { isRajasthan };

/** State codes we accept. Checkout validates against this list. */
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
] as const;

/**
 * An address is only usable for a tax invoice once state + pincode are known —
 * both are required to decide CGST/SGST vs IGST and to push to Shiprocket.
 */
export function validateInvoiceAddress(addr: any): string[] {
  const problems: string[] = [];
  if (!addr || typeof addr !== 'object') return ['address is missing'];
  if (!String(addr.addressLine || '').trim()) problems.push('address line');
  if (!String(addr.city || '').trim()) problems.push('city');
  if (!String(addr.state || '').trim()) {
    problems.push('state (required to decide CGST/SGST vs IGST)');
  } else if (!(INDIAN_STATES as readonly string[]).includes(String(addr.state).trim())) {
    problems.push(`state "${addr.state}" is not a recognised Indian state`);
  }
  if (!/^\d{6}$/.test(String(addr.zipCode || '').trim())) problems.push('pincode (6 digits)');
  if (!/^[1-9]\d{9}$/.test(String(addr.phone || '').replace(/\D/g, '').slice(-10))) problems.push('phone');
  return problems;
}

export const orderService = {
  async getOrders(params: any) {
    const { status, page = 1, limit = 10, sortBy = 'created_at', sortOrder = 'desc', includeItems, search, paymentMethod, startDate, endDate } = params;

    const pageNum = Number(page);
    const limitNum = Number(limit);

    const { rows: data, count } = await ordersRepo.listOrders({
      status,
      startDate,
      endDate,
      paymentMethod,
      search,
      sortBy,
      sortOrder,
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
      includeItems: includeItems === 'true',
    });

    // Attach the human-readable state to every row, so the admin list never
    // has to guess what "pending" refers to.
    const { template } = await getInvoiceTemplate();
    const decorated = decorateOrdersForAdmin(data, { whatsappTemplateReady: Boolean(template) });

    return {
      data: decorated,
      total: count,
      page: pageNum,
      limit: limitNum,
      totalPages: count ? Math.ceil(count / limitNum) : 0
    };
  },

  async getOrderById(id: string) {
    const data = await ordersRepo.getOrderById(id);

    if (!data) {
      const err = new Error('Order not found');
      (err as any).status = 404;
      throw err;
    }

    const { template } = await getInvoiceTemplate();
    return decorateOrderForAdmin(data, { whatsappTemplateReady: Boolean(template) });
  },

  async createOrder(payload: any, userId?: string) {
    const orderData = { ...payload };
    orderData.user_id = userId;
    // Whether the delivery phone was proven, recorded on the order so the
    // admin sees a "Phone unverified" badge for a guest checkout.
    if (orderData.phone_verified !== undefined && (await hasColumn('orders', 'phone_verified'))) {
      orderData.phone_verified = orderData.phone_verified === true;
    } else {
      delete orderData.phone_verified;
    }
    orderData.order_number = `MV-${Math.floor(100000 + Math.random() * 900000)}`;
    orderData.status = 'pending';

    // Line items are stored in their own table.
    const items = orderData.items;
    delete orderData.items;

    // Fetch the catalogue so the money is computed from the DATABASE.
    let dbProducts: any[] = [];
    if (items && items.length > 0) {
      const productIds = items.map((item: any) => item.product_id).filter(Boolean);
      if (productIds.length > 0) {
        dbProducts = await productsRepo.getProductsByIds(
          productIds,
          'id, name, sku, images, seo_metadata, price, selling_price',
        );
      }
    }

    /**
     * The line prices come from the DATABASE, not from the request.
     *
     * The client used to send the price of every line, so posting
     * `price: 1` bought a Rs.1000 product for Rs.1. The catalogue price is
     * the price; the request only says WHICH product and HOW MANY.
     */
    const pricedItems = (items || []).map((item: any) => {
      const dbProduct = dbProducts.find((p: any) => p.id === item.product_id);
      // The storefront sells at the selling price, so that is the price.
      const dbPrice = Number(dbProduct?.selling_price ?? dbProduct?.price ?? NaN);
      // A catalogue entry with no price at all is a data gap, not a free
      // product: the request price is used for it.
      const price = Number.isFinite(dbPrice) && dbPrice > 0
        ? round2(dbPrice)
        : round2(Number(item.price) || 0);
      return { ...item, price };
    });

    // The subtotal is the sum of those database prices.
    const serverSubtotal = round2(
      pricedItems.reduce(
        (sum: number, item: any) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 1),
        0,
      ),
    );

    // Every money figure below is server-computed.
    const subtotal = serverSubtotal;
    const isCOD = orderData.payment_method === 'Cash On Delivery' || String(orderData.payment_method).toUpperCase() === 'COD';

    /**
     * The discount is computed on the SERVER from the coupon record.
     *
     * The client used to send the discount amount, which meant anyone could
     * post `discount: 5000` and get the goods for free. Now the amount is
     * derived from the coupon itself: its type, its value, its cap, its
     * minimum spend and its expiry. A client that sends a discount without a
     * coupon code gets no discount at all.
     */
    const couponCode = String(orderData.coupon_code ?? orderData.couponCode ?? '').trim();
    delete orderData.coupon_code;
    delete orderData.couponCode;

    let discount = 0;
    let couponIsFreeShipping = false;
    if (couponCode) {
      const coupon = await couponsRepo.findByCode(couponCode);
      if (!coupon) {
        throw Object.assign(new Error('This coupon code is not valid.'), {
          status: 400,
          code: 'INVALID_COUPON',
        });
      }
      if (!coupon.active) {
        throw Object.assign(new Error('This coupon is no longer active.'), {
          status: 400,
          code: 'INACTIVE_COUPON',
        });
      }
      if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
        throw Object.assign(new Error('This coupon has expired.'), {
          status: 400,
          code: 'EXPIRED_COUPON',
        });
      }
      const minPurchase = Number(coupon.min_purchase || 0);
      if (minPurchase > 0 && subtotal < minPurchase) {
        throw Object.assign(
          new Error(`This coupon needs a minimum order value of Rs.${minPurchase}.`),
          { status: 400, code: 'COUPON_MINIMUM_NOT_MET' },
        );
      }

      const type = String(coupon.type || '').toLowerCase();
      const value = Number(coupon.value || 0);
      if (type === 'percentage' || type === 'percent') {
        discount = round2((subtotal * value) / 100);
        const maxDiscount = Number(coupon.max_discount || 0);
        if (maxDiscount > 0 && discount > maxDiscount) discount = round2(maxDiscount);
      } else if (type === 'fixed' || type === 'flat') {
        discount = round2(value);
      } else if (type === 'free_shipping') {
        // Free shipping is applied to the shipping charge below, not to the
        // subtotal, so the discount stays 0 here.
        discount = 0;
        couponIsFreeShipping = true;
      }
      // A discount can never exceed the subtotal.
      if (discount > subtotal) discount = round2(subtotal);
      if (discount < 0) discount = 0;
    }

    // Base courier charge, GST-INCLUSIVE — this is the flat "shipping added on
    // top" the reference invoice shows.
    let shippingFee = subtotal >= 1000 ? 0 : 50;
    if (isCOD) shippingFee += 50;
    // A free-shipping coupon removes the courier charge (the COD handling fee
    // is not a courier charge, so it stays).
    if (couponCode && couponIsFreeShipping) {
      shippingFee = isCOD ? 50 : 0;
    }

    // SHIPPING_IS_TAXABLE=true opts into charging shipping GST on TOP of the
    // base charge, so the total genuinely includes it (default false keeps the
    // GST-inclusive flat charge, which is what the reference template shows).
    if (config.shippingIsTaxable && shippingFee > 0) {
      shippingFee = round2(shippingFee + (shippingFee * 18) / 100);
    }
    orderData.shipping_fee = shippingFee;
    if (orderData.shipping_cost !== undefined) delete orderData.shipping_cost;


    // One shared calculator for the order row AND the invoice, so `tax` on the
    // order is by construction the same figure the PDF prints.
    const gstLines = pricedItems.map((item: any) => {
      const dbProduct = dbProducts.find((p: any) => p.id === item.product_id);
      const meta = dbProduct?.seo_metadata || dbProduct?.seoMetadata || {};
      const raw = meta.gst_rate ?? meta.gstRate ?? meta.gst;
      const ratePercent = Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : 5;
      return {
        gross: (Number(item.price) || 0) * (Number(item.quantity) || 1),
        ratePercent,
      };
    });

    const totals = computeOrderTotals({
      subtotal,
      discount,
      shippingFee,
      lines: gstLines,
      shippingGstRatePercent: config.shippingIsTaxable ? 18 : 0,
    });
    orderData.tax = totals.gst;

    // Write the computed money back onto the order row. The values the client
    // sent are overwritten, never trusted.
    orderData.subtotal = subtotal;
    orderData.discount = discount;
    orderData.total = round2(subtotal - discount + shippingFee);
    // The line items are stored with the server-side prices too.
    if (items && items.length > 0) {
      orderData.items = pricedItems;
    }
    
    // Ensure billing_address is set, fallback to shipping_address to satisfy NOT NULL constraint
    if (!orderData.billing_address) {
      orderData.billing_address = orderData.shipping_address;
    }
    const billingAddress = orderData.billing_address;

    // delivery_phone: the dedicated column (migration 003) that Shiprocket push
    // and tracking prefer over shipping_address->>'phone'. Populated from an
    // explicit payload field, else derived from the shipping/billing address.
    // Normalised to digits-only with country code (e.g. 919876543210) so
    // Shiprocket's 10-digit national check and WhatsApp's E.164-ish check both
    // work off the same value.
    {
      // The delivery phone (an Indian number the parcel can be delivered to)
      // and the customer's own number (for WhatsApp and the invoice) are two
      // different things for an order placed from outside India.
      const rawPhone =
        orderData.customer_phone ||
        orderData.delivery_phone ||
        orderData.shipping_address?.phone ||
        orderData.billing_address?.phone ||
        '';
      // Reuse the WhatsApp normaliser: 10-digit Indian gets 91 prepended,
      // 12-digit starting 91 passes through, anything else is digits-only as-is.
      const deliveryPhone = normalizePhone(orderData.delivery_phone || rawPhone);
      const customerPhone = normalizePhone(orderData.customer_phone || rawPhone);
      orderData.delivery_phone = deliveryPhone;
      delete orderData.customer_phone;
      // Keep the jsonb address in sync so old readers (track page, invoice
      // buyer phone) see the same canonical digits. The customer's own number
      // wins here, because that is who receives the WhatsApp messages.
      if (orderData.shipping_address && rawPhone) {
        orderData.shipping_address = {
          ...orderData.shipping_address,
          phone: customerPhone || deliveryPhone,
        };
      }
      if (orderData.billing_address && rawPhone) {
        orderData.billing_address = {
          ...orderData.billing_address,
          phone: customerPhone || deliveryPhone,
        };
      }
    }

    // A tax invoice needs a usable state to pick CGST+SGST vs IGST and a 6-digit
    // pincode for the courier. Checkout already enforces both, but orders can
    // also arrive from saved addresses or the API, so log loudly rather than
    // failing the order — an invoice with an unknown state is still correct
    // (it falls back to IGST, the conservative treatment).
    const addrProblems = validateInvoiceAddress(orderData.shipping_address || billingAddress);
    if (addrProblems.length > 0) {
      console.warn(
        `[Orders] order ${orderData.order_number} has an incomplete delivery address ` +
          `(${addrProblems.join(', ')}). Checkout requires these; the invoice will use IGST.`
      );
    }

    // A coupon carried by the checkout payload is claimed here, atomically,
    // inside the same transaction as the order rows. The code was read and
    // the amount was computed above, on the server.

    // One transaction for every money-touching write: order row, line items,
    // conditional stock decrement (no oversell), coupon usage, COD tx log.
    // If anything fails the whole order rolls back — no half-created orders.
    const order = await withTransaction(async (q) => {
      const orderRow = await ordersRepo.insertOrder(orderData, q);

      if (items && items.length > 0) {
        // The stored line uses the SERVER-side price, so the order, the invoice
        // and the admin panel all quote the same figure.
        const orderItems = pricedItems.map((item: any) => {
          const dbProduct = dbProducts.find((p: any) => p.id === item.product_id);
          const productName = item.name || item.product_name || dbProduct?.name || "Unknown Product";

          let sku = item.sku || dbProduct?.sku || "";
          if (!sku || sku === "") {
            sku = item.product_id ? `SKU-${item.product_id.substring(0, 8).toUpperCase()}` : "";
          }

          const imageUrl = item.image || item.image_url || (dbProduct?.images && dbProduct.images.length > 0 ? (typeof dbProduct.images[0] === 'string' ? dbProduct.images[0] : dbProduct.images[0]?.url) : null);

          return {
            order_id: orderRow.id,
            product_id: item.product_id,
            quantity: item.quantity,
            price: item.price,
            total: item.quantity * item.price,
            product_name: productName,
            sku: sku,
            image_url: imageUrl
          };
        });

        await ordersRepo.insertOrderItems(orderItems, q);

        // Conditional decrement: the UPDATE only matches while enough stock is
        // left, so a concurrent order can never take the same units twice.
        for (const item of items) {
          const wanted = Math.trunc(Number(item.quantity) || 0);
          if (wanted < 1) {
            throw Object.assign(
              new Error('Every item needs a quantity of at least 1.'),
              { status: 400, code: 'INVALID_QUANTITY' },
            );
          }
          const ok = await productsRepo.decrementStock(item.product_id, wanted, q);
          if (!ok) {
            const dbProduct = dbProducts.find((p: any) => p.id === item.product_id);
            const name = dbProduct?.name || item.name || item.product_name || 'An item in your cart';
            throw Object.assign(
              new Error(`Only a few left — "${name}" does not have ${wanted} unit(s) in stock right now.`),
              { status: 409, code: 'INSUFFICIENT_STOCK' },
            );
          }
        }
      }

      if (couponCode) {
        const applied = await couponsRepo.incrementUsageAtomic(couponCode, q);
        if (!applied) {
          throw Object.assign(
            new Error('This coupon can no longer be used.'),
            { status: 400, code: 'COUPON_UNAVAILABLE' },
          );
        }
      }

      // Log transaction (only for Cash On Delivery on placement. PayU writes its own logs on callback).
      if (isCOD) {
        const txData = {
          user_id: orderRow.user_id,
          order_id: orderRow.id,
          amount: orderRow.total,
          currency: 'INR',
          status: 'pending',
          payment_method: orderRow.payment_method,
          gateway_transaction_id: null,
          metadata: {
            detailed_status: 'pending',
            updated_at: new Date().toISOString()
          }
        };
        await transactionsRepo.insertTransaction(txData, q);
      }

      return orderRow;
    });

    // ============================================
    // Shiprocket Integration
    // ============================================
    // Auto-push lives in postOrderConfirmed() (called by the controller for
    // every order) so there is exactly one awaited push point per source.
    // This inline legacy branch now exists ONLY for local test mode when the
    // kill switch is off; it must never run in production.
    if (config.shiprocketTestMode) {
      // Temporarily mark order as processing for testing (PAID)
      // We avoid 'PAID (TEST)' since it violates the DB CHECK constraint for status.
      order.status = 'processing';
      await ordersRepo.updateOrderById(order.id, { status: 'processing' });
    }
    if (config.shiprocketTestMode && !config.shiprocketAutoPush) {
      try {
        await pushOrderToShiprocket(order.id);
        const refreshed = await ordersRepo.getShiprocketIds(order.id);
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

    // File the shipping address in the customer's address book so the next
    // order does not have to be typed again. Deliberately after the order row
    // exists and deliberately non-fatal: captureFromOrder never throws, so a
    // missing address book can never fail an order that was already accepted.
    await addressService.captureFromOrder(userId, order.shipping_address);

    // The order timeline starts here. Everything after this (invoice, push,
    // AWB, delivery, failures) is appended as it happens.
    await recordTimelineEvent(order.id, 'Order placed', {
      order_number: order.order_number,
      total: order.total,
      payment_method: order.payment_method,
    });

    return order;
  },

  async updateOrderStatus(id: string, status?: string, tracking_number?: string) {
    // 1. Fetch current order state
    const order = await ordersRepo.getOrderRow(id);

    if (!order) {
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
        const existingTx = await transactionsRepo.findSuccessByOrder(order.id);

        if (!existingTx) {
          await transactionsRepo.insertTransaction({
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
          const updatedOrder = await ordersRepo.getOrderRow(id);

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
    await ordersRepo.updateOrderById(id, updateData);
    const data = await ordersRepo.getOrderWithUser(id);
    if (!data) throw new Error('Order not found');

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
      await trackingRepo.insertHistory({
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
    return ordersRepo.getMyOrders(userId);
  },

  async updateOrder(id: string, updates: any) {
    // 1. Fetch current order
    const order = await ordersRepo.getOrderRow(id);

    if (!order) {
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
      // Same shipping-GST rule as createOrder (see the comment there).
      if (config.shippingIsTaxable && newShippingFee > 0) {
        newShippingFee = round2(newShippingFee + (newShippingFee * 18) / 100);
      }

      updateData.shipping_fee = newShippingFee;

      // Recalculate GST through the SAME helper the invoice uses, so an admin
      // edit can never leave `tax` disagreeing with the printed invoice.
      const dbOrderItems = await ordersRepo.getItemsWithProductMeta(id);

      const gstLines = dbOrderItems.map((item: any) => {
        const meta = item.products?.seo_metadata || item.products?.seoMetadata || {};
        const raw = meta.gst_rate ?? meta.gstRate ?? meta.gst;
        const ratePercent = Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : 5;
        return {
          gross: (Number(item.price) || 0) * (Number(item.quantity) || 1),
          ratePercent,
        };
      });

      const updatedTotals = computeOrderTotals({
        subtotal: newSubtotal,
        discount: newDiscount,
        shippingFee: newShippingFee,
        fallbackGst: Number(order.tax) || 0,
        lines: gstLines,
        shippingGstRatePercent: config.shippingIsTaxable ? 18 : 0,
      });

      updateData.tax = updatedTotals.gst;
      // Final total
      updateData.total = round2(newSubtotal - newDiscount + newShippingFee);
    }

    const updatedOrder = await ordersRepo.updateOrderById(id, updateData);
    if (!updatedOrder) throw new Error('Order not found');

     // Trigger transaction cancellation status update if order is cancelled or returned
     if (updates.status === 'cancelled' || updates.status === 'returned') {
       await handleTransactionCancellation(id, updates.status);
     }

     return updatedOrder;
   },

    async deleteOrder(id: string) {
      await ordersRepo.deleteOrderCascade(id);
    }
};

/**
 * A push that was deliberately not made.
 *
 * The only reason today is "no Indian delivery contact": Shiprocket cannot
 * ship such an order. A skip is NOT a failure — it is recorded separately, is
 * never retried, and never affects the order or the payment.
 */
export class ShiprocketPushSkipped extends Error {
  constructor(public readonly reason: string) {
    super(`Shiprocket push skipped: ${reason}`);
    this.name = 'ShiprocketPushSkipped';
  }
}

/** Mark a push attempt as failed (guarded by delta 010 columns). */
async function markPushFailed(orderId: string, message: string): Promise<void> {
  try {
    const statusOk = await hasColumn('orders', 'shiprocket_push_status');
    const errorOk = await hasColumn('orders', 'shiprocket_push_error');
    if (!statusOk && !errorOk) return;
    await ordersRepo.updateOrderById(orderId, {
      ...(statusOk ? { shiprocket_push_status: 'failed' } : {}),
      ...(errorOk ? { shiprocket_push_error: String(message).slice(0, 500) } : {}),
    });
  } catch (err: any) {
    console.error('[Shiprocket] could not persist push failure:', err?.message || err);
  }
}

/**
 * Record a deliberate skip.
 *
 * The order keeps its normal status, the customer is never blocked, and the
 * admin list shows the reason instead of a scary failure.
 */
async function markPushSkipped(orderId: string, reason: string): Promise<void> {
  try {
    const patch: Record<string, any> = {
      shiprocket_push_skipped: true,
      shiprocket_push_skipped_reason: String(reason).slice(0, 200),
    };
    if (await hasColumn('orders', 'shiprocket_push_status')) {
      patch.shiprocket_push_status = 'skipped';
    }
    if (await hasColumn('orders', 'shiprocket_push_error')) {
      patch.shiprocket_push_error = null;
    }
    await ordersRepo.updateOrderById(orderId, patch);
  } catch (err: any) {
    console.error('[Shiprocket] could not persist push skip:', err?.message || err);
  }
}

/**
 * Count the attempt and schedule the next one.
 *
 * The schedule is immediate, 5m, 15m, 1h, 6h, 24h and stops after 8
 * attempts, at which point the failure is terminal and the store owner is
 * alerted once.
 */
async function recordPushAttempt(orderId: string, ok: boolean): Promise<number> {
  try {
    if (!(await hasColumn('orders', 'shiprocket_push_attempts'))) return 0;
    const attempts = await ordersRepo.incrementPushAttempts(orderId);
    if (ok) {
      if (await hasColumn('orders', 'shiprocket_push_next_attempt_at')) {
        await ordersRepo.updateOrderById(orderId, { shiprocket_push_next_attempt_at: null });
      }
      return attempts;
    }
    const next = nextAttemptAt(attempts);
    if (await hasColumn('orders', 'shiprocket_push_next_attempt_at')) {
      await ordersRepo.updateOrderById(orderId, { shiprocket_push_next_attempt_at: next });
    }
    return attempts;
  } catch (err: any) {
    console.error('[Shiprocket] could not record push attempt:', err?.message || err);
    return 0;
  }
}

/** Mark a push attempt as successful (guarded by delta 010 columns). */
async function markPushSucceeded(orderId: string): Promise<void> {
  try {
    const statusOk = await hasColumn('orders', 'shiprocket_push_status');
    const atOk = await hasColumn('orders', 'shiprocket_pushed_at');
    const errorOk = await hasColumn('orders', 'shiprocket_push_error');
    if (!statusOk && !atOk) return;
    await ordersRepo.updateOrderById(orderId, {
      ...(statusOk ? { shiprocket_push_status: 'pushed' } : {}),
      ...(atOk ? { shiprocket_pushed_at: new Date().toISOString() } : {}),
      ...(errorOk ? { shiprocket_push_error: null } : {}),
    });
  } catch (err: any) {
    console.error('[Shiprocket] could not persist push success:', err?.message || err);
  }
}

/**
 * Atomic "who pushes this order" claim.
 *
 * Two parallel triggers (double PayU webhook + admin button + cron) must never
 * create two Shiprocket orders for the same local order. The claim is a single
 * conditional UPDATE, which Postgres executes atomically:
 *
 *   UPDATE orders SET shiprocket_push_status = 'in_progress'
 *    WHERE id = :id
 *      AND shiprocket_order_id IS NULL
 *      AND (shiprocket_push_status IS NULL OR shiprocket_push_status <> 'in_progress')
 *
 * A stuck 'in_progress' row (serverless killed mid-request) is reclaimable
 * after 10 minutes so an order can never be locked forever.
 *
 * When delta 010 has not been applied the status columns do not exist; the
 * claim then degrades to `shiprocket_order_id IS NULL`, which is still atomic
 * on the final write but cannot serialise the outbound API call itself.
 * Returns: 'claimed' (go ahead) | 'busy' (someone else is pushing).
 */
async function claimShiprocketPush(orderId: string): Promise<'claimed' | 'busy'> {
  if (!(await hasColumn('orders', 'shiprocket_push_status'))) {
    return 'claimed';
  }

  const claimPatch = {
    shiprocket_push_status: 'in_progress',
    ...(await hasColumn('orders', 'shiprocket_push_started_at'))
      ? { shiprocket_push_started_at: new Date().toISOString() }
      : {},
    ...(await hasColumn('orders', 'shiprocket_push_error'))
      ? { shiprocket_push_error: null }
      : {},
  };

  try {
    const claimed = await ordersRepo.claimShiprocketPush(orderId, claimPatch);
    if (claimed) return 'claimed';

    // Nobody claimed it => either already pushed, or a push is in flight.
    const row = await ordersRepo.getPushState(orderId);
    if (row?.shiprocket_order_id) return 'busy';

    const startedAt = row?.shiprocket_push_started_at;
    const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    if (row?.shiprocket_push_status === 'in_progress' && startedAt && startedAt < staleCutoff) {
      const retried = await ordersRepo.claimStaleShiprocketPush(orderId, claimPatch, staleCutoff);
      if (retried) return 'claimed';
    }
    return 'busy';
  } catch (err: any) {
    console.error('[Shiprocket] push claim failed:', err?.message || err);
    return 'claimed';
  }
}

export async function pushOrderToShiprocket(orderId: string) {
  const order = await ordersRepo.getOrderRow(orderId);
  if (!order) throw new Error('Order not found for Shiprocket push');
  if ((order as any).shiprocket_order_id) {
    console.log(`[Shiprocket] order ${order.order_number} already pushed (sr_order_id=${(order as any).shiprocket_order_id}), skipping.`);
    await markPushSucceeded(order.id);
    return { skipped: true, shiprocket_order_id: (order as any).shiprocket_order_id };
  }

  // A deliberate skip is final: never attempt it again.
  if ((order as any).shiprocket_push_skipped) {
    return {
      skipped: true,
      reason: (order as any).shiprocket_push_skipped_reason || 'no Indian delivery contact',
      shiprocket_order_id: null,
    };
  }

  const claim = await claimShiprocketPush(order.id);
  if (claim === 'busy') {
    console.log(`[Shiprocket] order ${order.order_number} push already in progress elsewhere, skipping.`);
    return { skipped: true, shiprocket_order_id: null };
  }

  try {
    const result = await executeShiprocketPush(order);
    await recordPushAttempt(order.id, true);
    return result;
  } catch (err: any) {
    if (err instanceof ShiprocketPushSkipped) {
      // Not a failure: the order stays exactly as it is.
      await markPushSkipped(order.id, err.reason);
      console.warn(`[Shiprocket] order ${order.order_number} skipped: ${err.reason}`);
      await recordTimelineEvent(order.id, 'Shiprocket push skipped', { reason: err.reason });
      return { skipped: true, reason: err.reason, shiprocket_order_id: null };
    }

    const attempts = await recordPushAttempt(order.id, false);
    await markPushFailed(order.id, err?.message || String(err));
    await recordTimelineEvent(order.id, 'Shiprocket push failed', {
      reason: String(err?.message || err).slice(0, 300),
      attempt: attempts,
    });

    // The attempt budget is spent: tell the store owner once, so a parcel
    // never silently disappears.
    if (attempts >= MAX_PUSH_ATTEMPTS) {
      try {
        await alertAdminOfTerminalFailure(order, err?.message || String(err));
      } catch (alertErr: any) {
        console.error('[Shiprocket] admin alert failed:', alertErr?.message || alertErr);
      }
    }
    throw err;
  }
}

async function executeShiprocketPush(order: any) {
  const orderId = order.id;
  const items = await ordersRepo.getOrderItems(orderId);
  if (items.length === 0 || !order.shipping_address) {
    throw new Error('Order has no items or shipping address; cannot push to Shiprocket');
  }

  const productIds = items.map((i: any) => i.product_id).filter(Boolean);
  const products = await productsRepo.getProductsByIds(
    productIds,
    'id, name, sku, weight, length, breadth, height, hsn',
  );

  const shiprocketItems = items.map((item: any) => {
    const prod: any = products.find((p: any) => p.id === item.product_id) || {};
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

  const defaultWeight = config.shiprocketDefaultWeightKg;
  const defaultLength = config.shiprocketDefaultLengthCm;
  const defaultBreadth = config.shiprocketDefaultBreadthCm;
  const defaultHeight = config.shiprocketDefaultHeightCm;

  let totalWeight = 0;
  let maxLength = 0;
  let maxBreadth = 0;
  let maxHeight = 0;
  let usedDefaultWeight = false;
  let usedDefaultDimensions = false;

  products.forEach((p: any) => {
    const itemQty = items.find((i: any) => i.product_id === p.id)?.quantity || 1;

    const productWeight = Number(p.weight);
    if (productWeight > 0) {
      totalWeight += productWeight * itemQty;
    } else {
      usedDefaultWeight = true;
      totalWeight += defaultWeight * itemQty;
    }

    const length = Number(p.length);
    const breadth = Number(p.breadth);
    const height = Number(p.height);
    if (length > 0) maxLength = Math.max(maxLength, length);
    else usedDefaultDimensions = true;
    if (breadth > 0) maxBreadth = Math.max(maxBreadth, breadth);
    else usedDefaultDimensions = true;
    if (height > 0) maxHeight += height * itemQty;
    else usedDefaultDimensions = true;
  });

  if (totalWeight <= 0) {
    usedDefaultWeight = true;
    totalWeight = defaultWeight;
  }
  maxLength = Math.max(defaultLength, maxLength);
  maxBreadth = Math.max(defaultBreadth, maxBreadth);
  maxHeight = Math.max(defaultHeight, maxHeight);
  totalWeight = Math.max(0.1, Number(totalWeight.toFixed(2)));

  if (usedDefaultWeight || usedDefaultDimensions) {
    console.warn(
      `[Shiprocket] order ${order.order_number} is missing product ${usedDefaultWeight ? 'weight' : ''}` +
        `${usedDefaultWeight && usedDefaultDimensions ? ' and ' : ''}${usedDefaultDimensions ? 'dimensions' : ''}; ` +
        `using defaults weight=${defaultWeight}kg dims=${defaultLength}x${defaultBreadth}x${defaultHeight}cm ` +
        `(SHIPROCKET_DEFAULT_* env overrides)`
    );
  }

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

  // ---- Pre-flight validation with human readable errors --------------
  // These surface verbatim on the admin Orders page instead of an opaque 502.
  const missingAddress: string[] = [];
  if (!String(shipping.addressLine || '').trim()) missingAddress.push('address line');
  if (!String(shipping.city || '').trim()) missingAddress.push('city');
  if (!String(shipping.state || '').trim()) missingAddress.push('state');
  if (!String(shipping.zipCode || '').trim()) missingAddress.push('pincode');
  if (missingAddress.length > 0) {
    throw new Error(
      `Cannot push to Shiprocket: shipping ${missingAddress.join(', ')} missing for order ${order.order_number}.`
    );
  }
  // delivery_phone (migration 003) is the canonical column; fall back to the
  // jsonb address for orders created before the column existed.
  const deliveryPhoneRaw = order.delivery_phone || shipping.phone;
  const shippingPhone10 = normalizePhone10(deliveryPhoneRaw);
  if (!/^[6-9]\d{9}$/.test(shippingPhone10)) {
    // Shiprocket only accepts Indian mobile numbers. An order without an
    // Indian delivery contact is DELIBERATELY SKIPPED, not failed: the order
    // and the payment stay untouched, the customer is not blocked, and the
    // admin sees "Skipped - no Indian delivery contact" so they can fulfil
    // it by hand. A skip is never retried.
    const rawDigits = String(deliveryPhoneRaw || '').replace(/\D/g, '');
    const looksNonIndian = rawDigits.length > 10;
    throw new ShiprocketPushSkipped(
      looksNonIndian
        ? 'no Indian delivery contact (non-Indian delivery phone)'
        : 'no Indian delivery contact (missing or invalid delivery phone)',
    );
  }
  if (!/^\d{6}$/.test(String(shipping.zipCode || '').trim())) {
    throw new Error(
      `Cannot push to Shiprocket: pincode "${shipping.zipCode}" must be 6 digits for order ${order.order_number}.`
    );
  }

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
    // shipping_is_billing=true, so Shiprocket needs one valid Indian number.
    // Billing may be a foreign cardholder phone; the delivery phone wins.
    billing_phone: shippingPhone10,
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
    shipping_phone: shippingPhone10,
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
    const claimed = await ordersRepo.claimShiprocketIds(order.id, {
      shiprocket_order_id: String((srResponse as any).order_id),
      shipment_id: String((srResponse as any).shipment_id || ''),
      pickup_location: pickupLocation,
      tracking_status: 'NEW',
      last_tracking_update: new Date().toISOString(),
    });
    if (!claimed) {
      console.log(`[Shiprocket] order ${order.order_number} was already claimed by a concurrent push; keeping existing IDs.`);
      return { skipped: true, shiprocket_order_id: (await ordersRepo.getShiprocketIds(order.id))?.shiprocket_order_id };
    }
    await markPushSucceeded(order.id);
    await recordTimelineEvent(order.id, 'Pushed to Shiprocket', {
      shiprocket_order_id: String((srResponse as any).order_id),
      shipment_id: String((srResponse as any).shipment_id || ''),
    });
    return srResponse;
  }
  throw new Error(`Shiprocket create returned no order_id: ${JSON.stringify(srResponse).slice(0, 500)}`);
}

export interface RetryFailedPushOptions {
  failedOnly?: boolean;
  sinceHours?: number;
}

async function runRetryCandidates(limit: number, opts: RetryFailedPushOptions) {
  const pending = await ordersRepo.retryPushCandidates(limit, opts);
  // Only push orders eligible for fulfilment: paid orders (any method) plus
  // COD orders (paid on delivery). Unpaid `pending` / `pending_payment`
  // checkouts are skipped so retries never ship orders prematurely.
  const eligible = pending.filter((o: any) => {
    const method = String(o.payment_method || '').toUpperCase();
    const isCOD = method.includes('COD') || method.includes('CASH');
    if (isCOD) return o.status !== 'pending_payment';
    return o.payment_status === 'paid';
  });
  const results: Array<{ orderId: string; ok: boolean; error?: string }> = [];
  for (const o of eligible) {
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

export async function retryFailedShiprocketPushes(
  limit = 20,
  opts: RetryFailedPushOptions = {}
) {
  return runRetryCandidates(limit, opts);
}

/**
 * Bounded opportunistic sweep: after every fresh push, retry at most a couple
 * of recent failures. This keeps a transient Shiprocket outage self-healing
 * without turning checkout background work into an unbounded loop.
 */
export async function retryRecentFailedShiprocketPushes(limit = 2, sinceHours = 24) {
  return runRetryCandidates(limit, { failedOnly: true, sinceHours });
}

export async function handleTransactionCancellation(orderId: string, orderStatus: string) {
  try {
    const tx = await transactionsRepo.findByOrderId(orderId);

    if (tx) {
      if (tx.status === 'success') {
        // Successfully paid/captured -> transition to refunded (refund_pending)
        await transactionsRepo.updateTransaction(tx.id, {
          status: 'refunded',
          metadata: {
            ...tx.metadata,
            detailed_status: 'refund_pending',
            cancelled_at: new Date().toISOString(),
            cancellation_reason: orderStatus
          }
        });
      } else {
        // Pending or failed -> transition to failed (cancelled)
        await transactionsRepo.updateTransaction(tx.id, {
          status: 'failed',
          metadata: {
            ...tx.metadata,
            detailed_status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            cancellation_reason: orderStatus
          }
        });
      }
    }
  } catch (err) {
    console.error('[Cancellation Transaction] Failed to update transaction status:', err);
  }
}
