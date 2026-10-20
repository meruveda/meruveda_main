import { query } from '../db';

export interface WhatsappLogEntry {
  recipient: string;
  templateName?: string;
  messageType: string;
  purpose: string;
  referenceId?: string;
  status: 'sent' | 'failed';
  error?: string;
  payload?: unknown;
}

/** Upsert on the (purpose, reference_id) dedupe key. */
export async function logSend(entry: WhatsappLogEntry): Promise<void> {
  if (!entry.referenceId) return;
  await query(
    `INSERT INTO whatsapp_message_log
       (recipient, template_name, message_type, purpose, reference_id, status, error, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (purpose, reference_id) DO UPDATE SET
       recipient = EXCLUDED.recipient,
       template_name = EXCLUDED.template_name,
       message_type = EXCLUDED.message_type,
       status = EXCLUDED.status,
       error = EXCLUDED.error,
       payload = EXCLUDED.payload`,
    [
      entry.recipient,
      entry.templateName || null,
      entry.messageType,
      entry.purpose,
      entry.referenceId,
      entry.status,
      entry.error || null,
      entry.payload || {},
    ],
  );
}

/** Plain insert, used by the inbound webhook (no dedupe/upsert semantics). */
export async function insertMessage(entry: Record<string, any>): Promise<void> {
  const cols = Object.keys(entry);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  await query(
    `INSERT INTO whatsapp_message_log (${cols.map((c) => `"${c}"`).join(', ')})
     VALUES (${placeholders})`,
    cols.map((c) => entry[c]),
  );
}

export async function findByReference(
  purpose: string,
  referenceId: string,
  columns = 'id, status',
): Promise<any | null> {
  const rows = await query(
    `SELECT ${columns} FROM whatsapp_message_log
      WHERE purpose = $1 AND reference_id = $2
      LIMIT 1`,
    [purpose, referenceId],
  );
  return rows[0] ?? null;
}
