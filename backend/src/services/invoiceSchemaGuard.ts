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

function logInvoiceSchemaAudit(result: SchemaAuditResult): void {
  if (result.ok) {
    console.log('[InvoiceSchema] OK — atomic claim, gapless numbering and delivery logging available.');
    return;
  }
  const lines = [
    '',
    '╔══════════════════════════════════════════════════════════════════════╗',
    '║  INVOICE AUTOMATION IS NOT WORKING — DATABASE MIGRATION MISSING     ║',
    '╚══════════════════════════════════════════════════════════════════════╝',
  ];
  if (result.missingColumns.length) lines.push(`  missing columns : ${result.missingColumns.join(', ')}`);
  if (result.missingTables.length) lines.push(`  missing tables  : ${result.missingTables.join(', ')}`);
  if (result.missingFunctions.length) lines.push(`  missing funcs   : ${result.missingFunctions.join(', ')}`);
  lines.push('');
  lines.push('  Orders will NOT be invoiced and nothing will be recorded.');
  lines.push('  Numbering is non-atomic (duplicate invoice numbers are possible)');
  lines.push('  and the once-only delivery guarantee does not hold.');
  lines.push('');
  lines.push('  Run, in order:');
  lines.push('    1. backend/database/deltas/005_otp_whatsapp_review_requests.sql');
  lines.push('    2. backend/sql/migrations/2026-10-15_invoice_automation.sql');
  lines.push('  (Supabase Dashboard -> SQL Editor, or `psql "$DATABASE_URL" -f <file>`)');
  lines.push('');
  console.error(lines.join('\n'));
}

/**
 * Boot-time audit. Logs loudly but does NOT prevent startup: the rest of the
 * store (catalogue, checkout, payments) is unaffected by the invoice schema, and
 * refusing to boot would take the whole storefront down over a reporting
 * feature. Escalate with INVOICE_SCHEMA_STRICT=true to fail fast instead.
 */
export async function auditInvoiceSchemaAtBoot(): Promise<void> {
  let result: SchemaAuditResult;
  try {
    result = await auditInvoiceSchema();
  } catch (err: any) {
    console.error('[InvoiceSchema] audit could not run:', err?.message || err);
    return;
  }

  logInvoiceSchemaAudit(result);

  if (!result.ok && process.env.INVOICE_SCHEMA_STRICT === 'true') {
    throw new Error(
      'INVOICE_SCHEMA_STRICT=true and the invoice migration has not been applied. Refusing to start.'
    );
  }
}

export const invoiceSchemaGuard = { auditInvoiceSchema, auditInvoiceSchemaAtBoot };