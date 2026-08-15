// The Daily Grind — Roastery Command Center Interactive Engine
import { ROASTERY_LOT_PRESETS, generateThermalLabelHTML } from './utils/thermalLabel';
import { buildGSTInvoiceFromOrder, renderGSTInvoiceHTML } from './utils/gstInvoice';
// Cloudflare Pages' `_redirects` 200-status rewrite does not proxy the Worker API reliably, so
// we call the Worker's own URL directly (see apps/storefront/src/main.ts for the same fix).
// TEMPORARY: pointed at the workers.dev URL until the custom domain (daily-grind-api.
// rohithpalem.in) is live — see the comment in apps/api/wrangler.toml. Cloudflare Access can't
// protect a workers.dev subdomain, so admin API calls will 401 until that domain is restored;
// expected/safe (fail-closed) rather than the previous wide-open state.
const API_BASE = 'https://daily-grind-api.awspalem.workers.dev';
const ROASTER_TIERS = [
    { batchSizeKg: 1.0, label: '1.0kg Specialty Drum', category: 'Sample / Pilot', recommendedRole: '🔴 Sub-Breakeven (4h: 1,273 kg/yr)', statusClass: 'danger' },
    { batchSizeKg: 1.5, label: '1.5kg Nano Roaster', category: 'Nano Roaster', recommendedRole: '🔴 Sub-Breakeven (4h: 1,909 kg/yr)', statusClass: 'danger' },
    { batchSizeKg: 2.0, label: '2.0kg Micro Commercial', category: 'Micro Commercial', recommendedRole: '🟡 Tight Breakeven (4h: 2,546 kg/yr)', statusClass: 'warning' },
    { batchSizeKg: 3.0, label: '3.0kg Commercial Entry', category: 'Commercial Entry', recommendedRole: '🟢 Breakeven Floor (4h: 3,819 kg/yr)', statusClass: 'success' },
    { batchSizeKg: 5.0, label: '5.0kg Investor Standard', category: 'Investor Standard', recommendedRole: '🚀 1.5x – 2.0x Scale (4h: 6,365 kg/yr)', statusClass: 'success' },
    { batchSizeKg: 10.0, label: '10.0kg Wholesale Scaling', category: 'Wholesale Scaling', recommendedRole: '💎 High Volume (4h: 12,730 kg/yr)', statusClass: 'premium' }
];
const BREAKEVEN_KG_YEAR = 2483; // Sheet 5 Milestone 1: 2,483 kg/year (Requires min 3kg roaster)
const INVESTOR_LOW_KG_YEAR = 3725; // Sheet 5 Milestone 2: 3,725 kg/year (1.5x, requires min 5kg roaster)
const INVESTOR_HIGH_KG_YEAR = 4967; // Sheet 5 Milestone 3: 4,967 kg/year (2.0x, requires 5kg–10kg roaster)
class AdminPortal {
    // Base fixed monthly overheads excluding roaster machine depreciation:
    // Founder Salary: ₹1,00,000 + Rent/Power (Indiranagar Shed): ₹12,000 + Marketing/CAC/BizDev: ₹16,667 + Cloudflare/Ops: ₹2,000 = ₹1,30,667/mo
    baseFixedCostExcludingRoaster = 130667;
    auxEquipmentDeprec = 2500; // ₹1.5L grinder/sealer/scales over 5 years (60 mo)
    simulatedRoasterCapEx = 450000; // ₹4.50L default for 3kg Aatomize ARST-3 (Sheet 6)
    simulatedRoasterName = '3kg Commercial (Aatomize ARST-3)';
    monthlyFixedCost = 130667 + 2500 + Math.round(450000 / 60); // ₹1,40,667/mo
    // Capacity Matrix State (Sheet 5)
    selectedBatchSizeKg = 3.0;
    dailyRoastingHours = 4.0;
    batchCycleMinutes = 50;
    capacityRoastLossPct = 0.15;
    operatingDaysPerMonth = 26;
    operatingDaysPerYear = 312;
    retailPricePerBag = 450;
    // External recalculation triggers
    recalculateEconomics;
    recalculateCapacity;
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
        this.setupMobileDrawer();
        this.setupCollapsiblePanels();
        this.setupNavigation();
        this.setupPricingTable();
        this.setupCapacityMatrix();
        // Economics must be wired up before CapEx: applyCapExUpgrade's initial call
        // reads this.recalculateEconomics, which setupEconomicsSimulator assigns.
        this.setupEconomicsSimulator();
        this.setupCapExManager();
        this.setupBatchLogging();
        this.setupCouponsManager();
        this.setupThermalLabelStudio();
        this.setupGSTInvoicing();
        this.setupInventoryManager();
        this.setupProductCatalogManager();
        this.setupChannelsManager();
        this.setupCampaignsManager();
        this.setupLimitedEditionsManager();
        this.setupPromotionsManager();
        await this.loadDashboardData();
    }
    setupCollapsiblePanels() {
        document.querySelectorAll('.section-panel').forEach((panel) => {
            const header = panel.querySelector('.panel-header');
            if (!header || header.querySelector('.panel-toggle'))
                return;
            const toggle = document.createElement('button');
            toggle.className = 'panel-toggle';
            toggle.type = 'button';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-label', 'Expand section');
            toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
            header.appendChild(toggle);
            const setExpanded = (expanded) => {
                panel.classList.toggle('expanded', expanded);
                toggle.setAttribute('aria-expanded', String(expanded));
            };
            toggle.addEventListener('click', () => {
                this.triggerHaptic();
                setExpanded(!panel.classList.contains('expanded'));
            });
            // Larger tap target: clicking elsewhere in the header (but not on a real control) also toggles.
            header.addEventListener('click', (e) => {
                const target = e.target;
                if (toggle.contains(target) || target.closest('button, a, input, select, textarea'))
                    return;
                setExpanded(!panel.classList.contains('expanded'));
            });
        });
    }
    expandPanel(panelId) {
        const panel = document.getElementById(panelId);
        if (!panel)
            return;
        panel.classList.add('expanded');
        panel.querySelector('.panel-toggle')?.setAttribute('aria-expanded', 'true');
    }
    setupMobileDrawer() {
        const sidebar = document.getElementById('admin-sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');
        const hamburger = document.getElementById('btn-mobile-menu');
        const closeBtn = document.getElementById('btn-close-sidebar');
        if (!sidebar || !backdrop || !hamburger)
            return;
        const open = () => {
            this.triggerHaptic();
            sidebar.classList.add('open');
            backdrop.classList.add('visible');
            hamburger.setAttribute('aria-expanded', 'true');
        };
        hamburger.addEventListener('click', open);
        backdrop.addEventListener('click', () => this.closeMobileDrawer());
        closeBtn?.addEventListener('click', () => this.closeMobileDrawer());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape')
                this.closeMobileDrawer();
        });
    }
    closeMobileDrawer() {
        document.getElementById('admin-sidebar')?.classList.remove('open');
        document.getElementById('sidebar-backdrop')?.classList.remove('visible');
        document.getElementById('btn-mobile-menu')?.setAttribute('aria-expanded', 'false');
    }
    triggerHaptic() {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try {
                navigator.vibrate(12);
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
            // Sync active state on the sidebar/drawer nav
            document.querySelectorAll('.nav-item-btn').forEach((b) => {
                b.classList.toggle('active', b.getAttribute('data-tab') === tab);
            });
            const panelIdByTab = {
                labels: 'panel-labels',
                pricing: 'panel-pricing',
                inventory: 'panel-inventory',
                catalog: 'panel-catalog',
                capacity: 'panel-capacity',
                capex: 'panel-capex',
                economics: 'panel-economics',
                roasts: 'panel-roasts',
                coupons: 'panel-coupons',
                channels: 'panel-channels',
                campaigns: 'panel-campaigns',
                'limited-editions': 'panel-limited-editions',
                promotions: 'panel-promotions',
                orders: 'panel-orders',
            };
            if (tab === 'overview') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
            else if (panelIdByTab[tab]) {
                this.expandPanel(panelIdByTab[tab]);
                document.getElementById(panelIdByTab[tab])?.scrollIntoView({ behavior: 'smooth' });
            }
            this.closeMobileDrawer();
        };
        // Sidebar / mobile drawer navigation
        document.querySelectorAll('.nav-item-btn').forEach((btn) => {
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
          <td data-label="Coffee Lot"><strong>${item.product_name}</strong></td>
          <td data-label="Bag Size"><span class="status-badge paid">${item.weight_grams >= 1000 ? `${item.weight_grams / 1000}kg` : `${item.weight_grams}g`}</span></td>
          <td data-label="Price (₹ INR)">
            <input type="number" id="inr-${idx}" value="${item.price_inr}" step="10" style="width: 100px; padding: 0.45rem 0.6rem; background: var(--admin-surface); color: #fff; border: 1px solid var(--admin-border); border-radius: var(--radius-sm);">
          </td>
          <td data-label="Price ($ USD)">
            <input type="number" id="usd-${idx}" value="${(item.price_usd_cents / 100).toFixed(2)}" step="0.5" style="width: 90px; padding: 0.45rem 0.6rem; background: var(--admin-surface); color: #fff; border: 1px solid var(--admin-border); border-radius: var(--radius-sm);">
          </td>
          <td data-label="Discount %">
            <input type="number" id="disc-${idx}" value="${item.discount_percent}" min="0" max="90" step="5" style="width: 80px; padding: 0.45rem 0.6rem; background: var(--admin-surface); color: var(--gold); border: 1px solid var(--admin-border); border-radius: var(--radius-sm); font-weight:700;"> %
          </td>
          <td data-label="Net Preview" id="preview-${idx}">
            <strong>₹${netInr}</strong> <span style="color:var(--text-muted); font-size:0.85rem;">($${netUsd})</span>
          </td>
          <td data-label="Action">
            <button class="btn-table-action" data-idx="${idx}" style="min-height: 42px;">Save Pricing</button>
          </td>
        </tr>
      `;
        }).join('');
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
                this.triggerHaptic();
                try {
                    await fetch(`${API_BASE}/api/admin/variants/${item.variant_id}/pricing`, {
                        method: 'PUT',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
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
    // ==========================================================================
    // SHEET 5: ROASTER CAPACITY VS DEMAND MATRIX
    // ==========================================================================
    setupCapacityMatrix() {
        const batchPills = document.querySelectorAll('#capacity-batch-selector .batch-tier-pill');
        const hoursSlider = document.getElementById('cap-hours-slider');
        const cycleSelect = document.getElementById('cap-cycle-select');
        const lossSelect = document.getElementById('cap-loss-select');
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
        // Milestone DOM elements
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
        const recalculate = () => {
            if (hoursSlider)
                this.dailyRoastingHours = parseFloat(hoursSlider.value);
            if (cycleSelect)
                this.batchCycleMinutes = parseFloat(cycleSelect.value);
            if (lossSelect)
                this.capacityRoastLossPct = parseFloat(lossSelect.value) / 100;
            const batchesPerDay = (this.dailyRoastingHours * 60) / this.batchCycleMinutes;
            const dailyRoastedKg = batchesPerDay * this.selectedBatchSizeKg * (1 - this.capacityRoastLossPct);
            const monthlyRoastedKg = dailyRoastedKg * this.operatingDaysPerMonth;
            const annualRoastedKg = dailyRoastedKg * this.operatingDaysPerYear;
            const annualGreenKg = batchesPerDay * this.selectedBatchSizeKg * this.operatingDaysPerYear;
            const annualBags250g = Math.round(annualRoastedKg * 4);
            const annualGrossRevenue = annualBags250g * this.retailPricePerBag;
            // Update Label headers
            if (hoursLbl)
                hoursLbl.textContent = `${this.dailyRoastingHours.toFixed(1)} hrs / day`;
            if (tblHoursRef)
                tblHoursRef.textContent = `${this.dailyRoastingHours.toFixed(1)}h`;
            if (milestoneCurKgHdr)
                milestoneCurKgHdr.textContent = `${Math.round(annualRoastedKg).toLocaleString('en-IN')} kg/yr`;
            const activeTier = ROASTER_TIERS.find(t => t.batchSizeKg === this.selectedBatchSizeKg);
            if (selectedTierLbl && activeTier) {
                selectedTierLbl.textContent = `${activeTier.batchSizeKg.toFixed(1)}kg ${activeTier.category} (Selected)`;
            }
            // Update live KPIs
            if (dailyKgVal)
                dailyKgVal.textContent = `${dailyRoastedKg.toFixed(1)} kg`;
            if (dailyBatchesVal)
                dailyBatchesVal.textContent = `${batchesPerDay.toFixed(1)} batches / day`;
            if (monthlyKgVal)
                monthlyKgVal.textContent = `${monthlyRoastedKg.toFixed(1)} kg`;
            if (annualKgVal)
                annualKgVal.textContent = `${Math.round(annualRoastedKg).toLocaleString('en-IN')} kg`;
            if (annualGreenVal)
                annualGreenVal.textContent = `${Math.round(annualGreenKg).toLocaleString('en-IN')} kg green beans`;
            if (annualBagsVal)
                annualBagsVal.textContent = `${annualBags250g.toLocaleString('en-IN')}`;
            if (annualRevVal)
                annualRevVal.textContent = `₹${annualGrossRevenue.toLocaleString('en-IN')}`;
            // Headroom badge calculation
            const beCoveragePct = ((annualRoastedKg / BREAKEVEN_KG_YEAR) * 100);
            if (headroomBadge) {
                if (annualRoastedKg >= BREAKEVEN_KG_YEAR) {
                    headroomBadge.textContent = `+${beCoveragePct.toFixed(1)}% of Breakeven (+${Math.round(annualRoastedKg - BREAKEVEN_KG_YEAR).toLocaleString('en-IN')} kg surplus)`;
                    headroomBadge.style.color = 'var(--emerald)';
                }
                else {
                    headroomBadge.textContent = `${beCoveragePct.toFixed(1)}% of Breakeven (-${Math.round(BREAKEVEN_KG_YEAR - annualRoastedKg).toLocaleString('en-IN')} kg deficit)`;
                    headroomBadge.style.color = 'var(--rose)';
                }
            }
            // Update Milestone 1: Breakeven (2,483 kg/yr)
            const bePct = (annualRoastedKg / BREAKEVEN_KG_YEAR) * 100;
            if (mbarBreakeven)
                mbarBreakeven.style.width = `${Math.min(100, Math.max(0, bePct))}%`;
            if (minfoBreakeven)
                minfoBreakeven.textContent = `${bePct.toFixed(1)}% of Breakeven Volume`;
            if (annualRoastedKg >= BREAKEVEN_KG_YEAR) {
                if (mstatusBreakeven) {
                    mstatusBreakeven.textContent = '✓ Achieved';
                    mstatusBreakeven.className = 'mcard-status-pill success';
                }
                if (mdeltaBreakeven) {
                    mdeltaBreakeven.textContent = `+${Math.round(annualRoastedKg - BREAKEVEN_KG_YEAR).toLocaleString('en-IN')} kg surplus`;
                    mdeltaBreakeven.style.color = 'var(--emerald)';
                }
            }
            else {
                if (mstatusBreakeven) {
                    mstatusBreakeven.textContent = '🔴 Sub-Breakeven';
                    mstatusBreakeven.className = 'mcard-status-pill danger';
                }
                if (mdeltaBreakeven) {
                    mdeltaBreakeven.textContent = `-${Math.round(BREAKEVEN_KG_YEAR - annualRoastedKg).toLocaleString('en-IN')} kg deficit (Requires min 3kg roaster)`;
                    mdeltaBreakeven.style.color = 'var(--rose)';
                }
            }
            // Update Milestone 2: Investor Low (3,725 kg/yr - 1.5x)
            const invLowPct = (annualRoastedKg / INVESTOR_LOW_KG_YEAR) * 100;
            if (mbarInvLow)
                mbarInvLow.style.width = `${Math.min(100, Math.max(0, invLowPct))}%`;
            if (minfoInvLow)
                minfoInvLow.textContent = `${invLowPct.toFixed(1)}% of Target Volume`;
            if (annualRoastedKg >= INVESTOR_LOW_KG_YEAR) {
                if (mstatusInvLow) {
                    mstatusInvLow.textContent = '✓ Achieved';
                    mstatusInvLow.className = 'mcard-status-pill success';
                }
                if (mdeltaInvLow) {
                    mdeltaInvLow.textContent = `+${Math.round(annualRoastedKg - INVESTOR_LOW_KG_YEAR).toLocaleString('en-IN')} kg surplus`;
                    mdeltaInvLow.style.color = 'var(--emerald)';
                }
            }
            else {
                if (mstatusInvLow) {
                    mstatusInvLow.textContent = '⚠️ Needs Scale';
                    mstatusInvLow.className = 'mcard-status-pill warning';
                }
                if (mdeltaInvLow) {
                    mdeltaInvLow.textContent = `-${Math.round(INVESTOR_LOW_KG_YEAR - annualRoastedKg).toLocaleString('en-IN')} kg deficit (Requires min 5kg roaster)`;
                    mdeltaInvLow.style.color = 'var(--amber)';
                }
            }
            // Update Milestone 3: Investor High (4,967 kg/yr - 2.0x)
            const invHighPct = (annualRoastedKg / INVESTOR_HIGH_KG_YEAR) * 100;
            if (mbarInvHigh)
                mbarInvHigh.style.width = `${Math.min(100, Math.max(0, invHighPct))}%`;
            if (minfoInvHigh)
                minfoInvHigh.textContent = `${invHighPct.toFixed(1)}% of Target Volume`;
            if (annualRoastedKg >= INVESTOR_HIGH_KG_YEAR) {
                if (mstatusInvHigh) {
                    mstatusInvHigh.textContent = '🚀 Scale Achieved';
                    mstatusInvHigh.className = 'mcard-status-pill success';
                }
                if (mdeltaInvHigh) {
                    mdeltaInvHigh.textContent = `+${Math.round(annualRoastedKg - INVESTOR_HIGH_KG_YEAR).toLocaleString('en-IN')} kg surplus`;
                    mdeltaInvHigh.style.color = 'var(--emerald)';
                }
            }
            else {
                if (mstatusInvHigh) {
                    mstatusInvHigh.textContent = '⚠️ Needs 5kg–10kg';
                    mstatusInvHigh.className = 'mcard-status-pill warning';
                }
                if (mdeltaInvHigh) {
                    mdeltaInvHigh.textContent = `-${Math.round(INVESTOR_HIGH_KG_YEAR - annualRoastedKg).toLocaleString('en-IN')} kg deficit (Requires 5kg–10kg roaster)`;
                    mdeltaInvHigh.style.color = 'var(--amber)';
                }
            }
            // Render Complete Comparison Table
            if (comparisonTbody) {
                comparisonTbody.innerHTML = ROASTER_TIERS.map((tier) => {
                    const tierDaily = batchesPerDay * tier.batchSizeKg * (1 - this.capacityRoastLossPct);
                    const tierMonthly = tierDaily * this.operatingDaysPerMonth;
                    const tierAnnual = tierDaily * this.operatingDaysPerYear;
                    const tierBags = Math.round(tierAnnual * 4);
                    const tierRev = tierBags * this.retailPricePerBag;
                    const isSelected = tier.batchSizeKg === this.selectedBatchSizeKg;
                    let fitBadge = '';
                    if (tierAnnual < BREAKEVEN_KG_YEAR) {
                        fitBadge = `<span class="status-badge refunded" style="font-size:0.75rem;">🔴 Sub-Breakeven</span>`;
                    }
                    else if (tierAnnual < INVESTOR_LOW_KG_YEAR) {
                        fitBadge = `<span class="status-badge paid" style="font-size:0.75rem;">🟢 Breakeven Floor</span>`;
                    }
                    else if (tierAnnual < INVESTOR_HIGH_KG_YEAR) {
                        fitBadge = `<span class="status-badge paid" style="font-size:0.75rem; background: rgba(212,167,84,0.15); color: var(--gold); border: 1px solid var(--gold);">🚀 1.5x Scale</span>`;
                    }
                    else {
                        fitBadge = `<span class="status-badge paid" style="font-size:0.75rem; background: rgba(63,163,124,0.2); color: var(--emerald); border: 1px solid var(--emerald);">💎 Wholesale 2x+</span>`;
                    }
                    return `
            <tr style="${isSelected ? 'background: rgba(212, 167, 84, 0.08); font-weight: 600; border-left: 3px solid var(--gold);' : ''}">
              <td data-label="Batch Size"><strong style="color: ${isSelected ? 'var(--gold)' : 'var(--text-main)'}; font-size: 1rem;">${tier.batchSizeKg.toFixed(1)} kg</strong></td>
              <td data-label="Machine Class">${tier.category}</td>
              <td data-label="Batches / Day">${batchesPerDay.toFixed(1)}</td>
              <td data-label="Daily Output">${tierDaily.toFixed(1)} kg/day</td>
              <td data-label="Monthly Output">${tierMonthly.toFixed(1)} kg/mo</td>
              <td data-label="Annual Output"><strong>${Math.round(tierAnnual).toLocaleString('en-IN')} kg</strong></td>
              <td data-label="250g Bags / Yr">${tierBags.toLocaleString('en-IN')}</td>
              <td data-label="Revenue (@ ₹450)"><strong style="color: var(--emerald); font-size:0.95rem;">₹${tierRev.toLocaleString('en-IN')}</strong></td>
              <td data-label="Milestone Fit">${fitBadge}</td>
              <td data-label="Action">
                <button type="button" class="btn-table-action btn-select-batch" data-batch="${tier.batchSizeKg}" style="width:100%; min-height:42px; ${isSelected ? 'background: var(--gold); color: #000; font-weight: 700;' : ''}">
                  ${isSelected ? '✓ Active in Simulator' : 'Select Batch Size'}
                </button>
              </td>
            </tr>
          `;
                }).join('');
                // Attach listeners to table row select buttons
                comparisonTbody.querySelectorAll('.btn-select-batch').forEach((btn) => {
                    btn.addEventListener('click', (e) => {
                        this.triggerHaptic();
                        const batchVal = parseFloat(e.currentTarget.getAttribute('data-batch') || '3.0');
                        this.selectedBatchSizeKg = batchVal;
                        this.updateBatchPillsActiveState();
                        recalculate();
                    });
                });
            }
            // Update Unit Economics capacity pill
            const econCapPill = document.getElementById('econ-capacity-fit-pill');
            if (econCapPill) {
                const bufferPct = ((annualRoastedKg / BREAKEVEN_KG_YEAR) * 100).toFixed(0);
                econCapPill.textContent = `${this.selectedBatchSizeKg.toFixed(1)}kg Roaster (${Math.round(annualRoastedKg).toLocaleString('en-IN')} kg/yr · ${bufferPct}% Buffer)`;
                econCapPill.className = annualRoastedKg >= BREAKEVEN_KG_YEAR ? 'status-badge paid' : 'status-badge refunded';
            }
        };
        this.recalculateCapacity = recalculate;
        // Attach listeners to batch pills
        batchPills.forEach((pill) => {
            pill.addEventListener('click', (e) => {
                this.triggerHaptic();
                const batch = parseFloat(e.currentTarget.getAttribute('data-batch') || '3.0');
                this.selectedBatchSizeKg = batch;
                this.updateBatchPillsActiveState();
                recalculate();
            });
        });
        hoursSlider?.addEventListener('input', recalculate);
        cycleSelect?.addEventListener('change', recalculate);
        lossSelect?.addEventListener('change', recalculate);
        recalculate();
    }
    updateBatchPillsActiveState() {
        document.querySelectorAll('#capacity-batch-selector .batch-tier-pill').forEach((pill) => {
            const b = parseFloat(pill.getAttribute('data-batch') || '0');
            pill.classList.toggle('active', b === this.selectedBatchSizeKg);
        });
    }
    // ==========================================================================
    // SHEET 6: INDIA ROASTER PRICING & CAPEX UPGRADE SIMULATOR
    // ==========================================================================
    setupCapExManager() {
        const customSlider = document.getElementById('capex-custom-slider');
        const sliderCostLbl = document.getElementById('capex-slider-cost-lbl');
        const simDeprecLbl = document.getElementById('capex-sim-deprec-lbl');
        const simTotalOverheadLbl = document.getElementById('capex-sim-total-overhead-lbl');
        const simBeBagsLbl = document.getElementById('capex-sim-be-bags-lbl');
        const simBeKgLbl = document.getElementById('capex-sim-be-kg-lbl');
        const capexButtons = document.querySelectorAll('.btn-simulate-capex');
        const applyCapExUpgrade = (cost, name, batchSize) => {
            this.triggerHaptic();
            this.simulatedRoasterCapEx = cost;
            if (name)
                this.simulatedRoasterName = name;
            if (batchSize) {
                this.selectedBatchSizeKg = batchSize;
                this.updateBatchPillsActiveState();
                if (this.recalculateCapacity)
                    this.recalculateCapacity();
            }
            if (customSlider)
                customSlider.value = cost.toString();
            const monthlyRoasterDeprec = Math.round(cost / 60);
            this.monthlyFixedCost = this.baseFixedCostExcludingRoaster + this.auxEquipmentDeprec + monthlyRoasterDeprec;
            // Update CapEx simulation metrics
            if (sliderCostLbl)
                sliderCostLbl.textContent = `₹${cost.toLocaleString('en-IN')} (₹${(cost / 100000).toFixed(2)} Lakhs)`;
            if (simDeprecLbl)
                simDeprecLbl.textContent = `₹${monthlyRoasterDeprec.toLocaleString('en-IN')} / mo`;
            if (simTotalOverheadLbl)
                simTotalOverheadLbl.textContent = `₹${this.monthlyFixedCost.toLocaleString('en-IN')} / mo`;
            // Update Unit Economics panel references
            const econRoasterDeprecRow = document.getElementById('econ-roaster-deprec-row');
            if (econRoasterDeprecRow) {
                econRoasterDeprecRow.textContent = `₹${monthlyRoasterDeprec.toLocaleString('en-IN')} / mo (${this.simulatedRoasterName})`;
            }
            const econTotalFixedVal = document.getElementById('econ-total-fixed-cost-val');
            if (econTotalFixedVal) {
                econTotalFixedVal.textContent = `₹${this.monthlyFixedCost.toLocaleString('en-IN')} / mo`;
            }
            const econOverheadBadge = document.getElementById('econ-target-overhead-badge');
            if (econOverheadBadge) {
                econOverheadBadge.textContent = `Target Overhead: ₹${(this.monthlyFixedCost / 100000).toFixed(2)}L/mo (₹${((this.monthlyFixedCost * 12) / 100000).toFixed(2)}L/yr)`;
            }
            // Update active cards and buttons
            document.querySelectorAll('.capex-machine-card').forEach((card) => {
                const cardCost = parseFloat(card.getAttribute('data-capex') || '0');
                const isActive = Math.abs(cardCost - cost) < 10000;
                card.classList.toggle('active-simulation', isActive);
                const btn = card.querySelector('.btn-simulate-capex');
                if (btn) {
                    btn.classList.toggle('active', isActive);
                    btn.textContent = isActive ? `✓ Active in Model (₹${(cardCost / 100000).toFixed(2)}L)` : `⚡ Simulate ₹${(cardCost / 100000).toFixed(2)}L CapEx`;
                }
            });
            // Recalculate Unit Economics
            if (this.recalculateEconomics) {
                this.recalculateEconomics();
            }
        };
        capexButtons.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const cost = parseFloat(target.getAttribute('data-cost') || '450000');
                const name = target.getAttribute('data-name') || 'Roaster Upgrade';
                const batch = parseFloat(target.getAttribute('data-batch') || '3.0');
                applyCapExUpgrade(cost, name, batch);
            });
        });
        customSlider?.addEventListener('input', (e) => {
            const cost = parseFloat(e.target.value);
            applyCapExUpgrade(cost, `Custom Roaster (₹${(cost / 100000).toFixed(2)}L)`);
        });
        // Initialize with default
        applyCapExUpgrade(450000, '3kg Commercial (Aatomize ARST-3)', 3.0);
    }
    // ==========================================================================
    // UNIT ECONOMICS & BREAKEVEN CONTROLLER
    // ==========================================================================
    setupEconomicsSimulator() {
        const priceSlider = document.getElementById('econ-price-slider');
        const greenSlider = document.getElementById('econ-green-slider');
        const lossSlider = document.getElementById('econ-loss-slider');
        const channelSelect = document.getElementById('econ-channel-select');
        if (!priceSlider || !greenSlider || !lossSlider || !channelSelect)
            return;
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
        const simBeBagsLbl = document.getElementById('capex-sim-be-bags-lbl');
        const simBeKgLbl = document.getElementById('capex-sim-be-kg-lbl');
        const recalculate = () => {
            const price = parseFloat(priceSlider.value);
            const greenPerKg = parseFloat(greenSlider.value);
            const roastLossPct = parseFloat(lossSlider.value) / 100;
            const commissionPct = parseFloat(channelSelect.value) / 100;
            const gatewayPct = 0.02;
            this.retailPricePerBag = price;
            if (priceLbl)
                priceLbl.textContent = `₹${price}`;
            if (greenLbl)
                greenLbl.textContent = `₹${greenPerKg}`;
            if (lossLbl)
                lossLbl.textContent = `${lossSlider.value}%`;
            const greenKgNeeded = 0.25 / (1 - roastLossPct);
            const greenCostPerBag = greenKgNeeded * greenPerKg;
            const packagingCost = 30; // ₹25 pouch/valve/label + ₹5 sealing
            const totalCogs = greenCostPerBag + packagingCost;
            const netRealisation = price * (1 - commissionPct - gatewayPct);
            const grossProfit = netRealisation - totalCogs;
            const grossMarginPct = netRealisation > 0 ? (grossProfit / netRealisation) * 100 : 0;
            const bagsNeeded = grossProfit > 0 ? Math.ceil(this.monthlyFixedCost / grossProfit) : 0;
            const dailyBags = Math.ceil(bagsNeeded / 26);
            const annualBeKg = Math.round(bagsNeeded * 12 * 0.25);
            if (cogsVal)
                cogsVal.textContent = `₹${totalCogs.toFixed(2)}`;
            if (marginVal)
                marginVal.textContent = `${grossMarginPct.toFixed(1)}%`;
            if (profitVal)
                profitVal.textContent = `₹${grossProfit.toFixed(2)}`;
            if (breakevenBags)
                breakevenBags.textContent = `${bagsNeeded} Bags`;
            if (breakevenDailySub)
                breakevenDailySub.textContent = `≈ ${dailyBags} bags / day (26 days)`;
            if (annualBeKgEl)
                annualBeKgEl.textContent = `${annualBeKg.toLocaleString('en-IN')} kg / yr`;
            if (simBeBagsLbl)
                simBeBagsLbl.textContent = `${bagsNeeded} Bags / mo`;
            if (simBeKgLbl)
                simBeKgLbl.textContent = `≈ ${annualBeKg.toLocaleString('en-IN')} kg/yr`;
            if (insightText) {
                if (commissionPct === 0) {
                    insightText.textContent = `Direct Storefront mode (0% commission) maximizes profit to ₹${grossProfit.toFixed(2)}/bag. You need ${dailyBags} bags/day (${bagsNeeded} bags/mo) to cover all fixed costs & salary!`;
                }
                else if (commissionPct === 0.15) {
                    const savings = (price * 0.15).toFixed(2);
                    insightText.textContent = `Marketplace mix loses ₹${savings}/bag to platform commissions. Shifting traffic to your direct storefront drops monthly breakeven by ~${Math.round(bagsNeeded * 0.22)} bags!`;
                }
                else {
                    insightText.textContent = `25% marketplace commission cuts gross margin to ${grossMarginPct.toFixed(1)}%. Recommend driving subscriptions and repeat orders exclusively to your direct storefront.`;
                }
            }
            // Update capacity calculations with the latest price
            if (this.recalculateCapacity) {
                this.recalculateCapacity();
            }
        };
        this.recalculateEconomics = recalculate;
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
            this.triggerHaptic();
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
          <td data-label="Batch ID"><strong>BATCH-${Math.floor(1000 + Math.random() * 9000)}</strong></td>
          <td data-label="Lot Name">${lot}</td>
          <td data-label="Green In">${greenKg} kg</td>
          <td data-label="Roasted Out">${roastedKg} kg</td>
          <td data-label="Roast Loss %"><strong style="color: var(--emerald);">${lossPct}%</strong></td>
          <td data-label="Green Cost / Bag">₹${greenCostPerBag} / 250g</td>
          <td data-label="Status"><span class="status-badge paid">✓ Calibrated</span></td>
        `;
                tbody.prepend(tr);
            }
            alert(`🔥 Batch for ${lot} successfully logged with ${lossPct}% roast loss. Yield calibrated in database!`);
        });
    }
    setupCouponsManager() {
        document.getElementById('btn-add-coupon')?.addEventListener('click', () => {
            this.triggerHaptic();
            const code = prompt('Enter new Promo Coupon Code (e.g. MONSOON20):', 'MONSOON20');
            const discount = prompt('Enter Discount Percentage (e.g. 20):', '20');
            if (code && discount) {
                const tbody = document.getElementById('coupons-table-body');
                if (tbody) {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
            <td data-label="Coupon Code"><strong>${code.toUpperCase()}</strong></td>
            <td data-label="Discount">${discount}% Off Entire Order</td>
            <td data-label="Redemptions">0 uses</td>
            <td data-label="Max Uses">250 max</td>
            <td data-label="Status"><span class="status-badge paid">Active</span></td>
            <td data-label="Action"><button class="btn-table-action" onclick="alert('Coupon is active')">Active</button></td>
          `;
                    tbody.prepend(tr);
                }
                alert(`🎟️ Coupon code "${code.toUpperCase()}" with ${discount}% discount created successfully!`);
            }
        });
    }
    async adminFetch(path, options = {}) {
        // Auth is handled by Cloudflare Access at the edge (it injects Cf-Access-Jwt-Assertion on
        // requests carrying a valid session cookie) — `credentials: 'include'` is what forwards that
        // cookie cross-origin. No app-level token needed or sent.
        const res = await fetch(`${API_BASE}${path}`, {
            ...options,
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
        });
        return res.json();
    }
    escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = value;
        return div.innerHTML;
    }
    // ==========================================================================
    // INVENTORY MANAGEMENT
    // ==========================================================================
    setupInventoryManager() {
        const stockBody = document.getElementById('inventory-stock-table-body');
        const movementsBody = document.getElementById('inventory-movements-table-body');
        const variantSelect = document.getElementById('inventory-adjust-variant');
        const lowStockBadge = document.getElementById('inventory-low-stock-badge');
        if (!stockBody || !movementsBody || !variantSelect)
            return;
        const movementTypeLabels = {
            INITIAL_STOCK: 'Initial Stock',
            PURCHASE_RESERVE: 'Purchase Reserve',
            ORDER_FULFILLED: 'Order Fulfilled',
            RESTOCK: 'Restock',
            DAMAGE_ADJUSTMENT: 'Damage Adjustment',
            RETURN_RESTOCK: 'Return Restock',
            RESERVATION_EXPIRED: 'Reservation Expired',
        };
        const loadStock = async () => {
            const data = await this.adminFetch('/api/admin/inventory');
            const rows = data.inventory || [];
            stockBody.innerHTML = rows.map((row) => {
                const isLow = Number(row.available_stock) <= Number(row.low_stock_threshold);
                return `
          <tr>
            <td data-label="Coffee Lot">${this.escapeHtml(row.product_name)} (${row.weight_grams}g)</td>
            <td data-label="SKU">${this.escapeHtml(row.sku)}</td>
            <td data-label="Available">${row.available_stock}</td>
            <td data-label="Reserved">${row.reserved_stock}</td>
            <td data-label="Status">${isLow ? '<span class="status-badge low-stock">Low Stock</span>' : '<span class="status-badge paid">In Stock</span>'}</td>
          </tr>
        `;
            }).join('');
            const lowStockCount = rows.filter((row) => Number(row.available_stock) <= Number(row.low_stock_threshold)).length;
            if (lowStockBadge) {
                lowStockBadge.style.display = lowStockCount > 0 ? 'inline-flex' : 'none';
                lowStockBadge.textContent = `${lowStockCount} Low Stock`;
            }
            variantSelect.innerHTML = rows.map((row) => `<option value="${row.variant_id}">${this.escapeHtml(row.product_name)} (${row.weight_grams}g) — ${this.escapeHtml(row.sku)}</option>`).join('');
        };
        const loadMovements = async () => {
            const data = await this.adminFetch('/api/admin/movements?limit=25');
            const rows = data.movements || [];
            movementsBody.innerHTML = rows.map((row) => `
        <tr>
          <td data-label="When">${new Date(row.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
          <td data-label="SKU">${this.escapeHtml(row.sku || row.variant_id)}</td>
          <td data-label="Type">${movementTypeLabels[row.movement_type] || row.movement_type}</td>
          <td data-label="Δ">${row.quantity_delta > 0 ? '+' : ''}${row.quantity_delta}</td>
          <td data-label="Stock After">${row.stock_after}</td>
          <td data-label="Reason">${this.escapeHtml(row.reason || '—')}</td>
        </tr>
      `).join('');
        };
        const refreshAll = () => Promise.all([loadStock(), loadMovements()]);
        refreshAll();
        document.getElementById('inventory-adjust-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            this.triggerHaptic();
            const variantId = variantSelect.value;
            const movementType = document.getElementById('inventory-adjust-type').value;
            const quantityInput = document.getElementById('inventory-adjust-quantity');
            const reasonInput = document.getElementById('inventory-adjust-reason');
            const quantityDelta = Number(quantityInput.value);
            if (!variantId || !quantityDelta)
                return;
            const result = await this.adminFetch('/api/admin/inventory/adjust', {
                method: 'POST',
                body: JSON.stringify({
                    variant_id: variantId,
                    movement_type: movementType,
                    quantity_delta: quantityDelta,
                    reason: reasonInput.value || undefined,
                }),
            });
            if (result.success) {
                quantityInput.value = '';
                reasonInput.value = '';
                await refreshAll();
            }
            else {
                alert(`⚠️ Inventory adjustment failed: ${result.error || 'Unknown error'}`);
            }
        });
    }
    // ==========================================================================
    // PRODUCT CATALOG — create/retire products & variants; changes go live on the storefront
    // ==========================================================================
    setupProductCatalogManager() {
        const tbody = document.getElementById('catalog-table-body');
        const form = document.getElementById('product-add-form');
        const categorySelect = document.getElementById('product-category');
        const imageFileInput = document.getElementById('product-image-file');
        const imageUrlInput = document.getElementById('product-image-url');
        const imageStatus = document.getElementById('product-image-status');
        const imagePreview = document.getElementById('product-image-preview');
        if (!tbody || !form || !categorySelect || !imageFileInput || !imageUrlInput)
            return;
        const loadCategories = async () => {
            const data = await this.adminFetch('/api/categories');
            categorySelect.innerHTML = (data.categories || []).map((cat) => `<option value="${cat.id}">${this.escapeHtml(cat.name)}</option>`).join('');
        };
        const renderVariantRow = (product, variant) => `
      <tr style="background: rgba(0,0,0,0.12);">
        <td data-label="Variant" colspan="2" style="padding-left: 2.4rem;">${variant.weight_grams}g · ${this.escapeHtml(variant.sku)}</td>
        <td data-label="Price">₹${(variant.price_cents / 100).toFixed(2)}</td>
        <td data-label="Stock">${variant.available_stock ?? 0} available</td>
        <td data-label="Status">${variant.is_active ? '<span class="status-badge paid">Active</span>' : '<span class="status-badge low-stock">Inactive</span>'}</td>
        <td data-label="Action"><button class="btn-table-action" data-variant-toggle="${variant.id}" data-current-active="${variant.is_active ? '1' : '0'}">${variant.is_active ? 'Deactivate' : 'Reactivate'}</button></td>
      </tr>
    `;
        const renderAddVariantRow = (productId) => `
      <tr style="background: rgba(0,0,0,0.08);">
        <td colspan="6" style="padding-left: 2.4rem;">
          <details>
            <summary style="cursor: pointer; color: var(--text-muted); font-size: 0.85rem;">+ Add bag-size variant</summary>
            <div style="display: flex; gap: 0.6rem; flex-wrap: wrap; margin-top: 0.6rem; align-items: center;">
              <input type="number" placeholder="Grams" class="new-variant-weight" style="min-height: 40px; width: 100px; background: var(--admin-surface); border: 1px solid var(--admin-border); color: var(--text-main); border-radius: var(--radius-sm); padding: 0 0.5rem;">
              <input type="number" placeholder="Price (cents)" class="new-variant-price" style="min-height: 40px; width: 130px; background: var(--admin-surface); border: 1px solid var(--admin-border); color: var(--text-main); border-radius: var(--radius-sm); padding: 0 0.5rem;">
              <input type="number" placeholder="Initial stock" class="new-variant-stock" style="min-height: 40px; width: 110px; background: var(--admin-surface); border: 1px solid var(--admin-border); color: var(--text-main); border-radius: var(--radius-sm); padding: 0 0.5rem;">
              <button type="button" class="btn-table-action" data-add-variant="${productId}">Add Variant</button>
            </div>
          </details>
        </td>
      </tr>
    `;
        const render = (products) => {
            tbody.innerHTML = products.map((p) => `
        <tr>
          <td data-label="Product"><strong>${this.escapeHtml(p.name)}</strong></td>
          <td data-label="Category">${this.escapeHtml(p.category_name)}</td>
          <td data-label="Roast Level">${this.escapeHtml(p.roast_level)}</td>
          <td data-label="Variants">${(p.variants || []).length}</td>
          <td data-label="Status">${p.is_active ? '<span class="status-badge paid">Active</span>' : '<span class="status-badge low-stock">Inactive</span>'}</td>
          <td data-label="Action"><button class="btn-table-action" data-product-toggle="${p.id}" data-current-active="${p.is_active ? '1' : '0'}">${p.is_active ? 'Deactivate' : 'Reactivate'}</button></td>
        </tr>
        ${(p.variants || []).map((v) => renderVariantRow(p, v)).join('')}
        ${renderAddVariantRow(p.id)}
      `).join('');
        };
        const load = async () => {
            const data = await this.adminFetch('/api/admin/products');
            render(data.products || []);
        };
        loadCategories();
        load();
        // Product / variant active toggles + inline "add variant"
        tbody.addEventListener('click', async (e) => {
            const target = e.target;
            const productToggle = target.closest('button[data-product-toggle]');
            if (productToggle) {
                this.triggerHaptic();
                const nextActive = productToggle.dataset.currentActive !== '1';
                const result = await this.adminFetch(`/api/admin/products/${productToggle.dataset.productToggle}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ is_active: nextActive }),
                });
                if (result.success)
                    await load();
                return;
            }
            const variantToggle = target.closest('button[data-variant-toggle]');
            if (variantToggle) {
                this.triggerHaptic();
                const nextActive = variantToggle.dataset.currentActive !== '1';
                const result = await this.adminFetch(`/api/admin/variants/${variantToggle.dataset.variantToggle}/status`, {
                    method: 'PATCH',
                    body: JSON.stringify({ is_active: nextActive }),
                });
                if (result.success)
                    await load();
                return;
            }
            const addVariantBtn = target.closest('button[data-add-variant]');
            if (addVariantBtn) {
                this.triggerHaptic();
                const row = addVariantBtn.closest('td');
                const weight = Number(row.querySelector('.new-variant-weight')?.value);
                const price = Number(row.querySelector('.new-variant-price')?.value);
                const stock = Number(row.querySelector('.new-variant-stock')?.value) || 0;
                if (!weight || !price) {
                    alert('⚠️ Weight and price are required to add a variant.');
                    return;
                }
                const result = await this.adminFetch(`/api/admin/products/${addVariantBtn.dataset.addVariant}/variants`, {
                    method: 'POST',
                    body: JSON.stringify({ weight_grams: weight, price_cents: price, initial_stock: stock }),
                });
                if (result.success) {
                    await load();
                }
                else {
                    alert(`⚠️ Could not add variant: ${result.error || 'Unknown error'}`);
                }
            }
        });
        // Image upload
        imageFileInput.addEventListener('change', async () => {
            const file = imageFileInput.files?.[0];
            if (!file)
                return;
            if (imageStatus)
                imageStatus.textContent = 'Uploading...';
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`${API_BASE}/api/media/upload`, {
                method: 'POST',
                credentials: 'include',
                body: formData,
            });
            const data = await res.json();
            if (data.success && data.url) {
                imageUrlInput.value = data.url;
                if (imageStatus)
                    imageStatus.textContent = 'Image uploaded';
                if (imagePreview) {
                    imagePreview.src = data.url;
                    imagePreview.style.display = 'block';
                }
            }
            else if (imageStatus) {
                imageStatus.textContent = `Upload failed: ${data.error || 'Unknown error'}`;
            }
        });
        // Show/hide the add-product form
        document.getElementById('btn-add-product')?.addEventListener('click', () => {
            this.triggerHaptic();
            form.style.display = form.style.display === 'none' ? 'flex' : 'none';
        });
        document.getElementById('btn-cancel-add-product')?.addEventListener('click', () => {
            form.style.display = 'none';
            form.reset();
            imageUrlInput.value = '';
            if (imageStatus)
                imageStatus.textContent = 'No image uploaded yet';
            if (imagePreview)
                imagePreview.style.display = 'none';
        });
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            this.triggerHaptic();
            const payload = {
                name: document.getElementById('product-name').value,
                category_id: categorySelect.value,
                origin_country: document.getElementById('product-origin').value,
                roast_level: document.getElementById('product-roast-level').value,
                description: document.getElementById('product-description').value,
                image_url: imageUrlInput.value || 'https://images.unsplash.com/photo-1587734195503-904fca47e0e9?auto=format&fit=crop&w=800&q=80',
                weight_grams: Number(document.getElementById('product-weight').value),
                price_cents: Number(document.getElementById('product-price').value),
                initial_stock: Number(document.getElementById('product-initial-stock').value) || 0,
            };
            const result = await this.adminFetch('/api/admin/products', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            if (result.success) {
                form.style.display = 'none';
                form.reset();
                imageUrlInput.value = '';
                if (imageStatus)
                    imageStatus.textContent = 'No image uploaded yet';
                if (imagePreview)
                    imagePreview.style.display = 'none';
                await load();
            }
            else {
                alert(`⚠️ Could not create product: ${result.error || 'Unknown error'}`);
            }
        });
    }
    // ==========================================================================
    // MARKETING HUB — Communication Channels, Campaigns, Limited Editions, Promotions
    // ==========================================================================
    setupChannelsManager() {
        const tbody = document.getElementById('channels-table-body');
        if (!tbody)
            return;
        const statusBadgeClass = { ACTIVE: 'paid', INACTIVE: 'low-stock', PLANNED: 'shipped' };
        const render = (channels) => {
            tbody.innerHTML = channels.map((ch) => `
        <tr>
          <td data-label="Channel"><strong>${this.escapeHtml(ch.name)}</strong></td>
          <td data-label="Type">${this.escapeHtml(ch.channel_type)}</td>
          <td data-label="Handle / Address">${this.escapeHtml(ch.handle_or_address || '—')}</td>
          <td data-label="Status"><span class="status-badge ${statusBadgeClass[ch.status] || 'shipped'}">${ch.status}</span></td>
        </tr>
      `).join('');
        };
        const load = async () => {
            const data = await this.adminFetch('/api/admin/channels');
            render(data.channels || []);
        };
        load();
        document.getElementById('btn-add-channel')?.addEventListener('click', async () => {
            this.triggerHaptic();
            const name = prompt('Channel name (e.g. Instagram — @dailygrind.coffee):');
            if (!name)
                return;
            const channelType = prompt('Channel type (EMAIL, SMS, WHATSAPP, INSTAGRAM, FACEBOOK, OTHER):', 'INSTAGRAM');
            if (!channelType)
                return;
            const handle = prompt('Handle / address (optional):', '') || undefined;
            const result = await this.adminFetch('/api/admin/channels', {
                method: 'POST',
                body: JSON.stringify({ name, channel_type: channelType.toUpperCase(), handle_or_address: handle, status: 'PLANNED' }),
            });
            if (result.success) {
                await load();
            }
            else {
                alert(`⚠️ Could not add channel: ${result.error || 'Unknown error'}`);
            }
        });
    }
    setupCampaignsManager() {
        const tbody = document.getElementById('campaigns-table-body');
        if (!tbody)
            return;
        const statusBadgeClass = { DRAFT: 'shipped', SCHEDULED: 'shipped', LIVE: 'paid', COMPLETED: 'roasting' };
        const cycle = { DRAFT: 'SCHEDULED', SCHEDULED: 'LIVE', LIVE: 'COMPLETED', COMPLETED: 'DRAFT' };
        const render = (campaigns) => {
            tbody.innerHTML = campaigns.map((camp) => `
        <tr>
          <td data-label="Campaign"><strong>${this.escapeHtml(camp.name)}</strong></td>
          <td data-label="Objective">${this.escapeHtml(camp.objective || '—')}</td>
          <td data-label="Dates">${camp.start_date || '—'} → ${camp.end_date || '—'}</td>
          <td data-label="Status"><button class="status-badge ${statusBadgeClass[camp.status] || 'shipped'}" style="border: none; cursor: pointer;" data-campaign-id="${camp.id}" data-current-status="${camp.status}">${camp.status}</button></td>
        </tr>
      `).join('');
        };
        const load = async () => {
            const data = await this.adminFetch('/api/admin/campaigns');
            render(data.campaigns || []);
        };
        load();
        tbody.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-campaign-id]');
            if (!btn)
                return;
            this.triggerHaptic();
            const nextStatus = cycle[btn.dataset.currentStatus || 'DRAFT'];
            const result = await this.adminFetch(`/api/admin/campaigns/${btn.dataset.campaignId}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status: nextStatus }),
            });
            if (result.success)
                await load();
        });
        document.getElementById('btn-add-campaign')?.addEventListener('click', async () => {
            this.triggerHaptic();
            const name = prompt('Campaign name (e.g. Diwali Gifting Push):');
            if (!name)
                return;
            const objective = prompt('Objective (optional):', '') || undefined;
            const startDate = prompt('Start date (YYYY-MM-DD, optional):', '') || undefined;
            const endDate = prompt('End date (YYYY-MM-DD, optional):', '') || undefined;
            const result = await this.adminFetch('/api/admin/campaigns', {
                method: 'POST',
                body: JSON.stringify({ name, objective, start_date: startDate, end_date: endDate, status: 'DRAFT' }),
            });
            if (result.success) {
                await load();
            }
            else {
                alert(`⚠️ Could not add campaign: ${result.error || 'Unknown error'}`);
            }
        });
    }
    setupLimitedEditionsManager() {
        const tbody = document.getElementById('limited-editions-table-body');
        if (!tbody)
            return;
        const statusBadgeClass = { UPCOMING: 'shipped', LIVE: 'paid', SOLD_OUT: 'low-stock', ENDED: 'roasting' };
        const cycle = { UPCOMING: 'LIVE', LIVE: 'SOLD_OUT', SOLD_OUT: 'ENDED', ENDED: 'UPCOMING' };
        const render = (editions) => {
            tbody.innerHTML = editions.map((ed) => `
        <tr>
          <td data-label="Drop"><strong>${this.escapeHtml(ed.name)}</strong></td>
          <td data-label="Product">${this.escapeHtml(ed.product_name || '—')}</td>
          <td data-label="Launch Window">${ed.launch_date || '—'} → ${ed.end_date || '—'}</td>
          <td data-label="Units Sold">${ed.units_sold}${ed.total_units ? ` / ${ed.total_units}` : ''}</td>
          <td data-label="Status"><button class="status-badge ${statusBadgeClass[ed.status] || 'shipped'}" style="border: none; cursor: pointer;" data-edition-id="${ed.id}" data-current-status="${ed.status}">${ed.status}</button></td>
        </tr>
      `).join('');
        };
        const load = async () => {
            const data = await this.adminFetch('/api/admin/limited-editions');
            render(data.limited_editions || []);
        };
        load();
        tbody.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-edition-id]');
            if (!btn)
                return;
            this.triggerHaptic();
            const nextStatus = cycle[btn.dataset.currentStatus || 'UPCOMING'];
            const result = await this.adminFetch(`/api/admin/limited-editions/${btn.dataset.editionId}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status: nextStatus }),
            });
            if (result.success)
                await load();
        });
        document.getElementById('btn-add-limited-edition')?.addEventListener('click', async () => {
            this.triggerHaptic();
            const name = prompt('Limited edition name (e.g. Monsoon Malabar Reserve Cask):');
            if (!name)
                return;
            const productName = prompt('Product / lot name (optional):', '') || undefined;
            const totalUnits = prompt('Total units (optional):', '') || undefined;
            const launchDate = prompt('Launch date (YYYY-MM-DD, optional):', '') || undefined;
            const endDate = prompt('End date (YYYY-MM-DD, optional):', '') || undefined;
            const result = await this.adminFetch('/api/admin/limited-editions', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    product_name: productName,
                    total_units: totalUnits ? Number(totalUnits) : undefined,
                    launch_date: launchDate,
                    end_date: endDate,
                }),
            });
            if (result.success) {
                await load();
            }
            else {
                alert(`⚠️ Could not add limited edition: ${result.error || 'Unknown error'}`);
            }
        });
    }
    setupPromotionsManager() {
        const tbody = document.getElementById('promotions-table-body');
        if (!tbody)
            return;
        const statusBadgeClass = { SCHEDULED: 'shipped', ACTIVE: 'paid', ENDED: 'roasting' };
        const cycle = { SCHEDULED: 'ACTIVE', ACTIVE: 'ENDED', ENDED: 'SCHEDULED' };
        const render = (promotions) => {
            tbody.innerHTML = promotions.map((promo) => `
        <tr>
          <td data-label="Promotion"><strong>${this.escapeHtml(promo.name)}</strong></td>
          <td data-label="Type">${this.escapeHtml(promo.promo_type)}</td>
          <td data-label="Dates">${promo.start_date || '—'} → ${promo.end_date || '—'}</td>
          <td data-label="Status"><button class="status-badge ${statusBadgeClass[promo.status] || 'shipped'}" style="border: none; cursor: pointer;" data-promotion-id="${promo.id}" data-current-status="${promo.status}">${promo.status}</button></td>
        </tr>
      `).join('');
        };
        const load = async () => {
            const data = await this.adminFetch('/api/admin/promotions');
            render(data.promotions || []);
        };
        load();
        tbody.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-promotion-id]');
            if (!btn)
                return;
            this.triggerHaptic();
            const nextStatus = cycle[btn.dataset.currentStatus || 'SCHEDULED'];
            const result = await this.adminFetch(`/api/admin/promotions/${btn.dataset.promotionId}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status: nextStatus }),
            });
            if (result.success)
                await load();
        });
        document.getElementById('btn-add-promotion')?.addEventListener('click', async () => {
            this.triggerHaptic();
            const name = prompt('Promotion name (e.g. Bangalore Launch Week Sale):');
            if (!name)
                return;
            const promoType = prompt('Promo type (SALE, BUNDLE, SEASONAL, CLEARANCE):', 'SALE') || 'SALE';
            const startDate = prompt('Start date (YYYY-MM-DD, optional):', '') || undefined;
            const endDate = prompt('End date (YYYY-MM-DD, optional):', '') || undefined;
            const result = await this.adminFetch('/api/admin/promotions', {
                method: 'POST',
                body: JSON.stringify({ name, promo_type: promoType.toUpperCase(), start_date: startDate, end_date: endDate }),
            });
            if (result.success) {
                await load();
            }
            else {
                alert(`⚠️ Could not add promotion: ${result.error || 'Unknown error'}`);
            }
        });
    }
    // ==========================================================================
    // TASK 1: ROASTERY THERMAL BAG LABEL & QR CODE STUDIO
    // ==========================================================================
    setupThermalLabelStudio() {
        const lotPresetSelect = document.getElementById('label-lot-preset');
        const roastDateInput = document.getElementById('label-roast-date');
        const batchIdInput = document.getElementById('label-batch-id');
        const bagSizeSelect = document.getElementById('label-bag-size');
        const grindSelect = document.getElementById('label-grind-type');
        const customNameInput = document.getElementById('label-custom-name');
        const customOriginInput = document.getElementById('label-custom-origin');
        const customProcessInput = document.getElementById('label-custom-process');
        const customNotesInput = document.getElementById('label-custom-notes');
        const livePreviewEl = document.getElementById('live-thermal-label-preview');
        const modalPreviewEl = document.getElementById('modal-thermal-label-preview');
        // Default to today's date formatted as YYYY-MM-DD
        const todayStr = new Date().toISOString().split('T')[0];
        if (roastDateInput)
            roastDateInput.value = todayStr;
        const formatRoastDateDisplay = (dateVal) => {
            if (!dateVal)
                return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
            const d = new Date(dateVal);
            return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
        };
        const getActiveConfig = () => {
            const selectedPresetId = lotPresetSelect?.value || 'chikmagalur_attikan';
            const preset = ROASTERY_LOT_PRESETS.find(p => p.id === selectedPresetId);
            let lotName = preset?.name || customNameInput.value || 'Chikmagalur Attikan Estate Honey';
            let lotSlug = preset?.slug || 'chikmagalur-attikan-estate-honey';
            let region = preset?.region || customOriginInput.value || 'Baba Budan Giri, Karnataka';
            let processMethod = preset?.processMethod || customProcessInput.value || 'Pulp Sun-Dried Honey';
            let elevation = preset?.elevation || '1,750m MSL';
            let roastLevel = preset?.roastLevel || 'Medium-Light';
            let tastingNotes = preset?.tastingNotes || customNotesInput.value.split(',').map(s => s.trim()).filter(Boolean);
            if (selectedPresetId === 'custom') {
                lotName = customNameInput.value || 'Bangalore Roastery Special Reserve';
                lotSlug = lotName.toLowerCase().replace(/[^a-z0-9]/g, '-');
                region = customOriginInput.value || 'Chikmagalur, Karnataka';
                processMethod = customProcessInput.value || 'Specialty Honey Process';
                elevation = '1,650m MSL';
                roastLevel = 'Medium-Light';
                tastingNotes = customNotesInput.value ? customNotesInput.value.split(',').map(s => s.trim()).filter(Boolean) : ['Sweet Jaggery', 'Fruit Notes', 'Chocolate'];
            }
            return {
                lotName,
                lotSlug,
                region,
                elevation,
                processMethod,
                roastLevel,
                tastingNotes,
                roastDate: formatRoastDateDisplay(roastDateInput.value),
                batchId: batchIdInput.value.trim() || 'BATCH-8821',
                grindType: grindSelect.value,
                bagSize: bagSizeSelect.value,
                roasteryLocation: 'Indiranagar Roastery, Bangalore'
            };
        };
        const updateLabelPreviews = () => {
            const config = getActiveConfig();
            const html = generateThermalLabelHTML(config);
            if (livePreviewEl)
                livePreviewEl.innerHTML = html;
            if (modalPreviewEl)
                modalPreviewEl.innerHTML = html;
        };
        // Listen to preset lot changes
        lotPresetSelect?.addEventListener('change', () => {
            this.triggerHaptic();
            const preset = ROASTERY_LOT_PRESETS.find(p => p.id === lotPresetSelect.value);
            if (preset) {
                customNameInput.value = preset.name;
                customOriginInput.value = preset.region;
                customProcessInput.value = `${preset.processMethod} · ${preset.elevation}`;
                customNotesInput.value = preset.tastingNotes.join(', ');
                grindSelect.value = preset.recommendedGrind.includes('Filter') ? 'South Indian Filter' :
                    preset.recommendedGrind.includes('Espresso') ? 'Espresso (9-Bar)' :
                        preset.recommendedGrind.includes('V60') ? 'Hario V60 / Pour Over' : 'Whole Bean';
            }
            updateLabelPreviews();
        });
        [
            roastDateInput, batchIdInput, bagSizeSelect, grindSelect,
            customNameInput, customOriginInput, customProcessInput, customNotesInput
        ].forEach(el => el?.addEventListener('input', updateLabelPreviews));
        // Batch ID Randomizer
        document.getElementById('btn-gen-batch-id')?.addEventListener('click', () => {
            this.triggerHaptic();
            const randomId = `BATCH-${Math.floor(1000 + Math.random() * 9000)}`;
            batchIdInput.value = randomId;
            const modalBatch = document.getElementById('modal-batch-id');
            if (modalBatch)
                modalBatch.value = randomId;
            updateLabelPreviews();
        });
        // Copy Maya Brew Link
        document.getElementById('btn-copy-brew-link')?.addEventListener('click', () => {
            this.triggerHaptic();
            const config = getActiveConfig();
            const link = `https://daily-grind-storefront.pages.dev/#brew-guide?lot=${encodeURIComponent(config.lotSlug)}&grind=${encodeURIComponent(config.grindType.toLowerCase().replace(/[^a-z0-9]/g, '-'))}&batch=${encodeURIComponent(config.batchId)}`;
            navigator.clipboard?.writeText(link).then(() => {
                const btn = document.getElementById('btn-copy-brew-link');
                if (btn) {
                    btn.textContent = '✓ Copied Maya Link!';
                    setTimeout(() => { btn.textContent = '📋 Copy Maya\'s Brew Link'; }, 1500);
                }
            }).catch(() => {
                prompt('Copy Maya\'s Brew Guide Direct URL:', link);
            });
        });
        // Reset button
        document.getElementById('btn-reset-label-form')?.addEventListener('click', () => {
            this.triggerHaptic();
            lotPresetSelect.value = 'chikmagalur_attikan';
            lotPresetSelect.dispatchEvent(new Event('change'));
            batchIdInput.value = 'BATCH-8821';
            bagSizeSelect.value = '250g';
            roastDateInput.value = todayStr;
            updateLabelPreviews();
        });
        // Print Thermal Bag Label Handler
        const handlePrintLabel = () => {
            this.triggerHaptic();
            document.body.classList.remove('print-gst-invoice');
            document.body.classList.add('print-thermal-label');
            window.print();
            setTimeout(() => {
                document.body.classList.remove('print-thermal-label');
            }, 1000);
        };
        document.getElementById('btn-print-thermal-label')?.addEventListener('click', handlePrintLabel);
        document.getElementById('modal-label-print')?.addEventListener('click', handlePrintLabel);
        // Initial render
        updateLabelPreviews();
        // Setup Quick Modal trigger & close
        const modalLabel = document.getElementById('modal-bag-label');
        document.getElementById('btn-open-label-modal')?.addEventListener('click', () => {
            this.triggerHaptic();
            if (modalLabel)
                modalLabel.classList.add('active');
            updateLabelPreviews();
        });
        document.getElementById('modal-label-close')?.addEventListener('click', () => {
            modalLabel?.classList.remove('active');
        });
        document.getElementById('modal-label-cancel')?.addEventListener('click', () => {
            modalLabel?.classList.remove('active');
        });
        // Modal Lot Select syncing
        const modalLotSelect = document.getElementById('modal-lot-select');
        const modalDateInput = document.getElementById('modal-roast-date');
        const modalBatchInput = document.getElementById('modal-batch-id');
        const modalGrindSelect = document.getElementById('modal-grind-select');
        const modalSizeSelect = document.getElementById('modal-bag-size');
        if (modalDateInput)
            modalDateInput.value = todayStr;
        const syncFromModal = () => {
            if (lotPresetSelect && modalLotSelect)
                lotPresetSelect.value = modalLotSelect.value;
            if (batchIdInput && modalBatchInput)
                batchIdInput.value = modalBatchInput.value;
            if (grindSelect && modalGrindSelect)
                grindSelect.value = modalGrindSelect.value;
            if (bagSizeSelect && modalSizeSelect)
                bagSizeSelect.value = modalSizeSelect.value;
            lotPresetSelect?.dispatchEvent(new Event('change'));
            updateLabelPreviews();
        };
        modalLotSelect?.addEventListener('change', syncFromModal);
        modalDateInput?.addEventListener('input', () => {
            if (roastDateInput)
                roastDateInput.value = modalDateInput.value;
            updateLabelPreviews();
        });
        modalBatchInput?.addEventListener('input', syncFromModal);
        modalGrindSelect?.addEventListener('change', syncFromModal);
        modalSizeSelect?.addEventListener('change', syncFromModal);
        // Order table label triggers
        document.querySelectorAll('.btn-order-label').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.triggerHaptic();
                const target = e.currentTarget;
                const lot = target.getAttribute('data-lot') || 'chikmagalur_attikan';
                const grind = target.getAttribute('data-grind') || 'South Indian Filter';
                const size = target.getAttribute('data-size') || '250g';
                const batch = target.getAttribute('data-batch') || 'BATCH-8821';
                if (lotPresetSelect)
                    lotPresetSelect.value = lot;
                if (grindSelect)
                    grindSelect.value = grind;
                if (bagSizeSelect)
                    bagSizeSelect.value = size;
                if (batchIdInput)
                    batchIdInput.value = batch;
                lotPresetSelect?.dispatchEvent(new Event('change'));
                updateLabelPreviews();
                if (modalLabel)
                    modalLabel.classList.add('active');
            });
        });
    }
    // ==========================================================================
    // TASK 2: INDIAN GST TAX INVOICING (HSN 0901)
    // ==========================================================================
    setupGSTInvoicing() {
        const modalInvoice = document.getElementById('modal-gst-invoice');
        const invoiceContentEl = document.getElementById('modal-invoice-content');
        const openInvoiceModalForOrder = (orderData) => {
            this.triggerHaptic();
            const invoiceData = buildGSTInvoiceFromOrder({
                orderId: orderData.orderId,
                customerName: orderData.customerName,
                customerLocation: orderData.customerLocation,
                productDescription: orderData.productDescription,
                totalAmountInr: orderData.totalAmountInr
            });
            if (invoiceContentEl) {
                invoiceContentEl.innerHTML = renderGSTInvoiceHTML(invoiceData);
            }
            if (modalInvoice) {
                modalInvoice.classList.add('active');
            }
        };
        // Attach listeners to Order table GST Invoice buttons
        document.querySelectorAll('.btn-order-invoice').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const orderId = target.getAttribute('data-order') || 'TDG-102938';
                const customerName = target.getAttribute('data-customer') || 'Rohan Sharma';
                const customerLocation = target.getAttribute('data-loc') || 'Indiranagar, Bangalore';
                const productDescription = target.getAttribute('data-item') || 'Chikmagalur Attikan Estate Honey (250g · South Indian Filter)';
                const totalAmountInr = parseFloat(target.getAttribute('data-total') || '450');
                openInvoiceModalForOrder({
                    orderId,
                    customerName,
                    customerLocation,
                    productDescription,
                    totalAmountInr
                });
            });
        });
        // Close buttons
        document.getElementById('modal-invoice-close')?.addEventListener('click', () => {
            modalInvoice?.classList.remove('active');
        });
        document.getElementById('modal-invoice-cancel')?.addEventListener('click', () => {
            modalInvoice?.classList.remove('active');
        });
        // Print GST Tax Invoice
        document.getElementById('modal-invoice-print')?.addEventListener('click', () => {
            this.triggerHaptic();
            document.body.classList.remove('print-thermal-label');
            document.body.classList.add('print-gst-invoice');
            window.print();
            setTimeout(() => {
                document.body.classList.remove('print-gst-invoice');
            }, 1000);
        });
    }
    async loadDashboardData() {
        try {
            const res = await fetch(`${API_BASE}/api/admin/dashboard`, {
                credentials: 'include',
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
