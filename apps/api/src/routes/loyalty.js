import { Hono } from 'hono';
// Loyalty points ledger: earning, redemption, tiers, statement.
// Owner: Phase 2 — loyalty. Routes are mounted in ../index.ts — do not edit that file to add endpoints
// here; add them to this app instead.
const loyaltyApp = new Hono();
export { loyaltyApp };
