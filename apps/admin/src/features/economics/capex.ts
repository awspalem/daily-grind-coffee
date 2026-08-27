import { triggerHaptic } from '../shared';
import { state, notify } from './model';
import type { RouteModule } from '../../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-capex" style="border-left: 4px solid var(--accent);">
    <div class="panel-header">
      <div>
        <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.2rem;">
          <h2 class="panel-title">India Roaster Market Pricing &amp; CapEx Benchmarks</h2>
          <span style="background: var(--accent-bg); color: var(--accent); border: 1px solid rgba(37, 99, 235, 0.4); padding: 0.2rem 0.6rem; border-radius: var(--radius-pill); font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">Sheet 6 Benchmark Schedule</span>
        </div>
        <span style="font-size: 0.85rem; color: var(--text-muted);">
          Current equipment pricing in India, 5-year straight-line depreciation &amp; 1-click CapEx upgrade simulation into Unit Economics
        </span>
      </div>
      <span style="background: var(--accent-bg); color: var(--accent); padding: 0.35rem 0.85rem; border-radius: var(--radius-pill); font-size: 0.8rem; font-weight:700; border: 1px solid rgba(37, 99, 235, 0.3);">
        Depreciation: 5-Year (60 Mo) Straight-Line
      </span>
    </div>

    <div style="padding: 1.8rem; display: flex; flex-direction: column; gap: 1.8rem;">
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.4rem;">
          <label style="font-size: 0.82rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted);">
            India Specialty &amp; Commercial Roaster CapEx Spectrum
          </label>
          <span style="font-size: 0.78rem; color: var(--accent); font-weight: 600;">1-Click Simulate CapEx Upgrade</span>
        </div>

        <div class="capex-cards-carousel" id="capex-cards-container">
          <div class="capex-machine-card" data-capex="435000" data-batch="1.0" data-model="1kg Specialty (Aillio Bullet R1 V2)">
            <div class="capex-card-top">
              <span class="capex-tag">1.0kg Specialty Drum</span>
              <div class="capex-price-range">₹4.0L – ₹4.7L</div>
              <h4 class="capex-model-name">Aillio Bullet R1 V2</h4>
            </div>
            <div class="capex-specs-list">
              <div class="capex-spec-item"><span>Tech / Heat:</span><strong>1.5kW Induction / 230V</strong></div>
              <div class="capex-spec-item"><span>Profiling:</span><strong>RoasTime USB-C / Artisan</strong></div>
              <div class="capex-spec-item"><span>5-Yr Deprec:</span><strong style="color: var(--accent);">₹7,250 / mo</strong></div>
              <div class="capex-spec-item"><span>Best For:</span><strong>Pilot Batches &amp; Sample Lab</strong></div>
            </div>
            <button type="button" class="btn-simulate-capex" data-cost="435000" data-name="1kg Specialty (Aillio Bullet R1 V2)" data-batch="1.0">Simulate ₹4.35L CapEx</button>
          </div>

          <div class="capex-machine-card" data-capex="250000" data-batch="2.0" data-model="1.5–2kg Indian Fabricated">
            <div class="capex-card-top">
              <span class="capex-tag">1.5–2.0kg Indian Fabricated</span>
              <div class="capex-price-range">₹2.0L – ₹3.0L</div>
              <h4 class="capex-model-name">Indian Fabricated Drum</h4>
            </div>
            <div class="capex-specs-list">
              <div class="capex-spec-item"><span>Tech / Heat:</span><strong>Dual LPG Burners / MS Drum</strong></div>
              <div class="capex-spec-item"><span>Drive / Air:</span><strong>Direct Drive / Single Fan</strong></div>
              <div class="capex-spec-item"><span>5-Yr Deprec:</span><strong style="color: var(--accent);">₹4,167 / mo</strong></div>
              <div class="capex-spec-item"><span>Best For:</span><strong>Budget Bootstrapping</strong></div>
            </div>
            <button type="button" class="btn-simulate-capex" data-cost="250000" data-name="1.5–2kg Indian Fabricated" data-batch="2.0">Simulate ₹2.50L CapEx</button>
          </div>

          <div class="capex-machine-card active-simulation" data-capex="450000" data-batch="3.0" data-model="3kg Commercial (Aatomize ARST-3)">
            <div class="capex-card-top">
              <span class="capex-tag" style="background: var(--accent-bg); color: var(--accent); border: 1px solid var(--accent);">Active Breakeven Model</span>
              <div class="capex-price-range">₹2.5L – ₹6.0L</div>
              <h4 class="capex-model-name">Aatomize ARST-3 / Golden 3kg</h4>
            </div>
            <div class="capex-specs-list">
              <div class="capex-spec-item"><span>Tech / Heat:</span><strong>Double Cast Iron Drum / LPG</strong></div>
              <div class="capex-spec-item"><span>Exhaust:</span><strong>Cyclone Chaff + BT/ET Artisan</strong></div>
              <div class="capex-spec-item"><span>5-Yr Deprec:</span><strong style="color: var(--accent);">₹7,500 / mo</strong></div>
              <div class="capex-spec-item"><span>Best For:</span><strong>Min Breakeven (2,483 kg/yr)</strong></div>
            </div>
            <button type="button" class="btn-simulate-capex active" data-cost="450000" data-name="3kg Commercial (Aatomize ARST-3)" data-batch="3.0">Active in Model (₹4.50L)</button>
          </div>

          <div class="capex-machine-card" data-capex="520000" data-batch="5.0" data-model="5kg Commercial Gas (RPM Automation / Aatomize)">
            <div class="capex-card-top">
              <span class="capex-tag">5.0kg Commercial Gas</span>
              <div class="capex-price-range">₹2.15L – ₹7.43L</div>
              <h4 class="capex-model-name">RPM Automation / Aatomize Pro</h4>
            </div>
            <div class="capex-specs-list">
              <div class="capex-spec-item"><span>Tech / Heat:</span><strong>Double Walled / Precision LPG</strong></div>
              <div class="capex-spec-item"><span>Controls:</span><strong>Inverter Drum &amp; Agitated Cooling</strong></div>
              <div class="capex-spec-item"><span>5-Yr Deprec:</span><strong style="color: var(--accent);">₹8,667 / mo</strong></div>
              <div class="capex-spec-item"><span>Best For:</span><strong>Investor Scale (3,725–4,967 kg)</strong></div>
            </div>
            <button type="button" class="btn-simulate-capex" data-cost="520000" data-name="5kg Commercial Gas (RPM Automation)" data-batch="5.0">Simulate ₹5.20L CapEx</button>
          </div>

          <div class="capex-machine-card" data-capex="780000" data-batch="10.0" data-model="10kg+ Wholesale / Scaling">
            <div class="capex-card-top">
              <span class="capex-tag">10.0kg+ Wholesale Scaling</span>
              <div class="capex-price-range">₹1.95L – ₹9.60L</div>
              <h4 class="capex-model-name">Industrial Wholesale 10kg+</h4>
            </div>
            <div class="capex-specs-list">
              <div class="capex-spec-item"><span>Tech / Heat:</span><strong>Pneumatic Loader &amp; Destoner</strong></div>
              <div class="capex-spec-item"><span>Capacity:</span><strong>12,730 kg/yr @ 4h shift</strong></div>
              <div class="capex-spec-item"><span>5-Yr Deprec:</span><strong style="color: var(--accent);">₹13,000 / mo</strong></div>
              <div class="capex-spec-item"><span>Best For:</span><strong>Multi-Cafe &amp; National D2C</strong></div>
            </div>
            <button type="button" class="btn-simulate-capex" data-cost="780000" data-name="10kg+ Wholesale / Scaling" data-batch="10.0">Simulate ₹7.80L CapEx</button>
          </div>
        </div>
      </div>

      <div class="capex-simulation-control-box">
        <div class="capex-sim-left">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; flex-wrap: wrap; gap: 0.3rem;">
            <label style="font-size: 0.88rem; font-weight: 700; color: var(--text-main);">Custom Roaster CapEx Investment Slider</label>
            <strong id="capex-slider-cost-lbl" style="font-size: 1.1rem; color: var(--accent);">₹4,50,000 (₹4.50 Lakhs)</strong>
          </div>
          <input type="range" id="capex-custom-slider" min="150000" max="1200000" value="450000" step="10000" style="width:100%; accent-color: var(--accent);">
          <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-dim); margin-top: 0.2rem;">
            <span>₹1.5L (Entry)</span><span>₹4.5L (3kg Commercial)</span><span>₹7.5L (5kg Pro)</span><span>₹12.0L (Automated Line)</span>
          </div>
        </div>

        <div class="capex-sim-right">
          <div class="capex-sim-metric">
            <span class="csm-lbl">5-Yr Monthly Depreciation</span>
            <strong id="capex-sim-deprec-lbl" style="color: var(--accent);">₹7,500 / mo</strong>
            <small>(CapEx / 60 months)</small>
          </div>
          <div class="capex-sim-metric">
            <span class="csm-lbl">Total Monthly Overhead</span>
            <strong id="capex-sim-total-overhead-lbl" style="color: var(--accent);">₹1,38,167 / mo</strong>
            <small>(Salary ₹1.0L + Rent + Ops + Deprec)</small>
          </div>
          <div class="capex-sim-metric">
            <span class="csm-lbl">Simulated Breakeven</span>
            <strong id="capex-sim-be-bags-lbl" style="color: var(--emerald);">842 Bags / mo</strong>
            <small id="capex-sim-be-kg-lbl">≈ 2,526 kg/yr</small>
          </div>
        </div>
      </div>
    </div>
  </section>
