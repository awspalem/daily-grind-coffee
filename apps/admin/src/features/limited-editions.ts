import { adminFetch, esc, triggerHaptic } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-limited-editions">
    <div class="panel-header">
      <h2 class="panel-title">Limited Editions</h2>
      <button class="btn-table-action" id="btn-add-limited-edition">+ Plan Drop</button>
    </div>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Drop</th><th>Product</th><th>Launch Window</th><th>Units Sold</th><th>Status</th></tr></thead>
        <tbody id="limited-editions-table-body"></tbody>
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
    load();

    tbody.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-edition-id]') as HTMLElement | null;
      if (!btn) return;
      triggerHaptic();
      const nextStatus = CYCLE[btn.dataset.currentStatus || 'UPCOMING'];
      const result = await adminFetch<{ error?: string }>(`/api/admin/limited-editions/${btn.dataset.editionId}/status`, {
        method: 'PATCH', json: { status: nextStatus },
      });
      if (result.success) await load();
    });

    document.getElementById('btn-add-limited-edition')?.addEventListener('click', async () => {
      triggerHaptic();
      const name = prompt('Limited edition name (e.g. Monsoon Malabar Reserve Cask):');
      if (!name) return;
      const productName = prompt('Product / lot name (optional):', '') || undefined;
      const totalUnits = prompt('Total units (optional):', '') || undefined;
      const launchDate = prompt('Launch date (YYYY-MM-DD, optional):', '') || undefined;
      const endDate = prompt('End date (YYYY-MM-DD, optional):', '') || undefined;

      const result = await adminFetch<{ error?: string }>('/api/admin/limited-editions', {
        method: 'POST',
        json: { name, product_name: productName, total_units: totalUnits ? Number(totalUnits) : undefined, launch_date: launchDate, end_date: endDate },
      });

      if (result.success) {
        await load();
      } else {
        alert(`Could not add limited edition: ${result.error || 'Unknown error'}`);
      }
    });
  },
};

export default route;
