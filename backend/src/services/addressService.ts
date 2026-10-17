import { supabase } from '../database/supabase';
import { hasTable } from './schemaGuard';

/**
 * Customer address book, stored in `user_addresses`.
 *
 * The table already exists in the database with this shape (verified against the
 * live schema, not assumed):
 *   id, user_id, title, first_name, last_name, phone, street_address, apartment,
 *   city, state, postal_code, country, is_default, created_at, updated_at
 *
 * Every method is scoped to a single userId. There is no code path that reads or
 * writes another customer's rows.
 */

const TABLE = 'user_addresses';
const DEFAULT_COUNTRY = 'India';

export interface UserAddress {
  id: string;
  user_id: string;
  title?: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  street_address: string;
  apartment?: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Raised when the address book is not usable, so callers can degrade cleanly. */
export class AddressBookUnavailable extends Error {
  readonly status = 503;
}

async function assertAvailable(): Promise<void> {
  if (await hasTable(TABLE)) return;
  throw new AddressBookUnavailable('The address book is unavailable right now.');
}

/**
 * Canonical form used ONLY for comparing two addresses.
 *
 * Case, surrounding whitespace and inner runs of spaces are collapsed, and the
 * postal code is reduced to digits, so "Bengaluru" and " bengaluru " are the same
 * place. Nothing here is shown to a user — the stored row keeps what the
 * customer typed.
 */
function fingerprint(a: Partial<UserAddress>): string {
  const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return [
    norm(a.first_name),
    norm(a.last_name),
    norm(a.street_address),
    norm(a.apartment),
    norm(a.city),
    norm(a.state),
    norm(a.postal_code).replace(/\D/g, ''),
    norm(a.phone).replace(/\D/g, '').slice(-10),
  ].join('|');
}

function clean(v: unknown): string {
  return String(v ?? '').trim();
}

/**
 * Normalise an incoming address, rejecting the required fields.
 * Returns a DB-shaped row so callers cannot accidentally write the wrong keys.
 */
function normalize(input: any): Omit<UserAddress, 'id' | 'user_id' | 'created_at' | 'updated_at'> {
  const first = clean(input.firstName ?? input.first_name);
  const last = clean(input.lastName ?? input.last_name);
  const street = clean(input.streetAddress ?? input.street_address);
  const city = clean(input.city);
  const state = clean(input.state);
  const postal = clean(input.postalCode ?? input.postal_code);
  const phone = clean(input.phone).replace(/\D/g, '').slice(-10);

  const missing: string[] = [];
  if (!first) missing.push('first name');
  if (!street) missing.push('street address');
  if (!city) missing.push('city');
  if (!state) missing.push('state');
  if (!/^\d{6}$/.test(postal)) missing.push('a 6-digit pincode');
  if (!/^[6-9]\d{9}$/.test(phone)) missing.push('a valid 10-digit phone');
  if (missing.length) throw Object.assign(new Error(`Missing or invalid: ${missing.join(', ')}`), { status: 400 });

  return {
    title: clean(input.title) || null,
    first_name: first,
    last_name: last,
    phone,
    street_address: street,
    apartment: clean(input.apartment) || null,
    city,
    state,
    postal_code: postal,
    country: clean(input.country) || DEFAULT_COUNTRY,
    is_default: Boolean(input.isDefault ?? input.is_default),
  };
}

async function listFor(userId: string): Promise<UserAddress[]> {
  await assertAvailable();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as UserAddress[];
}

/**
 * Clear the default flag across the book, optionally sparing one row.
 * Non-fatal: the subsequent write still lands with the correct flag.
 */
async function clearDefaults(userId: string, exceptId?: string): Promise<void> {
  let q = supabase.from(TABLE).update({ is_default: false }).eq('user_id', userId);
  if (exceptId) q = q.neq('id', exceptId);
  const { error } = await q;
  if (error) console.error('[addresses] could not clear existing defaults:', error.message);
}

export const addressService = {
  async list(userId: string): Promise<UserAddress[]> {
    return listFor(userId);
  },

  async get(userId: string, id: string): Promise<UserAddress | null> {
    const all = await listFor(userId);
    return all.find((a) => a.id === id) || null;
  },

  /**
   * Insert, or return the existing row when the same address is already saved.
   *
   * Placing a second order to an address already in the book must not create a
   * duplicate. The comparison is on the canonical fingerprint, so re-ordering to
   * "  bengaluru " does not slip past it.
   */
  async create(userId: string, input: any): Promise<{ address: UserAddress; created: boolean }> {
    const row = normalize(input);
    const existing = await listFor(userId);
    const match = existing.find((a) => fingerprint(a) === fingerprint(row));
    if (match) return { address: match, created: false };

    // First address is the default; otherwise honour the request.
    const isDefault = row.is_default || existing.length === 0;
    if (isDefault) await clearDefaults(userId);

    const { data, error } = await supabase
      .from(TABLE)
      .insert({ ...row, is_default: isDefault, user_id: userId })
      .select('*')
      .single();
    if (error) throw error;
    return { address: data as UserAddress, created: true };
  },

  async update(userId: string, id: string, input: any): Promise<UserAddress | null> {
    await assertAvailable();
    const current = await this.get(userId, id);
    if (!current) return null;

    const row = normalize({ ...current, ...input });
    if (row.is_default) await clearDefaults(userId, id);

    const { data, error } = await supabase
      .from(TABLE)
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId) // never update another user's row
      .select('*')
      .single();
    if (error) throw error;
    return data as UserAddress;
  },

  async remove(userId: string, id: string): Promise<boolean> {
    await assertAvailable();
    const { error } = await supabase.from(TABLE).delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;

    // Never leave a customer with no default address.
    const rest = await listFor(userId);
    if (rest.length && !rest.some((a) => a.is_default)) {
      await supabase.from(TABLE).update({ is_default: true }).eq('id', rest[0].id).eq('user_id', userId);
    }
    return true;
  },

  async setDefault(userId: string, id: string): Promise<UserAddress | null> {
    await assertAvailable();
    const current = await this.get(userId, id);
    if (!current) return null;
    await clearDefaults(userId);
    const { data, error } = await supabase
      .from(TABLE)
      .update({ is_default: true })
      .eq('id', id)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (error) throw error;
    return data as UserAddress;
  },


  /**
   * Save the address an order was just placed to.
   *
   * Called after the order row exists. Never throws: failing to file an address
   * must not fail an order that has already been accepted and charged.
   */
  async captureFromOrder(userId: string | undefined, shipping: any): Promise<void> {
    if (!userId || !shipping) return;
    try {
      const { created } = await this.create(userId, {
        title: shipping.title ?? 'Shipping address',
        firstName: shipping.fullName,
        lastName: '',
        phone: shipping.phone,
        streetAddress: [shipping.addressLine, shipping.landmark].filter(Boolean).join(', '),
        apartment: null,
        city: shipping.city,
        state: shipping.state,
        postalCode: shipping.zipCode,
        country: 'India',
        // Never promote a duplicate to default: it is already in the book.
        isDefault: false,
      });
      if (!created) console.log(`[addresses] order address already saved for user ${userId} — not duplicated`);
    } catch (err: any) {
      console.error('[addresses] could not save the order address (order unaffected):', err?.message || err);
    }
  },
};