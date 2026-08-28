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
  /** Overrides the speech-to-text model; defaults to whisper-large-v3-turbo. */
  GROQ_TRANSCRIBE_MODEL?: string;
  GROQ_MODEL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  /**
   * Web Push (VAPID). All three must be set for pushes to go out; missing any one makes the
   * push sender a logged no-op. See services/webPush.ts for how to generate a keypair.
   */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_JWK?: string;
  VAPID_SUBJECT?: string;
  ADMIN_TOKEN?: string;
  TURNSTILE_SECRET_KEY?: string;
  SHIPROCKET_EMAIL?: string;
  SHIPROCKET_PASSWORD?: string;
  SHIPROCKET_PICKUP_LOCATION?: string;
  SHIPROCKET_WEBHOOK_TOKEN?: string;
  SHIPROCKET_USD_TO_INR_RATE?: string;
  /**
   * Cloudflare Zero Trust team domain (e.g. "dailyroast" — the JWKS endpoint is
   * `https://dailyroast.cloudflareaccess.com/cdn-cgi/access/certs`). When set
   * together with ACCESS_AUD, the admin guard accepts requests that carry a
   * valid CF_Authorization cookie, so the admin SPA and the API can be on
   * separate Access applications or the API can be unprotected at the edge.
   */
  ACCESS_TEAM_DOMAIN?: string;
  /** Application AUD tag from the Cloudflare Access dashboard. */
  ACCESS_AUD?: string;
}
