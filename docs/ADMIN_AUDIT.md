# Admin Panel — Audit Report

Scope: everything reachable from the admin sidebar in `admin/src/constants/sidebar.ts`
plus the routes mounted in `admin/src/App.tsx`. Each row was checked against the
backend mount in `backend/src/app.ts` and the controller implementation.

Legend for **Status**:

| Status | Meaning |
| --- | --- |
| OK | Feature works end-to-end against the live schema |
| FIXED | Was broken in code; fixed in this change set |
| BLOCKED-BY-DB | Needs a column/table from `backend/database/PENDING_DELTAS.sql`; backend now answers with an actionable message instead of HTTP 500 |
| N/A | Cosmetic/mock — no backend dependency |

---

## 1. Page-by-page inventory

| # | Sidebar entry | Route | Page component | Backend endpoint | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Dashboard | `/dashboard` | `pages/dashboard/DashboardPage.tsx` | `GET /api/analytics/overview`, `GET /api/orders`, `GET /api/products` | OK | KPI cards + recent orders |
| 2 | Products | `/products` | `pages/products/ProductsPage.tsx` | `GET /api/products` | OK | Search + category filter |
| 3 | Products → Add | `/products/add` | `pages/products/ProductFormPage.tsx` | `POST /api/products` | OK | |
| 4 | Products → Edit | `/products/:id/edit` | `pages/products/ProductFormPage.tsx` | `PATCH /api/products/:id` | OK | |
| 5 | Products → View | `/products/:id` | `pages/products/ProductDetailPage.tsx` | `GET /api/products/:id` | OK | |
| 6 | Categories | `/categories` | `pages/categories/CategoriesPage.tsx` | `GET/POST/PATCH/DELETE /api/categories` | BLOCKED-BY-DB (image/banner) | Name/description/slug work; image + banner are silently dropped until `categories.image` / `categories.banner` exist |
| 7 | *(not in sidebar)* | `/inventory` | `pages/inventory/InventoryPage.tsx` | `GET /api/products` | OK | Route exists but has no sidebar entry — reachable only by URL |
| 8 | Orders | `/orders` | `pages/orders/OrdersPage.tsx` | `GET /api/orders` | OK | Now also shows Invoice + Shiprocket push status columns |
| 9 | Orders → Detail | `/orders/:id` | `pages/orders/OrderDetailPage.tsx` | `GET/PATCH /api/orders/:id`, `POST /api/orders/:id/*` | OK | Invoice card + Shiprocket card added |
| 10 | Customers | `/customers` | `pages/customers/CustomersPage.tsx` | `GET /api/customers` | OK (FIXED) | `lastLogin` was reading a non-existent `users.last_login`; now reads `users.last_login_at` |
| 11 | Customers → Profile | `/customers/:id` | `pages/customers/CustomerProfilePage.tsx` | `GET /api/customers/:id` | OK | |
| 12 | Reviews | `/reviews` | `pages/reviews/ReviewsPage.tsx` | `GET/PATCH /api/reviews`, `POST /api/reviews/:id/feature` | BLOCKED-BY-DB (feature toggle) | List + status changes work; "Feature on homepage" returns 503 until `reviews.is_featured` exists |
| 13 | Coupons | `/coupons` | `pages/coupons/CouponsPage.tsx` | `GET/POST/PATCH/DELETE /api/coupons` | OK | |
| 14 | Media Library | `/media` | `pages/media/MediaLibraryPage.tsx` | `GET/POST/DELETE /api/media` | OK | |
| 15 | Journal | `/journal` | `pages/journal/JournalPage.tsx` | `GET /api/blogs` | BLOCKED-BY-DB (featured image + SEO) | Title/excerpt/content/status save; featured image + SEO fields are dropped until `blogs.featured_image` / `blogs.seo_metadata` exist |
| 16 | Journal → Add/Edit | `/journal/add`, `/journal/:id/edit` | `pages/journal/JournalFormPage.tsx` | `POST/PATCH /api/blogs` | BLOCKED-BY-DB (same as above) | |
| 17 | Hero Banners | `/banners` | `pages/banners/BannersPage.tsx` | `GET/POST/PATCH/DELETE /api/banners` | OK | |
| 18 | Transactions | `/transactions` | `pages/transactions/TransactionsPage.tsx` | `GET /api/transactions`, `PATCH /api/transactions/:id/status` | OK | `POST /api/transactions` was open to any authenticated user — now admin-only |
| 19 | Analytics | `/analytics` | `pages/analytics/AnalyticsPage.tsx` | `GET /api/analytics/*` | PARTIAL — BLOCKED-BY-DB | Sales/product/orders cards OK; Traffic card returns zeros until the `page_views` table exists |
| 20 | User Accounts | `/users` | `pages/users/UsersPage.tsx` | `GET /api/customers?role=all`, `POST /api/auth/register`, `PATCH/DELETE /api/customers/:id` | FIXED | Add-user was unusable (register demanded a phone the form never sent) and allowed role escalation; both fixed |
| 21 | Notifications | `/notifications` | `pages/notifications/NotificationsPage.tsx` | `GET/POST/PATCH/DELETE /api/notifications` | OK | |
| 22 | Support | `/support` | `pages/support/SupportPage.tsx` | `GET /api/support`, `PATCH /api/support/:id/status`, `POST /api/support/:id/reply` | FIXED / BLOCKED-BY-DB (reply body) | List + status change now render correctly (mapping was returning `undefined` for customer name/date); the Reply button's endpoint did not exist and has been added. Saving the reply body needs `support_tickets.reply` |
| 23 | Settings | `/settings` | `pages/settings/SettingsPage.tsx` | `GET/POST /api/settings` | OK (FIXED) | Public GET was leaking every row of `settings`, including other users' `notification_preferences_*` |
| 24 | Activity Log | `/activity` | `pages/activity/ActivityLogsPage.tsx` | `GET /api/activity-logs` | FIXED | Called a non-existent `GET /api/activity`; the module filter was also never applied server-side and rows were never mapped to the UI shape |
| 25 | Open Website | external | — | — | N/A | Link to the storefront |

