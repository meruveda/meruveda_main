import test from 'node:test';
import assert from 'node:assert/strict';

import { __setDbDriverForTests } from '../database/db';
import { productService } from './productService';
import { getReviews, createReview } from '../controllers/reviewsController';
import { addToCart } from '../controllers/cartController';
import { toggleWishlist } from '../controllers/wishlistController';

/**
 * The storefront links products by slug (/products/liver-detox); the admin
 * links by uuid. After the Neon migration both hit `WHERE p.id = $1`, so a
 * slug became `NeonDbError: invalid input syntax for type uuid` — a 500 on
 * every product page. The lookup now branches on the shape of the value, and
 * every other table that keys on reviews/cart/wishlist product_id resolves
 * slug -> uuid the same way.
 */

const PRODUCT_UUID = '60862703-c4d8-45ee-9ecf-46d9417415fd';
const PRODUCT_SLUG = 'liver-detox';

function productRow(slug = PRODUCT_SLUG) {
  return {
    id: PRODUCT_UUID,
    name: 'Liver Detox',
    slug,
    sku: 'MRV-LD-60',
    description: '<p>Support your liver</p>',
    price: 599,
    selling_price: 499,
    stock: 25,
    status: 'active',
    stock_status: 'in_stock',
    images: [],
    seo_metadata: {},
    categories: null,
  };
}

type Call = { text: string; params: any[] };

function installDriver(t: any, handler: (text: string, params: any[]) => any[]) {
  const calls: Call[] = [];
  __setDbDriverForTests({
    query: async (text: string, params: any[] = []) => {
      calls.push({ text, params });
      return handler(text, params);
    },
    transaction: async (fn: any) => fn(async () => []),
  });
  t.after(() => __setDbDriverForTests(null));
  return calls;
}

function fakeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    json(payload: any) {
      res.body = payload;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    send() {
      return res;
    },
  };
  return res;
}

const failNext = (err: any) => {
  throw err;
};

// ---------------------------------------------------------------------------
// GET product: slug, uuid, unknown slug
// ---------------------------------------------------------------------------

test('product by slug matches p.slug — a slug is never bound to the uuid id column', async (t) => {
  const calls = installDriver(t, () => [productRow()]);

  const product = await productService.getProductById(PRODUCT_SLUG);

  const lookup = calls.find((call) => /FROM\s+products\s+p/i.test(call.text));
  assert.ok(lookup, 'a products lookup was issued');
  assert.match(lookup.text, /WHERE\s+p\.slug\s*=\s*\$1/, 'lookup matches on slug');
  assert.ok(!/p\.id\s*=\s*\$1/.test(lookup.text), 'the uuid id column is not compared against a slug');
  assert.deepEqual(lookup.params, [PRODUCT_SLUG]);
  assert.equal(product?.slug, PRODUCT_SLUG);
});

test('product by uuid still matches p.id', async (t) => {
  const calls = installDriver(t, () => [productRow()]);

  const product = await productService.getProductById(PRODUCT_UUID);

  const lookup = calls.find((call) => /FROM\s+products\s+p/i.test(call.text))!;
  assert.match(lookup.text, /WHERE\s+p\.id\s*=\s*\$1/);
  assert.ok(!/p\.slug\s*=\s*\$1/.test(lookup.text), 'a uuid is not matched against the slug column');
  assert.equal(product?.id, PRODUCT_UUID);
});

