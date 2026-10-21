import test from 'node:test';
import assert from 'node:assert/strict';

import { __setDbDriverForTests } from '../database/db';
import * as productsRepo from '../database/repos/products';
import { productService } from './productService';

/**
 * Admin "Save Product" (POST/PATCH /api/products) after the Neon migration.
 *
 * `products.images` and `products.seo_metadata` are the table's only jsonb
 * columns. Binding a raw JS array/object makes both drivers emit a Postgres
 * array literal ({"a","b"}), which Postgres rejects with
 * `invalid input syntax for type json` — every admin save was failing on it.
 *
 * Existing rows keep list-ish metadata (benefits, ingredients, warnings…) as
 * plain comma-separated strings, and the storefront splits on commas
 * (frontend ProductDetailClient.tsx), so the repo stores that same shape.
 */

const PRODUCT_ID = '9c974179-9c7a-433b-901c-441407a8505a';
const CDN_IMAGE = { id: 'img-0', url: 'https://cdn.example/products/liver-detox/0-1024.webp', alt: 'Liver Detox' };

function existingRow(): Record<string, any> {
  return {
    id: PRODUCT_ID,
    name: 'Liver Detox',
    slug: 'liver-detox',
    sku: 'MRV-LD-60',
    category_id: null,
    description: '<p>Support your liver</p>',
    price: 599,
    selling_price: 499,
    stock: 25,
    minimum_stock: 10,
    brand: 'MeruVeda',
    status: 'active',
    stock_status: 'in_stock',
    images: [CDN_IMAGE],
    seo_metadata: { benefits: 'Supports healthy liver function, Promotes healthy digestion' },
    categories: null,
    updated_at: new Date().toISOString(),
  };
}

type Call = { text: string; params: any[] };

function installDbCapture(t: any) {
  const calls: Call[] = [];
  __setDbDriverForTests({
    query: async (text: string, params: any[] = []) => {
      calls.push({ text, params });
      return [existingRow()];
    },
    transaction: async (fn: any) => fn(async () => []),
  });
  t.after(() => __setDbDriverForTests(null));
  return calls;
}

function lastUpdate(calls: Call[]): Call {
  const updates = calls.filter((call) => /^\s*update\s+"products"/i.test(call.text));
  assert.ok(updates.length, 'an UPDATE products statement was issued');
  return updates[updates.length - 1];
}