---

## 2. Auth coverage

Every admin route in `backend/src/app.ts` now sits behind `requireAuth` + `requireAdmin`
except the two that must stay public for the storefront:

| Endpoint | Access | Was | Now |
| --- | --- | --- | --- |
| `GET /api/settings` | public | returned **all** settings rows, including per-user `notification_preferences_<userId>` | public payload filters out `notification_preferences_*`; a valid admin token (via the new `optionalAuth` middleware) still receives them |
| `POST /api/auth/register` | public | accepted `role` from the body → **privilege escalation to admin** | `role` is honoured only when the request also carries a valid admin JWT; everyone else is forced to `customer` |
| `POST /api/transactions` | any authenticated user | mass-assignable insert (could book a fake "success" payment or a refund) | admin-only + field whitelist |
| `POST /api/support` | any authenticated user | mass-assignable (`status`, `priority`, `user_id`, `id`, `reply` all writable) | field whitelist; `status` forced to default, `user_id` from the token |
| `POST /api/activity-logs` | any authenticated user | mass-assignable, could log as another user | whitelist; `user_id`/`ip_address` always from the request; `entity_type` validated against a known module list |

No admin route is reachable without a token.

---

## 3. Bugs fixed in this pass

| # | Area | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- |
| 1 | Activity Log | Page showed "Failed to load activity logs" forever | `GET /api/activity` does not exist; backend mounts `/api/activity-logs` | `admin/src/services/activityService.ts` calls `/activity-logs` |
| 2 | Activity Log | Rows empty even when the call succeeded | No snake_case → camelCase mapping, `module` filter ignored server-side | Mapping added; `getActivityLogs` now filters on `entity_type` and accepts `action`/`limit` |
| 3 | Support | Customer name / email / date blank | Service returned raw rows; the page reads `customerName`, `customerEmail`, `createdAt` | `mapTicket()` added in `supportService.ts` |
| 4 | Support | "Reply" did nothing (`POST /api/support/:id/reply` → 404) | Route never existed | Route + `replyToTicket` controller added |
| 5 | Support | Priority colour never matched | UI checked `medium`; DB writes `normal` | Style map updated to `normal` |
| 6 | Support | Ticket id column blank | `ticket_number` is a pending column | Backend derives `TKT-<first 8 of uuid>` until the column exists |
| 7 | User Accounts → Add | Always "Please enter a valid 10-digit mobile number" | Register required a phone; the form only sends name/email/password/role | Register now accepts email-only accounts when an admin token is present |
| 8 | User Accounts → Add | Anyone could create an admin | `role` trusted from the public body | Role honoured only for a verified admin JWT |
| 9 | Customers | "Last login" always equal to signup date | Read `user.last_login`; real column is `users.last_login_at` | Reads `last_login_at`, falls back to `last_login` |
| 10 | Products | Duplicate product always 500 | Sent `status: 'inactive'`; the CHECK constraint allows `active`/`draft`/`archived` | Duplicates are created as `draft` |
| 11 | Settings | Per-user notification prefs visible to anyone | Public GET returned every row | `notification_preferences_*` filtered unless admin |
| 12 | Journal | Any blog save with a cover image failed | Wrote `featured_image` / `seo_metadata`, neither of which exists in the base schema | `hasColumn` guard; other fields still save |
| 13 | Categories | Category save failed whenever image/banner were set | `categories.image` / `categories.banner` do not exist | `hasColumn` guard on create/update/delete (including the storage cleanup select) |
| 14 | Shiprocket | Token re-login on every warm-instance push | In-memory token cached for 23h only | Cache extended to ~10 days; any 401 still clears and retries one login |

