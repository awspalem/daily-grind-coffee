import { adminFetch, esc, triggerHaptic, toast, openInlineModal } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-channels">
    <div class="panel-header">
      <h2 class="panel-title">Communication Channels</h2>
      <button class="btn-primary" id="btn-add-channel">+ Add Channel</button>
    </div>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Channel</th><th>Type</th><th>Handle / Address</th><th>Status</th></tr></thead>
        <tbody id="channels-table-body"><tr><td colspan="4"><div class="skeleton skeleton-row"></div></td></tr></tbody>
      </table>
    </div>
  </section>
`;

const STATUS_BADGE_CLASS: Record<string, string> = { ACTIVE: 'paid', INACTIVE: 'low-stock', PLANNED: 'shipped' };
const CHANNEL_TYPES = ['EMAIL', 'SMS', 'WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'OTHER'];

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('channels-table-body')!;

    const render = (channels: any[]) => {
      if (!channels.length) {
        tbody.innerHTML = `<tr><td colspan="4">
          <div class="empty-state">
            <div class="empty-state-title">No channels yet</div>
            <div class="empty-state-body">Add a channel above — email, SMS, WhatsApp, Instagram, or any outreach surface you plan to use.</div>
          </div>
        </td></tr>`;
        return;
      }
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
    void load();

    document.getElementById('btn-add-channel')?.addEventListener('click', () => {
      triggerHaptic();
      const typeOptions = CHANNEL_TYPES
        .map((t) => `<option value="${t}"${t === 'INSTAGRAM' ? ' selected' : ''}>${t}</option>`)
        .join('');
      openInlineModal({
        title: 'New communication channel',
        bodyHtml: `
          <div class="form-grid">
            <label class="form-field form-field--wide">
              <span class="form-field-label">Name</span>
              <input class="admin-input-styled" id="new-channel-name" placeholder="Instagram — @dailyroast.in" />
            </label>
            <label class="form-field">
              <span class="form-field-label">Type</span>
              <select class="admin-input-styled" id="new-channel-type">${typeOptions}</select>
            </label>
            <label class="form-field">
              <span class="form-field-label">Handle / address (optional)</span>
              <input class="admin-input-styled" id="new-channel-handle" placeholder="@dailyroast.in" />
            </label>
          </div>
        `,
        primaryLabel: 'Add channel',
        onPrimary: async (close) => {
          const name = ((document.getElementById('new-channel-name') as HTMLInputElement)?.value || '').trim();
          if (!name) { toast('Name is required', 'error'); return; }
          const channelType = (document.getElementById('new-channel-type') as HTMLSelectElement)?.value || 'OTHER';
          const handle = ((document.getElementById('new-channel-handle') as HTMLInputElement)?.value || '').trim();
          const result = await adminFetch<{ error?: string }>('/api/admin/channels', {
            method: 'POST',
            json: { name, channel_type: channelType, handle_or_address: handle || undefined, status: 'PLANNED' },
          });
          if (!result.success) { toast(result.error || 'Could not add channel', 'error'); return; }
          toast(`Channel "${name}" added`, 'success');
          close();
          await load();
        },
      });
    });
  },
};

export default route;
