import { adminFetch, esc, triggerHaptic } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-channels">
    <div class="panel-header">
      <h2 class="panel-title">Communication Channels</h2>
      <button class="btn-table-action" id="btn-add-channel">+ Add Channel</button>
    </div>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Channel</th><th>Type</th><th>Handle / Address</th><th>Status</th></tr></thead>
        <tbody id="channels-table-body"><tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Loading…</td></tr></tbody>
      </table>
    </div>
  </section>
`;

const STATUS_BADGE_CLASS: Record<string, string> = { ACTIVE: 'paid', INACTIVE: 'low-stock', PLANNED: 'shipped' };

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('channels-table-body')!;

    const render = (channels: any[]) => {
      tbody.innerHTML = channels.map((ch) => `
        <tr>
          <td data-label="Channel"><strong>${esc(ch.name)}</strong></td>
          <td data-label="Type">${esc(ch.channel_type)}</td>
          <td data-label="Handle / Address">${esc(ch.handle_or_address || '—')}</td>
          <td data-label="Status"><span class="status-badge ${STATUS_BADGE_CLASS[ch.status] || 'shipped'}">${ch.status}</span></td>
        </tr>
      `).join('');
    };

    const load = async () => {
      const data = await adminFetch<{ channels: any[] }>('/api/admin/channels');
      render(data.channels || []);
    };
    load();

    document.getElementById('btn-add-channel')?.addEventListener('click', async () => {
      triggerHaptic();
      const name = prompt('Channel name (e.g. Instagram — @dailyroast.in):');
      if (!name) return;
      const channelType = prompt('Channel type (EMAIL, SMS, WHATSAPP, INSTAGRAM, FACEBOOK, OTHER):', 'INSTAGRAM');
      if (!channelType) return;
      const handle = prompt('Handle / address (optional):', '') || undefined;

      const result = await adminFetch<{ error?: string }>('/api/admin/channels', {
        method: 'POST',
        json: { name, channel_type: channelType.toUpperCase(), handle_or_address: handle, status: 'PLANNED' },
      });

      if (result.success) {
        await load();
      } else {
        alert(`Could not add channel: ${result.error || 'Unknown error'}`);
      }
    });
  },
};

export default route;
