import { apiClient } from '../api/apiClient';
import axiosInstance from '../api/axiosInstance';
import { Order, PaginationParams } from '../types';

export type OrderListParams = PaginationParams & {
  status?: string;
  search?: string;
  paymentMethod?: string;
  includeItems?: string | boolean;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
};

// Map raw snake_case API response to camelCase Order interface
const mapOrder = (o: any): Order => ({
  id: o.id,
  orderNumber: o.order_number,
  customerId: o.user_id || 'guest',
  customerName: o.shipping_address?.fullName || o.billing_address?.fullName || o.users?.email?.split('@')[0] || o.user_email?.split('@')[0] || 'Unknown Customer',
  customerEmail: o.users?.email || o.user_email || 'No Email Provided',
  customerPhone: o.shipping_address?.phone || o.billing_address?.phone || 'No Phone',
  items: Array.isArray(o.order_items)
    ? o.order_items.map((item: any) => {
        const prod = item.products || {};
        const meta = prod.seo_metadata || prod.seoMetadata || {};
        return {
          id: item.id,
          productId: item.product_id,
          productName: item.product_name || prod.name || 'Unknown Product',
          thumbnail: prod.images?.[0]?.url || prod.thumbnail || '',
          sku: (item.sku && !/^\d+$/.test(item.sku))
            ? item.sku
            : (prod.sku && !/^\d+$/.test(prod.sku))
              ? prod.sku
              : (item.product_id ? `SKU-${item.product_id.substring(0, 8).toUpperCase()}` : ''),
          quantity: item.quantity || 1,
          mrp: prod.mrp || item.price,
          price: item.price,
          discount: prod.discount || 0,
          hsn: item.hsn || prod.hsn || meta.hsn || meta.hsn_code || meta.hsnCode || '',
          gst: Number(
            item.gst ?? item.gst_rate ?? prod.gst ?? prod.gst_rate ?? prod.gstRate ??
            meta.gst ?? meta.gst_rate ?? meta.gstRate ?? 5,
          ) || 5,
        };
      })
    : [],
  shippingAddress: {
    fullName: o.shipping_address?.fullName || o.users?.email?.split('@')[0] || o.user_email?.split('@')[0] || 'Unknown Customer',
    phone: o.shipping_address?.phone || '',
    addressLine1: o.shipping_address?.addressLine1 || o.shipping_address?.addressLine || '',
    addressLine2: o.shipping_address?.addressLine2 || '',
    city: o.shipping_address?.city || '',
    state: o.shipping_address?.state || '',
    pincode: o.shipping_address?.pincode || o.shipping_address?.zipCode || '',
    country: o.shipping_address?.country || 'India'
  },
  billingAddress: o.billing_address
    ? {
        fullName: o.billing_address.fullName || '',
        phone: o.billing_address.phone || '',
        addressLine1: o.billing_address.addressLine1 || o.billing_address.addressLine || '',
        addressLine2: o.billing_address.addressLine2 || '',
        city: o.billing_address.city || '',
        state: o.billing_address.state || '',
        pincode: o.billing_address.pincode || o.billing_address.zipCode || '',
        country: o.billing_address.country || 'India',
      }
    : null,
  subtotal: o.subtotal || 0,
  shippingCharge: o.shipping_fee !== undefined ? Number(o.shipping_fee) : (o.shipping_cost !== undefined ? Number(o.shipping_cost) : ((o.subtotal || 0) >= 1000 ? 0 : 50)),
  discount: o.discount || 0,
  tax: o.tax || 0,
  total: o.total !== undefined ? Number(o.total) : ((o.subtotal || 0) - (o.discount || 0) + (o.tax || 0) + ((o.subtotal || 0) >= 1000 ? 0 : 50)),
  paymentMethod: o.payment_method || 'Unknown',
  paymentStatus: o.payment_status || 'pending',
  paymentGatewayRef: o.payment_gateway_ref,
  status: o.status,
  trackingNumber: o.tracking_number,
  shiprocketOrderId: o.shiprocket_order_id,
  shipmentId: o.shipment_id,
  awbCode: o.awb_code,
  courierName: o.courier_name,
  trackingUrl: o.tracking_url,
  trackingStatus: o.tracking_status,
  pickupLocation: o.pickup_location,
  pickupStatus: o.pickup_status ?? null,
  shippingCost: o.shipping_cost,
  manifestUrl: o.manifest_url,
  labelUrl: o.label_url,
  lastTrackingSync: o.last_tracking_sync,
  notes: o.notes,
  // --- invoice ---
  // Invoice state lives in Storage (state.json), NOT in orders columns, so the
  // list view cannot know it. It falls back to "pending" here and the detail
  // page fills it in from GET /orders/:id/invoice/status.
  invoiceNumber: null,
  invoiceUrl: null,
  invoiceIssuedAt: null,
  invoiceSentAt: null,
  invoiceError: null,
  invoiceAttempts: 0,
  invoiceMaxAttempts: 5,
  invoiceWhatsappStatus: null,
  invoiceEmailStatus: null,
  invoiceStatus: 'pending' as const,
  shiprocketPushStatus: o.shiprocket_push_status ?? null,
  shiprocketPushError: o.shiprocket_push_error ?? null,
  shiprocketPushedAt: o.shiprocket_pushed_at ?? null,
  orderTrackingHistory: Array.isArray(o.order_tracking_history) ? o.order_tracking_history : [],
  createdAt: o.created_at || new Date().toISOString(),
  updatedAt: o.updated_at || new Date().toISOString()
});

