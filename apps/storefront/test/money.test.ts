/**
 * Money formatting on the storefront.
 *
 * This exists because the loyalty section shipped a false claim to production: the tile read
 * "EACH POINT IS WORTH ₹50" when a point is worth fifty paise. `point_value_cents` is already
 * in minor units, but the render scaled it by 100 the way `rupees_per_point_earned` (which is
 * whole rupees) legitimately needs. Nothing typed or built could see it — both are `number`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { inrPrecise } from '../src/features/loyalty';

/** What GET /api/loyalty/config actually returns for `point_value_cents`. */
const POINT_VALUE_CENTS = 50;

test('money: a point is worth fifty paise, not fifty rupees', () => {
  assert.equal(inrPrecise(POINT_VALUE_CENTS), '₹0.50');
});

test('money: sub-rupee amounts keep their paise instead of rounding away', () => {
  assert.equal(inrPrecise(1), '₹0.01');
  assert.equal(inrPrecise(50), '₹0.50');
  assert.equal(inrPrecise(99), '₹0.99');
});

test('money: whole rupees print without trailing zeros', () => {
  assert.equal(inrPrecise(100), '₹1');
  assert.equal(inrPrecise(15_000), '₹150');
  assert.equal(inrPrecise(0), '₹0');
});

test('money: large amounts group in the Indian system', () => {
  // ₹1,20,000 — lakhs, not thousands. `toLocaleString('en-IN')` is doing the work; this pins it.
  assert.equal(inrPrecise(12_000_000), '₹1,20,000');
});

test('money: a scaled point value would be caught', () => {
  // The exact bug: multiplying an already-minor-unit value by 100.
  assert.notEqual(inrPrecise(POINT_VALUE_CENTS * 100), inrPrecise(POINT_VALUE_CENTS));
  assert.equal(inrPrecise(POINT_VALUE_CENTS * 100), '₹50', 'this is what visitors were shown');
});
