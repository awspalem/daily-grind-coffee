/**
 * Admin plans management (4.1) — create, edit, retire, or duplicate subscription plan tiers;
 * see who is on what; see what entitlements have been promised.
 *
 * Build DOM through ./shared.ts helpers; do not edit main.ts or index.html.
 *
 * Retiring is the only "delete" offered, matching the API: live subscriptions reference the plan
 * row, and the perks their members already hold were defined by it.
 */

import { adminFetch, esc, toast, confirmModal } from './shared';
import { icons } from '../icons';
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

function memberSummary(p: Plan): string {
  const entries = Object.entries(p.subscriber_counts || {});
  if (!entries.length) return '—';
  return entries.map(([status, n]) => `${esc(status)}: ${esc(n)}`).join(', ');
}

function planRow(p: Plan): string {
  return `
    <tr data-plan="${esc(p.id)}">
      <td data-label="Plan">
        <strong>${esc(p.name)}</strong><br />
        <span class="cell-sub">${esc(p.slug)}${p.badge ? ` · ${esc(p.badge)}` : ''}</span>
      </td>
      <td data-label="Tier">${esc(p.tier)}</td>
      <td data-label="Term">${esc(p.term)}${p.term === 'ANNUAL' ? ` (${esc(p.term_months)} mo)` : ''}</td>
      <td data-label="Price">${esc(inr(p.price_cents))}</td>
      <td data-label="Perks">${p.entitlements.length ? esc(entitlementsToText(p.entitlements).replace(/\n/g, ' · ')) : '—'}</td>
      <td data-label="Members">${memberSummary(p)}</td>
      <td data-label="Status">${p.is_active ? '<span class="status-badge paid">Live</span>' : '<span class="status-badge cancelled">Retired</span>'}</td>
      <td data-label="Action">
        <button class="btn-table-action" data-edit-plan="${esc(p.id)}">Edit</button>
        <button class="btn-table-action" data-duplicate-plan="${esc(p.id)}">Duplicate</button>
        ${p.is_active ? `<button class="btn-table-action danger" data-retire-plan="${esc(p.id)}">Retire</button>` : ''}
      </td>
    </tr>
  `;
}

function skeletonRows(colspan: number, rows = 4): string {
  return Array.from({ length: rows })
    .map(() => `<tr><td colspan="${colspan}"><div class="skeleton skeleton-row"></div></td></tr>`)
    .join('');
}

function emptyStateHtml(icon: string, title: string, body: string, actionHtml = ''): string {
  return `
    <tr><td colspan="8">
      <div class="empty-state">
        <div class="empty-state-icon">${icon}</div>
        <div class="empty-state-title">${esc(title)}</div>
        <div class="empty-state-body">${esc(body)}</div>
        ${actionHtml}
      </div>
    </td></tr>
  `;
}

/** Build a duplicate-plan record from an existing one. The new row will need a fresh slug. */
function duplicateOf(p: Plan): Omit<Plan, 'id' | 'is_active' | 'subscriber_counts'> & { slug: string } {
  return {
    name: `${p.name} (copy)`,
    slug: `${p.slug}-copy`,
    tier: p.tier,
    term: p.term,
    tagline: p.tagline,
    price_cents: 0,
    discount_percent: p.discount_percent,
    default_frequency: p.default_frequency,
    term_months: p.term_months,
    shipments_included: p.shipments_included,
    perks: p.perks,
    entitlements: p.entitlements,
    badge: p.badge,
    display_order: p.display_order,
  };
}

