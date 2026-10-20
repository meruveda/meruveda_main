# SETUP — WhatsApp OTP at checkout

Exact order. Do not skip a step; each one gates the next.

```bash
# 1. fill backend/.env (never commit it)
# 2. npm run go-live          <- does everything below and tells you what is left
# 3. npm run otp:smoke -- +91XXXXXXXXXX
```

`npm run go-live` runs steps 2–4 below in one command, stops at the first
failure, prints one PASS/BLOCKED table and the exact next commands, and never
prints a secret value (only variable names, as set / missing). It is safe to
run twice — an already-applied schema is skipped cleanly — and it never sends a
WhatsApp message by itself.

---

## 1. Fill `backend/.env`

Copy `backend/.env.example` to `backend/.env` (or fill the existing one). Every
value below is read from the environment — no code change is needed once they
are set.

| Variable | Required | Where to get it |
|---|---|---|
| `DATABASE_URL` *or* `DATABASE_URL_APP` | yes | Neon → the pooled connection string |
| `DATABASE_URL_UNPOOLED` | for migrations | Neon → the direct (non-pooler) connection string |
| `R2_ACCOUNT_ID` | yes | Cloudflare R2 → Account ID |
| `R2_ACCESS_KEY_ID` *or* `R2_SECRET_ACCESS_KEY` | yes | Cloudflare R2 → API Tokens → Object Read & Write |
| `R2_PUBLIC_BASE_URL` | yes | the bucket's `pub-xxx.r2.dev` host, or your own domain |
| `JWT_SECRET` | yes | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `OTP_HASH_PEPPER` *or* `OTP_HASH_SECRET` | yes | same generator as above. **Do not reuse `JWT_SECRET`** |
| `WHATSAPP_TOKEN` *or* `WHATSAPP_API_TOKEN` | yes | Meta Business Manager → WhatsApp → API Setup → Temporary access token |
| `WHATSAPP_PHONE_NUMBER_ID` | yes | WhatsApp → Phone numbers → your number → **API Setup** → "Phone number ID" |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | for `wa:verify` | WhatsApp → Settings → Account ID |
| `WHATSAPP_OTP_TEMPLATE_NAME` | yes | Meta → Message Templates → the **exact** approved name. Must be an **AUTHENTICATION** template (e.g. `meruveda_otp`) |
| `WHATSAPP_TEMPLATE_LANG` | yes | must match the template, usually `en` |
| `OTP_ENABLED` | yes | `true` turns on the checkout OTP endpoints |
| `WHATSAPP_DRY_RUN` | no | `false` in production — the server refuses to boot with it `true` |
| `WHATSAPP_INVOICE_ENABLED` | no | `false` (default) = no WhatsApp invoice. See "Invoices" below |
| `WHATSAPP_INVOICE_TEMPLATE_NAME` | with the invoice flag | the approved UTILITY invoice template |
| `ADMIN_WHATSAPP_NUMBER` | no | gets a copy of every invoice |

Either-spelling pairs (`WHATSAPP_TOKEN`/`WHATSAPP_API_TOKEN`,
`OTP_HASH_PEPPER`/`OTP_HASH_SECRET`, `DATABASE_URL`/`DATABASE_URL_APP`)
both work; the first non-empty value wins. `WHATSAPP_DRY_RUN=true` logs a send
instead of dispatching it — it is for local work only and must never be `true`
in production.

## 2. `npm run go-live` (runs 3, 4 and 5 below)

One command, five gates, first failure stops the run:

1. **ENV** — every required variable reported as set/missing *by name only*;
   optional ones warned about. Missing required stops here.
2. **BACKUP** — the latest snapshot must report `RESTORABLE`, else it stops.
3. **MIGRATE** — the schema is verified first; if it is already applied this is
   a clean skip. Otherwise the bundle SQL is re-scanned for
   `DROP`/`TRUNCATE`/`DELETE` (and an unguarded `UPDATE`), row counts for
   `users`, `orders`, `order_items`, `media`, `products` are recorded, the
   migration runs **once** in a single transaction with no retry, the schema is
   re-verified, and the row counts must be identical afterwards.
4. **META** — `wa:verify` with no `--send`: the token is valid, the WABA is
   assigned, the phone id resolves, and the OTP template is APPROVED, in the
   AUTHENTICATION category, with the exact `WHATSAPP_TEMPLATE_LANG`. The invoice
   template is checked too when the invoice flag is on.
5. **TABLE** — PASS/BLOCKED per item, what is missing, and the exact next
   commands.

## 3. `npm run db:migrate:pending`

Applies `backend/database/pending-migration.sql` over a direct Postgres
connection. No dashboard is needed. It refuses to run unless, in order:

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
with the expected language and category. Both the template NAME and the LANGUAGE
come from `.env` — nothing is hardcoded, so this validates exactly what the app
sends. It exits non-zero when any check fails.

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

**The one manual step, and the only one that proves anything.** It sends a real
six-digit OTP through the same service the checkout uses, prompts you to type the
code, verifies it, and prints PASS/FAIL.

It refuses to run under `WHATSAPP_DRY_RUN=true`, with no token, or with no
pepper — because those configurations would "pass" while sending nothing.

**Nothing in this document proves OTP delivery.** Until `otp:smoke` passes on a
real number, treat WhatsApp OTP as unverified.

---

## Invoices on WhatsApp

Off by default. Set `WHATSAPP_INVOICE_ENABLED=true` to turn it on; with it off
nothing about the order flow changes.

When on, the invoice goes out after the order is saved:

- **COD** — right after the order is accepted.
- **PayU** — only after the payment callback has confirmed payment.

It reuses the single existing invoice PDF generator. One order sends one invoice:
the sent flag and timestamp live in the per-order invoice state, so repeat
triggers are no-ops and `POST /api/orders/:id/resend-invoice` (admin) can only
re-attempt an invoice that was never delivered. A WhatsApp failure never blocks
or rolls back the order or the PayU callback — it is logged and retried. Every
attempt is recorded in `whatsapp_message_log`, and a copy goes to
`ADMIN_WHATSAPP_NUMBER` when that is set.

`WHATSAPP_INVOICE_MODE` picks the shape: `document` attaches the PDF in the
template's document header (4 body variables); `link` sends no attachment and
puts a **signed, expiring** URL in the body as `{{5}}` — never a guessable order
id. Match the mode to your approved template's variable count.

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

Never drop the Neon branch; that is what the snapshot depends on.