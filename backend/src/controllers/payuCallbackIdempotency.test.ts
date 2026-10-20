import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlePayUCallback } from './payuController';
import * as ordersRepo from '../database/repos/orders';
import * as transactionsRepo from '../database/repos/transactions';
import { payuService } from '../services/payuService';
import * as postOrderConfirmedModule from '../services/postOrderConfirmed';

/**
 * PayU may POST the browser callback more than once (retry, double-submit,
 * back-button). The confirmation must be idempotent: exactly one caller flips
 * the order to paid, and every duplicate short-circuits without re-running the
 * transaction log or the Shiprocket push.
 *
 * Everything is mocked — no gateway, no database, no live push.
 */

const ORDER = {
  id: 'order-uuid-1',
  order_number: 'MV-111111',
  user_id: 'user-1',
  total: 600,
  payment_status: 'pending',
  status: 'pending_payment',
  notes: '',
};

async function runCallback(orderState: Record<string, any>, counters: Record<string, number>) {
  const payload = {
    txnid: orderState.order_number,
    status: 'success',
    mihpayid: 'payu-ref-1',
    amount: Number(orderState.total).toFixed(2),
    mode: 'UPI',
  };
  const redirects: string[] = [];
  const req: any = {
    body: payload,
    protocol: 'http',
    get(name: string) {
      return name.toLowerCase() === 'host' ? 'localhost:4000' : undefined;
    },
  };

  // The success path redirects and then returns WITHOUT calling next(), so the
  // redirect itself is what tells us the handler finished.
  await new Promise<void>((resolve, reject) => {
    const res: any = {
      redirect(url: string) {
        redirects.push(url);
        resolve();
        return res;
      },
      status(code: number) {
        return {
          json: () => {
            resolve();
            return res;
          },
          end: () => {
            resolve();
            return res;
          },
        };
      },
      json: () => {
        resolve();
        return res;
      },
    };
    handlePayUCallback(req, res, (err?: any) => (err ? reject(err) : resolve()));
  });

  counters.calls = (counters.calls || 0) + 1;
  return redirects[redirects.length - 1];
}

test('duplicate PayU success callbacks confirm payment and push exactly once', async (t) => {
  const orderState = { ...ORDER };
  const counters: Record<string, number> = {};

  t.mock.method(payuService, 'verifyResponseHash', () => true);
  t.mock.method(ordersRepo, 'getOrderRowByNumber', async () => ({ ...orderState }));
  t.mock.method(ordersRepo, 'updateOrderById', async () => {
    counters.updateOrderById = (counters.updateOrderById || 0) + 1;
    return { ...orderState };
  });
  // Stands in for the conditional UPDATE ... AND payment_status <> 'paid'
  t.mock.method(ordersRepo, 'markOrderPaidIfUnpaid', async () => {
    if (orderState.payment_status === 'paid') return false;
    orderState.payment_status = 'paid';
    orderState.status = 'processing';
    counters.markedPaid = (counters.markedPaid || 0) + 1;
    return true;
  });
  t.mock.method(transactionsRepo, 'findByOrderId', async () => null);
  t.mock.method(transactionsRepo, 'insertTransaction', async (row: any) => {
    counters.txInserts = (counters.txInserts || 0) + 1;
    return row;
  });
  t.mock.method(postOrderConfirmedModule, 'postOrderConfirmed', async () => {
    counters.pushes = (counters.pushes || 0) + 1;
  });

  const first = await runCallback(orderState, counters);
  const second = await runCallback(orderState, counters);
  const third = await runCallback(orderState, counters);

  assert.match(String(first), /\/checkout\/success\/order-uuid-1$/);
  assert.match(String(second), /\/checkout\/success\/order-uuid-1$/);
  assert.match(String(third), /\/checkout\/success\/order-uuid-1$/);

  assert.equal(counters.markedPaid, 1, 'only the first callback wins the paid flip');
  assert.equal(counters.txInserts, 1, 'one transaction log');
  assert.equal(counters.pushes, 1, 'one Shiprocket/post-order push');
  assert.equal(counters.updateOrderById ?? 0, 0, 'no unguarded order UPDATE on the success path');
});

test('a hash mismatch never marks the order paid', async (t) => {
  const orderState = { ...ORDER };
  const counters: Record<string, number> = {};

  t.mock.method(payuService, 'verifyResponseHash', () => false);
  t.mock.method(ordersRepo, 'getOrderRowByNumber', async () => ({ ...orderState }));
  t.mock.method(ordersRepo, 'updateOrderById', async (_id: string, patch: any) => {
    counters.updateOrderById = (counters.updateOrderById || 0) + 1;
    Object.assign(orderState, patch);
    return { ...orderState };
  });
  t.mock.method(ordersRepo, 'markOrderPaidIfUnpaid', async () => {
    counters.markedPaid = (counters.markedPaid || 0) + 1;
    return true;
  });
  t.mock.method(transactionsRepo, 'findByOrderId', async () => null);
  t.mock.method(transactionsRepo, 'insertTransaction', async (row: any) => {
    counters.txInserts = (counters.txInserts || 0) + 1;
    return row;
  });
  t.mock.method(postOrderConfirmedModule, 'postOrderConfirmed', async () => {
    counters.pushes = (counters.pushes || 0) + 1;
  });

  const redirect = await runCallback(orderState, counters);

  assert.match(String(redirect), /\/checkout\/failed/);
  assert.equal(counters.markedPaid, undefined, 'poisoned callback must not confirm payment');
  assert.equal(counters.pushes, undefined, 'no push on a failed verification');
  assert.equal(orderState.payment_status, 'pending');
  assert.equal(orderState.status, 'payment_failed');
});
