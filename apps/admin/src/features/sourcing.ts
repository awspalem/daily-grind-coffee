/**
 * Sourcing scanner & harvest-season calendar.
 *
 * Three tabs in one panel:
 *   1. Lots         — green-bean procurement pipeline (Probed → In Transit →
 *                     Cleared → In Silo → Roasted). Sortable, filterable, with
 *                     a status cycle button on every row.
 *   2. Calendar     — year-at-a-glance view of every origin's harvest window
 *                     plus overlay markers for ETAs and landed dates of live
 *                     lots. Click a cell to jump to a lot's detail row.
 *   3. Roast Plan   — read-only feed of upcoming roast_batches, with the lot
 *                     the operator can attach via the existing /roast-batch
 *                     endpoint if they want a tighter loop.
 *
 * All persistence goes through /api/admin/sourcing/* (see routes/admin.ts).
 */

import { adminFetch, esc, triggerHaptic, toast, openInlineModal, confirmModal } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-sourcing">
    <div class="panel-header">
      <h2 class="panel-title">Sourcing Scanner &amp; Season Calendar</h2>
      <div class="sourcing-header-actions">
        <button class="btn-secondary" id="btn-add-season">+ Add Harvest Window</button>
        <button class="btn-primary" id="btn-add-lot">+ Track New Lot</button>
      </div>
    </div>

    <div class="sourcing-tabs" role="tablist">
      <button class="sourcing-tab active" role="tab" data-tab="lots" aria-selected="true">Lots</button>
      <button class="sourcing-tab" role="tab" data-tab="calendar" aria-selected="false">Calendar</button>
      <button class="sourcing-tab" role="tab" data-tab="roasts" aria-selected="false">Roast Plan</button>
    </div>

    <div class="sourcing-pane" id="sourcing-pane-lots" data-pane="lots">
      <div class="sourcing-filters">
        <label class="sourcing-filter">
          <span>Status</span>
          <select id="lot-filter-status">
            <option value="">All</option>
            <option value="PROBED">Probed</option>
            <option value="IN_TRANSIT">In Transit</option>
            <option value="CLEARED">Cleared</option>
            <option value="IN_SILO">In Silo</option>
            <option value="ROASTED">Roasted</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>
        <label class="sourcing-filter">
          <span>Origin</span>
          <input id="lot-filter-origin" type="text" placeholder="e.g. Ethiopia" />
        </label>
        <span class="sourcing-filter-summary" id="lot-summary">—</span>
      </div>

      <div class="table-responsive">
        <table class="data-table sourcing-lots-table">
          <thead>
            <tr>
              <th>Lot</th>
              <th>Origin</th>
              <th>Supplier</th>
              <th>Process</th>
              <th>Ordered / Received</th>
              <th>Contract</th>
              <th>ETA</th>
              <th>Landed</th>
              <th>Status</th>
              <th>Product</th>
            </tr>
          </thead>
          <tbody id="lots-table-body">
            <tr><td colspan="10"><div class="skeleton skeleton-row"></div></td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="sourcing-pane" id="sourcing-pane-calendar" data-pane="calendar" hidden>
      <div class="sourcing-calendar-toolbar">
        <button class="btn-secondary" id="cal-prev" aria-label="Previous year">‹</button>
        <strong id="cal-year-label">—</strong>
        <button class="btn-secondary" id="cal-next" aria-label="Next year">›</button>
        <button class="btn-ghost" id="cal-today" type="button">Jump to current</button>
        <span class="sourcing-legend">
          <span class="sourcing-legend-dot sourcing-legend-dot--harvest"></span> Harvest
          <span class="sourcing-legend-dot sourcing-legend-dot--ship"></span> Ship window
          <span class="sourcing-legend-dot sourcing-legend-dot--eta"></span> Lot ETA
          <span class="sourcing-legend-dot sourcing-legend-dot--landed"></span> Landed
        </span>
      </div>
      <div class="sourcing-calendar" id="sourcing-calendar" role="grid" aria-label="Harvest season calendar"></div>
      <div class="sourcing-calendar-details" id="sourcing-calendar-details">
        <div class="sourcing-calendar-details-empty">Click a season bar or lot marker for details.</div>
      </div>
    </div>

    <div class="sourcing-pane" id="sourcing-pane-roasts" data-pane="roasts" hidden>
      <div class="sourcing-roasts-help">
        Batches already logged via the <em>Batch Roaster &amp; Loss Log</em>. Useful as a forward
        calendar — pair the date with a sourced lot once you've allocated the green.
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Batch</th>
              <th>Lot</th>
              <th>Green in (kg)</th>
              <th>Roasted out (kg)</th>
              <th>Loss %</th>
              <th>Profile</th>
              <th>Logged</th>
            </tr>
          </thead>
          <tbody id="roasts-table-body">
            <tr><td colspan="7"><div class="skeleton skeleton-row"></div></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
