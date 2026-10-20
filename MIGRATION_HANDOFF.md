# Neon + R2 migration handoff

Status: **PHASE A done** (offline code migration, no network calls). PHASE B
starts only after the 5 Neon/R2 env keys and 2 R2 buckets are added.

Branch: `feat/neon-migration`. Nothing has been pushed or merged.

## What changed

- Postgres access goes through `backend/src/database/db.ts` (`@neondatabase/serverless`
  HTTP client + `pg` `Pool` for transactions) and `backend/src/database/repos/*`.
  No `.rpc()`, `.auth.*`, Realtime or Edge Functions were in use.
- Every service/controller that used Supabase now uses a repo. The only file
  that still imports `@supabase/supabase-js` is the unused compatibility module
  `backend/src/database/supabase.ts` (zero importers).
- Storage goes through `backend/src/services/r2.ts` + `storageService.ts`
  (Cloudflare R2, `@aws-sdk/client-s3`), including invoice PDFs and the
  `IfNoneMatch` conditional put used for atomic invoice claims.
- Invoice numbers are assigned in Postgres by `assign_invoice_number()`
  (per-order idempotent, per-financial-year sequence).
- Frontend reads remote images through `/api/images/fetch`; the hardcoded
  Supabase `remotePatterns` in `frontend/next.config.ts` is now derived from
  `R2_PUBLIC_BASE_URL`, and `HeroCarousel` uses `next/image`.

## Env keys

Set (values were already present; never printed):
`JWT_SECRET`, `OTP_HASH_PEPPER`, `WHATSAPP_API_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `PAYU_MERCHANT_KEY`, `PAYU_SALT`,
`SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`.

Required and still missing (report only as names):
`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `WHATSAPP_OTP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG`.

Optional (defaults are used): `R2_BUCKET_MEDIA` (`meruveda-media`),
`R2_BUCKET_INVOICES` (`meruveda-invoices`), `R2_PUBLIC_BASE_URL`,
`WHATSAPP_DRY_RUN`, `NEON_MIGRATION_DRY_NOTIFY`.

Keep every `SUPABASE_*` var in place until PHASE B is verified.

## PHASE B checklist

1. Create the R2 buckets by hand: `meruveda-media` (public),
   `meruveda-invoices` (private). No runtime `createBucket`.
2. Apply the schema on a Neon branch / `rehearsal` schema first:
   - base `deltas/001`-`004`, then
   - `psql "$DATABASE_URL_UNPOOLED" -f backend/sql/migrations/2026-10-19_neon_pending_deltas.sql`.
   - Do **not** run the Supabase RLS/policy files (`2026-10-14_row_level_security.sql`,
     `deltas/004`'s `service_role` policy).
3. Move data:
   - `node scripts/rewrite-urls.js --snapshot backups/snapshot-*.json --apply`
     writes `<snapshot>.r2.json` (input snapshot is never modified).
   - `node scripts/upload-assets.js --apply` uploads cached originals to R2
     (`--fetch-missing` pulls the rest from Supabase while it is still up).
   - restore rows from the rewritten snapshot (see gaps below).
4. Smoke tests, write-path only on the Neon branch, with
   `NEON_MIGRATION_DRY_NOTIFY=1`: OTP send, order create, PayU initiate,
   invoice claim/PDF, Shiprocket push. Invoice numbers must not be consumed in
   tests.
5. Verify schema/row counts against the snapshot, then cut over and only then
   remove `SUPABASE_*`.

## Verification run in PHASE A

- `backend`: `npx tsc --noEmit` clean; `npm test` -> **276 pass / 0 fail**.
- `admin`: `npm run lint` -> 0 errors (170 pre-existing warnings);
  `npm run type-check` clean.
- `frontend`: `npm test` -> **34 pass / 0 fail**; `npx tsc --noEmit` clean.
- `frontend` `npm run lint` fails on **pre-existing** errors in
  `frontend/scripts/check-reviews.cjs` (CJS globals under an ESM config); the
  file is untouched by this migration. NOT VERIFIED as new.
- Live Neon schema/rows and all write-path smoke tests: **NOT VERIFIED
  (needs Neon)**.

## Remaining PHASE A gaps (known, not yet done)

- `backend/scripts/backup-data.js` and `restore-data.js` still write/read
  through Supabase PostgREST. They need a `pg`/Neon path before step 3 above.
- `backend/scripts/verify-schema.js` treats any PostgREST error (incl. 402) as
  "MISSING"; re-point it at `information_schema` via Neon.
- `backend/src/database/supabase.ts` compatibility module is retained but has
  zero importers; delete once PHASE B is verified.
- `backend/database/deltas/002_media_migration.sql` is a one-time destructive
  RENAME and is not idempotent; run it only on a fresh base schema.

## Scripts added

- `backend/scripts/upload-assets.js` (dry-run default, `--apply`, `--fetch-missing`).
- `backend/scripts/rewrite-urls.js` (dry-run default, `--apply`, `--check`,
  `--root`, `--snapshot`/`--out`).
- npm scripts: `assets:upload[:apply]`, `urls:rewrite[:apply]`,
  `urls:rewrite:check`.
