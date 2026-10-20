import { query, type QueryFn } from '../db';
import { insertRow, updateById } from './sql';

const DEFAULT_COLUMNS =
  'id, email, phone, password_hash, first_name, last_name, role, active, created_at, updated_at';

function selectList(columns?: string): string {
  if (!columns) return DEFAULT_COLUMNS;
  const trimmed = columns.trim();
  // '*' means "every column". Without this branch the identifier filter below
  // dropped it, producing `SELECT  FROM users` — valid SQL that Postgres
  // answers with a row that has NO columns, so the caller got `{}` (truthy!)
  // instead of the user row. That silently broke every repeat OTP login.
  if (trimmed === '*') return '*';
  return trimmed
    .split(',')
    .map((c) => c.trim())
    .filter((c) => /^[a-z_][a-z0-9_]*$/.test(c))
    .join(', ');
}

export async function findByPhoneVariants(
  variants: string[],
  columns?: string,
  q: QueryFn = query,
): Promise<any | null> {
  if (variants.length === 0) return null;
  const placeholders = variants.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await q(
    `SELECT ${selectList(columns)} FROM users
      WHERE phone IN (${placeholders})
      ORDER BY created_at DESC
      LIMIT 1`,
    variants,
  );
  return rows[0] ?? null;
}

export async function findByEmail(email: string, columns?: string, q: QueryFn = query): Promise<any | null> {
  const rows = await q(
    `SELECT ${selectList(columns)} FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function findById(id: string, columns?: string, q: QueryFn = query): Promise<any | null> {
  const rows = await q(`SELECT ${selectList(columns)} FROM users WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ?? null;
}

export async function insertUser(
  data: Record<string, any>,
  columns?: string,
  q: QueryFn = query,
): Promise<any> {
  const row = await insertRow('users', data, q);
  if (!columns) return row;
  // '*' means "every column", not a column literally named '*'. Splitting it
  // used to produce { '*': undefined }, which silently produced a user object
  // with no id — and therefore a JWT without a subject.
  if (columns.trim() === '*') return row;
  const picked: Record<string, any> = {};
  for (const key of columns.split(',').map((c) => c.trim())) picked[key] = row[key];
  return picked;
}

export async function updateUser(id: string, patch: Record<string, any>, q: QueryFn = query): Promise<any | null> {
  return updateById('users', id, patch, q);
}

export async function updateUserReturning(
  id: string,
  patch: Record<string, any>,
  columns?: string,
  q: QueryFn = query,
): Promise<any | null> {
  const cols = Object.keys(patch);
  if (cols.length === 0) return findById(id, columns, q);
  const sets = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
  const rows = await q(
    `UPDATE users SET ${sets} WHERE id = $${cols.length + 1}
     RETURNING ${selectList(columns)}`,
    [...cols.map((c) => patch[c]), id],
  );
  return rows[0] ?? null;
}

export async function findByResetTokenHash(tokenHash: string): Promise<any | null> {
  const rows = await query(
    `SELECT id, email FROM users
      WHERE reset_password_token = $1
        AND reset_password_expires > NOW()
      LIMIT 1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function setPhoneVerified(id: string, verified: boolean): Promise<void> {
  await query('UPDATE users SET phone_verified = $1 WHERE id = $2', [verified, id]);
}

export async function listUsers(opts: {
  role?: string;
  search?: string;
  limit: number;
  offset: number;
}): Promise<{ rows: any[]; count: number }> {
  const clauses: string[] = [];
  const params: any[] = [];

  if (opts.role) {
    params.push(opts.role);
    clauses.push(`u.role = $${params.length}`);
  }
  if (opts.search) {
    const like = `%${opts.search}%`;
    params.push(like, like, like, like);
    const base = params.length - 3;
    clauses.push(
      `(u.first_name ILIKE $${base} OR u.last_name ILIKE $${base + 1} OR u.email ILIKE $${base + 2} OR u.phone ILIKE $${base + 3})`,
    );
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM users u ${where}`,
    params,
  );
  const rows = await query(
    `SELECT u.* FROM users u ${where}
      ORDER BY u.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, opts.limit, opts.offset],
  );
  return { rows, count: Number(countRows[0]?.count || 0) };
}

export async function deleteUser(id: string): Promise<void> {
  await query('DELETE FROM users WHERE id = $1', [id]);
}

export async function countUsers(): Promise<number> {
  const rows = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
  return Number(rows[0]?.count || 0);
}
