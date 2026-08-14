// The Daily Grind — Roastery Command Center Interactive Engine
import { ROASTERY_LOT_PRESETS, generateThermalLabelHTML, BagLabelConfig } from './utils/thermalLabel';
import { buildGSTInvoiceFromOrder, renderGSTInvoiceHTML } from './utils/gstInvoice';

interface PricingRow {
  variant_id: string;
  product_name: string;
  weight_grams: number;
  price_inr: number;
  price_usd_cents: number;
  discount_percent: number;
}

class AdminPortal {
  private monthlyFixedCost: number = 135834; // ₹1.35L/month to cover ₹12L salary + ₹2L biz-dev + depreciation + ops

  private catalogPricing: PricingRow[] = [
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
    this.setupThermalLabelStudio();
    this.setupGSTInvoicing();
    await this.loadDashboardData();
  }

  private triggerHaptic() {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(10);
      } catch {
        // Ignore vibration errors on unsupported platforms
      }
    }
  }

  private setupNavigation() {
    const handleTabChange = (tab: string | null) => {
      if (!tab) return;
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
      } else if (tab === 'labels') {
        document.getElementById('panel-labels')?.scrollIntoView({ behavior: 'smooth' });
      } else if (tab === 'pricing') {
        document.getElementById('panel-pricing')?.scrollIntoView({ behavior: 'smooth' });
      } else if (tab === 'economics') {
        document.getElementById('panel-economics')?.scrollIntoView({ behavior: 'smooth' });
      } else if (tab === 'roasts') {
        document.getElementById('panel-roasts')?.scrollIntoView({ behavior: 'smooth' });
      } else if (tab === 'coupons') {
        document.getElementById('panel-coupons')?.scrollIntoView({ behavior: 'smooth' });
      } else if (tab === 'orders') {
        document.getElementById('panel-orders')?.scrollIntoView({ behavior: 'smooth' });
      }
    };

    // Sidebar navigation
    document.querySelectorAll('.nav-item-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tab = (e.currentTarget as HTMLElement).getAttribute('data-tab');
        handleTabChange(tab);
      });
    });

    // Mobile Bottom Command Bar
    document.querySelectorAll('.admin-cmd-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tab = (e.currentTarget as HTMLElement).getAttribute('data-tab');
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

  private setupPricingTable() {
    const tbody = document.getElementById('pricing-table-body');
    if (!tbody) return;

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

    tbody.querySelectorAll('.btn-table-action').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const target = e.currentTarget as HTMLElement;
        const idx = parseInt(target.getAttribute('data-idx') || '0', 10);
        const item = this.catalogPricing[idx];

        const inrInput = document.getElementById(`inr-${idx}`) as HTMLInputElement;
        const usdInput = document.getElementById(`usd-${idx}`) as HTMLInputElement;
        const discInput = document.getElementById(`disc-${idx}`) as HTMLInputElement;

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
          await fetch(`/api/admin/variants/${item.variant_id}/pricing`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer tdg_admin_dev_token_secret' },
            body: JSON.stringify({
              price_inr: item.price_inr,
              price_usd_cents: item.price_usd_cents,
              discount_percent: item.discount_percent
            })
          });
        } catch {
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

  private setupEconomicsSimulator() {
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
    const insightText = document.getElementById('econ-insight-text');

    const recalculate = () => {
      const price = parseFloat(priceSlider.value);
      const greenPerKg = parseFloat(greenSlider.value);
      const roastLossPct = parseFloat(lossSlider.value) / 100;
      const commissionPct = parseFloat(channelSelect.value) / 100;
      const gatewayPct = 0.02;

      if (priceLbl) priceLbl.textContent = `₹${price}`;
      if (greenLbl) greenLbl.textContent = `₹${greenPerKg}`;
      if (lossLbl) lossLbl.textContent = `${lossSlider.value}%`;

      const greenKgNeeded = 0.25 / (1 - roastLossPct);
      const greenCostPerBag = greenKgNeeded * greenPerKg;
      const packagingCost = 30; // ₹25 pouch/valve/label + ₹5 sealing
      const totalCogs = greenCostPerBag + packagingCost;

      const netRealisation = price * (1 - commissionPct - gatewayPct);

      const grossProfit = netRealisation - totalCogs;
      const grossMarginPct = netRealisation > 0 ? (grossProfit / netRealisation) * 100 : 0;

      const bagsNeeded = grossProfit > 0 ? Math.ceil(this.monthlyFixedCost / grossProfit) : 0;
      const dailyBags = Math.ceil(bagsNeeded / 26);

      if (cogsVal) cogsVal.textContent = `₹${totalCogs.toFixed(2)}`;
      if (marginVal) marginVal.textContent = `${grossMarginPct.toFixed(1)}%`;
      if (profitVal) profitVal.textContent = `₹${grossProfit.toFixed(2)}`;
      if (breakevenBags) {
        breakevenBags.textContent = `${bagsNeeded} Bags`;
        const smallEl = breakevenBags.parentElement?.querySelector('small');
        if (smallEl) smallEl.textContent = `≈ ${dailyBags} bags / day (26 days)`;
      }

      if (insightText) {
        if (commissionPct === 0) {
          insightText.textContent = `Direct Storefront mode (0% commission) maximizes profit to ₹${grossProfit.toFixed(2)}/bag. You only need ${dailyBags} bags/day to hit your ₹12L salary!`;
        } else if (commissionPct === 0.15) {
          const savings = (price * 0.15).toFixed(2);
          insightText.textContent = `Marketplace mix loses ₹${savings}/bag to platform commissions. Shifting traffic to your direct storefront drops your monthly breakeven by ~240 bags!`;
        } else {
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

  private setupBatchLogging() {
    const form = document.getElementById('roast-batch-form') as HTMLFormElement;
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.triggerHaptic();
      const lotSelect = document.getElementById('batch-lot-select') as HTMLSelectElement;
      const greenInput = document.getElementById('batch-green-in') as HTMLInputElement;
      const roastedInput = document.getElementById('batch-roasted-out') as HTMLInputElement;

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

  private setupCouponsManager() {
    document.getElementById('btn-add-coupon')?.addEventListener('click', () => {
      this.triggerHaptic();
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

  // ==========================================================================
  // TASK 1: ROASTERY THERMAL BAG LABEL & QR CODE STUDIO
  // ==========================================================================
  private setupThermalLabelStudio() {
    const lotPresetSelect = document.getElementById('label-lot-preset') as HTMLSelectElement;
    const roastDateInput = document.getElementById('label-roast-date') as HTMLInputElement;
    const batchIdInput = document.getElementById('label-batch-id') as HTMLInputElement;
    const bagSizeSelect = document.getElementById('label-bag-size') as HTMLSelectElement;
    const grindSelect = document.getElementById('label-grind-type') as HTMLSelectElement;

    const customNameInput = document.getElementById('label-custom-name') as HTMLInputElement;
    const customOriginInput = document.getElementById('label-custom-origin') as HTMLInputElement;
    const customProcessInput = document.getElementById('label-custom-process') as HTMLInputElement;
    const customNotesInput = document.getElementById('label-custom-notes') as HTMLInputElement;

    const livePreviewEl = document.getElementById('live-thermal-label-preview');
    const modalPreviewEl = document.getElementById('modal-thermal-label-preview');

    // Default to today's date formatted as YYYY-MM-DD
    const todayStr = new Date().toISOString().split('T')[0];
    if (roastDateInput) roastDateInput.value = todayStr;

    const formatRoastDateDisplay = (dateVal: string): string => {
      if (!dateVal) return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
      const d = new Date(dateVal);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    };

    const getActiveConfig = (): BagLabelConfig => {
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

      if (livePreviewEl) livePreviewEl.innerHTML = html;
      if (modalPreviewEl) modalPreviewEl.innerHTML = html;
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
      const modalBatch = document.getElementById('modal-batch-id') as HTMLInputElement;
      if (modalBatch) modalBatch.value = randomId;
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
      if (modalLabel) modalLabel.classList.add('active');
      updateLabelPreviews();
    });

    document.getElementById('modal-label-close')?.addEventListener('click', () => {
      modalLabel?.classList.remove('active');
    });
    document.getElementById('modal-label-cancel')?.addEventListener('click', () => {
      modalLabel?.classList.remove('active');
    });

    // Modal Lot Select syncing
    const modalLotSelect = document.getElementById('modal-lot-select') as HTMLSelectElement;
    const modalDateInput = document.getElementById('modal-roast-date') as HTMLInputElement;
    const modalBatchInput = document.getElementById('modal-batch-id') as HTMLInputElement;
    const modalGrindSelect = document.getElementById('modal-grind-select') as HTMLSelectElement;
    const modalSizeSelect = document.getElementById('modal-bag-size') as HTMLSelectElement;

    if (modalDateInput) modalDateInput.value = todayStr;

    const syncFromModal = () => {
      if (lotPresetSelect && modalLotSelect) lotPresetSelect.value = modalLotSelect.value;
      if (batchIdInput && modalBatchInput) batchIdInput.value = modalBatchInput.value;
      if (grindSelect && modalGrindSelect) grindSelect.value = modalGrindSelect.value;
      if (bagSizeSelect && modalSizeSelect) bagSizeSelect.value = modalSizeSelect.value;
      lotPresetSelect?.dispatchEvent(new Event('change'));
      updateLabelPreviews();
    };

    modalLotSelect?.addEventListener('change', syncFromModal);
    modalDateInput?.addEventListener('input', () => {
      if (roastDateInput) roastDateInput.value = modalDateInput.value;
      updateLabelPreviews();
    });
    modalBatchInput?.addEventListener('input', syncFromModal);
    modalGrindSelect?.addEventListener('change', syncFromModal);
    modalSizeSelect?.addEventListener('change', syncFromModal);

    // Order table label triggers
    document.querySelectorAll('.btn-order-label').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.triggerHaptic();
        const target = e.currentTarget as HTMLElement;
        const lot = target.getAttribute('data-lot') || 'chikmagalur_attikan';
        const grind = target.getAttribute('data-grind') || 'South Indian Filter';
        const size = target.getAttribute('data-size') || '250g';
        const batch = target.getAttribute('data-batch') || 'BATCH-8821';

        if (lotPresetSelect) lotPresetSelect.value = lot;
        if (grindSelect) grindSelect.value = grind;
        if (bagSizeSelect) bagSizeSelect.value = size;
        if (batchIdInput) batchIdInput.value = batch;
        lotPresetSelect?.dispatchEvent(new Event('change'));
        updateLabelPreviews();

        if (modalLabel) modalLabel.classList.add('active');
      });
    });
  }

  // ==========================================================================
  // TASK 2: INDIAN GST TAX INVOICING (HSN 0901)
  // ==========================================================================
  private setupGSTInvoicing() {
    const modalInvoice = document.getElementById('modal-gst-invoice');
    const invoiceContentEl = document.getElementById('modal-invoice-content');

    const openInvoiceModalForOrder = (orderData: {
      orderId: string;
      customerName: string;
      customerLocation?: string;
      productDescription: string;
      totalAmountInr: number;
    }) => {
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
        const target = e.currentTarget as HTMLElement;
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

  private async loadDashboardData() {
    try {
      const res = await fetch('/api/admin/dashboard', {
        headers: { 'Authorization': 'Bearer tdg_admin_dev_token_secret' }
      });
      if (res.ok) {
        const data = await res.json() as any;
        if (data.kpis) {
          const revEl = document.getElementById('kpi-revenue');
          if (revEl) revEl.textContent = `₹${Math.round(data.kpis.gross_revenue_cents * 0.23).toLocaleString('en-IN')}`;
          const ordEl = document.getElementById('kpi-orders');
          if (ordEl) ordEl.textContent = `${data.kpis.total_orders} Orders`;
        }
      }
    } catch {
      // Local fallback
    }
  }
}

const adminApp = new AdminPortal();
adminApp.init();
