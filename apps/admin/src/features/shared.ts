/**
 * Shared plumbing for admin feature modules.
 *
 * Each feature lives in its own file under this directory and is initialised at the bottom of
 * ../main.ts. Features build their own panel + nav entry through these helpers rather than
 * editing main.ts or index.html, so parallel feature work never collides.
 */
import { icons } from '../icons';

// vite.config.ts proxies /api -> localhost:8787 in dev; use that instead of hitting prod
// directly so local testing doesn't read/write real data (and doesn't need prod CORS to
// allow the dev origin). Every call site already includes the leading /api itself (e.g.
// adminFetch('/api/admin/orders')), so the dev base must be empty — NOT '/api' — or every
// request doubles up into /api/api/admin/orders and 404s.
export const API_BASE = import.meta.env.DEV ? '' : 'https://api.dailyroast.in';

/**
 * fetch() against the admin API. Auth is Cloudflare Access at the edge
 * when the SPA is gated there (Cf-Access-* headers are attached automatically
 * and the in-app guard's first happy path accepts them). For environments
 * without an Access application, set the ADMIN_TOKEN secret on the API
 * Worker and the VITE_ADMIN_TOKEN env var at admin build time — every
 * request then sends `Authorization: Bearer <token>`. The two values must
 * match. `credentials: 'include'` is kept so that any Access session
 * cookie that IS present still flows through.
 */
export async function adminFetch<T = any>(
  path: string,
  options: RequestInit & { json?: unknown } = {}
): Promise<T & { success: boolean; error?: string }> {
  const { json, ...rest } = options;
  const adminToken = (typeof __ADMIN_TOKEN__ !== 'undefined' ? __ADMIN_TOKEN__ : '') || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (adminToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${adminToken}`;
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      credentials: 'include',
      headers,
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

// ---------------------------------------------------------------------------
// Toast notifications — replaces every alert() call in the app.
// Mounts into #toast-stack (declared in index.html). Stacks up to 4; older
// toasts are auto-evicted. Click ✕ or wait durationMs to dismiss.
// ---------------------------------------------------------------------------
export type ToastKind = 'success' | 'error' | 'info' | 'warning';

const TOAST_ICON: Record<ToastKind, string> = {
  success: icons.check,
  error: icons.errorIcon,
  info: icons.info,
  warning: icons.warning,
};

export function toast(message: string, kind: ToastKind = 'info', durationMs = 3500): void {
  const stack = document.getElementById('toast-stack');
  if (!stack) {
    // Fallback: don't break the app if the stack isn't in the DOM (e.g. during teardown)
    console.warn('[toast] #toast-stack missing; message was:', message);
    return;
  }
  triggerHaptic();
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `
    <span class="toast-icon">${TOAST_ICON[kind]}</span>
    <div class="toast-body">${esc(message)}</div>
    <button class="toast-close" type="button" aria-label="Dismiss notification">×</button>`;
  el.querySelector('.toast-close')?.addEventListener('click', () => dismiss());
  stack.appendChild(el);
  // Cap at 4 toasts on screen
  while (stack.children.length > 4) stack.firstElementChild?.remove();
  const timer = setTimeout(dismiss, durationMs);
  function dismiss() {
    clearTimeout(timer);
    if (!el.isConnected) return;
    el.classList.add('toast--leaving');
    setTimeout(() => el.remove(), 220);
  }
}

// ---------------------------------------------------------------------------
// confirmModal — branded confirm dialog (replaces native confirm()).
// Returns a Promise<boolean>. Esc/click-outside/Cancel → false, Enter/OK → true.
// ---------------------------------------------------------------------------
export interface ConfirmModalOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function confirmModal(opts: ConfirmModalOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'admin-modal-backdrop visible';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.innerHTML = `
      <div class="admin-modal-dialog confirm-modal" style="max-width: 440px;">
        <div class="sheet-drag-handle"><div class="drag-pill"></div></div>
        <div class="admin-modal-header">
          <h3>${esc(opts.title)}</h3>
          <button type="button" class="admin-modal-close" data-act="close" aria-label="Close">×</button>
        </div>
        <div class="admin-modal-body" style="padding: 1.4rem 1.6rem; color: var(--text-muted); line-height: 1.55;">${esc(opts.body)}</div>
        <div class="admin-modal-footer">
          <button type="button" class="btn-secondary" data-act="cancel">${esc(opts.cancelLabel ?? 'Cancel')}</button>
          <button type="button" class="btn-primary ${opts.danger ? 'btn-danger' : ''}" data-act="confirm">${esc(opts.confirmLabel ?? 'Confirm')}</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    let resolved = false;
    const close = (val: boolean) => {
      if (resolved) return;
      resolved = true;
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(val);
    };
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) close(true);
    }
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) { close(false); return; }
      const act = (e.target as HTMLElement).dataset?.act;
      if (act === 'confirm') close(true);
      else if (act === 'cancel' || act === 'close') close(false);
    });
    document.addEventListener('keydown', onKey);
    // Auto-focus the confirm button so Enter works without a click
    backdrop.querySelector<HTMLButtonElement>('[data-act="confirm"]')?.focus();
  });
}

// ---------------------------------------------------------------------------
// openInlineModal — generic content-into-backdrop helper for shell.ts
// and any feature that wants a one-off modal without writing the boilerplate.
// ---------------------------------------------------------------------------
export interface InlineModalOptions {
  title: string;
  bodyHtml: string;
  primaryLabel?: string;
  primaryKind?: 'primary' | 'danger';
  secondaryLabel?: string;
  onPrimary?: (close: () => void) => void | Promise<void>;
}

export function openInlineModal(opts: InlineModalOptions): { close: () => void } {
  const backdrop = document.createElement('div');
  backdrop.className = 'admin-modal-backdrop visible';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  const primaryCls = opts.primaryKind === 'danger' ? 'btn-primary btn-danger' : 'btn-primary';
  backdrop.innerHTML = `
    <div class="admin-modal-dialog" style="max-width: 520px;">
      <div class="sheet-drag-handle"><div class="drag-pill"></div></div>
      <div class="admin-modal-header">
        <h3>${esc(opts.title)}</h3>
        <button type="button" class="admin-modal-close" data-act="close" aria-label="Close">×</button>
      </div>
      <div class="admin-modal-body">${opts.bodyHtml}</div>
      <div class="admin-modal-footer">
        ${opts.secondaryLabel ? `<button type="button" class="btn-secondary" data-act="secondary">${esc(opts.secondaryLabel)}</button>` : ''}
        <button type="button" class="${primaryCls}" data-act="primary">${esc(opts.primaryLabel ?? 'Save')}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => { document.removeEventListener('keydown', onKey); backdrop.remove(); };
  function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) { close(); return; }
    const act = (e.target as HTMLElement).dataset?.act;
    if (act === 'close' || act === 'secondary') { close(); return; }
    if (act === 'primary') {
      const result = opts.onPrimary?.(close);
      if (result instanceof Promise) result.catch((e) => { console.error(e); close(); });
    }
  });
  backdrop.querySelector<HTMLButtonElement>('[data-act="primary"]')?.focus();
  return { close };
}
