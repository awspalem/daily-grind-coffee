import { adminFetch, esc, triggerHaptic, toast } from './shared';
import { skeletonTableRow, emptyStateHtml } from '../components/ui';
import { requireRole } from '../components/actor';
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

// Green-bean cost in INR per kg, used to surface a margin estimate so the
// operator can sanity-check price edits before they ship. The number below
// is the FSSAI-friendly blended green-kg cost reported in unit-economics.ts;
// if the source moves this should follow.
const GREEN_COST_INR_PER_KG = 850;
const ROAST_LOSS_FACTOR = 0.84;

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
          <tr><th>Coffee Lot</th><th>Bag Size</th><th>Price (₹ INR)</th><th>Price ($ USD)</th><th>Promotional Discount %</th><th>Net Price Preview</th><th>Margin Preview</th><th>Action</th></tr>
        </thead>
        <tbody id="pricing-table-body"></tbody>
      </table>
    </div>
  </section>
`;

const PRICING_COL_WIDTHS = [180, 70, 100, 100, 80, 130, 100, 110];

function marginPreviewInr(priceCents: number, weightGrams: number, discountPercent: number): { inr: number; pct: number } {
  if (!weightGrams || !priceCents) return { inr: 0, pct: 0 };
  const grossInr = Math.round(priceCents * CENTS_TO_INR);
  const netInr = Math.round(grossInr * (1 - discountPercent / 100));
  const greenCostForBag = Math.round((weightGrams / 1000) * GREEN_COST_INR_PER_KG / ROAST_LOSS_FACTOR);
  const marginInr = netInr - greenCostForBag;
  const marginPct = netInr > 0 ? Math.round((marginInr / netInr) * 100) : 0;
  return { inr: marginInr, pct: marginPct };
}

const route: RouteModule = {
  async mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('pricing-table-body')!;
    tbody.innerHTML = Array.from({ length: 5 }, () => skeletonTableRow(PRICING_COL_WIDTHS)).join('');

    const data = await adminFetch<{ items: PricingItem[] }>('/api/admin/pricing');
    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="8">${emptyStateHtml({ title: 'Could not load pricing', body: data.error || 'Unknown error', action: { label: 'Retry', id: 'pricing-retry' } })}</td></tr>`;
      document.getElementById('pricing-retry')?.addEventListener('click', () => { void route.mount(container); });
      return;
    }

    const items = data.items || [];
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8">${emptyStateHtml({ title: 'No active products', body: 'Add one in Product Catalog first, then come back here to set prices.' })}</td></tr>`;
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
        const margin = marginPreviewInr(item.price_cents, item.weight_grams, item.discount_percent);
        const marginColor = margin.pct >= 35 ? 'var(--emerald)' : margin.pct >= 15 ? 'var(--amber)' : 'var(--rose)';

        return `
          <tr>
            <td data-label="Coffee Lot"><strong>${esc(item.product_name)}</strong><br><span style="color:var(--text-muted); font-size:0.78rem;">${esc(item.sku)}</span></td>
            <td data-label="Bag Size"><span class="status-badge paid">${item.weight_grams >= 1000 ? `${item.weight_grams / 1000}kg` : `${item.weight_grams}g`}</span></td>
            <td data-label="Price (₹ INR)"><input type="number" id="inr-${idx}" value="${priceInr}" step="10" class="admin-input-styled" style="width: 100px;" aria-label="INR price for ${esc(item.product_name)}"></td>
            <td data-label="Price ($ USD)"><input type="number" id="usd-${idx}" value="${(item.price_cents / 100).toFixed(2)}" step="0.5" class="admin-input-styled" style="width: 90px;" aria-label="USD price for ${esc(item.product_name)}"></td>
            <td data-label="Discount %"><input type="number" id="disc-${idx}" value="${item.discount_percent}" min="0" max="90" step="5" class="admin-input-styled" style="width: 80px; color: var(--accent); font-weight:700;" aria-label="Discount percent for ${esc(item.product_name)}"> %</td>
            <td data-label="Net Preview" id="preview-${idx}"><strong>₹${netInr}</strong> <span style="color:var(--text-muted); font-size:0.85rem;">($${netUsd})</span></td>
            <td data-label="Margin Preview" id="margin-${idx}"><strong style="color:${marginColor};">${margin.pct}%</strong><br><span style="color:var(--text-muted); font-size:0.78rem;">₹${margin.inr} / bag</span></td>
            <td data-label="Action"><button class="btn-table-action" data-idx="${idx}" style="min-height: 42px;">Save Pricing</button></td>
          </tr>
        `;
      }).join('');

      const recompute = (idx: number) => {
        const item = rows[idx];
        const inrInput = document.getElementById(`inr-${idx}`) as HTMLInputElement;
        const usdInput = document.getElementById(`usd-${idx}`) as HTMLInputElement;
        const discInput = document.getElementById(`disc-${idx}`) as HTMLInputElement;
        const priceInr = parseFloat(inrInput.value);
        item.price_cents = Math.round(parseFloat(usdInput.value) * 100);
        item.discount_percent = parseInt(discInput.value, 10) || 0;

        const netInr = Math.round(priceInr * (1 - item.discount_percent / 100));
        const netUsd = ((item.price_cents * (1 - item.discount_percent / 100)) / 100).toFixed(2);
        const margin = marginPreviewInr(item.price_cents, item.weight_grams, item.discount_percent);
        const marginColor = margin.pct >= 35 ? 'var(--emerald)' : margin.pct >= 15 ? 'var(--amber)' : 'var(--rose)';

        const previewEl = document.getElementById(`preview-${idx}`);
        if (previewEl) previewEl.innerHTML = `<strong>₹${netInr}</strong> <span style="color:var(--text-muted); font-size:0.8rem;">($${netUsd})</span>`;
        const marginEl = document.getElementById(`margin-${idx}`);
        if (marginEl) marginEl.innerHTML = `<strong style="color:${marginColor};">${margin.pct}%</strong><br><span style="color:var(--text-muted); font-size:0.78rem;">₹${margin.inr} / bag</span>`;
      };

      ['inr', 'usd', 'disc'].forEach((prefix) => {
        tbody.querySelectorAll<HTMLInputElement>(`input[id^="${prefix}-"]`).forEach((input) => {
          input.addEventListener('input', () => {
            const idx = parseInt(input.id.split('-')[1] || '0', 10);
            recompute(idx);
          });
        });
      });

      tbody.querySelectorAll('.btn-table-action').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          if (!requireRole('ADMIN', 'Saving price changes')) return;
          const target = e.currentTarget as HTMLElement;
          const idx = parseInt(target.getAttribute('data-idx') || '0', 10);
          const item = rows[idx];

          const inrInput = document.getElementById(`inr-${idx}`) as HTMLInputElement;
          const usdInput = document.getElementById(`usd-${idx}`) as HTMLInputElement;
          const discInput = document.getElementById(`disc-${idx}`) as HTMLInputElement;

          const priceInr = parseFloat(inrInput.value);
          const priceUsdCents = Math.round(parseFloat(usdInput.value) * 100);
          const discountPercent = parseInt(discInput.value, 10) || 0;

          if (priceUsdCents <= 0) {
            toast('USD price must be greater than zero', 'error');
            return;
          }
          if (discountPercent < 0 || discountPercent > 90) {
            toast('Discount must be between 0 and 90%', 'error');
            return;
          }

          triggerHaptic();
          const originalText = target.textContent;
          target.setAttribute('disabled', 'true');
          target.textContent = 'Saving…';
          const result = await adminFetch<{ error?: string }>(`/api/admin/variants/${item.variant_id}/pricing`, {
            method: 'PUT',
            json: { price_inr: priceInr, price_usd_cents: priceUsdCents, discount_percent: discountPercent },
          });
          target.removeAttribute('disabled');
          target.textContent = originalText;

          if (result.success) {
            toast(`Price updated for ${item.product_name} — recorded in audit log`, 'success');
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
