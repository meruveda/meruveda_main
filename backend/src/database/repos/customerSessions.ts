import { query } from '../db';
import { insertRow, updateById } from './sql';

/**
 * The customer session.
 *
 * A session is opened at the checkout contact step (name + number + email)
 * and lives in the browser for 90 days. It is what lets the customer see
 * their own profile, their own addresses and their own orders - and ONLY
 * those, while the number is unverified.
 */
const TABLE = 'customer_sessions';

export interface CustomerSessionRow {
  id: string;
  user_id: string | null;
  merged_into_user_id: string | null;
  phone: string;
  name: string | null;
  email: string | null;
  phone_verified: boolean;
  source: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
}

export async function insertSession(data: Record<string, any>): Promise<CustomerSessionRow> {
  return insertRow(TABLE, data);
}

export async function getSessionById(id: string): Promise<CustomerSessionRow | null> {
  const rows = await query(`SELECT * FROM ${TABLE} WHERE id = $1 LIMIT 1`, [id]);
  return (rows[0] as CustomerSessionRow) || null;
}

export async function touchSession(id: string): Promise<void> {
  await query(`UPDATE ${TABLE} SET last_used_at = now() WHERE id = $1`, [id]);
}

export async function updateSession(id: string, patch: Record<string, any>): Promise<CustomerSessionRow | null> {
  return updateById(TABLE, id, patch);
}

/**
 * The sessions of one user - used when the number is verified and the
 * sessions are merged into the real account.
 */
export async function listSessionsForUser(userId: string): Promise<CustomerSessionRow[]> {
  const rows = await query(
    `SELECT * FROM ${TABLE}
      WHERE user_id = $1 OR merged_into_user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  );
  return rows as CustomerSessionRow[];
}

/**
 * Every session of one phone number.
 *
 * A session whose number already belonged to somebody else is NOT attached to
 * that account, so it cannot be found by user id - only by the number. The
 * merge therefore looks the sessions up by phone.
 */
export async function listSessionsForPhone(phone: string): Promise<CustomerSessionRow[]> {
  const rows = await query(
    `SELECT * FROM ${TABLE}
      WHERE phone = $1
      ORDER BY created_at DESC`,
    [phone],
  );
  return rows as CustomerSessionRow[];
}

/** Merge a session into the real customer: the history becomes visible. */
export async function mergeSessionIntoUser(sessionId: string, userId: string): Promise<void> {
  await query(
    `UPDATE ${TABLE}
        SET merged_into_user_id = $2,
            user_id = $2,
            phone_verified = true
      WHERE id = $1`,
    [sessionId, userId],
  );
}
