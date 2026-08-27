import { adminFetch, esc, toast } from './shared';
import { icons } from '../icons';
import type { RouteModule } from '../router';

interface DashboardStats {
  total_orders: number;
  total_revenue_cents: number;
  aov_cents: number;
  low_stock_count: number;
  orders_by_status: Array<{ status: string; count: number }>;
  recent_orders: Array<{
    id: string;
    order_number: string;
    customer_email: string;
    status: string;
    total_cents: number;
    currency: string;
    created_at: string;
  }>;
}

const TERMINAL_STATUSES = new Set(['DELIVERED', 'CANCELLED', 'REFUNDED']);

// Render the static skeleton of the overview page; data is filled in on load.
function renderSkeleton(): string {
  return `
    <section class="roaster-briefing-card" id="panel-overview">
      <div class="briefing-header">
        <span class="briefing-tag">Morning Roaster AI Briefing · Bangalore</span>
        <span style="font-size: 0.78rem; color: var(--text-dim);" id="briefing-timestamp">Indiranagar Roastery · Today</span>
      </div>
      <div class="briefing-content" id="ai-briefing-text">
        Good morning, Roasters. Loading today's dispatch queue &amp; roastery state…
      </div>
    </section>

    <section class="kpi-grid">
      <div class="kpi-card kpi-card--revenue">
        <div class="kpi-card-head">
          <span class="kpi-title">Total Revenue</span>
          <span class="kpi-icon">${icons.dollar}</span>
        </div>
        <div class="kpi-value skeleton skeleton-kpi-value" id="kpi-revenue">&nbsp;</div>
        <div class="kpi-foot">
          <span class="kpi-delta neutral" id="kpi-revenue-delta">&nbsp;</span>
          <span class="kpi-sub skeleton skeleton-kpi-sub" id="kpi-revenue-sub">&nbsp;</span>
        </div>
      </div>

      <div class="kpi-card kpi-card--orders">
        <div class="kpi-card-head">
          <span class="kpi-title">Orders In Progress</span>
          <span class="kpi-icon">${icons.truck}</span>
        </div>
        <div class="kpi-value skeleton skeleton-kpi-value" id="kpi-orders">&nbsp;</div>
        <div class="kpi-foot">
          <span class="kpi-delta neutral" id="kpi-orders-delta">&nbsp;</span>
          <span class="kpi-sub skeleton skeleton-kpi-sub" id="kpi-orders-sub">&nbsp;</span>
        </div>
      </div>

      <div class="kpi-card kpi-card--stock">
        <div class="kpi-card-head">
          <span class="kpi-title">Low Stock Variants</span>
          <span class="kpi-icon">${icons.box}</span>
        </div>
        <div class="kpi-value skeleton skeleton-kpi-value" id="kpi-stock">&nbsp;</div>
        <div class="kpi-foot">
          <span class="kpi-delta neutral" id="kpi-stock-delta">&nbsp;</span>
          <span class="kpi-sub skeleton skeleton-kpi-sub" id="kpi-stock-sub">&nbsp;</span>
        </div>
      </div>

      <div class="kpi-card kpi-card--cupping">
        <div class="kpi-card-head">
          <span class="kpi-title">Cupping Quality</span>
          <span class="kpi-icon">${icons.star}</span>
        </div>
        <div class="kpi-value" id="kpi-cupping">—</div>
        <div class="kpi-foot">
          <span class="kpi-sub muted" id="kpi-cupping-sub">Coming Q4 · Roastery QA program</span>
        </div>
      </div>
    </section>

    <section class="section-panel" id="panel-roast-queue">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Today's Roast Queue</h2>
          <p class="panel-subtitle">Orders paid and ready to roast, oldest first</p>
        </div>
        <a class="btn-ghost" href="/orders">View all orders →</a>
      </div>
      <div class="roast-queue-list" id="roast-queue-list">
        ${[1,2,3,4].map(() => `<div class="roast-queue-card skeleton" style="height: 96px;">&nbsp;</div>`).join('')}
      </div>
    </section>

    <section class="section-panel" id="panel-recent-orders">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Recent Orders</h2>
          <p class="panel-subtitle">Last 8 orders across all statuses</p>
        </div>
      </div>
      <div class="table-responsive">
        <table class="data-table" id="recent-orders-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="recent-orders-body">
            ${[1,2,3,4,5].map(() => `
              <tr>
                <td><span class="skeleton" style="display:inline-block; width: 100px; height: 14px;">&nbsp;</span></td>
                <td><span class="skeleton" style="display:inline-block; width: 160px; height: 14px;">&nbsp;</span></td>
                <td><span class="skeleton" style="display:inline-block; width: 70px; height: 14px;">&nbsp;</span></td>
                <td><span class="skeleton" style="display:inline-block; width: 80px; height: 22px; border-radius: 9999px;">&nbsp;</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) { el.textContent = text; el.classList.remove('skeleton', 'skeleton-kpi-value', 'skeleton-kpi-sub'); }
}
function setClass(id: string, cls: string, add = true): void {
  document.getElementById(id)?.classList.toggle(cls, add);
}
function setDelta(id: string, text: string, kind: 'positive' | 'negative' | 'neutral'): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove('skeleton', 'skeleton-kpi-value', 'skeleton-kpi-sub', 'positive', 'negative', 'neutral');
  el.classList.add(kind);
}

