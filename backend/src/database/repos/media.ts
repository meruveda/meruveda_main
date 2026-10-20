import { query } from '../db';
import { insertRow, inClause } from './sql';

export async function insertMedia(data: Record<string, any>): Promise<any> {
  return insertRow('media', data);
}

export async function listMedia(opts: { folder?: string; search?: string }): Promise<any[]> {
  const clauses: string[] = [];
  const params: any[] = [];

  if (opts.folder) {
    params.push(opts.folder);
    clauses.push(`bucket = $${params.length}`);
  }
  if (opts.search) {
    params.push(`%${opts.search}%`);
    clauses.push(`filename ILIKE $${params.length}`);
  }

  return query(
    `SELECT * FROM media
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY created_at DESC`,
    params,
  );
}

export async function getMediaById(id: string): Promise<any | null> {
  const rows = await query('SELECT storage_path, bucket FROM media WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function deleteMediaById(id: string): Promise<void> {
  await query('DELETE FROM media WHERE id = $1', [id]);
}

export async function findMediaByUrls(urls: string[]): Promise<any[]> {
  if (urls.length === 0) return [];
  return query(
    `SELECT id, storage_path, bucket FROM media WHERE public_url IN ${inClause(urls.length)}`,
    urls,
  );
}

export async function deleteMediaByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await query(`DELETE FROM media WHERE id IN ${inClause(ids.length)}`, ids);
}
