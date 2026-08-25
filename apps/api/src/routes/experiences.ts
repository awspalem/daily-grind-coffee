import { Hono } from 'hono';
import type { Env } from '../types/env';

// Bookable experiences: teleconsultation, roastery tour, cupping session, estate visit.
// Owner: Phase 5 — experiences. Routes are mounted in ../index.ts — do not edit that file to add endpoints
// here; add them to this app instead.
const experiencesApp = new Hono<{ Bindings: Env }>();

export { experiencesApp };
