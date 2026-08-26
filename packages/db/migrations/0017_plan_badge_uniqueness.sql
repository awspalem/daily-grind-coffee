-- 0017: one "MOST POPULAR" plan, not two.
--
-- 0015 seeded both Connoisseur tiers with the same badge. Side by side on the pricing grid the
-- claim reads as marketing noise rather than a signal, and it gives a shopper no help choosing
-- between the two plans it appears on. The monthly tier keeps MOST POPULAR as the volume
-- anchor; the annual tier gets its own, distinct promise.

UPDATE subscription_plans
SET badge = 'RECOMMENDED'
WHERE id = 'plan_connoisseur_annual'
  AND badge = 'MOST POPULAR';