function formHtml(plan: Plan | null, focusSlug: boolean): string {
  const p = plan;
  return `
    <form id="plan-form" class="form-grid" novalidate>
      <label class="form-field">
        <span class="form-field-label">Name</span>
        <input class="admin-input-styled" name="name" required value="${esc(p?.name ?? '')}" />
      </label>
      <label class="form-field">
        <span class="form-field-label">Slug${focusSlug ? ' <span style="color: var(--rose);">*</span>' : ''}</span>
        <input class="admin-input-styled" name="slug" ${p ? 'disabled' : 'required'} value="${esc(p?.slug ?? '')}" />
        <span class="form-field-help">${p ? 'Slug is permanent once the plan is created.' : 'Lowercase, no spaces — shown in URLs.'}</span>
      </label>
      <label class="form-field">
        <span class="form-field-label">Tier</span>
        <select class="admin-input-styled" name="tier">${options(TIERS, p?.tier)}</select>
      </label>
      <label class="form-field">
        <span class="form-field-label">Term</span>
        <select class="admin-input-styled" name="term">${options(TERMS, p?.term)}</select>
      </label>
      <label class="form-field">
        <span class="form-field-label">Price (paise)</span>
        <input class="admin-input-styled" name="price_cents" type="number" min="0" required value="${esc(p?.price_cents ?? 0)}" />
      </label>
      <label class="form-field">
        <span class="form-field-label">Bag discount %</span>
        <input class="admin-input-styled" name="discount_percent" type="number" min="0" max="60" value="${esc(p?.discount_percent ?? 10)}" />
      </label>
      <label class="form-field">
        <span class="form-field-label">Delivery frequency</span>
        <select class="admin-input-styled" name="default_frequency">${options(FREQUENCIES, p?.default_frequency)}</select>
      </label>
      <label class="form-field">
        <span class="form-field-label">Term months</span>
        <input class="admin-input-styled" name="term_months" type="number" min="1" max="36" value="${esc(p?.term_months ?? 1)}" />
      </label>
      <label class="form-field">
        <span class="form-field-label">Shipments included</span>
        <input class="admin-input-styled" name="shipments_included" type="number" min="1" value="${esc(p?.shipments_included ?? '')}" placeholder="blank = open-ended" />
      </label>
      <label class="form-field">
        <span class="form-field-label">Badge</span>
        <input class="admin-input-styled" name="badge" value="${esc(p?.badge ?? '')}" placeholder="e.g. MOST POPULAR" />
      </label>
      <label class="form-field">
        <span class="form-field-label">Display order</span>
        <input class="admin-input-styled" name="display_order" type="number" value="${esc(p?.display_order ?? 0)}" />
      </label>
      <label class="form-field form-field--wide">
        <span class="form-field-label">Tagline</span>
        <input class="admin-input-styled" name="tagline" value="${esc(p?.tagline ?? '')}" />
      </label>
      <label class="form-field form-field--wide">
        <span class="form-field-label">Perks shown on the plan card (one per line)</span>
        <textarea class="admin-input-styled" name="perks" rows="3">${esc((p?.perks ?? []).join('\n'))}</textarea>
      </label>
      <label class="form-field form-field--wide">
        <span class="form-field-label">Entitlements granted each term</span>
        <textarea class="admin-input-styled" name="entitlements" rows="4" placeholder="CONSULT_15MIN x 2&#10;FREE_SHIPPING x -1">${esc(entitlementsToText(p?.entitlements ?? []))}</textarea>
        <span class="form-field-help">One per line as <code>CODE x UNITS</code>. -1 = unlimited. Allowed codes: ${ENTITLEMENT_CODES.join(', ')}.</span>
      </label>
      <div class="form-actions">
        <button type="submit" class="btn-primary">${p ? 'Save changes' : 'Create plan'}</button>
        ${p ? '<button type="button" class="btn-secondary" id="plan-cancel-edit">Cancel</button>' : ''}
        <span id="plan-form-error" class="form-error" role="alert"></span>
      </div>
    </form>
  `;
}

