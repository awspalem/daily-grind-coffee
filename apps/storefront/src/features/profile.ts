/**
 * Profile feature UI. Owned by one agent — see docs/roadmap-gaps.md.
 * Build all DOM through the helpers in ./shared.ts; do not edit main.ts or index.html.
 *
 * Renders "Your Coffee Profile": the derived taste graph, personalised picks, order history with
 * one-click reorder, saved preferences and the address book. Everything customer-supplied goes
 * through esc() before it reaches innerHTML.
 */
import {
  apiFetch,
  esc,
  formatCents,
  isSignedIn,
  mountFeatureSection,
  registerNavPill,
  signInPrompt,
  toast,
} from './shared';

const SECTION_ID = 'your-profile';
const PAGE_SIZE = 5;

const GRIND_OPTIONS = [
  'WHOLE_BEAN', 'POUR_OVER', 'SOUTH_INDIAN_FILTER', 'ESPRESSO', 'AEROPRESS', 'DRIP', 'FRENCH_PRESS', 'COLD_BREW',
];
const WEIGHT_OPTIONS = [100, 250, 500, 1000];
const BREW_METHODS = ['south-indian-filter', 'v60', 'aeropress', 'french-press', 'espresso', 'cold-brew'];

const SEGMENT_COPY: Record<string, string> = {
  NEW: 'Welcome to the roastery',
  ACTIVE: 'A regular at the counter',
  LOYAL: 'One of our regulars',
  VIP: 'Roastery inner circle',
  AT_RISK: "It's been a while — your beans must be running low",
  LAPSED: 'We have been keeping your seat warm',
};

interface ProfileState {
  profile: any | null;
  preferences: any | null;
  addresses: any[];
  recommendations: any[];
  daysUntilReorder: number | null;
  currency: string;
  orders: any[];
  ordersTotal: number;
  offset: number;
  editingAddressId: string | null;
  loaded: boolean;
}

const state: ProfileState = {
  profile: null,
  preferences: null,
  addresses: [],
  recommendations: [],
  daysUntilReorder: null,
  currency: 'usd',
  orders: [],
  ordersTotal: 0,
  offset: 0,
  editingAddressId: null,
  loaded: false,
};

let storefront: any = null;
let section: HTMLElement | null = null;

// ---------------------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------------------

