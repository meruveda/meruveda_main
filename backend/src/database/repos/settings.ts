import { query } from '../db';

export async function getByKey(key: string): Promise<any | null> {
  const rows = await query('SELECT * FROM settings WHERE key = $1 LIMIT 1', [key]);
  return rows[0] ?? null;
}

export async function getValue(key: string): Promise<any | null> {
  const row = await getByKey(key);
  return row ? row.value : null;
}

/**
 * `settings.key` is unique in the base schema. Upsert keeps the previous
 * behaviour where the preferences endpoint could create or update in one call.
 */
export async function upsertSetting(key: string, value: any): Promise<any> {
  const rows = await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
     RETURNING *`,
    [key, value],
  );
  return rows[0];
}

export async function listSettings(): Promise<any[]> {
  return query('SELECT * FROM settings ORDER BY created_at ASC');
}

export async function insertSetting(data: Record<string, any>): Promise<any> {
  const cols = Object.keys(data);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await query(
    `INSERT INTO settings (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders}) RETURNING *`,
    cols.map((c) => data[c]),
  );
  return rows[0];
}

export async function updateSetting(id: string, value: any): Promise<any | null> {
  const rows = await query('UPDATE settings SET value = $1 WHERE id = $2 RETURNING *', [value, id]);
  return rows[0] ?? null;
}
