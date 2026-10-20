import { query } from '../db';
import { insertRow, updateById } from './sql';

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  [key: string]: any;
}

/** `*, products(id)` — the caller derives `productCount` from the array. */
export async function listCategories(): Promise<any[]> {
  return query(
    `SELECT c.*,
            COALESCE(
              (SELECT json_agg(json_build_object('id', p.id))
                 FROM products p
                WHERE p.category_id = c.id),
              '[]'::json
            ) AS products
       FROM categories c
      ORDER BY c.name ASC`,
  );
}

export async function insertCategory(data: Record<string, any>): Promise<any> {
  return insertRow('categories', data);
}

export async function updateCategory(id: string, data: Record<string, any>): Promise<any | null> {
  return updateById('categories', id, data);
}

export async function deleteCategory(id: string): Promise<void> {
  await query('DELETE FROM categories WHERE id = $1', [id]);
}

export async function getCategoryColumns(id: string, columns: string[]): Promise<any | null> {
  if (columns.length === 0) return null;
  const cols = columns.map((c) => `"${c.replace(/"/g, '')}"`).join(', ');
  const rows = await query(`SELECT ${cols} FROM categories WHERE id = $1`, [id]);
  return rows[0] ?? null;
}
