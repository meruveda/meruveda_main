# Database migrations — exact run order

All SQL is **additive-only and idempotent** (every statement is
`CREATE ... IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `CREATE OR REPLACE`).
Re-running any file is safe. Nothing drops, truncates, or deletes.

**Never run migrations against production from a script** — paste into the
Supabase SQL editor (or `psql` with the service-role connection) and run once,
by hand, in the order below.

## Run order

| Step | File | Contents |
|------|------|----------|
| 1 | `deltas/001_shiprocket_migration.sql` | Shiprocket columns on products/orders |
| 2 | `deltas/002_media_migration.sql` | media.storage_path |
| 3 | `deltas/003_missing_tables_and_transactions.sql` | missing tables + order tracking columns |
| 4 | `deltas/004_banners_migration.sql` | banners table |
| 5 | `deltas/005_otp_whatsapp_review_requests.sql` | otps, whatsapp_message_log, review_requests, users.address/last_login_at |
| 6 | `deltas/006_missing_columns.sql` | orders.delivered_at, reviews.is_featured/reply |
| 7 | `deltas/007_mobile_auth.sql` | users.reset_password_token/expires, phone indexes |
| 8 | `deltas/008_reviews_is_featured.sql` | (duplicate of 006 reviews part — idempotent, safe) |
| 9 | `deltas/009_page_views.sql` | page_views table, users.phone_verified |
| 10 | `deltas/010_auto_invoice_shiprocket.sql` | invoice_sent_at/invoice_error, shiprocket_push_* |
| 11 | `sql/migrations/2026-10-14_invoice_sequence.sql` | orders.invoice_number, invoice_sequences counter, `assign_invoice_number()` |
| 12 | `sql/migrations/2026-10-14_row_level_security.sql` | RLS enabled + forced on all public tables, all policies dropped (deny-all to anon/authenticated), storage bucket visibility |

**Live database already at delta 010?** Run only steps 11 and 12 (or the
consolidated copy below for step 11).

Step 12 is a **security lockdown**: after it runs, the anon key cannot read any
table. That is intended — the storefront and admin panel go through the backend
(service-role key), which bypasses RLS. Read the "BEFORE YOU RUN IT" notes in
that file, and check your existing policies first.

**Consolidated convenience copy:** `PENDING_DELTAS.sql` contains steps 5–11 in
one script (including the invoice sequence). It does **not** contain steps 1–4
— for a fresh database, run `deltas/001`–`004` first, then `PENDING_DELTAS.sql`
once. The per-feature `deltas/` files remain the source of truth; keep
`PENDING_DELTAS.sql` in sync when adding a delta.

## Feature ↔ schema ↔ backend-guard map

| Feature | Delta(s) | Schema objects | Backend guard (feature disabled until applied) |
|---------|----------|----------------|------------------------------------------------|
| Shiprocket shipping | 001, 003 | products/orders shipping columns | `schemaGuard.hasColumn` in shiprocket service |
| Media storage paths | 002 | media.storage_path | `hasColumn('media','storage_path')` |
| OTP login | 005 | otps table | `hasTable('otps')` |
| WhatsApp delivery log | 005 | whatsapp_message_log | `hasTable('whatsapp_message_log')` |
| Review-request job | 005 | review_requests | `hasTable('review_requests')` |
| OTP profile fields | 005 | users.address, last_login_at | `hasColumn('users','address')` |
| Guest order tracking | 006 | orders.delivered_at | `hasColumn('orders','delivered_at')` |
| Featured reviews | 006/008 | reviews.is_featured | `hasColumn('reviews','is_featured')` |
| Review replies | 006/008 | reviews.reply | `hasColumn('reviews','reply')` |
| Mobile-number auth | 007 | users.reset_password_token/expires | `hasColumn('users','reset_password_token')` |
| Pageview analytics | 009 | page_views | `hasTable('page_views')` |
| Quick-login phone check | 009 | users.phone_verified | `hasColumn('users','phone_verified')` |
| Auto GST invoice send | 010 | orders.invoice_sent_at/invoice_error | `hasColumn('orders','invoice_sent_at')` |
| Single-flight Shiprocket push | 010 | orders.shiprocket_push_* | `hasColumn('orders','shiprocket_push_status')` |
| Admin panel columns | — (011 in PENDING_DELTAS) | blogs/categories/support_tickets columns | `hasColumn` per table |
| GST invoice series `MV/25-26/000123` | 11 (invoice_sequence) | orders.invoice_number, invoice_sequences, `assign_invoice_number()` | falls back to legacy `MW-INV-<order>` numbering with a warning until applied |

## Post-apply verification

Run the queries in the `VERIFY` section at the bottom of `PENDING_DELTAS.sql`.
Key checks: all listed columns exist, the five new tables exist,
`assign_invoice_number` exists in `pg_proc`, and no order has a duplicate
`invoice_number`.

Known cosmetic quirk: deltas 001 and 003 both add some Shiprocket order
columns with different types (`VARCHAR(50)` vs `TEXT`). Whichever runs first
wins (`IF NOT EXISTS`); this is harmless — the API treats both as text.
