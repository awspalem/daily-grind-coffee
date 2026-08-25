/**
 * Loyalty feature UI — balance, tier, statement, and the redeem-at-checkout intent.
 * Build all DOM through the helpers in ./shared.ts; do not edit index.html.
 *
 * Redemption deliberately does not compute a discount here. The shopper sets an *intent*
 * ("spend my points on the next order"); main.ts asks the API for a preview against the real
 * basket at checkout time, and checkout.ts re-derives the figure server-side before anything is
 * taken off. A number rendered in this file is never allowed to be the number that is charged.
 */
import { apiFetch, esc, isSignedIn, mountFeatureSection, registerNavPill } from './shared';
const SECTION = 'loyalty-programme';
const REDEEM_INTENT_KEY = 'tdg_loyalty_redeem_intent';
const PAGE_SIZE = 20;
const TIER_COPY = {
    BRONZE: { label: 'Bronze', blurb: 'Every order earns.' },
    SILVER: { label: 'Silver', blurb: 'Faster earning and free shipping.' },
    GOLD: { label: 'Gold', blurb: 'Our best rate, plus early access to drops.' },
};
const REASON_COPY = {
    SIGNUP_BONUS: 'Welcome bonus',
    ORDER_DELIVERED: 'Order delivered',
    REVIEW_BONUS: 'Thanks for the review',
    SUBSCRIPTION_STREAK: 'Subscription streak',
    REFERRAL_REWARD: 'Friend referred',
    ORDER_REDEEM: 'Spent on an order',
    REDEEM_RECLAIMED: 'Returned — checkout not completed',
    REFUND_CLAWBACK: 'Reversed after refund',
    REFUND_RESTORE: 'Restored after refund',
    POINTS_EXPIRED: 'Points lapsed',
    ADMIN_ADJUST: 'Adjusted by our team',
};
/** The storefront's shared formatCents is hardcoded to USD; the programme is priced in paise. */
function inr(cents) {
    return '₹' + Math.round((cents || 0) / 100).toLocaleString('en-IN');
}
/**
 * Same, but keeps the paise when there are any.
 *
 * A single point is worth 50 paise. Rounding that to the nearest rupee prints either ₹1 or ₹0,
 * and multiplying it up to dodge the rounding prints ₹50 — which is what shipped, overstating
 * the value of a point to every visitor by a hundredfold. Sub-rupee amounts have to survive.
 */
