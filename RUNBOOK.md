# Meruveda Runbook

Operational commands for the Neon Postgres + Cloudflare R2 + Vercel stack.
Nothing here prints or stores a secret. Values live in `backend/.env` (local)
and Vercel project env (production + preview).

## Stack

| Piece | Where |
|---|---|
| Storefront (Next.js) | Vercel — `meruveda` project, `frontend/` |
| Admin (React) | Vercel — `meruveda_admin` project, `admin/` |
| API (Express) | Vercel — `meruveda_main` project, `backend/` |
| Database | Neon Postgres (pooled at runtime, unpooled for DDL) |
| Media + invoice PDFs | Cloudflare R2 buckets `meruveda-media`, `meruveda-invoices` |
| Payments | PayU (hash-verified callbacks) |
| Fulfilment | Shiprocket (server-to-server) |

Runtime DB role is `meruveda_app` (DML only) — created by `npm run db:role`.
Owner credentials are used only for migrations.

## Health

```bash
# Liveness (public): SELECT 1 only
curl https://meruvedawellness.com/api/health

# Deep health (auth required: CRON_SECRET bearer or admin JWT)
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://meruvedawellness.com/api/health/deep
```

Deep health checks: Neon connectivity, schema drift vs
`backend/database/neon/expected-schema.json`, both R2 buckets (HeadBucket),
env var names (never values), Shiprocket auth, WhatsApp Graph auth, and the
queues (orders awaiting Shiprocket push, invoices not sent). HTTP 503 when any
check fails; `status: degraded` when only warnings.

## Schema

```bash
npm run db:migrate            # apply backend/database/neon/*.sql (idempotent)
npm run db:migrate:dry        # show what would run, no writes
npm run db:verify             # compare live schema vs expected-schema.json
npm run db:verify:all         # include pending (unapplied) files
npm run db:role               # create/sync meruveda_app least-privilege role
```

`db:verify` exits non-zero on drift. DRIFT on an already-applied migration
means the live schema changed outside the files — investigate before deploying.
The API also logs `[schemaGuard] MISSING SCHEMA OBJECT` at boot when a
required object is absent.

## Environment parity

```bash
node backend/scripts/env-parity.js            # .env.example vs local .env
node backend/scripts/env-parity.js --vercel   # + Vercel production & preview
```

Names only, never values. Core variables missing anywhere => exit 1.
New variable? Add it to `backend/.env.example` first, then local `.env`,
then `vercel env add NAME production,preview --force --yes --sensitive`.

## R2

```bash
cd backend
node scripts/r2-verify.js      # creds format, HeadBucket, put/get/delete, presign
```

Bucket names are env (`R2_BUCKET_*`), public reads go through
`R2_PUBLIC_BASE_URL`. Invoices are private: served only via presigned GETs.
`meruveda-invoices` must have its r2.dev subdomain **disabled** in the R2
dashboard, otherwise object URLs are world-readable.

## Backup / restore

```bash
npm run db:backup              # full JSON backup -> backend/backups/
npm run db:backup:verify       # check the newest backup is restorable
npm run db:restore             # restore the newest backup (writes to Neon)
npm run db:restore:rehearse    # restore into a scratch schema - the rehearsal
```

The backup endpoint also writes the dump to the PRIVATE R2 bucket under
`backups/` (the last 14 are kept):

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://meruvedawellness.com/api/jobs/backup
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://meruvedawellness.com/api/jobs/backup/verify
```

Before any risky migration, take a backup first. Backups are gitignored.

## Cron (Vercel)

| Schedule | Endpoint | Purpose |
|---|---|---|
| `*/15 * * * *` | `GET /api/jobs/sweep?limit=20` | the pipeline sweep: retry pushes, retry invoices, poll tracking |
| `0 10 * * *` | `GET /api/jobs/review-requests` | review request messages |
| `0 3 * * *` | `GET /api/orders/retry-shiprocket-failed?limit=20` | retry failed pushes |
| `30 3 * * *` | `GET /api/jobs/retry-failures?limit=15` | general retry sweep |

Auth: `Authorization: Bearer $CRON_SECRET` (Vercel sends it automatically once
`CRON_SECRET` is set). Manual run: `curl -H "Authorization: Bearer $CRON_SECRET" <url>`.

The sweep also runs on its own: after every new order, when an admin opens the
orders list or an order, and when a customer opens their tracking page. It is
throttled to once a minute, so none of those add real cost.

## Rate limits

OTP send: 30s cooldown per number, 5/hour per number, 500/day globally
(`OTP_DAILY_SEND_CAP`), plus 5/10min per phone and 20/10min per IP.
Login 20/15min, quick-login 10/10min, order create 20/10min,
coupon validate 20/min, track-awb 30/min. Store is Upstash Redis when
`UPSTASH_REDIS_REST_URL/TOKEN` are set; otherwise per-instance memory (a loud
warning prints in production — limits then reset on cold start).

## Incident: connection strings in errors

Postgres (Neon) error messages can embed the full connection string. The API
redacts `postgres://…` in every error response and log via
`redactSecrets()` in `backend/src/app.ts`, and `/api/health` returns a generic
`Database unavailable`. If a secret ever leaks anyway: rotate the password in
the Neon console, update `DATABASE_URL`/`DATABASE_URL_UNPOOLED`/
`DATABASE_URL_APP` locally and on Vercel (prod + preview), redeploy, then
re-run `/api/health/deep` and `node backend/scripts/env-parity.js --vercel`.

## Deploy

```bash
npm run lint                  # workspaces
npm test -w backend           # must be green before pushing
npm run build                 # shared + frontend + admin + backend
node backend/scripts/env-parity.js --vercel
git push origin feat/neon-migration   # never to main directly
```

Preview deploys are deployment-protected — smoke them with:
`npx vercel curl <preview-url> -- <path>`.

## Rollback

1. `vercel rollback` (or promote a previous deployment in the dashboard).
2. DB changes are forward-only: restore a backup with `npm run db:restore`
   only if a migration corrupted data — never as a routine step.
3. Env changes: `vercel env rm NAME production,preview` then re-add the old
   value; deployments pick it up on the next deploy.
