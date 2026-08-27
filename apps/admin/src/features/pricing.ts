import { adminFetch, triggerHaptic } from './shared';
import type { RouteModule } from '../router';

interface PricingRow {
  variant_id: string;
  product_name: string;
  weight_grams: number;
  price_inr: number;
  price_usd_cents: number;
  discount_percent: number;
}

// Pre-existing gap, not fixed here: this seeds from a hardcoded snapshot rather than
// GETting current prices on load — only the PUT-on-save path talks to the API.
const catalogPricing: PricingRow[] = [
  { variant_id: 'var_att_250', product_name: 'Chikmagalur Attikan Estate Honey', weight_grams: 250, price_inr: 450, price_usd_cents: 1850, discount_percent: 0 },
  { variant_id: 'var_att_500', product_name: 'Chikmagalur Attikan Estate Honey', weight_grams: 500, price_inr: 850, price_usd_cents: 3400, discount_percent: 5 },
  { variant_id: 'var_att_1000', product_name: 'Chikmagalur Attikan Estate Honey', weight_grams: 1000, price_inr: 1600, price_usd_cents: 6200, discount_percent: 10 },
  { variant_id: 'var_ara_250', product_name: 'Araku Valley Red Honey Micro-Lot', weight_grams: 250, price_inr: 490, price_usd_cents: 1950, discount_percent: 0 },
  { variant_id: 'var_ara_500', product_name: 'Araku Valley Red Honey Micro-Lot', weight_grams: 500, price_inr: 920, price_usd_cents: 3600, discount_percent: 5 },
  { variant_id: 'var_eth_250', product_name: 'Ethiopia Yirgacheffe Gedeb', weight_grams: 250, price_inr: 580, price_usd_cents: 2200, discount_percent: 0 },
  { variant_id: 'var_eth_500', product_name: 'Ethiopia Yirgacheffe Gedeb', weight_grams: 500, price_inr: 1100, price_usd_cents: 4200, discount_percent: 5 },
  { variant_id: 'var_dawn_250', product_name: 'Dawn Patrol Bangalore Roastery Blend', weight_grams: 250, price_inr: 420, price_usd_cents: 1650, discount_percent: 0 },
  { variant_id: 'var_dawn_500', product_name: 'Dawn Patrol Bangalore Roastery Blend', weight_grams: 500, price_inr: 790, price_usd_cents: 3100, discount_percent: 5 },
  { variant_id: 'var_dawn_1000', product_name: 'Dawn Patrol Bangalore Roastery Blend', weight_grams: 1000, price_inr: 1490, price_usd_cents: 5600, discount_percent: 10 },
  { variant_id: 'var_mid_250', product_name: 'Midnight Runner Dark Espresso', weight_grams: 250, price_inr: 440, price_usd_cents: 1750, discount_percent: 0 },
  { variant_id: 'var_mid_500', product_name: 'Midnight Runner Dark Espresso', weight_grams: 500, price_inr: 820, price_usd_cents: 3300, discount_percent: 5 },
];

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
        <tbody id="pricing-table-body"></tbody>
      </table>
    </div>
  </section>
`;

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('pricing-table-body')!;

    tbody.innerHTML = catalogPricing.map((item, idx) => {
      const netInr = Math.round(item.price_inr * (1 - item.discount_percent / 100));
      const netUsd = ((item.price_usd_cents * (1 - item.discount_percent / 100)) / 100).toFixed(2);

      return `
        <tr>
          <td data-label="Coffee Lot"><strong>${item.product_name}</strong></td>
          <td data-label="Bag Size"><span class="status-badge paid">${item.weight_grams >= 1000 ? `${item.weight_grams / 1000}kg` : `${item.weight_grams}g`}</span></td>
          <td data-label="Price (₹ INR)"><input type="number" id="inr-${idx}" value="${item.price_inr}" step="10" class="admin-input-styled" style="width: 100px;"></td>
          <td data-label="Price ($ USD)"><input type="number" id="usd-${idx}" value="${(item.price_usd_cents / 100).toFixed(2)}" step="0.5" class="admin-input-styled" style="width: 90px;"></td>
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
        const item = catalogPricing[idx];

        const inrInput = document.getElementById(`inr-${idx}`) as HTMLInputElement;
        const usdInput = document.getElementById(`usd-${idx}`) as HTMLInputElement;
        const discInput = document.getElementById(`disc-${idx}`) as HTMLInputElement;

        item.price_inr = parseFloat(inrInput.value);
        item.price_usd_cents = Math.round(parseFloat(usdInput.value) * 100);
        item.discount_percent = parseInt(discInput.value, 10);

        const netInr = Math.round(item.price_inr * (1 - item.discount_percent / 100));
        const netUsd = ((item.price_usd_cents * (1 - item.discount_percent / 100)) / 100).toFixed(2);

        const previewEl = document.getElementById(`preview-${idx}`);
        if (previewEl) {
          previewEl.innerHTML = `<strong>₹${netInr}</strong> <span style="color:var(--text-muted); font-size:0.8rem;">($${netUsd})</span>`;
        }

        triggerHaptic();
        await adminFetch(`/api/admin/variants/${item.variant_id}/pricing`, {
          method: 'PUT',
          json: { price_inr: item.price_inr, price_usd_cents: item.price_usd_cents, discount_percent: item.discount_percent },
        });

        target.textContent = 'Saved';
        target.style.background = 'var(--emerald)';
        target.style.color = '#fff';
        setTimeout(() => {
          target.textContent = 'Save Pricing';
          target.style.background = '';
          target.style.color = '';
        }, 1200);
      });
    });
  },
};

export default route;
