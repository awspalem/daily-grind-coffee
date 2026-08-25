// Shared contracts for the profile feature. Re-exported from ./index.ts — add types here rather
// than to index.ts, so parallel feature work never collides in one file.
//
// Names are deliberately prefixed/qualified (CustomerTasteProfile, AddressBookEntry, ...) because
// index.ts does `export *` across five feature files; a bare `Preferences` would collide.

/** One slice of a distribution, e.g. { key: 'MEDIUM_LIGHT', units: 7, share: 0.58 }. */
export interface TasteAffinity {
  key: string;
  label?: string;
  units: number;
  share: number;
}

/**
 * RFM-style bucket. Precedence when several would match is fixed in
 * apps/api/src/services/customerProfile.ts so the label is reproducible.
 */
export type CustomerSegment = 'NEW' | 'ACTIVE' | 'LOYAL' | 'VIP' | 'AT_RISK' | 'LAPSED';

/**
 * The materialised taste graph. Entirely derived from orders/order_items/products/reviews —
 * safe to delete and recompute at any time.
 */
export interface CustomerTasteProfile {
  customer_id: string;

  total_orders: number;
  lifetime_value_cents: number;
  aov_cents: number;
  first_order_at: string | null;
  last_order_at: string | null;
  days_since_last_order: number | null;
  /** Mean days between consecutive orders. NULL until the customer has at least two. */
  reorder_cadence_days: number | null;

  favourite_grind: string | null;
  typical_weight_grams: number | null;
  top_roast_level: string | null;
  top_origin_country: string | null;
  top_product_id: string | null;

  roast_distribution: TasteAffinity[];
  origin_distribution: TasteAffinity[];
  process_distribution: TasteAffinity[];
  product_affinity: TasteAffinity[];

  review_count: number;
  avg_review_rating: number | null;
  top_rated_product_id: string | null;

  segment: CustomerSegment;
  computed_at: string;
}

export interface AddressBookEntry {
  id: string;
  is_default: boolean;
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  created_at: string;
}

export interface SavedPreferences {
  default_grind: string | null;
  default_weight_grams: number | null;
  brew_method: string | null;
  channels: ChannelOptIn[];
}

export interface ChannelOptIn {
  channel_id: string;
  name: string;
  channel_type: string;
  status: string;
  opted_in: boolean;
}

export interface OrderHistoryEntry {
  id: string;
  order_number: string;
  status: string;
  total_cents: number;
  currency: string;
  item_count: number;
  /** First few product names, for a one-line summary in the list view. */
  summary: string;
  tracking_number: string | null;
  created_at: string;
}

export interface OrderHistoryPage {
  orders: OrderHistoryEntry[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

/**
 * One line of a "buy it again" resolution. The endpoint resolves a past order back to
 * currently-purchasable variants; the storefront prices them from the live catalog, so a price
 * change since the original order is picked up automatically.
 */
export interface ReorderLine {
  variant_id: string;
  product_id: string | null;
  product_name: string;
  weight_grams: number;
  grind_type: string;
  quantity: number;
  available: boolean;
}

export interface ProfileRecommendation {
  product_id: string;
  name: string;
  slug: string;
  image_url: string;
  roast_level: string;
  origin_country: string;
  tasting_notes: string[];
  variant_id: string | null;
  price_cents: number | null;
  /** Why this was picked — shown verbatim to the customer, so keep it human. */
  reason: string;
  kind: 'YOUR_USUAL' | 'AFFINITY' | 'DISCOVERY';
  score: number;
}
