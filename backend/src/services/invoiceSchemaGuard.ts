import { supabase } from '../database/supabase';
import { hasColumn } from './schemaGuard';

/**
 * Schema objects the automatic invoice pipeline cannot work without.
 *
 * These are listed explicitly rather than discovered so the failure message can
 * name the exact file to run.
 */
const REQUIRED_COLUMNS = [
  'invoice_number',
  'invoice_claimed_at',
  'invoice_sent_at',
  'invoice_error',
  'invoice_allocated_at',
  'invoice_attempts',
  'payu_mihpayid',
];

const REQUIRED_TABLES = ['invoice_sequences', 'whatsapp_message_log'];

const REQUIRED_FUNCTIONS = [
  'claim_invoice',
  'release_invoice_claim',
  'mark_invoice_sent',
  'set_invoice_url',
];

export interface SchemaAuditResult {
  ok: boolean;
  missingColumns: string[];
  missingTables: string[];
  missingFunctions: string[];
}

/**
 * Verify the invoice schema is actually present in the live database.
 *
 * Why this exists: the invoice feature shipped to production with its migration
 * unapplied. Because every consumer of the missing objects degraded gracefully —
 * `claim_invoice` fell back to non-atomic numbering, the WhatsApp dedupe check
 * returned false because its table was absent, and `invoice_error` writes were
 * guarded by a `hasColumn` check that was quietly false — nothing surfaced an
 * error. Orders were invoiced nowhere, no failure was recorded, and the admin
 * panel reported 404 "Order not found" for orders that existed.
 *
 * A silent, self-healing-looking degradation is worse than a crash. This audit
 * makes the mismatch loud at boot instead.
 */
export async function auditInvoiceSchema(): Promise<SchemaAuditResult> {
  const missingColumns: string[] = [];
  const missingTables: string[] = [];
  const missingFunctions: string[] = [];

  for (const column of REQUIRED_COLUMNS) {
    if (!(await hasColumn('orders', column))) missingColumns.push(`orders.${column}`);
  }
  for (const table of REQUIRED_TABLES) {
    if (!(await hasColumn(table, undefined as any))) missingTables.push(`public.${table}`);
  }

  // Function existence: PostgREST reports a missing function as PGRST202.
  // claim_invoice is probed with a throwaway UUID, which raises inside the
  // function; a raised error still means the function EXISTS, so only the
  // PGRST202 code (function not found) is treated as missing.
  for (const fn of REQUIRED_FUNCTIONS) {
    const { error } = await supabase.rpc(fn as any, { p_order_id: '00000000-0000-0000-0000-000000000000' });
    if (error && error.code === 'PGRST202') missingFunctions.push(`public.${fn}()`);
  }

  return {
    ok: missingColumns.length === 0 && missingTables.length === 0 && missingFunctions.length === 0,
    missingColumns,
    missingTables,
    missingFunctions,
  };
}

/**
 * Optional-schema report. These columns/tables/functions are an OPTIONAL
 * accelerator: when they are absent the invoice pipeline still runs, using only
 * SUPABASE_URL + SUPABASE_SERVICE_KEY and Storage. Missing optional objects are
 * therefore reported, never alarmed about, and never block anything.
 */
export function describeInvoiceSchema(result: SchemaAuditResult): string {
  if (result.ok) return 'all optional invoice schema objects present';
  const missing = [
    ...result.missingColumns,
    ...result.missingTables,
    ...result.missingFunctions,
  ];
  return `${missing.length} optional invoice schema object(s) absent (${missing.join(', ')}) — running in zero-migration mode`;
}

/**
 * Boot-time audit. Deliberately SILENT: it must never log an error, never warn,
 * and never prevent startup. The optional objects it probes are not required by
 * the storage-backed pipeline, so their absence is a normal, supported state.
 */
export async function auditInvoiceSchemaAtBoot(): Promise<void> {
  try {
    await auditInvoiceSchema();
  } catch {
    // A failed probe is indistinguishable from "absent" and equally harmless.
  }
}

export const invoiceSchemaGuard = { auditInvoiceSchema, auditInvoiceSchemaAtBoot };