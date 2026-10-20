import { neon, Pool, types as neonTypes, type PoolClient } from '@neondatabase/serverless';
import * as pgTypes from 'pg-types';

/**
 * Single database entry point for the whole backend.
 *
 * Runtime reads/writes use Neon's HTTP driver (one round-trip per statement,
 * no connection held open on a serverless invocation). Anything that must be
 * atomic — order creation, payment confirmation, stock movement, invoice
 * numbering — goes through `withTransaction()`, which uses the WebSocket Pool.
 *
 * The previous storage client used to return numbers for NUMERIC and
 * BIGINT columns. node-postgres (and Neon) return them as strings, which would
 * silently turn prices into strings on the wire. The custom type parsers below
 * restore the old behaviour in exactly one place.
 */

const NUMERIC_OID = 1700;
const INT8_OID = 20;
const TIMESTAMPTZ_OID = 1184;
const TIMESTAMP_OID = 1114;
const DATE_OID = 1082;

function parseNumeric(value: string | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : (value as unknown as number);
}

function parseTimestamptz(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function parseTimestamp(value: string | null): string | null {
  if (value === null || value === undefined) return null;
  return String(value).replace(' ', 'T');
}

/** Exported for the unit test; also the single source of truth for parsing. */
export const typeParsers = {
  getTypeParser(id: number, format?: any): (value: string | null) => any {
    if (id === NUMERIC_OID || id === INT8_OID) return parseNumeric;
    if (id === TIMESTAMPTZ_OID) return parseTimestamptz;
    if (id === TIMESTAMP_OID) return parseTimestamp;
    if (id === DATE_OID) return (value: string | null) => value;
    return (pgTypes as any).getTypeParser(id, format);
  },
};

/**
 * Register the NUMERIC parser globally as well, not just per-query.
 *
 * The per-query `types` option above already covers every statement this
 * module runs, but Neon's HTTP driver also builds its own parser table from the
 * global registry when no per-query `types` is supplied (e.g. a raw
 * `sql.query()` from another module). Setting it here means NUMERIC columns
 * (price, original_price/MRP, discount, subtotal, tax, shipping, total, amount,
 * coupon value) are numbers the moment this module is imported �?" before any
 * connection is opened. BIGINT is deliberately left at its default here; see
 * the media.size note.
 */
function registerGlobalTypeParsers(): void {
  const numeric = parseNumeric as (value: string) => any;
  try {
    neonTypes.setTypeParser(NUMERIC_OID, numeric);
  } catch {
    // Global registration is an optimisation; the per-query parser is authoritative.
  }
  try {
    (pgTypes as any).setTypeParser?.(NUMERIC_OID, numeric);
  } catch {
    // Same: never let a registry tweak break module import.
  }
}

registerGlobalTypeParsers();

// ---------------------------------------------------------------------------
// Connection management (lazy: importing this module must never require a URL,
// so `tsc`, lint and the unit suite keep working without credentials).
// ---------------------------------------------------------------------------

let httpClient: ReturnType<typeof neon> | null = null;
let pool: Pool | null = null;

// Neon's free compute suspends on idle: the first statement can take seconds.
// 10s connect / 15s statement keeps us inside Vercel's 30s maxDuration.
const CONNECT_TIMEOUT_MS = 10_000;
const STATEMENT_TIMEOUT_MS = 15_000;
const IDLE_TIMEOUT_MS = 30_000;
/** Idempotent READS only — writes are never blind-retried. */
const READ_RETRY_MAX_ATTEMPTS = 2;
const READ_RETRY_BACKOFF_MS = [250, 750];

const TRANSIENT_PG_CODES = new Set([
  '08000', '08001', '08003', '08004', '08005', '08006', // connection exceptions
  '53300', '53400', '53200', // too many connections / resource limits
  '57P01', '57P02', '57P03', // admin shutdown / crash recovery
]);
const TRANSIENT_NODE_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE',
  'ENOTFOUND', 'EAI_AGAIN', 'ABORT_ERR', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
]);
const TRANSIENT_MESSAGE_RE =
  /fetch failed|socket hang up|connection terminated|connection refused|network error|socket timeout|terminated due to|too many connections|server closed/i;

/** Transient = safe to retry an idempotent read. Never used for writes. */
export function isTransientError(err: any): boolean {
  if (!err) return false;
  if (typeof err.code === 'string') {
    if (TRANSIENT_PG_CODES.has(err.code)) return true;
    if (TRANSIENT_NODE_CODES.has(err.code)) return true;
  }
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  return TRANSIENT_MESSAGE_RE.test(String(err.message || ''));
}

/**
 * Idempotent statements only: SELECT / SHOW / EXPLAIN / VALUES, plus a
 * read-only CTE (`WITH ... SELECT`). A CTE that writes is NOT read-only.
 */
