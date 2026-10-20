import { Request, Response, NextFunction } from 'express';
import { payuService } from '../services/payuService';
import { orderService } from '../services/orderService';
import { postOrderConfirmed } from '../services/postOrderConfirmed';
import * as ordersRepo from '../database/repos/orders';
import * as transactionsRepo from '../database/repos/transactions';
import { config } from '../config/env';
import { keepAlive } from '../utils/keepAlive';

/**
 * Public base URL of this backend for PayU surl/furl.
 * Prefers BACKEND_URL when set; otherwise derives from the request host.
 * In production the scheme is forced to https (never localhost) so PayU
 * posts the customer's browser back over a secure connection â€” otherwise
 * browsers warn "the information you're about to submit is not secure"
 * and the success redirect can break.
 */
function publicBackendUrl(req: Request): string {
  const fromEnv = (process.env.BACKEND_URL || '').trim().replace(/\/+$/, '');
  const isProd = process.env.NODE_ENV === 'production';
  const asHttps = (url: string) => {
    if (isProd && url.startsWith('http://')) {
      const host = url.slice('http://'.length).split('/')[0];
      if (!host.startsWith('localhost') && host !== '127.0.0.1') {
        return `https://${url.slice('http://'.length)}`;
      }
    }
    return url;
  };
  if (fromEnv) return asHttps(fromEnv);
  const host = req.get('host') || '';
  const looksPublic = host && !host.startsWith('localhost') && host !== '127.0.0.1';
  const proto = isProd && looksPublic ? 'https' : req.protocol;
  return `${proto}://${host}`;
}

/**
 * Base URL of the storefront for post-payment redirects.
 * Falls back to the request host (same-domain Vercel deployment serves
 * frontend + /api from one origin) when FRONTEND_URL is still localhost.
 */
function storefrontBaseUrl(req: Request): string {
  const configured = config.frontendUrl;
  const host = req.get('host') || '';
  const looksPublic = host && !host.startsWith('localhost') && host !== '127.0.0.1';
  const isLocalDefault = configured.includes('localhost') || configured.includes('127.0.0.1');
  if (isLocalDefault && looksPublic) {
    const proto = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
    return `${proto}://${host}`;
  }
  return configured;
}

export const initiatePayUPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { checkoutPayload } = req.body;
    if (!checkoutPayload) {
      return res.status(400).json({ error: { message: 'Missing checkout order payload' } });
    }

    // Force payment method to PayOnline / PayU
    checkoutPayload.payment_method = 'PayOnline (via PayU)';
    
    // Create order in DB with status pending_payment
    const order = await orderService.createOrder(checkoutPayload, req.user?.id);
    
    // Explicitly ensure status is 'pending_payment'
    await ordersRepo.updateOrderById(order.id, { status: 'pending_payment' });

    const firstItem = checkoutPayload.items?.[0]?.name || 'MeruVeda Order';
    const productInfo = checkoutPayload.items?.length > 1 
      ? `${firstItem} + ${checkoutPayload.items.length - 1} more items` 
      : firstItem;

    const shippingAddress = order.shipping_address || {};
    const firstName = shippingAddress.fullName 
      ? shippingAddress.fullName.split(' ')[0] 
      : 'Customer';

    const backendUrl = publicBackendUrl(req);
    console.log(`[PayU] initiate order ${order.order_number}: surl/furl host=${backendUrl}/api/payu/callback`);

    const payuParams = payuService.buildCheckoutParams({
      orderNumber: order.order_number,
      amount: Number(order.total),
      productInfo,
      firstName,
      email: checkoutPayload.customerEmail || checkoutPayload.email || req.user?.email || 'customer@meruveda.com',
      phone: shippingAddress.phone || checkoutPayload.customerPhone || checkoutPayload.phone || '9999999999',
      backendUrl
    });

    res.json({
      data: {
        orderId: order.id,
        orderNumber: order.order_number,
        payuParams
      }
    });
  } catch (error) {
    next(error);
  }
};

