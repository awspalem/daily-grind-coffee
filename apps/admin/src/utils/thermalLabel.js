// Roastery Thermal Bag Label & QR Code Generator (3" x 4" Industry Standard Layout)
import { QRCodeEncoder } from './qrcode';
export const ROASTERY_LOT_PRESETS = [
    {
        id: 'chikmagalur_attikan',
        name: 'Chikmagalur Attikan Estate Honey',
        slug: 'chikmagalur-attikan-estate-honey',
        region: 'Baba Budan Giri, Karnataka',
        elevation: '1,750m MSL',
        processMethod: 'Pulp Sun-Dried Honey',
        roastLevel: 'Medium-Light',
        dropTemp: '198°C Drop',
        tastingNotes: ['Sugarcane Jaggery', 'Red Apple', 'Hazelnut', 'Caramel'],
        varietal: 'Sln 795 & S9 Arabica',
        recommendedGrind: 'South Indian Filter'
    },
    {
        id: 'araku_red_honey',
        name: 'Araku Valley Red Honey Micro-Lot',
        slug: 'araku-valley-red-honey',
        region: 'Eastern Ghats, Andhra Pradesh',
        elevation: '1,200m MSL',
        processMethod: 'Extended Red Honey',
        roastLevel: 'Light-Medium',
        dropTemp: '195°C Drop',
        tastingNotes: ['Ripe Jackfruit', 'Wild Blossom Honey', 'Orange Peel', 'Floral'],
        varietal: 'Indigenous Tribal Shade Arabica',
        recommendedGrind: 'Pour Over (V60)'
    },
    {
        id: 'ethiopia_yirgacheffe',
        name: 'Ethiopia Yirgacheffe Gedeb',
        slug: 'ethiopia-yirgacheffe-gedeb',
        region: 'Gedeb, Yirgacheffe, Ethiopia',
        elevation: '2,100m MSL',
        processMethod: 'Raised Bed Sun-Dried Natural',
        roastLevel: 'Light Roast',
        dropTemp: '192°C Drop',
        tastingNotes: ['Jasmine Blossom', 'Crisp Bergamot', 'White Peach', 'Honey'],
        varietal: 'Heirloom Micro-Lot',
        recommendedGrind: 'Hario V60 / AeroPress'
    },
    {
        id: 'dawn_patrol',
        name: 'Dawn Patrol Bangalore Roastery Blend',
        slug: 'dawn-patrol-bangalore-blend',
        region: 'Chikmagalur & Coorg, Western Ghats',
        elevation: '1,400m MSL',
        processMethod: 'Washed & Natural Blend',
        roastLevel: 'Medium Roast',
        dropTemp: '204°C Drop',
        tastingNotes: ['Dark Chocolate Fudge', 'Toasted Cashew', 'Caramel', 'Jaggery'],
        varietal: 'Estate Selection 795 & Washed Arabica',
        recommendedGrind: 'South Indian Filter / French Press'
    },
    {
        id: 'midnight_runner',
        name: 'Midnight Runner Dark Espresso',
        slug: 'midnight-runner-dark-espresso',
        region: 'Shevaroys (India) & Antigua (Guatemala)',
        elevation: '1,500m MSL',
        processMethod: 'High-Density Double Washed',
        roastLevel: 'Dark Roast',
        dropTemp: '215°C Drop',
        tastingNotes: ['Dark Dutch Cocoa', 'Caramelized Sugar', 'Smoky Velvet', 'Walnut'],
        varietal: 'Red Bourbon & Typica',
        recommendedGrind: 'Espresso (9-Bar Calibration)'
    }
];
export function generateThermalLabelHTML(config) {
    const baseUrl = config.brewGuideBaseUrl || 'https://daily-grind-storefront.pages.dev';
    const qrTargetUrl = `${baseUrl}/#brew-guide?lot=${encodeURIComponent(config.lotSlug)}&grind=${encodeURIComponent(config.grindType.toLowerCase().replace(/[^a-z0-9]/g, '-'))}&batch=${encodeURIComponent(config.batchId)}`;
    // Render high-precision vector SVG QR Code
    const qrSvg = QRCodeEncoder.renderSVG(qrTargetUrl, {
        size: 110,
        margin: 1,
        darkColor: '#000000',
        lightColor: '#ffffff',
        errorCorrectionLevel: 'M'
    });
    return `
    <div class="thermal-label-container" id="thermal-label-3x4">
      <!-- Outer Label Framing (3" x 4" exact aspect ratio) -->
      <div class="thermal-label-card">
        <!-- Roastery Header Bar -->
        <div class="tl-header">
          <div class="tl-brand-row">
            <span class="tl-logo-icon">☕</span>
            <div class="tl-brand-titles">
              <div class="tl-brand-name">THE DAILY GRIND</div>
              <div class="tl-brand-sub">SPECIALTY COFFEE ROASTERS · BANGALORE</div>
            </div>
          </div>
          <div class="tl-roastery-badge">INDIRANAGAR ROASTERY</div>
        </div>

        <div class="tl-divider-thick"></div>

        <!-- Lot Name & Key Badges -->
        <div class="tl-lot-section">
          <h2 class="tl-lot-title">${config.lotName}</h2>
          <div class="tl-meta-grid">
            <div class="tl-meta-item">
              <span class="tl-meta-label">ORIGIN:</span>
              <span class="tl-meta-val">${config.region}</span>
            </div>
            <div class="tl-meta-item">
              <span class="tl-meta-label">PROCESS:</span>
              <span class="tl-meta-val">${config.processMethod}</span>
            </div>
            <div class="tl-meta-item">
              <span class="tl-meta-label">ELEVATION:</span>
              <span class="tl-meta-val">${config.elevation}</span>
            </div>
            <div class="tl-meta-item">
              <span class="tl-meta-label">PROFILE:</span>
              <span class="tl-meta-val">${config.roastLevel}</span>
            </div>
          </div>
        </div>

        <div class="tl-divider"></div>

        <!-- Sensory Tasting Notes -->
        <div class="tl-sensory-section">
          <div class="tl-sensory-label">CUP PROFILE & TASTING NOTES</div>
          <div class="tl-tasting-tags">
            ${config.tastingNotes.map(n => `<span class="tl-note-pill">● ${n}</span>`).join(' ')}
          </div>
        </div>

        <div class="tl-divider"></div>

        <!-- Production & Bag Specs -->
        <div class="tl-specs-grid">
          <div class="tl-spec-box">
            <span class="tl-spec-label">ROAST DATE</span>
            <span class="tl-spec-val highlight">${config.roastDate}</span>
          </div>
          <div class="tl-spec-box">
            <span class="tl-spec-label">BATCH NO.</span>
            <span class="tl-spec-val font-mono">${config.batchId}</span>
          </div>
          <div class="tl-spec-box">
            <span class="tl-spec-label">GRIND PROFILE</span>
            <span class="tl-spec-val">${config.grindType}</span>
          </div>
          <div class="tl-spec-box">
            <span class="tl-spec-label">NET WEIGHT</span>
            <span class="tl-spec-val highlight">${config.bagSize}</span>
          </div>
        </div>

        <div class="tl-divider-thick"></div>

        <!-- Maya's Brew Guide Dynamic QR Code & Instructions -->
        <div class="tl-qr-footer">
          <div class="tl-qr-wrapper">
            ${qrSvg}
          </div>
          <div class="tl-qr-text">
            <div class="tl-qr-heading">📱 MAYA'S BREW GUIDE</div>
            <p class="tl-qr-desc">
              Scan to dial in exact water temperature, brew ratios, and step-by-step extraction for <strong>${config.lotName}</strong>.
            </p>
            <div class="tl-qr-url">daily-grind-storefront.pages.dev/#brew-guide</div>
          </div>
        </div>

        <!-- Thermal Footer Micro Text -->
        <div class="tl-micro-footer">
          <span>Fresh Micro-Roast · Nitrogen Flushed Pouch · 100% Arabica</span>
          <span>FSSAI: 11224333000456</span>
        </div>
      </div>
    </div>
  `;
}
