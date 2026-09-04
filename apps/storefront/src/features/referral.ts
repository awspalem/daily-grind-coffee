/**
 * Referral feature UI — share sheet, funnel dashboard, and inbound `?ref=` capture.
 * Build all DOM through the helpers in ./shared.ts; do not edit index.html.
 *
 * Two halves that run in different browsers: the *referrer* sees the dashboard below, while the
 * *referee* arrives on a `?ref=CODE` link and never sees this section at all — for them this
 * module only records the visit and parks the code for checkout to send.
 */

import { apiFetch, esc, isSignedIn, mountFeatureSection, registerNavPill, signInPrompt } from './shared';

const SECTION = 'referral-programme';
const REF_CODE_KEY = 'tdg_referral_code';

const STATUS_COPY: Record<string, string> = {
  ATTRIBUTED: 'Ordered — reward pending delivery',
  QUALIFIED: 'Delivered — points paid',
  REVERSED: 'Reversed (order refunded)',
  BLOCKED: 'Not eligible',
};

interface Dashboard {
  code: string;
  share: { url: string; whatsapp_url: string; message: string };
  stats: {
    invited: number;
    signed_up: number;
    purchased: number;
    points_earned: number;
    points_pending: number;
  };
  referee_discount_cents: number;
  referrer_points: number;
  recent: Array<{ referee_masked: string; status: string; points: number; created_at: string }>;
}

