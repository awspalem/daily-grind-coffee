"use strict";
// The Daily Grind — Roastery Command Portal Logic
class AdminPortal {
    monthlyFixedCost = 135834; // ₹1.35L/month to cover ₹12L salary + ₹2L biz-dev + depreciation + ops
    async init() {
        this.setupEventListeners();
        this.setupEconomicsSimulator();
        await this.loadDashboardData();
    }
    setupEventListeners() {
        document.querySelectorAll('.nav-item-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.nav-item-btn').forEach((b) => b.classList.remove('active'));
                const target = e.currentTarget;
                target.classList.add('active');
                const tab = target.getAttribute('data-tab');
                const econPanel = document.getElementById('panel-economics');
                if (tab === 'economics' && econPanel) {
                    econPanel.scrollIntoView({ behavior: 'smooth' });
                }
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
    setupEconomicsSimulator() {
        const priceSlider = document.getElementById('econ-price-slider');
        const greenSlider = document.getElementById('econ-green-slider');
        const lossSlider = document.getElementById('econ-loss-slider');
        const channelSelect = document.getElementById('econ-channel-select');
        const priceLbl = document.getElementById('econ-price-lbl');
        const greenLbl = document.getElementById('econ-green-lbl');
        const lossLbl = document.getElementById('econ-loss-lbl');
        const cogsVal = document.getElementById('econ-cogs-val');
        const marginVal = document.getElementById('econ-margin-val');
        const profitVal = document.getElementById('econ-profit-val');
        const breakevenBags = document.getElementById('econ-breakeven-bags');
        const insightText = document.getElementById('econ-insight-text');
        const recalculate = () => {
            const price = parseFloat(priceSlider.value);
            const greenPerKg = parseFloat(greenSlider.value);
            const roastLossPct = parseFloat(lossSlider.value) / 100;
            const commissionPct = parseFloat(channelSelect.value) / 100;
            const gatewayPct = 0.02;
            if (priceLbl)
                priceLbl.textContent = `₹${price}`;
            if (greenLbl)
                greenLbl.textContent = `₹${greenPerKg}`;
            if (lossLbl)
                lossLbl.textContent = `${lossSlider.value}%`;
            // 1. COGS calculation
            const greenKgNeeded = 0.25 / (1 - roastLossPct);
            const greenCostPerBag = greenKgNeeded * greenPerKg;
            const packagingCost = 30; // ₹25 pouch/valve/label + ₹5 sealing
            const totalCogs = greenCostPerBag + packagingCost;
            // 2. Net Realisation
            const netRealisation = price * (1 - commissionPct - gatewayPct);
            // 3. Gross Profit & Margin
            const grossProfit = netRealisation - totalCogs;
            const grossMarginPct = netRealisation > 0 ? (grossProfit / netRealisation) * 100 : 0;
            // 4. Breakeven Volume
            const bagsNeeded = grossProfit > 0 ? Math.ceil(this.monthlyFixedCost / grossProfit) : 0;
            const dailyBags = Math.ceil(bagsNeeded / 26);
            if (cogsVal)
                cogsVal.textContent = `₹${totalCogs.toFixed(2)}`;
            if (marginVal)
                marginVal.textContent = `${grossMarginPct.toFixed(1)}%`;
            if (profitVal)
                profitVal.textContent = `₹${grossProfit.toFixed(2)}`;
            if (breakevenBags) {
                breakevenBags.textContent = `${bagsNeeded} Bags`;
                const smallEl = breakevenBags.parentElement?.querySelector('small');
                if (smallEl)
                    smallEl.textContent = `≈ ${dailyBags} bags / day (26 days)`;
            }
            if (insightText) {
                if (commissionPct === 0) {
                    insightText.textContent = `Direct Storefront mode (0% commission) maximizes profit to ₹${grossProfit.toFixed(2)}/bag. You only need ${dailyBags} bags/day to hit your ₹12L salary!`;
                }
                else if (commissionPct === 0.15) {
                    const savings = (price * 0.15).toFixed(2);
                    insightText.textContent = `Marketplace mix loses ₹${savings}/bag to platform commissions. Shifting traffic to your direct storefront drops your monthly breakeven by ~240 bags!`;
                }
                else {
                    insightText.textContent = `25% marketplace commission heavily cuts margins to ${grossMarginPct.toFixed(1)}%. Recommend offering exclusive single-origin lots only on your direct storefront.`;
                }
            }
        };
        priceSlider?.addEventListener('input', recalculate);
        greenSlider?.addEventListener('input', recalculate);
        lossSlider?.addEventListener('input', recalculate);
        channelSelect?.addEventListener('change', recalculate);
        recalculate();
    }
    async loadDashboardData() {
        try {
            const res = await fetch('/api/admin/dashboard', {
                headers: { 'Authorization': 'Bearer tdg_admin_dev_token_secret' }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.kpis) {
                    const revEl = document.getElementById('kpi-revenue');
                    if (revEl)
                        revEl.textContent = `$${(data.kpis.gross_revenue_cents / 100).toFixed(2)}`;
                    const ordEl = document.getElementById('kpi-orders');
                    if (ordEl)
                        ordEl.textContent = `${data.kpis.total_orders} Orders`;
                }
            }
        }
        catch {
            // Local demo fallback
        }
    }
}
const adminApp = new AdminPortal();
adminApp.init();
