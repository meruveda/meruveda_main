import { config } from '../config/env';
import { supabase } from '../database/supabase';
import { hasColumn, hasTable } from './schemaGuard';
import { WHATSAPP_TEMPLATES, sendOnce, normalizePhone } from './whatsappService';

const REVIEW_DELAY_DAYS = 7;
const BATCH_SIZE = 50;

/**
 * 7-day post-delivery review request job.
 *
 * A row is inserted into `review_requests` (UNIQUE on order_id) before/at send
 * time, so the same order can never be queued or messaged twice.
 */
export const reviewJobService = {
  delayDays: REVIEW_DELAY_DAYS,

  async process(): Promise<{ scanned: number; sent: number; skipped: number; failed: number }> {
    // The job depends on delta 005 (`review_requests`) and delta 006
    // (`orders.delivered_at`). Neither can be created by the app itself, so the
    // scheduled run reports a clean no-op until they are applied.
    const [hasDeliveryDate, hasClaimsTable] = await Promise.all([
      hasColumn('orders', 'delivered_at'),
      hasTable('review_requests'),
    ]);
    if (!hasDeliveryDate || !hasClaimsTable) {
      console.warn(
        '[ReviewJob] Skipped — pending migrations:' +
          `${hasDeliveryDate ? '' : ' orders.delivered_at (deltas/006)'}` +
          `${hasClaimsTable ? '' : ' review_requests (deltas/005)'}`
      );
      return { scanned: 0, sent: 0, skipped: 0, failed: 0 };
    }

    const cutoff = new Date(Date.now() - REVIEW_DELAY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, order_number, user_id, delivered_at, shipping_address, order_items(id, product_id, product_name)')
      .eq('status', 'delivered')
      .lte('delivered_at', cutoff)
      .order('delivered_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw error;

    const stats = { scanned: 0, sent: 0, skipped: 0, failed: 0 };
    for (const order of orders || []) {
      stats.scanned += 1;
      try {
        // Claim the order first => UNIQUE(order_id) makes this race-safe.
        const { data: claim, error: claimErr } = await supabase
          .from('review_requests')
          .upsert(
            { order_id: order.id, user_id: order.user_id, product_id: order.order_items?.[0]?.product_id || null, status: 'queued' },
            { onConflict: 'order_id', ignoreDuplicates: true }
          )
          .select('id')
          .maybeSingle();

        if (claimErr) throw claimErr;
        if (!claim) {
          // Already handled previously — never send a duplicate.
          stats.skipped += 1;
          continue;
        }

        const phone = normalizePhone(order.shipping_address?.phone);
        if (!phone) {
          await this.mark(claim.id, 'skipped', 'No WhatsApp number on the order');
          stats.skipped += 1;
          continue;
        }

        const { data: userRow } = order.user_id
          ? await supabase.from('users').select('first_name').eq('id', order.user_id).maybeSingle()
          : { data: null as any };
        const name = userRow?.first_name || order.shipping_address?.fullName?.split(' ')[0] || 'there';
        const item = order.order_items?.[0];
        const productName = item?.product_name || 'your recent order';
        const link = item?.product_id ? `${config.frontendUrl}/products/${item.product_id}` : config.frontendUrl;

        const delivered = await sendOnce({
          to: phone,
          purpose: 'review_request',
          referenceId: `review_request:${order.id}`,
          template: WHATSAPP_TEMPLATES.REVIEW_REQUEST,
          params: [name, order.order_number, productName, link],
          fallbackText: `Hi ${name}, hope you're loving your MeruVeda order ${order.order_number} (${productName})! It's been a week since delivery — would you mind sharing a quick review? ${link}`,
          payload: { order_number: order.order_number },
        });

        if (delivered) {
          await this.mark(claim.id, 'sent', undefined, new Date().toISOString());
          stats.sent += 1;
        } else {
          await this.mark(claim.id, 'failed', 'WhatsApp delivery failed');
          stats.failed += 1;
        }
      } catch (err: any) {
        console.error('[ReviewJob] Failed for order', order.order_number, err?.message || err);
        stats.failed += 1;
      }
    }
    return stats;
  },

  async mark(id: string, status: string, errorText?: string, sentAt?: string) {
    try {
      await supabase
        .from('review_requests')
        .update({
          status,
          error: errorText || null,
          sent_at: sentAt || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
    } catch (err: any) {
      console.error('[ReviewJob] Failed to update review_request row:', err?.message || err);
    }
  },
};
