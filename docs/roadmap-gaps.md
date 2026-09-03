# The Daily Roast — Product Gap Register & Build Roadmap

Status date: 2026-08-25. Originally grounded in the code as it stood on `main` (c0cd479).

**Phases 0–5 have since landed** (migrations `0011`–`0016`). See *Delivery status* at the foot of
this document for what shipped, what is still open, and what has not been exercised against a
running API. Phase 6 remains untouched and is the natural next pass.

Each gap records what exists today, what's missing, and what it depends on. Phases are ordered
so that each one only needs what the phases above it have already landed.

---

## Phase 0 — Blockers & data-model debt (fix before building on top)

| # | Gap | Evidence in code |
| - | --- | --- |
| 0.1 | **`subscriptions` is declared twice.** `CREATE TABLE IF NOT EXISTS subscriptions` appears in both `0001_init.sql` and `0007_subscription_billing.sql`. Whichever ran first wins; the other is a silent no-op. Any new column must go in as `ALTER TABLE`, never as an edit to an old `CREATE`. | `packages/db/migrations/0001_init.sql:*`, `0007_subscription_billing.sql:1-32` |
| 0.2 | **Currency is `usd`.** `payments.currency` and `refunds.currency` default to `'usd'` on an India-only storefront (dailyroast.in, GST invoices, Shiprocket). | `packages/db/migrations/0001_init.sql:159,217` |
| 0.3 | ~~**Compiled `.js` committed next to `.ts` in `src/`.**~~ Resolved: `noEmit` added to `apps/api` and `apps/storefront` tsconfigs (matching `apps/admin`), all 66 stale `.js` files removed from the tree, and `apps/api/src/**/*.js` + `apps/storefront/src/**/*.js` gitignored so `tsc -b` output can never be re-tracked. `tsc` is type-check-only now; wrangler/esbuild and Vite/esbuild do the real transpile. | `git ls-files apps/api/src \| grep '\.js$'` |
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
| 5.4 | **Confirmations & reminders** — booking email, `.ics` calendar attachment, T-24h and T-1h reminders via the existing Queue, video-room link for `VIDEO` mode. | Done: confirmation/reschedule/cancel email, `.ics` via `calendar.ics` link, and **both** T-24h and T-1h reminders (own stamp columns, `reminder_1h_sent_at` in 0030) on the hourly cron. Video-room link renders when `meeting_url` is set. |
| 5.5 | **Reschedule / cancel / no-show** — self-serve within policy, refund or entitlement restoration, no-show marking. | — |
| 5.6 | **Multi-day estate visit specifics** — deposit, party size, dietary/accessibility notes, itinerary page. | Estate visit is not a 1-hour slot; needs date-range handling. |

## Phase 6 — Further gaps (my additions, ranked by value)

