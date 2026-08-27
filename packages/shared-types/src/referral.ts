// Shared contracts for the referral feature. Re-exported from ./index.ts — add types here rather
// than to index.ts, so parallel feature work never collides in one file.

export type ReferralStatus = 'ATTRIBUTED' | 'QUALIFIED' | 'REVERSED' | 'BLOCKED';

export type ReferralBlockReason =
  | 'SELF_EMAIL'
  | 'SELF_PHONE'
  | 'SELF_ADDRESS'
  | 'ALREADY_REFERRED'
  | 'EXISTING_CUSTOMER';

export interface ReferralShareTargets {
  url: string;
  whatsapp_url: string;
  /** Pre-written message for the copy-link / native-share path. */
  message: string;
}

export interface ReferralStats {
  invited: number;
  signed_up: number;
  purchased: number;
  /** All referral rows for this referrer, including reversed ones. */
  total: number;
  /** Referral rows that reached DELIVERED and so paid out. */
  successful: number;
  /** Referral rows still waiting on delivery (or refund). */
  pending: number;
  /** Points already paid out to the referrer (delivered orders only). */
  points_earned: number;
  /** Points attributed but not yet delivered, so not yet payable. */
  points_pending: number;
}

export interface ReferralDashboard {
  code: string;
  share: ReferralShareTargets;
  stats: ReferralStats;
  referee_discount_cents: number;
  referrer_points: number;
  recent: Array<{
    referee_masked: string;
    status: ReferralStatus;
    points: number;
    created_at: string;
  }>;
}

/** Referee-side check at checkout: is this code usable, and for how much off? */
export interface ReferralValidation {
  valid: boolean;
  error?: string;
  code?: string;
  discount_cents: number;
  referrer_name?: string;
}
