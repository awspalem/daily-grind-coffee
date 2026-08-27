import { adminFetch, esc, triggerHaptic, toast, openInlineModal } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-campaigns">
    <div class="panel-header">
      <h2 class="panel-title">Social Media Campaigns</h2>
      <button class="btn-primary" id="btn-add-campaign">+ Plan Campaign</button>
    </div>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Campaign</th><th>Objective</th><th>Dates</th><th>Status</th></tr></thead>
        <tbody id="campaigns-table-body"><tr><td colspan="4"><div class="skeleton skeleton-row"></div></td></tr></tbody>
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
      if (!campaigns.length) {
        tbody.innerHTML = `<tr><td colspan="4">
          <div class="empty-state">
            <div class="empty-state-title">No campaigns yet</div>
            <div class="empty-state-body">Plan a campaign above — e.g. "Diwali Gifting Push" — and cycle it through DRAFT → SCHEDULED → LIVE → COMPLETED.</div>
          </div>
        </td></tr>`;
        return;
      }
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
    void load();

    tbody.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-campaign-id]') as HTMLElement | null;
      if (!btn) return;
      triggerHaptic();
      const nextStatus = CYCLE[btn.dataset.currentStatus || 'DRAFT'];
      const result = await adminFetch<{ error?: string }>(`/api/admin/campaigns/${btn.dataset.campaignId}/status`, {
        method: 'PATCH', json: { status: nextStatus },
      });
      if (!result.success) { toast(result.error || 'Could not update status', 'error'); return; }
      await load();
    });

    document.getElementById('btn-add-campaign')?.addEventListener('click', () => {
      triggerHaptic();
      openInlineModal({
        title: 'New campaign',
        bodyHtml: `
          <div class="form-grid">
            <label class="form-field form-field--wide">
              <span class="form-field-label">Name</span>
              <input class="admin-input-styled" id="new-campaign-name" placeholder="Diwali Gifting Push" />
            </label>
            <label class="form-field form-field--wide">
              <span class="form-field-label">Objective (optional)</span>
              <input class="admin-input-styled" id="new-campaign-objective" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Start date</span>
              <input class="admin-input-styled" id="new-campaign-start" type="date" />
            </label>
            <label class="form-field">
              <span class="form-field-label">End date</span>
              <input class="admin-input-styled" id="new-campaign-end" type="date" />
            </label>
          </div>
        `,
        primaryLabel: 'Create campaign',
        onPrimary: async (close) => {
          const name = ((document.getElementById('new-campaign-name') as HTMLInputElement)?.value || '').trim();
          if (!name) { toast('Name is required', 'error'); return; }
          const objective = ((document.getElementById('new-campaign-objective') as HTMLInputElement)?.value || '').trim();
          const startDate = (document.getElementById('new-campaign-start') as HTMLInputElement)?.value || undefined;
          const endDate = (document.getElementById('new-campaign-end') as HTMLInputElement)?.value || undefined;
          const result = await adminFetch<{ error?: string }>('/api/admin/campaigns', {
            method: 'POST',
            json: { name, objective: objective || undefined, start_date: startDate, end_date: endDate, status: 'DRAFT' },
          });
          if (!result.success) { toast(result.error || 'Could not add campaign', 'error'); return; }
          toast(`Campaign "${name}" created`, 'success');
          close();
          await load();
        },
      });
    });
  },
};

export default route;
