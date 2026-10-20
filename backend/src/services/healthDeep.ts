// Deep health probe: GET /api/health/deep (CRON_SECRET bearer or admin JWT).
//
// /api/health only proves "the DB answers SELECT 1". This endpoint proves the
// pieces that break silently in production: schema drift against the canonical
// expectation, both R2 buckets reachable, Shiprocket auth, WhatsApp Graph auth,
// plus the operational queues (orders waiting for Shiprocket, invoices not
// sent). It is a read-only probe: no writes, no external mutations.
//
// Every external call gets a hard timeout so a hung provider can never hold
// the request open past the function limit.
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { query } from '../database/db';
import { config } from '../config/env';
import { shiprocketAuth } from './shiprocket/auth.service';
import { getOtpTemplate, getInvoiceTemplate } from './whatsappTemplateResolver';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail?: string;
  ms?: number;
}

export interface DeepHealthReport {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  durationMs: number;
  checks: HealthCheck[];
}

const DEFAULT_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function timed(
  name: string,
  fn: () => Promise<{ status: CheckStatus; detail?: string }>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<HealthCheck> {
  const started = Date.now();
  try {
    const result = await withTimeout(fn(), timeoutMs, name);
    return { name, status: result.status, detail: result.detail, ms: Date.now() - started };
  } catch (err: any) {
    return {
      name,
      status: 'fail',
      detail: String(err?.message || err).slice(0, 300),
      ms: Date.now() - started,
    };
  }
}

// expected-schema.json is written by db:verify (canonical shape of the Neon
// database). It lives outside src/, so resolve it from either the source tree
// (backend/database/neon) or the build output (dist/database/neon, copied by
// scripts/copy-assets.cjs).
function loadExpectedSchema(): any | null {
  const candidates = [
    join(__dirname, '..', 'database', 'neon', 'expected-schema.json'), // dist/services -> dist/database
    join(__dirname, '..', '..', 'database', 'neon', 'expected-schema.json'), // src/services -> backend/database
  ];
  for (const file of candidates) {
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function r2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
    forcePathStyle: true,
  });
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkNeon(): Promise<HealthCheck> {
  return timed('neon', async () => {
    const rows = await query('SELECT 1 AS ok');
    if (!rows.length) return { status: 'fail', detail: 'SELECT 1 returned no rows' };
    return { status: 'ok', detail: 'connected' };
  });
}

async function checkSchema(): Promise<HealthCheck> {
  return timed(
    'neon.schema',
    async () => {
      const expected = loadExpectedSchema();
      if (!expected) return { status: 'warn', detail: 'expected-schema.json not found in deployment' };

      const [tables, columns, functions, indexes] = await Promise.all([
        query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
        ),
        query(
          "SELECT table_name || '.' || column_name AS full FROM information_schema.columns WHERE table_schema = 'public'",
        ),
        query(
          "SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' AND routine_type = 'FUNCTION'",
        ),
        query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"),
      ]);

      const have = (rows: any[], key = 'table_name') => new Set(rows.map((r) => r[key] ?? r.full ?? r.routine_name ?? r.indexname));
      const missing: Record<string, string[]> = {};
      const expectList = (map: Record<string, unknown> | string[] | undefined) =>
        Array.isArray(map) ? map : map ? Object.keys(map) : [];

      const compare = (label: string, expectedList: string[], present: Set<string>) => {
        const miss = expectedList.filter((item) => !present.has(item));
        if (miss.length) missing[label] = miss;
        return miss.length;
      };

      const expectedTables = Object.keys(expected.tables || {});
      const expectedColumns = expectedTables.flatMap((table) =>
        Object.keys(expected.tables[table]?.columns || {}).map((col) => `${table}.${col}`),
      );
      const expectedFunctions = expectList(expected.functions);
      const expectedIndexes = expectList(expected.indexes);

      const problems =
        compare('tables', expectedTables, have(tables)) +
        compare('columns', expectedColumns, have(columns)) +
        compare('functions', expectedFunctions, have(functions)) +
        compare('indexes', expectedIndexes, have(indexes));

      if (problems) {
        const summary = Object.entries(missing)
          .map(([k, v]) => `${k}: ${v.slice(0, 5).join(', ')}${v.length > 5 ? ` (+${v.length - 5})` : ''}`)
          .join(' | ');
        return { status: 'fail', detail: `${problems} missing object(s) — ${summary}` };
      }

      let migrations = '';
      try {
        const rows = await query('SELECT count(*)::int AS n FROM _migrations');
        migrations = `, migrations=${rows[0]?.n ?? '?'}`;
      } catch {
        migrations = ', _migrations table missing';
      }
      return {
        status: 'ok',
        detail: `tables=${expectedTables.length} columns=${expectedColumns.length} indexes=${expectedIndexes.length}${migrations}`,
      };
    },
    10000,
  );
}

async function checkR2Bucket(name: string, bucket: string): Promise<HealthCheck> {
  return timed(
    name,
    async () => {
      if (!bucket) return { status: 'skip', detail: 'bucket name not configured' };
      if (!config.r2AccountId || !config.r2AccessKeyId || !config.r2SecretAccessKey) {
        return { status: 'skip', detail: 'R2 credentials not configured' };
      }
      await r2Client().send(new HeadBucketCommand({ Bucket: bucket }));
      return { status: 'ok', detail: bucket };
    },
    8000,
  );
}

