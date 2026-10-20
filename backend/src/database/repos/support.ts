import { query } from '../db';
import { insertRow, updateById } from './sql';

const USER_EMBED = `CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object(
  'first_name', u.first_name, 'last_name', u.last_name, 'email', u.email, 'phone', u.phone
) END AS users`;

export async function listTickets(filters: {
  status?: string;
  priority?: string;
  search?: string;
}): Promise<any[]> {
  const clauses: string[] = [];
  const params: any[] = [];

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`t.status = $${params.length}`);
  }
  if (filters.priority) {
    params.push(filters.priority);
    clauses.push(`t.priority = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`, `%${filters.search}%`);
    clauses.push(`(t.subject ILIKE $${params.length - 1} OR t.message ILIKE $${params.length})`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return query(
    `SELECT t.*, ${USER_EMBED}
       FROM support_tickets t
       LEFT JOIN users u ON u.id = t.user_id
       ${where}
      ORDER BY t.created_at DESC`,
    params,
  );
}

export async function listForUser(userId: string): Promise<any[]> {
  return query(
    'SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );
}

export async function insertTicket(data: Record<string, any>): Promise<any> {
  return insertRow('support_tickets', data);
}

export async function updateTicket(id: string, data: Record<string, any>): Promise<any | null> {
  return updateById('support_tickets', id, data);
}
