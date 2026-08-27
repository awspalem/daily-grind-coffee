import { adminFetch, esc, triggerHaptic } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-promotions">
    <div class="panel-header">
      <h2 class="panel-title">Sales &amp; Promotions</h2>
      <button class="btn-table-action" id="btn-add-promotion">+ Plan Promotion</button>
    </div>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Promotion</th><th>Type</th><th>Dates</th><th>Status</th></tr></thead>
        <tbody id="promotions-table-body"><tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Loading…</td></tr></tbody>
      </table>
    </div>
  </section>
`;

const STATUS_BADGE_CLASS: Record<string, string> = { SCHEDULED: 'shipped', ACTIVE: 'paid', ENDED: 'roasting' };
const CYCLE: Record<string, string> = { SCHEDULED: 'ACTIVE', ACTIVE: 'ENDED', ENDED: 'SCHEDULED' };

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('promotions-table-body')!;

    const render = (promotions: any[]) => {
      tbody.innerHTML = promotions.map((promo) => `
        <tr>
          <td data-label="Promotion"><strong>${esc(promo.name)}</strong></td>
          <td data-label="Type">${esc(promo.promo_type)}</td>
          <td data-label="Dates">${promo.start_date || '—'} → ${promo.end_date || '—'}</td>
          <td data-label="Status"><button class="status-badge ${STATUS_BADGE_CLASS[promo.status] || 'shipped'}" style="border: none; cursor: pointer;" data-promotion-id="${promo.id}" data-current-status="${promo.status}">${promo.status}</button></td>
        </tr>
      `).join('');
    };

    const load = async () => {
      const data = await adminFetch<{ promotions: any[] }>('/api/admin/promotions');
      render(data.promotions || []);
    };
    load();

    tbody.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-promotion-id]') as HTMLElement | null;
      if (!btn) return;
      triggerHaptic();
      const nextStatus = CYCLE[btn.dataset.currentStatus || 'SCHEDULED'];
      const result = await adminFetch<{ error?: string }>(`/api/admin/promotions/${btn.dataset.promotionId}/status`, {
        method: 'PATCH', json: { status: nextStatus },
      });
      if (result.success) await load();
    });

    document.getElementById('btn-add-promotion')?.addEventListener('click', async () => {
      triggerHaptic();
      const name = prompt('Promotion name (e.g. Bangalore Launch Week Sale):');
      if (!name) return;
      const promoType = prompt('Promo type (SALE, BUNDLE, SEASONAL, CLEARANCE):', 'SALE') || 'SALE';
      const startDate = prompt('Start date (YYYY-MM-DD, optional):', '') || undefined;
      const endDate = prompt('End date (YYYY-MM-DD, optional):', '') || undefined;

      const result = await adminFetch<{ error?: string }>('/api/admin/promotions', {
        method: 'POST', json: { name, promo_type: promoType.toUpperCase(), start_date: startDate, end_date: endDate },
      });

      if (result.success) {
        await load();
      } else {
        alert(`Could not add promotion: ${result.error || 'Unknown error'}`);
      }
    });
  },
};

export default route;
