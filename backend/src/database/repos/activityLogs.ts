import { query } from '../db';
import { insertRow } from './sql';

export async function logActivity(entry: Record<string, any>): Promise<any> {
  return insertRow('activity_logs', entry);
}

export async function timestampsForUsers(userIds: string[]): Promise<any[]> {
  if (userIds.length === 0) return [];
  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(', ');
  return query(
    `SELECT user_id, created_at FROM activity_logs
      WHERE user_id IN (${placeholders})`,
    userIds,
  );
}

export async function listActivity(opts: {
  page: number;
  limit: number;
  action?: string;
  entityType?: string;
  userId?: string;
}): Promise<{ rows: any[]; count: number }> {
  const clauses: string[] = [];
  const params: any[] = [];

  if (opts.action) {
    params.push(`%${opts.action}%`);
    clauses.push(`a.action ILIKE $${params.length}`);
  }
  if (opts.entityType) {
    params.push(opts.entityType);
    clauses.push(`a.entity_type = $${params.length}`);
  }
  if (opts.userId) {
    params.push(opts.userId);
    clauses.push(`a.user_id = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM activity_logs a ${where}`,
    params,
  );

  const rows = await query(
    `SELECT a.*,
            CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object(
              'first_name', u.first_name, 'last_name', u.last_name, 'email', u.email
            ) END AS users
       FROM activity_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${where}
      ORDER BY a.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, opts.limit, (opts.page - 1) * opts.limit],
  );

  return { rows, count: Number(countRows[0]?.count || 0) };
}
