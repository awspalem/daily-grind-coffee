import { adminFetch, esc, triggerHaptic, toast, openInlineModal } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-coupons">
    <div class="panel-header">
      <h2 class="panel-title">Promotional Coupons &amp; Campaigns</h2>
      <button class="btn-primary" id="btn-add-coupon">+ Create New Promo Code</button>
    </div>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Coupon Code</th><th>Discount</th><th>Redemptions</th><th>Max Uses</th><th>Status</th></tr></thead>
        <tbody id="coupons-table-body"><tr><td colspan="5"><div class="skeleton skeleton-row"></div></td></tr></tbody>
      </table>
    </div>
  </section>
`;

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('coupons-table-body')!;

    const render = (coupons: any[]) => {
      if (!coupons.length) {
        tbody.innerHTML = `<tr><td colspan="5">
          <div class="empty-state">
            <div class="empty-state-title">No promo codes yet</div>
            <div class="empty-state-body">Create a code above — e.g. <code>MONSOON20</code> for 20% off the first order.</div>
          </div>
        </td></tr>`;
        return;
      }
      tbody.innerHTML = coupons.map((cp) => `
        <tr>
          <td data-label="Coupon Code"><strong>${esc(cp.code)}</strong></td>
          <td data-label="Discount">${cp.discount_type === 'PERCENT' ? `${cp.discount_value}% Off Entire Order` : `₹${(cp.discount_value / 100).toFixed(2)} Off`}</td>
          <td data-label="Redemptions">${cp.times_used} uses</td>
          <td data-label="Max Uses">${cp.max_uses ?? '∞'} max</td>
          <td data-label="Status"><span class="status-badge ${cp.is_active ? 'paid' : 'low-stock'}">${cp.is_active ? 'Active' : 'Inactive'}</span></td>
        </tr>
      `).join('');
    };

    const load = async () => {
      const data = await adminFetch<{ coupons: any[] }>('/api/admin/coupons');
      render(data.coupons || []);
    };
    void load();

    document.getElementById('btn-add-coupon')?.addEventListener('click', () => {
      triggerHaptic();
      openInlineModal({
        title: 'New promo code',
        bodyHtml: `
          <div class="form-grid">
            <label class="form-field form-field--wide">
              <span class="form-field-label">Coupon code</span>
              <input class="admin-input-styled" id="new-coupon-code" value="MONSOON20" autocomplete="off" />
              <span class="form-field-help">Uppercase letters and digits only — what the customer types at checkout.</span>
            </label>
            <label class="form-field form-field--wide">
              <span class="form-field-label">Discount (%)</span>
              <input class="admin-input-styled" id="new-coupon-discount" type="number" min="1" max="90" value="20" />
            </label>
          </div>
        `,
        primaryLabel: 'Create coupon',
        onPrimary: async (close) => {
          const codeEl = document.getElementById('new-coupon-code') as HTMLInputElement;
          const valueEl = document.getElementById('new-coupon-discount') as HTMLInputElement;
          const code = (codeEl?.value || '').trim().toUpperCase();
          const value = Number(valueEl?.value);
          if (!code) { toast('Code is required', 'error'); return; }
          if (!Number.isFinite(value) || value <= 0) { toast('Discount must be a positive number', 'error'); return; }
          const result = await adminFetch<{ error?: string }>('/api/admin/coupons', {
            method: 'POST',
            json: { code, discount_type: 'PERCENT', discount_value: value },
          });
          if (!result.success) { toast(result.error || 'Could not create coupon', 'error'); return; }
          toast(`Coupon "${code}" created`, 'success');
          close();
          await load();
        },
      });
    });
  },
};

export default route;
