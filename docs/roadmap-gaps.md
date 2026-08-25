# The Daily Roast — Product Gap Register & Build Roadmap

Status date: 2026-08-25. Grounded in the code as it stands on `main` (c0cd479).

Each gap records what exists today, what's missing, and what it depends on. Phases are ordered
so that each one only needs what the phases above it have already landed.

---

## Phase 0 — Blockers & data-model debt (fix before building on top)

| # | Gap | Evidence in code |
| - | --- | --- |
| 0.1 | **`subscriptions` is declared twice.** `CREATE TABLE IF NOT EXISTS subscriptions` appears in both `0001_init.sql` and `0007_subscription_billing.sql`. Whichever ran first wins; the other is a silent no-op. Any new column must go in as `ALTER TABLE`, never as an edit to an old `CREATE`. | `packages/db/migrations/0001_init.sql:*`, `0007_subscription_billing.sql:1-32` |
| 0.2 | **Currency is `usd`.** `payments.currency` and `refunds.currency` default to `'usd'` on an India-only storefront (dailyroast.in, GST invoices, Shiprocket). | `packages/db/migrations/0001_init.sql:159,217` |
| 0.3 | **Compiled `.js` committed next to `.ts` in `src/`.** Real entry points are `.ts` (`wrangler.toml main = "src/index.ts"`, `<script src="/src/main.ts">`), so the tracked `.js` files are stale build output. They should be gitignored; until then, only ever edit the `.ts`. | `git ls-files apps/api/src \| grep '\.js$'` |
| 0.4 | **No annual / tiered subscription plan.** `frequency` is only `1_WEEK, 2_WEEKS, 4_WEEKS`. There is no plan tier, no term length, no entitlement concept — so "annual subscription includes a teleconsultation" has nothing to hang off. **Blocks 4.1.** | `0001_init.sql` subscriptions.frequency |

---

## Phase 1 — Customer identity & profile

| # | Gap | Today |
| - | --- | --- |
| 1.1 | **Derived customer profile / taste graph** — roast-level preference, origin affinity, favourite grind, typical bag size, reorder cadence, AOV, lifetime value, RFM segment, days-since-last-order. Computed from `orders` + `order_items` + `reviews`. | Nothing. `/api/customer/me` returns email, name, phone, points. |
| 1.2 | **Order history in the account area** — list, detail, invoice download, re-order in one click. | `/api/orders/:identifier` is a single-order lookup; no per-customer list endpoint. |
| 1.3 | **Address book CRUD** — list / edit / delete / set-default. | Only `POST /api/customer/address` (create). |
| 1.4 | **Saved preferences** — default grind, default bag weight, brew method, communication opt-ins. | `communication_channels` table exists, unused by the storefront. |
| 1.5 | **Personalised recommendations** — feed 1.1 into the AI Barista and the catalog ("your usual", "based on the Yirgacheffe you rated 5★"). | Barista has no customer context. |

## Phase 2 — Loyalty

| # | Gap | Today |
| - | --- | --- |
| 2.1 | **Points ledger** — immutable earn/redeem rows (mirroring the existing `inventory_movements` pattern) instead of a single mutable balance. | `customers.loyalty_points` is a bare integer. |
| 2.2 | **Earning rules** — points per ₹ spent on delivered orders, bonus for reviews, subscription streaks, birthday. | Nothing earns. Signup hardcodes 50 points. (`routes/customer.ts:89`) |
| 2.3 | **Redemption at checkout** — apply points as a discount, with floor/cap rules, reversed on refund. | Nothing redeems. The balance is display-only. (`storefront/src/main.ts:1977`) |
| 2.4 | **Tiers** — Bronze / Silver / Gold by trailing-12-month spend, with perks (free shipping, early access to `limited_editions`). | No tier concept. |
| 2.5 | **Expiry & statement** — points expiry policy and a customer-visible statement. | — |

## Phase 3 — Referral

| # | Gap | Today |
| - | --- | --- |
| 3.1 | **Referral codes & share links** — one durable code per customer, shareable URL, WhatsApp/Instagram share targets. | No referral code anywhere in the schema or code. |
| 3.2 | **Attribution** — capture code at checkout, bind to the referred order, dual-sided reward (referee discount, referrer points on delivery). | — |
| 3.3 | **Fraud guards** — self-referral by email/phone/address, one reward per referee, reward only after the referred order is delivered and past the refund window. | — |
| 3.4 | **Referral dashboard** — invited / signed-up / purchased counts, earnings to date. | — |

## Phase 4 — Subscription tiers & entitlements

| # | Gap | Today |
| - | --- | --- |
| 4.1 | **Annual & tiered plans** — term (monthly vs annual, prepaid), tier, price, and a per-plan entitlement set. | Frequency-only, flat 10% discount. |
| 4.2 | **Entitlement engine** — grants with balances and expiry (e.g. *2 × 15-min consults per year*, *1 free tour seat*, *free shipping*, *early access*). Consumed by Phase 5 bookings. | Nothing. |
| 4.3 | **Self-serve subscription management** — pause, skip next delivery, change grind / frequency / address, swap coffee, cancel with a save-offer. | Admin-only listing (`routes/admin.ts:1085`); customers cannot touch their own subscription. |
| 4.4 | **Renewal transparency** — upcoming-shipment view, pre-billing notice email, dunning UX for `PAST_DUE`. | Renewal cron can silently set `PAST_DUE`. |

## Phase 5 — Bookable experiences (one primitive, four products)

All four requested experiences are the same object with different `mode` / `location` / price:

