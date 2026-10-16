# Invoice automation — change summary

Branch: `fix/invoice-automation`

Everything below is one goal: **exactly one GST tax invoice per order**, issued from
a gapless `MV/<FY>/<NNNNNN>` series, rendered once, stored, and delivered by email +
WhatsApp without any human step.

> ## NO DATABASE CHANGES REQUIRED
>
> The invoice pipeline runs on `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` only —
> existing tables via PostgREST plus the Storage API. There is **no migration to
> run**, and there never will be. Every piece of invoice bookkeeping (the invoice
> number, the issue timestamp, the delivery state and the channel attempt
> counters) lives in a private Storage object, not in a new column.
>
> Objects such as `orders.invoice_number`, `invoice_sequences` or
> `claim_invoice()` were never created in production and are **not required**.
> The schema audit is therefore silent by design — absent optional objects are a
> normal, supported state and never produce a boot warning or a health failure.

---

## 0. Three bugs that made invoices silently not happen

All three presented as "the invoice button is broken". None were.

**a) A missing column was reported as a missing order.**
`GET /orders/:id/invoice` destructured only `data` from its query, so PostgREST's
`42703 column orders.invoice_number does not exist` was indistinguishable from an
absent row — the endpoint answered **404 "Order not found" for orders that
existed**, and the admin told the merchant their order had vanished. Schema
failures now return **503** with an actionable message; only a genuinely missing
row returns 404.

**b) `products.seoMetadata` does not exist.**
`getOrderForInvoice()` embedded `products(id, name, sku, seo_metadata, seoMetadata)`.
The real column is `seo_metadata`. PostgREST rejected the whole query with 42703,
so `data` was null and the function threw "Order not found" **for every order** —
which is why the automatic trigger failed too.
That function is the entry point for the entire pipeline.

**c) `Taxable` printed the gross.**
The totals block showed `Taxable Rs. 998.00` while the per-line `Taxed` column
showed `Rs. 950.48` — the same document contradicting itself, and a taxable value
that already contained the tax. `Taxable` now uses `totals.taxable` (net), so
`Taxable + IGST === Subtotal` and `+ Shipping === TOTAL`. Asserted in tests.

---

## 1. Shared tax / financial-year module

`shared/src/utils/invoice.ts` (new) is now the single home for every number that
appears on a tax invoice. Backend, PDF generator and tests all import from it, so a
rounding fix lands in one place instead of three.

| Export | Why it exists |
| --- | --- |
| `SELLER_STATE` / `SELLER_GSTIN` / `SELLER_STATE_CODE` | The seller is Rajasthan (08). One constant, not three literals. |
| `isRajasthan(state)` | Replaces four separate ad-hoc checks. **A blank or unknown state returns `false`**, i.e. IGST — never a silent intra-state invoice. |
| `invoiceFyLabel(date)` | Indian FY (April–March), evaluated in **IST** so an order placed at 00:30 UTC on 1 April lands in the correct FY rather than the previous one. |
| `formatInvoiceNumber(fy, seq)` | `MV/26-27/000123` |
| `grossToTaxable` / `grossToGst` / `splitGst` | Gross → taxable → GST, and the CGST/SGST halving. The halves sum **exactly** to the total GST (asserted in tests). |
| `computeOrderTotals(...)` | The whole totals block — discount, shipping GST, per-rate grouping — as one pure function. |
| `formatInvoiceAmount` | `en-IN` grouping, 2 dp. |

## 2. Storage-backed state — no schema changes

Everything the pipeline needs lives in a private bucket (`INVOICE_STORAGE_BUCKET`,
default `invoice`, auto-created idempotently at runtime with the service key and
cached per cold start):

```
invoices/<order_id>/state.json          invoiceNumber, orderNumber, issuedAt,
                                        pdfPath, payment wording snapshot,
                                        channels { whatsapp, email }
invoices/<order_id>/claim               atomic once-only claim marker
invoices/<order_id>/<invoice-number>.pdf
counters/<FY>/<000123>                 empty numbering markers
```

* **Once-only claim.** `invoices/<order_id>/claim` is created with `upsert:false`.
  A conflict means another worker owns it, so we read `state.json` instead. An
  issued invoice is never regenerated.
* **Numbering.** `MV/<FY>/<000123>`, the FY derived dynamically from the invoice
  date (April–March, never hardcoded). Allocate by listing `counters/<FY>/`,
  taking the highest + 1 and creating that marker with `upsert:false`; on
  conflict, retry with the next number (max 20 attempts). If allocation fails
  outright the order number is used as the invoice number and it is logged, so
  an order is never left without an invoice.
