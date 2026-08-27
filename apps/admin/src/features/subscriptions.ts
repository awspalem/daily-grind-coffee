import { adminFetch, esc } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-subscriptions">
    <div class="panel-header"><h2 class="panel-title">Subscribe &amp; Save Subscriptions</h2></div>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Customer</th><th>Coffee</th><th>Frequency</th><th>Next Renewal</th><th>Status</th><th>Payment Method</th></tr></thead>
        <tbody id="subscriptions-table-body"><tr><td colspan="6" style="text-align:center; color:var(--text-muted);">Loading…</td></tr></tbody>
      </table>
    </div>
  </section>
`;

const STATUS_BADGE_CLASS: Record<string, string> = { ACTIVE: 'paid', PAUSED: 'shipped', CANCELLED: 'low-stock', PAST_DUE: 'low-stock' };

const route: RouteModule = {
  async mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('subscriptions-table-body')!;

    const data = await adminFetch<{ subscriptions: any[] }>('/api/admin/subscriptions');
    const subs = data.subscriptions || [];

    if (subs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No subscriptions yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = subs.map((s) => `
      <tr>
        <td data-label="Customer">${esc(s.customer_email)}</td>
        <td data-label="Coffee">${esc(s.product_name)} <span style="color:var(--text-muted);">(${esc((s.grind_type || '').replace(/_/g, ' '))} × ${s.quantity})</span></td>
        <td data-label="Frequency">${esc((s.frequency || '').replace(/_/g, ' '))}</td>
        <td data-label="Next Renewal">${s.next_renewal_date ? new Date(s.next_renewal_date).toLocaleDateString() : '—'}</td>
        <td data-label="Status"><span class="status-badge ${STATUS_BADGE_CLASS[s.status] || 'shipped'}">${s.status}</span></td>
        <td data-label="Payment Method">${s.stripe_customer_id && s.stripe_payment_method_id ? 'On file' : 'None saved'}</td>
      </tr>
    `).join('');
  },
};

export default route;
