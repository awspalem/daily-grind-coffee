// Shared contracts for the loyalty feature. Re-exported from ./index.ts — add types here rather
// than to index.ts, so parallel feature work never collides in one file.

export type LoyaltyEntryType = 'EARN' | 'REDEEM' | 'EXPIRE' | 'ADJUST';

export type LoyaltyReason =
  | 'SIGNUP_BONUS'
  | 'ORDER_DELIVERED'
  | 'REVIEW_BONUS'
  | 'SUBSCRIPTION_STREAK'
  | 'REFERRAL_REWARD'
  | 'ORDER_REDEEM'
  | 'REDEEM_RECLAIMED'
  | 'REFUND_CLAWBACK'
  | 'REFUND_RESTORE'
  | 'POINTS_EXPIRED'
  | 'ADMIN_ADJUST';

export type LoyaltyTier = 'BRONZE' | 'SILVER' | 'GOLD';

/** One immutable row of `loyalty_ledger`, as rendered in the customer statement. */
export interface LoyaltyLedgerEntry {
  id: string;
  entry_type: LoyaltyEntryType;
  reason: LoyaltyReason;
  points_delta: number;
  ref_type: string | null;
  ref_id: string | null;
  expires_at: string | null;
  note: string | null;
  created_at: string;
}

export interface LoyaltyTierInfo {
  tier: LoyaltyTier;
  /** Trailing-12-month delivered spend, in minor units (paise). */
  trailing_spend_cents: number;
  next_tier: LoyaltyTier | null;
  /** Minor units still needed to reach `next_tier`; 0 when already at the top. */
  cents_to_next_tier: number;
  earn_multiplier: number;
  perks: string[];
}

export interface LoyaltySummary {
  balance: number;
  lifetime_points: number;
  tier: LoyaltyTierInfo;
  /** Points lapsing within the warning window, and the date the soonest lot lapses. */
  expiring_soon_points: number;
  expiring_soon_at: string | null;
  point_value_cents: number;
}

/** Result of asking "how much can I take off this basket?" — advisory; checkout re-validates. */
export interface LoyaltyRedemptionPreview {
  eligible: boolean;
  reason?: string;
  balance: number;
  max_points: number;
  max_discount_cents: number;
  min_points: number;
  cap_percent: number;
  point_value_cents: number;
}
