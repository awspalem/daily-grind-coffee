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

export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);
}
