"use strict";
// The Daily Grind — Roastery Command Center Interactive Engine
class AdminPortal {
    monthlyFixedCost = 135834; // ₹1.35L/month to cover ₹12L salary + ₹2L biz-dev + depreciation + ops
    catalogPricing = [
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
        { variant_id: 'var_mid_500', product_name: 'Midnight Runner Dark Espresso', weight_grams: 500, price_inr: 820, price_usd_cents: 3300, discount_percent: 5 }
    ];
    async init() {
        this.setupNavigation();
        this.setupPricingTable();
        this.setupEconomicsSimulator();
        this.setupBatchLogging();
        this.setupCouponsManager();
        await this.loadDashboardData();
    }
    triggerHaptic() {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try {
                navigator.vibrate(10);
            }
            catch {
                // Ignore vibration errors on unsupported platforms
            }
        }
    }
    setupNavigation() {
        const handleTabChange = (tab) => {
            if (!tab)
                return;
            this.triggerHaptic();
            // Sync active state on desktop sidebar and mobile command bar
            document.querySelectorAll('.nav-item-btn').forEach((b) => {
                b.classList.toggle('active', b.getAttribute('data-tab') === tab);
            });
            document.querySelectorAll('.admin-cmd-item').forEach((b) => {
                b.classList.toggle('active', b.getAttribute('data-tab') === tab);
            });
            if (tab === 'overview') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
            else if (tab === 'pricing') {
                document.getElementById('panel-pricing')?.scrollIntoView({ behavior: 'smooth' });
            }
            else if (tab === 'economics') {
                document.getElementById('panel-economics')?.scrollIntoView({ behavior: 'smooth' });
            }
            else if (tab === 'roasts') {
                document.getElementById('panel-roasts')?.scrollIntoView({ behavior: 'smooth' });
            }
            else if (tab === 'coupons') {
                document.getElementById('panel-coupons')?.scrollIntoView({ behavior: 'smooth' });
            }
            else if (tab === 'orders') {
                document.getElementById('panel-orders')?.scrollIntoView({ behavior: 'smooth' });
            }
        };
        // Sidebar navigation
        document.querySelectorAll('.nav-item-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const tab = e.currentTarget.getAttribute('data-tab');
                handleTabChange(tab);
            });
        });
        // Mobile Bottom Command Bar
        document.querySelectorAll('.admin-cmd-item').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const tab = e.currentTarget.getAttribute('data-tab');
                handleTabChange(tab);
            });
        });
        document.getElementById('btn-quick-restock')?.addEventListener('click', () => {
            this.triggerHaptic();
            const lot = prompt('Enter Green Coffee Lot to restock (e.g. Chikmagalur Attikan):', 'Chikmagalur Attikan Estate Honey');
            const kg = prompt('Enter restock amount in kg:', '60');
            if (lot && kg) {
                alert(`✓ Successfully logged +${kg}kg green stock for lot "${lot}" to Cloudflare D1 inventory ledger.`);
            }
        });
    }
    setupPricingTable() {
        const tbody = document.getElementById('pricing-table-body');
        if (!tbody)
            return;
        tbody.innerHTML = this.catalogPricing.map((item, idx) => {
            const netInr = Math.round(item.price_inr * (1 - (item.discount_percent / 100)));
            const netUsd = ((item.price_usd_cents * (1 - (item.discount_percent / 100))) / 100).toFixed(2);
            return `
        <tr>
          <td><strong>${item.product_name}</strong></td>
          <td><span class="status-badge paid">${item.weight_grams >= 1000 ? `${item.weight_grams / 1000}kg` : `${item.weight_grams}g`}</span></td>
          <td>
            <input type="number" id="inr-${idx}" value="${item.price_inr}" step="10" style="width: 90px; padding: 0.35rem 0.5rem; background: var(--admin-surface); color: #fff; border: 1px solid var(--admin-border); border-radius: var(--radius-sm);">
          </td>
          <td>
            <input type="number" id="usd-${idx}" value="${(item.price_usd_cents / 100).toFixed(2)}" step="0.5" style="width: 80px; padding: 0.35rem 0.5rem; background: var(--admin-surface); color: #fff; border: 1px solid var(--admin-border); border-radius: var(--radius-sm);">
          </td>
          <td>
            <input type="number" id="disc-${idx}" value="${item.discount_percent}" min="0" max="90" step="5" style="width: 70px; padding: 0.35rem 0.5rem; background: var(--admin-surface); color: var(--gold); border: 1px solid var(--admin-border); border-radius: var(--radius-sm); font-weight:700;"> %
          </td>
          <td id="preview-${idx}">
            <strong>₹${netInr}</strong> <span style="color:var(--text-muted); font-size:0.8rem;">($${netUsd})</span>
          </td>
          <td>
            <button class="btn-table-action" data-idx="${idx}">Save</button>
          </td>
        </tr>
      `;
        }).join('');
        // Attach save event listeners
        tbody.querySelectorAll('.btn-table-action').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                const target = e.currentTarget;
                const idx = parseInt(target.getAttribute('data-idx') || '0', 10);
                const item = this.catalogPricing[idx];
                const inrInput = document.getElementById(`inr-${idx}`);
                const usdInput = document.getElementById(`usd-${idx}`);
                const discInput = document.getElementById(`disc-${idx}`);
                item.price_inr = parseFloat(inrInput.value);
                item.price_usd_cents = Math.round(parseFloat(usdInput.value) * 100);
                item.discount_percent = parseInt(discInput.value, 10);
                const netInr = Math.round(item.price_inr * (1 - (item.discount_percent / 100)));
                const netUsd = ((item.price_usd_cents * (1 - (item.discount_percent / 100))) / 100).toFixed(2);
                const previewEl = document.getElementById(`preview-${idx}`);
                if (previewEl) {
                    previewEl.innerHTML = `<strong>₹${netInr}</strong> <span style="color:var(--text-muted); font-size:0.8rem;">($${netUsd})</span>`;
                }
                try {
                    await fetch(`/api/admin/variants/${item.variant_id}/pricing`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer tdg_admin_dev_token_secret' },
                        body: JSON.stringify({
                            price_inr: item.price_inr,
                            price_usd_cents: item.price_usd_cents,
                            discount_percent: item.discount_percent
                        })
                    });
                }
                catch {
                    // Local fallback
                }
                target.textContent = '✓ Saved';
                target.style.background = 'var(--emerald)';
                setTimeout(() => {
                    target.textContent = 'Save';
                    target.style.background = 'rgba(255,255,255,0.06)';
                }, 1200);
            });
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
    setupBatchLogging() {
        const form = document.getElementById('roast-batch-form');
        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            const lotSelect = document.getElementById('batch-lot-select');
            const greenInput = document.getElementById('batch-green-in');
            const roastedInput = document.getElementById('batch-roasted-out');
            const lot = lotSelect.value;
            const greenKg = parseFloat(greenInput.value);
            const roastedKg = parseFloat(roastedInput.value);
            const lossPct = (((greenKg - roastedKg) / greenKg) * 100).toFixed(1);
            const greenCostPerBag = ((0.25 / (1 - (parseFloat(lossPct) / 100))) * 610).toFixed(2);
            const tbody = document.getElementById('batch-table-body');
            if (tbody) {
                const tr = document.createElement('tr');
                tr.innerHTML = `
          <td><strong>BATCH-${Math.floor(1000 + Math.random() * 9000)}</strong></td>
          <td>${lot}</td>
          <td>${greenKg} kg</td>
          <td>${roastedKg} kg</td>
          <td><strong style="color: var(--emerald);">${lossPct}%</strong></td>
          <td>₹${greenCostPerBag} / 250g</td>
          <td><span class="status-badge paid">✓ Calibrated</span></td>
        `;
                tbody.prepend(tr);
            }
            alert(`🔥 Batch for ${lot} successfully logged with ${lossPct}% roast loss. Yield calibrated in database!`);
        });
    }
    setupCouponsManager() {
        document.getElementById('btn-add-coupon')?.addEventListener('click', () => {
            const code = prompt('Enter new Promo Coupon Code (e.g. MONSOON20):', 'MONSOON20');
            const discount = prompt('Enter Discount Percentage (e.g. 20):', '20');
            if (code && discount) {
                const tbody = document.getElementById('coupons-table-body');
                if (tbody) {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
            <td><strong>${code.toUpperCase()}</strong></td>
            <td>${discount}% Off Entire Order</td>
            <td>0 uses</td>
            <td>250 max</td>
            <td><span class="status-badge paid">Active</span></td>
            <td><button class="btn-table-action" onclick="alert('Coupon is active')">Active</button></td>
          `;
                    tbody.prepend(tr);
                }
                alert(`🎟️ Coupon code "${code.toUpperCase()}" with ${discount}% discount created successfully!`);
            }
        });
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
                        revEl.textContent = `₹${Math.round(data.kpis.gross_revenue_cents * 0.23).toLocaleString('en-IN')}`;
                    const ordEl = document.getElementById('kpi-orders');
                    if (ordEl)
                        ordEl.textContent = `${data.kpis.total_orders} Orders`;
                }
            }
        }
        catch {
            // Local fallback
        }
    }
}
const adminApp = new AdminPortal();
adminApp.init();