| # | Gap | Notes |
| - | --- | --- |
| 6.1 | **Batch traceability page** — QR on the bag → roast date, origin, altitude, cupping score, roaster's note. | `roast_batches` table already exists and is unused customer-side. |
| 6.2 | **Back-in-stock & limited-edition drop alerts** — waitlist + notify. | ~~Partial~~: back-in-stock done — `stock_notifications` (0030), `POST /api/products/notify-me`, hourly `notifyBackInStock` sweep (email + push). Limited-edition drop alerts still open. |
| 6.3 | **Wishlist / saved items.** | — |
| 6.4 | **Gifting** — gift a bag or a subscription, gift note, scheduled delivery, gift cards. | — |
| 6.5 | **Replenishment & win-back automation** — "you're about 3 days from running out" based on 1.1 cadence. | `0008_marketing_automation.sql` is the hook. |
| 6.6 | **Self-serve returns / refund requests.** | `refunds` is admin-only today. |
| 6.7 | **Reviews upgrade** — photo uploads (R2), verified-purchase badge, points for reviewing. | `reviews` exists; no media, no incentive. |
| 6.8 | **B2B / wholesale & corporate gifting** — tiered bulk pricing, PO/GST-billed accounts, café subscriptions. | — |
| 6.9 | **Catalog search, filter & compare** — by origin, roast level, process, tasting note, price. | — |
| 6.10 | **Notification & consent centre** — per-channel opt-in incl. WhatsApp (India-appropriate), unsubscribe compliance. | ~~Partial~~: per-channel consent done — `customer_channel_consent` (0030), `GET`/`PUT /api/customer/notifications`, enforced at optional-send call sites (never on transactional mail). Storefront settings UI done — "Notification Settings" section (`features/notifications.ts`): a labelled toggle per optional channel, kept visibly distinct from the Phase-1 interests list. WhatsApp channel still open. |
| 6.11 | **Brew-guide personalisation** — guides tuned to the customer's kit and the specific bag they bought. | `brewing_guides` exists, static. |
| 6.12 | **Customer-facing subscription & booking notifications in the PWA** — push via the existing service worker. | ~~Partial~~: Web Push plumbing done — VAPID sender (`services/webPush.ts`), `push_subscriptions` (0030), subscribe/unsubscribe + vapid-key routes, `sw.js` `push`/`notificationclick` handlers, storefront auto-subscribe when permission already granted, and an explicit Web Push opt-in/out toggle in the storefront "Notification Settings" section (`features/notifications.ts`) — requests permission, subscribes/unsubscribes this browser and writes `push` consent. Remaining: RFC 8291 payload encryption (pushes are payload-free today) and wiring subscription/booking events to `pushToCustomer`. |

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

| Number | Owner | Status |
| --- | --- | --- |
| `0011_foundation_entitlements.sql` | Phase 0 — entitlement grants & ledger | Landed |
| `0012_customer_profile.sql` | Phase 1 — customer profile | Landed |
| `0013_loyalty.sql` | Phase 2 — loyalty | Landed |
| `0014_referral.sql` | Phase 3 — referral | Landed |
| `0015_subscription_plans.sql` | Phase 4 — subscription plans & tiers | Landed |
| `0016_experiences_bookings.sql` | Phase 5 — experiences & bookings | Landed |

All six apply cleanly in order against a fresh SQLite database. (`0004` still errors on duplicate
columns — pre-existing, unrelated, and harmless because the columns already exist.)

Also: the tracked `.js` files beside every `.ts` under `src/` are stale `tsc -b` output. The real
entry points are the `.ts` files (`wrangler.toml main = "src/index.ts"`,
`<script src="/src/main.ts">`). Edit `.ts` only.

### Lifecycle hooks

`apps/api/src/hooks/` is the second seam: `webhooks.ts` and `admin.ts` already dispatch
`onOrderPaid`, `onOrderDelivered` and `onOrderRefunded` to every feature. Implement your
feature's reactions in `apps/api/src/hooks/<feature>.ts` — never by editing `webhooks.ts`.
The dispatcher is `Promise.allSettled` + logged, so one feature's failure can't 500 a Stripe
webhook into a retry loop.

**Checkout ownership:** `apps/api/src/routes/checkout.ts` is owned by the loyalty/referral work
(points redemption and referral-code attribution both happen at checkout). Plan purchase and
experience booking must create their own Stripe sessions from their own routes rather than
editing `checkout.ts`.


---

## Delivery status

### Landed