function mount(container: HTMLElement): void {
  container.innerHTML = `
    <section class="section-panel" id="${PANEL}">
      <div class="panel-header">
        <h2 class="panel-title">Subscription Plans</h2>
        <p class="panel-subtitle">Create, edit, or retire the EXPLORER · CONNOISSEUR · FOUNDER tiers. Existing subscribers keep their perks even when a tier is retired.</p>
      </div>
      <div class="panel-body" style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.4rem;">
        <div id="plan-form-host"></div>

        <h3 style="margin: 0;">Plan tiers</h3>
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead><tr>
              <th>Plan</th><th>Tier</th><th>Term</th><th>Price</th><th>Entitlements</th><th>Members</th><th>Status</th><th>Action</th>
            </tr></thead>
            <tbody id="plans-table-body">${skeletonRows(8)}</tbody>
          </table>
        </div>

        <h3 style="margin: 0;">Outstanding entitlements</h3>
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead><tr><th>Code</th><th>Grants</th><th>Units outstanding</th><th>Units used</th></tr></thead>
            <tbody id="plan-entitlements-body">${skeletonRows(4)}</tbody>
          </table>
        </div>

        <h3 style="margin: 0;">Subscribers</h3>
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead><tr>
              <th>Customer</th><th>Plan</th><th>Coffee</th><th>Status</th><th>Next renewal</th><th>Term ends</th><th>Card on file</th>
            </tr></thead>
            <tbody id="plan-subscribers-body">${skeletonRows(7)}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  const body = container;
  const formHost = body.querySelector<HTMLElement>('#plan-form-host')!;
  const tableBody = body.querySelector<HTMLElement>('#plans-table-body')!;
  let plans: Plan[] = [];
  let editing: Plan | null = null;

  function bindForm(plan: Plan | null, opts: { focusSlug?: boolean; flashRing?: boolean } = {}): void {
    editing = plan;
    formHost.innerHTML = formHtml(plan, Boolean(opts.focusSlug));
    if (opts.flashRing) formHost.classList.add('focus-ring-flash');
    const form = formHost.querySelector<HTMLFormElement>('#plan-form')!;
    const errorEl = formHost.querySelector<HTMLElement>('#plan-form-error')!;
    errorEl.textContent = '';

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

      const isUpdate = Boolean(plan);
      const res = isUpdate
        ? await adminFetch(`/api/subscriptions/admin/plans/${encodeURIComponent(plan!.id)}`, { method: 'PATCH', json: payload })
        : await adminFetch('/api/subscriptions/admin/plans', { method: 'POST', json: payload });

      if (!res.success) {
        errorEl.textContent = res.error || (isUpdate ? 'Could not save the plan' : 'Could not create the plan');
        return;
      }
      toast(isUpdate ? `Plan "${payload.name}" saved` : `Plan "${payload.name}" created`, 'success');
      bindForm(null);
      await loadPlans();
    });
  }

  async function loadPlans(): Promise<void> {
    const res = await adminFetch<{ plans?: Plan[] }>('/api/subscriptions/admin/plans');
    if (!res.success) {
      tableBody.innerHTML = emptyStateHtml(
        icons.errorIcon,
        'Could not load plans',
        res.error || 'Unknown error',
        '<button type="button" class="btn-secondary empty-state-action" id="plans-retry">Retry</button>'
      );
      tableBody.querySelector('#plans-retry')?.addEventListener('click', () => { void loadPlans(); });
      plans = [];
      return;
    }
    plans = res.plans || [];
    if (!plans.length) {
      tableBody.innerHTML = emptyStateHtml(
        icons.layers,
        'No plans yet',
        'Create the EXPLORER, CONNOISSEUR, or FOUNDER tier above to get started.'
      );
      return;
    }
    tableBody.innerHTML = plans.map(planRow).join('');

    tableBody.querySelectorAll<HTMLElement>('[data-edit-plan]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const plan = plans.find((p) => p.id === btn.dataset.editPlan);
        if (!plan) return;
        bindForm(plan, { flashRing: true });
        formHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    tableBody.querySelectorAll<HTMLElement>('[data-duplicate-plan]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const plan = plans.find((p) => p.id === btn.dataset.duplicatePlan);
        if (!plan) return;
        // Render a fresh create-form pre-filled with the duplicate's values
        // (and a "(copy)" name + new slug) without persisting the original.
        const dup = duplicateOf(plan) as Plan;
        bindForm(dup, { focusSlug: true, flashRing: true });
        formHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    tableBody.querySelectorAll<HTMLElement>('[data-retire-plan]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const plan = plans.find((p) => p.id === btn.dataset.retirePlan);
        if (!plan) return;
        // Existing members keep the plan; this only hides it from the storefront. Say so, so
        // nobody retires a tier expecting it to cancel the subscriptions on it.
        const ok = await confirmModal({
          title: `Retire "${plan.name}"?`,
          body: 'It disappears from the storefront. Existing members keep their plan and their perks — this does not cancel their subscriptions.',
          confirmLabel: 'Retire plan',
          danger: true,
        });
        if (!ok) return;
        const res = await adminFetch(`/api/subscriptions/admin/plans/${encodeURIComponent(plan.id)}`, { method: 'DELETE' });
        if (!res.success) { toast(res.error || 'Could not retire the plan', 'error'); return; }
        toast(`Plan "${plan.name}" retired`, 'success');
        await loadPlans();
      });
    });
  }

  async function loadEntitlements(): Promise<void> {
    const el = body!.querySelector<HTMLElement>('#plan-entitlements-body')!;
    const res = await adminFetch<{ entitlements?: any[] }>('/api/subscriptions/admin/entitlements');
    if (!res.success) {
      el.innerHTML = emptyStateHtml(icons.errorIcon, 'Could not load entitlements', res.error || 'Unknown error');
      return;
    }
    const rows = res.entitlements || [];
    if (!rows.length) {
      el.innerHTML = emptyStateHtml(icons.info, 'Nothing granted yet', 'When a subscriber redeems a perk, the outstanding count will appear here.');
      return;
    }
    el.innerHTML = rows.map((r) => `
      <tr>
        <td data-label="Code">${esc(r.entitlement_code)}</td>
        <td data-label="Grants">${esc(r.grant_count)}</td>
        <td data-label="Outstanding">${esc(r.units_outstanding ?? 0)}</td>
        <td data-label="Used">${esc(r.units_used ?? 0)}</td>
      </tr>`).join('');
  }

  async function loadSubscribers(): Promise<void> {
    const el = body!.querySelector<HTMLElement>('#plan-subscribers-body')!;
    const res = await adminFetch<{ subscribers?: any[] }>('/api/subscriptions/admin/subscribers');
    if (!res.success) {
      el.innerHTML = emptyStateHtml(icons.errorIcon, 'Could not load subscribers', res.error || 'Unknown error');
      return;
    }
    const rows = res.subscribers || [];
    if (!rows.length) {
      el.innerHTML = emptyStateHtml(icons.inbox, 'No subscribers yet', 'As soon as a customer signs up for a plan, they will appear here.');
      return;
    }
    el.innerHTML = rows.map((s) => `
      <tr>
        <td data-label="Customer">${esc(s.customer_email)}</td>
        <td data-label="Plan">${esc(s.plan_name || '—')}${s.plan_term ? ` <span class="cell-sub">(${esc(s.plan_term)})</span>` : ''}</td>
        <td data-label="Coffee">${esc(s.product_name)} · ${esc(String(s.grind_type || '').replace(/_/g, ' '))}</td>
        <td data-label="Status">${esc(s.status)}</td>
        <td data-label="Next renewal">${esc(shortDate(s.next_renewal_date))}</td>
        <td data-label="Term ends">${esc(shortDate(s.term_ends_at))}</td>
        <td data-label="Card on file">${s.has_payment_method ? '✓' : '—'}</td>
      </tr>`).join('');
  }

  bindForm(null);
  void loadPlans();
  void loadEntitlements();
  void loadSubscribers();
}

const route: RouteModule = { mount };
export default route;
