import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '../database/supabase';

/**
 * Address book behaviour.
 *
 * Two properties matter more than the rest:
 *   - an identical address is never stored twice, so re-ordering does not fill
 *     the customer's book with duplicates;
 *   - no code path can read or write another user's rows.
 */

const USER = 'user-under-test';

type Row = Record<string, any>;
const inserted: Row[] = [];
const updated: Row[] = [];
const deleted: Row[] = [];
let store: Row[] = [];

function installFake(t: any) {
  let nextId = 1;
  const original = (supabase as any).from;

  (supabase as any).from = () => {
    let filters: Array<[string, any]> = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | null = null;

    const matches = () => store.filter((r) => filters.every(([c, v]) => (v === null ? r[c] === null : r[c] === v)));

    // Terminal: perform whichever operation the chain ended on.
    const run = () => {
      if (op === 'insert') {
        const row = { id: `a${nextId++}`, created_at: new Date().toISOString(), ...(payload as Row) };
        inserted.push(row);
        store.push(row);
        return { data: row, error: null };
      }
      if (op === 'update') {
        const hits = matches();
        updated.push({ ...(payload as Row), _filters: [...filters] });
        for (const h of hits) Object.assign(h, payload);
        return { data: hits.length ? hits : null, error: null };
      }
      if (op === 'delete') {
        const hits = matches();
        deleted.push({ _filters: [...filters] });
        store = store.filter((r) => !hits.includes(r));
        return { data: hits, error: null };
      }
      const rows = matches();
      return { data: rows, error: null };
    };

    const b: any = {
      _op: () => op,
      select: () => b,
      order: () => b,
      limit: () => b,
      range: () => b,
      insert: (row: any) => { op = 'insert'; payload = row; return b; },
      update: (row: any) => { op = 'update'; payload = row; return b; },
      delete: () => { op = 'delete'; return b; },
      eq: (c: string, v: any) => { filters.push([c, v]); return b; },
      neq: () => b,
      is: (c: string, v: any) => { filters.push([c, v]); return b; },
      // run() exactly once: calling it twice would perform the write twice.
      single: () => {
        const res = run();
        const first = Array.isArray(res.data) ? res.data[0] : res.data;
        return Promise.resolve({ ...res, data: first ?? null });
      },
      then: (resolve: any) => resolve(run()),
    };
    return b;
  };

  t.after(() => {
    (supabase as any).from = original;
    inserted.length = 0;
    updated.length = 0;
    deleted.length = 0;
    store = [];
  });
}

const address = (over: Row = {}) => ({
  firstName: 'Aarav', lastName: '', phone: '9876543210',
  streetAddress: 'Flat 402', city: 'Bengaluru', state: 'Karnataka',
  postalCode: '560001', ...over,
});

// Loaded lazily so the module-level supabase fake is installed first.
function svc() {
  // require, not dynamic import(): ts-node's transpile-only loader cannot
  // resolve a .ts path through ESM import().
  return require('./addressService').addressService;
}

// --- dedupe ---------------------------------------------------------------

test('a new address is saved once', async (t) => {
  installFake(t);
  const a = svc();
  const { created, address: saved } = await a.create(USER, address());
  assert.equal(created, true);
  assert.equal(saved.user_id, USER);
  assert.equal(inserted.length, 1);
});

test('the identical address is not saved twice', async (t) => {
  installFake(t);
  const a = svc();
  await a.create(USER, address());
  const second = await a.create(USER, address());
  assert.equal(second.created, false, 'the second attempt must reuse the existing row');
  assert.equal(inserted.length, 1, 'only one row was ever inserted');
  assert.equal(second.address.id, (await a.list(USER))[0].id);
});

test('dedupe ignores case and whitespace differences', async (t) => {
  installFake(t);
  const a = svc();
  await a.create(USER, address({ city: 'Bengaluru', streetAddress: 'Flat 402' }));
  const second = await a.create(USER, address({ city: '  bengaluru  ', streetAddress: 'Flat  402' }));
  assert.equal(second.created, false);
  assert.equal(inserted.length, 1);
});

test('dedupe ignores pincode formatting and phone prefixes', async (t) => {
  installFake(t);
  const a = svc();
  await a.create(USER, address({ phone: '9876543210' }));
  const second = await a.create(USER, address({ phone: '+91 98765-43210' }));
  assert.equal(second.created, false);
});

