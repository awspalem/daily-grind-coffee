import type { InventoryMovementType, OrderStatus } from '@daily-grind/shared-types';

let inventoryData: any[] = [];

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', 'Bearer admin-dev-token');
  if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }

  return res.json() as Promise<T>;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// 1. Init
async function initAdmin() {
  setupTabs();
  setupModals();
  await Promise.all([
    loadDashboard(),
    loadInventory(),
    loadMovements(),
    loadOrders(),
    loadAiBriefing(),
  ]);
}

// 2. Tabs
function setupTabs() {
  document.querySelectorAll('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.admin-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));

      const target = e.target as HTMLButtonElement;
      target.classList.add('active');
      const tabId = target.getAttribute('data-tab');
      document.getElementById(`tab-${tabId}`)?.classList.add('active');

      if (tabId === 'dashboard') { loadDashboard(); loadAiBriefing(); }
      if (tabId === 'inventory') loadInventory();
      if (tabId === 'movements') loadMovements();
      if (tabId === 'orders') loadOrders();
      if (tabId === 'funnel') loadFunnel();
      if (tabId === 'quotas') loadQuotas();
    });
  });
}

// 3. AI Morning Briefing
async function loadAiBriefing() {
  const box = document.getElementById('ai-ops-text');
  if (!box) return;

  try {
    const data = await apiRequest<{ success: boolean; summary: string }>('/api/admin/ai-summary');
    box.innerHTML = (data.summary || 'All roasting schedules and stock levels are currently nominal.')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>');
  } catch (err) {
    box.innerHTML = `<span style="color: var(--text-muted);">AI operations summary temporarily unavailable.</span>`;
  }
}

// 4. Dashboard
async function loadDashboard() {
  try {
    const data = await apiRequest<{
      success: boolean;
      stats: {
        total_orders: number;
        total_revenue_cents: number;
        aov_cents: number;
        low_stock_count: number;
        recent_orders: any[];
      };
    }>('/api/admin/dashboard');

    const s = data.stats;
    const kpiEl = document.getElementById('kpi-cards');
    if (kpiEl) {
      kpiEl.innerHTML = `
        <div class="kpi-card">
          <div class="kpi-title">Gross Edge Revenue</div>
          <div class="kpi-value">${formatPrice(s.total_revenue_cents)}</div>
          <div class="kpi-sub">Processed via Stripe Webhooks</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Total Orders</div>
          <div class="kpi-value">${s.total_orders}</div>
          <div class="kpi-sub">Across All Channels</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Average Order Value</div>
          <div class="kpi-value">${formatPrice(s.aov_cents)}</div>
          <div class="kpi-sub">Per Roastery Customer</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Low Stock Warnings</div>
          <div class="kpi-value" style="color: ${s.low_stock_count > 0 ? '#ef4444' : '#22c55e'};">${s.low_stock_count}</div>
          <div class="kpi-sub">Variants Below Threshold</div>
        </div>
      `;
    }

    const recentEl = document.getElementById('recent-orders-list');
    if (recentEl) {
      if (s.recent_orders.length === 0) {
        recentEl.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">No orders placed yet.</p>`;
      } else {
        recentEl.innerHTML = `
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px;">
            ${s.recent_orders.map((o) => `
              <li style="display: flex; justify-content: space-between; font-size: 0.85rem; padding: 6px 0; border-bottom: 1px solid var(--border-color);">
                <span><strong>#${o.order_number}</strong> (${o.customer_email})</span>
                <span>${formatPrice(o.total_cents)} · <span class="badge badge-success">${o.status}</span></span>
              </li>
            `).join('')}
          </ul>
        `;
      }
    }
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  }
}

