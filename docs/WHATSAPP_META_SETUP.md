# WhatsApp (Meta Cloud API) — invoice delivery setup

Meta is **not active yet**. Nothing here is required for invoices to work.

Until these env vars are set, the invoice pipeline **skips WhatsApp quietly**:
no error, no failed attempt recorded, no retry scheduled. Invoices are still
issued, numbered, stored and downloadable from the order page exactly as
normal. The moment the vars appear on Vercel and you redeploy, delivery starts
by itself — no code change.

There is **no database work involved.** No SQL, no tables, no migrations.

---

## 1. Get your IDs

| What | Where |
| --- | --- |
| **Phone Number ID** | Meta Business Manager → WhatsApp → API Setup. Shown next to your test/production number. |
| **Business Account ID (WABA ID)** | Same screen, top right under "Business Account". |
| **Permanent access token** | Same screen → "Temporary access token" is only good 24h. For production create a **System User**: Business Settings → Users → System Users → Add → assign your app + your WhatsApp business account with "Manage Business" → Generate a new system user token. Select it as **Never expire**. |
| **App Secret** | App Dashboard → Settings → Basic → App Secret → Show. |

## 2. Create the UTILITY template

WhatsApp Manager → Message Templates → Create. Category **UTILITY** (this is a
transactional document, not marketing — Marketing templates cannot carry a
document header and will be rejected).

- **Name:** `INVOICE_WITH_DOCUMENT`
- **Language:** `English (US)` → code `en_US`
- **Header:** `Document` (pick this; do not pick Text or Image)
- **Body** (the `{{1}}`…`{{5}}` placeholders are positional and must appear in
  this order — non-promotional transactional wording only):

```
Hi {{1}}, your invoice is ready.

Order {{2}} · Invoice {{3}} · Amount {{4}}
The PDF is attached. Amounts are inclusive of GST.

Thank you,
MeruVeda Wellness
```

- **Footer / buttons:** leave empty.

Submit it for approval. UTILITY templates are usually approved within minutes;
you cannot send until status is **Approved**.

## 3. Add the env vars on Vercel (Project → Settings → Environment Variables)

Scope: **Production**, **Preview and Development**.

```
WHATSAPP_API_TOKEN=<permanent system user token>
WHATSAPP_PHONE_NUMBER_ID=<phone number id>
WHATSAPP_BUSINESS_ACCOUNT_ID=<waba id>
WHATSAPP_APP_SECRET=<app secret>
ADMIN_WHATSAPP_NUMBER=919876543210
INVOICE_WA_TEMPLATE_NAME=INVOICE_WITH_DOCUMENT
INVOICE_WA_TEMPLATE_LANG=en_US
WHATSAPP_DRY_RUN=false
WHATSAPP_BACKFILL_DAYS=2
```

All optional. `ADMIN_WHATSAPP_NUMBER` gets a copy of each invoice. Set
`WHATSAPP_DRY_RUN=true` first if you want to see the exact payload in the logs
without calling Meta.

Then **redeploy** (env var changes only apply to new deployments).

## 4. What happens automatically after you redeploy

- Every **new** order sends its invoice immediately.
- Invoices issued in the last `WHATSAPP_BACKFILL_DAYS` days that never reached
  WhatsApp are **swept** and delivered. The sweep runs opportunistically in the
  background on each new order, plus daily from the Vercel cron
  (`/api/jobs/retry-failures`). That cron stays fail-closed (401) if
  `CRON_SECRET` is unset — the opportunistic sweep still does the work, so
  nothing is lost.
- Delivery is atomic per channel: never a double send. Max 5 attempts with
  backoff. Only genuine Meta errors count as a failure.

## 5. Verify

1. Place a COD test order.
2. Check the invoice appears in the private R2 bucket under
   `invoices/<order_id>/state.json` — `channels.whatsapp.status` moves to `sent`.
3. Confirm delivery in Meta Business Manager → WhatsApp → Message history.
4. The store admin page shows WhatsApp: `Sent`, or `Failed (<Meta reason>)`.
5. To inspect the exact request body without sending, set
   `WHATSAPP_DRY_RUN=true`, redeploy, and read the logged payload.