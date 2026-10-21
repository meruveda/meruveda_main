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

// ---------------------------------------------------------------------------
// json/jsonb columns
//
// `products` has exactly two (verified against information_schema):
//   images        jsonb NOT NULL DEFAULT '[]'
//   seo_metadata  jsonb NOT NULL DEFAULT '{}'
// Everything the admin form calls "benefits", "ingredients", "warnings",
// "dosage", SEO flags, GST… lives as keys INSIDE seo_metadata.
//
// Both drivers used at runtime (Neon HTTP + node-postgres Pool) serialise a
// JS array/object parameter into a Postgres array literal ({"a","b"}), which
// a jsonb column rejects with `invalid input syntax for type json`. An empty
// string is not valid JSON either. So every value is normalised to JSON text
// here and bound with an explicit `::jsonb` cast (see repos/sql.ts).
// ---------------------------------------------------------------------------

const PRODUCT_JSON_DEFAULTS: Record<string, unknown> = {
  images: [],
  seo_metadata: {},
};

export const PRODUCT_JSON_COLUMNS = Object.keys(PRODUCT_JSON_DEFAULTS);

/**
 * seo_metadata keys the storefront renders as a list. Existing rows store
 * them as plain comma-separated text (verified with
 * `SELECT benefits, ingredients FROM products LIMIT 3`) and the storefront
 * splits on commas, so an array form value is joined back to that shape.
 */
const LIST_TEXT_FIELDS = new Set([
  'benefits',
  'ingredients',
  'warnings',
  'faqs',
  'tags',
  'specifications',
  'how_to_use',
]);

function normalizeImageEntry(image: unknown, index: number): { id: string; url: string; alt: string } | null {
  if (typeof image === 'string') {
    const url = image.trim();
    return url ? { id: `img-${index}`, url, alt: '' } : null;
  }
  if (image && typeof image === 'object') {
    const img = image as Record<string, unknown>;
    const url = typeof img.url === 'string' ? img.url.trim() : '';
    if (!url) return null;
    const id = typeof img.id === 'string' && img.id ? img.id : `img-${index}`;
    return { id, url, alt: typeof img.alt === 'string' ? img.alt : '' };
  }
  return null;
}

function normalizeImages(value: unknown): Array<{ id: string; url: string; alt: string }> {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) {
    return value.map(normalizeImageEntry).filter((img): img is { id: string; url: string; alt: string } => img !== null);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return normalizeImages(parsed);
      const single = normalizeImageEntry(parsed, 0);
      return single ? [single] : [];
    } catch {
      // Plain text from a form: one URL per line or comma-separated.
      return normalizeImages(
        trimmed
          .split(/[\n,]/)
          .map((part) => part.trim())
          .filter(Boolean),
      );
    }
  }
  if (typeof value === 'object') {
    const single = normalizeImageEntry(value, 0);
    return single ? [single] : [];
  }
  return [];
}

export function normalizeSeoMetadata(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  let source: Record<string, unknown>;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      source = parsed as Record<string, unknown>;
    } catch {
      // A bare string is not a metadata object — nothing meaningful to store.
      return {};
    }
  } else if (typeof value === 'object' && !Array.isArray(value)) {
    source = value as Record<string, unknown>;
  } else {
    return {};
  }

  const metadata: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (entry === undefined) continue;
    if (LIST_TEXT_FIELDS.has(key)) {
      if (Array.isArray(entry)) {
        metadata[key] = entry.map((item) => String(item).trim()).filter(Boolean).join(', ');
      } else if (entry === null) {
        metadata[key] = '';
      } else if (typeof entry === 'object') {
        metadata[key] = JSON.stringify(entry);
      } else {
        metadata[key] = String(entry);
      }
      continue;
    }
    metadata[key] = entry;
  }
  return metadata;
}

/**
 * Drop `undefined` (never write a column the caller did not send) and turn
 * the json/jsonb columns into JSON text ready for a `::jsonb` bind.
 */
export function normalizeProductWrite(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [column, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (column === 'images') {
      out.images = JSON.stringify(normalizeImages(value));
    } else if (column === 'seo_metadata') {
      out.seo_metadata = JSON.stringify(normalizeSeoMetadata(value));
    } else {
      out[column] = value;
    }
  }
  return out;
}

/**
 * Never swallow the failing column: the raw driver message alone says
 * "invalid input syntax for type json" with no hint of which one broke.
 */
function withJsonContext(action: string, data: Record<string, any>, err: any): any {
  const offending = PRODUCT_JSON_COLUMNS.filter((column) => data[column] !== undefined).map(
    (column) => `${column}=${String(data[column]).slice(0, 200)}`,
  );
  console.error(`[Products] ${action} failed — json/jsonb column values sent:`, {
    columns: offending.length ? offending : 'none in payload',
    message: err?.message || err,
    code: err?.code,
    details: err?.details,
  });
  if (err && typeof err === 'object') {
    err.message = `${err.message} [product json columns: ${offending.join(' | ') || 'none'}]`;
    err.productJsonColumns = offending;
  }
  return err;
}

export async function insertProduct(data: Record<string, any>): Promise<any> {
  const payload = normalizeProductWrite(data);
  try {
    return await insertRow('products', payload, undefined, { jsonColumns: PRODUCT_JSON_COLUMNS });
  } catch (err) {
    throw withJsonContext('insertProduct', payload, err);
  }
}

export async function updateProduct(id: string, data: Record<string, any>): Promise<any | null> {
  const payload = normalizeProductWrite(data);
  try {
    return await updateById('products', id, payload, undefined, { jsonColumns: PRODUCT_JSON_COLUMNS });
  } catch (err) {
    throw withJsonContext(`updateProduct(${id})`, payload, err);
  }
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
