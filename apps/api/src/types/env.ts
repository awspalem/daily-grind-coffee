import type { D1DatabaseLike } from '@daily-grind/db';

export interface Env {
  DB: D1DatabaseLike;
  MEDIA_BUCKET?: any;
  CONFIG_KV?: any;
  JOB_QUEUE?: any;
  AI?: any;

  // Environment variables & Secrets
  ENVIRONMENT: string;
  STOREFRONT_URL: string;
  ADMIN_URL: string;
  CURRENCY: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  ADMIN_TOKEN?: string;
  TURNSTILE_SECRET_KEY?: string;
}
