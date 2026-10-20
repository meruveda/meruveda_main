import { query } from '../db';
import { insertRow, updateById, deleteById } from './sql';

const EMBEDS = `CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object(
  'first_name', u.first_name, 'last_name', u.last_name
) END AS users,
CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
  'id', p.id, 'name', p.name
) END AS products`;

export async function listReviews(filters: {
  productId?: string;
  status?: string;
}): Promise<{ rows: any[]; count: number }> {
  const clauses: string[] = [];
  const params: any[] = [];

  if (filters.productId) {
    params.push(filters.productId);
    clauses.push(`r.product_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`r.status = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM reviews r ${where}`,
    params,
  );
  const rows = await query(
    `SELECT r.*, ${EMBEDS}
       FROM reviews r
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN products p ON p.id = r.product_id
       ${where}`,
    params,
  );
  return { rows, count: Number(countRows[0]?.count || 0) };
}

export async function listForUser(userId: string): Promise<any[]> {
  return query(
    `SELECT r.*,
            CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
              'id', p.id, 'name', p.name
            ) END AS products
       FROM reviews r
       LEFT JOIN products p ON p.id = r.product_id
      WHERE r.user_id = $1
      ORDER BY r.created_at DESC`,
    [userId],
  );
}

export async function listFeatured(featuredOnly: boolean): Promise<any[]> {
  return query(
    `SELECT r.*, ${EMBEDS}
       FROM reviews r
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN products p ON p.id = r.product_id
      WHERE r.status = 'approved'
        ${featuredOnly ? 'AND r.is_featured = true' : ''}
      ORDER BY r.created_at DESC
      LIMIT 6`,
  );
}

export async function insertReview(data: Record<string, any>): Promise<any> {
  return insertRow('reviews', data);
}

export async function updateReview(id: string, data: Record<string, any>): Promise<any | null> {
  return updateById('reviews', id, data);
}

export async function findOwnership(id: string): Promise<any | null> {
  const rows = await query('SELECT id, user_id FROM reviews WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

export async function deleteReview(id: string): Promise<void> {
  await deleteById('reviews', id);
}
