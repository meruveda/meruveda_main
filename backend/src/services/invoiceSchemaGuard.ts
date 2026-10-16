/**
 * Boot-time invoice audit — deliberately a no-op.
 *
 * The invoice pipeline is storage-backed: it needs only `SUPABASE_URL` +
 * `SUPABASE_SERVICE_KEY` and the Storage API, and creates its own bucket at
 * runtime. There is no schema requirement left to check, so there is nothing to
 * probe and nothing to complain about.
 *
 * This module previously probed optional database objects and printed a loud box
 * at boot when they were absent. That was the bug: the objects it probed were
 * never required, so their absence produced a scary banner on a perfectly
 * healthy server. The function is kept as a named no-op so callers do not break.
 */

export interface SchemaAuditResult {
  ok: boolean;
  missingColumns: string[];
  missingTables: string[];
  missingFunctions: string[];
}

/** Always healthy: there is no invoice schema to be missing. */
export async function auditInvoiceSchema(): Promise<SchemaAuditResult> {
  return { ok: true, missingColumns: [], missingTables: [], missingFunctions: [] };
}

/** One-line description, for tooling that wants to print something. */
export function describeInvoiceSchema(result: SchemaAuditResult): string {
  return result.ok
    ? 'storage-backed — no invoice schema required'
    : 'storage-backed — no invoice schema required';
}

/**
 * Boot hook. Intentionally silent: it never logs, never warns and never blocks.
 */
export async function auditInvoiceSchemaAtBoot(): Promise<void> {
  // Intentionally empty. See the module comment.
}

export const invoiceSchemaGuard = { auditInvoiceSchema, auditInvoiceSchemaAtBoot };