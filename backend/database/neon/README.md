# Canonical Neon migrations

Ek hi source of truth for the live schema. Supabase-era `database/deltas/` and
`sql/migrations/` are historical; anything new goes here.

## Rules

- **Additive only** — the runner refuses `DROP` / `TRUNCATE` / `DELETE FROM`.
- **Idempotent** — every statement is `IF NOT EXISTS` / `OR REPLACE`, so a
  hand-applied schema baselines cleanly and a re-run is a no-op.
- **Never edit an applied file** — `scripts/migrate.js` stores a sha256 in
  `public._migrations` and fails with `DRIFT` if a recorded file changed.
  Add a new numbered file instead.
- Runner owns the transaction: a file's own `BEGIN`/`COMMIT` is stripped.

## Files

| File | What |
| --- | --- |
| `001_2026-10-20_neon_schema_align.sql` | Tables/columns the API reads (OTP, WhatsApp log, review requests, invoice + Shiprocket bookkeeping, analytics, profile) |
| `002_2026-10-20_indexes.sql` | FK indexes, orders status/payment composites, storefront visibility, trigram search |
| `expected-schema.json` | The contract `npm run db:verify` compares against `information_schema` |

## Commands

```bash
npm run db:migrate:dry   # list pending, execute nothing
npm run db:migrate       # apply pending (DATABASE_URL_UNPOOLED)
npm run db:verify        # fail on any missing table/column/function/index
node scripts/db-verify.js --emit   # refresh expected-schema.json (review the diff!)
```

`npm run db:verify` must stay green before every deploy — it is what catches a
migration that never reached an environment.
