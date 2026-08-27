import { adminFetch, esc, triggerHaptic } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-inventory">
    <div class="panel-header">
      <div>
        <h2 class="panel-title">Inventory Management</h2>
        <span style="font-size: 0.85rem; color: var(--text-muted);">Live stock levels, manual adjustments, and the movement ledger</span>
      </div>
      <span id="inventory-low-stock-badge" style="background: var(--rose-bg); color: var(--rose); padding: 0.3rem 0.8rem; border-radius: var(--radius-pill); font-size: 0.8rem; font-weight:700; display: none;">
        0 Low Stock
      </span>
    </div>

    <div style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem;">
      <div class="table-responsive">
        <table class="data-table" id="inventory-stock-table">
          <thead>
            <tr><th>Coffee Lot</th><th>SKU</th><th>Available</th><th>Reserved</th><th>Status</th></tr>
          </thead>
          <tbody id="inventory-stock-table-body"><tr><td colspan="5" style="text-align:center; color:var(--text-muted);">Loading…</td></tr></tbody>
        </table>
      </div>

      <form id="inventory-adjust-form" style="display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-end; background: var(--admin-bg); border: 1px solid var(--admin-border); border-radius: var(--radius-md); padding: 1rem;">
        <div style="display: flex; flex-direction: column; gap: 0.3rem; flex: 1 1 220px;">
          <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Variant</label>
          <select id="inventory-adjust-variant" required class="admin-input-styled" style="min-height: 44px;"></select>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.3rem; flex: 1 1 160px;">
          <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Movement Type</label>
          <select id="inventory-adjust-type" required class="admin-input-styled" style="min-height: 44px;">
            <option value="RESTOCK">Restock</option>
            <option value="DAMAGE_ADJUSTMENT">Damage Adjustment</option>
            <option value="RETURN_RESTOCK">Return Restock</option>
          </select>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.3rem; flex: 1 1 120px;">
          <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Quantity Δ</label>
          <input id="inventory-adjust-quantity" type="number" required placeholder="e.g. 25 or -3" class="admin-input-styled" style="min-height: 44px;">
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.3rem; flex: 2 1 220px;">
          <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Reason</label>
          <input id="inventory-adjust-reason" type="text" placeholder="e.g. New lot arrival from Chikmagalur" class="admin-input-styled" style="min-height: 44px;">
        </div>
        <button type="submit" class="btn-table-action">Log Adjustment</button>
      </form>

      <div>
        <h3 style="font-size: 1rem; margin-bottom: 0.75rem;">Recent Movements</h3>
        <div class="table-responsive">
          <table class="data-table" id="inventory-movements-table">
            <thead>
              <tr><th>When</th><th>SKU</th><th>Type</th><th>Δ</th><th>Stock After</th><th>Reason</th></tr>
            </thead>
            <tbody id="inventory-movements-table-body"><tr><td colspan="6" style="text-align:center; color:var(--text-muted);">Loading…</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
`;

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  INITIAL_STOCK: 'Initial Stock',
  PURCHASE_RESERVE: 'Purchase Reserve',
  ORDER_FULFILLED: 'Order Fulfilled',
  RESTOCK: 'Restock',
  DAMAGE_ADJUSTMENT: 'Damage Adjustment',
  RETURN_RESTOCK: 'Return Restock',
  RESERVATION_EXPIRED: 'Reservation Expired',
};

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;

    const stockBody = document.getElementById('inventory-stock-table-body')!;
    const movementsBody = document.getElementById('inventory-movements-table-body')!;
    const variantSelect = document.getElementById('inventory-adjust-variant') as HTMLSelectElement;
    const lowStockBadge = document.getElementById('inventory-low-stock-badge');

    const loadStock = async () => {
      const data = await adminFetch<{ inventory: any[] }>('/api/admin/inventory');
      const rows = data.inventory || [];

      stockBody.innerHTML = rows.map((row) => {
        const isLow = Number(row.available_stock) <= Number(row.low_stock_threshold);
        return `
          <tr>
            <td data-label="Coffee Lot">${esc(row.product_name)} (${row.weight_grams}g)</td>
            <td data-label="SKU">${esc(row.sku)}</td>
            <td data-label="Available">${row.available_stock}</td>
            <td data-label="Reserved">${row.reserved_stock}</td>
            <td data-label="Status">${isLow ? '<span class="status-badge low-stock">Low Stock</span>' : '<span class="status-badge paid">In Stock</span>'}</td>
          </tr>
        `;
      }).join('');

      const lowStockCount = rows.filter((row) => Number(row.available_stock) <= Number(row.low_stock_threshold)).length;
      if (lowStockBadge) {
        lowStockBadge.style.display = lowStockCount > 0 ? 'inline-flex' : 'none';
        lowStockBadge.textContent = `${lowStockCount} Low Stock`;
      }

      variantSelect.innerHTML = rows.map((row) =>
        `<option value="${row.variant_id}">${esc(row.product_name)} (${row.weight_grams}g) — ${esc(row.sku)}</option>`
      ).join('');
    };

    const loadMovements = async () => {
      const data = await adminFetch<{ movements: any[] }>('/api/admin/movements?limit=25');
      const rows = data.movements || [];

      movementsBody.innerHTML = rows.map((row) => `
        <tr>
          <td data-label="When">${new Date(row.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
          <td data-label="SKU">${esc(row.sku || row.variant_id)}</td>
          <td data-label="Type">${MOVEMENT_TYPE_LABELS[row.movement_type] || row.movement_type}</td>
          <td data-label="Δ">${row.quantity_delta > 0 ? '+' : ''}${row.quantity_delta}</td>
          <td data-label="Stock After">${row.stock_after}</td>
          <td data-label="Reason">${esc(row.reason || '—')}</td>
        </tr>
      `).join('');
    };

    const refreshAll = () => Promise.all([loadStock(), loadMovements()]);
    refreshAll();

    document.getElementById('inventory-adjust-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      triggerHaptic();

      const variantId = variantSelect.value;
      const movementType = (document.getElementById('inventory-adjust-type') as HTMLSelectElement).value;
      const quantityInput = document.getElementById('inventory-adjust-quantity') as HTMLInputElement;
      const reasonInput = document.getElementById('inventory-adjust-reason') as HTMLInputElement;
      const quantityDelta = Number(quantityInput.value);

      if (!variantId || !quantityDelta) return;

      const result = await adminFetch<{ error?: string }>('/api/admin/inventory/adjust', {
        method: 'POST',
        json: { variant_id: variantId, movement_type: movementType, quantity_delta: quantityDelta, reason: reasonInput.value || undefined },
      });

      if (result.success) {
        quantityInput.value = '';
        reasonInput.value = '';
        await refreshAll();
      } else {
        alert(`Inventory adjustment failed: ${result.error || 'Unknown error'}`);
      }
    });
  },
};

export default route;
