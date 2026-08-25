import { Hono } from 'hono';
// Customer-facing subscription management, plan tiers and entitlement grants.
// Owner: Phase 4 — subscription tiers. Routes are mounted in ../index.ts — do not edit that file to add endpoints
// here; add them to this app instead.
const subscriptionsApp = new Hono();
export { subscriptionsApp };