| Phase | What shipped |
| --- | --- |
| 0 | Entitlement grants + ledger (`0011`), `middleware/customerAuth.ts`, `services/entitlements.ts`, the `hooks/` lifecycle dispatcher, and the per-feature route / UI / type seams. |
| 1 | `customer_profiles`, `customer_preferences`, `customer_channel_optins`; taste graph and RFM segmentation in `services/customerProfile.ts`; `/api/profile` (profile, order history, re-order, address book CRUD, preferences, recommendations); "Your Coffee Profile" storefront section; customer context injected into the AI Barista. |
| 2 | `loyalty_ledger` + rollups; earning on delivery, review bonus, subscription streak, referral reward; FIFO lot expiry evaluated lazily at read time; redemption at checkout with floor/cap and refund reversal; tiers; storefront section with balance, tier progress and statement. |
| 3 | `referral_codes` / `referrals` / `referral_visits`; durable per-customer code, share targets, `?ref=` capture; dual-sided reward paid on delivery; self-referral and repeat-referee guards; referrer dashboard. |
| 4 | `subscription_plans` with tier, term, price and an entitlement spec; plan checkout; pause / resume / skip / swap / edit / save-offer / cancel; upcoming-shipment projection, renewal notices, prepaid-term shipments, dunning recovery; storefront plan grid + subscription manager; admin plan CRUD. |
| 5 | `experiences` / `experience_slots` / `bookings` / `experience_blackouts`; one primitive covering teleconsult, roastery tour, cupping and estate visit; hold → confirm with paid **or** entitlement funding, waitlist, reschedule, cancel, no-show; `.ics` invites, confirmation and T-24h/T-1h reminder email; storefront booking flow; admin catalog, slot CRUD, roster, attendance and blackouts. |

Periodic upkeep lives in `apps/api/src/services/maintenance.ts`: hourly (booking-hold expiry,
Stripe reconciliation, reminders, entitlement-grant expiry) and daily (renewal notices, prepaid
shipments). `wrangler.toml` carries both `0 4 * * *` and `0 * * * *`; they coincide at 04:00 and
Cloudflare fires both, which is harmless because every job is idempotent.

### Still open

| # | Item |
| - | --- |
| 0.2 | **Currency is still `usd`.** `env.CURRENCY` forces the Stripe charge currency regardless of what the shopper selected. Because loyalty points and the referral discount are denominated in paise and the services are never told the currency, `checkout.ts` now **refuses both outside an INR order** rather than converting — applying a paise figure to a USD order would discount ~85× too much. Settling 0.2 is what unlocks rewards for every order. |
| 0.3 | ~~Compiled `.js` still tracked beside every `.ts` under `src/`.~~ Resolved — `noEmit` on all three app tsconfigs, stale `.js` removed, `apps/{api,storefront}/src/**/*.js` gitignored (mirrors the earlier `apps/admin` fix). |
| 0.5 | **Turnstile is inert in production.** `turnstileValidator` returns `next()` when `TURNSTILE_SECRET_KEY` is missing/`placeholder` or `ENVIRONMENT` is `development`. Confirmed live: `POST /api/agent/chat` with no token returns a normal reply. Both AI endpoints — `/chat` and the new `/transcribe`, which spends money per call and accepts uploads — are guarded by rate limiting alone. Setting the secret in the Worker's production environment turns the existing middleware on; no code change needed. |
| 0.4 | **The USD price is ~3.7x the INR price for the same bag.** The products API stores `price_cents` in USD cents; `main.ts` derives the rupee price as `price_cents * 0.23`. That implies about Rs 23 to the dollar against a real rate near Rs 85, so Attikan 250g is Rs 426 (~$5) to a rupee shopper and $18.50 to a dollar shopper. One of the two is wrong, and which one is a pricing decision. The generated coffee pages deliberately reuse the same derivation so that page, schema and shop always agree — whichever way this is settled, they move together. |
| — | **`orders.customer_id` is only populated going forward.** `checkout.ts` now stamps it, but historical rows have only `customer_email`, so every ownership predicate is `(o.customer_id = ? OR LOWER(o.customer_email) = ?)`. A backfill would let those dual predicates be simplified. |
| — | **`reviews` has no `customer_id`** — only a self-reported order number. That is why the review bonus is *claimed* (`POST /api/loyalty/claim-review`, keyed on the order so six bags cannot become six bonuses) rather than pushed when a review is written. |
| — | **The payment halves are untested and unbuilt.** The provider is undecided (Stripe / Razorpay / UPI), so `settleBookingPayment`, plan checkout and `restorePaymentMethod` are deliberately out of test scope. Nothing has been exercised against a live payment session. |

### Test coverage

