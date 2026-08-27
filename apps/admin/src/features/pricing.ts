import { adminFetch, esc, triggerHaptic } from './shared';
import type { RouteModule } from '../router';

interface PricingItem {
  product_id: string;
  product_name: string;
  variant_id: string;
  sku: string;
  weight_grams: number;
  price_cents: number;
  available_stock: number;
}

// INR is display-only — the DB's source of truth is price_cents (USD), and this app has no
// live FX feed, so every screen that shows an INR figure (storefront cart, this table) derives
// it from price_cents with the same fixed factor for consistency. Discount % has no backing
// column anywhere in the schema (checkout never reads it) — it's still editable here and still
// sent to the audit log on save, but it does not change what a customer is charged.
const CENTS_TO_INR = 0.23;

const PANEL_HTML = `
  <section class="section-panel" id="panel-pricing">
    <div class="panel-header">
      <div>
        <h2 class="panel-title">Catalog Pricing &amp; Discount Control Center</h2>
        <span style="font-size: 0.85rem; color: var(--text-muted);">Manage INR (₹), USD ($), and active promotional discounts per variant</span>
      </div>
      <span style="background: var(--accent-bg); color: var(--accent); padding: 0.3rem 0.8rem; border-radius: var(--radius-pill); font-size: 0.8rem; font-weight:700;">
        Live Cloudflare D1 Persisted
      </span>
    </div>

    <div style="padding: 1.5rem; overflow-x: auto;">
      <table class="data-table" id="pricing-manager-table">
        <thead>
          <tr><th>Coffee Lot</th><th>Bag Size</th><th>Price (₹ INR)</th><th>Price ($ USD)</th><th>Promotional Discount %</th><th>Net Price Preview</th><th>Action</th></tr>
        </thead>
        <tbody id="pricing-table-body">
          <tr><td colspan="7" style="text-align:center; color:var(--text-muted);">Loading current prices…</td></tr>
        </tbody>
      </table>
    </div>
  </section>
`;

const route: RouteModule = {
  async mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('pricing-table-body')!;

    const data = await adminFetch<{ items: PricingItem[] }>('/api/admin/pricing');
    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--rose);">Could not load pricing: ${esc(data.error || 'Unknown error')}</td></tr>`;
      return;
    }

    const items = data.items || [];
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No active products yet — add one in Product Catalog first.</td></tr>`;
      return;
    }

    // Local edit buffer, seeded from the live GET — discount starts at 0 since nothing persists
    // it between visits.
    const rows = items.map((item) => ({ ...item, discount_percent: 0 }));

    const render = () => {
      tbody.innerHTML = rows.map((item, idx) => {
        const priceInr = Math.round(item.price_cents * CENTS_TO_INR);
        const netInr = Math.round(priceInr * (1 - item.discount_percent / 100));
        const netUsd = ((item.price_cents * (1 - item.discount_percent / 100)) / 100).toFixed(2);

        return `
          <tr>
            <td data-label="Coffee Lot"><strong>${esc(item.product_name)}</strong><br><span style="color:var(--text-muted); font-size:0.78rem;">${esc(item.sku)}</span></td>
            <td data-label="Bag Size"><span class="status-badge paid">${item.weight_grams >= 1000 ? `${item.weight_grams / 1000}kg` : `${item.weight_grams}g`}</span></td>
            <td data-label="Price (₹ INR)"><input type="number" id="inr-${idx}" value="${priceInr}" step="10" class="admin-input-styled" style="width: 100px;"></td>
            <td data-label="Price ($ USD)"><input type="number" id="usd-${idx}" value="${(item.price_cents / 100).toFixed(2)}" step="0.5" class="admin-input-styled" style="width: 90px;"></td>
            <td data-label="Discount %"><input type="number" id="disc-${idx}" value="${item.discount_percent}" min="0" max="90" step="5" class="admin-input-styled" style="width: 80px; color: var(--accent); font-weight:700;"> %</td>
            <td data-label="Net Preview" id="preview-${idx}"><strong>₹${netInr}</strong> <span style="color:var(--text-muted); font-size:0.85rem;">($${netUsd})</span></td>
            <td data-label="Action"><button class="btn-table-action" data-idx="${idx}" style="min-height: 42px;">Save Pricing</button></td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.btn-table-action').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const target = e.currentTarget as HTMLElement;
          const idx = parseInt(target.getAttribute('data-idx') || '0', 10);
          const item = rows[idx];

          const inrInput = document.getElementById(`inr-${idx}`) as HTMLInputElement;
          const usdInput = document.getElementById(`usd-${idx}`) as HTMLInputElement;
          const discInput = document.getElementById(`disc-${idx}`) as HTMLInputElement;

          const priceInr = parseFloat(inrInput.value);
          item.price_cents = Math.round(parseFloat(usdInput.value) * 100);
          item.discount_percent = parseInt(discInput.value, 10);

          const netInr = Math.round(priceInr * (1 - item.discount_percent / 100));
          const netUsd = ((item.price_cents * (1 - item.discount_percent / 100)) / 100).toFixed(2);

          const previewEl = document.getElementById(`preview-${idx}`);
          if (previewEl) {
            previewEl.innerHTML = `<strong>₹${netInr}</strong> <span style="color:var(--text-muted); font-size:0.8rem;">($${netUsd})</span>`;
          }

          triggerHaptic();
          const result = await adminFetch<{ error?: string }>(`/api/admin/variants/${item.variant_id}/pricing`, {
            method: 'PUT',
            json: { price_inr: priceInr, price_usd_cents: item.price_cents, discount_percent: item.discount_percent },
          });

          if (result.success) {
            target.textContent = 'Saved';
            target.style.background = 'var(--emerald)';
            target.style.color = '#fff';
          } else {
            target.textContent = 'Failed — retry';
            target.style.background = 'var(--rose)';
            target.style.color = '#fff';
          }
          setTimeout(() => {
            target.textContent = 'Save Pricing';
            target.style.background = '';
            target.style.color = '';
          }, 1500);
        });
      });
    };

    render();
  },
};

export default route;
