import { triggerHaptic } from './shared';
import { ROASTERY_LOT_PRESETS, generateThermalLabelHTML, BagLabelConfig } from '../utils/thermalLabel';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-labels" style="border-left: 4px solid var(--accent);">
    <div class="panel-header">
      <div>
        <h2 class="panel-title">Printable Roastery Thermal Bag Label &amp; QR Studio</h2>
        <span style="font-size: 0.85rem; color: var(--text-muted);">Configure &amp; 1-click print 3"x4" high-contrast thermal bag labels with dynamic QR codes for Maya's brew guide</span>
      </div>
      <span style="background: var(--accent-bg); color: var(--accent); padding: 0.3rem 0.8rem; border-radius: var(--radius-pill); font-size: 0.8rem; font-weight:700;">
        3" x 4" Direct Thermal / 300 DPI Ready
      </span>
    </div>

    <div style="padding: 1.6rem;">
      <div class="label-generator-grid">
        <div class="label-form-wrap">
          <div class="label-input-group">
            <label for="label-lot-preset">Select Coffee Lot</label>
            <select id="label-lot-preset">
              <option value="chikmagalur_attikan">Chikmagalur Attikan Estate Honey (Baba Budan Giri · 1,750m)</option>
              <option value="araku_red_honey">Araku Valley Red Honey Micro-Lot (Eastern Ghats · 1,200m)</option>
              <option value="ethiopia_yirgacheffe">Ethiopia Yirgacheffe Gedeb (Heirloom · 2,100m)</option>
              <option value="dawn_patrol">Dawn Patrol Bangalore Roastery Blend (Chikmagalur & Coorg · 1,400m)</option>
              <option value="midnight_runner">Midnight Runner Dark Espresso (Shevaroys & Antigua · 1,500m)</option>
              <option value="custom">Custom Roastery Lot / Special Reserve</option>
            </select>
          </div>

          <div class="label-form-row">
            <div class="label-input-group">
              <label for="label-roast-date">Roast Date</label>
              <input type="date" id="label-roast-date">
            </div>
            <div class="label-input-group">
              <label for="label-batch-id">Roaster Batch ID</label>
              <div style="display: flex; gap: 0.4rem;">
                <input type="text" id="label-batch-id" value="BATCH-8821" style="flex:1;">
                <button type="button" class="btn-table-action" id="btn-gen-batch-id" title="Generate New Batch ID" style="padding: 0.4rem 0.7rem;">⚂</button>
              </div>
            </div>
          </div>

          <div class="label-form-row">
            <div class="label-input-group">
              <label for="label-bag-size">Bag Net Weight</label>
              <select id="label-bag-size">
                <option value="250g" selected>250g (Standard Specialty Pouch)</option>
                <option value="500g">500g (Roastery Value Pack)</option>
                <option value="1kg">1kg / 1000g (Bulk Silo Pack)</option>
              </select>
            </div>
            <div class="label-input-group">
              <label for="label-grind-type">Grind Profile</label>
              <select id="label-grind-type">
                <option value="South Indian Filter" selected>South Indian Filter Kaapi</option>
                <option value="Whole Bean">Whole Bean (Optimal Freshness)</option>
                <option value="Hario V60 / Pour Over">Hario V60 / Pour Over</option>
                <option value="AeroPress">AeroPress Inverted</option>
                <option value="French Press">French Press / Cold Brew</option>
                <option value="Espresso (9-Bar)">Espresso (9-Bar Calibrated)</option>
                <option value="Moka Pot">Moka Pot / Stovetop</option>
              </select>
            </div>
          </div>

          <div id="custom-lot-fields" style="display: flex; flex-direction: column; gap: 0.8rem; background: var(--admin-surface); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--admin-border);">
            <div class="label-form-row">
              <div class="label-input-group">
                <label for="label-custom-name">Display Lot Name</label>
                <input type="text" id="label-custom-name" value="Chikmagalur Attikan Estate Honey">
              </div>
              <div class="label-input-group">
                <label for="label-custom-origin">Region / Origin</label>
                <input type="text" id="label-custom-origin" value="Baba Budan Giri, Karnataka">
              </div>
            </div>
            <div class="label-form-row">
              <div class="label-input-group">
                <label for="label-custom-process">Process &amp; Elevation</label>
                <input type="text" id="label-custom-process" value="Pulp Sun-Dried Honey · 1,750m MSL">
              </div>
              <div class="label-input-group">
                <label for="label-custom-notes">Tasting Notes (comma-separated)</label>
                <input type="text" id="label-custom-notes" value="Sugarcane Jaggery, Red Apple, Hazelnut, Caramel">
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 0.8rem; flex-wrap: wrap; margin-top: 0.5rem;">
            <button type="button" class="btn-admin-action" id="btn-print-thermal-label" style="background: var(--accent); font-size: 0.95rem; padding: 0.8rem 1.6rem;">
              Print 3"x4" Thermal Bag Label
            </button>
            <button type="button" class="btn-table-action" id="btn-copy-brew-link" style="padding: 0.8rem 1.2rem;">
              Copy Maya's Brew Link
            </button>
            <button type="button" class="btn-table-action" id="btn-reset-label-form" style="padding: 0.8rem 1rem;">
              Reset
            </button>
          </div>
        </div>

        <div class="thermal-preview-container">
          <div style="font-size: 0.76rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; display: flex; align-items: center; gap: 0.4rem;">
            <span>Live 3"x4" Thermal Label Preview</span>
            <span style="color: var(--emerald);">● QR Active</span>
          </div>
          <div id="live-thermal-label-preview"></div>
        </div>
      </div>
    </div>
  </section>
