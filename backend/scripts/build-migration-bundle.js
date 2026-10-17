/**
 * Assemble the pending migrations into one reviewable SQL bundle.
 *
 * There is no DDL path from this repo (PostgREST exposes zero RPCs and the
 * service key cannot run DDL), so a human pastes the result into the Supabase
 * SQL editor. Generating it from the delta files — rather than hand-writing a
 * copy — means the bundle cannot drift from the source of truth.
 *
 * Selection is explicit, never "everything not yet applied":
 *   - 001, 002, 003, 004, 007 are ALREADY applied. 002 in particular is not
 *     idempotent (ALTER TABLE ... RENAME COLUMN has no IF EXISTS guard), so
 *     including it would abort the run partway.
 *   - 008 is an exact subset of 006 and is left inert in the tree.
 * So the bundle is exactly 005 -> 006 -> 009 -> 010, in that order.
 *
 * Usage:
 *   node scripts/build-migration-bundle.js              -> database/pending-migration.sql
 *   node scripts/build-migration-bundle.js --out=x.sql
 *   node scripts/build-migration-bundle.js --check      -> verify the bundle matches the deltas
 */
const fs = require('fs');
const path = require('path');

const DELTAS_DIR = path.join(__dirname, '..', 'database', 'deltas');
const DEFAULT_OUT = path.join(__dirname, '..', 'database', 'pending-migration.sql');

/** Ordered, with the reason each one is or is not included. */
const PLAN = [
  { file: '005_otp_whatsapp_review_requests.sql', why: 'OTP store, WhatsApp send log, review requests, RLS' },
  { file: '006_missing_columns.sql', why: 'orders.delivered_at + reviews.is_featured/reply' },
  { file: '009_page_views.sql', why: 'page_views + users.phone_verified' },
  { file: '010_auto_invoice_shiprocket.sql', why: 'invoice + Shiprocket push bookkeeping' },
];

const EXCLUDED = [
  ['001_shiprocket_migration.sql', 'already applied (18/18 objects present)'],
  ['002_media_migration.sql', 'already applied AND not idempotent — RENAME COLUMN has no IF EXISTS guard'],
  ['003_missing_tables_and_transactions.sql', 'already applied'],
  ['004_banners_migration.sql', 'already applied'],
  ['007_mobile_auth.sql', 'already applied'],
  ['008_reviews_is_featured.sql', 'exact subset of 006 — left inert in the tree'],
];

const header = `-- =====================================================================
-- MeruVeda pending migration bundle
-- GENERATED FILE — do not hand-edit.
-- Regenerate: npm run db:bundle   (node scripts/build-migration-bundle.js)
--
-- Target project : pfklokcgcppdmrqgukmr
-- Includes        : 005 -> 006 -> 009 -> 010
-- Excludes        : 001, 002, 003, 004, 007 (already applied), 008 (superseded by 006)
--
-- WHY A BUNDLE: this repository has no DDL path. The Supabase service-role key
-- speaks PostgREST only, and this project exposes zero SQL-executing RPCs, so
-- the only way to apply schema is a direct connection or this file pasted into
-- the Supabase SQL editor.
--
-- ZERO DATA RISK: every statement is ADD COLUMN IF NOT EXISTS / CREATE TABLE IF
-- NOT EXISTS / CREATE INDEX IF NOT EXISTS / ALTER ... ENABLE ROW LEVEL SECURITY.
-- There is no DROP, TRUNCATE, DELETE or UPDATE of existing rows, so customers,
-- products, orders, order_items, media, reviews and categories are untouched.
-- The three newly created tables cannot already exist, so no DROP POLICY is
-- needed for them either.
--
-- The four deltas are mutually independent (005 touches users + new tables,
-- 006 touches orders + reviews, 009 touches users + a new table, 010 touches
-- orders), so order is not load-bearing - it is kept ascending for review only.
-- =====================================================================

BEGIN;

`;

const footer = `
COMMIT;

-- =====================================================================
-- VERIFY — run this after COMMIT. Every row must return.
-- Expected: 5 objects from 005, 3 from 006, 2 from 009, 6 from 010 = 16.
-- =====================================================================
SELECT table_name AS object, 'table' AS kind
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('otps', 'whatsapp_message_log', 'review_requests', 'page_views')
UNION ALL
SELECT table_name || '.' || column_name, 'column'
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (   (table_name = 'users'    AND column_name IN ('address', 'last_login_at', 'phone_verified'))
         OR (table_name = 'orders'   AND (column_name LIKE 'invoice_%' OR column_name LIKE 'shiprocket_push%'))
         OR (table_name = 'reviews'  AND column_name IN ('is_featured', 'reply'))
         OR (table_name = 'orders'   AND column_name = 'delivered_at') )
 ORDER BY 1;

-- RLS must be on for the three sensitive tables (relrowsecurity = t).
SELECT relname, relrowsecurity
  FROM pg_class
 WHERE relname IN ('otps', 'whatsapp_message_log', 'review_requests')
 ORDER BY relname;

-- ROLLBACK: this bundle never deletes data, so it does not need undoing. To
-- restore ROW data anyway (e.g. a partial restore), use the verified snapshot:
--   npm run db:backup                 take a fresh one first
--   node scripts/restore-data.js      dry run - shows the plan, writes nothing
--   node scripts/restore-data.js --apply
-- Do NOT reset the Supabase project; that destroys data this snapshot relies on.
`;

function build() {
  const parts = [header];
  for (const { file, why } of PLAN) {
    const p = path.join(DELTAS_DIR, file);
    if (!fs.existsSync(p)) throw new Error(`missing delta: ${file}`);
    const sql = fs.readFileSync(p, 'utf8').replace(/\s+$/, '');
    parts.push(`\n-- ${'-'.repeat(68)}\n-- ${file}\n-- ${why}\n-- ${'-'.repeat(68)}\n\n${sql}\n`);
  }
  parts.push(footer);
  return parts.join('');
}

function main() {
  const outArg = (process.argv.find((a) => a.startsWith('--out=')) || '').split('=')[1];
  const outPath = outArg || DEFAULT_OUT;
  const content = build();

  if (process.argv.includes('--check')) {
    const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
    if (existing === content) {
      console.log(`${path.basename(outPath)} is up to date with the deltas.`);
      return;
    }
    console.error(`${path.basename(outPath)} DOES NOT match the deltas. Re-run: npm run db:bundle`);
    process.exit(1);
  }

  fs.writeFileSync(outPath, content);

  const destructive = content.match(/^\s*(DROP\s+(TABLE|POLICY|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/im);
  console.log(`Wrote ${path.relative(process.cwd(), outPath)}`);
  console.log(`  includes : ${PLAN.map((p) => p.file.replace(/_.*\.sql$/, '')).join(' -> ')}`);
  console.log(`  excludes : ${EXCLUDED.map(([f]) => f.replace(/_.*\.sql$/, '')).join(', ')}`);
  for (const [f, why] of EXCLUDED) console.log(`             ${f.replace(/_.*\.sql$/, '')} — ${why}`);
  console.log(`  lines    : ${content.split('\n').length}`);
  console.log(`  destructive statements: ${destructive ? destructive[0].trim() : 'none'}`);
  console.log('  Run this in the Supabase SQL editor, then run the VERIFY block at the end.');
}

main();