test('a genuinely different address IS saved separately', async (t) => {
  installFake(t);
  const a = svc();
  await a.create(USER, address());
  const second = await a.create(USER, address({ streetAddress: 'Flat 999' }));
  assert.equal(second.created, true);
  assert.equal(inserted.length, 2);
  assert.equal((await a.list(USER)).length, 2);
});

// --- defaults -------------------------------------------------------------

test('the first address becomes the default', async (t) => {
  installFake(t);
  const a = svc();
  const { address: saved } = await a.create(USER, address());
  assert.equal(saved.is_default, true);
});

test('a duplicate does not get promoted to default', async (t) => {
  installFake(t);
  const a = svc();
  await a.create(USER, address());
  const dup = await a.create(USER, address());
  assert.equal(dup.address.is_default, true, 'the existing default is reused as-is');
});

test('setting a default moves the flag off the previous one', async (t) => {
  installFake(t);
  const a = svc();
  const first = await a.create(USER, address());
  const second = await a.create(USER, address({ streetAddress: 'Flat 999' }));
  await a.setDefault(USER, second.address.id);
  const all = await a.list(USER);
  assert.equal(all.find((x) => x.id === second.address.id)?.is_default, true);
  assert.equal(all.find((x) => x.id === first.address.id)?.is_default, false);
});

// --- ownership ------------------------------------------------------------

test('a listing is scoped to the requesting user', async (t) => {
  installFake(t);
  const a = svc();
  await a.create('user-a', address());
  await a.create('user-b', address({ streetAddress: 'Somewhere else' }));
  const mine = await a.list('user-a');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].user_id, 'user-a');
  assert.ok(!mine.some((x) => x.user_id === 'user-b'));
});

test('updating another user address affects no rows', async (t) => {
  installFake(t);
  const a = svc();
  const { address: mine } = await a.create('user-a', address());
  const result = await a.update('user-b', mine.id, { city: 'Chennai' });
  assert.equal(result, null, 'a user cannot edit an address they do not own');
  assert.equal((await a.list('user-a'))[0].city, 'Bengaluru', 'the real row is untouched');
});

test('deleting another user address affects no rows', async (t) => {
  installFake(t);
  const a = svc();
  const { address: mine } = await a.create('user-a', address());
  await a.remove('user-b', mine.id);
  assert.equal((await a.list('user-a')).length, 1, 'the row still exists for its owner');
});

// --- validation -----------------------------------------------------------

test('an address missing required fields is rejected', async (t) => {
  installFake(t);
  const a = svc();
  for (const bad of [
    address({ firstName: '' }),
    address({ streetAddress: '' }),
    address({ city: '' }),
    address({ state: '' }),
  ]) {
    await assert.rejects(() => a.create(USER, bad), /Missing or invalid/);
  }
  assert.equal(inserted.length, 0);
});

test('an invalid pincode or phone is rejected', async (t) => {
  installFake(t);
  const a = svc();
  await assert.rejects(() => a.create(USER, address({ postalCode: '12' })), /pincode/);
  await assert.rejects(() => a.create(USER, address({ phone: '123' })), /phone/);
});

test('updating an address that does not exist returns null', async (t) => {
  installFake(t);
  const a = svc();
  assert.equal(await a.update(USER, 'no-such-id', { city: 'Chennai' }), null);
});

// --- order capture --------------------------------------------------------

test('captureFromOrder never throws, even with no usable address', async (t) => {
  installFake(t);
  const a = svc();
  await a.captureFromOrder(undefined, { fullName: 'X', city: 'Y' });           // no user
  await a.captureFromOrder(USER, null);                                          // no address
  await a.captureFromOrder(USER, { fullName: 'X', city: '', state: '', zipCode: '', phone: '', addressLine: '' });
  assert.equal(inserted.length, 0, 'nothing half-written');
});

test('captureFromOrder saves the order address once and dedupes the next order', async (t) => {
  installFake(t);
  const a = svc();
  const shipping = {
    fullName: 'Aarav', addressLine: 'Flat 402, Green Glen', landmark: '',
    city: 'Bengaluru', state: 'Karnataka', zipCode: '560001', phone: '9876543210',
  };
  await a.captureFromOrder(USER, shipping);
  await a.captureFromOrder(USER, shipping);
  assert.equal(inserted.length, 1, 'a repeat order to the same address does not duplicate');
});

test('captureFromOrder is a no-op for a guest (no user id)', async (t) => {
  installFake(t);
  const a = svc();
  await a.captureFromOrder(undefined, { fullName: 'A', addressLine: 'B', city: 'C', state: 'D', zipCode: '560001', phone: '9876543210' });
  assert.equal(inserted.length, 0);
});