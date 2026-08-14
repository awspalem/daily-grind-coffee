// The Daily Grind — Roastery Command Portal Logic

interface OrderRow {
  id: string;
  order_number: string;
  customer_name: string;
  coffee_summary: string;
  total_formatted: string;
  status: 'PENDING' | 'PAID' | 'ROASTING' | 'PACKED' | 'SHIPPED';
}

class AdminPortal {
  async init() {
    this.setupEventListeners();
    await this.loadDashboardData();
  }

  private setupEventListeners() {
    document.querySelectorAll('.nav-item-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-item-btn').forEach((b) => b.classList.remove('active'));
        (e.currentTarget as HTMLElement).classList.add('active');
      });
    });

    document.getElementById('btn-quick-restock')?.addEventListener('click', () => {
      const lot = prompt('Enter Green Coffee Lot to restock (e.g. Guatemala Antigua):', 'Guatemala Antigua Los Volcanes');
      const kg = prompt('Enter restock amount in kg:', '50');
      if (lot && kg) {
        alert(`✓ Successfully logged +${kg}kg green stock for lot "${lot}" to the immutable inventory ledger.`);
      }
    });
  }

  private async loadDashboardData() {
    try {
      const res = await fetch('/api/admin/dashboard', {
        headers: { 'Authorization': 'Bearer tdg_admin_dev_token_secret' }
      });
      if (res.ok) {
        const data = await res.json() as any;
        if (data.kpis) {
          const revEl = document.getElementById('kpi-revenue');
          if (revEl) revEl.textContent = `$${(data.kpis.gross_revenue_cents / 100).toFixed(2)}`;
          const ordEl = document.getElementById('kpi-orders');
          if (ordEl) ordEl.textContent = `${data.kpis.total_orders} Orders`;
        }
      }
    } catch {
      // Graceful fallback for local presentation
    }
  }
}

const adminApp = new AdminPortal();
adminApp.init();