async function checkEnvNames(): Promise<HealthCheck> {
  // Names only — never values. Mirrors the boot-time validation so a value
  // that Vercel has (and local does not, or vice versa) shows up here too.
  return timed('env', async () => {
    const required = [
      'CRON_SECRET',
      'PAYU_MERCHANT_KEY',
      'PAYU_SALT',
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_PUBLIC_BASE_URL',
      'JWT_SECRET',
    ];
    const missingRequired = required.filter((k) => !process.env[k]);
    const dbPresent = Boolean(process.env.DATABASE_URL || process.env.DATABASE_URL_APP);
    if (!dbPresent) missingRequired.push('DATABASE_URL');

    const optionalGaps = [
      'DATABASE_URL_UNPOOLED',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'RESEND_API_KEY',
      'WHATSAPP_APP_SECRET',
      'OTP_HASH_PEPPER',
      'SHIPROCKET_EMAIL',
      'SHIPROCKET_PASSWORD',
      'BUSINESS_GSTIN',
    ].filter((k) => !process.env[k]);

    if (missingRequired.length) {
      return { status: 'fail', detail: `missing: ${missingRequired.join(', ')}` };
    }
    if (optionalGaps.length) {
      return { status: 'warn', detail: `optional unset: ${optionalGaps.join(', ')}` };
    }
    return { status: 'ok', detail: 'all required names present' };
  });
}

async function checkShiprocket(): Promise<HealthCheck> {
  return timed(
    'shiprocket',
    async () => {
      if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) {
        return { status: 'skip', detail: 'credentials not configured' };
      }
      await shiprocketAuth.login();
      return { status: 'ok', detail: 'token acquired' };
    },
    10000,
  );
}

async function checkWhatsapp(): Promise<HealthCheck> {
  return timed(
    'whatsapp',
    async () => {
      if (!config.whatsappApiToken) return { status: 'skip', detail: 'token not configured' };
      if (!config.whatsappPhoneNumberId) return { status: 'warn', detail: 'WHATSAPP_PHONE_NUMBER_ID unset' };
      // Read-only Graph lookup: proves the token works without messaging anyone.
      const url = `https://graph.facebook.com/${config.whatsappGraphApiVersion}/${config.whatsappPhoneNumberId}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${config.whatsappApiToken}` } });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { status: 'fail', detail: `Graph ${res.status}: ${body.slice(0, 160)}` };
      }
      return { status: 'ok', detail: 'graph token accepted' };
    },
    8000,
  );
}

/**
 * The WhatsApp templates the pipeline would use right now.
 *
 * This is the check that answers "is the OTP live yet?" - it resolves the
 * template from Meta exactly the way the send path does, so the health report
 * and the actual behaviour can never disagree.
 */
async function checkTemplates(): Promise<HealthCheck> {
  return timed(
    'whatsapp-templates',
    async () => {
      const otp = await getOtpTemplate();
      const invoice = await getInvoiceTemplate();
      const otpLabel = otp.template
        ? `${otp.template.name} (${otp.template.language}, ${otp.template.category})`
        : `not available - ${otp.reason || 'no approved AUTHENTICATION template'}`;
      const invoiceLabel = invoice.template
        ? `${invoice.template.name} (${invoice.template.language}, ${invoice.template.category})`
        : `not available - ${invoice.reason || 'no approved UTILITY template'}`;
      const detail = `otp: ${otpLabel} | invoice: ${invoiceLabel}`;
      // The invoice template is still under Meta review, so its absence is a
      // warning. The OTP template being unavailable is a warning too - the
      // store keeps taking orders either way.
      return { status: 'warn', detail };
    },
    8000,
  );
}

async function checkQueues(): Promise<HealthCheck> {
  return timed(
    'queues',
    async () => {
      const rows = await query(`
        SELECT
          count(*) FILTER (WHERE shiprocket_order_id IS NULL
                             AND status IN ('processing', 'confirmed', 'pending')
                             AND (shiprocket_push_error IS NULL
                                  OR shiprocket_push_error NOT LIKE 'Non-Indian phone number%'))::int AS push_pending,
          count(*) FILTER (WHERE shiprocket_order_id IS NULL
                             AND shiprocket_push_status = 'failed')::int AS push_failed,
          count(*) FILTER (WHERE shiprocket_order_id IS NULL
                             AND shiprocket_push_status = 'in_progress'
                             AND shiprocket_push_started_at < NOW() - INTERVAL '10 minutes')::int AS push_stuck,
          count(*) FILTER (WHERE invoice_number IS NOT NULL
                             AND invoice_sent_at IS NULL
                             AND created_at < NOW() - INTERVAL '1 hour')::int AS invoice_unsent
        FROM orders
      `);
      const q = rows[0] || {};
      const detail = `push_pending=${q.push_pending} push_failed=${q.push_failed} push_stuck=${q.push_stuck} invoice_unsent=${q.invoice_unsent}`;
      const bad = (q.push_failed || 0) > 0 || (q.push_stuck || 0) > 0 || (q.invoice_unsent || 0) > 0;
      return { status: bad ? 'warn' : 'ok', detail };
    },
    8000,
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runDeepHealth(): Promise<DeepHealthReport> {
  const started = Date.now();
  const checks = await Promise.all([
    checkNeon(),
    checkSchema(),
    checkR2Bucket('r2.media', config.r2BucketMedia),
    checkR2Bucket('r2.invoices', config.r2BucketInvoices),
    checkEnvNames(),
    checkShiprocket(),
    checkWhatsapp(),
    checkTemplates(),
    checkQueues(),
  ]);

  const failed = checks.filter((c) => c.status === 'fail');
  const warned = checks.filter((c) => c.status === 'warn');
  const status: DeepHealthReport['status'] = failed.length ? 'error' : warned.length ? 'degraded' : 'ok';

  return {
    status,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - started,
    checks,
  };
}