export const handlePayUCallback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = req.body;
    console.log('[PayU Callback] Received payload:', payload);

    const isValidHash = payuService.verifyResponseHash(payload);
    const orderNumber = payload.txnid;
    const status = payload.status;
    const mihpayid = payload.mihpayid || payload.payuMoneyId || '';

    // Look up order by order_number
    const order = await ordersRepo.getOrderRowByNumber(orderNumber);

    if (!order) {
      console.error('[PayU Callback] Order not found for txnid:', orderNumber);
      // The laptop browser POSTs here and follows redirects â€” a raw 404 JSON
      // page is the "unexpected page" customers reported. Always redirect to
      // the failed page so the browser lands somewhere meaningful.
      return res.redirect(
        `${storefrontBaseUrl(req)}/checkout/failed?reason=${encodeURIComponent('We could not find your order. Please check your order history or contact support.')}`
      );
    }

    // Idempotency: PayU may POST the browser callback more than once (retry /
    // double-submit). If the order is already confirmed paid, don't re-run
    // side effects â€” just send the browser to the success page.
    if (status === 'success' && order.payment_status === 'paid' && order.status === 'processing') {
      console.log(`[PayU] duplicate success callback for already-paid order ${orderNumber}, redirecting to success page`);
      return res.redirect(`${storefrontBaseUrl(req)}/checkout/success/${order.id}`);
    }

    const upsertTransaction = async (txStatus: 'success' | 'failed', detailedStatus: 'captured' | 'failed' | 'hash_mismatch' | 'amount_mismatch', gatewayRef?: string, extraMeta?: Record<string, unknown>) => {
      try {
        const existingTx = await transactionsRepo.findByOrderId(order.id);

        const txData = {
          user_id: order.user_id,
          order_id: order.id,
          amount: order.total,
          currency: 'INR',
          status: txStatus,
          payment_method: 'PayOnline (via PayU)',
          gateway_transaction_id: gatewayRef || mihpayid || orderNumber || null,
          metadata: {
            detailed_status: detailedStatus,
            gateway_mode: payload.mode || null,
            expected_amount: Number(order.total),
            charged_amount: payload.amount !== undefined ? Number(payload.amount) : null,
            updated_at: new Date().toISOString(),
            ...(extraMeta || {}),
          }
        };

        if (existingTx) {
          await transactionsRepo.updateTransaction(existingTx.id, txData);
        } else {
          await transactionsRepo.insertTransaction(txData);
        }
      } catch (txErr) {
        console.error('[PayU Callback] Failed to write transaction log:', txErr);
      }
    };

    if (!isValidHash) {
      console.error('[PayU Callback] Hash mismatch! Potential spoofing attempt.');
      await ordersRepo.updateOrderById(order.id, {
        status: 'payment_failed',
        notes: `${order.notes || ''} [PayU Error: Hash Verification Failed]`.trim()
      });

      await upsertTransaction('failed', 'hash_mismatch');

      console.log(`[PayU] hash mismatch for order ${orderNumber}, redirecting to failed page`);
      return res.redirect(`${storefrontBaseUrl(req)}/checkout/failed?order_id=${order.id}&reason=${encodeURIComponent('Payment response verification failed (Hash Mismatch).')}`);
    }

    if (status === 'success') {
      // Amount check: never mark paid when PayU charged something different.
      const charged = payload.amount !== undefined ? Number(payload.amount) : NaN;
      const expected = Number(order.total);
      if (!Number.isFinite(charged) || charged.toFixed(2) !== expected.toFixed(2)) {
        console.error(`[PayU Callback] Amount mismatch for ${orderNumber}: charged=${payload.amount} expected=${order.total}`);
        await ordersRepo.updateOrderById(order.id, {
          status: 'payment_failed',
          notes: `${order.notes || ''} [PayU Error: Amount mismatch charged=${payload.amount} expected=${order.total}]`.trim()
        });

        await upsertTransaction('failed', 'amount_mismatch');

        return res.redirect(`${storefrontBaseUrl(req)}/checkout/failed?order_id=${order.id}&reason=${encodeURIComponent('Payment amount mismatch. Please contact support if money was deducted.')}`);
      }

      // Mark as paid / processing. The PayU reference is recorded in the notes
      // marker, which is the only place it is stored — the invoice reads it back
      // from there rather than depending on a dedicated column.
      //
      // The WHERE clause makes this the idempotency point: exactly one callback
      // wins, every later duplicate stops here and never re-runs side effects
      // (transaction log, Shiprocket push).
      const paidNow = await ordersRepo.markOrderPaidIfUnpaid(
        order.id,
        `${order.notes || ''} [PayU mihpayid: ${mihpayid}]`.trim(),
      );

      if (!paidNow) {
        console.log(`[PayU] duplicate success callback for ${orderNumber}; skipping side effects`);
        return res.redirect(`${storefrontBaseUrl(req)}/checkout/success/${order.id}`);
      }

      await upsertTransaction('success', 'captured');

      // Redirect the customer FIRST. Shiprocket push runs afterwards in the
      // background â€” awaiting it here used to stall the browser for up to ~30s
      // and invited PayU callback retries.
      //
      // This callback does NOT issue an invoice. The invoice was already issued
      // at order creation, for every order, COD and prepaid alike; all this
      // callback does is record the payment. So there is nothing here that could
      // produce a second tax document for one order.
      const successUrl = `${storefrontBaseUrl(req)}/checkout/success/${order.id}`;
      console.log(`[PayU] payment verified for order ${orderNumber}, redirecting to ${successUrl}`);
      res.redirect(successUrl);

      // Post-confirmation background work: the Shiprocket push. The redirect
      // above has already been sent, so this cannot delay the customer â€” but it
      // MUST be registered with waitUntil() via keepAlive(), otherwise Vercel
      // tears the invocation down when the response flushes.
      keepAlive(postOrderConfirmed(order.id, { source: 'payu_success', invoice: false }));
      return;
    } else {
      // Payment failed or cancelled
      await ordersRepo.updateOrderById(order.id, {
        status: 'payment_failed',
        notes: `${order.notes || ''} [PayU Status: ${status}, Error: ${payload.error_Message || 'User cancelled / transaction failed'}]`.trim()
      });

      await upsertTransaction('failed', 'failed');

      console.log(`[PayU] payment ${status} for order ${orderNumber}, redirecting to failed page`);
      return res.redirect(`${storefrontBaseUrl(req)}/checkout/failed?order_id=${order.id}&reason=${encodeURIComponent(payload.error_Message || 'Payment was unsuccessful or cancelled.')}`);
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Verified payment-status endpoint (owner or admin only).
 * Powers laptop polling for QR/UPI payments completed on the customer's
 * phone: the laptop polls `GET /api/payu/status/:ref` until the server-side
 * verification (callback above) flips the order to paid â€” the browser never
 * trusts redirect parameters alone. Accepts the internal order id or the
 * public order number (PayU txnid).
 */
export const getPaymentStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ref = String(req.params.ref || '').trim();
    if (!ref) {
      return res.status(400).json({ error: { message: 'Order reference is required' } });
    }
    const safeRef = ref.replace(/[^A-Za-z0-9_-]/g, '');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(safeRef);

    const order = await ordersRepo.findPaymentStatus(safeRef, isUuid);
    if (!order) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    if (req.user?.role !== 'admin' && (order as any).user_id !== req.user?.id) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    const paid = (order as any).payment_status === 'paid' || (order as any).status === 'processing';
    const failed = ['payment_failed', 'failed', 'cancelled'].includes(String((order as any).status));
    res.json({
      data: {
        orderId: (order as any).id,
        orderNumber: (order as any).order_number,
        status: (order as any).status,
        payment_status: (order as any).payment_status,
        paymentMethod: (order as any).payment_method,
        total: (order as any).total,
        paid,
        failed,
        pending: !paid && !failed,
      },
    });
  } catch (error) {
    next(error);
  }
};