`;

const LOT_STATUS_BADGE: Record<string, string> = {
  PROBED: 'neutral',
  IN_TRANSIT: 'pending',
  CLEARED: 'packed',
  IN_SILO: 'paid',
  ROASTED: 'roasting',
  CANCELLED: 'cancelled',
};

const LOT_STATUS_CYCLE: Record<string, string> = {
  PROBED: 'IN_TRANSIT',
  IN_TRANSIT: 'CLEARED',
  CLEARED: 'IN_SILO',
  IN_SILO: 'ROASTED',
  ROASTED: 'CANCELLED',
  CANCELLED: 'PROBED',
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Lot {
  id: string;
  lot_code: string;
  supplier_name: string;
  origin_country: string;
  region?: string | null;
  process_method?: string | null;
  variety?: string | null;
  green_kg_ordered: number;
  green_kg_received: number;
  contract_date?: string | null;
  expected_eta?: string | null;
  landed_at?: string | null;
  status: string;
  product_id?: string | null;
  product_name?: string | null;
  product_slug?: string | null;
  notes?: string | null;
}

interface Season {
  id: string;
  origin_country: string;
  region: string | null;
  season_label: string;
  harvest_start: string;
  harvest_end: string;
  ship_start?: string | null;
  ship_end?: string | null;
  notes?: string | null;
}

function dateOf(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(iso: string | null | undefined): string {
  const d = dateOf(iso);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function monthIndex(iso: string | null | undefined): number | null {
  const d = dateOf(iso);
  return d ? d.getMonth() : null;
}

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;

    const lotsBody = document.getElementById('lots-table-body')!;
    const roastsBody = document.getElementById('roasts-table-body')!;
    const lotSummary = document.getElementById('lot-summary')!;
    const filterStatus = document.getElementById('lot-filter-status') as HTMLSelectElement;
    const filterOrigin = document.getElementById('lot-filter-origin') as HTMLInputElement;
    const calHost = document.getElementById('sourcing-calendar')!;
    const calYearLabel = document.getElementById('cal-year-label')!;
    const calDetails = document.getElementById('sourcing-calendar-details')!;

    let lots: Lot[] = [];
    let seasons: Season[] = [];
    let calendarYear = new Date().getFullYear();

    // -------------------------------------------------------------------------
    // Tab switching
    // -------------------------------------------------------------------------
    const tabs = container.querySelectorAll<HTMLButtonElement>('.sourcing-tab');
    const panes = container.querySelectorAll<HTMLElement>('.sourcing-pane');
    tabs.forEach((t) => {
      t.addEventListener('click', () => {
        triggerHaptic();
        const key = t.dataset.tab!;
        tabs.forEach((b) => {
          const on = b === t;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        panes.forEach((p) => {
          const on = p.dataset.pane === key;
          p.hidden = !on;
        });
        if (key === 'calendar') renderCalendar();
      });
    });

    // -------------------------------------------------------------------------
    // Lots tab
    // -------------------------------------------------------------------------
    function renderLots(): void {
      const statusFilter = filterStatus.value;
      const originFilter = filterOrigin.value.trim().toLowerCase();
      const filtered = lots.filter((l) => {
        if (statusFilter && l.status !== statusFilter) return false;
        if (originFilter && !`${l.origin_country} ${l.region ?? ''}`.toLowerCase().includes(originFilter)) return false;
        return true;
      });

      if (!filtered.length) {
        lotsBody.innerHTML = `<tr><td colspan="10">
          <div class="empty-state">
            <div class="empty-state-title">${lots.length ? 'No lots match the filters' : 'No lots tracked yet'}</div>
            <div class="empty-state-body">${lots.length
              ? 'Try clearing the status or origin filter above.'
              : 'Track a probed contract, sample lot, or full container above — they flow through PROBED → IN_TRANSIT → CLEARED → IN_SILO → ROASTED.'}
            </div>
          </div>
        </td></tr>`;
      } else {
        lotsBody.innerHTML = filtered.map((l) => {
          const ordered = Number(l.green_kg_ordered) || 0;
          const received = Number(l.green_kg_received) || 0;
          const kg = ordered ? `${received.toFixed(0)} / ${ordered.toFixed(0)} kg` : '—';
          const badge = LOT_STATUS_BADGE[l.status] || 'neutral';
          return `
            <tr data-lot-id="${esc(l.id)}">
              <td data-label="Lot">
                <strong>${esc(l.lot_code)}</strong>
                ${l.variety ? `<div class="sourcing-row-sub">${esc(l.variety)}</div>` : ''}
              </td>
              <td data-label="Origin"><strong>${esc(l.origin_country)}</strong>${l.region ? `<div class="sourcing-row-sub">${esc(l.region)}</div>` : ''}</td>
              <td data-label="Supplier">${esc(l.supplier_name)}</td>
              <td data-label="Process">${esc(l.process_method || '—')}</td>
              <td data-label="Ordered / Received">${kg}</td>
              <td data-label="Contract">${fmtDate(l.contract_date)}</td>
              <td data-label="ETA">${fmtDate(l.expected_eta)}</td>
              <td data-label="Landed">${fmtDate(l.landed_at)}</td>
              <td data-label="Status">
                <button class="status-badge ${badge}" data-cycle-lot="${esc(l.id)}" type="button">${esc(l.status)}</button>
              </td>
              <td data-label="Product">${l.product_name
                ? `<span class="sourcing-product-pill">${esc(l.product_name)}</span>`
                : `<button class="btn-table-action" data-link-lot="${esc(l.id)}" type="button">Link</button>`}</td>
            </tr>`;
        }).join('');
      }

      const inSiloKg = lots
        .filter((l) => l.status === 'IN_SILO' || l.status === 'CLEARED')
        .reduce((sum, l) => sum + (Number(l.green_kg_received) || Number(l.green_kg_ordered) || 0), 0);
      const liveCount = lots.filter((l) => !['ROASTED', 'CANCELLED'].includes(l.status)).length;
      lotSummary.textContent = lots.length
        ? `${filtered.length} shown · ${liveCount} live · ${inSiloKg.toFixed(0)} kg in pipeline`
        : '—';
    }

    async function loadLots(): Promise<void> {
      const res = await adminFetch<{ lots?: Lot[] }>('/api/admin/sourcing/lots');
      if (!res.success) { lotsBody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="empty-state-title">Could not load lots</div><div class="empty-state-body">${esc(res.error || '')}</div></div></td></tr>`; return; }
      lots = res.lots || [];
      renderLots();
    }

    lotsBody.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      const cycleBtn = target.closest<HTMLButtonElement>('[data-cycle-lot]');
      if (cycleBtn) {
        triggerHaptic();
        const lot = lots.find((l) => l.id === cycleBtn.dataset.cycleLot);
        if (!lot) return;
        const next = LOT_STATUS_CYCLE[lot.status] || 'PROBED';
        const res = await adminFetch<{ success: boolean; error?: string }>(`/api/admin/sourcing/lots/${encodeURIComponent(lot.id)}`, {
          method: 'PATCH', json: { status: next },
        });
        if (!res.success) { toast(res.error || 'Could not update status', 'error'); return; }
        lot.status = next;
        renderLots();
        return;
      }
      const linkBtn = target.closest<HTMLButtonElement>('[data-link-lot]');
      if (linkBtn) {
        triggerHaptic();
        openLinkProductModal(linkBtn.dataset.linkLot!);
      }
    });

    filterStatus.addEventListener('change', renderLots);
    filterOrigin.addEventListener('input', renderLots);

    // -------------------------------------------------------------------------
    // Lot creation modal
    // -------------------------------------------------------------------------
    document.getElementById('btn-add-lot')?.addEventListener('click', () => {
      triggerHaptic();
      openInlineModal({
        title: 'Track a new green-bean lot',
        bodyHtml: `
          <div class="form-grid">
            <label class="form-field">
              <span class="form-field-label">Lot code</span>
              <input class="admin-input-styled" id="new-lot-code" placeholder="ETH-YIRG-2026-A1" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Supplier</span>
              <input class="admin-input-styled" id="new-lot-supplier" placeholder="e.g. Nordic Approach" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Origin country</span>
              <input class="admin-input-styled" id="new-lot-origin" placeholder="Ethiopia" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Region (optional)</span>
              <input class="admin-input-styled" id="new-lot-region" placeholder="Gedeb, Yirgacheffe" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Process</span>
              <select class="admin-input-styled" id="new-lot-process">
                <option value="">—</option>
                <option>WASHED</option><option>NATURAL</option><option>HONEY</option>
                <option>ANAEROBIC</option><option>WET_HULLED</option>
              </select>
            </label>
            <label class="form-field">
              <span class="form-field-label">Variety (optional)</span>
              <input class="admin-input-styled" id="new-lot-variety" placeholder="Heirloom / Bourbon" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Green kg ordered</span>
              <input class="admin-input-styled" id="new-lot-ordered" type="number" min="0" step="0.1" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Green kg received</span>
              <input class="admin-input-styled" id="new-lot-received" type="number" min="0" step="0.1" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Contract date</span>
              <input class="admin-input-styled" id="new-lot-contract" type="date" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Expected ETA</span>
              <input class="admin-input-styled" id="new-lot-eta" type="date" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Landed at (optional)</span>
              <input class="admin-input-styled" id="new-lot-landed" type="date" />
            </label>
            <label class="form-field form-field--wide">
              <span class="form-field-label">Notes</span>
              <textarea class="admin-input-styled" id="new-lot-notes" rows="2" placeholder="Cupping score, contract ref, anything else"></textarea>
            </label>
          </div>
        `,
        primaryLabel: 'Create lot',
        onPrimary: async (close) => {
          const get = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)?.value?.trim();
          const lotCode = get('new-lot-code');
          const supplier = get('new-lot-supplier');
          const origin = get('new-lot-origin');
          if (!lotCode || !supplier || !origin) { toast('Lot code, supplier and origin are required', 'error'); return; }

          const num = (v?: string) => {
            const n = Number(v);
            return Number.isFinite(n) && n !== 0 ? n : undefined;
          };
          const payload = {
            lot_code: lotCode,
            supplier_name: supplier,
            origin_country: origin,
            region: get('new-lot-region') || undefined,
            process_method: get('new-lot-process') || undefined,
            variety: get('new-lot-variety') || undefined,
            green_kg_ordered: num(get('new-lot-ordered')),
            green_kg_received: num(get('new-lot-received')),
            contract_date: get('new-lot-contract') || undefined,
            expected_eta: get('new-lot-eta') || undefined,
            landed_at: get('new-lot-landed') || undefined,
            notes: get('new-lot-notes') || undefined,
          };
          const res = await adminFetch<{ success: boolean; error?: string }>('/api/admin/sourcing/lots', {
            method: 'POST', json: payload,
          });
          if (!res.success) { toast(res.error || 'Could not create lot', 'error'); return; }
          toast(`Lot "${lotCode}" tracked`, 'success');
          close();
          await loadLots();
        },
      });
    });

    // -------------------------------------------------------------------------
    // Link lot → product modal (cached products list)
    // -------------------------------------------------------------------------
    let productCache: { id: string; name: string }[] | null = null;
    async function openLinkProductModal(lotId: string): Promise<void> {
      if (!productCache) {
        const res = await adminFetch<{ products?: { id: string; name: string }[] }>('/api/admin/products');
        productCache = res.success ? (res.products || []).map((p) => ({ id: p.id, name: p.name })) : [];
      }
      const lot = lots.find((l) => l.id === lotId);
      if (!lot) return;
      const options = productCache.map((p) =>
        `<option value="${esc(p.id)}" ${p.id === lot.product_id ? 'selected' : ''}>${esc(p.name)}</option>`
      ).join('');
      openInlineModal({
        title: `Link ${lot.lot_code} to a product`,
        bodyHtml: `
          <div class="form-grid">
            <label class="form-field form-field--wide">
              <span class="form-field-label">Product</span>
              <select class="admin-input-styled" id="link-product-select">
                <option value="">— No link —</option>
                ${options}
              </select>
            </label>
            <p class="form-field-help" style="grid-column: 1 / -1;">
              Linking is informational — the roast log still drives inventory. Use this to mark which
              catalog SKU this lot ends up roasted as.
            </p>
          </div>
        `,
        primaryLabel: 'Save link',
        onPrimary: async (close) => {
          const select = document.getElementById('link-product-select') as HTMLSelectElement;
          const productId = select.value || null;
          const res = await adminFetch(`/api/admin/sourcing/lots/${encodeURIComponent(lotId)}`, {
            method: 'PATCH', json: { product_id: productId },
          });
          if (!res.success) { toast('Could not save link', 'error'); return; }
          toast(productId ? 'Lot linked to product' : 'Link cleared', 'success');
          close();
          await loadLots();
        },
      });
    }

    // -------------------------------------------------------------------------
    // Calendar tab
    // -------------------------------------------------------------------------
    async function loadSeasons(): Promise<void> {
      const res = await adminFetch<{ seasons?: Season[] }>('/api/admin/sourcing/seasons');
      seasons = res.success ? (res.seasons || []) : [];
      renderCalendar();
    }

    function renderCalendar(): void {
      calYearLabel.textContent = String(calendarYear);

      const yearStart = new Date(`${calendarYear}-01-01T00:00:00`);
      const yearEnd = new Date(`${calendarYear}-12-31T23:59:59`);

      // Group seasons by origin for the rows. Use country+region as the key so
      // two regions of the same country each get their own row (Ethiopia Yirg
      // ≠ Ethiopia Sidamo, even if both are picking in November).
      const rows: Array<{ key: string; label: string; seasons: Season[]; etas: Lot[]; landings: Lot[] }> = [];
      const byKey = new Map<string, typeof rows[number]>();
      for (const s of seasons) {
        const k = `${s.origin_country}__${s.region || ''}`;
        if (!byKey.has(k)) {
          const row = { key: k, label: s.region ? `${s.origin_country} · ${s.region}` : s.origin_country, seasons: [], etas: [], landings: [] };
          byKey.set(k, row);
          rows.push(row);
        }
        byKey.get(k)!.seasons.push(s);
      }
      // Attach lot markers only for the year in view
      for (const lot of lots) {
        const etaMonth = monthIndex(lot.expected_eta);
        const landedMonth = monthIndex(lot.landed_at);
        if (etaMonth !== null && dateOf(lot.expected_eta)!.getFullYear() === calendarYear) {
          const k = `${lot.origin_country}__${lot.region || ''}`;
          const row = byKey.get(k) || (() => {
            const r = { key: k, label: lot.region ? `${lot.origin_country} · ${lot.region}` : lot.origin_country, seasons: [], etas: [], landings: [] };
            byKey.set(k, r); rows.push(r); return r;
          })();
          row.etas.push(lot);
        }
        if (landedMonth !== null && dateOf(lot.landed_at)!.getFullYear() === calendarYear) {
          const k = `${lot.origin_country}__${lot.region || ''}`;
          const row = byKey.get(k);
          if (row) row.landings.push(lot);
        }
      }
      rows.sort((a, b) => a.label.localeCompare(b.label));

      if (!rows.length) {
        calHost.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-title">No origins to plot yet</div>
            <div class="empty-state-body">Add a harvest window (e.g. Ethiopia Yirgacheffe — Nov to Feb) and the calendar fills in. Use the Lots tab to track ETAs and landings.</div>
          </div>`;
        return;
      }

      // 12-month grid: header row of month names, then one row per origin.
      const monthCols = MONTH_NAMES.map((m, i) => `<div class="sourcing-cal-month sourcing-cal-axis" data-month="${i}">${m}</div>`).join('');
      const originAxis = `<div class="sourcing-cal-row sourcing-cal-axis-cell">Origin</div>${monthCols}`;
      const rowsHtml = rows.map((row) => {
        const cells = MONTH_NAMES.map((_, i) => `<div class="sourcing-cal-cell" data-month="${i}"></div>`).join('');
        const harvestBars = row.seasons.map((s) => {
          const startD = dateOf(s.harvest_start);
          const endD = dateOf(s.harvest_end);
          if (!startD || !endD) return '';
          // Clamp to the displayed year so partial windows still render sensibly.
          const s2 = startD < yearStart ? yearStart : startD;
          const e2 = endD > yearEnd ? yearEnd : endD;
          const startPct = ((s2.getTime() - yearStart.getTime()) / (365 * 24 * 60 * 60 * 1000)) * 100;
          const spanPct = ((e2.getTime() - s2.getTime()) / (365 * 24 * 60 * 60 * 1000)) * 100;
          if (spanPct <= 0) return '';
          return `<div class="sourcing-bar sourcing-bar--harvest"
                       data-season-id="${esc(s.id)}"
                       style="left: ${startPct.toFixed(2)}%; width: ${spanPct.toFixed(2)}%;"
                       title="${esc(s.season_label)} — ${esc(fmtDate(s.harvest_start))} → ${esc(fmtDate(s.harvest_end))}">
                    <span>${esc(s.season_label)}</span>
                  </div>`;
        }).join('');
        const shipBars = row.seasons.map((s) => {
          if (!s.ship_start || !s.ship_end) return '';
          const startD = dateOf(s.ship_start);
          const endD = dateOf(s.ship_end);
          if (!startD || !endD) return '';
          const s2 = startD < yearStart ? yearStart : startD;
          const e2 = endD > yearEnd ? yearEnd : endD;
          const startPct = ((s2.getTime() - yearStart.getTime()) / (365 * 24 * 60 * 60 * 1000)) * 100;
          const spanPct = ((e2.getTime() - s2.getTime()) / (365 * 24 * 60 * 60 * 1000)) * 100;
          if (spanPct <= 0) return '';
          return `<div class="sourcing-bar sourcing-bar--ship"
                       data-season-id="${esc(s.id)}"
                       style="left: ${startPct.toFixed(2)}%; width: ${spanPct.toFixed(2)}%;"
                       title="Ship window — ${esc(fmtDate(s.ship_start))} → ${esc(fmtDate(s.ship_end))}"></div>`;
        }).join('');

        const markers = row.etas.map((lot) => markerFor(lot, 'eta')).join('')
          + row.landings.map((lot) => markerFor(lot, 'landed')).join('');

        return `
          <div class="sourcing-cal-row">
            <div class="sourcing-cal-row-label">${esc(row.label)}</div>
            <div class="sourcing-cal-track">
              ${cells}
              ${harvestBars}
              ${shipBars}
              ${markers}
            </div>
          </div>`;
      }).join('');

      calHost.innerHTML = originAxis + rowsHtml;

      calHost.querySelectorAll<HTMLElement>('[data-season-id]').forEach((el) => {
        el.addEventListener('click', () => {
          const season = seasons.find((s) => s.id === el.dataset.seasonId);
          if (season) showSeasonDetails(season);
        });
      });
      calHost.querySelectorAll<HTMLElement>('[data-marker-lot]').forEach((el) => {
        el.addEventListener('click', () => {
          const lot = lots.find((l) => l.id === el.dataset.markerLot);
          if (lot) showLotDetails(lot);
        });
      });
    }

    function markerFor(lot: Lot, kind: 'eta' | 'landed'): string {
      const iso = kind === 'eta' ? lot.expected_eta : lot.landed_at;
      const d = dateOf(iso);
      if (!d || d.getFullYear() !== calendarYear) return '';
      const pct = ((d.getTime() - new Date(`${calendarYear}-01-01T00:00:00`).getTime()) / (365 * 24 * 60 * 60 * 1000)) * 100;
      const cls = kind === 'eta' ? 'sourcing-marker sourcing-marker--eta' : 'sourcing-marker sourcing-marker--landed';
      const label = kind === 'eta' ? 'ETA' : 'Landed';
      return `<button type="button" class="${cls}" data-marker-lot="${esc(lot.id)}"
                       style="left: ${pct.toFixed(2)}%;"
                       title="${label}: ${esc(lot.lot_code)} (${esc(fmtDate(iso))})">
                <span>${label}</span>
              </button>`;
    }

    function showSeasonDetails(season: Season): void {
      const relatedLots = lots.filter((l) => l.origin_country === season.origin_country && (!season.region || l.region === season.region));
      calDetails.innerHTML = `
        <div class="sourcing-detail">
          <div class="sourcing-detail-head">
            <div>
              <h4>${esc(season.season_label)}</h4>
              <div class="sourcing-detail-sub">${esc(season.origin_country)}${season.region ? ' · ' + esc(season.region) : ''}</div>
            </div>
            <button class="btn-table-action" id="cal-del-season" type="button">Remove window</button>
          </div>
          <dl class="sourcing-detail-grid">
            <div><dt>Harvest</dt><dd>${esc(fmtDate(season.harvest_start))} → ${esc(fmtDate(season.harvest_end))}</dd></div>
            <div><dt>Ship window</dt><dd>${season.ship_start ? esc(fmtDate(season.ship_start)) + ' → ' + esc(fmtDate(season.ship_end)) : '—'}</dd></div>
            <div><dt>Linked lots</dt><dd>${relatedLots.length ? relatedLots.map((l) => `<button class="sourcing-product-pill" data-jump-lot="${esc(l.id)}" type="button">${esc(l.lot_code)}</button>`).join(' ') : 'None yet'}</dd></div>
            <div><dt>Notes</dt><dd>${season.notes ? esc(season.notes) : '—'}</dd></div>
          </dl>
        </div>`;
      calDetails.querySelector('#cal-del-season')?.addEventListener('click', async () => {
        const ok = await confirmModal({
          title: `Remove "${season.season_label}"?`,
          body: 'This drops the harvest window. Existing lots stay — they just lose their seasonal anchor.',
          confirmLabel: 'Remove window', danger: true,
        });
        if (!ok) return;
        const res = await adminFetch(`/api/admin/sourcing/seasons/${encodeURIComponent(season.id)}`, { method: 'DELETE' });
        if (!res.success) { toast('Could not remove window', 'error'); return; }
        toast('Window removed', 'success');
        await loadSeasons();
        calDetails.innerHTML = '<div class="sourcing-calendar-details-empty">Click a season bar or lot marker for details.</div>';
      });
      calDetails.querySelectorAll<HTMLButtonElement>('[data-jump-lot]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const lot = lots.find((l) => l.id === btn.dataset.jumpLot);
          if (lot) showLotDetails(lot);
        });
      });
    }

    function showLotDetails(lot: Lot): void {
      calDetails.innerHTML = `
        <div class="sourcing-detail">
          <div class="sourcing-detail-head">
            <div>
              <h4>${esc(lot.lot_code)}</h4>
              <div class="sourcing-detail-sub">${esc(lot.supplier_name)} · ${esc(lot.origin_country)}${lot.region ? ' · ' + esc(lot.region) : ''}</div>
            </div>
            <button class="btn-table-action" id="cal-jump-lots" type="button">Open in Lots</button>
          </div>
          <dl class="sourcing-detail-grid">
            <div><dt>Status</dt><dd><span class="status-badge ${LOT_STATUS_BADGE[lot.status] || 'neutral'}">${esc(lot.status)}</span></dd></div>
            <div><dt>Process</dt><dd>${esc(lot.process_method || '—')}</dd></div>
            <div><dt>Ordered / Received</dt><dd>${(Number(lot.green_kg_received) || 0).toFixed(0)} / ${(Number(lot.green_kg_ordered) || 0).toFixed(0)} kg</dd></div>
            <div><dt>Contract</dt><dd>${esc(fmtDate(lot.contract_date))}</dd></div>
            <div><dt>ETA</dt><dd>${esc(fmtDate(lot.expected_eta))}</dd></div>
            <div><dt>Landed</dt><dd>${esc(fmtDate(lot.landed_at))}</dd></div>
            <div><dt>Product link</dt><dd>${lot.product_name ? esc(lot.product_name) : '—'}</dd></div>
            <div><dt>Notes</dt><dd>${lot.notes ? esc(lot.notes) : '—'}</dd></div>
          </dl>
        </div>`;
      calDetails.querySelector('#cal-jump-lots')?.addEventListener('click', () => {
        document.querySelector<HTMLButtonElement>('.sourcing-tab[data-tab="lots"]')?.click();
        requestAnimationFrame(() => {
          const row = container.querySelector<HTMLElement>(`tr[data-lot-id="${lot.id}"]`);
          row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          row?.classList.add('sourcing-row-flash');
          setTimeout(() => row?.classList.remove('sourcing-row-flash'), 1600);
        });
      });
    }

    document.getElementById('cal-prev')?.addEventListener('click', () => { calendarYear -= 1; renderCalendar(); });
    document.getElementById('cal-next')?.addEventListener('click', () => { calendarYear += 1; renderCalendar(); });
    document.getElementById('cal-today')?.addEventListener('click', () => { calendarYear = new Date().getFullYear(); renderCalendar(); });

    // -------------------------------------------------------------------------
    // Add harvest window modal
    // -------------------------------------------------------------------------
    document.getElementById('btn-add-season')?.addEventListener('click', () => {
      triggerHaptic();
      openInlineModal({
        title: 'Add a harvest window',
        bodyHtml: `
          <div class="form-grid">
            <label class="form-field">
              <span class="form-field-label">Origin country</span>
              <input class="admin-input-styled" id="new-season-origin" placeholder="Ethiopia" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Region (optional)</span>
              <input class="admin-input-styled" id="new-season-region" placeholder="Yirgacheffe" />
            </label>
            <label class="form-field form-field--wide">
              <span class="form-field-label">Season label</span>
              <input class="admin-input-styled" id="new-season-label" placeholder="Main crop 2026" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Harvest start</span>
              <input class="admin-input-styled" id="new-season-h-start" type="date" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Harvest end</span>
              <input class="admin-input-styled" id="new-season-h-end" type="date" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Ship start (optional)</span>
              <input class="admin-input-styled" id="new-season-s-start" type="date" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Ship end (optional)</span>
              <input class="admin-input-styled" id="new-season-s-end" type="date" />
            </label>
            <label class="form-field form-field--wide">
              <span class="form-field-label">Notes</span>
              <textarea class="admin-input-styled" id="new-season-notes" rows="2" placeholder="Expedition name, importer, anything relevant"></textarea>
            </label>
          </div>
          <p class="form-field-help">Re-saving the same country + region + label overwrites the window — no duplicates on the calendar.</p>
        `,
        primaryLabel: 'Save window',
        onPrimary: async (close) => {
          const get = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value?.trim();
          const origin = get('new-season-origin');
          const label = get('new-season-label');
          const hStart = get('new-season-h-start');
          const hEnd = get('new-season-h-end');
          if (!origin || !label || !hStart || !hEnd) {
            toast('Origin, label, harvest start and harvest end are required', 'error');
            return;
          }
          const res = await adminFetch('/api/admin/sourcing/seasons', {
            method: 'POST', json: {
              origin_country: origin,
              region: get('new-season-region') || undefined,
              season_label: label,
              harvest_start: hStart,
              harvest_end: hEnd,
              ship_start: get('new-season-s-start') || undefined,
              ship_end: get('new-season-s-end') || undefined,
              notes: get('new-season-notes') || undefined,
            },
          });
          if (!res.success) { toast('Could not save window', 'error'); return; }
          toast(`Window "${label}" saved`, 'success');
          close();
          await loadSeasons();
        },
      });
    });

    // -------------------------------------------------------------------------
    // Roast plan tab — read-only feed from /roast-batches
    // -------------------------------------------------------------------------
    interface RoastBatch {
      id: string;
      lot_name: string;
      green_kg_in: number;
      roasted_kg_out: number;
      roast_loss_percent: number;
      roaster_profile?: string | null;
      created_at: string;
    }

    async function loadRoasts(): Promise<void> {
      const res = await adminFetch<{ batches?: RoastBatch[] }>('/api/admin/roast-batches');
      if (!res.success) { roastsBody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">Could not load batches</div><div class="empty-state-body">${esc(res.error || '')}</div></div></td></tr>`; return; }
      const batches = res.batches || [];
      if (!batches.length) {
        roastsBody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">No roast batches yet</div><div class="empty-state-body">Once you log a batch via the Batch Roaster &amp; Loss Log it'll appear here. Pair the lot name with a Sourcing lot for forward planning.</div></div></td></tr>`;
        return;
      }
      roastsBody.innerHTML = batches.map((b) => {
        const matched = lots.find((l) => l.lot_code === b.lot_name || l.id === b.lot_name);
        return `
          <tr>
            <td data-label="Batch"><strong>${esc(b.lot_name)}</strong></td>
            <td data-label="Lot">${matched ? `<span class="sourcing-product-pill">${esc(matched.lot_code)}</span>` : '—'}</td>
            <td data-label="Green in">${(Number(b.green_kg_in) || 0).toFixed(1)} kg</td>
            <td data-label="Roasted out">${(Number(b.roasted_kg_out) || 0).toFixed(1)} kg</td>
            <td data-label="Loss %">${(Number(b.roast_loss_percent) || 0).toFixed(2)}%</td>
            <td data-label="Profile">${esc(b.roaster_profile || '—')}</td>
            <td data-label="Logged">${esc(fmtDate(b.created_at))}</td>
          </tr>`;
      }).join('');
    }

    // -------------------------------------------------------------------------
    // Boot
    // -------------------------------------------------------------------------
    void (async () => {
      await loadLots();
      await Promise.all([loadSeasons(), loadRoasts()]);
    })();
  },
};

export default route;
