-- Migration 0025 — Explicit no-show forfeiture tracking on bookings.
--
-- Until now the no-show policy lived in a comment in services/bookings.ts: the entitlement is
-- not released and the payment is not refunded. The 0016 schema had no column that recorded
-- whether a forfeiture had been applied, so support could not distinguish a no-show whose
-- credit had been clawed back from one that had been left in place by a misclick on the staff
-- tablet. This column is set the moment markAttendance flips the booking to NO_SHOW, and is
-- the only place downstream (admin roster, the loyalty hook that might want to ban repeat
-- offenders) reads the forfeiture from.
--
-- 0/1 rather than nullable: an unmarked booking is implicitly "not a no-show", which is
-- unambiguous to query. Backfilled to 0 for every existing row, which the migration runner
-- applies via the column default.

ALTER TABLE bookings ADD COLUMN no_show_forfeited INTEGER NOT NULL DEFAULT 0;
