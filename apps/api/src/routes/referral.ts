import { Hono } from 'hono';
import type { Env } from '../types/env';

// Referral codes, attribution, dual-sided rewards and the referrer dashboard.
// Owner: Phase 3 — referral. Routes are mounted in ../index.ts — do not edit that file to add endpoints
// here; add them to this app instead.
const referralApp = new Hono<{ Bindings: Env }>();

export { referralApp };