/**
 * Invoice state is read from Storage, never from orders columns, so the list
 * view has nothing to derive. The detail page calls getInvoiceStatus() instead.
 */

export type ShiprocketPushBadge = 'pushed' | 'pushing' | 'failed' | 'pending'

/** Mirrors the backend push claim so the badge degrades gracefully. */
export const deriveShiprocketPushStatus = (o: any): ShiprocketPushBadge => {
  if (o?.shiprocket_order_id || o?.shiprocketPushStatus === 'pushed') return 'pushed'
  if (o?.shiprocketPushStatus === 'in_progress') return 'pushing'
  if (o?.shiprocket_push_error || o?.shiprocketPushStatus === 'failed') return 'failed'
  return 'pending'
}

/** Invoice status as returned by GET /orders/:id/invoice/status (Storage-backed). */
export interface InvoiceStatusResponse {
  invoiceNumber: string | null
  issuedAt: string | null
  invoiceUrl: string | null
  status: 'pending' | 'sent' | 'failed'
  sentAt: string | null
  error: string | null
  attempts: number
  whatsapp: string | null
  whatsappError: string | null
}

class OrderService {
  async getOrders(params?: OrderListParams): Promise<Order[]> {
    const data = await apiClient.get<any[]>('/orders', { params });
    return Array.isArray(data) ? data.map(mapOrder) : [];
  }

  /**
   * Walks every page so an Excel export is never silently capped at the
   * first page / limit. Mirrors customerService.getAllCustomers.
   */
  async getAllOrders(params?: Omit<OrderListParams, 'page' | 'limit'>): Promise<Order[]> {
    const limit = 200;
    const all: Order[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const response = await axiosInstance.get('/orders', {
        params: { page, limit, ...params },
      });
      const body = response.data || {};
      // Backend returns { data, total, page, limit, totalPages }; fall back to
      // a bare array for safety.
      const rows = Array.isArray(body) ? body : body.data || [];
      all.push(...rows.map(mapOrder));
      totalPages = body.totalPages || 1;
      if (rows.length === 0) break;
      page += 1;
    } while (page <= totalPages);

    return all;
  }

  async getOrderById(id: string): Promise<Order> {
    const data = await apiClient.get<any>(`/orders/${id}`);
    return mapOrder(data);
  }

  async updateOrderStatus(id: string, status: string): Promise<Order> {
    const data = await apiClient.patch<any>(`/orders/${id}/status`, { status });
    return mapOrder(data);
  }

  async updateTrackingNumber(id: string, trackingNumber: string): Promise<Order> {
    const data = await apiClient.patch<any>(`/orders/${id}/status`, { tracking_number: trackingNumber });
    return mapOrder(data);
  }

  async deleteOrder(id: string): Promise<void> {
    await apiClient.delete<any>(`/orders/${id}`);
  }

/**
   * Read-only invoice status, derived server-side from Storage.
   *
   * Never triggers a send. A missing state.json comes back as "pending" — the
   * order was placed and the invoice has not been issued yet, which is not an
   * error.
   */
  async getInvoiceStatus(id: string): Promise<InvoiceStatusResponse> {
    const res = await apiClient.get<any>(`/orders/${id}/invoice/status`);
    const d = res?.data?.data ?? {};
    return {
      invoiceNumber: d.invoiceNumber ?? null,
      issuedAt: d.issuedAt ?? null,
      invoiceUrl: d.invoiceUrl ?? null,
      status: d.status ?? 'pending',
      sentAt: d.sentAt ?? null,
      error: d.error ?? null,
      attempts: Number(d.attempts ?? 0),
      whatsapp: d.whatsapp ?? null,
      whatsappError: d.whatsappError ?? null,
    };
  }

  /**
   * Fetch the stored invoice PDF for one order (auth handled by axiosInstance).
   *
   * This is the same endpoint, and therefore the same file, that the customer
   * downloads and that was sent over WhatsApp. An issued invoice is never
   * re-rendered, so following this repeatedly cannot produce a second document.
   */
  async downloadInvoice(id: string, invoiceNumber?: string | null, orderNumber?: string | null): Promise<void> {
    const res = await axiosInstance.get(`/orders/${id}/invoice`, { responseType: 'blob' });
    const blob = res.data as Blob;
    const url = URL.createObjectURL(blob);
    // Filename mirrors the server's Content-Disposition: Invoice-<order#>.pdf
    const name = (orderNumber || invoiceNumber || id).replace(/[^A-Za-z0-9._-]+/g, '_');
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Invoice-${name}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

export const orderService = new OrderService();
export default orderService;