`;

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;

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

    const todayStr = new Date().toISOString().split('T')[0];
    if (roastDateInput) roastDateInput.value = todayStr;

    const formatRoastDateDisplay = (dateVal: string): string => {
      if (!dateVal) return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
      return new Date(dateVal).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    };

    const getActiveConfig = (): BagLabelConfig => {
      const selectedPresetId = lotPresetSelect?.value || 'chikmagalur_attikan';
      const preset = ROASTERY_LOT_PRESETS.find((p) => p.id === selectedPresetId);

      let lotName = preset?.name || customNameInput.value || 'Chikmagalur Attikan Estate Honey';
      let lotSlug = preset?.slug || 'chikmagalur-attikan-estate-honey';
      let region = preset?.region || customOriginInput.value || 'Baba Budan Giri, Karnataka';
      let processMethod = preset?.processMethod || customProcessInput.value || 'Pulp Sun-Dried Honey';
      let elevation = preset?.elevation || '1,750m MSL';
      let roastLevel = preset?.roastLevel || 'Medium-Light';
      let tastingNotes = preset?.tastingNotes || customNotesInput.value.split(',').map((s) => s.trim()).filter(Boolean);

      if (selectedPresetId === 'custom') {
        lotName = customNameInput.value || 'Bangalore Roastery Special Reserve';
        lotSlug = lotName.toLowerCase().replace(/[^a-z0-9]/g, '-');
        region = customOriginInput.value || 'Chikmagalur, Karnataka';
        processMethod = customProcessInput.value || 'Specialty Honey Process';
        elevation = '1,650m MSL';
        roastLevel = 'Medium-Light';
        tastingNotes = customNotesInput.value ? customNotesInput.value.split(',').map((s) => s.trim()).filter(Boolean) : ['Sweet Jaggery', 'Fruit Notes', 'Chocolate'];
      }

      return {
        lotName, lotSlug, region, elevation, processMethod, roastLevel, tastingNotes,
        roastDate: formatRoastDateDisplay(roastDateInput.value),
        batchId: batchIdInput.value.trim() || 'BATCH-8821',
        grindType: grindSelect.value,
        bagSize: bagSizeSelect.value,
        roasteryLocation: 'Indiranagar Roastery, Bangalore',
      };
    };

    const updateLabelPreview = () => {
      if (livePreviewEl) livePreviewEl.innerHTML = generateThermalLabelHTML(getActiveConfig());
    };

    lotPresetSelect?.addEventListener('change', () => {
      triggerHaptic();
      const preset = ROASTERY_LOT_PRESETS.find((p) => p.id === lotPresetSelect.value);
      if (preset) {
        customNameInput.value = preset.name;
        customOriginInput.value = preset.region;
        customProcessInput.value = `${preset.processMethod} · ${preset.elevation}`;
        customNotesInput.value = preset.tastingNotes.join(', ');
        grindSelect.value = preset.recommendedGrind.includes('Filter') ? 'South Indian Filter' :
          preset.recommendedGrind.includes('Espresso') ? 'Espresso (9-Bar)' :
          preset.recommendedGrind.includes('V60') ? 'Hario V60 / Pour Over' : 'Whole Bean';
      }
      updateLabelPreview();
    });

    [roastDateInput, batchIdInput, bagSizeSelect, grindSelect, customNameInput, customOriginInput, customProcessInput, customNotesInput]
      .forEach((el) => el?.addEventListener('input', updateLabelPreview));

    document.getElementById('btn-gen-batch-id')?.addEventListener('click', () => {
      triggerHaptic();
      batchIdInput.value = `BATCH-${Math.floor(1000 + Math.random() * 9000)}`;
      updateLabelPreview();
    });

    document.getElementById('btn-copy-brew-link')?.addEventListener('click', () => {
      triggerHaptic();
      const config = getActiveConfig();
      const link = `https://dailyroast.in/#brew-guide?lot=${encodeURIComponent(config.lotSlug)}&grind=${encodeURIComponent(config.grindType.toLowerCase().replace(/[^a-z0-9]/g, '-'))}&batch=${encodeURIComponent(config.batchId)}`;
      navigator.clipboard?.writeText(link).then(() => {
        const btn = document.getElementById('btn-copy-brew-link');
        if (btn) {
          btn.textContent = 'Copied Maya Link!';
          setTimeout(() => { btn.textContent = "Copy Maya's Brew Link"; }, 1500);
        }
      }).catch(() => {
        prompt("Copy Maya's Brew Guide Direct URL:", link);
      });
    });

    document.getElementById('btn-reset-label-form')?.addEventListener('click', () => {
      triggerHaptic();
      lotPresetSelect.value = 'chikmagalur_attikan';
      lotPresetSelect.dispatchEvent(new Event('change'));
      batchIdInput.value = 'BATCH-8821';
      bagSizeSelect.value = '250g';
      roastDateInput.value = todayStr;
      updateLabelPreview();
    });

    document.getElementById('btn-print-thermal-label')?.addEventListener('click', () => {
      triggerHaptic();
      document.body.classList.remove('print-gst-invoice');
      document.body.classList.add('print-thermal-label');
      window.print();
      setTimeout(() => document.body.classList.remove('print-thermal-label'), 1000);
    });

    updateLabelPreview();
  },
};

export default route;
