import { query } from '../db';
import { insertRow, updateById, deleteById } from './sql';

export async function listCoupons(): Promise<any[]> {
  return query('SELECT * FROM coupons');
}

export async function findByCode(code: string): Promise<any | null> {
  const rows = await query('SELECT * FROM coupons WHERE code = $1 LIMIT 1', [code]);
  return rows[0] ?? null;
}

export async function insertCoupon(data: Record<string, any>): Promise<any> {
  return insertRow('coupons', data);
}

export async function updateCoupon(id: string, data: Record<string, any>): Promise<any | null> {
  return updateById('coupons', id, data);
}

export async function deleteCoupon(id: string): Promise<void> {
  await deleteById('coupons', id);
}