export function isReadOnlySql(text: string): boolean {
  const sql = String(text || '')
    .replace(/^\s*(?:--[^\n]*\n\s*)+/, '')
    .trim();
  if (/^(select|show|explain|values)\b/i.test(sql)) return true;
  if (/^with\b/i.test(sql)) return !/\b(insert|update|delete|merge)\b/i.test(sql);
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T> | PromiseLike<T>, ms: number, label: string): Promise<T> {
  /**
   * The Neon driver returns a `NeonQueryPromise`, NOT a native promise. Its
   * `then`, `catch` and `finally` accessors EACH execute the statement again:
   *
   *   then(e, t) { return this.execute(this.queryData, this.opts).then(e, t) }
   *   catch(e)  { return this.execute(this.queryData, this.opts).catch(e) }
   *
   * Touching it twice therefore runs the SQL twice. The previous
   * implementation called `.catch()` (to swallow a late rejection) and then
   * handed the same object to `Promise.race`, which called `.then()` — so
   * EVERY statement executed twice: inserts created duplicate rows, and
   * `UPDATE ... RETURNING` raced against a second copy of itself (the atomic
   * claims in the order pipeline failed ~40% of the time).
   *
   * `Promise.resolve(thenable)` assimilates it exactly once and yields a real
   * native promise, so the statement runs a single time and every later
   * `.catch()` / `Promise.race` is safe.
   */
  const settled = Promise.resolve(promise as PromiseLike<T>);
  // If we win the race, the underlying fetch still settles later — swallow it
  // so Node does not report an unhandled rejection.
  settled.catch(() => undefined);
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error(`${label} timed out after ${ms}ms`), { code: 'ETIMEDOUT' })),
      ms,
    );
  });
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export function databaseUrl(): string {
  // Runtime runs as the least-privilege role created by
  // scripts/create-app-role.js (DATABASE_URL_APP); DATABASE_URL stays the
  // owner connection as a fallback for local work before that script has run.
  // Vercel/Neon dashboards routinely copy a trailing newline or spaces into
  // the value; neon() rejects that with a message that embeds the whole URL.
  return (process.env.DATABASE_URL_APP || process.env.DATABASE_URL || '').trim();
}

/** Direct (non-pooled) URL — migrations/DDL only. */
export function directDatabaseUrl(): string {
  return (process.env.DATABASE_URL_UNPOOLED || '').trim();
}

export function isDbConfigured(): boolean {
  return Boolean(databaseUrl());
}

function http() {
  if (!httpClient) {
    const url = databaseUrl();
    if (!url) {
      throw Object.assign(
        new Error('DATABASE_URL is not configured — the API cannot reach Postgres.'),
        { code: 'DB_NOT_CONFIGURED' },
      );
    }
    httpClient = neon(url, { types: typeParsers as any });
  }
  return httpClient;
}

function getPool(): Pool {
  if (!pool) {
    const url = databaseUrl();
    if (!url) {
      throw Object.assign(
        new Error('DATABASE_URL is not configured — the API cannot reach Postgres.'),
        { code: 'DB_NOT_CONFIGURED' },
      );
    }
    pool = new Pool({
      connectionString: url,
      types: typeParsers as any,
      max: 5,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      query_timeout: STATEMENT_TIMEOUT_MS,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
      allowExitOnIdle: true,
    });
    // An idle client can die (Neon suspend). Without a listener this throws.
    pool.on('error', (err: any) => {
      console.error('[db] idle client error:', err?.code || 'unknown');
    });
  }
  return pool;
}

export type QueryFn = <T = any>(text: string, params?: any[]) => Promise<T[]>;

interface DriverOverride {
  query: QueryFn;
  transaction: <T>(fn: (q: QueryFn) => Promise<T>) => Promise<T>;
}

let override: DriverOverride | null = null;

/** Test seam: replace the driver without touching Neon. */
export function __setDbDriverForTests(driver: DriverOverride | null): void {
  override = driver;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export const query: QueryFn = async <T = any>(text: string, params: any[] = []): Promise<T[]> => {
  if (override) return override.query<T>(text, params);

  const readOnly = isReadOnlySql(text);
  const attempts = readOnly ? READ_RETRY_MAX_ATTEMPTS : 1;
  let lastErr: any;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const rows = await withTimeout(
        http().query(text, params),
        STATEMENT_TIMEOUT_MS,
        'neon-http query',
      );
      return rows as unknown as T[];
    } catch (err: any) {
      lastErr = err;
      // Only an idempotent read on a transient error ever retries; a write
      // throws on the first failure so we never duplicate a side effect.
      if (!readOnly || !isTransientError(err) || attempt === attempts - 1) throw err;
      await sleep(READ_RETRY_BACKOFF_MS[attempt] ?? 750);
    }
  }
  throw lastErr;
};

export async function one<T = any>(text: string, params: any[] = []): Promise<T> {
  const rows = await query<T>(text, params);
  if (rows.length !== 1) {
    const err: any = new Error(rows.length === 0 ? 'Row not found' : 'Multiple rows returned');
    err.code = rows.length === 0 ? 'PGRST116' : 'PGRST117';
    throw err;
  }
  return rows[0];
}

export async function maybeOne<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length > 0 ? rows[0] : null;
}

export async function many<T = any>(text: string, params: any[] = []): Promise<T[]> {
  return query<T>(text, params);
}

export async function withTransaction<T>(fn: (q: QueryFn) => Promise<T>): Promise<T> {
  if (override) return override.transaction(fn);

  const client: PoolClient = await getPool().connect();
  const run: QueryFn = async <R = any>(text: string, params: any[] = []) => {
    const result = await client.query(text, params);
    return result.rows as R[];
  };

  try {
    await client.query('BEGIN');
    const result = await fn(run);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection may already be gone; the original error is more useful.
    }
    throw err;
  } finally {
    client.release();
  }
}

/** `SELECT 1` probe used by /api/health and Phase B preflight. */
export async function databaseHealthy(): Promise<boolean> {
  if (!isDbConfigured()) return false;
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end().catch(() => undefined);
  }
  httpClient = null;
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

export function isUniqueViolation(err: any): boolean {
  return err?.code === '23505';
}

export function isUndefinedTable(err: any): boolean {
  return err?.code === '42P01';
}

export function isUndefinedColumn(err: any): boolean {
  return err?.code === '42703';
}

export const PgErrorCode = {
  UNIQUE_VIOLATION: '23505',
  UNDEFINED_TABLE: '42P01',
  UNDEFINED_COLUMN: '42703',
} as const;
