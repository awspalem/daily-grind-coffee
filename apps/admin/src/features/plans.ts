/**
 * Admin plans management (4.1) — create, edit, retire subscription plan tiers; see who is on
 * what; see what entitlements have been promised.
 * Build DOM through ./shared.ts helpers; do not edit main.ts or index.html.
 *
 * Retiring is the only "delete" offered, matching the API: live subscriptions reference the plan
 * row, and the perks their members already hold were defined by it.
 */

import { adminFetch, esc } from './shared';
import type { RouteModule } from '../router';

const PANEL = 'panel-plans';

const TIERS = ['EXPLORER', 'CONNOISSEUR', 'FOUNDER'];
const TERMS = ['MONTHLY', 'ANNUAL'];
const FREQUENCIES = ['1_WEEK', '2_WEEKS', '4_WEEKS'];
const ENTITLEMENT_CODES = [
  'CONSULT_15MIN', 'TOUR_SEAT', 'CUPPING_SEAT', 'ESTATE_VISIT', 'FREE_SHIPPING', 'EARLY_ACCESS',
];

interface Plan {
  id: string;
  slug: string;
  name: string;
  tier: string;
  term: string;
  tagline: string | null;
  price_cents: number;
  discount_percent: number;
  default_frequency: string;
  term_months: number;
  shipments_included: number | null;
  perks: string[];
  entitlements: Array<{ code: string; units: number }>;
  badge: string | null;
  display_order: number;
  is_active: boolean;
  subscriber_counts: Record<string, number>;
}

function inr(cents: number): string {
  return '₹' + Math.round((cents || 0) / 100).toLocaleString('en-IN');
}

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN');
}

