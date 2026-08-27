import { Hono } from 'hono';
import { CoffeeDatabase } from '@daily-grind/db';
import type { Env } from '../types/env';
import type {
  AddressBookEntry,
  ChannelOptIn,
  CustomerTasteProfile,
  OrderHistoryEntry,
  OrderHistoryPage,
  ProfileRecommendation,
  ReorderLine,
  SavedPreferences,
} from '@daily-grind/shared-types';
import { resolveCustomerSession, UNAUTHENTICATED, type CustomerSession } from '../middleware/customerAuth';
import { getTasteProfile, orderOwnerBindings, refreshTasteProfile } from '../services/customerProfile';

// Derived customer profile: taste graph, order history, address book, saved preferences.
// Owner: Phase 1 — customer profile. Routes are mounted in ../index.ts — do not edit that file to add endpoints
// here; add them to this app instead.
const profileApp = new Hono<{ Bindings: Env }>();

/**
 * Same ownership predicate as the taste-graph service: checkout.ts never fills
 * `orders.customer_id`, so email is the column that actually identifies a customer's orders.
 */
const ORDER_OWNER_SQL = '(o.customer_id = ? OR LOWER(o.customer_email) = ?)';

/** Resolves the session or short-circuits with a 401. Never trusts an email from the request. */
async function requireSession(c: any): Promise<CustomerSession | null> {
  return resolveCustomerSession(c.env.DB, c.req.header('X-Customer-Session'));
}

async function loadPreferences(db: Env['DB'], customerId: string): Promise<SavedPreferences> {
  const prefs = await db
    .prepare('SELECT default_grind, default_weight_grams, brew_method FROM customer_preferences WHERE customer_id = ?')
    .bind(customerId)
    .first<any>();

  // LEFT JOIN from the channel catalog, not from the opt-in table: a channel the customer has
  // never answered about must still appear (opted out) rather than vanish from the UI.
  const { results: channels } = await db
    .prepare(
      `SELECT ch.id AS channel_id, ch.name, ch.channel_type, ch.status,
              COALESCE(o.opted_in, 0) AS opted_in
         FROM communication_channels ch
    LEFT JOIN customer_channel_optins o
           ON o.channel_id = ch.id AND o.customer_id = ?
        WHERE ch.status IN ('ACTIVE', 'PLANNED')
        ORDER BY ch.name ASC`
    )
    .bind(customerId)
    .all<any>();

  return {
    default_grind: prefs?.default_grind || null,
    default_weight_grams: prefs?.default_weight_grams ? Number(prefs.default_weight_grams) : null,
    brew_method: prefs?.brew_method || null,
    channels: (channels || []).map(
      (row: any): ChannelOptIn => ({
        channel_id: row.channel_id,
        name: row.name,
        channel_type: row.channel_type,
        status: row.status,
        opted_in: !!Number(row.opted_in),
      })
    ),
  };
}

// GET /api/profile — the taste graph, saved preferences and address book in one payload.
// The snapshot is filled in lazily on read (see services/customerProfile.ts) so customers who
// already had orders before this feature shipped get a populated profile immediately.
profileApp.get('/', async (c) => {
  const session = await requireSession(c);
  if (!session) return c.json(UNAUTHENTICATED, 401);

  const profile = await getTasteProfile(c.env.DB, session.customerId, session.email);
  const preferences = await loadPreferences(c.env.DB, session.customerId);

  const { results: addresses } = await c.env.DB
    .prepare('SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, created_at DESC')
    .bind(session.customerId)
    .all<any>();

  // The money in `profile` is a sum over orders.total_cents, which carries no currency of its
  // own. Reporting the most recent order's currency alongside it keeps the whole account screen
  // labelled consistently instead of letting the totals and the order rows disagree. (The
  // 'usd' default on that column is gap 0.2 and is not fixed here.)
  const latest = await c.env.DB
    .prepare(`SELECT o.currency FROM orders o WHERE ${ORDER_OWNER_SQL} ORDER BY o.created_at DESC LIMIT 1`)
    .bind(...orderOwnerBindings(session.customerId, session.email))
    .first<{ currency: string }>();

  return c.json({
    success: true,
    profile,
    currency: latest?.currency || 'usd',
    preferences,
    addresses: (addresses || []).map(toAddressEntry),
  });
});

// POST /api/profile/recompute — forces a rebuild. Cheap escape hatch for support, and the path
// the admin/backfill story will use; the hooks below cover the normal case.
profileApp.post('/recompute', async (c) => {
  const session = await requireSession(c);
  if (!session) return c.json(UNAUTHENTICATED, 401);

  const profile = await refreshTasteProfile(c.env.DB, session.customerId, session.email);
  return c.json({ success: true, profile });
});

