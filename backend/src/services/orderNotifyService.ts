import { config } from '../config/env';
import { supabase } from '../database/supabase';
import {
  WHATSAPP_TEMPLATES,
  normalizePhone,
  sendOnce,
  sendTemplate,
} from './whatsappService';

const money = (v: any) => `Rs. ${Number(v || 0).toFixed(2)}`;

/** Status -> Meta template that should be pushed to the customer. */
const STATUS_TEMPLATES: Record<string, { template: string; params: (o: any) => string[] }> = {
  shipped: {
    template: WHATSAPP_TEMPLATES.ORDER_SHIPPED,
    params: (o) => [o.order_number, o.courier_name || 'our courier', o.awb_code || '-'],
  },
  'out-for-delivery': {
    template: WHATSAPP_TEMPLATES.SHIPPING_UPDATE,
    params: (o) => [o.order_number, 'Out for delivery'],
  },
  delivered: {
    template: WHATSAPP_TEMPLATES.ORDER_DELIVERED,
    params: (o) => [o.order_number],
  },
  cancelled: {
    template: WHATSAPP_TEMPLATES.ORDER_CANCELLED,
    params: (o) => [o.order_number],
  },
};

function customerPhone(order: any): string {
  return order?.shipping_address?.phone || order?.billing_address?.phone || '';
}

async function loadOrder(orderId: string) {
  const { data } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
  return data;
}

export const orderNotifyService = {
  /** Order confirmation — sent once per order. */
  async sendOrderConfirmation(order: any) {
    try {
      const phone = customerPhone(order);
      const name = order.shipping_address?.fullName?.split(' ')[0] || 'there';
      await sendOnce({
        to: phone,
        purpose: 'order_confirmation',
        referenceId: `order_confirmation:${order.id}`,
        template: WHATSAPP_TEMPLATES.ORDER_CONFIRMATION,
        params: [name, order.order_number, money(order.total)],
        fallbackText: `Thank you ${name}! Your MeruVeda order ${order.order_number} for ${money(order.total)} has been confirmed.`,
        payload: { order_number: order.order_number },
      });
    } catch (err: any) {
      console.error('[OrderNotify] order confirmation failed:', err?.message || err);
    }
  },

  /**
   * Order confirmation text only.
   *
   * The PDF invoice used to be sent from here as well, which created a SECOND,
   * divergent invoice path next to invoiceDispatchService (WhatsApp-only, no
   * email, no storage, no atomic claim). It has been removed: invoice
   * generation and delivery now live exclusively in invoiceDispatchService.
   */
  async sendInvoice(): Promise<never> {
    throw new Error(
      'orderNotifyService.sendInvoice was removed — use invoiceDispatchService.sendInvoiceAuto() instead.'
    );
  },

  /**
   * Full post-purchase sequence: confirmation text (invoice is handled by
   * invoiceDispatchService, which runs in parallel).
   */
  async sendPostPurchaseMessages(orderId: string) {
    const order = await loadOrder(orderId);
    if (!order) return;
    await this.sendOrderConfirmation(order);
  },

  /**
   * Push a shipment status change (shipped / out for delivery / delivered /
   * cancelled) to the customer. Deduplicated per order+status.
   */
  async sendStatusUpdate(orderId: string, status: string) {
    try {
      const key = String(status || '').toLowerCase().replace(/\s+/g, '-');
      const mapping =
        STATUS_TEMPLATES[key] ||
        (key === 'out for delivery' ? STATUS_TEMPLATES['out-for-delivery'] : undefined);
      if (!mapping) return false;

      const order = await loadOrder(orderId);
      if (!order) return false;

      return await sendOnce({
        to: customerPhone(order),
        purpose: `status_${key}`,
        referenceId: `status_${key}:${order.id}`,
        template: mapping.template,
        params: mapping.params(order),
        fallbackText:
          key === 'delivered'
            ? `Your MeruVeda order ${order.order_number} has been delivered. We hope you enjoy it!`
            : `Update on your MeruVeda order ${order.order_number}: ${key.replace(/-/g, ' ')}.`,
        payload: { order_number: order.order_number, status: key },
      });
    } catch (err: any) {
      console.error('[OrderNotify] status update failed:', err?.message || err);
      return false;
    }
  },

  /** Manually resend the invoice (admin action / resend-invoice endpoint). */
  async resendInvoice(orderId: string): Promise<never> {
    throw new Error(
      'orderNotifyService.resendInvoice was removed — use invoiceDispatchService.resendInvoiceDispatch() instead.'
    );
  },
};

export { sendTemplate };