function options(values: string[], selected?: string): string {
  return values
    .map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v.replace(/_/g, ' '))}</option>`)
    .join('');
}

/**
 * Parses the entitlement textarea: one `CODE x UNITS` per line, `-1` for unlimited.
 * Returns null (rather than dropping the line) on anything unrecognised, so a typo is reported
 * instead of silently shipping a plan that grants nothing.
 */
function parseEntitlements(raw: string): { ok: true; value: Array<{ code: string; units: number }> } | { ok: false; error: string } {
  const value: Array<{ code: string; units: number }> = [];
  for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const match = /^([A-Z0-9_]+)\s*[x×:]\s*(-?\d+)$/i.exec(line);
    if (!match) return { ok: false, error: `Cannot read "${line}" — use CODE x UNITS, e.g. CONSULT_15MIN x 2` };
    const code = match[1].toUpperCase();
    if (!ENTITLEMENT_CODES.includes(code)) return { ok: false, error: `Unknown entitlement code "${code}"` };
    value.push({ code, units: Number(match[2]) });
  }
  return { ok: true, value };
}

function entitlementsToText(list: Array<{ code: string; units: number }>): string {
  return list.map((e) => `${e.code} x ${e.units}`).join('\n');
}

function planRow(p: Plan): string {
  const live = Object.entries(p.subscriber_counts)
    .map(([status, n]) => `${esc(status)}: ${esc(n)}`)
    .join(', ') || '—';

  return `
    <tr data-plan="${esc(p.id)}">
      <td data-label="Plan">
        <strong>${esc(p.name)}</strong><br />
        <span style="color: var(--text-muted); font-size: 0.82rem;">${esc(p.slug)}${p.badge ? ` · ${esc(p.badge)}` : ''}</span>
      </td>
      <td data-label="Tier">${esc(p.tier)}</td>
      <td data-label="Term">${esc(p.term)}${p.term === 'ANNUAL' ? ` (${esc(p.term_months)} mo)` : ''}</td>
      <td data-label="Price">${esc(inr(p.price_cents))}</td>
      <td data-label="Perks">${p.entitlements.length ? esc(entitlementsToText(p.entitlements).replace(/\n/g, ' · ')) : '—'}</td>
      <td data-label="Members">${live}</td>
      <td data-label="Status">${p.is_active ? 'Live' : 'Retired'}</td>
      <td data-label="Action">
        <button class="btn-table-action" data-edit-plan="${esc(p.id)}">Edit</button>
        ${p.is_active ? `<button class="btn-table-action" data-retire-plan="${esc(p.id)}">Retire</button>` : ''}
      </td>
    </tr>
  `;
}

function formHtml(plan: Plan | null): string {
  const p = plan;
  return `
    <form id="plan-form" style="display: grid; gap: 0.8rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 1.4rem;">
      <label>Name<input name="name" required value="${esc(p?.name ?? '')}" /></label>
      <label>Slug<input name="slug" ${p ? 'disabled' : 'required'} value="${esc(p?.slug ?? '')}" /></label>
      <label>Tier<select name="tier">${options(TIERS, p?.tier)}</select></label>
      <label>Term<select name="term">${options(TERMS, p?.term)}</select></label>
      <label>Price (paise)<input name="price_cents" type="number" min="0" required value="${esc(p?.price_cents ?? 0)}" /></label>
      <label>Bag discount %<input name="discount_percent" type="number" min="0" max="60" value="${esc(p?.discount_percent ?? 10)}" /></label>
      <label>Delivery frequency<select name="default_frequency">${options(FREQUENCIES, p?.default_frequency)}</select></label>
      <label>Term months<input name="term_months" type="number" min="1" max="36" value="${esc(p?.term_months ?? 1)}" /></label>
      <label>Shipments included<input name="shipments_included" type="number" min="1" value="${esc(p?.shipments_included ?? '')}" placeholder="blank = open-ended" /></label>
      <label>Badge<input name="badge" value="${esc(p?.badge ?? '')}" /></label>
      <label>Display order<input name="display_order" type="number" value="${esc(p?.display_order ?? 0)}" /></label>
      <label style="grid-column: 1 / -1;">Tagline<input name="tagline" value="${esc(p?.tagline ?? '')}" /></label>
      <label style="grid-column: 1 / -1;">Perks shown on the plan card (one per line)
        <textarea name="perks" rows="3">${esc((p?.perks ?? []).join('\n'))}</textarea>
      </label>
      <label style="grid-column: 1 / -1;">Entitlements granted each term — one per line, <code>CODE x UNITS</code>, -1 for unlimited
        <textarea name="entitlements" rows="4" placeholder="CONSULT_15MIN x 2&#10;FREE_SHIPPING x -1">${esc(entitlementsToText(p?.entitlements ?? []))}</textarea>
      </label>
      <div style="grid-column: 1 / -1; display: flex; gap: 0.6rem; align-items: center;">
        <button type="submit" class="btn-table-action">${p ? 'Save changes' : 'Create plan'}</button>
        ${p ? '<button type="button" class="btn-table-action" id="plan-cancel-edit">Cancel</button>' : ''}
        <span id="plan-form-error" style="color: var(--danger, #c0392b); font-size: 0.85rem;"></span>
      </div>
    </form>
  `;
}

function mount(container: HTMLElement): void {
  container.innerHTML = `
    <section class="section-panel" id="${PANEL}">
      <div class="panel-header"><h2 class="panel-title">Subscription Plans</h2></div>
      <div class="panel-body" style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
        <div id="plan-form-host"></div>
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead><tr>
              <th>Plan</th><th>Tier</th><th>Term</th><th>Price</th><th>Entitlements</th><th>Members</th><th>Status</th><th>Action</th>
            </tr></thead>
            <tbody id="plans-table-body"><tr><td colspan="8">Loading…</td></tr></tbody>
          </table>
        </div>

        <h3>Outstanding entitlements</h3>
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead><tr><th>Code</th><th>Grants</th><th>Units outstanding</th><th>Units used</th></tr></thead>
            <tbody id="plan-entitlements-body"><tr><td colspan="4">Loading…</td></tr></tbody>
          </table>
        </div>

        <h3>Subscribers</h3>
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead><tr>
              <th>Customer</th><th>Plan</th><th>Coffee</th><th>Status</th><th>Next renewal</th><th>Term ends</th><th>Card on file</th>
            </tr></thead>
            <tbody id="plan-subscribers-body"><tr><td colspan="7">Loading…</td></tr></tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  const body = container;
  const formHost = body.querySelector<HTMLElement>('#plan-form-host')!;
  const tableBody = body.querySelector<HTMLElement>('#plans-table-body')!;
  let plans: Plan[] = [];

  function bindForm(plan: Plan | null): void {
    formHost.innerHTML = formHtml(plan);
    const form = formHost.querySelector<HTMLFormElement>('#plan-form')!;
    const errorEl = formHost.querySelector<HTMLElement>('#plan-form-error')!;

    formHost.querySelector('#plan-cancel-edit')?.addEventListener('click', () => bindForm(null));

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      errorEl.textContent = '';
      const data = new FormData(form);

      const parsed = parseEntitlements(String(data.get('entitlements') || ''));
      if (!parsed.ok) { errorEl.textContent = parsed.error; return; }

      const shipments = String(data.get('shipments_included') || '').trim();
      const payload: Record<string, unknown> = {
        name: String(data.get('name') || '').trim(),
        tier: data.get('tier'),
        term: data.get('term'),
        price_cents: Number(data.get('price_cents')),
        discount_percent: Number(data.get('discount_percent')),
        default_frequency: data.get('default_frequency'),
        term_months: Number(data.get('term_months')),
        shipments_included: shipments === '' ? null : Number(shipments),
        badge: String(data.get('badge') || '').trim() || null,
        display_order: Number(data.get('display_order') || 0),
        tagline: String(data.get('tagline') || '').trim() || null,
        perks: String(data.get('perks') || '').split('\n').map((l) => l.trim()).filter(Boolean),
        entitlements: parsed.value,
      };
      if (!plan) payload.slug = String(data.get('slug') || '').trim();

      const res = plan
        ? await adminFetch(`/api/subscriptions/admin/plans/${encodeURIComponent(plan.id)}`, { method: 'PATCH', json: payload })
        : await adminFetch('/api/subscriptions/admin/plans', { method: 'POST', json: payload });

      if (!res.success) { errorEl.textContent = res.error || 'Could not save the plan'; return; }
      bindForm(null);
      await loadPlans();
    });
  }

  async function loadPlans(): Promise<void> {
    const res = await adminFetch<{ plans?: Plan[] }>('/api/subscriptions/admin/plans');
    plans = res.success ? res.plans || [] : [];
    tableBody.innerHTML = plans.length
      ? plans.map(planRow).join('')
      : '<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">No plans yet — create the first tier above.</td></tr>';

    tableBody.querySelectorAll<HTMLElement>('[data-edit-plan]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const plan = plans.find((p) => p.id === btn.dataset.editPlan);
        if (plan) {
          bindForm(plan);
          formHost.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });

    tableBody.querySelectorAll<HTMLElement>('[data-retire-plan]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const plan = plans.find((p) => p.id === btn.dataset.retirePlan);
        if (!plan) return;
        // Existing members keep the plan; this only hides it from the storefront. Say so, so
        // nobody retires a tier expecting it to cancel the subscriptions on it.
        if (!confirm(`Retire "${plan.name}"? It disappears from the storefront. Existing members keep their plan and their perks.`)) return;
        const res = await adminFetch(`/api/subscriptions/admin/plans/${encodeURIComponent(plan.id)}`, { method: 'DELETE' });
        if (!res.success) { alert(res.error || 'Could not retire the plan'); return; }
        await loadPlans();
      });
    });
  }

  async function loadEntitlements(): Promise<void> {
    const el = body!.querySelector<HTMLElement>('#plan-entitlements-body')!;
    const res = await adminFetch<{ entitlements?: any[] }>('/api/subscriptions/admin/entitlements');
    const rows = res.success ? res.entitlements || [] : [];
    el.innerHTML = rows.length
      ? rows.map((r) => `
          <tr>
            <td data-label="Code">${esc(r.entitlement_code)}</td>
            <td data-label="Grants">${esc(r.grant_count)}</td>
            <td data-label="Outstanding">${esc(r.units_outstanding ?? 0)}</td>
            <td data-label="Used">${esc(r.units_used ?? 0)}</td>
          </tr>`).join('')
      : '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Nothing granted yet.</td></tr>';
  }

  async function loadSubscribers(): Promise<void> {
    const el = body!.querySelector<HTMLElement>('#plan-subscribers-body')!;
    const res = await adminFetch<{ subscribers?: any[] }>('/api/subscriptions/admin/subscribers');
    const rows = res.success ? res.subscribers || [] : [];
    el.innerHTML = rows.length
      ? rows.map((s) => `
          <tr>
            <td data-label="Customer">${esc(s.customer_email)}</td>
            <td data-label="Plan">${esc(s.plan_name || '—')}${s.plan_term ? ` <span style="color:var(--text-muted);">(${esc(s.plan_term)})</span>` : ''}</td>
            <td data-label="Coffee">${esc(s.product_name)} · ${esc(String(s.grind_type || '').replace(/_/g, ' '))}</td>
            <td data-label="Status">${esc(s.status)}</td>
            <td data-label="Next renewal">${esc(shortDate(s.next_renewal_date))}</td>
            <td data-label="Term ends">${esc(shortDate(s.term_ends_at))}</td>
            <td data-label="Card on file">${s.has_payment_method ? '✓' : '—'}</td>
          </tr>`).join('')
      : '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No subscribers yet.</td></tr>';
  }

  bindForm(null);
  void loadPlans();
  void loadEntitlements();
  void loadSubscribers();
}

const route: RouteModule = { mount };
export default route;
