import { query } from '../db';

/**
 * Atomic, per-order invoice numbering. The PL/pgSQL function locks the order
 * row, returns the existing number unchanged, and only then takes the next
 * per-FY value from `invoice_sequences`. No app-side max()+1.
 */
export async function assignInvoiceNumber(orderId: string): Promise<string> {
  const rows = await query<{ invoice_number: string }>(
    'SELECT assign_invoice_number($1::uuid) AS invoice_number',
    [orderId],
  );
  return rows[0]?.invoice_number;
}
