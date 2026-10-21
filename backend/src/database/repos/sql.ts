import { query, type QueryFn } from '../db';

const IDENT = /^[a-z_][a-z0-9_]*$/;

/**
 * Column/table names are interpolated into SQL (values are always bound), so
 * anything that is not a plain snake_case identifier is rejected. All callers
 * pass literal names defined in this codebase; this is the backstop.
 */
export function ident(name: string): string {
  if (!IDENT.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${String(name)}`);
  }
  return `"${name}"`;
}

export interface WriteOptions {
  /**
   * Columns that hold JSON text. node-postgres and Neon's HTTP driver turn a
   * JS array/object parameter into a Postgres array literal (`{"a","b"}`),
   * which a json/jsonb column rejects with "invalid input syntax for type
   * json". Callers stringify those values and list them here so the bind is
   * explicitly cast.
   */
  jsonColumns?: string[];
}

function bindPlaceholder(col: string, index: number, jsonColumns: Set<string>): string {
  return jsonColumns.has(col) ? `$${index + 1}::jsonb` : `$${index + 1}`;
}

export async function insertRow<T = any>(
  table: string,
  data: Record<string, any>,
  q: QueryFn = query,
  opts: WriteOptions = {},
): Promise<T> {
  const cols = Object.keys(data);
  if (cols.length === 0) throw new Error(`insertRow(${table}) called with no columns`);
  const jsonColumns = new Set(opts.jsonColumns ?? []);
  const placeholders = cols.map((c, i) => bindPlaceholder(c, i, jsonColumns)).join(', ');
  const text = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES (${placeholders}) RETURNING *`;
  const rows = await q<T>(text, cols.map((c) => data[c]));
  return rows[0];
}

export async function insertRows<T = any>(
  table: string,
  rows: Array<Record<string, any>>,
  q: QueryFn = query,
): Promise<T[]> {
  if (rows.length === 0) return [];
  const cols = Object.keys(rows[0]);
  if (cols.length === 0) throw new Error(`insertRows(${table}) called with no columns`);

  const values: any[] = [];
  const tuples = rows.map((row) => {
    const tuple = cols.map((c) => {
      values.push(row[c] === undefined ? null : row[c]);
      return `$${values.length}`;
    });
    return `(${tuple.join(', ')})`;
  });

  const text = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES ${tuples.join(', ')} RETURNING *`;
  return q<T>(text, values);
}

export async function updateById<T = any>(
  table: string,
  id: string,
  data: Record<string, any>,
  q: QueryFn = query,
  opts: WriteOptions = {},
): Promise<T | null> {
  const cols = Object.keys(data);
  if (cols.length === 0) {
    const rows = await q<T>(`SELECT * FROM ${ident(table)} WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }
  const jsonColumns = new Set(opts.jsonColumns ?? []);
  const sets = cols.map((c, i) => `${ident(c)} = ${bindPlaceholder(c, i, jsonColumns)}`).join(', ');
  const text = `UPDATE ${ident(table)} SET ${sets} WHERE id = $${cols.length + 1} RETURNING *`;
  const rows = await q<T>(text, [...cols.map((c) => data[c]), id]);
  return rows[0] ?? null;
}

export async function deleteById(table: string, id: string, q: QueryFn = query): Promise<void> {
  await q(`DELETE FROM ${ident(table)} WHERE id = $1`, [id]);
}

export async function deleteWhere(
  table: string,
  whereSql: string,
  params: any[],
  q: QueryFn = query,
): Promise<number> {
  const rows = await q(`DELETE FROM ${ident(table)} WHERE ${whereSql} RETURNING id`, params);
  return rows.length;
}

/** `IN ($n, $n+1, ...)` with `startIndex` = number of params already bound. */
export function inClause(count: number, startIndex = 0): string {
  if (count <= 0) return '(NULL)';
  return `(${Array.from({ length: count }, (_, i) => `$${startIndex + i + 1}`).join(', ')})`;
}

export function asJson(value: any): string {
  return JSON.stringify(value ?? null);
}

export function firstOrNull<T>(rows: T[]): T | null {
  return rows.length > 0 ? rows[0] : null;
}
