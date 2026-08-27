// Vite compile-time global set by vite.config.ts from the VITE_ADMIN_TOKEN
// env var. Empty string in dev (the API's dev-bypass accepts unauthenticated
// requests), or the bearer value in production (set the matching Wrangler
// secret on the API Worker).
declare const __ADMIN_TOKEN__: string;

interface Window {
  __ADMIN_TOKEN__?: string;
}
