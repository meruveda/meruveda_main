import { query } from '../db';
import { insertRow } from './sql';

const TABLE = 'user_addresses';

export async function listForUser(userId: string): Promise<any[]> {
  return query(
    `SELECT * FROM ${TABLE}
      WHERE user_id = $1
      ORDER BY is_default DESC, created_at DESC`,
    [userId],
  );
}

/**
 * The address book of a checkout session.
 *
 * An unverified session sees ONLY the addresses it created itself - the
 * address of somebody else's account must stay hidden. A verified session
 * (the number was proven, or the customer signed in) sees the whole account.
 */
export async function listForSession(
  sessionId: string,
  userId: string | null,
  verifiedAccount: boolean,
): Promise<any[]> {
  if (verifiedAccount && userId) {
    return query(
      `SELECT * FROM ${TABLE}
        WHERE user_id = $1 OR session_id = $2
        ORDER BY is_default DESC, created_at DESC`,
      [userId, sessionId],
    );
  }
  return query(
    `SELECT * FROM ${TABLE}
      WHERE session_id = $1
      ORDER BY is_default DESC, created_at DESC`,
    [sessionId],
  );
}

export async function clearDefaults(userId: string, exceptId?: string): Promise<void> {
  if (exceptId) {
    await query(`UPDATE ${TABLE} SET is_default = false WHERE user_id = $1 AND id <> $2`, [userId, exceptId]);
  } else {
    await query(`UPDATE ${TABLE} SET is_default = false WHERE user_id = $1`, [userId]);
  }
}

export async function clearDefaultsForSession(sessionId: string, exceptId?: string): Promise<void> {
  if (exceptId) {
    await query(
      `UPDATE ${TABLE} SET is_default = false WHERE session_id = $1 AND id <> $2`,
      [sessionId, exceptId],
    );
  } else {
    await query(`UPDATE ${TABLE} SET is_default = false WHERE session_id = $1`, [sessionId]);
  }
}

export async function insertAddress(data: Record<string, any>): Promise<any> {
  return insertRow(TABLE, data);
}

export async function updateAddress(
  userId: string,
  id: string,
  patch: Record<string, any>,
): Promise<any | null> {
  const cols = Object.keys(patch);
  if (cols.length === 0) return null;
  const sets = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
  const rows = await query(
    `UPDATE ${TABLE} SET ${sets}
      WHERE id = $${cols.length + 1} AND user_id = $${cols.length + 2}
      RETURNING *`,
    [...cols.map((c) => patch[c]), id, userId],
  );
  return rows[0] ?? null;
}

/** Update an address that belongs to a session. */
export async function updateAddressForSession(
  sessionId: string,
  id: string,
  patch: Record<string, any>,
): Promise<any | null> {
  const cols = Object.keys(patch);
  if (cols.length === 0) return null;
  const sets = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
  const rows = await query(
    `UPDATE ${TABLE} SET ${sets}
      WHERE id = $${cols.length + 1} AND session_id = $${cols.length + 2}
      RETURNING *`,
    [...cols.map((c) => patch[c]), id, sessionId],
  );
  return rows[0] ?? null;
}

export async function deleteAddress(userId: string, id: string): Promise<boolean> {
  const rows = await query(
    `DELETE FROM ${TABLE} WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId],
  );
  return rows.length > 0;
}

/** Delete an address that belongs to a session. */
export async function deleteAddressForSession(sessionId: string, id: string): Promise<boolean> {
  const rows = await query(
    `DELETE FROM ${TABLE} WHERE id = $1 AND session_id = $2 RETURNING id`,
    [id, sessionId],
  );
  return rows.length > 0;
}

export async function setDefault(userId: string, id: string): Promise<any | null> {
  const rows = await query(
    `UPDATE ${TABLE} SET is_default = true
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [id, userId],
  );
  return rows[0] ?? null;
}

/** Make an address the default one of a session. */
export async function setDefaultForSession(sessionId: string, id: string): Promise<any | null> {
  const rows = await query(
    `UPDATE ${TABLE} SET is_default = true
      WHERE id = $1 AND session_id = $2
      RETURNING *`,
    [id, sessionId],
  );
  return rows[0] ?? null;
}