* Note for the CA: a mid-allocation failure can leave a gap in the counter
  series. Numbers are unique and monotonic, but not guaranteed gapless.
* **ORDER #** is a separate row on the invoice and always shows the order number
  (e.g. `MV-748371`), independent of the invoice number.

## 3. PDF generator rewrite

`backend/src/services/invoiceService.ts` was rewritten to match the reference
invoice. The substantive changes, not the cosmetics:

* **Shipping GST reconcile fix.** Shipping was previously treated as if it were
  taxable whenever the line items were. It is now gated on `SHIPPING_IS_TAXABLE`,
  and when it *is* taxable the GST is grossed-up (extracted from the inclusive
  amount) rather than added on top. `taxable + GST + shipping === total` is now an
  asserted invariant.
* `wrapText` **wraps** instead of the old `slice()`, which silently truncated long
  product names mid-word.
* Currency defaults to `Rs.` — pdf-lib's standard fonts are WinAnsi and cannot draw
  the U+20B9 glyph, so a literal `₹` produced a blank or garbage glyph.
* Logo embedded from `backend/assets/meruveda-logo.png`.

## 4. One dispatch path, auto-send by default

* `invoiceDispatchService.ts` is the **single** entry point. The legacy send path was
  deleted, so there is no longer a second code path that could send an invoice with
  its own idea of the number.
* `INVOICE_AUTO_SEND` defaults to **on**. The flag exists only to pause delivery
  during an incident, and is read per dispatch rather than cached at boot.
* The PDF is written **once** to private Supabase Storage. It is never regenerated —
  an issued invoice is a legal document, and re-rendering after an amount change
  would silently produce a *different* document under the *same* number.

## 5. COD gating and non-blocking PayU redirect

* **COD** only invoices on order confirmation.
* **PayU** records `payu_mihpayid` and returns success to the browser **first**;
  invoice dispatch runs afterwards and cannot delay or fail the redirect.

## 6. WhatsApp approved template

Document sends go through a pre-approved Meta template rather than a free-form
session message. Meta rejects unregistered session messages, so the old path broke
as soon as the 24-hour customer-service window closed.

## 7. Serving the stored invoice

`GET /api/orders/:id/invoice` is the **single** way to obtain an invoice PDF —
customer download, admin view and (by internal call) the WhatsApp send all
reference the same file. Auth is `requireAuth` plus an owner-or-admin check in the
controller, so one customer cannot read another's invoice.

Order of precedence:

1. **Stored PDF** — an issued invoice is a legal document and must never be
   re-rendered; regenerating after an amount change would silently produce a
   *different* document under the *same* number.
2. **Not issued yet but billable** — generate **once** through the same atomic
   claim the automatic trigger uses, store it, then serve it. Because that claim
   is atomic, a customer clicking Download can never produce a second invoice.
3. **Not billable** (unpaid prepaid) — `409` "available after payment is verified",
   instead of an invoice for goods not yet paid for.

Returns `Content-Disposition: attachment; filename="Invoice-MV-748371.pdf"`. An
already-issued invoice whose stored file has gone missing returns `410`, never a
silent re-render.

## 7a. One invoice, one template — the print-dialog bug

The customer "Download invoice" button **called the correct backend endpoint but
fell back to `window.print()` on any error**. Because of bugs (a) and (b) above the
endpoint *always* errored, so the button always opened the browser print dialog and
printed the "My Orders" page — which looked like a successful download and produced
a document with no invoice on it.

Removed entirely:

* the `catch { window.print() }` fallback in both the order list and detail page,
* the standalone "Print" button,
* the `?print=1` route and the effect that cleaned the URL afterwards,
* the admin's `hidden print:block` block — a **second, complete invoice template**
  (its own INVOICE heading, line-items table and totals table) competing with the
  real PDF,
* the `@media print` block in `admin/src/styles/globals.css` that existed only to
  support it.

`invoiceTemplateContract.test.ts` fails if a print-only template or
`window.print(` reappears, if a second `PDFDocument.create()` is added, or if any
element of the reference layout is dropped.

The customer button is gated on payment validity: COD always (invoiced at
placement), prepaid only once PayU has verified payment — before that it reads
"Invoice available after payment". It shows a spinner while fetching and a toast on
failure.