`;

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;

    const customSlider = document.getElementById('capex-custom-slider') as HTMLInputElement;
    const sliderCostLbl = document.getElementById('capex-slider-cost-lbl');
    const simDeprecLbl = document.getElementById('capex-sim-deprec-lbl');
    const simTotalOverheadLbl = document.getElementById('capex-sim-total-overhead-lbl');

    const capexButtons = document.querySelectorAll('.btn-simulate-capex');

    const applyCapExUpgrade = (cost: number, name?: string, batchSize?: number) => {
      triggerHaptic();
      state.simulatedRoasterCapEx = cost;
      if (name) state.simulatedRoasterName = name;
      if (batchSize) state.selectedBatchSizeKg = batchSize;

      if (customSlider) customSlider.value = cost.toString();

      const monthlyRoasterDeprec = Math.round(cost / 60);
      state.monthlyFixedCost = state.baseFixedCostExcludingRoaster + state.auxEquipmentDeprec + monthlyRoasterDeprec;

      if (sliderCostLbl) sliderCostLbl.textContent = `₹${cost.toLocaleString('en-IN')} (₹${(cost / 100000).toFixed(2)} Lakhs)`;
      if (simDeprecLbl) simDeprecLbl.textContent = `₹${monthlyRoasterDeprec.toLocaleString('en-IN')} / mo`;
      if (simTotalOverheadLbl) simTotalOverheadLbl.textContent = `₹${state.monthlyFixedCost.toLocaleString('en-IN')} / mo`;

      document.querySelectorAll('.capex-machine-card').forEach((card) => {
        const cardCost = parseFloat(card.getAttribute('data-capex') || '0');
        const isActive = Math.abs(cardCost - cost) < 10000;
        card.classList.toggle('active-simulation', isActive);

        const btn = card.querySelector('.btn-simulate-capex') as HTMLElement;
        if (btn) {
          btn.classList.toggle('active', isActive);
          btn.textContent = isActive ? `Active in Model (₹${(cardCost / 100000).toFixed(2)}L)` : `Simulate ₹${(cardCost / 100000).toFixed(2)}L CapEx`;
        }
      });

      notify();
    };

    capexButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const cost = parseFloat(target.getAttribute('data-cost') || '450000');
        const name = target.getAttribute('data-name') || 'Roaster Upgrade';
        const batch = parseFloat(target.getAttribute('data-batch') || '3.0');
        applyCapExUpgrade(cost, name, batch);
      });
    });

    customSlider?.addEventListener('input', (e) => {
      const cost = parseFloat((e.target as HTMLInputElement).value);
      applyCapExUpgrade(cost, `Custom Roaster (₹${(cost / 100000).toFixed(2)}L)`);
    });

    // Re-render this mount's own controls against whatever the shared model already holds
    // (e.g. the user simulated a CapEx elsewhere, navigated away, and came back).
    applyCapExUpgrade(state.simulatedRoasterCapEx, state.simulatedRoasterName, state.selectedBatchSizeKg);
  },
};

export default route;
