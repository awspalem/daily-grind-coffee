import { adminFetch, esc, triggerHaptic, toast, confirmModal } from './shared';
import { requireRole } from '../components/actor';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-subscriptions">
    <div class="panel-header">
      <h2 class="panel-title">Subscribe &amp; Save Subscriptions</h2>
      <p class="panel-subtitle">Pause, resume, skip a delivery or cancel on a customer's behalf. Every action is written to the audit log and the subscription's event history.</p>
    </div>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Customer</th><th>Coffee</th><th>Frequency</th><th>Next Renewal</th><th>Status</th><th>Payment Method</th><th>Actions</th></tr></thead>
        <tbody id="subscriptions-table-body"><tr><td colspan="7" style="text-align:center; color:var(--text-muted);">Loading…</td></tr></tbody>
      </table>
    </div>
  </section>
`;

const STATUS_BADGE_CLASS: Record<string, string> = { ACTIVE: 'paid', PREPAID: 'paid', PAUSED: 'shipped', CANCELLED: 'low-stock', PAST_DUE: 'low-stock' };

type Sub = {
  id: string;
  customer_email: string;
  product_name: string;
  grind_type: string | null;
  frequency: string | null;
  quantity: number;
  status: string;
  next_renewal_date: string | null;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
};

function actionsFor(s: Sub): string {
  if (s.status === 'CANCELLED') return '<span style="color:var(--text-muted);">—</span>';
  const btns: string[] = [];
  if (s.status === 'PAUSED') {
    btns.push(`<button class="btn-table-action" data-sub-action="resume" data-sub-id="${esc(s.id)}">Resume</button>`);
  } else {
    btns.push(`<button class="btn-table-action" data-sub-action="pause" data-sub-id="${esc(s.id)}">Pause</button>`);
    btns.push(`<button class="btn-table-action" data-sub-action="skip" data-sub-id="${esc(s.id)}">Skip next</button>`);
  }
  btns.push(`<button class="btn-table-action danger" data-sub-action="cancel" data-sub-id="${esc(s.id)}">Cancel</button>`);
  return `<div style="display:flex; flex-wrap:wrap; gap:0.35rem;">${btns.join('')}</div>`;
}

const CONFIRM: Record<string, { title: string; body: string; confirmLabel: string; danger?: boolean }> = {
  pause: { title: 'Pause this subscription?', body: 'Nothing will be charged or shipped until it is resumed. The customer is not notified automatically.', confirmLabel: 'Pause' },
  resume: { title: 'Resume this subscription?', body: 'The next renewal date is pushed to a full cycle from today so the customer is not billed immediately.', confirmLabel: 'Resume' },
  skip: { title: 'Skip the next delivery?', body: 'The next renewal date moves forward one cycle. One delivery is skipped; the subscription otherwise continues.', confirmLabel: 'Skip delivery' },
  cancel: { title: 'Cancel this subscription?', body: 'This stops all future renewals. Plan perks already granted stay spendable until their term lapses. This cannot be undone from here.', confirmLabel: 'Cancel subscription', danger: true },
};

const route: RouteModule = {
  async mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('subscriptions-table-body')!;

    const load = async () => {
      const data = await adminFetch<{ subscriptions: Sub[] }>('/api/admin/subscriptions');
      if (!data.success) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">Could not load subscriptions: ${esc(data.error || 'Unknown error')}</td></tr>`;
        return;
      }
      const subs = data.subscriptions || [];
      if (subs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No subscriptions yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = subs.map((s) => `
        <tr>
          <td data-label="Customer">${esc(s.customer_email)}</td>
          <td data-label="Coffee">${esc(s.product_name)} <span style="color:var(--text-muted);">(${esc((s.grind_type || '').replace(/_/g, ' '))} × ${s.quantity})</span></td>
          <td data-label="Frequency">${esc((s.frequency || '').replace(/_/g, ' '))}</td>
          <td data-label="Next Renewal">${s.next_renewal_date ? new Date(s.next_renewal_date).toLocaleDateString() : '—'}</td>
          <td data-label="Status"><span class="status-badge ${STATUS_BADGE_CLASS[s.status] || 'shipped'}">${esc(s.status)}</span></td>
          <td data-label="Payment Method">${s.stripe_customer_id && s.stripe_payment_method_id ? 'On file' : 'None saved'}</td>
          <td data-label="Actions">${actionsFor(s)}</td>
        </tr>
      `).join('');
    };

    tbody.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-sub-action]') as HTMLButtonElement | null;
      if (!btn) return;
      const action = btn.dataset.subAction!;
      const id = btn.dataset.subId!;
      const meta = CONFIRM[action];
      if (!meta) return;
      if (!requireRole(['ADMIN', 'SUPPORT'], 'Managing subscriptions')) return;

      const ok = await confirmModal({ title: meta.title, body: meta.body, confirmLabel: meta.confirmLabel, danger: meta.danger });
      if (!ok) return;

      let body: { reason?: string } | undefined;
      if (action === 'cancel') {
        const reason = window.prompt('Reason for cancelling (optional, shown in the audit log):') ?? '';
        body = { reason };
      }

      triggerHaptic();
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Working…';
      const res = await adminFetch<{ message?: string; error?: string }>(
        `/api/admin/subscriptions/${encodeURIComponent(id)}/${action}`,
        { method: 'POST', json: body },
      );
      btn.disabled = false;
      btn.textContent = original;

      if (res.success) {
        toast(res.message || 'Done', 'success');
        await load();
      } else {
        toast(`Could not ${action} subscription: ${res.error || 'Unknown error'}`, 'error');
      }
    });

    await load();
  },
};

export default route;