function boundJsonParam(call: Call, column: string): any {
  let raw: unknown;
  const setMatch = new RegExp(`"${column}" = \\$(\\d+)::jsonb`).exec(call.text);
  if (setMatch) {
    raw = call.params[Number(setMatch[1]) - 1];
  } else {
    // INSERT lists columns and placeholders positionally.
    const valuesMatch = /\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i.exec(call.text);
    assert.ok(valuesMatch, `could not read the column list from: ${call.text}`);
    const columns = valuesMatch[1].split(',').map((part) => part.trim().replace(/"/g, ''));
    const placeholders = valuesMatch[2].split(',').map((part) => part.trim());
    const index = columns.indexOf(column);
    assert.ok(index >= 0, `"${column}" is present in: ${call.text}`);
    assert.match(placeholders[index], new RegExp(`^\\$${index + 1}::jsonb$`), `"${column}" is bound with a ::jsonb cast`);
    raw = call.params[index];
  }
  assert.equal(typeof raw, 'string', `"${column}" is sent as JSON text, not a JS ${typeof raw}`);
  return JSON.parse(raw as string);
}

test('Save Product: empty warnings, array benefits and comma-text fields succeed in the existing row shape', async (t) => {
  const calls = installDbCapture(t);

  await productService.updateProduct(PRODUCT_ID, {
    name: 'Liver Detox',
    description: '<p>Updated description</p>',
    images: [CDN_IMAGE],
    // list-ish textarea fields arrive as arrays in some clients; the DB stores text
    benefits: ['Supports healthy liver function', 'Promotes healthy digestion'],
    // cleared field — must not become SQL NULL (the columns are NOT NULL)
    warnings: '',
    // multi-line / comma-separated admin text, stored as one string
    ingredients: 'Kutki (Picrorhiza kurroa), Punarnava\nGuduchi',
    dosage: 'Take 1 to 2 tablets twice daily with lukewarm water.',
  });

  const update = lastUpdate(calls);

  const images = boundJsonParam(update, 'images');
  assert.deepEqual(images, [CDN_IMAGE], 'images keep the [{id,url,alt}] array shape');

  const seo = boundJsonParam(update, 'seo_metadata');
  assert.equal(seo.benefits, 'Supports healthy liver function, Promotes healthy digestion');
  assert.equal(typeof seo.benefits, 'string', 'benefits is a comma-separated string, like existing rows');
  assert.equal(seo.warnings, '', 'empty warnings stay an empty string, not null');
  assert.equal(
    seo.ingredients,
    'Kutki (Picrorhiza kurroa), Punarnava\nGuduchi',
    'comma/newline text is stored verbatim, like existing rows',
  );
  assert.equal(seo.dosage, 'Take 1 to 2 tablets twice daily with lukewarm water.');
  assert.equal(seo.isFeatured, undefined, 'keys the admin did not send are not invented');
});

test('repo: a plain comma-separated images string becomes the [{id,url,alt}] array', async (t) => {
  const calls = installDbCapture(t);

  await productsRepo.updateProduct(PRODUCT_ID, {
    images: 'https://cdn.example/a.webp, https://cdn.example/b.webp\nhttps://cdn.example/c.webp',
  });

  assert.deepEqual(boundJsonParam(lastUpdate(calls), 'images'), [
    { id: 'img-0', url: 'https://cdn.example/a.webp', alt: '' },
    { id: 'img-1', url: 'https://cdn.example/b.webp', alt: '' },
    { id: 'img-2', url: 'https://cdn.example/c.webp', alt: '' },
  ]);
});

test('repo: "" and null json values fall back to the column defaults, undefined is left out', async (t) => {
  const calls = installDbCapture(t);

  await productsRepo.updateProduct(PRODUCT_ID, {
    images: '',
    seo_metadata: null,
    brand: 'MeruVeda Organics',
    hsn: undefined,
  });

  const update = lastUpdate(calls);
  assert.deepEqual(boundJsonParam(update, 'images'), [], 'images "" -> the [] default');
  assert.deepEqual(boundJsonParam(update, 'seo_metadata'), {}, 'seo_metadata null -> the {} default');
  assert.ok(!/"hsn"/.test(update.text), 'undefined columns are left out of the UPDATE');
  assert.ok(update.params.every((param) => param !== null), 'no column is ever bound as SQL NULL');
});

test('repo: create with a raw object/array serialises both jsonb columns', async (t) => {
  const calls = installDbCapture(t);

  await productsRepo.insertProduct({
    name: 'New Product',
    images: [{ url: 'https://cdn.example/new.webp' }],
    seo_metadata: { benefits: 'a, b', isFeatured: true },
  });

  const insert = calls.find((call) => /^\s*insert\s+into\s+"products"/i.test(call.text));
  assert.ok(insert, 'an INSERT INTO products statement was issued');
  assert.deepEqual(boundJsonParam(insert, 'images'), [{ id: 'img-0', url: 'https://cdn.example/new.webp', alt: '' }]);
  assert.deepEqual(boundJsonParam(insert, 'seo_metadata'), { benefits: 'a, b', isFeatured: true });
});

test('Save Product: a failing jsonb write names the exact column instead of a bare driver message', async (t) => {
  __setDbDriverForTests({
    query: async (text: string) => {
      if (/^\s*update\s+"products"/i.test(text)) {
        const err: any = new Error('invalid input syntax for type json');
        err.code = '22P02';
        throw err;
      }
      return [existingRow()];
    },
    transaction: async (fn: any) => fn(async () => []),
  });
  t.after(() => __setDbDriverForTests(null));

  await assert.rejects(
    () => productService.updateProduct(PRODUCT_ID, { images: [CDN_IMAGE], benefits: 'a, b' }),
    (err: any) => {
      assert.match(err.message, /invalid input syntax for type json/);
      assert.match(err.message, /images=/, 'the failing column is named in the error');
      assert.match(err.message, /seo_metadata=/);
      assert.equal(err.code, '22P02', 'the original driver error is preserved');
      return true;
    },
  );
});
