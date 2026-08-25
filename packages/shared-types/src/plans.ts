// Shared contracts for the plans feature. Re-exported from ./index.ts — add types here rather
// than to index.ts, so parallel feature work never collides in one file.

export type PlanTier = 'EXPLORER' | 'CONNOISSEUR' | 'FOUNDER';

/** MONTHLY is charged per delivery cycle by the renewal cron; ANNUAL is prepaid up front. */
export type PlanTerm = 'MONTHLY' | 'ANNUAL';

export type SubscriptionFrequency = '1_WEEK' | '2_WEEKS' | '4_WEEKS';

/**
 * PREPAID is new in migration 0015: the term is paid for, shipments are owed, but no charge is
 * due. The renewal cron only picks up ACTIVE rows, so a prepaid member can never be double-billed.
 */
export type SubscriptionStatus = 'ACTIVE' | 'PREPAID' | 'PAUSED' | 'CANCELLED' | 'PAST_DUE';

/** One line of `subscription_plans.entitlements_json`. `units: -1` means unlimited for the term. */
export interface PlanEntitlement {
  code: string;
  units: number;
}

export interface SubscriptionPlan {
  id: string;
  slug: string;
  name: string;
  tier: PlanTier;
  term: PlanTerm;
  tagline: string | null;
  description: string | null;
  price_cents: number;
  currency: string;
  discount_percent: number;
  default_frequency: SubscriptionFrequency;
  shipments_included: number | null;
  term_months: number;
  perks: string[];
  entitlements: PlanEntitlement[];
  badge: string | null;
  display_order: number;
  is_active: boolean;
}

export interface CustomerSubscription {
  id: string;
  customer_email: string;
  plan_id: string | null;
  plan_name: string | null;
  plan_tier: PlanTier | null;
  plan_term: PlanTerm | null;
  variant_id: string;
  product_name: string;
  grind_type: string;
  frequency: SubscriptionFrequency;
  quantity: number;
  unit_price_cents: number;
  discount_percent: number;
  status: SubscriptionStatus;
  next_renewal_date: string;
  term_started_at: string | null;
  term_ends_at: string | null;
  shipments_remaining: number | null;
  has_payment_method: boolean;
  shipping_address: Record<string, unknown> | null;
  created_at: string;
}

export interface UpcomingShipment {
  subscription_id: string;
  product_name: string;
  grind_type: string;
  quantity: number;
  scheduled_for: string;
  /** False for a prepaid shipment — nothing is charged, the term already covers it. */
  will_charge: boolean;
  estimated_total_cents: number;
}

export type SubscriptionEventType =
  | 'CREATED'
  | 'PAUSED'
  | 'RESUMED'
  | 'SKIPPED'
  | 'UPDATED'
  | 'SWAPPED'
  | 'CANCELLED'
  | 'SAVE_OFFER_ACCEPTED'
  | 'RENEWAL_NOTICE_SENT'
  | 'PAYMENT_METHOD_UPDATED'
  | 'ENTITLEMENTS_GRANTED';

export interface SubscriptionEvent {
  id: string;
  subscription_id: string;
  event_type: SubscriptionEventType;
  actor: 'CUSTOMER' | 'ADMIN' | 'SYSTEM';
  detail: Record<string, unknown> | null;
  created_at: string;
}

/** What a customer is offered instead of cancelling outright. */
export interface SaveOffer {
  kind: 'PAUSE' | 'DISCOUNT' | 'SLOWER_CADENCE';
  headline: string;
  detail: string;
}
