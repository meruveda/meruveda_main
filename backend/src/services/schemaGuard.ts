import { query, isDbConfigured } from '../database/db';

/**
 * Schema probes for columns/tables introduced by a migration delta.
 *
 * The API is written against the full schema, but a fresh deployment may not
 * have every delta applied yet. Probing lets a query degrade gracefully instead
 * of surfacing a Postgres "column does not exist" error as a 500.
 *
 * Successful probes are cached for the process lifetime; failures for a few
 * seconds so a migration applied mid-flight is picked up without a restart.
 */
const FAILURE_TTL_MS = 5_000;
const known = new Map<string, true>();
const rejected = new Map<string, number>();
const alreadyWarned = new Set<string>();

/**
 * A missing object means the schema drifted from what the code expects: a
 * feature silently switches off. That is never acceptable, so say it out loud
 * (once per object per process) and point at the fix.
 */
function warnMissing(table: string, column?: string): void {
  const key = probeKey(table, column);
  if (alreadyWarned.has(key)) return;
  alreadyWarned.add(key);
  console.error(
    `[schemaGuard] MISSING SCHEMA OBJECT: ${key} — the feature that depends on it is disabled. ` +
      `Run 'npm run db:migrate' then 'npm run db:verify' to confirm.`,
  );
}

function probeKey(table: string, column?: string): string {
  return column ? `${table}.${column}` : `${table}.*`;
}

async function probe(table: string, column?: string): Promise<boolean> {
  if (!isDbConfigured()) return false;

  const key = probeKey(table, column);
  if (known.has(key)) return true;

  const failedAt = rejected.get(key);
  if (failedAt !== undefined && Date.now() - failedAt < FAILURE_TTL_MS) return false;

  try {
    const rows = column
      ? await query(
          `SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
            LIMIT 1`,
          [table, column],
        )
      : await query(
          `SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
            LIMIT 1`,
          [table],
        );

    if (rows.length === 0) {
      rejected.set(key, Date.now());
      warnMissing(table, column);
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

/** Test seam: forget every probe result. */
export function __resetSchemaGuardForTests(): void {
  known.clear();
  rejected.clear();
  alreadyWarned.clear();
}
