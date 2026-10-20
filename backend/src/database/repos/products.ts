import { query, type QueryFn } from '../db';
import { insertRow, updateById } from './sql';

/**
 * Products repository.
 *
 * The row shape matches the old PostgREST payload: `categories` is a nested
 * object (or null) because the old select embedded `categories(id, name, slug)`.
 */
export interface ProductListOptions {
  categoryId?: string;
  status?: string;
  stockStatus?: string;
  isFeatured?: boolean;
  isBestSeller?: boolean;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit: number;
  offset: number;
  /** When false, only `active` products are visible and stock internals are hidden. */
  isAdmin?: boolean;
}

const SORTABLE = new Set([
  'created_at',
  'updated_at',
  'name',
  'price',
  'selling_price',
  'stock',
  'stock_status',
  'sku',
]);

const CATEGORY_JSON = `CASE WHEN c.id IS NULL THEN NULL ELSE json_build_object(
  'id', c.id, 'name', c.name, 'slug', c.slug
) END AS categories`;

function buildWhere(opts: ProductListOptions): { sql: string; params: any[] } {
  const clauses: string[] = [];
  const params: any[] = [];

  // Public callers can never see drafts/archived rows, even if they ask.
  if (!opts.isAdmin) {
    params.push('active');
    clauses.push(`p.status = $${params.length}`);
  } else if (opts.status) {
    params.push(opts.status);
    clauses.push(`p.status = $${params.length}`);
  }

  if (opts.categoryId) {
    params.push(opts.categoryId);
    clauses.push(`p.category_id = $${params.length}`);
  }
  if (opts.stockStatus) {
    params.push(opts.stockStatus);
    clauses.push(`p.stock_status = $${params.length}`);
  }
  if (opts.isFeatured !== undefined) {
    params.push(String(opts.isFeatured));
    clauses.push(`(p.seo_metadata->>'isFeatured') = $${params.length}`);
  }
  if (opts.isBestSeller !== undefined) {
    params.push(String(opts.isBestSeller));
    clauses.push(`(p.seo_metadata->>'isBestSeller') = $${params.length}`);
  }
  if (opts.search) {
    const like = `%${opts.search}%`;
    params.push(like, like, like);
    const base = params.length - 2;
    clauses.push(
      `(p.name ILIKE $${base} OR p.sku ILIKE $${base + 1} OR COALESCE(p.brand, '') ILIKE $${base + 2})`,
    );
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export async function listProducts(opts: ProductListOptions): Promise<{ rows: any[]; count: number }> {
  const { sql: where, params } = buildWhere(opts);

  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM products p ${where}`,
    params,
  );
  const count = Number(countRows[0]?.count || 0);

  const sortBy = SORTABLE.has(opts.sortBy || '') ? opts.sortBy! : 'created_at';
  const direction = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const rows = await query(
    `SELECT p.*, ${CATEGORY_JSON}
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ${where}
      ORDER BY p.${sortBy} ${direction}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, opts.limit, opts.offset],
  );

  return { rows, count };
}

export async function getProductById(id: string): Promise<any | null> {
  const rows = await query(
    `SELECT p.*, ${CATEGORY_JSON}
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = $1
      LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getProductsByIds(ids: string[], columns = '*'): Promise<any[]> {
  if (ids.length === 0) return [];
  const cols = columns === '*' ? 'p.*' : columns.split(',').map((c) => `p.${c.trim()}`).join(', ');
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  return query(`SELECT ${cols} FROM products p WHERE p.id IN (${placeholders})`, ids);
}

export async function insertProduct(data: Record<string, any>): Promise<any> {
  return insertRow('products', data);
}

export async function updateProduct(id: string, data: Record<string, any>): Promise<any | null> {
  return updateById('products', id, data);
}

export async function deleteProduct(id: string): Promise<void> {
  await query('DELETE FROM products WHERE id = $1', [id]);
}

/**
 * Stock movement inside an order transaction — conditional so two concurrent
 * orders can never oversell the same row. Returns false when there is not
 * enough stock (NULL stock means unlimited and always succeeds).
 */
export async function decrementStock(productId: string, quantity: number, q: QueryFn = query): Promise<boolean> {
  const rows = await q(
    `UPDATE products
        SET stock = stock - $1
      WHERE id = $2
        AND $1 > 0
        AND (stock IS NULL OR stock >= $1)
      RETURNING stock`,
    [quantity, productId],
  );
  return rows.length > 0;
}

export async function getStock(productId: string, q: QueryFn = query): Promise<number> {
  const rows = await q<{ stock: number | string | null }>(
    'SELECT stock FROM products WHERE id = $1',
    [productId],
  );
  return rows.length ? Number(rows[0].stock || 0) : 0;
}