function titleise(value: unknown): string {
  return String(value ?? '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * One currency for the whole section. `orders.total_cents` carries no currency of its own, so
 * the API reports the customer's most recent order currency and every figure on this screen —
 * stat tiles, order rows, order detail — is labelled with it. Mixing a per-row currency with a
 * defaulted one would put ₹ and $ side by side on the same screen.
 */
function money(cents: number): string {
  return formatCents(Number(cents || 0), state.currency.toUpperCase());
}

function weightLabel(grams: number): string {
  return grams >= 1000 ? `${grams / 1000}kg` : `${grams}g`;
}

function panel(inner: string, extra = ''): string {
  return `<div style="background:#fff; border:1px solid var(--border-subtle); border-radius: var(--radius-lg); padding:1.5rem; ${extra}">${inner}</div>`;
}

// ---------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------

function renderSignedOut(): string {
  return `
    <div class="section-header" style="text-align:center; margin-bottom:1.5rem;">
      <span class="section-label">Your Account</span>
      <h2 class="section-title">Your Coffee Profile</h2>
      <p class="section-subtitle">Sign in and we'll remember your roast, your grind and your usual bag.</p>
    </div>
    ${signInPrompt(
      'Sign in with a one-time code and your taste profile, order history and saved addresses appear here.'
    )}
  `;
}

function renderStats(p: any): string {
  const tiles: { label: string; value: string }[] = [
    { label: 'Orders', value: String(p.total_orders) },
    { label: 'Lifetime Value', value: money(p.lifetime_value_cents) },
    { label: 'Average Order', value: money(p.aov_cents) },
    {
      label: 'Reorder Rhythm',
      value: p.reorder_cadence_days ? `~${Math.round(p.reorder_cadence_days)} days` : 'Not enough orders yet',
    },
    {
      label: 'Last Order',
      value: p.days_since_last_order === null ? '—' : `${p.days_since_last_order} days ago`,
    },
  ];

  return `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:1rem;">
    ${tiles
      .map(
        (t) => `<div style="background:var(--bg-secondary); border-radius:var(--radius-md); padding:1rem 1.1rem;">
          <div style="font-size:0.75rem; letter-spacing:0.08em; text-transform:uppercase; color:var(--text-muted); font-weight:600;">${esc(t.label)}</div>
          <div style="font-family:var(--font-serif); font-size:1.5rem; color:var(--text-main); margin-top:0.3rem;">${esc(t.value)}</div>
        </div>`
      )
      .join('')}
  </div>`;
}

function renderDistribution(title: string, rows: any[], transform: (key: string) => string): string {
  if (!rows || rows.length === 0) {
    return `<div><h4 style="font-family:var(--font-serif); font-size:1.05rem; margin-bottom:0.6rem;">${esc(title)}</h4>
      <p style="color:var(--text-muted); font-size:0.9rem; margin:0;">Nothing to plot yet — your first order starts this.</p></div>`;
  }

  return `<div>
    <h4 style="font-family:var(--font-serif); font-size:1.05rem; margin-bottom:0.6rem;">${esc(title)}</h4>
    ${rows
      .slice(0, 5)
      .map((row: any) => {
        const pct = Math.round(Number(row.share || 0) * 100);
        return `<div style="margin-bottom:0.5rem;">
          <div style="display:flex; justify-content:space-between; font-size:0.85rem; color:var(--text-muted); margin-bottom:0.2rem;">
            <span>${esc(transform(String(row.key)))}</span><span>${pct}%</span>
          </div>
          <div style="height:6px; background:var(--bg-secondary); border-radius:var(--radius-pill); overflow:hidden;">
            <div style="height:100%; width:${pct}%; background:var(--accent-terracotta);"></div>
          </div>
        </div>`;
      })
      .join('')}
  </div>`;
}

function renderTasteGraph(p: any): string {
  const usual: string[] = [];
  if (p.favourite_grind) usual.push(`Ground for ${titleise(p.favourite_grind)}`);
  if (p.typical_weight_grams) usual.push(`${weightLabel(p.typical_weight_grams)} bags`);
  if (p.top_roast_level) usual.push(`${titleise(p.top_roast_level)} roast`);
  if (p.avg_review_rating) usual.push(`You rate us ${p.avg_review_rating}/5 across ${p.review_count} review${p.review_count === 1 ? '' : 's'}`);

  return panel(`
    <h3 style="font-family:var(--font-serif); font-size:1.3rem; margin-bottom:1rem;">Your Taste Graph</h3>
    ${
      usual.length
        ? `<div style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:1.4rem;">
            ${usual.map((u) => `<span style="background:var(--accent-gold-light); color:var(--accent-roast); border-radius:var(--radius-pill); padding:0.35rem 0.9rem; font-size:0.85rem; font-weight:600;">${esc(u)}</span>`).join('')}
          </div>`
        : ''
    }
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:1.5rem;">
      ${renderDistribution('Roast levels', p.roast_distribution, titleise)}
      ${renderDistribution('Origins', p.origin_distribution, (k) => k)}
      ${renderDistribution('Processes', p.process_distribution, titleise)}
    </div>
  `, 'margin-top:1.5rem;');
}

function renderRecommendations(): string {
  if (state.recommendations.length === 0) return '';

  const due =
    state.daysUntilReorder !== null && state.daysUntilReorder <= 7
      ? `<p style="color:var(--accent-terracotta); font-weight:600; margin-bottom:1rem;">${
          state.daysUntilReorder <= 0
            ? "Going by your usual rhythm, you're due for a resupply."
            : `Going by your usual rhythm, you're about ${state.daysUntilReorder} day${state.daysUntilReorder === 1 ? '' : 's'} from running low.`
        }</p>`
      : '';

  return panel(`
    <h3 style="font-family:var(--font-serif); font-size:1.3rem; margin-bottom:0.6rem;">Picked For You</h3>
    ${due}
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:1rem;">
      ${state.recommendations
        .map(
          (r: any) => `<div style="border:1px solid var(--border-subtle); border-radius:var(--radius-md); overflow:hidden; display:flex; flex-direction:column;">
            <img src="${esc(r.image_url)}" alt="${esc(r.name)}" style="width:100%; height:130px; object-fit:cover;">
            <div style="padding:0.9rem; display:flex; flex-direction:column; gap:0.4rem; flex:1;">
              ${r.kind === 'YOUR_USUAL' ? '<span style="font-size:0.7rem; letter-spacing:0.1em; text-transform:uppercase; font-weight:700; color:var(--accent-terracotta);">Your Usual</span>' : ''}
              <div style="font-family:var(--font-serif); font-size:1.05rem; line-height:1.25;">${esc(r.name)}</div>
              <div style="font-size:0.82rem; color:var(--text-muted); flex:1;">${esc(r.reason)}</div>
              <button class="btn-secondary" data-profile-action="view-product" data-slug="${esc(r.slug)}" style="padding:0.5rem 1rem; font-size:0.85rem;">View this roast</button>
            </div>
          </div>`
        )
        .join('')}
    </div>
  `, 'margin-top:1.5rem;');
}

function renderOrders(): string {
  const rows =
    state.orders.length === 0
      ? '<p style="color:var(--text-muted); margin:0;">No orders yet. Your history will appear here after your first roast.</p>'
      : state.orders
          .map(
            (o: any) => `<div style="border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:1rem; margin-bottom:0.8rem;">
              <div style="display:flex; flex-wrap:wrap; gap:0.6rem; justify-content:space-between; align-items:center;">
                <div>
                  <div style="font-weight:600;">${esc(o.order_number)} · ${esc(titleise(o.status))}</div>
                  <div style="font-size:0.85rem; color:var(--text-muted);">${esc(String(o.created_at).slice(0, 10))} · ${esc(String(o.item_count))} item${Number(o.item_count) === 1 ? '' : 's'} · ${esc(money(o.total_cents))}</div>
                  ${o.summary ? `<div style="font-size:0.85rem; color:var(--text-muted); margin-top:0.2rem;">${esc(o.summary)}</div>` : ''}
                </div>
                <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                  <button class="btn-secondary" data-profile-action="order-detail" data-order="${esc(o.order_number)}" style="padding:0.45rem 1rem; font-size:0.85rem;">Details</button>
                  <button class="btn-primary" data-profile-action="reorder" data-order="${esc(o.order_number)}" style="padding:0.45rem 1rem; font-size:0.85rem;">Buy it again</button>
                </div>
              </div>
              <div data-profile-detail="${esc(o.order_number)}" style="display:none; margin-top:0.8rem; border-top:1px solid var(--border-subtle); padding-top:0.8rem;"></div>
            </div>`
          )
          .join('');

  const pager =
    state.ordersTotal > PAGE_SIZE
      ? `<div style="display:flex; gap:0.6rem; align-items:center; margin-top:0.5rem;">
          <button class="btn-secondary" data-profile-action="orders-prev" style="padding:0.45rem 1rem; font-size:0.85rem;" ${state.offset === 0 ? 'disabled' : ''}>Newer</button>
          <button class="btn-secondary" data-profile-action="orders-next" style="padding:0.45rem 1rem; font-size:0.85rem;" ${state.offset + PAGE_SIZE >= state.ordersTotal ? 'disabled' : ''}>Older</button>
          <span style="font-size:0.85rem; color:var(--text-muted);">${state.offset + 1}–${Math.min(state.offset + PAGE_SIZE, state.ordersTotal)} of ${state.ordersTotal}</span>
        </div>`
      : '';

  return panel(`
    <h3 style="font-family:var(--font-serif); font-size:1.3rem; margin-bottom:1rem;">Order History</h3>
    ${rows}
    ${pager}
  `, 'margin-top:1.5rem;');
}

function renderPreferences(): string {
  const prefs = state.preferences || { channels: [] };

  return panel(`
    <h3 style="font-family:var(--font-serif); font-size:1.3rem; margin-bottom:1rem;">Saved Preferences</h3>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:1rem;">
      <label style="display:block; font-size:0.85rem; color:var(--text-muted); font-weight:600;">Default grind
        <select id="profile-pref-grind" style="width:100%; margin-top:0.35rem; padding:0.6rem; border:1px solid var(--border-subtle); border-radius:var(--radius-sm); font-family:var(--font-sans);">
          <option value="">No preference</option>
          ${GRIND_OPTIONS.map((g) => `<option value="${esc(g)}" ${prefs.default_grind === g ? 'selected' : ''}>${esc(titleise(g))}</option>`).join('')}
        </select>
      </label>
      <label style="display:block; font-size:0.85rem; color:var(--text-muted); font-weight:600;">Default bag
        <select id="profile-pref-weight" style="width:100%; margin-top:0.35rem; padding:0.6rem; border:1px solid var(--border-subtle); border-radius:var(--radius-sm); font-family:var(--font-sans);">
          <option value="">No preference</option>
          ${WEIGHT_OPTIONS.map((w) => `<option value="${w}" ${Number(prefs.default_weight_grams) === w ? 'selected' : ''}>${weightLabel(w)}</option>`).join('')}
        </select>
      </label>
      <label style="display:block; font-size:0.85rem; color:var(--text-muted); font-weight:600;">Brew method
        <select id="profile-pref-brew" style="width:100%; margin-top:0.35rem; padding:0.6rem; border:1px solid var(--border-subtle); border-radius:var(--radius-sm); font-family:var(--font-sans);">
          <option value="">No preference</option>
          ${BREW_METHODS.map((m) => `<option value="${esc(m)}" ${prefs.brew_method === m ? 'selected' : ''}>${esc(titleise(m.replace(/-/g, ' ')))}</option>`).join('')}
        </select>
      </label>
    </div>

    <h4 style="font-family:var(--font-serif); font-size:1.05rem; margin:1.4rem 0 0.6rem;">Keep in touch</h4>
    <div style="display:flex; flex-direction:column; gap:0.5rem;">
      ${(prefs.channels || [])
        .map(
          (ch: any) => `<label style="display:flex; align-items:center; gap:0.6rem; font-size:0.92rem;">
            <input type="checkbox" data-profile-channel="${esc(ch.channel_id)}" ${ch.opted_in ? 'checked' : ''}>
            <span>${esc(ch.name)} <span style="color:var(--text-muted); font-size:0.82rem;">(${esc(titleise(ch.channel_type))}${ch.status === 'PLANNED' ? ' · coming soon' : ''})</span></span>
          </label>`
        )
        .join('')}
    </div>

    <div style="margin-top:1.2rem; display:flex; align-items:center; gap:0.8rem;">
      <button class="btn-primary" data-profile-action="save-prefs" style="padding:0.6rem 1.4rem; font-size:0.9rem;">Save preferences</button>
      <span id="profile-pref-status" style="font-size:0.85rem; color:var(--text-muted);"></span>
    </div>
  `, 'margin-top:1.5rem;');
}

function addressForm(addr: any): string {
  const field = (key: string, label: string, value: string, required = true) => `
    <label style="display:block; font-size:0.8rem; color:var(--text-muted); font-weight:600;">${esc(label)}
      <input data-profile-addr-field="${esc(key)}" value="${esc(value)}" ${required ? '' : 'placeholder="Optional"'}
        style="width:100%; margin-top:0.25rem; padding:0.55rem; border:1px solid var(--border-subtle); border-radius:var(--radius-sm); font-family:var(--font-sans);">
    </label>`;

  return `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:0.7rem; margin-top:0.6rem;">
      ${field('name', 'Name', addr.name)}
      ${field('line1', 'Address line 1', addr.line1)}
      ${field('line2', 'Address line 2', addr.line2 || '', false)}
      ${field('city', 'City', addr.city)}
      ${field('state', 'State', addr.state)}
      ${field('postal_code', 'PIN / Postal code', addr.postal_code)}
      ${field('country', 'Country', addr.country)}
    </div>
    <div style="display:flex; gap:0.5rem; margin-top:0.7rem;">
      <button class="btn-primary" data-profile-action="addr-save" data-id="${esc(addr.id)}" style="padding:0.45rem 1.1rem; font-size:0.85rem;">Save</button>
      <button class="btn-secondary" data-profile-action="addr-cancel" style="padding:0.45rem 1.1rem; font-size:0.85rem;">Cancel</button>
    </div>`;
}

function renderAddresses(): string {
  const rows =
    state.addresses.length === 0
      ? '<p style="color:var(--text-muted); margin:0;">No saved addresses yet — one is saved automatically when you check out.</p>'
      : state.addresses
          .map((a: any) => {
            const editing = state.editingAddressId === a.id;
            return `<div style="border:1px solid ${a.is_default ? 'var(--accent-terracotta)' : 'var(--border-subtle)'}; border-radius:var(--radius-md); padding:1rem; margin-bottom:0.8rem;">
              <div style="display:flex; flex-wrap:wrap; gap:0.6rem; justify-content:space-between; align-items:flex-start;">
                <div>
                  <div style="font-weight:600;">${esc(a.name)} ${a.is_default ? '<span style="font-size:0.7rem; letter-spacing:0.08em; text-transform:uppercase; color:var(--accent-terracotta); font-weight:700;">Default</span>' : ''}</div>
                  <div style="font-size:0.88rem; color:var(--text-muted);">
                    ${esc(a.line1)}${a.line2 ? `, ${esc(a.line2)}` : ''}<br>
                    ${esc(a.city)}, ${esc(a.state)} ${esc(a.postal_code)}, ${esc(a.country)}
                  </div>
                </div>
                <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                  ${a.is_default ? '' : `<button class="btn-secondary" data-profile-action="addr-default" data-id="${esc(a.id)}" style="padding:0.4rem 0.9rem; font-size:0.82rem;">Make default</button>`}
                  <button class="btn-secondary" data-profile-action="addr-edit" data-id="${esc(a.id)}" style="padding:0.4rem 0.9rem; font-size:0.82rem;">Edit</button>
                  <button class="btn-secondary" data-profile-action="addr-delete" data-id="${esc(a.id)}" style="padding:0.4rem 0.9rem; font-size:0.82rem;">Delete</button>
                </div>
              </div>
              ${editing ? addressForm(a) : ''}
            </div>`;
          })
          .join('');

  return panel(`
    <h3 style="font-family:var(--font-serif); font-size:1.3rem; margin-bottom:1rem;">Address Book</h3>
    ${rows}
  `, 'margin-top:1.5rem;');
}

function render(): void {
  if (!section) return;

  if (!isSignedIn()) {
    section.innerHTML = renderSignedOut();
    return;
  }

  if (!state.loaded) {
    section.innerHTML = `${panel('<p style="color:var(--text-muted); margin:0;">Brewing your profile…</p>')}`;
    return;
  }

  const p = state.profile;
  const segment = p?.segment || 'NEW';

  section.innerHTML = `
    <div class="section-header" style="text-align:center; margin-bottom:1.5rem;">
      <span class="section-label">Your Account</span>
      <h2 class="section-title">Your Coffee Profile</h2>
      <p class="section-subtitle">${esc(SEGMENT_COPY[segment] || SEGMENT_COPY.NEW)}</p>
    </div>
    ${panel(renderStats(p))}
    ${renderTasteGraph(p)}
    ${renderRecommendations()}
    ${renderOrders()}
    ${renderPreferences()}
    ${renderAddresses()}
  `;
}

// ---------------------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------------------

async function loadOrders(): Promise<void> {
  const res = await apiFetch<any>(`/api/profile/orders?limit=${PAGE_SIZE}&offset=${state.offset}`);
  if (!res.success) return;
  state.orders = res.orders || [];
  state.ordersTotal = Number(res.total || 0);
}

async function loadAll(): Promise<void> {
  if (!isSignedIn()) {
    state.loaded = false;
    render();
    return;
  }

  render(); // paint the loading panel before the network round-trips

  const [core, recs] = await Promise.all([
    apiFetch<any>('/api/profile'),
    apiFetch<any>('/api/profile/recommendations?limit=4'),
  ]);

  if (!core.success) {
    // A 401 here means the stored token expired; fall back to the signed-out prompt rather than
    // showing a half-empty profile.
    state.loaded = false;
    render();
    return;
  }

  state.profile = core.profile;
  state.currency = core.currency || 'usd';
  state.preferences = core.preferences;
  state.addresses = core.addresses || [];
  state.recommendations = recs.success ? recs.recommendations || [] : [];
  state.daysUntilReorder = recs.success ? recs.days_until_typical_reorder ?? null : null;

  await loadOrders();
  state.loaded = true;
  render();
}

// ---------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------

/**
 * "Buy it again". The API returns the past order's lines resolved to still-purchasable variants;
 * pricing comes from the live catalog the storefront already loaded, so a price change since the
 * original order is reflected rather than replayed at the old price.
 */
async function reorder(orderNumber: string, button: HTMLButtonElement): Promise<void> {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Adding…';

  const res = await apiFetch<any>(`/api/profile/orders/${encodeURIComponent(orderNumber)}/reorder`, { method: 'POST' });
  button.disabled = false;
  button.textContent = original;

  if (!res.success) {
    toast(res.error || 'Could not rebuild that order.', 'error');
    return;
  }

  const products: any[] = storefront?.products || [];
  let added = 0;
  let skipped = 0;

  for (const line of res.items || []) {
    const product = products.find((p: any) => p.id === line.product_id || (p.variants || []).some((v: any) => v.id === line.variant_id));
    const variant = product ? (product.variants || []).find((v: any) => v.id === line.variant_id) : null;
    if (!line.available || !product || !variant) {
      skipped += 1;
      continue;
    }

    storefront.addToCart({
      id: `ci_${Date.now()}_${added}`,
      variant_id: variant.id,
      product_id: product.id,
      name: product.name,
      weight_grams: Number(variant.weight_grams),
      grind_type: line.grind_type,
      unit_price_inr: Number(variant.price_inr ?? Math.round(Number(variant.price_cents || 0) * 0.23)),
      unit_price_usd_cents: Number(variant.price_usd_cents ?? variant.price_cents ?? 0),
      discount_percent: Number(variant.discount_percent || 0),
      quantity: Number(line.quantity || 1),
      image_url: product.image_url,
      subscription_frequency: null,
      custom_notes: null,
    });
    added += 1;
  }

  if (added === 0) {
    toast('None of the coffees from that order are available right now.', 'error');
  } else if (skipped > 0) {
    toast(`Added ${added} item${added === 1 ? '' : 's'} to your cart. ${skipped} item${skipped === 1 ? ' is' : 's are'} no longer available.`, 'info');
  } else {
    toast(`Added ${added} item${added === 1 ? '' : 's'} to your cart.`, 'success');
  }
}

async function showOrderDetail(orderNumber: string): Promise<void> {
  const target = section?.querySelector<HTMLElement>(`[data-profile-detail="${CSS.escape(orderNumber)}"]`);
  if (!target) return;

  if (target.style.display !== 'none') {
    target.style.display = 'none';
    return;
  }

  target.style.display = 'block';
  target.innerHTML = '<p style="color:var(--text-muted); margin:0; font-size:0.88rem;">Loading…</p>';

  const res = await apiFetch<any>(`/api/profile/orders/${encodeURIComponent(orderNumber)}`);
  if (!res.success) {
    target.innerHTML = `<p style="color:var(--text-muted); margin:0; font-size:0.88rem;">${esc(res.error || 'Could not load that order.')}</p>`;
    return;
  }

  const order = res.order;
  target.innerHTML = `
    <table style="width:100%; border-collapse:collapse; font-size:0.87rem;">
      <tbody>
        ${(order.items || [])
          .map(
            (it: any) => `<tr>
              <td style="padding:0.3rem 0;">${esc(it.product_name)} · ${esc(weightLabel(Number(it.weight_grams)))} · ${esc(titleise(it.grind_type))}</td>
              <td style="padding:0.3rem 0; text-align:right; white-space:nowrap;">×${esc(String(it.quantity))}</td>
              <td style="padding:0.3rem 0; text-align:right; white-space:nowrap;">${esc(money(it.total_price_cents))}</td>
            </tr>`
          )
          .join('')}
      </tbody>
    </table>
    <div style="margin-top:0.6rem; font-size:0.87rem; color:var(--text-muted);">
      Subtotal ${esc(money(order.subtotal_cents))} · Shipping ${esc(money(order.shipping_cents))} ·
      Tax ${esc(money(order.tax_cents))} · <strong style="color:var(--text-main);">Total ${esc(money(order.total_cents))}</strong>
      ${order.tracking_number ? `<br>Tracking: ${esc(order.tracking_number)}${order.carrier ? ` (${esc(order.carrier)})` : ''}` : ''}
    </div>`;
}

async function savePreferences(): Promise<void> {
  const statusEl = section?.querySelector<HTMLElement>('#profile-pref-status');
  const grind = (section?.querySelector('#profile-pref-grind') as HTMLSelectElement | null)?.value || null;
  const weight = (section?.querySelector('#profile-pref-weight') as HTMLSelectElement | null)?.value || null;
  const brew = (section?.querySelector('#profile-pref-brew') as HTMLSelectElement | null)?.value || null;

  const channels: Record<string, boolean> = {};
  section?.querySelectorAll<HTMLInputElement>('[data-profile-channel]').forEach((input) => {
    channels[input.dataset.profileChannel as string] = input.checked;
  });

  if (statusEl) statusEl.textContent = 'Saving…';

  const res = await apiFetch<any>('/api/profile/preferences', {
    method: 'PUT',
    json: {
      default_grind: grind || null,
      default_weight_grams: weight ? Number(weight) : null,
      brew_method: brew || null,
      channels,
    },
  });

  if (!res.success) {
    if (statusEl) statusEl.textContent = res.error || 'Could not save.';
    return;
  }

  state.preferences = res.preferences;
  if (statusEl) statusEl.textContent = 'Saved.';
}

async function saveAddress(id: string): Promise<void> {
  const container = section?.querySelector<HTMLElement>(`[data-profile-action="addr-save"][data-id="${CSS.escape(id)}"]`)?.parentElement?.parentElement;
  if (!container) return;

  const payload: Record<string, string> = {};
  container.querySelectorAll<HTMLInputElement>('[data-profile-addr-field]').forEach((input) => {
    payload[input.dataset.profileAddrField as string] = input.value.trim();
  });

  const res = await apiFetch<any>(`/api/profile/addresses/${encodeURIComponent(id)}`, { method: 'PATCH', json: payload });
  if (!res.success) {
    toast(res.error || 'Could not save that address.', 'error');
    return;
  }

  state.editingAddressId = null;
  await refreshAddresses();
}

async function refreshAddresses(): Promise<void> {
  const res = await apiFetch<any>('/api/profile/addresses');
  if (res.success) state.addresses = res.addresses || [];
  render();
}

function onSectionClick(event: Event): void {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-profile-action]');
  if (!target) return;

  const action = target.dataset.profileAction;
  const id = target.dataset.id || '';
  const orderNumber = target.dataset.order || '';

  switch (action) {
    case 'view-product':
      // Deep-links into the catalog card the main app already renders, rather than duplicating
      // the product modal inside this feature.
      window.location.hash = '#catalog';
      document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
      break;
    case 'order-detail':
      void showOrderDetail(orderNumber);
      break;
    case 'reorder':
      void reorder(orderNumber, target as HTMLButtonElement);
      break;
    case 'orders-prev':
      state.offset = Math.max(0, state.offset - PAGE_SIZE);
      void loadOrders().then(render);
      break;
    case 'orders-next':
      state.offset = state.offset + PAGE_SIZE;
      void loadOrders().then(render);
      break;
    case 'save-prefs':
      void savePreferences();
      break;
    case 'addr-edit':
      state.editingAddressId = state.editingAddressId === id ? null : id;
      render();
      break;
    case 'addr-cancel':
      state.editingAddressId = null;
      render();
      break;
    case 'addr-save':
      void saveAddress(id);
      break;
    case 'addr-default':
      void apiFetch(`/api/profile/addresses/${encodeURIComponent(id)}/default`, { method: 'POST' }).then(refreshAddresses);
      break;
    case 'addr-delete':
      if (!confirm('Remove this address from your address book?')) return;
      void apiFetch(`/api/profile/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(refreshAddresses);
      break;
    default:
      break;
  }
}

export function initProfile(app: any): void {
  storefront = app;
  section = mountFeatureSection(SECTION_ID);
  registerNavPill(SECTION_ID, 'Your Profile');

  section.addEventListener('click', onSectionClick);

  void loadAll();

  // Sign-in happens in main.ts, which this feature is not allowed to touch. `storage` covers a
  // sign-in in another tab and `focus` covers a return to this one, but main.ts signs in from an
  // in-page modal — neither event fires in the tab that did it — so the poll is what actually
  // catches the common case. Cheap: one localStorage read.
  let wasSignedIn = isSignedIn();
  const resyncIfSessionChanged = () => {
    const nowSignedIn = isSignedIn();
    if (nowSignedIn !== wasSignedIn) {
      wasSignedIn = nowSignedIn;
      void loadAll();
    }
  };
  window.addEventListener('focus', resyncIfSessionChanged);
  window.addEventListener('storage', resyncIfSessionChanged);
  setInterval(resyncIfSessionChanged, 5000);
}