async function loadDashboardData(): Promise<void> {
  const data = await adminFetch<{ stats?: DashboardStats; error?: string }>('/api/admin/dashboard');

  if (!data.success || !data.stats) {
    setText('kpi-revenue', '—');
    setText('kpi-revenue-sub', 'Could not load');
    setClass('kpi-revenue-sub', 'negative');
    setText('kpi-orders', '—');
    setText('kpi-orders-sub', 'Could not load');
    setClass('kpi-orders-sub', 'negative');
    setText('kpi-stock', '—');
    setText('kpi-stock-sub', 'Could not load');
    setClass('kpi-stock-sub', 'negative');
    toast('Could not load dashboard data', 'error');
    return;
  }

  const { stats } = data;

  // Revenue (USD-cents → INR at the same fixed display factor the rest of the app uses)
  const totalInr = Math.round(stats.total_revenue_cents * 0.23);
  setText('kpi-revenue', `₹${totalInr.toLocaleString('en-IN')}`);
  setText('kpi-revenue-sub', `${stats.total_orders.toLocaleString('en-IN')} orders, all-time`);
  // We don't have a "previous period" total from the API, so derive a delta proxy
  // from the recent-orders window. If we have < 8 recent orders, the delta is hidden.
  const recent8 = stats.recent_orders || [];
  if (recent8.length >= 4) {
    const recentCents = recent8.reduce((s, o) => s + (o.status === 'CANCELLED' || o.status === 'REFUNDED' ? 0 : o.total_cents), 0);
    const recentInr = Math.round(recentCents * 0.23);
    setDelta('kpi-revenue-delta', `+₹${recentInr.toLocaleString('en-IN')} last 8`, 'positive');
  } else {
    document.getElementById('kpi-revenue-delta')?.remove();
  }

  // Orders in progress (anything not yet terminal)
  const activeCount = stats.orders_by_status
    .filter((row) => !TERMINAL_STATUSES.has(row.status))
    .reduce((sum, row) => sum + row.count, 0);
  setText('kpi-orders', `${activeCount}`);
  setText('kpi-orders-sub', 'Paid → delivered, in flight');
  const roastsNow = stats.orders_by_status.find((r) => r.status === 'ROASTING')?.count ?? 0;
  if (roastsNow > 0) {
    setDelta('kpi-orders-delta', `${roastsNow} roasting now`, 'positive');
  } else {
    setDelta('kpi-orders-delta', 'No active roasts', 'neutral');
  }

  // Low stock
  setText('kpi-stock', `${stats.low_stock_count}`);
  if (stats.low_stock_count > 0) {
    setText('kpi-stock-sub', 'Below restock threshold');
    setClass('kpi-stock-sub', 'negative', true);
    setDelta('kpi-stock-delta', 'Action needed', 'negative');
  } else {
    setText('kpi-stock-sub', 'All variants are well stocked');
    setClass('kpi-stock-sub', 'positive', true);
    setDelta('kpi-stock-delta', 'Healthy', 'positive');
  }

  // AI briefing — refresh the text to be a little more dynamic than the static fallback
  const briefEl = document.getElementById('ai-briefing-text');
  if (briefEl) {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const roastCount = stats.orders_by_status.find((r) => r.status === 'ROASTING')?.count ?? 0;
    const queuedCount = stats.orders_by_status.find((r) => r.status === 'PAID')?.count ?? 0;
    const stockNote = stats.low_stock_count > 0
      ? `<strong>${stats.low_stock_count} variant${stats.low_stock_count === 1 ? '' : 's'}</strong> are below their restock threshold.`
      : 'Green inventory is well stocked across the catalog.';
    briefEl.innerHTML = `${greeting}, Roasters. ${queuedCount > 0 ? `There ${queuedCount === 1 ? 'is 1 order' : `are <strong>${queuedCount} orders</strong>`} paid and ready for the roaster.` : 'The roast queue is clear.'} ${roastCount > 0 ? `<strong>${roastCount}</strong> batch${roastCount === 1 ? ' is' : 'es are'} currently on the drum.` : ''} ${stockNote}`;
  }

  // Today's roast queue: PAID + ROASTING orders, client-side fetch (best-effort)
  void loadRoastQueue();

  // Recent orders table
  renderRecentOrders(recent8);
}

