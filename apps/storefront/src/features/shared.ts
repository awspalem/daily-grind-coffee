/**
 * Shared plumbing for storefront feature modules.
 *
 * Each feature (profile, loyalty, referral, subscriptions, experiences) lives in its own file
 * under this directory and is initialised at the bottom of ../main.ts. Features must NOT edit
 * main.ts or index.html — they build their own DOM through `mountFeatureSection` and register
 * their own nav entry through `registerNavPill`, so several features can be developed in
 * parallel without ever touching the same file.
 */

export const API_BASE = 'https://api.dailyroast.in';

export function getSessionToken(): string | null {
  return localStorage.getItem('tdg_customer_session');
}

export function getCustomerEmail(): string | null {
  return localStorage.getItem('tdg_customer_email');
}

export function isSignedIn(): boolean {
  return !!getSessionToken();
}

/**
 * fetch() against the API with the customer session attached. Returns parsed JSON, or an
 * `{ success: false, error }` shape on network/parse failure so callers never need try/catch.
 */
export async function apiFetch<T = any>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T & { success: boolean; error?: string }> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  const token = getSessionToken();
  if (token) headers['X-Customer-Session'] = token;

  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, headers, body });
    if (res.status === 401) {
      const body = await res.clone().json().catch(() => null);
      if (body && (body.code === 'SESSION_EXPIRED' || body.error === 'SESSION_EXPIRED')) {
        localStorage.removeItem('tdg_customer_session');
        localStorage.removeItem('tdg_customer_email');
      }
    }
    return (await res.json()) as any;
  } catch (err) {
    console.error(`[feature] ${path} failed`, err);
    return { success: false, error: 'Network error' } as any;
  }
}

/**
 * Creates (once) a `<section>` inside <main>, just before the site footer, and returns it.
 * Calling again with the same id returns the existing element.
 */
export function mountFeatureSection(id: string, className = 'catalog-section'): HTMLElement {
  const existing = document.getElementById(id);
  if (existing) return existing;

  const section = document.createElement('section');
  section.id = id;
  section.className = className;

  const main = document.getElementById('main-content') || document.body;
  main.appendChild(section);
  return section;
}

/**
 * Adds a link to the footer's "Your Account" column, creating that column on first use.
 * Idempotent.
 *
 * Deliberately *not* the header. `ul.nav-links` is a single flex row inside a 1280px container
 * that already carries seven links beside the brand and four action controls — it was close to
 * full before any of this existed, and five more collapsed it: every label wrapped to two lines,
 * the brand broke onto three, and the currency toggle overlapped the last link. There is no
 * overflow treatment to fall back on, so the header is left exactly as it was.
 *
 * The footer is the right home anyway: it already carries "Track My Order" in the same spirit,
 * its columns wrap on their own, and these are account destinations rather than browse
 * destinations.
 */
export function registerNavPill(targetId: string, label: string): void {
  const container = document.querySelector('.footer-container');
  if (!container) return;

  let column = container.querySelector<HTMLElement>('[data-feature-nav-column]');
  if (!column) {
    column = document.createElement('div');
    column.className = 'footer-col';
    column.setAttribute('data-feature-nav-column', '');
    column.innerHTML = '<h4>Your Account</h4><ul></ul>';
    container.appendChild(column);
  }

  const list = column.querySelector('ul');
  if (!list || list.querySelector(`[data-feature-nav="${targetId}"]`)) return;

  const link = document.createElement('a');
  link.href = `#${targetId}`;
  link.textContent = label;
  link.setAttribute('data-feature-nav', targetId);

  const item = document.createElement('li');
  item.appendChild(link);
  list.appendChild(item);
}

/** Escapes text destined for innerHTML. Every feature renders customer-supplied strings. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ));
}

/**
 * Decodes a URL-safe base64 VAPID key into the ArrayBuffer `PushManager.subscribe` wants for
 * `applicationServerKey`. Shared so the notification centre and main.ts's `syncPushSubscription`
 * use one implementation rather than two hand-rolled copies of the padding/charset fix-ups.
 */
export function urlBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);
}

// ---------------------------------------------------------------------------
// toast — non-blocking notification. Replaces alert() in the feature modules so
// a failed save no longer freezes the page on an OS dialog. Self-contained: the
// container and its styles are injected on first use, so no index.html changes.
// ---------------------------------------------------------------------------
export type ToastKind = 'success' | 'error' | 'info';

let toastStack: HTMLElement | null = null;

function ensureToastStack(): HTMLElement {
  if (toastStack && toastStack.isConnected) return toastStack;

  const style = document.createElement('style');
  style.textContent = `
    #tdg-toast-stack { position: fixed; z-index: 9999; left: 50%; bottom: 1.25rem; transform: translateX(-50%);
      display: flex; flex-direction: column; gap: 0.5rem; width: min(92vw, 420px); pointer-events: none; }
    #tdg-toast-stack .tdg-toast { pointer-events: auto; display: flex; gap: 0.6rem; align-items: flex-start;
      background: #1c1a17; color: #f5f1ea; border-radius: 10px; padding: 0.8rem 0.9rem; font-size: 0.9rem;
      line-height: 1.4; box-shadow: 0 8px 28px rgba(0,0,0,0.28); border-left: 4px solid #8a8175;
      animation: tdg-toast-in 0.18s ease-out; }
    #tdg-toast-stack .tdg-toast--success { border-left-color: #4c9a68; }
    #tdg-toast-stack .tdg-toast--error { border-left-color: #d1524f; }
    #tdg-toast-stack .tdg-toast--leaving { opacity: 0; transform: translateY(6px); transition: opacity 0.2s, transform 0.2s; }
    #tdg-toast-stack .tdg-toast-close { margin-left: auto; background: none; border: 0; color: inherit;
      font-size: 1.1rem; line-height: 1; cursor: pointer; opacity: 0.7; }
    @keyframes tdg-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @media (prefers-reduced-motion: reduce) { #tdg-toast-stack .tdg-toast { animation: none; } }
  `;
  document.head.appendChild(style);

  const stack = document.createElement('div');
  stack.id = 'tdg-toast-stack';
  document.body.appendChild(stack);
  toastStack = stack;
  return stack;
}

export function toast(message: string, kind: ToastKind = 'info', durationMs = 4000): void {
  const stack = ensureToastStack();
  const el = document.createElement('div');
  el.className = `tdg-toast tdg-toast--${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `<div>${esc(message)}</div><button class="tdg-toast-close" type="button" aria-label="Dismiss">&times;</button>`;
  el.querySelector('.tdg-toast-close')?.addEventListener('click', dismiss);
  stack.appendChild(el);
  while (stack.children.length > 4) stack.firstElementChild?.remove();
  const timer = setTimeout(dismiss, durationMs);
  function dismiss() {
    clearTimeout(timer);
    if (!el.isConnected) return;
    el.classList.add('tdg-toast--leaving');
    setTimeout(() => el.remove(), 220);
  }
}
