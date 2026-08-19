# Shiprocket Go-Live Checklist

Status: integration built, running in mock mode. The items below must be done before
live shipments will actually flow through Shiprocket.

## What's built

- `apps/api/src/services/shiprocket.ts` — auth (token cached in `CONFIG_KV`), `createOrder`, `trackShipment`.
- `POST /api/admin/orders/:id/status` — auto-pushes to Shiprocket the first time an order is marked `PACKED`.
- `POST /api/admin/orders/:id/shiprocket/sync` — pulls latest courier/tracking status on demand.
- `POST /api/webhooks/shiprocket` — receives Shiprocket status callbacks (picked up, in transit, delivered, etc.) and updates the order.
- Migration `packages/db/migrations/0002_shiprocket.sql` — adds `shiprocket_order_id`, `shiprocket_shipment_id`, `shiprocket_status` to `orders`.
- `apps/api/.dev.vars.example` — local secrets template.

Auto-push only fires for India-bound orders (`shipping_address.country` matching `IN`/`IND`/`INDIA`).
Orders shipping elsewhere keep the pre-existing manual `tracking_number`/`carrier` entry flow untouched.

## Required before go-live

1. **Apply migration `0002`** against the real D1 database (`npm run build --workspace=packages/db`, then run the migration via `wrangler d1 migrations apply`).

2. **Set Shiprocket credentials as secrets**, scoped to the production environment:
   ```
   wrangler secret put SHIPROCKET_EMAIL --env production
   wrangler secret put SHIPROCKET_PASSWORD --env production
   wrangler secret put SHIPROCKET_WEBHOOK_TOKEN --env production
   ```
   Without `SHIPROCKET_EMAIL`/`SHIPROCKET_PASSWORD`, the service runs in mock mode in dev and
   throws (rather than faking data) in production.

3. **`SHIPROCKET_WEBHOOK_TOKEN` is mandatory** — `/api/webhooks/shiprocket` returns 401 without
   it, in every environment. For local testing, copy `apps/api/.dev.vars.example` to
   `apps/api/.dev.vars` and fill in a token. Register the same token and the deployed webhook
   URL in the Shiprocket dashboard under **Settings > API > Webhooks**.

4. ~~Fill in real values in `wrangler.toml`'s `[env.production]` block~~ — done: `STOREFRONT_URL`
   and `ADMIN_URL` point at `dailyroast.in`/`admin.dailyroast.in`. The `CONFIG_KV` namespace id
   stays a placeholder in the committed file by design — the CI deploy workflow discovers or
   creates the real namespace and rewrites that line before every deploy (see
   `.github/workflows/deploy.yml`'s "Configure KV and Queues" step). Bindings do not inherit
   from the top-level `[vars]`/binding blocks in Wrangler, so `[env.production]` carries its own
   copies of `d1_databases`, `kv_namespaces`, `ai`, and `triggers` — verified via
   `wrangler deploy --env production --dry-run`.

5. **Currency conversion assumption — confirm or override.** Product prices in the DB
   (`product_variants.price_cents`) are USD cents, but Shiprocket's order-value fields are
   always INR. The integration converts using `SHIPROCKET_USD_TO_INR_RATE`, which **defaults
   to 83** — a number that was picked as a reasonable placeholder, not a live rate. This value
   is declared to the courier for insurance/reconciliation purposes, so it should be a real,
   intentionally-chosen rate. Set `SHIPROCKET_USD_TO_INR_RATE` explicitly, or say the word if
   you'd rather this be fetched from a live FX source instead.

6. **Storefront checkout does not currently collect a customer phone number.** Shiprocket
   requires one to hand orders to a courier. Until the checkout form collects `phone`, live
   pushes to Shiprocket will fail with an actionable error (`Order has no customer phone number
   on file...`) and the order falls back to manual tracking entry. Add a phone field to the
   checkout flow (`apps/storefront`) and thread it through to `shipping_address.phone` before
   relying on auto-push in production.

## Notes on behavior

- Shiprocket status webhooks only ever advance the order forward through its lifecycle
  (`PENDING_PAYMENT → PAID → ROASTING → PACKED → SHIPPED → DELIVERED`); a delayed/out-of-order
  webhook can't regress a later status, and `CANCELLED`/`REFUNDED` orders are treated as terminal.
- The webhook status-string map (`SHIPROCKET_STATUS_MAP` in `apps/api/src/routes/webhooks.ts`)
  uses exact matches on strings that haven't yet been checked against a real Shiprocket payload —
  worth verifying once live traffic arrives. Unrecognized statuses degrade safely: the raw string
  is still stored in `shiprocket_status`, order `status` just doesn't advance.
