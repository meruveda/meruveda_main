import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ordersRepo from '../database/repos/orders';
import * as productsRepo from '../database/repos/products';
import * as transactionsRepo from '../database/repos/transactions';
import { addressService } from './addressService';
import { config } from '../config/env';
import { orderService } from './orderService';
import { generateToken } from '../utils/jwt';

/**
 * COD order creation, with the repository layer faked.
 *
 * What is worth pinning down here is the money: the client sends prices and a
 * total, and the service recomputes everything server-side. If that ever
 * regresses, a customer can pay less than the cart is worth.
 */

// ---------------------------------------------------------------------------
// Minimal repository fake: record the write each service method performs.
// ---------------------------------------------------------------------------
type Row = Record<string, any>;

function installSupabaseFake(
  t: any,
  opts: {
    products?: Row[];
    stock?: number;
  } = {}
) {
  const inserted: { table: string; rows: Row[] }[] = [];
  const updated: { table: string; rows: Row[] }[] = [];
  let stock = opts.stock ?? 10;

  t.mock.method(productsRepo, 'getProductsByIds', async () => opts.products ?? []);
  t.mock.method(productsRepo, 'decrementStock', async (_productId: string, quantity: number) => {
    stock = Math.max(0, stock - quantity);
    updated.push({ table: 'products', rows: [{ stock }] });
  });
  t.mock.method(ordersRepo, 'insertOrder', async (data: Row) => {
    const row = { id: 'order-1', user_id: 'user-1', ...data };
    inserted.push({ table: 'orders', rows: [row] });
    return row;
  });
  t.mock.method(ordersRepo, 'insertOrderItems', async (rows: Row[]) => {
    inserted.push({ table: 'order_items', rows });
  });
  t.mock.method(transactionsRepo, 'insertTransaction', async (row: Row) => {
    inserted.push({ table: 'transactions', rows: [row] });
    return row;
  });
  t.mock.method(addressService, 'captureFromOrder', async () => {});

  return { inserted, updated };
}

const basePayload = (overrides: Row = {}) => ({
  payment_method: 'Cash On Delivery',
  subtotal: 500,
  discount: 0,
  shipping_address: { addressLine1: '1 Test St', city: 'Pune', pincode: '411001' },
  items: [{ product_id: 'p1', name: 'Ashwagandha', price: 500, quantity: 1 }],
  ...overrides,
});

test('COD order: total = subtotal - discount + shipping (incl. COD handling)', async (t) => {
  const fake = installSupabaseFake(t, { products: [{ id: 'p1', name: 'Ashwagandha', sku: 'ASH-1' }] });

  const order = await orderService.createOrder(basePayload() as any, 'user-1');

  // Subtotal 500 is under the free-shipping threshold (1000) -> 50 shipping,
  // plus 50 COD handling.
  assert.equal(order.shipping_fee, 100);
  assert.equal(order.total, 600);
  assert.equal(order.status, 'pending');
  assert.match(order.order_number, /^MV-\d{6}$/);

  const orderRow = fake.inserted.find((i) => i.table === 'orders')!.rows[0];
  assert.equal(orderRow.total, 600);
  assert.equal(orderRow.shipping_fee, 100);
});

test('COD order: a client-sent total/shipping cannot underpay the order', async (t) => {
  installSupabaseFake(t, { products: [{ id: 'p1', name: 'Ashwagandha' }] });

  const order = await orderService.createOrder(
    basePayload({ total: 1, shipping_fee: 0, shipping_cost: 0 } as any),
    'user-1'
  );

  assert.equal(order.total, 600, 'server-side recomputation wins');
  assert.equal(order.shipping_fee, 100);
});

