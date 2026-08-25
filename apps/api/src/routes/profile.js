import { Hono } from 'hono';
// Derived customer profile: taste graph, order history, address book, saved preferences.
// Owner: Phase 1 — customer profile. Routes are mounted in ../index.ts — do not edit that file to add endpoints
// here; add them to this app instead.
const profileApp = new Hono();
export { profileApp };
