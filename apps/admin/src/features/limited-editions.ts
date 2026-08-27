import { adminFetch, esc, triggerHaptic, toast, openInlineModal } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-limited-editions">
    <div class="panel-header">
      <h2 class="panel-title">Limited Editions</h2>
      <button class="btn-primary" id="btn-add-limited-edition">+ Plan Drop</button>
    </div>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Drop</th><th>Product</th><th>Launch Window</th><th>Units Sold</th><th>Status</th></tr></thead>
        <tbody id="limited-editions-table-body"><tr><td colspan="5"><div class="skeleton skeleton-row"></div></td></tr></tbody>
      </table>
    </div>
  </section>
`;

const STATUS_BADGE_CLASS: Record<string, string> = { UPCOMING: 'shipped', LIVE: 'paid', SOLD_OUT: 'low-stock', ENDED: 'roasting' };
const CYCLE: Record<string, string> = { UPCOMING: 'LIVE', LIVE: 'SOLD_OUT', SOLD_OUT: 'ENDED', ENDED: 'UPCOMING' };

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('limited-editions-table-body')!;

    const render = (editions: any[]) => {
      if (!editions.length) {
        tbody.innerHTML = `<tr><td colspan="5">
          <div class="empty-state">
            <div class="empty-state-title">No drops planned</div>
            <div class="empty-state-body">Plan a limited drop above — e.g. "Monsoon Malabar Reserve Cask". Lifecycle is UPCOMING → LIVE → SOLD_OUT → ENDED.</div>
          </div>
        </td></tr>`;
        return;
      }
      tbody.innerHTML = editions.map((ed) => `
        <tr>
          <td data-label="Drop"><strong>${esc(ed.name)}</strong></td>
          <td data-label="Product">${esc(ed.product_name || '—')}</td>
          <td data-label="Launch Window">${ed.launch_date || '—'} → ${ed.end_date || '—'}</td>
          <td data-label="Units Sold">${ed.units_sold}${ed.total_units ? ` / ${ed.total_units}` : ''}</td>
          <td data-label="Status"><button class="status-badge ${STATUS_BADGE_CLASS[ed.status] || 'shipped'}" style="border: none; cursor: pointer;" data-edition-id="${ed.id}" data-current-status="${ed.status}">${ed.status}</button></td>
        </tr>
      `).join('');
    };

    const load = async () => {
      const data = await adminFetch<{ limited_editions: any[] }>('/api/admin/limited-editions');
      render(data.limited_editions || []);
    };
    void load();

    tbody.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-edition-id]') as HTMLElement | null;
      if (!btn) return;
      triggerHaptic();
      const nextStatus = CYCLE[btn.dataset.currentStatus || 'UPCOMING'];
      const result = await adminFetch<{ error?: string }>(`/api/admin/limited-editions/${btn.dataset.editionId}/status`, {
        method: 'PATCH', json: { status: nextStatus },
      });
      if (!result.success) { toast(result.error || 'Could not update status', 'error'); return; }
      await load();
    });

    document.getElementById('btn-add-limited-edition')?.addEventListener('click', () => {
      triggerHaptic();
      openInlineModal({
        title: 'New limited edition',
        bodyHtml: `
          <div class="form-grid">
            <label class="form-field form-field--wide">
              <span class="form-field-label">Name</span>
              <input class="admin-input-styled" id="new-edition-name" placeholder="Monsoon Malabar Reserve Cask" />
            </label>
            <label class="form-field form-field--wide">
              <span class="form-field-label">Product / lot (optional)</span>
              <input class="admin-input-styled" id="new-edition-product" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Total units</span>
              <input class="admin-input-styled" id="new-edition-units" type="number" min="1" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Launch date</span>
              <input class="admin-input-styled" id="new-edition-launch" type="date" />
            </label>
            <label class="form-field">
              <span class="form-field-label">End date</span>
              <input class="admin-input-styled" id="new-edition-end" type="date" />
            </label>
          </div>
        `,
        primaryLabel: 'Create drop',
        onPrimary: async (close) => {
          const name = ((document.getElementById('new-edition-name') as HTMLInputElement)?.value || '').trim();
          if (!name) { toast('Name is required', 'error'); return; }
          const productName = ((document.getElementById('new-edition-product') as HTMLInputElement)?.value || '').trim();
          const totalUnits = (document.getElementById('new-edition-units') as HTMLInputElement)?.value;
          const launchDate = (document.getElementById('new-edition-launch') as HTMLInputElement)?.value;
          const endDate = (document.getElementById('new-edition-end') as HTMLInputElement)?.value;
          const result = await adminFetch<{ error?: string }>('/api/admin/limited-editions', {
            method: 'POST',
            json: {
              name,
              product_name: productName || undefined,
              total_units: totalUnits ? Number(totalUnits) : undefined,
              launch_date: launchDate || undefined,
              end_date: endDate || undefined,
            },
          });
          if (!result.success) { toast(result.error || 'Could not add limited edition', 'error'); return; }
          toast(`Drop "${name}" created`, 'success');
          close();
          await load();
        },
      });
    });
  },
};

export default route;