test('COD order under the free-shipping threshold above 1000 pays no shipping', async (t) => {
  installSupabaseFake(t, { products: [{ id: 'p1', name: 'Ashwagandha' }] });

  // 1200 subtotal -> shipping 0, COD handling 50.
  const order = await orderService.createOrder(
    basePayload({ subtotal: 1200, items: [{ product_id: 'p1', price: 1200, quantity: 1 }] } as any),
    'user-1'
  );

  assert.equal(order.shipping_fee, 50);
  assert.equal(order.total, 1250);
});

test('Prepaid order carries no COD handling fee', async (t) => {
  installSupabaseFake(t, { products: [{ id: 'p1', name: 'Ashwagandha' }] });

  const order = await orderService.createOrder(
    basePayload({ payment_method: 'PayU', subtotal: 1200 } as any),
    'user-1'
  );

  assert.equal(order.shipping_fee, 0);
  assert.equal(order.total, 1200);
});

test('GST is computed from the DB product rate, not from the payload', async (t) => {
  installSupabaseFake(t, {
    products: [{ id: 'p1', name: 'Ashwagandha', seo_metadata: { gst_rate: 18 } }],
  });

  const order = await orderService.createOrder(
    basePayload({ subtotal: 1180, items: [{ product_id: 'p1', price: 1180, quantity: 1 }] } as any),
    'user-1'
  );

  // GST inclusive of tax: 1180 * 18/118 = 180.
  assert.equal(order.tax, 180);
});

test('a product missing from the DB falls back to the 5% default rate', async (t) => {
  installSupabaseFake(t, { products: [] });

  const order = await orderService.createOrder(
    basePayload({ subtotal: 1050, items: [{ product_id: 'missing', price: 1050, quantity: 1 }] } as any),
    'user-1'
  );

  // 1050 * 5/105 = 50.
  assert.equal(order.tax, 50);
});

test('COD order writes a pending transaction and decrements stock', async (t) => {
  const fake = installSupabaseFake(t, {
    products: [{ id: 'p1', name: 'Ashwagandha' }],
    stock: 10,
  });

  await orderService.createOrder(basePayload() as any, 'user-1');

  const tx = fake.inserted.find((i) => i.table === 'transactions');
  assert.ok(tx, 'COD placement logs a transaction');
  assert.equal(tx!.rows[0].currency, 'INR');
  assert.equal(tx!.rows[0].status, 'pending');
  assert.equal(tx!.rows[0].amount, 600);

  const stockUpdate = fake.updated.find((u) => u.table === 'products');
  assert.equal(stockUpdate!.rows[0].stock, 9, 'stock 10 - qty 1');

  const items = fake.inserted.find((i) => i.table === 'order_items');
  assert.equal(items!.rows[0].product_name, 'Ashwagandha');
});

test('Prepaid order writes no transaction at placement (PayU logs on callback)', async (t) => {
  const fake = installSupabaseFake(t, { products: [{ id: 'p1', name: 'Ashwagandha' }] });

  await orderService.createOrder(basePayload({ payment_method: 'PayU', subtotal: 1200 } as any), 'user-1');

  assert.equal(fake.inserted.find((i) => i.table === 'transactions'), undefined);
});

test('billing_address falls back to shipping_address when omitted', async (t) => {
  const fake = installSupabaseFake(t, { products: [{ id: 'p1', name: 'Ashwagandha' }] });

  await orderService.createOrder(basePayload() as any, 'user-1');

  const orderRow = fake.inserted.find((i) => i.table === 'orders')!.rows[0];
  assert.deepEqual(orderRow.billing_address, orderRow.shipping_address);
});

test('the order is stamped with the authenticated user id', async (t) => {
  const fake = installSupabaseFake(t, { products: [{ id: 'p1', name: 'Ashwagandha' }] });

  const token = generateToken({ id: 'user-42', role: 'customer', email: 'c@example.com' });
  assert.ok(token);

  const order = await orderService.createOrder(basePayload() as any, 'user-42');
  assert.equal(order.user_id, 'user-42');
  // Sanity: shipping GST only applies when explicitly enabled.
  assert.equal(config.shippingIsTaxable, false);
});