export function inrPrecise(cents) {
    const rupees = (cents || 0) / 100;
    return '₹' + (Number.isInteger(rupees) ? rupees.toLocaleString('en-IN') : rupees.toFixed(2));
}
function shortDate(iso) {
    if (!iso)
        return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? '—'
        : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
/**
 * Whether the shopper has asked for points to be spent on their next order.
 * Read by main.ts at checkout; a stale `true` is harmless because the server refuses a
 * redemption the balance cannot cover.
 */
export function hasRedeemIntent() {
    try {
        return localStorage.getItem(REDEEM_INTENT_KEY) === '1';
    }
    catch {
        return false;
    }
}
function setRedeemIntent(on) {
    try {
        if (on)
            localStorage.setItem(REDEEM_INTENT_KEY, '1');
        else
            localStorage.removeItem(REDEEM_INTENT_KEY);
    }
    catch {
        /* private browsing — the toggle simply doesn't persist */
    }
}
/**
 * Points to send with a checkout of this size. Advisory: checkout.ts recomputes the cap and the
 * discount from the ledger, so a tampered value cannot buy anything.
 */
export async function redeemPointsForSubtotal(subtotalCents) {
    if (!isSignedIn() || !hasRedeemIntent())
        return 0;
    const res = await apiFetch('/api/loyalty/redeem/preview', { method: 'POST', json: { subtotal_cents: subtotalCents } });
    if (!res.success || !res.preview?.eligible)
        return 0;
    return Math.max(0, Math.floor(res.preview.max_points));
}
let stylesInjected = false;
function injectStyles() {
    if (stylesInjected)
        return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
    .loyalty-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-top: 1.4rem; }
    .loyalty-tile { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
      padding: 1.2rem 1.3rem; display: flex; flex-direction: column; gap: 0.3rem; }
    .loyalty-tile .tile-label { font-size: 0.68rem; letter-spacing: 0.13em; color: var(--text-light); font-weight: 600; text-transform: uppercase; }
    .loyalty-tile .tile-value { font-family: var(--font-serif); font-size: 1.9rem; color: var(--accent-roast); line-height: 1.1; }
    .loyalty-tile .tile-note { font-size: 0.82rem; color: var(--text-muted); }

    .loyalty-tier-bar { height: 8px; border-radius: var(--radius-pill); background: var(--border-subtle); overflow: hidden; margin-top: 0.6rem; }
    .loyalty-tier-bar span { display: block; height: 100%; background: var(--accent-terracotta); }

    .loyalty-perks { list-style: none; display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.8rem; padding: 0; }
    .loyalty-perks li { font-size: 0.78rem; padding: 0.25rem 0.7rem; border-radius: var(--radius-pill);
      background: var(--bg-subtle, rgba(0,0,0,0.04)); color: var(--text-muted); }

    .loyalty-warning { margin-top: 1rem; padding: 0.8rem 1rem; border-radius: var(--radius-md, 8px);
      border: 1px solid var(--accent-terracotta); color: var(--text-main); font-size: 0.9rem; }

    .loyalty-redeem { display: flex; align-items: center; gap: 0.7rem; margin-top: 1.2rem; font-size: 0.92rem; color: var(--text-main); }

    .loyalty-statement { list-style: none; padding: 0; margin-top: 1.4rem; display: flex; flex-direction: column; }
    .loyalty-statement li { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem;
      padding: 0.8rem 0; border-bottom: 1px solid var(--border-subtle); }
    .loyalty-statement .entry-reason { font-weight: 600; }
    .loyalty-statement .entry-meta { font-size: 0.8rem; color: var(--text-muted); }
    .loyalty-statement .entry-delta { font-family: var(--font-serif); font-size: 1.1rem; white-space: nowrap; }
    .loyalty-statement .entry-delta.is-credit { color: var(--accent-terracotta); }
    .loyalty-statement .entry-delta.is-debit { color: var(--text-muted); }

    .loyalty-empty { color: var(--text-muted); margin-top: 1.2rem; }
  `;
    document.head.appendChild(style);
}
function renderSignedOut(host, config) {
    // `point_value_cents` is already minor units (50 = fifty paise), unlike
    // `rupees_per_point_earned` below, which is whole rupees and does need scaling.
    const perPoint = config ? inrPrecise(Number(config.point_value_cents)) : null;
    host.innerHTML = `
    <h2 class="section-title">The Daily Roast Club</h2>
    <p class="section-subtitle">Earn points on every delivered order and take them off your next bag.</p>
    <div class="loyalty-grid">
      <div class="loyalty-tile">
        <span class="tile-label">Earning</span>
        <span class="tile-value">1 pt</span>
        <span class="tile-note">for every ${config ? esc(inr(Number(config.rupees_per_point_earned) * 100)) : '₹100'} spent</span>
      </div>
      <div class="loyalty-tile">
        <span class="tile-label">Each point is worth</span>
        <span class="tile-value">${perPoint ? esc(perPoint) : '—'}</span>
        <span class="tile-note">off a future order</span>
      </div>
      <div class="loyalty-tile">
        <span class="tile-label">Tiers</span>
        <span class="tile-value">3</span>
        <span class="tile-note">Bronze · Silver · Gold, by your last 12 months</span>
      </div>
    </div>
    <p class="loyalty-empty">Sign in to see your balance and statement.</p>
  `;
}
function renderSummary(host, summary) {
    const tier = summary.tier;
    const copy = TIER_COPY[tier.tier] || { label: tier.tier, blurb: '' };
    const spent = tier.trailing_spend_cents;
    const toNext = tier.cents_to_next_tier;
    const progress = tier.next_tier && spent + toNext > 0
        ? Math.min(100, Math.round((spent / (spent + toNext)) * 100))
        : 100;
    host.innerHTML = `
    <h2 class="section-title">Your points</h2>
    <p class="section-subtitle">${esc(copy.blurb)}</p>
    <div class="loyalty-grid">
      <div class="loyalty-tile">
        <span class="tile-label">Balance</span>
        <span class="tile-value">${esc(summary.balance.toLocaleString('en-IN'))}</span>
        <span class="tile-note">worth ${esc(inr(summary.balance * summary.point_value_cents))}</span>
      </div>
      <div class="loyalty-tile">
        <span class="tile-label">Tier</span>
        <span class="tile-value">${esc(copy.label)}</span>
        <span class="tile-note">${esc(tier.earn_multiplier)}× earning rate</span>
      </div>
      <div class="loyalty-tile">
        <span class="tile-label">Earned all time</span>
        <span class="tile-value">${esc(summary.lifetime_points.toLocaleString('en-IN'))}</span>
        <span class="tile-note">points</span>
      </div>
    </div>

    ${tier.next_tier ? `
      <div style="margin-top: 1.2rem;">
        <div class="entry-meta">${esc(inr(toNext))} more in the next 12 months to reach ${esc(TIER_COPY[tier.next_tier]?.label || tier.next_tier)}</div>
        <div class="loyalty-tier-bar"><span style="width: ${progress}%"></span></div>
      </div>
    ` : '<div class="entry-meta" style="margin-top: 1.2rem;">You are at our top tier.</div>'}

    ${tier.perks.length ? `<ul class="loyalty-perks">${tier.perks.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}

    ${summary.expiring_soon_points > 0 ? `
      <div class="loyalty-warning">
        ${esc(summary.expiring_soon_points.toLocaleString('en-IN'))} points lapse on ${esc(shortDate(summary.expiring_soon_at))}.
      </div>
    ` : ''}

    <label class="loyalty-redeem">
      <input type="checkbox" id="loyalty-redeem-toggle" ${hasRedeemIntent() ? 'checked' : ''} />
      Use my points on my next order — we'll apply the most your basket allows.
    </label>

    <h3 class="section-title" style="font-size: 1.2rem; margin-top: 2rem;">Statement</h3>
    <ul class="loyalty-statement" id="loyalty-statement"></ul>
    <button class="btn-secondary" id="loyalty-more" style="margin-top: 1rem; display: none;">Show more</button>
  `;
    host.querySelector('#loyalty-redeem-toggle')
        ?.addEventListener('change', (ev) => setRedeemIntent(ev.target.checked));
}
function entryHtml(entry) {
    const credit = entry.points_delta > 0;
    const label = REASON_COPY[entry.reason] || entry.reason.replace(/_/g, ' ').toLowerCase();
    return `
    <li>
      <span>
        <span class="entry-reason">${esc(label)}</span><br />
        <span class="entry-meta">${esc(shortDate(entry.created_at))}${entry.note ? ' · ' + esc(entry.note) : ''}</span>
      </span>
      <span class="entry-delta ${credit ? 'is-credit' : 'is-debit'}">${credit ? '+' : ''}${esc(entry.points_delta.toLocaleString('en-IN'))}</span>
    </li>
  `;
}
async function loadStatement(host, offset) {
    const list = host.querySelector('#loyalty-statement');
    const more = host.querySelector('#loyalty-more');
    if (!list)
        return;
    const res = await apiFetch(`/api/loyalty/statement?limit=${PAGE_SIZE}&offset=${offset}`);
    const entries = res.success ? res.entries || [] : [];
    if (offset === 0 && entries.length === 0) {
        list.innerHTML = '<li class="loyalty-empty">Nothing yet — your first delivered order starts the ledger.</li>';
        return;
    }
    list.insertAdjacentHTML('beforeend', entries.map(entryHtml).join(''));
    if (more) {
        // A short page means the ledger is exhausted; only offer "show more" when a full page came back.
        if (entries.length < PAGE_SIZE) {
            more.style.display = 'none';
        }
        else {
            more.style.display = '';
            more.onclick = () => {
                more.disabled = true;
                loadStatement(host, offset + PAGE_SIZE).finally(() => { more.disabled = false; });
            };
        }
    }
}
export function initLoyalty(app) {
    void app;
    injectStyles();
    const section = mountFeatureSection(SECTION);
    registerNavPill(SECTION, 'Points');
    void (async () => {
        if (!isSignedIn()) {
            const cfg = await apiFetch('/api/loyalty/config');
            renderSignedOut(section, cfg.success ? cfg.config || null : null);
            return;
        }
        const res = await apiFetch('/api/loyalty/summary');
        if (!res.success || !res.summary) {
            // An expired session is the common case here — fall back to the public explainer rather
            // than showing an error for something the shopper did nothing to cause.
            const cfg = await apiFetch('/api/loyalty/config');
            renderSignedOut(section, cfg.success ? cfg.config || null : null);
            return;
        }
        renderSummary(section, res.summary);
        await loadStatement(section, 0);
    })();
}