## 8. State is required at checkout

The state decides CGST/SGST vs IGST. The frontend already validated it in the
new-address form, but the **saved-address** path only checked "not empty", so a
legacy saved address with a typo'd state passed and produced an IGST invoice it
should not have.

* `frontend/src/constants/states.ts` (new) holds the canonical list and
  `isIndianState()`.
* Checkout imports it for both the form **and** the saved-address gate.
* The account address book replaces its free-text state input with a validated
  `<select>`.
* The backend list is the same 36 names, so the UI cannot accept what the API rejects.

## 9. Admin — read only

The Invoice card is a **status display**. There is no Send, Resend or Download
button: delivery is automatic, and a manual trigger is a second way to deliver the
same tax document, which is exactly what the once-only claim exists to prevent.
The `resendInvoiceDispatch({force:true})` path and its `POST /orders/:id/resend-invoice`
endpoint were deleted rather than merely hidden.

* `Pending` — trigger has not completed yet, no failure recorded.
* `Sent` — with timestamp, and the per-channel WhatsApp / email outcome.
* `Failed` — with a short reason and "retrying automatically". No button.
* `Attempts` — `n of 5`, so an order that has exhausted its retries is visible.
* A plain **View invoice** link plus the storage path once a PDF exists, hitting
  the same endpoint the customer uses.

The GST invoice number (`MV/26-27/000123`) is shown separately from the order
number (`MV-748371`) — they were previously conflated.

## 10. Retry

`retryPendingInvoices()` runs from `/api/jobs/retry-failures`, capped at
**5 attempts** per order with a **2/4/8/16-minute backoff** so the sweep is safe
to run every two minutes without hammering a failing provider. After the cap the
order is left alone with its failure recorded for a human. Unpaid prepaid orders
are skipped, so no invoice can ever precede a verified payment.

## 11. Operational notes

`backend/.env.example` documents `INVOICE_AUTO_SEND=true` and adds a **Render**
section: which vars to set, why dispatch is safe on an idling free instance
(nothing in process memory, numbers allocated in Postgres), and the retry sweep. It
also flags that `INVOICE_STORAGE_BUCKET` must match the bucket you actually
created — the RLS migration makes one named `invoice` while the code default is
`invoices`.

**Boot-time schema audit.** `auditInvoiceSchemaAtBoot()` checks for every required
column, table and function and prints a loud boxed error naming the files to run.
It does not refuse to start (the rest of the store is unaffected), but set
`INVOICE_SCHEMA_STRICT=true` to fail fast. This exists because every consumer of
the missing objects degraded gracefully — the claim fell back to non-atomic
numbering, the dedupe check silently returned false, and `invoice_error` writes
were guarded by a `hasColumn` check that was quietly false — so nothing surfaced.

**Cron.** The retry sweep needs a 2-minute schedule. Vercel's Hobby plan allows
cron only once per day and `vercel.json` also does not reach a Render-hosted
backend, so this must be a **Render cron job** hitting
`GET /api/jobs/retry-failures?limit=25` with `Authorization: Bearer $CRON_SECRET`.
This cannot be configured from the repo.

## Verification

| Check | Result |
| --- | --- |
| `npm run build` — shared, backend, frontend, admin | pass |
| `npm test -w backend` | 72/72 |
| `npm test -w meruveda` | 17/17 |
| `npm run lint` (all workspaces) | 0 errors (131 + 170 pre-existing warnings) |
| `npm run samples -w backend` | 5 PDFs regenerated |
| `npm run samples:order -w backend` | MV-748371 rendered, 5/5 reconciliation checks pass |

`docs/samples/06-cod-MV-748371.pdf` is rendered from the **real database row** for
order MV-748371 (COD, 2 x Joint Pain Oil @ 499, Gwalior / Madhya Pradesh) through
the production generator. Its extracted text:

```
Subtotal Rs. 998.00      Taxable Rs. 950.48     IGST (Included) Rs. 47.52
Shipping Rs. 100.00      TOTAL     Rs. 1,098.00
ORDER # MV-748371        Method: Cash On Delivery
```

`950.48 + 47.52 = 998.00` and `998 + 100 = 1098`, and Madhya Pradesh is correctly
IGST rather than CGST/SGST. Because that order has no delivery state, its
`INVOICE #` is the deterministic fallback (`MV/26-27/295825`) rather than a value
from the real series — expected, and it becomes gapless once the migration runs.