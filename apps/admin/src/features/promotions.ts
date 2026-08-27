import { adminFetch, esc, triggerHaptic, toast, openInlineModal } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-promotions">
    <div class="panel-header">
      <h2 class="panel-title">Sales &amp; Promotions</h2>
      <button class="btn-primary" id="btn-add-promotion">+ Plan Promotion</button>
    </div>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Promotion</th><th>Type</th><th>Dates</th><th>Status</th></tr></thead>
        <tbody id="promotions-table-body"><tr><td colspan="4"><div class="skeleton skeleton-row"></div></td></tr></tbody>
      </table>
    </div>
  </section>
`;

const STATUS_BADGE_CLASS: Record<string, string> = { SCHEDULED: 'shipped', ACTIVE: 'paid', ENDED: 'roasting' };
const CYCLE: Record<string, string> = { SCHEDULED: 'ACTIVE', ACTIVE: 'ENDED', ENDED: 'SCHEDULED' };
const PROMO_TYPES = ['SALE', 'BUNDLE', 'SEASONAL', 'CLEARANCE'];

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('promotions-table-body')!;

    const render = (promotions: any[]) => {
      if (!promotions.length) {
        tbody.innerHTML = `<tr><td colspan="4">
          <div class="empty-state">
            <div class="empty-state-title">No promotions yet</div>
            <div class="empty-state-body">Plan a promotion above — e.g. "Bangalore Launch Week Sale". Status cycles SCHEDULED → ACTIVE → ENDED.</div>
          </div>
        </td></tr>`;
        return;
      }
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
    void load();

    tbody.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-promotion-id]') as HTMLElement | null;
      if (!btn) return;
      triggerHaptic();
      const nextStatus = CYCLE[btn.dataset.currentStatus || 'SCHEDULED'];
      const result = await adminFetch<{ error?: string }>(`/api/admin/promotions/${btn.dataset.promotionId}/status`, {
        method: 'PATCH', json: { status: nextStatus },
      });
      if (!result.success) { toast(result.error || 'Could not update status', 'error'); return; }
      await load();
    });

    document.getElementById('btn-add-promotion')?.addEventListener('click', () => {
      triggerHaptic();
      const typeOptions = PROMO_TYPES.map((t) => `<option value="${t}"${t === 'SALE' ? ' selected' : ''}>${t}</option>`).join('');
      openInlineModal({
        title: 'New promotion',
        bodyHtml: `
          <div class="form-grid">
            <label class="form-field form-field--wide">
              <span class="form-field-label">Name</span>
              <input class="admin-input-styled" id="new-promotion-name" placeholder="Bangalore Launch Week Sale" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Type</span>
              <select class="admin-input-styled" id="new-promotion-type">${typeOptions}</select>
            </label>
            <label class="form-field">
              <span class="form-field-label">Start date</span>
              <input class="admin-input-styled" id="new-promotion-start" type="date" />
            </label>
            <label class="form-field">
              <span class="form-field-label">End date</span>
              <input class="admin-input-styled" id="new-promotion-end" type="date" />
            </label>
          </div>
        `,
        primaryLabel: 'Create promotion',
        onPrimary: async (close) => {
          const name = ((document.getElementById('new-promotion-name') as HTMLInputElement)?.value || '').trim();
          if (!name) { toast('Name is required', 'error'); return; }
          const promoType = (document.getElementById('new-promotion-type') as HTMLSelectElement)?.value || 'SALE';
          const startDate = (document.getElementById('new-promotion-start') as HTMLInputElement)?.value || undefined;
          const endDate = (document.getElementById('new-promotion-end') as HTMLInputElement)?.value || undefined;
          const result = await adminFetch<{ error?: string }>('/api/admin/promotions', {
            method: 'POST',
            json: { name, promo_type: promoType, start_date: startDate, end_date: endDate },
          });
          if (!result.success) { toast(result.error || 'Could not add promotion', 'error'); return; }
          toast(`Promotion "${name}" created`, 'success');
          close();
          await load();
        },
      });
    });
  },
};

export default route;
