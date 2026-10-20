import { query } from '../db';
import { insertRow, updateById, deleteById } from './sql';

const USER_EMBED = `CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object(
  'first_name', u.first_name, 'last_name', u.last_name
) END AS users`;

export async function listBlogs(
  status?: string,
  opts: { includeUnpublished?: boolean } = {},
): Promise<{ rows: any[]; count: number }> {
  const params: any[] = [];
  let where = '';
  if (status) {
    params.push(status);
    where = 'WHERE b.status = $1';
  } else if (!opts.includeUnpublished) {
    // A public caller must never see a draft or an archived post. The admin
    // panel asks for them explicitly by passing a status.
    where = "WHERE b.status = 'published'";
  }

  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM blogs b ${where}`,
    params,
  );

  const rows = await query(
    `SELECT b.*, ${USER_EMBED}
       FROM blogs b
       LEFT JOIN users u ON u.id = b.author_id
       ${where}
      ORDER BY b.created_at DESC`,
    params,
  );

  return { rows, count: Number(countRows[0]?.count || 0) };
}

export async function findBlog(value: string, isUuid: boolean): Promise<any | null> {
  const rows = await query(
    `SELECT b.*, ${USER_EMBED}
       FROM blogs b
       LEFT JOIN users u ON u.id = b.author_id
      WHERE ${isUuid ? 'b.id = $1 OR b.slug = $1' : 'b.slug = $1'}
      LIMIT 1`,
    [value],
  );
  return rows[0] ?? null;
}

export async function getFeaturedImage(id: string): Promise<any | null> {
  const rows = await query('SELECT featured_image FROM blogs WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

export async function insertBlog(data: Record<string, any>): Promise<any> {
  return insertRow('blogs', data);
}

export async function updateBlog(id: string, data: Record<string, any>): Promise<any | null> {
  return updateById('blogs', id, data);
}

export async function deleteBlog(id: string): Promise<void> {
  await deleteById('blogs', id);
}