test('unknown slug is a 404, not a 500', async (t) => {
  installDriver(t, () => []);

  await assert.rejects(
    () => productService.getProductById('does-not-exist'),
    (err: any) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

const ADMIN_REVIEW = {
  id: '11111111-2222-4333-8444-555555555555',
  product_id: PRODUCT_UUID,
  user_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  rating: 5,
  title: null,
  comment: 'Got this for my grandmother and she really liked it.',
  status: 'approved',
  created_at: '2026-09-08T18:47:27.773Z',
  users: { first_name: 'Harshit', last_name: 'Verma' },
  products: { id: PRODUCT_UUID, name: 'Liver Detox' },
};

test('GET /reviews?productId=<slug> resolves the slug, filters approved only, returns the review', async (t) => {
  const calls = installDriver(t, (text) => {
    if (/FROM\s+products\s+WHERE/i.test(text)) return [{ id: PRODUCT_UUID }];
    if (/COUNT\(\*\)/i.test(text)) return [{ count: '1' }];
    if (/FROM\s+reviews\s+r/i.test(text)) return [ADMIN_REVIEW];
    return [];
  });

  const req: any = { query: { productId: PRODUCT_SLUG }, headers: {} };
  const res = fakeRes();
  await getReviews(req, res, failNext);

  const reviewsCall = calls.find(
    (call) => /FROM\s+reviews\s+r/i.test(call.text) && !/COUNT\(\*\)/i.test(call.text),
  );
  assert.ok(reviewsCall, 'the reviews list query was issued');
  assert.ok(reviewsCall.params.includes(PRODUCT_UUID), 'the query is bound to the resolved uuid');
  assert.ok(!reviewsCall.params.includes(PRODUCT_SLUG), 'the slug never reaches the uuid comparison');
  assert.ok(reviewsCall.params.includes('approved'), 'a public caller always gets approved reviews');

  assert.equal(res.body.total, 1);
  assert.equal(res.body.data[0].comment, ADMIN_REVIEW.comment);
  assert.equal(res.body.data[0].rating, 5);
  assert.equal(res.body.data[0].users.first_name, 'Harshit');
});

test('GET /reviews for an unknown product is an empty list, not a uuid error', async (t) => {
  installDriver(t, () => []);

  const res = fakeRes();
  await getReviews({ query: { productId: 'no-such-product' }, headers: {} } as any, res, failNext);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { data: [], total: 0 });
});

test('POST /reviews: admin-created reviews default to approved, customer reviews to pending', async (t) => {
  const calls = installDriver(t, (text) => {
    if (/FROM\s+products\s+WHERE/i.test(text)) return [{ id: PRODUCT_UUID }];
    if (/INSERT\s+INTO\s+"reviews"/i.test(text)) return [{ ...ADMIN_REVIEW, status: 'approved' }];
    return [];
  });

  const res = fakeRes();
  await createReview(
    { body: { product_id: PRODUCT_SLUG, rating: 5, comment: 'Great' }, user: { id: 'admin-1', role: 'admin' } } as any,
    res,
    failNext,
  );

  const insert = calls.find((call) => /INSERT\s+INTO\s+"reviews"/i.test(call.text))!;
  const columns = insert.text.match(/\(([^)]*)\)\s*VALUES/)?.[1].split(',').map((c) => c.trim().replace(/"/g, '')) ?? [];
  const statusValue = insert.params[columns.indexOf('status')];
  const productValue = insert.params[columns.indexOf('product_id')];
  assert.equal(statusValue, 'approved', 'an admin review is published immediately');
  assert.equal(productValue, PRODUCT_UUID, 'the slug was resolved to the uuid before insert');

  const customerCalls = installDriver(t, (text) => {
    if (/FROM\s+products\s+WHERE/i.test(text)) return [{ id: PRODUCT_UUID }];
    if (/INSERT\s+INTO\s+"reviews"/i.test(text)) return [{ ...ADMIN_REVIEW, status: 'pending' }];
    return [];
  });
  const customerRes = fakeRes();
  await createReview(
    { body: { product_id: PRODUCT_UUID, rating: 4, comment: 'Nice' }, user: { id: 'customer-1', role: 'customer' } } as any,
    customerRes,
    failNext,
  );
  const customerInsert = customerCalls.find((call) => /INSERT\s+INTO\s+"reviews"/i.test(call.text))!;
  const customerColumns = customerInsert.text.match(/\(([^)]*)\)\s*VALUES/)?.[1].split(',').map((c) => c.trim().replace(/"/g, '')) ?? [];
  assert.equal(customerInsert.params[customerColumns.indexOf('status')], 'pending', 'a customer review still goes through moderation');
});

test('POST /reviews for an unknown product is a 404', async (t) => {
  installDriver(t, () => []);

  const res = fakeRes();
  await createReview(
    { body: { product_id: 'no-such-product', rating: 5, comment: 'x' }, user: { id: 'u1', role: 'customer' } } as any,
    res,
    failNext,
  );
  assert.equal(res.statusCode, 404);
});

// ---------------------------------------------------------------------------
// Cart and wishlist resolve slug -> uuid
// ---------------------------------------------------------------------------

test('add to cart with a slug stores the uuid; an unknown slug is a 404', async (t) => {
  const calls = installDriver(t, (text, params) => {
    if (/FROM\s+products\s+WHERE/i.test(text)) return params[0] === PRODUCT_SLUG ? [{ id: PRODUCT_UUID }] : [];
    if (/SELECT\s+id,\s+quantity\s+FROM\s+cart_items/i.test(text)) return [];
    if (/INSERT\s+INTO\s+"cart_items"/i.test(text)) return [{ id: 'cart-1', user_id: 'u1', product_id: PRODUCT_UUID, quantity: 1 }];
    return [];
  });

  const res = fakeRes();
  await addToCart({ user: { id: 'u1' }, body: { product_id: PRODUCT_SLUG, quantity: 1 } } as any, res, failNext);

  const insert = calls.find((call) => /INSERT\s+INTO\s+"cart_items"/i.test(call.text))!;
  assert.ok(insert.params.includes(PRODUCT_UUID), 'cart_items receives the uuid');
  assert.ok(!insert.params.includes(PRODUCT_SLUG), 'the slug never reaches the uuid column');
  assert.equal(res.statusCode, 200);

  installDriver(t, () => []);
  const missing = fakeRes();
  await addToCart({ user: { id: 'u1' }, body: { product_id: 'no-such-product', quantity: 1 } } as any, missing, failNext);
  assert.equal(missing.statusCode, 404);
});

test('wishlist toggle with a slug stores the uuid; an unknown slug is a 404', async (t) => {
  const calls = installDriver(t, (text, params) => {
    if (/FROM\s+products\s+WHERE/i.test(text)) return params[0] === PRODUCT_SLUG ? [{ id: PRODUCT_UUID }] : [];
    if (/FROM\s+wishlist_items/i.test(text)) return [];
    if (/INSERT\s+INTO\s+"wishlist_items"/i.test(text)) return [{ id: 'wish-1', user_id: 'u1', product_id: PRODUCT_UUID }];
    return [];
  });

  const res = fakeRes();
  await toggleWishlist({ user: { id: 'u1' }, body: { product_id: PRODUCT_SLUG } } as any, res, failNext);

  const insert = calls.find((call) => /INSERT\s+INTO\s+"wishlist_items"/i.test(call.text))!;
  assert.ok(insert.params.includes(PRODUCT_UUID));
  assert.ok(!insert.params.includes(PRODUCT_SLUG));

  installDriver(t, () => []);
  const missing = fakeRes();
  await toggleWishlist({ user: { id: 'u1' }, body: { product_id: 'no-such-product' } } as any, missing, failNext);
  assert.equal(missing.statusCode, 404);
});
