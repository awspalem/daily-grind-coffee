/**
 * Subscriptions feature UI. Owned by one agent — see docs/roadmap-gaps.md.
 * Build all DOM through the helpers in ./shared.ts; do not edit main.ts or index.html.
 *
 * Two sections: the plan tier grid (public) and the subscription manager (signed-in), which is
 * where pause / skip / swap / cancel live. Both are appended to <main> by mountFeatureSection.
 */
import { apiFetch, esc, isSignedIn, mountFeatureSection, registerNavPill } from './shared';
const PLANS_SECTION = 'subscription-plans';
const MANAGER_SECTION = 'subscription-manager';
const GRINDS = [
    'WHOLE_BEAN', 'ESPRESSO', 'POUR_OVER', 'AEROPRESS', 'DRIP', 'FRENCH_PRESS', 'COLD_BREW',
];
const FREQUENCY_LABELS = {
    '1_WEEK': 'Every week',
    '2_WEEKS': 'Every 2 weeks',
    '4_WEEKS': 'Every 4 weeks',
};
const PERK_LABELS = {
    CONSULT_15MIN: '15-minute barista consultation',
    TOUR_SEAT: 'Roastery tour seat',
    CUPPING_SEAT: 'Cupping table seat',
    ESTATE_VISIT: 'Estate visit place',
    FREE_SHIPPING: 'Free shipping',
    EARLY_ACCESS: 'Early access to drops',
};
const STATUS_COPY = {
    ACTIVE: { label: 'Active', tone: 'ok' },
    PREPAID: { label: 'Prepaid term', tone: 'ok' },
    PAUSED: { label: 'Paused', tone: 'warn' },
    PAST_DUE: { label: 'Payment failed', tone: 'bad' },
    PENDING_PAYMENT: { label: 'Awaiting payment', tone: 'warn' },
    CANCELLED: { label: 'Cancelled', tone: 'muted' },
};
/** The storefront's shared formatCents is hardcoded to USD; plans are priced in paise. */
function inr(cents) {
    return '₹' + Math.round((cents || 0) / 100).toLocaleString('en-IN');
}
function shortDate(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? '—'
        : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function humanise(value) {
    return String(value || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (ch) => ch.toUpperCase());
}
let stylesInjected = false;
function injectStyles() {
    if (stylesInjected)
        return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
    /*
     * Five tiers never divide evenly into an auto-fit track count, so a grid always stranded the
     * last card alone against a wall of empty space. Flex-wrap with a centred last row keeps the
     * leftovers looking deliberate; the max-width stops that row's cards ballooning to fill it.
     */
    .plan-grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 1.2rem; margin-top: 1.6rem; }
    .plan-grid > * { flex: 1 1 clamp(240px, 30%, 380px); max-width: 33%; }
    @media (max-width: 900px) { .plan-grid > * { max-width: 100%; } }
    .plan-card { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
      padding: 1.6rem 1.4rem; display: flex; flex-direction: column; gap: 0.9rem; box-shadow: var(--shadow-sm); position: relative; }
    .plan-card.is-featured { border-color: var(--accent-terracotta); box-shadow: var(--shadow-warm); }
    .plan-badge { position: absolute; top: -0.65rem; left: 1.4rem; background: var(--accent-terracotta); color: var(--text-inverse);
      font-size: 0.65rem; letter-spacing: 0.09em; font-weight: 600; padding: 0.3rem 0.7rem; border-radius: var(--radius-pill); }
    .plan-tier { font-size: 0.68rem; letter-spacing: 0.14em; color: var(--text-light); font-weight: 600; }
    .plan-name { font-family: var(--font-serif); font-size: 1.5rem; line-height: 1.15; }
    .plan-tagline { color: var(--text-muted); font-size: 0.92rem; }
    .plan-price { font-family: var(--font-serif); font-size: 2rem; color: var(--accent-roast); }
    .plan-price span { font-family: var(--font-sans); font-size: 0.82rem; color: var(--text-muted); }
    .plan-perks { list-style: none; display: flex; flex-direction: column; gap: 0.45rem; font-size: 0.9rem; color: var(--text-main); }
    .plan-perks li::before { content: '·'; color: var(--accent-terracotta); font-weight: 700; margin-right: 0.5rem; }
    .plan-card .btn-primary { margin-top: auto; }

    .sub-card { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
      padding: 1.4rem; margin-bottom: 1.1rem; box-shadow: var(--shadow-sm); }
    .sub-card-top { display: flex; flex-wrap: wrap; gap: 0.8rem; align-items: baseline; justify-content: space-between; }
    .sub-title { font-family: var(--font-serif); font-size: 1.25rem; }
    .sub-meta { color: var(--text-muted); font-size: 0.88rem; margin-top: 0.25rem; }
    .sub-pill { font-size: 0.68rem; letter-spacing: 0.08em; font-weight: 600; padding: 0.28rem 0.7rem; border-radius: var(--radius-pill);
      text-transform: uppercase; }
    .sub-pill.ok { background: var(--accent-sage); color: var(--accent-emerald); }
    .sub-pill.warn { background: var(--accent-gold-light); color: var(--accent-gold); }
    .sub-pill.bad { background: #fbe6e0; color: var(--accent-terracotta-hover); }
    .sub-pill.muted { background: var(--bg-secondary); color: var(--text-muted); }
    .sub-shipments { list-style: none; margin: 1rem 0; display: flex; flex-direction: column; gap: 0.4rem;
      font-size: 0.9rem; color: var(--text-muted); }
    .sub-shipments strong { color: var(--text-main); }
    .sub-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.9rem; }
    .sub-btn { font-family: inherit; font-size: 0.83rem; padding: 0.5rem 0.95rem; border-radius: var(--radius-pill);
      border: 1px solid var(--border-subtle); background: var(--bg-secondary); color: var(--text-main); cursor: pointer;
      transition: var(--transition-smooth); }
    .sub-btn:hover { border-color: var(--accent-terracotta); color: var(--accent-terracotta); }
    .sub-btn.danger:hover { border-color: var(--accent-terracotta-hover); color: var(--accent-terracotta-hover); }
    .sub-dunning { background: #fbe6e0; border: 1px solid #f0c4b6; border-radius: var(--radius-md); padding: 0.9rem 1rem;
      margin-top: 0.9rem; font-size: 0.9rem; color: var(--accent-terracotta-hover); }
    .sub-edit { display: none; gap: 0.7rem; flex-wrap: wrap; margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed var(--border-subtle); }
    .sub-edit.open { display: flex; }
    .sub-edit label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.76rem; color: var(--text-muted); }
    .sub-edit select, .sub-edit input { font-family: inherit; font-size: 0.88rem; padding: 0.45rem 0.6rem;
      border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--bg-primary); color: var(--text-main); }
    .sub-perks { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1rem; }
    .sub-perk { background: var(--accent-sage); color: var(--accent-emerald); font-size: 0.78rem; font-weight: 500;
      padding: 0.35rem 0.75rem; border-radius: var(--radius-pill); }
    .sub-note { color: var(--text-muted); font-size: 0.9rem; }
  `;
    document.head.appendChild(style);
}
// ==================== Plan catalog ====================
async function renderPlans() {
    const section = mountFeatureSection(PLANS_SECTION);
    const res = await apiFetch('/api/subscriptions/plans');
    const plans = res.success ? res.plans || [] : [];
    if (!plans.length)
        return;
    registerNavPill(PLANS_SECTION, 'Club');
    section.innerHTML = `
    <div class="section-header">
      <span class="section-label">THE DAILY ROAST CLUB</span>
      <h2 class="section-title">Choose how deep you want to go</h2>
      <p class="section-subtitle">
        Every tier ships freshly roasted coffee on your schedule. The annual terms are prepaid,
        cheaper per bag, and carry the perks you can only get by committing to a year — including
        time on video with one of our baristas.
      </p>
    </div>
    <div class="plan-grid">
      ${plans.map((plan) => `
        <article class="plan-card${plan.badge ? ' is-featured' : ''}">
          ${plan.badge ? `<span class="plan-badge">${esc(plan.badge)}</span>` : ''}
          <span class="plan-tier">${esc(plan.tier)} · ${esc(plan.term === 'ANNUAL' ? 'Annual, prepaid' : 'Monthly')}</span>
          <h3 class="plan-name">${esc(plan.name)}</h3>
          <p class="plan-tagline">${esc(plan.tagline || '')}</p>
          <p class="plan-price">${esc(inr(plan.price_cents))}
            <span>${esc(plan.term === 'ANNUAL' ? 'for the year, paid once' : 'per delivery, at ' + plan.discount_percent + '% off')}</span>
          </p>
          <ul class="plan-perks">
            ${(plan.perks || []).map((perk) => `<li>${esc(perk)}</li>`).join('')}
          </ul>
          <button class="btn-primary" data-plan-slug="${esc(plan.slug)}">
            ${esc(isSignedIn() ? 'Join ' + plan.name : 'Sign in to join')}
          </button>
        </article>
      `).join('')}
    </div>
  `;
    section.querySelectorAll('[data-plan-slug]').forEach((btn) => {
        btn.addEventListener('click', () => startPlanCheckout(btn.dataset.planSlug || '', btn));
    });
}
/**
 * Plan purchase mints its own Stripe session from routes/subscriptions.ts. The coffee to start
 * with is picked from whatever the catalog is showing, so the customer never has to configure a
 * subscription before they have committed to one.
 */
async function startPlanCheckout(slug, btn) {
    if (!isSignedIn()) {
        alert('Please sign in to your account first — your plan and its perks are tied to it.');
        document.getElementById('account-section')?.scrollIntoView({ behavior: 'smooth' });
        return;
    }
    const variantId = await pickStartingVariant();
    if (!variantId) {
        alert('We could not load the coffee list just now. Please try again in a moment.');
        return;
    }
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Opening checkout…';
    const res = await apiFetch('/api/subscriptions/checkout', {
        method: 'POST',
        json: { plan_slug: slug, variant_id: variantId },
    });
    if (res.success && res.checkout_url) {
        window.location.href = res.checkout_url;
        return;
    }
    btn.disabled = false;
    btn.textContent = original;
    alert(res.error || 'Could not start checkout. Please try again.');
}
/**
 * The coffee the plan starts with. `/api/products` returns products without variants, so the
 * featured product is fetched by slug to get one. It is only a starting point — the manager
 * below lets the customer swap it before the first roast.
 */
let cachedVariantId = null;
async function pickStartingVariant() {
    if (cachedVariantId)
        return cachedVariantId;
    const list = await apiFetch('/api/products');
    const first = (list.success ? list.products || [] : [])[0];
    if (!first?.slug)
        return null;
    const detail = await apiFetch(`/api/products/${encodeURIComponent(first.slug)}`);
    const variant = detail.success ? (detail.product?.variants || [])[0] : null;
    cachedVariantId = variant?.id || null;
    return cachedVariantId;
}
// ==================== Subscription manager ====================
async function renderManager() {
    if (!isSignedIn())
        return;
    const section = mountFeatureSection(MANAGER_SECTION);
    const [subsRes, perksRes] = await Promise.all([
        apiFetch('/api/subscriptions/mine'),
        apiFetch('/api/subscriptions/perks'),
    ]);
    const subs = subsRes.success ? subsRes.subscriptions || [] : [];
    if (!subs.length) {
        section.innerHTML = '';
        return;
    }
    // Deliberately no second nav entry: the 'Club' pill registered above already carries the
    // reader into this part of the page, and the header is shared with six other links.
    section.innerHTML = `
    <div class="section-header">
      <span class="section-label">YOUR SUBSCRIPTIONS</span>
      <h2 class="section-title">Everything, in your hands</h2>
      <p class="section-subtitle">Pause, skip a delivery, change your grind or swap the coffee — all of it takes effect before the next roast.</p>
    </div>
    ${renderPerks(perksRes.success ? perksRes.perks || [] : [])}
    ${subs.map(renderSubscriptionCard).join('')}
  `;
    wireManager(section);
}
function renderPerks(perks) {
    if (!perks.length)
        return '';
    return `
    <div class="sub-perks">
      ${perks.map((perk) => {
        const label = PERK_LABELS[perk.entitlement_code] || humanise(perk.entitlement_code);
        const count = perk.unlimited ? 'Included' : `${perk.remaining_units} left`;
        const expiry = perk.expires_at ? ` · until ${shortDate(perk.expires_at)}` : '';
        return `<span class="sub-perk">${esc(label)} — ${esc(count)}${esc(expiry)}</span>`;
    }).join('')}
    </div>
  `;
}
function renderSubscriptionCard(sub) {
    const status = STATUS_COPY[sub.status] || { label: humanise(sub.status), tone: 'muted' };
    const upcoming = sub.upcoming || [];
    const isLive = sub.status !== 'CANCELLED';
    return `
    <article class="sub-card" data-sub-id="${esc(sub.id)}">
      <div class="sub-card-top">
        <div>
          <h3 class="sub-title">${esc(sub.product_name)}</h3>
          <p class="sub-meta">
            ${esc(sub.plan_name ? sub.plan_name + ' · ' : '')}${esc(FREQUENCY_LABELS[sub.frequency] || sub.frequency)}
            · ${esc(humanise(sub.grind_type))} · ${esc(sub.quantity)} bag${sub.quantity > 1 ? 's' : ''}
            · ${esc(sub.discount_percent)}% off
          </p>
        </div>
        <span class="sub-pill ${esc(status.tone)}">${esc(status.label)}</span>
      </div>

      ${upcoming.length ? `
        <ul class="sub-shipments">
          ${upcoming.map((s) => `
            <li>
              <strong>${esc(shortDate(s.scheduled_for))}</strong> —
              ${esc(s.will_charge ? inr(s.estimated_total_cents) + ' will be charged' : 'nothing to pay, covered by your prepaid term')}
              ${s.on_hold ? ' <em>(on hold while paused)</em>' : ''}
            </li>
          `).join('')}
        </ul>
      ` : '<p class="sub-note">No further deliveries scheduled.</p>'}

      ${sub.status === 'PAST_DUE' ? `
        <div class="sub-dunning">
          We could not take payment for your last delivery, so nothing has shipped.
          Update your card and we will pick straight back up where we left off.
          <div class="sub-actions">
            <button class="sub-btn" data-action="fix-payment">Update payment method</button>
          </div>
        </div>
      ` : ''}

      ${isLive ? `
        <div class="sub-actions">
          ${sub.status === 'PAUSED'
        ? '<button class="sub-btn" data-action="resume">Resume</button>'
        : '<button class="sub-btn" data-action="pause">Pause</button>'}
          <button class="sub-btn" data-action="skip">Skip next delivery</button>
          <button class="sub-btn" data-action="edit">Change grind, size or date</button>
          <button class="sub-btn danger" data-action="cancel">Cancel</button>
        </div>

        <div class="sub-edit">
          <label>Grind
            <select data-field="grind_type">
              ${GRINDS.map((g) => `<option value="${esc(g)}"${g === sub.grind_type ? ' selected' : ''}>${esc(humanise(g))}</option>`).join('')}
            </select>
          </label>
          <label>Frequency
            <select data-field="frequency">
              ${Object.entries(FREQUENCY_LABELS).map(([value, label]) => `<option value="${esc(value)}"${value === sub.frequency ? ' selected' : ''}>${esc(label)}</option>`).join('')}
            </select>
          </label>
          <label>Bags per delivery
            <input type="number" min="1" max="10" value="${esc(sub.quantity)}" data-field="quantity">
          </label>
          <label>Next delivery
            <input type="date" value="${esc(String(sub.next_renewal_date).slice(0, 10))}" data-field="next_renewal_date">
          </label>
          <label>Swap the coffee
            <select data-swap>
              <option value="">Keep ${esc(sub.product_name)}</option>
            </select>
          </label>
          <label>&nbsp;
            <button class="sub-btn" data-action="save">Save changes</button>
          </label>
        </div>
      ` : ''}
    </article>
  `;
}
function wireManager(section) {
    section.querySelectorAll('.sub-card').forEach((card) => {
        const subId = card.dataset.subId || '';
        card.querySelectorAll('[data-action]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const action = btn.dataset.action;
                if (action === 'edit') {
                    card.querySelector('.sub-edit')?.classList.toggle('open');
                    return;
                }
                if (action === 'save') {
                    const payload = {};
                    card.querySelectorAll('[data-field]').forEach((field) => {
                        const key = field.dataset.field;
                        payload[key] = key === 'quantity'
                            ? Number(field.value)
                            : key === 'next_renewal_date'
                                // The date input gives a bare day; the API wants an instant, and midnight local
                                // would land in the past for anyone east of UTC.
                                ? new Date(field.value + 'T12:00:00').toISOString()
                                : field.value;
                    });
                    await act(btn, `/api/subscriptions/${subId}`, 'PATCH', payload);
                    return;
                }
                if (action === 'cancel') {
                    await runCancelFlow(btn, subId);
                    return;
                }
                if (action === 'fix-payment') {
                    await runPaymentFix(btn, subId);
                    return;
                }
                await act(btn, `/api/subscriptions/${subId}/${action}`, 'POST');
            });
        });
    });
}
/** Runs one mutation, reports the outcome, and re-renders so the card reflects the new state. */
async function act(btn, path, method, json) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Working…';
    const res = await apiFetch(path, { method, json: json ?? {} });
    btn.disabled = false;
    btn.textContent = original;
    if (!res.success) {
        alert(res.error || 'That did not work. Please try again.');
        return false;
    }
    if (res.message)
        alert(res.message);
    await renderManager();
    return true;
}
/**
 * Cancellation asks why first, then offers the alternative that fits the reason. Only if the
 * customer declines the offer does the cancel actually go through.
 */
async function runCancelFlow(btn, subId) {
    const reason = prompt('Before you go — what is prompting this?\n(e.g. price, too much coffee, moving house, taking a break)');
    if (reason === null)
        return;
    const offerRes = await apiFetch(`/api/subscriptions/${subId}/cancel-offer`, {
        method: 'POST',
        json: { reason },
    });
    const offer = offerRes.success ? offerRes.offer : null;
    if (offer && confirm(`${offer.headline}\n\n${offer.detail}\n\nOK to take this instead, or Cancel to end the subscription.`)) {
        await act(btn, `/api/subscriptions/${subId}/save-offer`, 'POST', { kind: offer.kind });
        return;
    }
    if (!confirm('Cancel this subscription for good?'))
        return;
    await act(btn, `/api/subscriptions/${subId}/cancel`, 'POST', { reason });
}
async function runPaymentFix(btn, subId) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Opening…';
    const res = await apiFetch(`/api/subscriptions/${subId}/payment-method/session`, { method: 'POST', json: {} });
    btn.disabled = false;
    btn.textContent = original;
    if (!res.success || !res.checkout_url) {
        alert(res.error || 'Could not open the payment page.');
        return;
    }
    // Remembered so the confirm step can run when Stripe sends the customer back — the return URL
    // carries the subscription id, not the session id.
    sessionStorage.setItem('tdg_pm_fix', JSON.stringify({ subId, sessionId: res.session_id }));
    window.location.href = res.checkout_url;
}
/** Completes a payment-method update after the redirect back from Stripe. */
async function completePendingPaymentFix() {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('subscription_payment_fixed'))
        return;
    const raw = sessionStorage.getItem('tdg_pm_fix');
    const sessionId = params.get('session_id') || (raw ? JSON.parse(raw).sessionId : null);
    const subId = params.get('subscription_payment_fixed');
    sessionStorage.removeItem('tdg_pm_fix');
    if (!sessionId || !subId)
        return;
    const res = await apiFetch(`/api/subscriptions/${subId}/payment-method/confirm`, { method: 'POST', json: { session_id: sessionId } });
    if (res.success)
        alert(res.message || 'Payment method updated.');
}
export function initSubscriptions(app) {
    void app;
    injectStyles();
    void renderPlans();
    void completePendingPaymentFix().then(() => renderManager());
}
