/**
 * Shared plumbing for admin feature modules.
 *
 * Each feature lives in its own file under this directory and is initialised at the bottom of
 * ../main.ts. Features build their own panel + nav entry through these helpers rather than
 * editing main.ts or index.html, so parallel feature work never collides.
 */

// vite.config.ts proxies /api -> localhost:8787 in dev; use that instead of hitting prod
// directly so local testing doesn't read/write real data (and doesn't need prod CORS to
// allow the dev origin).
export const API_BASE = import.meta.env.DEV ? '/api' : 'https://api.dailyroast.in';

/**
 * fetch() against the admin API. Auth is Cloudflare Access at the edge — `credentials:
 * 'include'` is what forwards the Access session cookie cross-origin; no app-level token.
 */
export async function adminFetch<T = any>(
  path: string,
  options: RequestInit & { json?: unknown } = {}
): Promise<T & { success: boolean; error?: string }> {
  const { json, ...rest } = options;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
    return (await res.json()) as any;
  } catch (err) {
    console.error(`[admin feature] ${path} failed`, err);
    return { success: false, error: 'Network error' } as any;
  }
}

export function esc(value: unknown): string {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

export function triggerHaptic(): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(12);
    } catch {
      // Ignore vibration errors on unsupported platforms
    }
  }
}
