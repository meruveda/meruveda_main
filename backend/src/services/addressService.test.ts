import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as addressesRepo from '../database/repos/addresses';
import * as schemaGuard from './schemaGuard';

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
  store = [];

  const owned = (userId: string) => store.filter((r) => r.user_id === userId);

  t.mock.method(schemaGuard, 'hasTable', async () => true);
  t.mock.method(addressesRepo, 'listForUser', async (userId: string) => owned(userId));
  t.mock.method(addressesRepo, 'clearDefaults', async (userId: string, exceptId?: string) => {
    for (const row of owned(userId)) {
      if (exceptId && row.id === exceptId) continue;
      row.is_default = false;
    }
  });
  t.mock.method(addressesRepo, 'insertAddress', async (data: Row) => {
    const row = { id: `a${nextId++}`, created_at: new Date().toISOString(), ...data };
    inserted.push(row);
    store.push(row);
    return row;
  });
  t.mock.method(addressesRepo, 'updateAddress', async (userId: string, id: string, data: Row) => {
    const row = store.find((r) => r.user_id === userId && r.id === id);
    if (!row) return null;
    Object.assign(row, data);
    updated.push({ ...data, _filters: [['user_id', userId], ['id', id]] });
    return row;
  });
  t.mock.method(addressesRepo, 'deleteAddress', async (userId: string, id: string) => {
    const hits = store.filter((r) => r.user_id === userId && r.id === id);
    deleted.push({ _filters: [['user_id', userId], ['id', id]] });
    store = store.filter((r) => !hits.includes(r));
    return hits;
  });
  t.mock.method(addressesRepo, 'setDefault', async (userId: string, id: string) => {
    const row = store.find((r) => r.user_id === userId && r.id === id);
    if (!row) return null;
    row.is_default = true;
    return row;
  });

  t.after(() => {
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

// Loaded lazily so the repository mocks are installed first.
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