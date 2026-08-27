import { adminFetch } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="roaster-briefing-card" id="panel-overview">
    <div class="briefing-header">
      <span class="briefing-tag">Morning Roaster AI Briefing · Bangalore</span>
      <span style="font-size: 0.8rem; color: var(--accent);" id="briefing-timestamp">Indiranagar Roastery · Today</span>
    </div>
    <div class="briefing-content" id="ai-briefing-text">
      Good morning Roasters! Today's roast queue has <strong>18 customer orders</strong>. Priority lots: <strong>15kg Chikmagalur Attikan Honey</strong> (Medium-Light profile) and <strong>10kg Araku Valley Red Honey</strong>. Green stock for Guatemala Antigua is at 8kg—recommend ordering next 50kg lot from Chikmagalur partner estate.
    </div>
  </section>

  <section class="kpi-grid">
    <div class="kpi-card">
      <span class="kpi-title">Total Revenue (All-Time)</span>
      <div class="kpi-value" id="kpi-revenue">—</div>
      <span class="kpi-sub" id="kpi-revenue-sub">Loading…</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-title">Orders In Progress</span>
      <div class="kpi-value" id="kpi-orders">—</div>
      <span class="kpi-sub" id="kpi-orders-sub">Loading…</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-title">Low Stock Variants</span>
      <div class="kpi-value" id="kpi-stock">—</div>
      <span class="kpi-sub" id="kpi-stock-sub">Loading…</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-title">Average Cupping Score</span>
      <div class="kpi-value">88.4 PTS</div>
      <span class="kpi-sub">Not yet tracked in this system</span>
    </div>
  </section>
`;

interface DashboardStats {
  total_orders: number;
  total_revenue_cents: number;
  low_stock_count: number;
  orders_by_status: Array<{ status: string; count: number }>;
}

const TERMINAL_STATUSES = new Set(['DELIVERED', 'CANCELLED', 'REFUNDED']);

async function loadDashboardData(): Promise<void> {
  const data = await adminFetch<{ stats?: DashboardStats; error?: string }>('/api/admin/dashboard');

  const revEl = document.getElementById('kpi-revenue');
  const revSubEl = document.getElementById('kpi-revenue-sub');
  const ordEl = document.getElementById('kpi-orders');
  const ordSubEl = document.getElementById('kpi-orders-sub');
  const stockEl = document.getElementById('kpi-stock');
  const stockSubEl = document.getElementById('kpi-stock-sub');

  if (!data.success || !data.stats) {
    [revSubEl, ordSubEl, stockSubEl].forEach((el) => {
      if (!el) return;
      el.textContent = 'Could not load';
      el.classList.add('negative');
    });
    return;
  }

  const { stats } = data;
  // total_revenue_cents is USD; see the pricing/orders tabs for the same fixed display factor.
  if (revEl) revEl.textContent = `₹${Math.round(stats.total_revenue_cents * 0.23).toLocaleString('en-IN')}`;
  if (revSubEl) revSubEl.textContent = `${stats.total_orders} orders, all statuses`;

  const activeCount = stats.orders_by_status
    .filter((row) => !TERMINAL_STATUSES.has(row.status))
    .reduce((sum, row) => sum + row.count, 0);
  if (ordEl) ordEl.textContent = `${activeCount} Orders`;
  if (ordSubEl) ordSubEl.textContent = 'Paid through shipped, not yet delivered';

  if (stockEl) stockEl.textContent = `${stats.low_stock_count}`;
  if (stockSubEl) {
    stockSubEl.textContent = stats.low_stock_count > 0 ? 'Below their restock threshold' : 'Everything is well stocked';
    stockSubEl.classList.toggle('negative', stats.low_stock_count > 0);
    stockSubEl.classList.toggle('positive', stats.low_stock_count === 0);
  }
}

const route: RouteModule = {
  async mount(container) {
    container.innerHTML = PANEL_HTML;
    await loadDashboardData();
  },
};

export default route;
