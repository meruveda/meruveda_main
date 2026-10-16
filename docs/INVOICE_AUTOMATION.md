# Invoice automation — change summary

Branch: `fix/invoice-automation`

Everything below is one goal: **exactly one GST tax invoice per order**, issued from
a gapless `MV/<FY>/<NNNNNN>` series, rendered once, stored, and delivered by email +
WhatsApp without any human step.

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

## 2. Migration — `backend/sql/migrations/2026-10-15_invoice_automation.sql`

New columns on `orders`: `invoice_number`, `invoice_url`, `invoice_error`,
`payu_mihpayid`, `invoice_allocated_at`, `invoice_sent_at`.

* `idx_orders_invoice_number` is **UNIQUE** — the database, not the application, is
  the thing that makes a duplicate number impossible.
* `invoice_sequences` + `claim_invoice(order_id, …)` allocate the next sequence value
  **atomically inside a transaction**, and are idempotent per order: calling it twice
  returns the number already on the order.
* `release_invoice_claim(order_id, reason)` rolls the allocation back when dispatch
  fails, so a failed order does not burn a number.
* `set_invoice_url(order_id, path)` persists the storage object path.

Tested against the fallback path too: if the migration has not been applied, the
generator still produces a **deterministic** number rather than throwing.

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

`GET /api/orders/:id/invoice` returns the stored PDF. Auth is `requireAuth` plus an
owner-or-admin check in the controller.

Three details worth calling out, because each was a real defect:

* **Headers were dropped on the stored-file branch.** `res.set(headers)` was only
  reached on the legacy fallback path, so a stored PDF was served as
  `application/octet-stream` with no `Content-Disposition`. Anchor-based downloads
  lost their filename. Fixed.
* **`Content-Disposition` now prefers the GST invoice number** over the order number,
  with slashes normalised so the series cannot create storage folders.
* An **already-issued** invoice whose stored file has gone missing returns `410` and
  an explanation, never a silent re-render under the same number.

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

## 9. Admin

* The invoice card shows the **GST invoice number** (`MV/26-27/000123`), distinct
  from the order number (`MV-139559`) — these were previously conflated.
* The print view labels each correctly instead of printing the order number under
  `INVOICE #`.
* Download names the file after the invoice number, and the button explains which of
  three states it is in (stored file / generate-and-download / already issued).
* Error bodies come back as JSON while the client asked for a blob, so the message is
  now parsed out of the blob rather than surfacing as a generic failure.

## 10. Operational notes

`backend/.env.example` documents `INVOICE_AUTO_SEND=true` and adds a **Render**
section: which vars to set, why dispatch is safe on an idling free instance
(nothing in process memory, numbers allocated in Postgres), and the daily retry
sweep. It also flags that `INVOICE_STORAGE_BUCKET` must match the bucket you
actually created — the RLS migration makes one named `invoice` while the code
default is `invoices`.

## Verification

| Check | Result |
| --- | --- |
| `npm run build` — shared, backend, frontend, admin | pass |
| `npm test -w backend` | 67/67 |
| `npm test -w meruveda` | 17/17 |
| `npm run lint` (all workspaces) | 0 errors (185 pre-existing warnings) |
| `npm run samples -w backend` | 5 PDFs, byte-identical to the previous run |

`docs/samples/` holds the five rendered cases: single-item IGST, multi-item,
COD-unpaid, Rajasthan CGST/SGST, and a discount coupon. They come from the real
generator with fixture orders, not from mocked layout code.