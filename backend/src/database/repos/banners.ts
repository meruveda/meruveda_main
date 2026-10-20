import { query } from '../db';
import { insertRow, updateById, deleteById } from './sql';

export async function listBanners(activeOnly = false): Promise<any[]> {
  return query(
    `SELECT * FROM banners
      ${activeOnly ? 'WHERE is_active = true' : ''}
      ORDER BY display_order ASC`,
  );
}

export async function insertBanner(data: Record<string, any>): Promise<any> {
  return insertRow('banners', data);
}

export async function updateBanner(id: string, data: Record<string, any>): Promise<any | null> {
  return updateById('banners', id, data);
}

export async function deleteBanner(id: string): Promise<void> {
  await deleteById('banners', id);
}