`apps/api/test/helpers/d1.ts` is a D1-compatible adapter over `node:sqlite` that applies the real
migrations, so the phase 0–5 services are tested against real SQL — `ON CONFLICT` idempotency
guards, `SUM(points_delta)` over a ledger, the `seats_booked + n <= seats_total` capacity
predicate — rather than against a stub that returns success for every write. `batch()` runs in a
transaction, matching D1. `npm test` now globs `test/*.test.ts`; it previously ran one hardcoded
file, so a new test file would have been silently skipped.

| Suite | Tests | Covers |
| --- | --- | --- |
| `e2e.test.ts` | 11 | Pre-existing: inventory ledger, Stripe HMAC, backups, email, Workers AI, MCP, quota, Groq. |
| `entitlements.test.ts` | 13 | 4.2 — grant/consume/release, overspend refused rather than thrown, soonest-expiry-first across grants, derived idempotency keys on multi-grant spends, unlimited grants, start/expiry windows, batch atomicity. |
| `loyalty.test.ts` | 16 | 2.1–2.5 — earn rates and tier multipliers, redemption floor and basket cap, retried checkout debiting once, refund clawback and restore, lazy lot expiry, tier boundaries, abandoned-checkout reclaim. |
| `bookings.test.ts` | 20 | 5.1–5.6 — capacity and oversell, waitlist and promotion, hold expiry, entitlement-funded confirmation, cancellation windows and the staff override, reschedule, attendance. |
| `referral.test.ts` | 19 | 3.1–3.4 — all six fraud guards, de-duplicated visit counts, the UNIQUE index failing a concurrent second claim, payout on delivery and reversal on refund. |
| `plans.test.ts` | 18 | 4.1–4.4 — annual term granting and expiring perks, replay-safe grants, PREPAID excluded from the renewal charger, pause/resume/skip/cancel, shipment projection. |

**What this found:** `entitlement_grants` held two datetime formats — the column default writes
`YYYY-MM-DD HH:MM:SS`, while `grantPlanEntitlements` bound an ISO string with a `T`. SQLite
compares them as text and `'T'` sorts above `' '`, so a grant issued *now* failed
`starts_at <= CURRENT_TIMESTAMP` and stayed invisible until the next midnight UTC: buy an annual
plan, and the consultation credits appeared tomorrow. Lapsed grants lingered a day for the same
reason, as did loyalty lot expiry. Every such comparison now wraps both sides in `datetime()`.

### Desktop layout, and what measuring it found

The header's intrinsic width is about 1620px — brand 263, seven links 802, four controls 505 — so
it has never fitted a 1280 or 1440 display. Two attempts missed why: letting flex shrink the links
wrapped every label onto two lines, and `white-space: nowrap` stopped the wrapping by pushing the
whole page sideways instead (1614px of scrollWidth in a 1440px viewport). The cause was that the
flex child of `.nav-container` is the `<nav>` wrapper, not `.nav-links`; without `min-width: 0` on
`<nav>`, its default `min-width: auto` pinned it to its intrinsic width and no shrinking anywhere
inside could take effect.

The header now degrades in a measured order as the screen narrows and never clips silently, since
a link scrolled out of sight inside the header is a link nobody knows exists. Measured with
Playwright at every width from 360 to 1920: page overflow 0, links clipped 0, no wrapping.

Four further defects came out of measuring rather than out of any report:

| Found | Was |
| --- | --- |
| `.quiz-section` mobile margin | `margin: 0 -0.5rem` made the document 8px wider than a 390px screen — a full-page sideways scroll for one section's bleed. |
| Maya on tablets | Hiding the header button at 979px stranded her between 769 and 979: the bottom bar that carries her on phones only appears at 768. iPad portrait is 810 and 834. She is icon-only in that band now. |
| Orphaned cards | Four experiences in a three-up grid, and five plans in an auto-fit grid, each left one card alone beside a wall of empty space. Both wrap with a centred last row. |
| Two "MOST POPULAR" plans | Both Connoisseur tiers carried the badge. Side by side that is noise, not a signal, and it helps nobody choose between the two plans showing it. Migration 0017 makes the annual tier RECOMMENDED. |

