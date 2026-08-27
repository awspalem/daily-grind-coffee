import { state, notify } from './model';
import type { RouteModule } from '../../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-economics" style="border-left: 4px solid var(--accent);">
    <div class="panel-header">
      <div>
        <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.2rem;">
          <h2 class="panel-title">Live Unit Economics &amp; Breakeven Controller</h2>
          <span style="background: var(--accent-bg); color: var(--accent); border: 1px solid rgba(37, 99, 235, 0.4); padding: 0.2rem 0.6rem; border-radius: var(--radius-pill); font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">Direct Trade Model</span>
        </div>
        <span style="font-size: 0.85rem; color: var(--text-muted);">Interactive simulator aligned with your 250g roasting cost model &amp; ₹12L salary target</span>
      </div>
      <span id="econ-target-overhead-badge" style="background: var(--accent-bg); color: var(--accent); padding: 0.3rem 0.8rem; border-radius: var(--radius-pill); font-size: 0.8rem; font-weight:700; border: 1px solid rgba(37, 99, 235, 0.3);">
        Target Overhead: ₹1.38L/mo (₹16.58L/yr)
      </span>
    </div>

    <div style="padding: 1.8rem; display: grid; grid-template-columns: 1.1fr 1fr; gap: 2rem;" class="econ-panel-grid">
      <div style="display: flex; flex-direction: column; gap: 1.2rem;">
        <div>
          <label style="display: flex; justify-content: space-between; font-size: 0.88rem; font-weight: 600; margin-bottom: 0.4rem;">
            <span>Retail Selling Price (₹ / 250g bag)</span>
            <strong id="econ-price-lbl" style="color: var(--accent);">₹450</strong>
          </label>
          <input type="range" id="econ-price-slider" min="300" max="650" value="450" step="10" style="width:100%; accent-color: var(--accent);">
        </div>

        <div>
          <label style="display: flex; justify-content: space-between; font-size: 0.88rem; font-weight: 600; margin-bottom: 0.4rem;">
            <span>Landed Green Bean Cost (₹ / kg)</span>
            <strong id="econ-green-lbl" style="color: var(--accent);">₹610</strong>
          </label>
          <input type="range" id="econ-green-slider" min="400" max="900" value="610" step="10" style="width:100%; accent-color: var(--accent);">
        </div>

        <div>
          <label style="display: flex; justify-content: space-between; font-size: 0.88rem; font-weight: 600; margin-bottom: 0.4rem;">
            <span>Roast Loss % (Weight loss during roast)</span>
            <strong id="econ-loss-lbl">15%</strong>
          </label>
          <input type="range" id="econ-loss-slider" min="10" max="22" value="15" step="1" style="width:100%; accent-color: var(--emerald);">
        </div>

        <div>
          <label style="display: flex; justify-content: space-between; font-size: 0.88rem; font-weight: 600; margin-bottom: 0.4rem;">
            <span>Sales Channel &amp; Marketplace Commission</span>
            <strong id="econ-channel-lbl" style="color: var(--emerald);">Direct Storefront (0%)</strong>
          </label>
          <select id="econ-channel-select" class="admin-input-styled" style="width:100%;">
            <option value="0">Own Direct Storefront (0% Commission, 2% Gateway)</option>
            <option value="15" selected>Blended Channel Mix (15% Commission, 2% Gateway)</option>
            <option value="25">Third-Party Marketplace Only (25% Commission, 2% Gateway)</option>
          </select>
        </div>

        <div style="background: var(--admin-bg); border: 1px solid var(--admin-border); border-radius: var(--radius-sm); padding: 1rem; display: flex; flex-direction: column; gap: 0.4rem;">
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted);"><span>Founder Salary:</span><strong>₹1,00,000 / mo (₹12L/yr)</strong></div>
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted);"><span>Rent &amp; Utilities (Indiranagar Shed):</span><strong>₹12,000 / mo</strong></div>
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted);"><span>Biz-Dev / Marketing / Cloudflare:</span><strong>₹18,667 / mo</strong></div>
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--accent);">
            <span>Roaster Depreciation (5-Yr):</span>
            <strong id="econ-roaster-deprec-row">₹7,500 / mo (<span id="econ-roaster-model-ref">3kg ARST-3</span>)</strong>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.84rem; font-weight: 700; color: var(--text-main); border-top: 1px dashed var(--admin-border); padding-top: 0.4rem; margin-top: 0.2rem;">
            <span>Total Monthly Fixed Overhead:</span>
            <span id="econ-total-fixed-cost-val" style="color: var(--accent);">₹1,38,167 / mo</span>
          </div>
        </div>
      </div>

      <div style="background: var(--admin-surface); border: 1px solid var(--admin-border); border-radius: var(--radius-md); padding: 1.5rem; display: flex; flex-direction: column; justify-content: space-between; gap: 1rem;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; text-align: center;">
          <div style="background: var(--admin-card); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--admin-border);">
            <span style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">COGS / Bag</span>
            <div style="font-size: 1.5rem; font-weight: 700; color: var(--rose);" id="econ-cogs-val">₹209.41</div>
            <small style="font-size:0.72rem; color:var(--text-dim);">Green + Pouch + Seal</small>
          </div>
          <div style="background: var(--admin-card); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--admin-border);">
            <span style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">Gross Margin %</span>
            <div style="font-size: 1.5rem; font-weight: 700; color: var(--emerald);" id="econ-margin-val">36.5%</div>
            <small style="font-size:0.72rem; color:var(--text-dim);">Realisation vs COGS</small>
          </div>
          <div style="background: var(--admin-card); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--admin-border);">
            <span style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">Gross Profit / Bag</span>
            <div style="font-size: 1.5rem; font-weight: 700; color: var(--accent);" id="econ-profit-val">₹164.09</div>
            <small style="font-size:0.72rem; color:var(--text-dim);">Net take per unit</small>
          </div>
          <div style="background: var(--admin-card); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--admin-border);">
            <span style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">Monthly Breakeven</span>
            <div style="font-size: 1.5rem; font-weight: 700; color: var(--accent);" id="econ-breakeven-bags">842 Bags</div>
            <small style="font-size:0.72rem; color:var(--text-dim);" id="econ-breakeven-daily-sub">≈ 33 bags / day (26 days)</small>
          </div>
        </div>

        <div style="background: var(--admin-card); border: 1px solid var(--admin-border); border-radius: var(--radius-sm); padding: 0.9rem 1.1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.6rem;">
          <div>
            <span style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; display: block;">Annual Breakeven Output</span>
            <strong id="econ-annual-be-kg" style="font-size: 1.25rem; color: var(--text-main);">2,526 kg / yr</strong>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; display: block;">Roaster Capacity Fit</span>
            <span id="econ-capacity-fit-pill" class="status-badge paid" style="font-size: 0.8rem; font-weight: 700;">3.0kg Roaster (151% Buffer)</span>
          </div>
        </div>

        <div style="background: var(--admin-bg); padding: 0.8rem 1rem; border-radius: var(--radius-sm); font-size: 0.82rem; color: var(--text-muted);">
          <strong>Margin Optimization Insight:</strong> <span id="econ-insight-text">Moving 100% of sales to your Direct Storefront saves ₹67.50/bag in marketplace commissions, lowering breakeven by 241 bags/month.</span>
        </div>
      </div>
    </div>
  </section>
