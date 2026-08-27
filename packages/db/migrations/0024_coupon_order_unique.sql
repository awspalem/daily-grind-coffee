-- 0024: coupon redemption hardening
--
-- The checkout flow re-validates a coupon at submit time and then unconditionally runs
--   UPDATE coupons SET times_used = times_used + 1
--   INSERT INTO coupon_redemptions (...)
-- in the order batch. Two concurrent checkouts for the same single-use coupon can both pass
-- the validation read, both run the batch, and both insert a redemption — the second order
-- still pays the discount, the times_used counter overshoots max_uses, and the campaign runs
-- at a loss.
--
-- Two guards:
--   1. UPDATE becomes conditional on (max_uses IS NULL OR times_used < max_uses). A concurrent
--      winner that already used the last slot will push the row past the limit; the next UPDATE
--      matches zero rows. Checkout treats the "changes=0" signal as an exhausted coupon and
--      rolls the order back rather than letting it through without the redemption.
--   2. UNIQUE (coupon_id, order_id) makes a retried checkout for the same order a no-op at
--      write time, so a transient network blip that double-submits the same checkout cannot
--      double-count the redemption.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_coupon_redemption_per_order
  ON coupon_redemptions (coupon_id, order_id);