function inr(cents: number): string {
  return '₹' + Math.round((cents || 0) / 100).toLocaleString('en-IN');
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The referral code this browser arrived on, for main.ts to attach at checkout. */
export function getStoredReferralCode(): string | null {
  try {
    return localStorage.getItem(REF_CODE_KEY);
  } catch {
    return null;
  }
}

/** Cleared once an order is placed, so one link cannot discount every future order. */
export function clearStoredReferralCode(): void {
  try {
    localStorage.removeItem(REF_CODE_KEY);
  } catch {
    /* private browsing */
  }
}

/**
 * Reads `?ref=CODE`, parks it, and tells the API a share link was opened.
 *
 * The code is stripped from the address bar afterwards: leaving it there means every screenshot
 * and every copied link the referee shares onward re-attributes to the original referrer.
 */
function captureInboundCode(): void {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('ref');
  if (!raw) return;

  const code = raw.trim().toUpperCase().slice(0, 32);
  if (!/^[A-Z0-9-]+$/.test(code)) return;

  try {
    localStorage.setItem(REF_CODE_KEY, code);
  } catch {
    /* private browsing — the discount is simply not carried across the visit */
  }

  void apiFetch('/api/referral/visit', { method: 'POST', json: { code } });

  params.delete('ref');
  const qs = params.toString();
  window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .ref-code-box { display: flex; flex-wrap: wrap; align-items: center; gap: 0.8rem; margin-top: 1.4rem; }
    .ref-code { font-family: var(--font-serif); font-size: 1.7rem; letter-spacing: 0.12em; color: var(--accent-roast);
      background: var(--bg-card); border: 1px dashed var(--accent-terracotta); border-radius: var(--radius-lg);
      padding: 0.6rem 1.2rem; }
    .ref-actions { display: flex; flex-wrap: wrap; gap: 0.6rem; }

    .ref-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-top: 1.6rem; }
    .ref-tile { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
      padding: 1.1rem 1.2rem; display: flex; flex-direction: column; gap: 0.25rem; }
    .ref-tile .tile-label { font-size: 0.66rem; letter-spacing: 0.13em; color: var(--text-light); font-weight: 600; text-transform: uppercase; }
    .ref-tile .tile-value { font-family: var(--font-serif); font-size: 1.8rem; color: var(--accent-roast); line-height: 1.1; }

    .ref-list { list-style: none; padding: 0; margin-top: 1.6rem; }
    .ref-list li { display: flex; justify-content: space-between; gap: 1rem; padding: 0.75rem 0;
      border-bottom: 1px solid var(--border-subtle); font-size: 0.9rem; }
    .ref-list .ref-meta { font-size: 0.8rem; color: var(--text-muted); }

    .ref-empty { color: var(--text-muted); margin-top: 1.2rem; }
    .ref-copied { font-size: 0.82rem; color: var(--accent-terracotta); }
  `;
  document.head.appendChild(style);
}

function renderSignedOut(host: HTMLElement, terms: Record<string, any> | null): void {
  host.innerHTML = `
    <div class="section-header">
      <span class="section-label">REFER A FRIEND</span>
      <h2 class="section-title">Give ${terms ? esc(inr(Number(terms.referee_discount_cents))) : 'a discount'}, get points</h2>
      <p class="section-subtitle">
        Share your link. Your friend gets ${terms ? esc(inr(Number(terms.referee_discount_cents))) : 'money'} off their first order,
        and you earn ${terms ? esc(Number(terms.referrer_points).toLocaleString('en-IN')) : ''} points once it's delivered.
      </p>
    </div>
    ${signInPrompt('Sign in to get your referral link and track who has ordered with it.')}
  `;
}

function renderDashboard(host: HTMLElement, d: Dashboard): void {
  host.innerHTML = `
    <div class="section-header">
      <span class="section-label">REFER A FRIEND</span>
      <h2 class="section-title">Refer a friend</h2>
      <p class="section-subtitle">
        They get ${esc(inr(d.referee_discount_cents))} off their first order. You earn
        ${esc(d.referrer_points.toLocaleString('en-IN'))} points once it's delivered.
      </p>
    </div>

    <div class="ref-code-box">
      <span class="ref-code">${esc(d.code)}</span>
      <div class="ref-actions">
        <button class="btn-primary" id="ref-copy">Copy link</button>
        <a class="btn-secondary" id="ref-whatsapp" href="${esc(d.share.whatsapp_url)}" target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
      </div>
      <span class="ref-copied" id="ref-copied" hidden>Link copied</span>
    </div>

    <div class="ref-grid">
      <div class="ref-tile"><span class="tile-label">Link opened</span><span class="tile-value">${esc(d.stats.invited)}</span></div>
      <div class="ref-tile"><span class="tile-label">Signed up</span><span class="tile-value">${esc(d.stats.signed_up)}</span></div>
      <div class="ref-tile"><span class="tile-label">Ordered</span><span class="tile-value">${esc(d.stats.purchased)}</span></div>
      <div class="ref-tile"><span class="tile-label">Points earned</span><span class="tile-value">${esc(d.stats.points_earned.toLocaleString('en-IN'))}</span></div>
      <div class="ref-tile"><span class="tile-label">Pending</span><span class="tile-value">${esc(d.stats.points_pending.toLocaleString('en-IN'))}</span></div>
    </div>

    ${d.recent.length ? `
      <ul class="ref-list">
        ${d.recent.map((r) => `
          <li>
            <span>${esc(r.referee_masked)}<br /><span class="ref-meta">${esc(shortDate(r.created_at))}</span></span>
            <span>${esc(STATUS_COPY[r.status] || r.status)}${r.points ? ` · ${esc(r.points.toLocaleString('en-IN'))} pts` : ''}</span>
          </li>
        `).join('')}
      </ul>
    ` : '<p class="ref-empty">No one has used your link yet.</p>'}
  `;

  host.querySelector<HTMLButtonElement>('#ref-copy')?.addEventListener('click', async () => {
    const note = host.querySelector<HTMLElement>('#ref-copied');
    try {
      // navigator.share is the better path on the phones most of these links are sent from;
      // clipboard is the desktop fallback. Neither is guaranteed, hence the try/catch.
      if (navigator.share) {
        await navigator.share({ text: d.share.message, url: d.share.url });
        return;
      }
      await navigator.clipboard.writeText(d.share.url);
      if (note) {
        note.hidden = false;
        setTimeout(() => { note.hidden = true; }, 2500);
      }
    } catch {
      window.prompt('Copy your referral link', d.share.url);
    }
  });
}

export function initReferral(app: any): void {
  void app;
  injectStyles();
  captureInboundCode();

  const section = mountFeatureSection(SECTION);
  registerNavPill(SECTION, 'Refer');

  void (async () => {
    if (!isSignedIn()) {
      const terms = await apiFetch<{ terms?: Record<string, any> }>('/api/referral/terms');
      renderSignedOut(section, terms.success ? terms.terms || null : null);
      return;
    }

    const res = await apiFetch<{ dashboard?: Dashboard }>('/api/referral/me');
    if (!res.success || !res.dashboard) {
      const terms = await apiFetch<{ terms?: Record<string, any> }>('/api/referral/terms');
      renderSignedOut(section, terms.success ? terms.terms || null : null);
      return;
    }
    renderDashboard(section, res.dashboard);
  })();
}
