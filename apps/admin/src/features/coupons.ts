import { adminFetch, esc, triggerHaptic } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-coupons">
    <div class="panel-header">
      <h2 class="panel-title">Promotional Coupons &amp; Campaigns</h2>
      <button class="btn-table-action" id="btn-add-coupon">+ Create New Promo Code</button>
    </div>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Coupon Code</th><th>Discount</th><th>Redemptions</th><th>Max Uses</th><th>Status</th></tr></thead>
        <tbody id="coupons-table-body"></tbody>
      </table>
    </div>
  </section>
`;

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('coupons-table-body')!;

    const render = (coupons: any[]) => {
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
    load();

    document.getElementById('btn-add-coupon')?.addEventListener('click', async () => {
      triggerHaptic();
      const code = prompt('Enter new Promo Coupon Code (e.g. MONSOON20):', 'MONSOON20');
      if (!code) return;
      const discount = prompt('Enter Discount Percentage (e.g. 20):', '20');
      if (!discount) return;

      const result = await adminFetch<{ error?: string }>('/api/admin/coupons', {
        method: 'POST',
        json: { code: code.toUpperCase(), discount_type: 'PERCENT', discount_value: Number(discount) },
      });

      if (result.success) {
        await load();
        alert(`Coupon code "${code.toUpperCase()}" with ${discount}% discount created successfully!`);
      } else {
        alert(`Could not create coupon: ${result.error || 'Unknown error'}`);
      }
    });
  },
};

export default route;