// 5. Inventory
async function loadInventory() {
  try {
    const data = await apiRequest<{ success: boolean; inventory: any[] }>('/api/admin/inventory');
    inventoryData = data.inventory || [];
    const tbody = document.getElementById('inventory-table-body');
    const select = document.getElementById('adjust-variant') as HTMLSelectElement;

    if (select) {
      select.innerHTML = inventoryData.map((it) => `
        <option value="${it.variant_id}">${it.product_name} (${it.weight_grams}g) — SKU: ${it.sku} [Current: ${it.available_stock}]</option>
      `).join('');
    }

    if (tbody) {
      tbody.innerHTML = inventoryData.map((it) => {
        const isLow = it.available_stock <= it.low_stock_threshold;
        return `
          <tr>
            <td>
              <strong>${it.product_name}</strong>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${it.weight_grams}g · ${it.origin_country}</div>
            </td>
            <td><code>${it.sku}</code></td>
            <td style="font-weight: 700; font-size: 1rem;">${it.available_stock}</td>
            <td style="color: var(--text-muted);">${it.reserved_stock}</td>
            <td>
              <span class="badge ${isLow ? 'badge-danger' : 'badge-success'}">
                ${isLow ? 'Low Stock' : 'Optimal'}
              </span>
            </td>
            <td>
              <button class="btn btn-outline btn-sm" onclick="window.quickAdjustStock('${it.variant_id}')">
                Adjust
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Failed to load inventory:', err);
  }
}

// 6. Movements Ledger
async function loadMovements() {
  try {
    const data = await apiRequest<{ success: boolean; movements: any[] }>('/api/admin/movements');
    const tbody = document.getElementById('movements-table-body');
    if (!tbody) return;

    tbody.innerHTML = (data.movements || []).map((m) => {
      const deltaColor = m.quantity_delta > 0 ? '#166534' : '#991b1b';
      const deltaSign = m.quantity_delta > 0 ? '+' : '';

      return `
        <tr>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
          <td>
            <strong>${m.product_name}</strong>
            <div style="font-size: 0.75rem; color: var(--text-muted);"><code>${m.sku}</code></div>
          </td>
          <td><span class="badge badge-info">${m.movement_type}</span></td>
          <td style="color: ${deltaColor}; font-weight: 800;">${deltaSign}${m.quantity_delta}</td>
          <td style="font-weight: 700;">${m.stock_after}</td>
          <td style="font-size: 0.8rem;">${m.created_by || 'SYSTEM'} ${m.reference_id ? `(${m.reference_id})` : ''}</td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${m.reason || '—'}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load movements:', err);
  }
}

// 7. Orders Fulfillment
async function loadOrders() {
  try {
    const data = await apiRequest<{ success: boolean; orders: any[] }>('/api/admin/orders');
    const tbody = document.getElementById('orders-table-body');
    if (!tbody) return;

    tbody.innerHTML = (data.orders || []).map((o) => `
      <tr>
        <td><strong>#${o.order_number}</strong></td>
        <td>${o.customer_email}</td>
        <td><span class="badge badge-${getStatusBadgeColor(o.status)}">${o.status}</span></td>
        <td><strong>${formatPrice(o.total_cents)}</strong></td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${new Date(o.created_at).toLocaleDateString()}</td>
        <td>
          <select class="admin-input" style="padding: 4px 8px; font-size: 0.8rem;" onchange="window.updateOrderStatus('${o.id}', this.value)">
            <option value="PENDING_PAYMENT" ${o.status === 'PENDING_PAYMENT' ? 'selected' : ''}>PENDING_PAYMENT</option>
            <option value="PAID" ${o.status === 'PAID' ? 'selected' : ''}>PAID</option>
            <option value="ROASTING" ${o.status === 'ROASTING' ? 'selected' : ''}>ROASTING</option>
            <option value="PACKED" ${o.status === 'PACKED' ? 'selected' : ''}>PACKED</option>
            <option value="SHIPPED" ${o.status === 'SHIPPED' ? 'selected' : ''}>SHIPPED</option>
            <option value="DELIVERED" ${o.status === 'DELIVERED' ? 'selected' : ''}>DELIVERED</option>
          </select>
        </td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="window.refundOrder('${o.id}')" ${o.status === 'REFUNDED' ? 'disabled' : ''}>
            Refund
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load orders:', err);
  }
}

// 8. Funnel Analytics
async function loadFunnel() {
  try {
    const data = await apiRequest<{
      success: boolean;
      funnel: {
        views: number;
        cart_adds: number;
        checkouts: number;
        purchases: number;
        conversion_rates: { view_to_cart_pct: number; view_to_checkout_pct: number; overall_conversion_pct: number };
      };
    }>('/api/analytics/funnel');

    const f = data.funnel;
    const grid = document.getElementById('funnel-kpi-grid');
    const display = document.getElementById('funnel-rates-display');

    if (grid) {
      grid.innerHTML = `
        <div class="kpi-card">
          <div class="kpi-title">Catalog Impressions</div>
          <div class="kpi-value">${f.views}</div>
          <div class="kpi-sub">Total product views</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Add To Cart</div>
          <div class="kpi-value">${f.cart_adds}</div>
          <div class="kpi-sub">${f.conversion_rates.view_to_cart_pct}% of views</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Checkout Starts</div>
          <div class="kpi-value">${f.checkouts}</div>
          <div class="kpi-sub">${f.conversion_rates.view_to_checkout_pct}% of views</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Completed Orders</div>
          <div class="kpi-value" style="color: #22c55e;">${f.purchases}</div>
          <div class="kpi-sub">${f.conversion_rates.overall_conversion_pct}% conversion rate</div>
        </div>
      `;
    }

    if (display) {
      display.innerHTML = `
        <div>• <strong>View-to-Cart Conversion:</strong> ${f.conversion_rates.view_to_cart_pct}%</div>
        <div>• <strong>View-to-Checkout Conversion:</strong> ${f.conversion_rates.view_to_checkout_pct}%</div>
        <div>• <strong>Net Storefront Conversion (View to Purchase):</strong> ${f.conversion_rates.overall_conversion_pct}%</div>
      `;
    }
  } catch (err) {
    console.error('Failed to load funnel:', err);
  }
}

// 9. Quota Telemetry
async function loadQuotas() {
  try {
    const data = await apiRequest<{
      success: boolean;
      report: {
        workers_daily_requests: { used: number; limit: number; percentage: number };
        d1_daily_reads: { used: number; limit: number; percentage: number };
        d1_daily_writes: { used: number; limit: number; percentage: number };
        r2_storage_mb: { used: number; limit: number; percentage: number };
        queues_daily_operations: { used: number; limit: number; percentage: number };
        status: string;
      };
    }>('/api/admin/quotas');

    const r = data.report;
    const container = document.getElementById('quota-cards-container');
    if (!container) return;

    container.innerHTML = `
      <div class="quota-card">
        <div class="kpi-title">Workers Requests / Day</div>
        <div class="kpi-value">${r.workers_daily_requests.used.toLocaleString()}</div>
        <div class="quota-bar-track"><div class="quota-bar-fill" style="width: ${Math.min(100, r.workers_daily_requests.percentage)}%"></div></div>
        <div class="kpi-sub">${r.workers_daily_requests.percentage}% of 100,000 free quota</div>
      </div>

      <div class="quota-card">
        <div class="kpi-title">D1 SQL Rows Read / Day</div>
        <div class="kpi-value">${r.d1_daily_reads.used.toLocaleString()}</div>
        <div class="quota-bar-track"><div class="quota-bar-fill" style="width: ${Math.min(100, r.d1_daily_reads.percentage)}%"></div></div>
        <div class="kpi-sub">${r.d1_daily_reads.percentage}% of 5,000,000 free quota</div>
      </div>

      <div class="quota-card">
        <div class="kpi-title">D1 SQL Rows Written / Day</div>
        <div class="kpi-value">${r.d1_daily_writes.used.toLocaleString()}</div>
        <div class="quota-bar-track"><div class="quota-bar-fill" style="width: ${Math.min(100, r.d1_daily_writes.percentage)}%"></div></div>
        <div class="kpi-sub">${r.d1_daily_writes.percentage}% of 100,000 free quota</div>
      </div>

      <div class="quota-card">
        <div class="kpi-title">Queue Messages / Day</div>
        <div class="kpi-value">${r.queues_daily_operations.used.toLocaleString()}</div>
        <div class="quota-bar-track"><div class="quota-bar-fill" style="width: ${Math.min(100, r.queues_daily_operations.percentage)}%"></div></div>
        <div class="kpi-sub">${r.queues_daily_operations.percentage}% of 10,000 free quota</div>
      </div>
    `;
  } catch (err) {
    console.error('Failed to load quotas:', err);
  }
}

function getStatusBadgeColor(status: string) {
  if (status === 'PAID' || status === 'DELIVERED') return 'success';
  if (status === 'ROASTING' || status === 'PACKED' || status === 'SHIPPED') return 'warning';
  if (status === 'CANCELLED' || status === 'REFUNDED') return 'danger';
  return 'info';
}

(window as any).updateOrderStatus = async (orderId: string, status: OrderStatus) => {
  try {
    await apiRequest(`/api/admin/orders/${orderId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    await loadOrders();
    await loadDashboard();
  } catch (err: any) {
    alert(`Status update failed: ${err.message}`);
  }
};

(window as any).refundOrder = async (orderId: string) => {
  const reason = prompt('Enter refund reason (e.g. "Customer cancellation before roasting"):');
  if (!reason) return;

  try {
    const res = await apiRequest<{ success: boolean; message: string }>(`/api/admin/orders/${orderId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    alert(res.message);
    await loadOrders();
    await loadDashboard();
  } catch (err: any) {
    alert(`Refund error: ${err.message}`);
  }
};

(window as any).quickAdjustStock = (variantId: string) => {
  const select = document.getElementById('adjust-variant') as HTMLSelectElement;
  if (select) select.value = variantId;
  document.getElementById('adjust-modal')?.classList.remove('hidden');
};

function setupModals() {
  document.getElementById('btn-open-restock-modal')?.addEventListener('click', () => {
    document.getElementById('adjust-modal')?.classList.remove('hidden');
  });
  document.getElementById('btn-close-adjust')?.addEventListener('click', () => {
    document.getElementById('adjust-modal')?.classList.add('hidden');
  });
  document.getElementById('btn-cancel-adjust')?.addEventListener('click', () => {
    document.getElementById('adjust-modal')?.classList.add('hidden');
  });

  document.getElementById('btn-refresh-ai-summary')?.addEventListener('click', () => {
    loadAiBriefing();
  });

  document.getElementById('btn-trigger-backup')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-trigger-backup') as HTMLButtonElement;
    btn.innerText = 'Backing up to R2...';
    btn.disabled = true;
    try {
      const res = await apiRequest<{ success: boolean; key: string; rowCount: number }>('/api/admin/backup', {
        method: 'POST',
      });
      alert(`D1 snapshot successfully backed up to R2: ${res.key} (${res.rowCount} rows)`);
    } catch (e: any) {
      alert(`Backup error: ${e.message}`);
    } finally {
      btn.innerText = '💾 Run D1 R2 Backup';
      btn.disabled = false;
    }
  });

  document.getElementById('adjust-stock-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const variant_id = (document.getElementById('adjust-variant') as HTMLSelectElement).value;
    const movement_type = (document.getElementById('adjust-type') as HTMLSelectElement).value as InventoryMovementType;
    const quantity_delta = Number((document.getElementById('adjust-qty') as HTMLInputElement).value);
    const reason = (document.getElementById('adjust-reason') as HTMLInputElement).value;

    try {
      await apiRequest('/api/admin/inventory/adjust', {
        method: 'POST',
        body: JSON.stringify({ variant_id, movement_type, quantity_delta, reason }),
      });
      document.getElementById('adjust-modal')?.classList.add('hidden');
      await Promise.all([loadInventory(), loadMovements(), loadDashboard()]);
    } catch (err: any) {
      alert(`Adjustment error: ${err.message}`);
    }
  });
}

initAdmin();
