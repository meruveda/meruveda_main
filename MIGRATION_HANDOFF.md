# Migration handoff (closed)

The move off the old storage provider is **complete**. There is no reference to
it left in the code, the environment, the docs or the Vercel project.

## Where things live now

| Concern | Owner |
|---|---|
| Database | Neon Postgres (`backend/database/neon/`, applied with `npm run db:migrate`) |
| Product / banner / blog / media images | Cloudflare R2, `meruveda-media` bucket |
| Tax invoices (private) | Cloudflare R2, `meruveda-invoices` bucket, presigned URLs |
| Hosting | Vercel (`vercel.json`, three services) |

## What replaced what

- The old client module and its package dependency are gone; every query goes
  through `backend/src/database/db.ts`.
- `backend/database/deltas/` and `backend/sql/` are gone;
  `backend/database/neon/` is the only migration directory.
- The image proxy allowlists exactly one host: the R2 public domain.
- `npm run go-live` checks the Neon + R2 environment, the backup, the
  migration safety, the row counts and the WhatsApp templates.

## Live documentation

- `RUNBOOK.md` — env, deploy, rollback, rotation, restore, health, crons.
- `backend/database/neon/README.md` — the migration rules.
- `SETUP.md` — first-time setup.