| # | Gap | Notes |
| - | --- | --- |
| 5.1 | **Experience catalog** — `experiences` (type, mode `VIDEO`/`ONSITE`, duration, capacity, price, deposit, cancellation policy). | Covers: 15-min barista teleconsultation, roastery tour, cupping session, estate tour & visit. |
| 5.2 | **Slots & capacity** — `experience_slots` with start/end, seats total/booked, blackout dates, staff assignment; admin CRUD. | Prevents double-booking the same way `inventory_movements` prevents oversell. |
| 5.3 | **Booking flow** — `bookings` with hold → confirm, paid **or** entitlement-funded (consumes a Phase 4.2 grant), waitlist when full. | The annual-subscription teleconsult is the entitlement-funded path. |
| 5.4 | **Confirmations & reminders** — booking email, `.ics` calendar attachment, T-24h and T-1h reminders via the existing Queue, video-room link for `VIDEO` mode. | Reuses `Queues` + Resend. |
| 5.5 | **Reschedule / cancel / no-show** — self-serve within policy, refund or entitlement restoration, no-show marking. | — |
| 5.6 | **Multi-day estate visit specifics** — deposit, party size, dietary/accessibility notes, itinerary page. | Estate visit is not a 1-hour slot; needs date-range handling. |

## Phase 6 — Further gaps (my additions, ranked by value)

| # | Gap | Notes |
| - | --- | --- |
| 6.1 | **Batch traceability page** — QR on the bag → roast date, origin, altitude, cupping score, roaster's note. | `roast_batches` table already exists and is unused customer-side. |
| 6.2 | **Back-in-stock & limited-edition drop alerts** — waitlist + notify. | `limited_editions` table exists. |
| 6.3 | **Wishlist / saved items.** | — |
| 6.4 | **Gifting** — gift a bag or a subscription, gift note, scheduled delivery, gift cards. | — |
| 6.5 | **Replenishment & win-back automation** — "you're about 3 days from running out" based on 1.1 cadence. | `0008_marketing_automation.sql` is the hook. |
| 6.6 | **Self-serve returns / refund requests.** | `refunds` is admin-only today. |
| 6.7 | **Reviews upgrade** — photo uploads (R2), verified-purchase badge, points for reviewing. | `reviews` exists; no media, no incentive. |
| 6.8 | **B2B / wholesale & corporate gifting** — tiered bulk pricing, PO/GST-billed accounts, café subscriptions. | — |
| 6.9 | **Catalog search, filter & compare** — by origin, roast level, process, tasting note, price. | — |
| 6.10 | **Notification & consent centre** — per-channel opt-in incl. WhatsApp (India-appropriate), unsubscribe compliance. | `communication_channels` exists, unused. |
| 6.11 | **Brew-guide personalisation** — guides tuned to the customer's kit and the specific bag they bought. | `brewing_guides` exists, static. |
| 6.12 | **Customer-facing subscription & booking notifications in the PWA** — push via the existing service worker. | `public/sw.js` present in both apps. |

---

## Dependency order

```
Phase 0 (schema debt)
   └─> Phase 1 (profile)  ──> Phase 2 (loyalty) ──> Phase 3 (referral)
                          └─> Phase 4 (tiers/entitlements) ──> Phase 5 (bookings)
Phase 6 items are independent and can be picked up any time.
```

---

## Build seam (added by Phase 0, so features can be built in parallel)

Feature work must **not** edit `apps/api/src/index.ts`, `apps/storefront/src/main.ts`,
`apps/admin/src/main.ts`, `apps/*/index.html`, or `packages/shared-types/src/index.ts`. Phase 0
pre-wired every mount point:

| Seam | File | Notes |
| --- | --- | --- |
| API routes | `apps/api/src/routes/{profile,loyalty,referral,subscriptions,experiences}.ts` | Already mounted at `/api/<name>`. |
| Customer auth | `apps/api/src/middleware/customerAuth.ts` | `resolveCustomerSession(db, token)` — the `X-Customer-Session` header. |
| Entitlements | `apps/api/src/services/entitlements.ts` (+ migration `0011`) | `grantEntitlement` / `consumeEntitlement` / `releaseEntitlement` / `getBalances`. The seam between plans and bookings. |
| Shared types | `packages/shared-types/src/{profile,loyalty,referral,plans,experiences}.ts` | Re-exported from `index.ts` already. |
| Storefront UI | `apps/storefront/src/features/*.ts` + `features/shared.ts` | `mountFeatureSection`, `registerNavPill`, `apiFetch`, `esc`. Init calls already at the bottom of `main.ts`. |
| Admin UI | `apps/admin/src/features/{plans,experiences}.ts` + `features/shared.ts` | `mountAdminPanel`, `registerAdminNavItem`, `adminFetch`. |

**Reserved migration numbers** — one per feature, assigned up front so parallel branches don't
collide:

| Number | Owner |
| --- | --- |
| `0011_foundation_entitlements.sql` | Phase 0 (done) |
| `0012_*` | Phase 1 — customer profile |
| `0013_*` | Phase 2 — loyalty |
| `0014_*` | Phase 3 — referral |
| `0015_*` | Phase 4 — subscription plans & tiers |
| `0016_*` | Phase 5 — experiences & bookings |

Also: the tracked `.js` files beside every `.ts` under `src/` are stale `tsc -b` output. The real
entry points are the `.ts` files (`wrangler.toml main = "src/index.ts"`,
`<script src="/src/main.ts">`). Edit `.ts` only.
