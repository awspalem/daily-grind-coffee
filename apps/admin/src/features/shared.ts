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

/** Creates (once) a collapsible section panel at the end of <main>, matching existing panels. */
export function mountAdminPanel(panelId: string, title: string, headerActionHtml = ''): HTMLElement {
  const existing = document.getElementById(panelId);
  if (existing) return existing;

  const section = document.createElement('section');
  section.className = 'section-panel';
  section.id = panelId;
  section.innerHTML = `
    <div class="panel-header">
      <h2 class="panel-title">${title}</h2>
      ${headerActionHtml}
    </div>
    <div class="panel-body"></div>
  `;

  const main = document.querySelector('.admin-main') || document.body;
  main.appendChild(section);
  return section;
}

/** The panel's content area — write feature markup here, leaving the header intact. */
export function panelBody(panelId: string): HTMLElement | null {
  return document.querySelector(`#${panelId} .panel-body`);
}

/**
 * Adds a sidebar nav entry that reveals and scrolls to the feature's panel. main.ts only knows
 * about its own static tab->panel map, so the listener is attached here.
 */
export function registerAdminNavItem(tab: string, label: string, panelId: string): void {
  const list = document.querySelector('.nav-item-btn')?.closest('ul');
  if (!list || list.querySelector(`[data-tab="${tab}"]`)) return;

  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.className = 'nav-item-btn';
  btn.setAttribute('data-tab', tab);
  btn.textContent = label;
  btn.addEventListener('click', () => {
    const panel = document.getElementById(panelId);
    panel?.classList.remove('collapsed');
    panel?.scrollIntoView({ behavior: 'smooth' });
  });
  li.appendChild(btn);
  list.appendChild(li);
}

export function esc(value: unknown): string {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}