---

## 4. Still blocked on the database

All of these are covered by `backend/database/PENDING_DELTAS.sql` (run once, idempotent).

| Feature | Missing object | Behaviour until applied |
| --- | --- | --- |
| Guest order tracking, 7-day review request job | `orders.delivered_at` | Job skips orders with no delivery timestamp |
| Admin "Feature on homepage" review toggle | `reviews.is_featured` | `PATCH /api/reviews/:id/feature` → 503 with the delta name |
| Storefront reply under a review | `reviews.reply` | Same |
| Admin Analytics traffic card | `page_views` table | Traffic section shows zeros |
| OTP checkout + WhatsApp send-once dedup | `otps`, `whatsapp_message_log`, `review_requests` | OTP login unavailable; WhatsApp sends may duplicate |
| Saved profile address, admin "last login" | `users.address`, `users.last_login_at` | Profile address empty; last login falls back to signup time |
| Phone-verified gating for quick-login orders | `users.phone_verified` | Quick-login users keep full order-history access |
| Automatic GST invoice (Part 1) | `orders.invoice_sent_at`, `orders.invoice_error` | Invoice hook cannot claim an order → logged, no send |
| Automatic Shiprocket push (Part 2) | `orders.shiprocket_push_status`, `_error`, `_pushed_at`, `_push_started_at` | Push cannot be made single-flight → logged, no push |
| Journal cover image + SEO | `blogs.featured_image`, `blogs.seo_metadata` | Those fields are dropped on save; rest of the post saves |
| Category image + banner | `categories.image`, `categories.banner` | Those fields are dropped on save |
| Support reply + ticket number | `support_tickets.reply`, `support_tickets.ticket_number` | Reply endpoint → 503 naming the delta; list shows a derived `TKT-…` id |

---

## 5. Known gaps (not bugs, worth deciding on)

| Gap | Detail |
| --- | --- |
| Inventory has no sidebar entry | `/inventory` is a live route with a page, but it is only reachable by typing the URL |
| Invoice numbers are not legally sequential | Number is `MW-INV-<order_number>` (derived). A sequential per-FY invoice series needs a counter table — flagged in the invoice risks, not implemented |
| `transactions.type` column | Code writes it; the base schema has no such column. Harmless today because nothing reads it |
| Admin "Reset password" is a stub | `POST /api/customers/:id/reset-password` answers success without sending anything |
| Support replies are not emailed | The reply is stored (and shown in the admin modal); no customer notification is sent |
| No server-side pagination on Activity Log / Support | Both cap at a fixed limit instead of paging |
