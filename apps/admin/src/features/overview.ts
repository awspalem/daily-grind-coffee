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
      <span class="kpi-title">Today's Roastery Revenue</span>
      <div class="kpi-value" id="kpi-revenue">₹1,84,500</div>
      <span class="kpi-sub">↑ 22.4% vs last week</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-title">Active Batches to Roast</span>
      <div class="kpi-value" id="kpi-orders">18 Orders</div>
      <span class="kpi-sub">Estimated time: 2h 45m</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-title">Green Coffee in Silos</span>
      <div class="kpi-value" id="kpi-stock">420 kg</div>
      <span class="kpi-sub">6 Indian & Global Lots</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-title">Average Cupping Score</span>
      <div class="kpi-value">88.4 PTS</div>
      <span class="kpi-sub">Specialty Grade Standard</span>
    </div>
  </section>
`;

async function loadDashboardData(): Promise<void> {
  const data = await adminFetch<{ kpis?: { gross_revenue_cents: number; total_orders: number } }>('/api/admin/dashboard');
  if (data.success && data.kpis) {
    const revEl = document.getElementById('kpi-revenue');
    if (revEl) revEl.textContent = `₹${Math.round(data.kpis.gross_revenue_cents * 0.23).toLocaleString('en-IN')}`;
    const ordEl = document.getElementById('kpi-orders');
    if (ordEl) ordEl.textContent = `${data.kpis.total_orders} Orders`;
  }
}

const route: RouteModule = {
  async mount(container) {
    container.innerHTML = PANEL_HTML;
    await loadDashboardData();
  },
};

export default route;