async function loadRoastQueue(): Promise<void> {
  const list = document.getElementById('roast-queue-list');
  if (!list) return;
  const [paid, roasting] = await Promise.all([
    adminFetch<{ orders?: any[] }>('/api/admin/orders?status=PAID'),
    adminFetch<{ orders?: any[] }>('/api/admin/orders?status=ROASTING'),
  ]);
  const all = [...(roasting.orders || []), ...(paid.orders || [])]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(0, 8);
  if (all.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">${icons.inbox}</div>
        <div class="empty-state-title">Roast queue is clear</div>
        <div class="empty-state-body">No paid or roasting orders right now. As soon as a customer pays, the lot will show up here.</div>
      </div>`;
    return;
  }
  list.innerHTML = all.map((o) => {
    const name = o.shipping_address?.name || o.customer_email;
    const itemSummary = (o.items || []).slice(0, 2).map((it: any) => `${esc(it.product_name)} ×${it.quantity}`).join(', ');
    const more = (o.items || []).length > 2 ? ` +${o.items.length - 2} more` : '';
    const total = Math.round((o.total_cents * 0.23) / 100);
    const status = (o.status || '').toLowerCase();
    return `
      <a class="roast-queue-card" href="/orders" data-status="${esc(o.status)}">
        <div class="roast-queue-card-head">
          <span class="roast-queue-card-num">${esc(o.order_number)}</span>
          <span class="status-badge ${status}">${esc(o.status)}</span>
        </div>
        <div class="roast-queue-card-customer">${esc(name)} · ₹${total.toLocaleString('en-IN')}</div>
        <div class="roast-queue-card-items">${itemSummary}${more}</div>
      </a>`;
  }).join('');
}

function renderRecentOrders(orders: DashboardStats['recent_orders']): void {
  const tbody = document.getElementById('recent-orders-body');
  if (!tbody) return;
  if (!orders || orders.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="4">
        <div class="empty-state">
          <div class="empty-state-icon">${icons.inbox}</div>
          <div class="empty-state-title">No orders yet</div>
          <div class="empty-state-body">As soon as customers start checking out, the last 8 will appear here.</div>
        </div>
      </td></tr>`;
    return;
  }
  const STATUS_LABEL: Record<string, string> = {
    PENDING_PAYMENT: 'Pending',
    PAID: 'Paid',
    ROASTING: 'Roasting',
    PACKED: 'Packed',
    SHIPPED: 'Shipped',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
    REFUNDED: 'Refunded',
  };
  tbody.innerHTML = orders.map((o) => {
    const status = (o.status || '').toLowerCase();
    const total = Math.round((o.total_cents * 0.23) / 100);
    const date = new Date(o.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    return `
      <tr>
        <td data-label="Order"><strong>${esc(o.order_number)}</strong><br><span style="color: var(--text-muted); font-size: 0.78rem;">${esc(date)}</span></td>
        <td data-label="Customer">${esc(o.customer_email)}</td>
        <td data-label="Total"><strong>₹${total.toLocaleString('en-IN')}</strong></td>
        <td data-label="Status"><span class="status-badge ${status}">${esc(STATUS_LABEL[o.status] || o.status)}</span></td>
      </tr>`;
  }).join('');
}

const route: RouteModule = {
  async mount(container) {
    container.innerHTML = renderSkeleton();
    await loadDashboardData();
  },
};

export default route;
