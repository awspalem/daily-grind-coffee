import { triggerHaptic } from '../shared';
import { state, notify, ROASTER_TIERS, BREAKEVEN_KG_YEAR, INVESTOR_LOW_KG_YEAR, INVESTOR_HIGH_KG_YEAR } from './model';
import type { RouteModule } from '../../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-capacity" style="border-left: 4px solid var(--accent);">
    <div class="panel-header">
      <div>
        <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.2rem;">
          <h2 class="panel-title">Roaster Output Capacity vs Demand Matrix</h2>
          <span style="background: var(--accent-bg); color: var(--accent); padding: 0.2rem 0.6rem; border-radius: var(--radius-pill); font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">Sheet 5 Operations Matrix</span>
        </div>
        <span style="font-size: 0.85rem; color: var(--text-muted);">
          Model 50-min convection/conduction cycles, daily operating hours &amp; scale against breakeven &amp; investor milestones (312 roast days/yr)
        </span>
      </div>
      <div style="display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;">
        <span style="background: rgba(0,0,0,0.04); color: var(--text-muted); padding: 0.35rem 0.85rem; border-radius: var(--radius-pill); font-size: 0.8rem; font-weight: 600; border: 1px solid var(--admin-border);">
          Cycle Standard: 50 Min / Batch
        </span>
      </div>
    </div>

    <div style="padding: 1.8rem; display: flex; flex-direction: column; gap: 1.8rem;">
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <label style="font-size: 0.82rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted);">
            Select Roaster Green Capacity Tier
          </label>
          <span id="cap-selected-tier-label" style="font-size: 0.85rem; font-weight: 700; color: var(--accent);">3.0kg Commercial Entry (Selected)</span>
        </div>

        <div class="capacity-batch-carousel" id="capacity-batch-selector">
          ${ROASTER_TIERS.map((tier) => `
            <button type="button" class="batch-tier-pill${tier.batchSizeKg === state.selectedBatchSizeKg ? ' active' : ''}" data-batch="${tier.batchSizeKg}">
              <span class="pill-size">${tier.batchSizeKg.toFixed(1)} kg</span>
              <span class="pill-role">${tier.category}</span>
              <span class="pill-status ${tier.statusClass}">${tier.recommendedRole.split(' (')[0]}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="capacity-controls-dashboard-grid">
        <div class="capacity-controls-box">
          <h3 style="font-size: 0.95rem; font-weight: 700; color: var(--text-main); margin-bottom: 1rem;">Operational Shift Parameters</h3>

          <div style="display: flex; flex-direction: column; gap: 1.1rem;">
            <div>
              <div style="display: flex; justify-content: space-between; font-size: 0.86rem; font-weight: 600; margin-bottom: 0.35rem;">
                <span>Daily Roasting Shift Hours</span>
                <strong id="cap-hours-lbl" style="color: var(--accent); font-size: 0.95rem;">4.0 hrs / day</strong>
              </div>
              <input type="range" id="cap-hours-slider" min="1" max="10" value="${state.dailyRoastingHours}" step="0.5" style="width:100%; accent-color: var(--accent);">
              <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-dim); margin-top: 0.2rem;">
                <span>1.0h (Part-time)</span>
                <span>4.0h (Standard Half-Shift)</span>
                <span>8.0h (Full Shift)</span>
                <span>10.0h (Double)</span>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem;">
              <div>
                <label style="display: block; font-size: 0.78rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.3rem;">Batch Cycle Time (mins)</label>
                <select id="cap-cycle-select" class="admin-input-styled">
                  <option value="40">40 mins (High Speed)</option>
                  <option value="45">45 mins (Fast Turnaround)</option>
                  <option value="50" selected>50 mins (Standard Sheet 5)</option>
                  <option value="55">55 mins (Careful Artisan)</option>
                  <option value="60">60 mins (Long Roast/Cool)</option>
                </select>
              </div>
              <div>
                <label style="display: block; font-size: 0.78rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.3rem;">Roast Loss %</label>
                <select id="cap-loss-select" class="admin-input-styled">
                  <option value="12">12% (Ultra-Light Filter)</option>
                  <option value="15" selected>15% (Specialty Standard)</option>
                  <option value="18">18% (Dark Espresso)</option>
                </select>
              </div>
            </div>

            <div style="background: var(--admin-bg); border: 1px solid var(--admin-border); border-radius: var(--radius-sm); padding: 0.75rem 0.9rem; font-size: 0.8rem; color: var(--text-muted); display: flex; align-items: center; justify-content: space-between;">
              <span>Roasting Days Assumption:</span>
              <strong style="color: var(--text-main);">26 Days/Mo · 312 Days/Yr</strong>
            </div>
          </div>
        </div>

        <div class="capacity-live-kpis">
          <div class="cap-metric-card highlight">
            <span class="cap-metric-label">Daily Roasted Output</span>
            <div class="cap-metric-value" id="cap-daily-kg">12.2 kg</div>
            <span class="cap-metric-sub" id="cap-daily-batches">4.8 batches / day</span>
          </div>
          <div class="cap-metric-card">
            <span class="cap-metric-label">Monthly Roasted Output</span>
            <div class="cap-metric-value" id="cap-monthly-kg">318.2 kg</div>
            <span class="cap-metric-sub">26 operational days</span>
          </div>
          <div class="cap-metric-card copper-glow">
            <span class="cap-metric-label">Annual Roasted Output</span>
            <div class="cap-metric-value" id="cap-annual-kg" style="color: var(--accent);">3,818.9 kg</div>
            <span class="cap-metric-sub" id="cap-annual-green">4,492.8 kg green beans</span>
          </div>
          <div class="cap-metric-card">
            <span class="cap-metric-label">Annual 250g Retail Bags</span>
            <div class="cap-metric-value" id="cap-annual-bags">15,276</div>
            <span class="cap-metric-sub">4 bags per kg roasted</span>
          </div>
          <div class="cap-metric-card revenue-span">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; flex-wrap: wrap; gap: 0.6rem;">
              <div>
                <span class="cap-metric-label">Annual Gross Revenue Capacity (@ ₹450/bag)</span>
                <div class="cap-metric-value-lg" id="cap-annual-revenue" style="color: var(--emerald);">₹68,73,984</div>
              </div>
              <div style="text-align: right;">
                <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">Capacity Headroom</span>
                <strong id="cap-headroom-badge" style="font-size: 0.95rem; color: var(--accent);">+153.8% of Breakeven</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="milestone-container">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; flex-wrap: wrap; gap: 0.4rem;">
          <h3 style="font-size: 0.92rem; font-weight: 700; color: var(--text-main);">Sheet 5 Milestone Stress-Test &amp; Capacity Coverage</h3>
          <span style="font-size: 0.78rem; font-weight: 600; color: var(--text-muted);">Selected Capacity: <strong id="milestone-cur-kg-hdr" style="color: var(--accent);">3,819 kg/yr</strong></span>
        </div>

        <div class="milestones-grid">
          <div class="milestone-card" id="mcard-breakeven">
            <div class="mcard-header">
              <div class="mcard-title-group">
                <span class="mcard-badge breakeven">Milestone 1 · Breakeven</span>
                <h4>2,483 kg / year</h4>
                <span class="mcard-sub">Min 3.0kg Roaster required (9,932 bags/yr)</span>
              </div>
              <span class="mcard-status-pill" id="mstatus-breakeven">✓ Achieved</span>
            </div>
            <div class="mcard-bar-wrap"><div class="mcard-bar-fill" id="mbar-breakeven" style="width: 100%;"></div></div>
            <div class="mcard-footer-info">
              <span id="minfo-breakeven">153.8% of Breakeven Volume</span>
              <span style="color: var(--emerald);" id="mdelta-breakeven">+1,336 kg surplus</span>
            </div>
          </div>

          <div class="milestone-card" id="mcard-investor-low">
            <div class="mcard-header">
              <div class="mcard-title-group">
                <span class="mcard-badge investor">Milestone 2 · Investor Low (1.5x)</span>
                <h4>3,725 kg / year</h4>
                <span class="mcard-sub">Min 5.0kg Roaster recommended (14,900 bags/yr)</span>
              </div>
              <span class="mcard-status-pill" id="mstatus-investor-low">✓ Achieved</span>
            </div>
            <div class="mcard-bar-wrap"><div class="mcard-bar-fill" id="mbar-investor-low" style="width: 100%;"></div></div>
            <div class="mcard-footer-info">
              <span id="minfo-investor-low">102.5% of Target Volume</span>
              <span style="color: var(--emerald);" id="mdelta-investor-low">+94 kg surplus</span>
            </div>
          </div>

          <div class="milestone-card" id="mcard-investor-high">
            <div class="mcard-header">
              <div class="mcard-title-group">
                <span class="mcard-badge wholesale">Milestone 3 · Investor High (2.0x)</span>
                <h4>4,967 kg / year</h4>
                <span class="mcard-sub">5.0kg – 10.0kg Roaster required (19,868 bags/yr)</span>
              </div>
              <span class="mcard-status-pill" id="mstatus-investor-high">⚠ Needs More Hours</span>
            </div>
            <div class="mcard-bar-wrap"><div class="mcard-bar-fill" id="mbar-investor-high" style="width: 76.9%;"></div></div>
            <div class="mcard-footer-info">
              <span id="minfo-investor-high">76.9% of Target Volume</span>
              <span style="color: var(--amber);" id="mdelta-investor-high">-1,148 kg deficit</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; flex-wrap: wrap; gap: 0.4rem;">
          <h3 style="font-size: 0.92rem; font-weight: 700; color: var(--text-main);">
            Complete Sheet 5 Capacity Comparison Matrix (All Roasters @ <span id="cap-tbl-hours-ref" style="color: var(--accent);">4.0h</span> Shift)
          </h3>
          <span style="font-size: 0.78rem; color: var(--text-muted);">Click any row to test batch size</span>
        </div>

        <div class="table-responsive" style="border-radius: var(--radius-sm); border: 1px solid var(--admin-border);">
          <table class="data-table" id="capacity-comparison-table" style="margin: 0;">
            <thead>
              <tr>
                <th>Batch Size</th><th>Machine Class</th><th>Batches/Day</th><th>Roasted kg/Day</th>
                <th>Monthly kg (26d)</th><th>Annual kg (312d)</th><th>250g Bags/Yr</th>
                <th>Annual Revenue (@ ₹450)</th><th>Milestone Fit</th><th>Action</th>
              </tr>
            </thead>
            <tbody id="capacity-comparison-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
`;

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;

    const batchPills = document.querySelectorAll('#capacity-batch-selector .batch-tier-pill');
    const hoursSlider = document.getElementById('cap-hours-slider') as HTMLInputElement;
    const cycleSelect = document.getElementById('cap-cycle-select') as HTMLSelectElement;
    const lossSelect = document.getElementById('cap-loss-select') as HTMLSelectElement;

    const hoursLbl = document.getElementById('cap-hours-lbl');
    const selectedTierLbl = document.getElementById('cap-selected-tier-label');
    const tblHoursRef = document.getElementById('cap-tbl-hours-ref');
    const milestoneCurKgHdr = document.getElementById('milestone-cur-kg-hdr');

    const dailyKgVal = document.getElementById('cap-daily-kg');
    const dailyBatchesVal = document.getElementById('cap-daily-batches');
    const monthlyKgVal = document.getElementById('cap-monthly-kg');
    const annualKgVal = document.getElementById('cap-annual-kg');
    const annualGreenVal = document.getElementById('cap-annual-green');
    const annualBagsVal = document.getElementById('cap-annual-bags');
    const annualRevVal = document.getElementById('cap-annual-revenue');
    const headroomBadge = document.getElementById('cap-headroom-badge');

    const mbarBreakeven = document.getElementById('mbar-breakeven');
    const minfoBreakeven = document.getElementById('minfo-breakeven');
    const mdeltaBreakeven = document.getElementById('mdelta-breakeven');
    const mstatusBreakeven = document.getElementById('mstatus-breakeven');
    const mbarInvLow = document.getElementById('mbar-investor-low');
    const minfoInvLow = document.getElementById('minfo-investor-low');
    const mdeltaInvLow = document.getElementById('mdelta-investor-low');
    const mstatusInvLow = document.getElementById('mstatus-investor-low');
    const mbarInvHigh = document.getElementById('mbar-investor-high');
    const minfoInvHigh = document.getElementById('minfo-investor-high');
    const mdeltaInvHigh = document.getElementById('mdelta-investor-high');
    const mstatusInvHigh = document.getElementById('mstatus-investor-high');

    const comparisonTbody = document.getElementById('capacity-comparison-tbody');

    const updateBatchPillsActiveState = () => {
      document.querySelectorAll('#capacity-batch-selector .batch-tier-pill').forEach((pill) => {
        const b = parseFloat(pill.getAttribute('data-batch') || '0');
        pill.classList.toggle('active', b === state.selectedBatchSizeKg);
      });
    };

    const recalculate = () => {
      if (hoursSlider) state.dailyRoastingHours = parseFloat(hoursSlider.value);
      if (cycleSelect) state.batchCycleMinutes = parseFloat(cycleSelect.value);
      if (lossSelect) state.capacityRoastLossPct = parseFloat(lossSelect.value) / 100;

      const batchesPerDay = (state.dailyRoastingHours * 60) / state.batchCycleMinutes;
      const dailyRoastedKg = batchesPerDay * state.selectedBatchSizeKg * (1 - state.capacityRoastLossPct);
      const monthlyRoastedKg = dailyRoastedKg * state.operatingDaysPerMonth;
      const annualRoastedKg = dailyRoastedKg * state.operatingDaysPerYear;
      const annualGreenKg = batchesPerDay * state.selectedBatchSizeKg * state.operatingDaysPerYear;
      const annualBags250g = Math.round(annualRoastedKg * 4);
      const annualGrossRevenue = annualBags250g * state.retailPricePerBag;

      if (hoursLbl) hoursLbl.textContent = `${state.dailyRoastingHours.toFixed(1)} hrs / day`;
      if (tblHoursRef) tblHoursRef.textContent = `${state.dailyRoastingHours.toFixed(1)}h`;
      if (milestoneCurKgHdr) milestoneCurKgHdr.textContent = `${Math.round(annualRoastedKg).toLocaleString('en-IN')} kg/yr`;

      const activeTier = ROASTER_TIERS.find((t) => t.batchSizeKg === state.selectedBatchSizeKg);
      if (selectedTierLbl && activeTier) selectedTierLbl.textContent = `${activeTier.batchSizeKg.toFixed(1)}kg ${activeTier.category} (Selected)`;

      if (dailyKgVal) dailyKgVal.textContent = `${dailyRoastedKg.toFixed(1)} kg`;
      if (dailyBatchesVal) dailyBatchesVal.textContent = `${batchesPerDay.toFixed(1)} batches / day`;
      if (monthlyKgVal) monthlyKgVal.textContent = `${monthlyRoastedKg.toFixed(1)} kg`;
      if (annualKgVal) annualKgVal.textContent = `${Math.round(annualRoastedKg).toLocaleString('en-IN')} kg`;
      if (annualGreenVal) annualGreenVal.textContent = `${Math.round(annualGreenKg).toLocaleString('en-IN')} kg green beans`;
      if (annualBagsVal) annualBagsVal.textContent = `${annualBags250g.toLocaleString('en-IN')}`;
      if (annualRevVal) annualRevVal.textContent = `₹${annualGrossRevenue.toLocaleString('en-IN')}`;

      const beCoveragePct = (annualRoastedKg / BREAKEVEN_KG_YEAR) * 100;
      if (headroomBadge) {
        if (annualRoastedKg >= BREAKEVEN_KG_YEAR) {
          headroomBadge.textContent = `+${beCoveragePct.toFixed(1)}% of Breakeven (+${Math.round(annualRoastedKg - BREAKEVEN_KG_YEAR).toLocaleString('en-IN')} kg surplus)`;
          headroomBadge.style.color = 'var(--emerald)';
        } else {
          headroomBadge.textContent = `${beCoveragePct.toFixed(1)}% of Breakeven (-${Math.round(BREAKEVEN_KG_YEAR - annualRoastedKg).toLocaleString('en-IN')} kg deficit)`;
          headroomBadge.style.color = 'var(--rose)';
        }
      }

      const bePct = (annualRoastedKg / BREAKEVEN_KG_YEAR) * 100;
      if (mbarBreakeven) mbarBreakeven.style.width = `${Math.min(100, Math.max(0, bePct))}%`;
      if (minfoBreakeven) minfoBreakeven.textContent = `${bePct.toFixed(1)}% of Breakeven Volume`;
      if (annualRoastedKg >= BREAKEVEN_KG_YEAR) {
        if (mstatusBreakeven) { mstatusBreakeven.textContent = '✓ Achieved'; mstatusBreakeven.className = 'mcard-status-pill success'; }
        if (mdeltaBreakeven) { mdeltaBreakeven.textContent = `+${Math.round(annualRoastedKg - BREAKEVEN_KG_YEAR).toLocaleString('en-IN')} kg surplus`; mdeltaBreakeven.style.color = 'var(--emerald)'; }
      } else {
        if (mstatusBreakeven) { mstatusBreakeven.textContent = '⚠ Sub-Breakeven'; mstatusBreakeven.className = 'mcard-status-pill danger'; }
        if (mdeltaBreakeven) { mdeltaBreakeven.textContent = `-${Math.round(BREAKEVEN_KG_YEAR - annualRoastedKg).toLocaleString('en-IN')} kg deficit (Requires min 3kg roaster)`; mdeltaBreakeven.style.color = 'var(--rose)'; }
      }

      const invLowPct = (annualRoastedKg / INVESTOR_LOW_KG_YEAR) * 100;
      if (mbarInvLow) mbarInvLow.style.width = `${Math.min(100, Math.max(0, invLowPct))}%`;
      if (minfoInvLow) minfoInvLow.textContent = `${invLowPct.toFixed(1)}% of Target Volume`;
      if (annualRoastedKg >= INVESTOR_LOW_KG_YEAR) {
        if (mstatusInvLow) { mstatusInvLow.textContent = '✓ Achieved'; mstatusInvLow.className = 'mcard-status-pill success'; }
        if (mdeltaInvLow) { mdeltaInvLow.textContent = `+${Math.round(annualRoastedKg - INVESTOR_LOW_KG_YEAR).toLocaleString('en-IN')} kg surplus`; mdeltaInvLow.style.color = 'var(--emerald)'; }
      } else {
        if (mstatusInvLow) { mstatusInvLow.textContent = '⚠ Needs Scale'; mstatusInvLow.className = 'mcard-status-pill warning'; }
        if (mdeltaInvLow) { mdeltaInvLow.textContent = `-${Math.round(INVESTOR_LOW_KG_YEAR - annualRoastedKg).toLocaleString('en-IN')} kg deficit (Requires min 5kg roaster)`; mdeltaInvLow.style.color = 'var(--amber)'; }
      }

      const invHighPct = (annualRoastedKg / INVESTOR_HIGH_KG_YEAR) * 100;
      if (mbarInvHigh) mbarInvHigh.style.width = `${Math.min(100, Math.max(0, invHighPct))}%`;
      if (minfoInvHigh) minfoInvHigh.textContent = `${invHighPct.toFixed(1)}% of Target Volume`;
      if (annualRoastedKg >= INVESTOR_HIGH_KG_YEAR) {
        if (mstatusInvHigh) { mstatusInvHigh.textContent = '✓ Scale Achieved'; mstatusInvHigh.className = 'mcard-status-pill success'; }
        if (mdeltaInvHigh) { mdeltaInvHigh.textContent = `+${Math.round(annualRoastedKg - INVESTOR_HIGH_KG_YEAR).toLocaleString('en-IN')} kg surplus`; mdeltaInvHigh.style.color = 'var(--emerald)'; }
      } else {
        if (mstatusInvHigh) { mstatusInvHigh.textContent = '⚠ Needs 5kg–10kg'; mstatusInvHigh.className = 'mcard-status-pill warning'; }
        if (mdeltaInvHigh) { mdeltaInvHigh.textContent = `-${Math.round(INVESTOR_HIGH_KG_YEAR - annualRoastedKg).toLocaleString('en-IN')} kg deficit (Requires 5kg–10kg roaster)`; mdeltaInvHigh.style.color = 'var(--amber)'; }
      }

      if (comparisonTbody) {
        comparisonTbody.innerHTML = ROASTER_TIERS.map((tier) => {
          const tierDaily = batchesPerDay * tier.batchSizeKg * (1 - state.capacityRoastLossPct);
          const tierMonthly = tierDaily * state.operatingDaysPerMonth;
          const tierAnnual = tierDaily * state.operatingDaysPerYear;
          const tierBags = Math.round(tierAnnual * 4);
          const tierRev = tierBags * state.retailPricePerBag;
          const isSelected = tier.batchSizeKg === state.selectedBatchSizeKg;

          let fitBadge = '';
          if (tierAnnual < BREAKEVEN_KG_YEAR) {
            fitBadge = `<span class="status-badge low-stock" style="font-size:0.75rem;">Sub-Breakeven</span>`;
          } else if (tierAnnual < INVESTOR_LOW_KG_YEAR) {
            fitBadge = `<span class="status-badge paid" style="font-size:0.75rem;">Breakeven Floor</span>`;
          } else if (tierAnnual < INVESTOR_HIGH_KG_YEAR) {
            fitBadge = `<span class="status-badge shipped" style="font-size:0.75rem;">1.5x Scale</span>`;
          } else {
            fitBadge = `<span class="status-badge paid" style="font-size:0.75rem; background: var(--emerald-bg); color: var(--emerald); border: 1px solid var(--emerald);">Wholesale 2x+</span>`;
          }

          return `
            <tr style="${isSelected ? 'background: var(--accent-bg); font-weight: 600; border-left: 3px solid var(--accent);' : ''}">
              <td data-label="Batch Size"><strong style="color: ${isSelected ? 'var(--accent)' : 'var(--text-main)'}; font-size: 1rem;">${tier.batchSizeKg.toFixed(1)} kg</strong></td>
              <td data-label="Machine Class">${tier.category}</td>
              <td data-label="Batches / Day">${batchesPerDay.toFixed(1)}</td>
              <td data-label="Daily Output">${tierDaily.toFixed(1)} kg/day</td>
              <td data-label="Monthly Output">${tierMonthly.toFixed(1)} kg/mo</td>
              <td data-label="Annual Output"><strong>${Math.round(tierAnnual).toLocaleString('en-IN')} kg</strong></td>
              <td data-label="250g Bags / Yr">${tierBags.toLocaleString('en-IN')}</td>
              <td data-label="Revenue (@ ₹450)"><strong style="color: var(--emerald); font-size:0.95rem;">₹${tierRev.toLocaleString('en-IN')}</strong></td>
              <td data-label="Milestone Fit">${fitBadge}</td>
              <td data-label="Action">
                <button type="button" class="btn-table-action btn-select-batch" data-batch="${tier.batchSizeKg}" style="width:100%; min-height:42px; ${isSelected ? 'background: var(--accent); color: #fff; font-weight: 700;' : ''}">
                  ${isSelected ? 'Active in Simulator' : 'Select Batch Size'}
                </button>
              </td>
            </tr>
          `;
        }).join('');

        comparisonTbody.querySelectorAll('.btn-select-batch').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            triggerHaptic();
            state.selectedBatchSizeKg = parseFloat((e.currentTarget as HTMLElement).getAttribute('data-batch') || '3.0');
            updateBatchPillsActiveState();
            recalculate();
            notify();
          });
        });
      }
    };

    batchPills.forEach((pill) => {
      pill.addEventListener('click', (e) => {
        triggerHaptic();
        state.selectedBatchSizeKg = parseFloat((e.currentTarget as HTMLElement).getAttribute('data-batch') || '3.0');
        updateBatchPillsActiveState();
        recalculate();
        notify();
      });
    });

    hoursSlider?.addEventListener('input', () => { recalculate(); notify(); });
    cycleSelect?.addEventListener('change', () => { recalculate(); notify(); });
    lossSelect?.addEventListener('change', () => { recalculate(); notify(); });

    recalculate();
  },
};

export default route;
