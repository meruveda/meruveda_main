# SETUP — WhatsApp OTP at checkout

Exact order. Do not skip a step; each one gates the next.

```bash
# 1. fill backend/.env (never commit it)
# 2. npm run preflight
# 3. npm run db:migrate:pending
# 4. npm run wa:verify
# 5. npm run otp:smoke -- +91XXXXXXXXXX
```

---

## 1. Fill `backend/.env`

Copy `backend/.env.example` to `backend/.env` (or fill the existing one). Every
value below is read from the environment — no code change is needed once they are
set.

| Variable | Required | Where to get it |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_KEY` *or* `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase → Project Settings → API → service_role |
| `SUPABASE_DB_PASSWORD` *or* `SUPABASE_DB_URL` | for the migration | Supabase → Project Settings → Database |
| `JWT_SECRET` | yes | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `OTP_HASH_PEPPER` *or* `OTP_HASH_SECRET` | yes | same generator as above. **Do not reuse `JWT_SECRET`** |
| `WHATSAPP_TOKEN` *or* `WHATSAPP_API_TOKEN` | yes | Meta Business Manager → WhatsApp → API Setup → Temporary access token |
| `WHATSAPP_PHONE_NUMBER_ID` | yes | WhatsApp → Phone numbers → your number → **API Setup** → "Phone number ID" |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | for `wa:verify` | WhatsApp → Settings → Account ID |
| `WHATSAPP_OTP_TEMPLATE_NAME` | yes | Meta → Message Templates → the **exact** approved name |
| `WHATSAPP_ORDER_TEMPLATE_NAME` | optional | same |
| `WHATSAPP_REVIEW_TEMPLATE_NAME` | optional | same |
| `WHATSAPP_TEMPLATE_LANG` | yes | must match the template, usually `en` |
| `WHATSAPP_DRY_RUN` | no | `false` in production |

Either-spelling pairs (`WHATSAPP_TOKEN`/`WHATSAPP_API_TOKEN`,
`OTP_HASH_PEPPER`/`OTP_HASH_SECRET`, `SUPABASE_SERVICE_KEY`/`SUPABASE_SERVICE_ROLE_KEY`)
both work; the first non-empty value wins. `WHATSAPP_DRY_RUN=true` logs a send
instead of dispatching it — it is for local work only and must never be `true` in
production.

## 2. `npm run preflight`

One table covering every gate: env vars, migration bundle safety, backup,
schema, Meta token, phone id, template, review fixtures. Read-only — safe to run
any number of times, safe on production.

## 3. `npm run db:migrate:pending`

Applies `backend/database/pending-migration.sql` over a direct Postgres
connection. No Supabase dashboard needed. It refuses to run unless, in order:

1. a connection env var is present (a missing one is named, not thrown)
2. the SQL contains no `DROP` / `TRUNCATE` / `DELETE` / `UPDATE`
3. `db:verify:backup` reports **RESTORABLE**
4. row counts for `users`, `orders`, `order_items`, `media`, `products` are recorded

Then it runs the whole bundle in **one transaction** and re-compares the counts,
printing PASS/FAIL. Any drift is a FAIL.

Delta `002` is deliberately excluded: `ALTER TABLE ... RENAME COLUMN` has no
`IF EXISTS` guard, so it is not idempotent and would abort a run partway.

Add `--dry-run` to see the preflight table without executing anything.

## 4. `npm run wa:verify`

Checks, in order: the token is accepted by Graph; the System User actually has a
WhatsApp Business Account assigned; `WHATSAPP_PHONE_NUMBER_ID` resolves to a real
number; and every configured template name appears among the APPROVED templates
with the expected language and variable count.

Two failures are common and both are fixed in the Meta console, not in code:

- **Graph error 100 / subcode 33 on the phone id** — either the id is wrong, or
  the System User has no WABA assigned
  (Business Settings → Users → System Users → your employee → Assign Assets →
  WhatsApp Business Account).
- **Template not in the approved list** — `WHATSAPP_OTP_TEMPLATE_NAME` does not
  match an approved template exactly. Copy the name from Meta; do not guess.

`npm run wa:verify:send` sends one real test message, and refuses to fire unless
the template is confirmed approved.

## 5. `npm run otp:smoke -- +91XXXXXXXXXX`

Sends a real OTP through the same service the checkout uses, prompts for the
code, verifies it, prints PASS/FAIL.

It refuses to run under `WHATSAPP_DRY_RUN=true`, with no token, or with no
pepper — because those configurations would "pass" while sending nothing.

---

## Static reviews

`frontend/src/data/reviews.json` ships with an empty array plus two entries
flagged `"placeholder": true`. They are layout fixtures: filtered out of every
render and out of `aggregateRating`, and **`npm run build` FAILS while any
placeholder is present** — so a production bundle can never ship dummy text or
dummy customer names.

Until a real, permissioned review is added, a production build will therefore be
refused. That is intentional. To unblock a deploy, either delete the placeholder
entries or replace them with real ones.

**Never invent a review.** No name, city, rating, date or review text that was
not given by a real customer who agreed to publish it.

## Recovery

The migration never deletes data, so it does not need undoing. To replay rows:

```bash
npm run db:backup          # take a fresh snapshot first
npm run db:restore         # dry run — prints the plan, writes nothing
npm run db:restore -- --apply
```

Never reset the Supabase project; that destroys what the snapshot depends on.