The footer repeated the header's mistake one level down: its grid declared `1.5fr repeat(3, 1fr)`,
written when it had four children, while it had grown to six. `nav.test.ts` now asserts the
declared track count against the number of columns the page actually produces, so the next one
added fails the suite instead of the layout.

### Discoverability, and the one URL behind it

The meta tags, canonical, Open Graph and `Organization` schema were fine. The problem was under
them: the whole shop lived at one URL, with the catalog fetched client-side, so
`curl https://dailyroast.in/` returned **zero product cards**. One URL cannot rank for ten
coffees, and nothing — a search engine, or an assistant asked where to buy honey-process Attikan
— had anything to link to but the homepage.

`apps/storefront/scripts/generate-seo.mjs` now runs after `vite build` and emits a page per
coffee, per brew method, a collection page for each, an FAQ, the sitemap and `llms.txt`. **4
indexable URLs became 21**, all verified 200 on production.

Rules the generator follows, each one from a mistake made while building it:

| Rule | Why |
| --- | --- |
| One source per fact | Brew pages are read out of the `.brew-card` elements in `index.html` with jsdom. A second hand-maintained copy is what put links to three non-existent coffee pages into `FALLBACK_PRODUCTS`. |
| Never mark up what is not shown | No `aggregateRating` (no reviews on those pages); FAQ answers are rendered, not markup-only; opening hours are in the footer as well as the schema. |
| Never publish an unsourced fact | Invented opening hours and geo coordinates were written and then removed. Hours came back only when supplied. Every FAQ answer records the site copy it came from, enforced by a test. |
| Prices derive through one function | Page, schema and shop read `price_cents` through the same helper, so they cannot disagree — whichever way gap 0.4 is settled. |
| Fail loudly | A failed products fetch fails the build. A sitemap that loses ten URLs reads as ten pages withdrawn. |

Left open: `Google-Extended`, `GPTBot`, `ClaudeBot` and others are `Disallow`ed by Cloudflare's
managed `robots.txt` (1,903 bytes served vs 67 in the repo). Googlebot and the answer-crawlers
(`OAI-SearchBot`, `PerplexityBot`, `ChatGPT-User`) are unaffected, so search indexing and
live assistant fetches work; bulk AI training ingestion does not. Changing it is a Cloudflare
dashboard setting, not a code change.

### Voice, and what measuring it cost

Press-to-talk on the Maya panel: Groq `whisper-large-v3-turbo` in, browser speech synthesis out.
Verified live in both Chrome (webm/opus) and Safari (mp4/aac) containers, including the
vocabulary Whisper usually mangles.

The instructive part was silence. Whisper does not go quiet on it — three seconds of digital
silence returned a confident `"Thank you."`, which an empty-string check cannot catch because it
is a well-formed sentence. Measured across two runs of every clip:

| Input | `avg_logprob` | `compression_ratio` | Outcome |
| --- | --- | --- | --- |
| Speech, four clips (incl. 12% volume) | −0.08 to −0.34 | 0.65–0.95 | pass |
| Digital silence, 3s and 8s | −0.973 | — | rejected |
| Pink noise | −0.35 | 0.89 | **passes as fluent speech** |

`no_speech_prob` reports 0.000 for every input including silence, and `compression_ratio` never
exceeds 0.95 against Whisper's own 2.4 threshold — **both are checks that cannot fire**, and both
were written and shipped before being measured. Only `avg_logprob` discriminates, at −0.7. Note
it measures token confidence rather than level, so quiet speakers are not penalised; the
client-side peak gate is the volume check.

**Known limitation:** steady background noise can still produce a confident sentence nobody said
(−0.35 against real speech's −0.34 — not separable by anything this API returns). The defences
are the client's peak gate before upload and that the transcript appears as the person's own
message, where they can see it is wrong. The model is also nondeterministic: the same noise file
passed one run and was rejected the next, so single-run verification proves less than it appears
to.

### Not started

Phase 6 in full — batch traceability, back-in-stock alerts, wishlist, gifting, replenishment
automation, self-serve returns, reviews upgrade, B2B, catalog search, notification centre,
brew-guide personalisation, PWA push.