// GET /api/profile/orders?limit=&offset= — paginated order history for the signed-in customer.
profileApp.get('/orders', async (c) => {
  const session = await requireSession(c);
  if (!session) return c.json(UNAUTHENTICATED, 401);

  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 10));
  const offset = Math.max(0, Number(c.req.query('offset')) || 0);
  const [ownerId, ownerEmail] = orderOwnerBindings(session.customerId, session.email);

  const totalRow = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${ORDER_OWNER_SQL}`)
    .bind(ownerId, ownerEmail)
    .first<{ n: number }>();

  const { results } = await c.env.DB
    .prepare(
      `SELECT o.id, o.order_number, o.status, o.total_cents, o.currency, o.tracking_number, o.created_at,
              (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
              (SELECT GROUP_CONCAT(oi.product_name, ', ') FROM order_items oi WHERE oi.order_id = o.id) AS summary
         FROM orders o
        WHERE ${ORDER_OWNER_SQL}
        ORDER BY o.created_at DESC
        LIMIT ? OFFSET ?`
    )
    .bind(ownerId, ownerEmail, limit, offset)
    .all<any>();

  const total = Number(totalRow?.n || 0);
  const page: OrderHistoryPage = {
    orders: (results || []).map(
      (row: any): OrderHistoryEntry => ({
        id: row.id,
        order_number: row.order_number,
        status: row.status,
        total_cents: Number(row.total_cents || 0),
        currency: row.currency || 'usd',
        item_count: Number(row.item_count || 0),
        summary: row.summary || '',
        tracking_number: row.tracking_number || null,
        created_at: row.created_at,
      })
    ),
    total,
    limit,
    offset,
    has_more: offset + limit < total,
  };

  return c.json({ success: true, ...page });
});

// GET /api/profile/orders/:identifier — order detail, scoped to the caller.
// The public GET /api/orders/:identifier deliberately stays open (order-number lookup for
// guests); this one refuses to return an order the session does not own.
profileApp.get('/orders/:identifier', async (c) => {
  const session = await requireSession(c);
  if (!session) return c.json(UNAUTHENTICATED, 401);

  const identifier = c.req.param('identifier');
  const [ownerId, ownerEmail] = orderOwnerBindings(session.customerId, session.email);

  const order = await c.env.DB
    .prepare(
      `SELECT * FROM orders o
        WHERE (o.id = ? OR o.order_number = ?)
          AND ${ORDER_OWNER_SQL}
        LIMIT 1`
    )
    .bind(identifier, identifier, ownerId, ownerEmail)
    .first<any>();

  if (!order) return c.json({ success: false, error: 'Order not found' }, 404);

  const { results: items } = await c.env.DB
    .prepare('SELECT * FROM order_items WHERE order_id = ?')
    .bind(order.id)
    .all<any>();

  return c.json({
    success: true,
    order: {
      ...order,
      shipping_address:
        typeof order.shipping_address_json === 'string'
          ? safeJson(order.shipping_address_json)
          : order.shipping_address_json,
      items: items || [],
    },
  });
});

// POST /api/profile/orders/:identifier/reorder — "buy it again".
//
// Resolver, not a mutation: the storefront cart lives in localStorage (see cart.ts's own note
// that it is not synced to the D1 carts table), so writing D1 cart_items here would be dead
// weight that immediately drifts. Instead this returns the past order's lines mapped onto
// *currently purchasable* variants; the client prices them from the live catalog, so any price
// change since the original order is picked up for free.
profileApp.post('/orders/:identifier/reorder', async (c) => {
  const session = await requireSession(c);
  if (!session) return c.json(UNAUTHENTICATED, 401);

  const identifier = c.req.param('identifier');
  const [ownerId, ownerEmail] = orderOwnerBindings(session.customerId, session.email);

  const order = await c.env.DB
    .prepare(
      `SELECT o.id FROM orders o
        WHERE (o.id = ? OR o.order_number = ?)
          AND ${ORDER_OWNER_SQL}
        LIMIT 1`
    )
    .bind(identifier, identifier, ownerId, ownerEmail)
    .first<{ id: string }>();

  if (!order) return c.json({ success: false, error: 'Order not found' }, 404);

  const { results } = await c.env.DB
    .prepare(
      `SELECT oi.variant_id, oi.product_name, oi.weight_grams, oi.grind_type, oi.quantity,
              pv.product_id, pv.is_active AS variant_active
         FROM order_items oi
    LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE oi.order_id = ?`
    )
    .bind(order.id)
    .all<any>();

  const lines: ReorderLine[] = (results || []).map((row: any) => ({
    variant_id: row.variant_id,
    product_id: row.product_id || null,
    product_name: row.product_name,
    weight_grams: Number(row.weight_grams || 0),
    grind_type: row.grind_type,
    quantity: Number(row.quantity || 1),
    available: !!row.product_id && !!Number(row.variant_active || 0),
  }));

  return c.json({
    success: true,
    items: lines,
    unavailable_count: lines.filter((l) => !l.available).length,
  });
});

// ---------------------------------------------------------------------------------------
// Address book (1.3). POST /api/customer/address already exists and is left where it is;
// everything else lives here. Every statement below carries `customer_id = ?` in its WHERE
// clause — resolving the session is not enough on its own, or an attacker with any valid
// session could edit any address by id.
// ---------------------------------------------------------------------------------------

function toAddressEntry(row: any): AddressBookEntry {
  return {
    id: row.id,
    is_default: !!Number(row.is_default),
    name: row.name,
    line1: row.line1,
    line2: row.line2 || null,
    city: row.city,
    state: row.state,
    postal_code: row.postal_code,
    country: row.country,
    created_at: row.created_at,
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

profileApp.get('/addresses', async (c) => {
  const session = await requireSession(c);
  if (!session) return c.json(UNAUTHENTICATED, 401);

  const { results } = await c.env.DB
    .prepare('SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, created_at DESC')
    .bind(session.customerId)
    .all<any>();

  return c.json({ success: true, addresses: (results || []).map(toAddressEntry) });
});

const ADDRESS_FIELDS = ['name', 'line1', 'line2', 'city', 'state', 'postal_code', 'country'] as const;

// PATCH /api/profile/addresses/:id — partial update; only the supplied fields move.
profileApp.patch('/addresses/:id', async (c) => {
  const session = await requireSession(c);
  if (!session) return c.json(UNAUTHENTICATED, 401);

  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));

  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const field of ADDRESS_FIELDS) {
    if (body[field] === undefined) continue;
    const value = body[field];
    if (field === 'line2') {
      sets.push('line2 = ?');
      binds.push(value === null || value === '' ? null : String(value));
      continue;
    }
    const text = String(value ?? '').trim();
    if (!text) return c.json({ success: false, error: `${field} cannot be empty` }, 400);
    sets.push(`${field} = ?`);
    binds.push(text);
  }

  if (sets.length === 0) return c.json({ success: false, error: 'Nothing to update' }, 400);

  const result = await c.env.DB
    .prepare(`UPDATE customer_addresses SET ${sets.join(', ')} WHERE id = ? AND customer_id = ?`)
    .bind(...binds, id, session.customerId)
    .run();

  if (!result.meta || result.meta.changes === 0) {
    return c.json({ success: false, error: 'Address not found' }, 404);
  }

  const row = await c.env.DB
    .prepare('SELECT * FROM customer_addresses WHERE id = ? AND customer_id = ?')
    .bind(id, session.customerId)
    .first<any>();

  return c.json({ success: true, address: row ? toAddressEntry(row) : null });
});

// POST /api/profile/addresses/:id/default — batched so the book can never end up with two
// defaults (or none) if the second statement fails.
profileApp.post('/addresses/:id/default', async (c) => {
  const session = await requireSession(c);
  if (!session) return c.json(UNAUTHENTICATED, 401);

  const id = c.req.param('id');
  const owned = await c.env.DB
    .prepare('SELECT id FROM customer_addresses WHERE id = ? AND customer_id = ?')
    .bind(id, session.customerId)
    .first<{ id: string }>();

  if (!owned) return c.json({ success: false, error: 'Address not found' }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?').bind(session.customerId),
    c.env.DB.prepare('UPDATE customer_addresses SET is_default = 1 WHERE id = ? AND customer_id = ?').bind(id, session.customerId),
  ]);

  return c.json({ success: true, default_address_id: id });
});

// DELETE /api/profile/addresses/:id — deleting the default promotes the next-newest address,
// so a customer with addresses left always has exactly one default at checkout time.
profileApp.delete('/addresses/:id', async (c) => {
  const session = await requireSession(c);
  if (!session) return c.json(UNAUTHENTICATED, 401);

  const id = c.req.param('id');
  const existing = await c.env.DB
    .prepare('SELECT id, is_default FROM customer_addresses WHERE id = ? AND customer_id = ?')
    .bind(id, session.customerId)
    .first<{ id: string; is_default: number }>();

  if (!existing) return c.json({ success: false, error: 'Address not found' }, 404);

  await c.env.DB
    .prepare('DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?')
    .bind(id, session.customerId)
    .run();

  let promoted: string | null = null;
  if (Number(existing.is_default)) {
    const next = await c.env.DB
      .prepare('SELECT id FROM customer_addresses WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1')
      .bind(session.customerId)
      .first<{ id: string }>();
    if (next) {
      await c.env.DB
        .prepare('UPDATE customer_addresses SET is_default = 1 WHERE id = ? AND customer_id = ?')
        .bind(next.id, session.customerId)
        .run();
      promoted = next.id;
    }
  }

  return c.json({ success: true, promoted_default_id: promoted });
});

// ---------------------------------------------------------------------------------------
// Saved preferences (1.4)
// ---------------------------------------------------------------------------------------

const VALID_GRINDS = [
  'WHOLE_BEAN', 'POUR_OVER', 'SOUTH_INDIAN_FILTER', 'ESPRESSO', 'AEROPRESS', 'DRIP', 'FRENCH_PRESS', 'COLD_BREW',
];
const VALID_WEIGHTS = [100, 250, 500, 1000];

profileApp.get('/preferences', async (c) => {
  const session = await requireSession(c);
  if (!session) return c.json(UNAUTHENTICATED, 401);

  return c.json({ success: true, preferences: await loadPreferences(c.env.DB, session.customerId) });
});

// PUT /api/profile/preferences — upsert. `channels` is a partial map of channel_id -> boolean,
// so the UI can toggle one switch without having to send the whole consent set back.
profileApp.put('/preferences', async (c) => {
  const session = await requireSession(c);
  if (!session) return c.json(UNAUTHENTICATED, 401);

  const body = await c.req.json<{
    default_grind?: string | null;
    default_weight_grams?: number | null;
    brew_method?: string | null;
    channels?: Record<string, boolean>;
  }>().catch(() => ({} as any));

  const grind = body.default_grind ? String(body.default_grind).toUpperCase() : null;
  if (grind && !VALID_GRINDS.includes(grind)) {
    return c.json({ success: false, error: 'Unknown grind type' }, 400);
  }

  const weight = body.default_weight_grams ? Number(body.default_weight_grams) : null;
  if (weight !== null && !VALID_WEIGHTS.includes(weight)) {
    return c.json({ success: false, error: 'Unknown bag weight' }, 400);
  }

  const brewMethod = body.brew_method ? String(body.brew_method).trim().slice(0, 60) : null;

  await c.env.DB
    .prepare(
      `INSERT INTO customer_preferences (customer_id, default_grind, default_weight_grams, brew_method)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(customer_id) DO UPDATE SET
         default_grind = excluded.default_grind,
         default_weight_grams = excluded.default_weight_grams,
         brew_method = excluded.brew_method,
         updated_at = CURRENT_TIMESTAMP`
    )
    .bind(session.customerId, grind, weight, brewMethod)
    .run();

  if (body.channels && typeof body.channels === 'object') {
    const entries = Object.entries(body.channels);
    const placeholders = entries.map(() => '?').join(', ');
    const { results: validChannels } = placeholders
      ? await c.env.DB
          .prepare(`SELECT id FROM communication_channels WHERE id IN (${placeholders})`)
          .bind(...entries.map(([id]) => id))
          .all<{ id: string }>()
      : { results: [] as { id: string }[] };
    const validIds = new Set((validChannels || []).map((row: any) => row.id));
    const rejected: string[] = [];
    const statements = entries.flatMap(([channelId, optedIn]) => {
      if (!validIds.has(channelId)) {
        rejected.push(channelId);
        return [];
      }
      return [
        c.env.DB
          .prepare(
            `INSERT INTO customer_channel_optins (id, customer_id, channel_id, opted_in)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(customer_id, channel_id) DO UPDATE SET
               opted_in = excluded.opted_in,
               updated_at = CURRENT_TIMESTAMP`
          )
          .bind(
            'opt_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16),
            session.customerId,
            channelId,
            optedIn ? 1 : 0
          ),
      ];
    });
    if (rejected.length > 0) {
      return c.json({ success: false, error: `Unknown channel id(s): ${rejected.join(', ')}` }, 400);
    }
    // Consent is all-or-nothing: a half-applied set of toggles is worse than a rejected one.
    if (statements.length > 0) {
      await c.env.DB.batch(statements);
      await c.env.DB
        .prepare(
          `INSERT INTO audit_log (id, actor_id, actor_email, action, entity_type, entity_id, new_value_json)
           VALUES (?, ?, ?, 'CHANNEL_OPTIN_UPDATE', 'customer', ?, ?)`
        )
        .bind(
          'al_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16),
          session.customerId,
          session.email,
          session.customerId,
          JSON.stringify(Object.fromEntries(entries))
        )
        .run().catch(() => { /* best-effort: consent is the source of truth */ });
    }
  }

  return c.json({ success: true, preferences: await loadPreferences(c.env.DB, session.customerId) });
});

// ---------------------------------------------------------------------------------------
// Personalised recommendations (1.5)
// ---------------------------------------------------------------------------------------

/**
 * Scores the live catalog against the taste graph. Deliberately a transparent linear model
 * rather than an embedding search: every point of score maps to a sentence we can show the
 * customer ("you buy a lot of MEDIUM_LIGHT"), and the barista's semantic search already covers
 * the fuzzy case.
 */
function scoreCatalog(products: any[], profile: CustomerTasteProfile): ProfileRecommendation[] {
  const roast = new Map(profile.roast_distribution.map((d) => [d.key, d.share]));
  const origin = new Map(profile.origin_distribution.map((d) => [d.key, d.share]));
  const process = new Map(profile.process_distribution.map((d) => [d.key, d.share]));
  const bought = new Map(profile.product_affinity.map((d) => [d.key, d.share]));

  return products.map((p: any) => {
    const roastShare = roast.get(p.roast_level) || 0;
    const originShare = origin.get(p.origin_country) || 0;
    const processShare = process.get(p.process_method) || 0;
    const boughtShare = bought.get(p.id) || 0;

    const reasons: string[] = [];
    let score = roastShare * 3 + originShare * 2 + processShare;
    let kind: ProfileRecommendation['kind'] = 'DISCOVERY';

    if (p.id === profile.top_product_id) {
      kind = 'YOUR_USUAL';
      score += 5;
      reasons.push('Your usual — the bag you reorder most');
    } else if (p.id === profile.top_rated_product_id) {
      kind = 'AFFINITY';
      score += 4;
      reasons.push('You rated this one highly');
    } else if (boughtShare > 0) {
      kind = 'AFFINITY';
      score += 1;
      reasons.push("You've bought this before");
    } else {
      // Nudge genuinely new coffees that still sit inside the customer's taste, so the shelf
      // isn't just a mirror of their order history.
      if (roastShare > 0) score += 0.75;
      if (roastShare > 0) reasons.push(`A ${String(p.roast_level).replace(/_/g, ' ').toLowerCase()} roast, like most of your shelf`);
      if (originShare > 0) reasons.push(`From ${p.origin_country}, an origin you keep coming back to`);
      if (reasons.length === 0 && p.is_featured) {
        score += 0.4;
        reasons.push('A roastery favourite to branch out with');
      }
    }

    const variant = (p.variants || [])[0];
    return {
      product_id: p.id,
      name: p.name,
      slug: p.slug,
      image_url: p.image_url,
      roast_level: p.roast_level,
      origin_country: p.origin_country,
      tasting_notes: Array.isArray(p.tasting_notes) ? p.tasting_notes : [],
      variant_id: variant?.id || null,
      price_cents: variant ? Number(variant.price_cents) : null,
      reason: reasons[0] || 'Hand-picked by the roastery',
      kind,
      score: Math.round(score * 1000) / 1000,
    };
  });
}

// GET /api/profile/recommendations?limit=
profileApp.get('/recommendations', async (c) => {
  const session = await requireSession(c);
  if (!session) return c.json(UNAUTHENTICATED, 401);

  const limit = Math.min(12, Math.max(1, Number(c.req.query('limit')) || 4));
  const profile = await getTasteProfile(c.env.DB, session.customerId, session.email);
  const products = await new CoffeeDatabase(c.env.DB).getAllProducts();

  const ranked = scoreCatalog(products as any[], profile)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);

  const cadence = profile.reorder_cadence_days;
  const daysSince = profile.days_since_last_order;

  return c.json({
    success: true,
    recommendations: ranked,
    segment: profile.segment,
    // Surfaced so the UI can say "you're about due" without re-deriving the arithmetic.
    days_until_typical_reorder:
      cadence !== null && daysSince !== null ? Math.round(cadence - daysSince) : null,
  });
});

export { profileApp };
