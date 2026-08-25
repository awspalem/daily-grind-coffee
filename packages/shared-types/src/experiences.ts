// Shared contracts for the experiences feature. Re-exported from ./index.ts — add types here rather
// than to index.ts, so parallel feature work never collides in one file.
//
// All DATETIME fields below are UTC ISO-8601 strings, matching migration 0016. Rendering into
// Asia/Kolkata is the caller's job.

export type ExperienceType =
  | 'TELECONSULT'
  | 'ROASTERY_TOUR'
  | 'CUPPING_SESSION'
  | 'ESTATE_VISIT';

/** VIDEO carries a meeting link on the slot; ONSITE carries a physical location. */
export type ExperienceMode = 'VIDEO' | 'ONSITE';

export type ExperienceStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED';

export type SlotStatus = 'OPEN' | 'CLOSED' | 'CANCELLED' | 'COMPLETED';

export type BookingStatus =
  | 'HOLD'
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'WAITLISTED'
  | 'WAITLIST_OFFERED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'COMPLETED'
  | 'NO_SHOW';

/** How a confirmed booking was paid for. Chosen at confirm time, not at hold time. */
export type BookingFundingSource = 'PAID' | 'ENTITLEMENT' | 'FREE';

export type BookingPaymentStatus =
  | 'UNPAID'
  | 'PAID'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'REFUND_FAILED';

export interface Experience {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  experience_type: ExperienceType;
  mode: ExperienceMode;
  duration_minutes: number | null;
  is_multi_day: number;
  default_capacity: number;
  price_cents: number;
  deposit_cents: number;
  currency: string;
  /** The 0011 entitlement code that can fund this instead of payment. */
  entitlement_code: string | null;
  cancellation_cutoff_hours: number;
  cancellation_policy: string | null;
  refund_on_cancel: number;
  location_name: string | null;
  location_address: string | null;
  display_timezone: string;
  collects_party_size: number;
  max_party_size: number;
  collects_notes: number;
  image_url: string | null;
  sort_order: number;
  status: ExperienceStatus;
  created_at: string;
  updated_at: string;
}

export interface ExperienceSlot {
  id: string;
  experience_id: string;
  starts_at: string;
  ends_at: string;
  seats_total: number;
  seats_booked: number;
  staff_name: string | null;
  staff_email: string | null;
  meeting_url: string | null;
  location_override: string | null;
  price_cents_override: number | null;
  status: SlotStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A slot as the storefront sees it: capacity resolved, meeting link withheld until confirmed. */
export interface AvailableSlot {
  id: string;
  experience_id: string;
  starts_at: string;
  ends_at: string;
  seats_total: number;
  seats_booked: number;
  seats_available: number;
  staff_name: string | null;
  location: string | null;
  price_cents: number;
  currency: string;
  /** True when the only way onto this slot is the waitlist. */
  is_full: boolean;
}

export interface Booking {
  id: string;
  booking_reference: string;
  experience_id: string;
  slot_id: string;
  customer_id: string;
  customer_email: string;
  customer_name: string | null;
  contact_phone: string | null;
  status: BookingStatus;
  seats: number;
  party_size: number;
  funding_source: BookingFundingSource | null;
  amount_cents: number;
  deposit_cents: number;
  currency: string;
  entitlement_code: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  payment_status: BookingPaymentStatus | null;
  dietary_notes: string | null;
  accessibility_notes: string | null;
  hold_expires_at: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  rescheduled_from_slot_id: string | null;
  reschedule_count: number;
  attended_at: string | null;
  no_show_at: string | null;
  staff_notes: string | null;
  confirmation_sent_at: string | null;
  reminder_sent_at: string | null;
  ics_token: string;
  created_at: string;
  updated_at: string;
}

/** A booking joined to the experience and slot it belongs to — what the account page renders. */
export interface BookingDetail extends Booking {
  experience_name: string;
  experience_slug: string;
  experience_type: ExperienceType;
  mode: ExperienceMode;
  display_timezone: string;
  cancellation_policy: string | null;
  cancellation_cutoff_hours: number;
  starts_at: string;
  ends_at: string;
  staff_name: string | null;
  location: string | null;
  /** Only populated once the booking is CONFIRMED; withheld while it is a mere hold. */
  meeting_url: string | null;
  /** Whether self-serve cancel/reschedule is still inside the policy window. */
  can_self_manage: boolean;
}

export interface ExperienceBlackout {
  id: string;
  experience_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_at: string;
}

export interface CreateBookingRequest {
  slotId: string;
  partySize?: number;
  contactPhone?: string;
  dietaryNotes?: string;
  accessibilityNotes?: string;
  /** Client-generated, so a double-tapped "Book" reuses the held row instead of taking a second seat. */
  idempotencyKey?: string;
}

export interface ConfirmBookingRequest {
  /** Force the paid path even when an entitlement is available (e.g. saving the credit for later). */
  fundingSource?: 'PAID' | 'ENTITLEMENT';
}

export interface ConfirmBookingResponse {
  success: boolean;
  error?: string;
  booking?: BookingDetail;
  /** Present only on the paid path — where to send the customer to complete payment. */
  checkoutUrl?: string;
  fundingSource?: BookingFundingSource;
}
