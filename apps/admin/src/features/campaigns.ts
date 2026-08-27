import { adminFetch, esc, triggerHaptic } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-campaigns">
    <div class="panel-header">
      <h2 class="panel-title">Social Media Campaigns</h2>
      <button class="btn-table-action" id="btn-add-campaign">+ Plan Campaign</button>
    </div>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Campaign</th><th>Objective</th><th>Dates</th><th>Status</th></tr></thead>
        <tbody id="campaigns-table-body"><tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Loading…</td></tr></tbody>
      </table>
    </div>
  </section>
`;

const STATUS_BADGE_CLASS: Record<string, string> = { DRAFT: 'shipped', SCHEDULED: 'shipped', LIVE: 'paid', COMPLETED: 'roasting' };
const CYCLE: Record<string, string> = { DRAFT: 'SCHEDULED', SCHEDULED: 'LIVE', LIVE: 'COMPLETED', COMPLETED: 'DRAFT' };

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('campaigns-table-body')!;

    const render = (campaigns: any[]) => {
      tbody.innerHTML = campaigns.map((camp) => `
        <tr>
          <td data-label="Campaign"><strong>${esc(camp.name)}</strong></td>
          <td data-label="Objective">${esc(camp.objective || '—')}</td>
          <td data-label="Dates">${camp.start_date || '—'} → ${camp.end_date || '—'}</td>
          <td data-label="Status"><button class="status-badge ${STATUS_BADGE_CLASS[camp.status] || 'shipped'}" style="border: none; cursor: pointer;" data-campaign-id="${camp.id}" data-current-status="${camp.status}">${camp.status}</button></td>
        </tr>
      `).join('');
    };

    const load = async () => {
      const data = await adminFetch<{ campaigns: any[] }>('/api/admin/campaigns');
      render(data.campaigns || []);
    };
    load();

    tbody.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-campaign-id]') as HTMLElement | null;
      if (!btn) return;
      triggerHaptic();
      const nextStatus = CYCLE[btn.dataset.currentStatus || 'DRAFT'];
      const result = await adminFetch<{ error?: string }>(`/api/admin/campaigns/${btn.dataset.campaignId}/status`, {
        method: 'PATCH', json: { status: nextStatus },
      });
      if (result.success) await load();
    });

    document.getElementById('btn-add-campaign')?.addEventListener('click', async () => {
      triggerHaptic();
      const name = prompt('Campaign name (e.g. Diwali Gifting Push):');
      if (!name) return;
      const objective = prompt('Objective (optional):', '') || undefined;
      const startDate = prompt('Start date (YYYY-MM-DD, optional):', '') || undefined;
      const endDate = prompt('End date (YYYY-MM-DD, optional):', '') || undefined;

      const result = await adminFetch<{ error?: string }>('/api/admin/campaigns', {
        method: 'POST', json: { name, objective, start_date: startDate, end_date: endDate, status: 'DRAFT' },
      });

      if (result.success) {
        await load();
      } else {
        alert(`Could not add campaign: ${result.error || 'Unknown error'}`);
      }
    });
  },
};

export default route;
