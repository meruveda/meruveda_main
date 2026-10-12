import { supabase } from '../database/supabase';

/**
 * Schema probes for columns/tables that are introduced by a migration delta.
 *
 * The API is written against the full schema (see database/deltas), but a fresh
 * deployment may not have every delta applied yet. Probing lets a query degrade
 * gracefully — or refuse with an actionable message — instead of surfacing a
 * PostgREST "column does not exist" error as a 500.
 *
 * Successful probes are cached for the process lifetime; failures are cached for
 * only a few seconds so a migration that is applied mid-flight is picked up
 * without a restart.
 */
const FAILURE_TTL_MS = 5_000;
const known = new Map<string, true>();
const rejected = new Map<string, number>();

function probeKey(table: string, column?: string): string {
  return column ? `${table}.${column}` : `${table}.*`;
}

async function probe(table: string, column?: string): Promise<boolean> {
  const key = probeKey(table, column);
  if (known.has(key)) return true;

  const failedAt = rejected.get(key);
  if (failedAt !== undefined && Date.now() - failedAt < FAILURE_TTL_MS) return false;

  try {
    const { error } = column
      ? await supabase.from(table).select(column).limit(1)
      : await supabase.from(table).select('*').limit(1);

    if (error) {
      rejected.set(key, Date.now());
      return false;
    }
  } catch {
    rejected.set(key, Date.now());
    return false;
  }

  known.set(key, true);
  rejected.delete(key);
  return true;
}

/** True when `table.column` exists in the live schema. */
export async function hasColumn(table: string, column: string): Promise<boolean> {
  return probe(table, column);
}

/** True when `table` exists in the live schema. */
export async function hasTable(table: string): Promise<boolean> {
  return probe(table);
}