`;

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;

    const priceSlider = document.getElementById('econ-price-slider') as HTMLInputElement;
    const greenSlider = document.getElementById('econ-green-slider') as HTMLInputElement;
    const lossSlider = document.getElementById('econ-loss-slider') as HTMLInputElement;
    const channelSelect = document.getElementById('econ-channel-select') as HTMLSelectElement;

    const priceLbl = document.getElementById('econ-price-lbl');
    const greenLbl = document.getElementById('econ-green-lbl');
    const lossLbl = document.getElementById('econ-loss-lbl');
    const cogsVal = document.getElementById('econ-cogs-val');
    const marginVal = document.getElementById('econ-margin-val');
    const profitVal = document.getElementById('econ-profit-val');
    const breakevenBags = document.getElementById('econ-breakeven-bags');
    const breakevenDailySub = document.getElementById('econ-breakeven-daily-sub');
    const annualBeKgEl = document.getElementById('econ-annual-be-kg');
    const insightText = document.getElementById('econ-insight-text');
    const econRoasterDeprecRow = document.getElementById('econ-roaster-deprec-row');
    const econTotalFixedVal = document.getElementById('econ-total-fixed-cost-val');
    const econOverheadBadge = document.getElementById('econ-target-overhead-badge');
    const econCapPill = document.getElementById('econ-capacity-fit-pill');

    const BREAKEVEN_KG_YEAR = 2483;

    const recalculate = () => {
      const price = parseFloat(priceSlider.value);
      const greenPerKg = parseFloat(greenSlider.value);
      const roastLossPct = parseFloat(lossSlider.value) / 100;
      const commissionPct = parseFloat(channelSelect.value) / 100;
      const gatewayPct = 0.02;

      state.retailPricePerBag = price;

      if (priceLbl) priceLbl.textContent = `₹${price}`;
      if (greenLbl) greenLbl.textContent = `₹${greenPerKg}`;
      if (lossLbl) lossLbl.textContent = `${lossSlider.value}%`;

      const monthlyRoasterDeprec = Math.round(state.simulatedRoasterCapEx / 60);
      if (econRoasterDeprecRow) econRoasterDeprecRow.innerHTML = `₹${monthlyRoasterDeprec.toLocaleString('en-IN')} / mo (<span id="econ-roaster-model-ref">${state.simulatedRoasterName}</span>)`;
      if (econTotalFixedVal) econTotalFixedVal.textContent = `₹${state.monthlyFixedCost.toLocaleString('en-IN')} / mo`;
      if (econOverheadBadge) econOverheadBadge.textContent = `Target Overhead: ₹${(state.monthlyFixedCost / 100000).toFixed(2)}L/mo (₹${((state.monthlyFixedCost * 12) / 100000).toFixed(2)}L/yr)`;

      const greenKgNeeded = 0.25 / (1 - roastLossPct);
      const greenCostPerBag = greenKgNeeded * greenPerKg;
      const packagingCost = 30;
      const totalCogs = greenCostPerBag + packagingCost;

      const netRealisation = price * (1 - commissionPct - gatewayPct);
      const grossProfit = netRealisation - totalCogs;
      const grossMarginPct = netRealisation > 0 ? (grossProfit / netRealisation) * 100 : 0;

      const bagsNeeded = grossProfit > 0 ? Math.ceil(state.monthlyFixedCost / grossProfit) : 0;
      const dailyBags = Math.ceil(bagsNeeded / 26);
      const annualBeKg = Math.round(bagsNeeded * 12 * 0.25);

      if (cogsVal) cogsVal.textContent = `₹${totalCogs.toFixed(2)}`;
      if (marginVal) marginVal.textContent = `${grossMarginPct.toFixed(1)}%`;
      if (profitVal) profitVal.textContent = `₹${grossProfit.toFixed(2)}`;
      if (breakevenBags) breakevenBags.textContent = `${bagsNeeded} Bags`;
      if (breakevenDailySub) breakevenDailySub.textContent = `≈ ${dailyBags} bags / day (26 days)`;
      if (annualBeKgEl) annualBeKgEl.textContent = `${annualBeKg.toLocaleString('en-IN')} kg / yr`;

      if (insightText) {
        if (commissionPct === 0) {
          insightText.textContent = `Direct Storefront mode (0% commission) maximizes profit to ₹${grossProfit.toFixed(2)}/bag. You need ${dailyBags} bags/day (${bagsNeeded} bags/mo) to cover all fixed costs & salary!`;
        } else if (commissionPct === 0.15) {
          const savings = (price * 0.15).toFixed(2);
          insightText.textContent = `Marketplace mix loses ₹${savings}/bag to platform commissions. Shifting traffic to your direct storefront drops monthly breakeven by ~${Math.round(bagsNeeded * 0.22)} bags!`;
        } else {
          insightText.textContent = `25% marketplace commission cuts gross margin to ${grossMarginPct.toFixed(1)}%. Recommend driving subscriptions and repeat orders exclusively to your direct storefront.`;
        }
      }

      if (econCapPill) {
        // Approximates the capacity tab's own annual-output calc for the currently selected
        // batch size at a standard 4h/50min/15%-loss shift, since that tab isn't mounted here.
        const batchesPerDay = (4 * 60) / 50;
        const annualRoastedKg = batchesPerDay * state.selectedBatchSizeKg * (1 - 0.15) * 312;
        const bufferPct = ((annualRoastedKg / BREAKEVEN_KG_YEAR) * 100).toFixed(0);
        econCapPill.textContent = `${state.selectedBatchSizeKg.toFixed(1)}kg Roaster (${Math.round(annualRoastedKg).toLocaleString('en-IN')} kg/yr · ${bufferPct}% Buffer)`;
        econCapPill.className = annualRoastedKg >= BREAKEVEN_KG_YEAR ? 'status-badge paid' : 'status-badge low-stock';
      }

      notify();
    };

    priceSlider?.addEventListener('input', recalculate);
    greenSlider?.addEventListener('input', recalculate);
    lossSlider?.addEventListener('input', recalculate);
    channelSelect?.addEventListener('change', recalculate);

    priceSlider.value = String(state.retailPricePerBag);
    recalculate();
  },
};

export default route;
