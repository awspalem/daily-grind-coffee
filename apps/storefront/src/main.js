// Curated Bangalore & Global Specialty Catalog
const FALLBACK_PRODUCTS = [
    {
        id: 'prod_chik_attikan',
        slug: 'chikmagalur-attikan-estate-honey',
        name: 'Chikmagalur Attikan Estate Honey',
        tagline: 'Sweet sugarcane jaggery, red apple & roasted hazelnut',
        description: 'Shade-grown at 1,750m in the Baba Budan Giri range of Chikmagalur, Karnataka. Pulp sun-dried honey process producing a silky, medium body with balanced citric brightness and rich jaggery sweetness.',
        category_id: 'indian-estates',
        origin_country: 'India',
        region: 'Chikmagalur, Karnataka',
        process_method: 'HONEY',
        roast_level: 'MEDIUM_LIGHT',
        tasting_notes: ['Jaggery', 'Red Apple', 'Hazelnut', 'Caramel'],
        image_url: '/images/pour_over.jpg',
        is_active: 1,
        is_featured: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        variants: [
            { id: 'var_att_250', product_id: 'prod_chik_attikan', sku: 'TDG-ATT-250G', weight_grams: 250, price_inr: 450, price_usd_cents: 1850, discount_percent: 0, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'SOUTH_INDIAN_FILTER', 'AEROPRESS'], is_active: 1 },
            { id: 'var_att_500', product_id: 'prod_chik_attikan', sku: 'TDG-ATT-500G', weight_grams: 500, price_inr: 850, price_usd_cents: 3400, discount_percent: 5, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'SOUTH_INDIAN_FILTER', 'AEROPRESS'], is_active: 1 },
            { id: 'var_att_1000', product_id: 'prod_chik_attikan', sku: 'TDG-ATT-1KG', weight_grams: 1000, price_inr: 1600, price_usd_cents: 6200, discount_percent: 10, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'SOUTH_INDIAN_FILTER', 'AEROPRESS'], is_active: 1 }
        ]
    },
    {
        id: 'prod_araku_honey',
        slug: 'araku-valley-red-honey',
        name: 'Araku Valley Red Honey Micro-Lot',
        tagline: 'Ripe jackfruit, wild blossom honey & candied orange peel',
        description: 'Cultivated by indigenous tribal farmers in the Eastern Ghats of Andhra Pradesh. High-elevation shade canopy and extended honey mucilage drying creates immense fruit complexity and buttery body.',
        category_id: 'indian-estates',
        origin_country: 'India',
        region: 'Araku Valley, Andhra Pradesh',
        process_method: 'HONEY',
        roast_level: 'LIGHT_MEDIUM',
        tasting_notes: ['Jackfruit', 'Wild Honey', 'Orange Peel', 'Floral'],
        image_url: '/images/bag_ethiopia.jpg',
        is_active: 1,
        is_featured: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        variants: [
            { id: 'var_ara_250', product_id: 'prod_araku_honey', sku: 'TDG-ARA-250G', weight_grams: 250, price_inr: 490, price_usd_cents: 1950, discount_percent: 0, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'AEROPRESS'], is_active: 1 },
            { id: 'var_ara_500', product_id: 'prod_araku_honey', sku: 'TDG-ARA-500G', weight_grams: 500, price_inr: 920, price_usd_cents: 3600, discount_percent: 5, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'AEROPRESS'], is_active: 1 }
        ]
    },
    {
        id: 'prod_eth_yirg',
        slug: 'ethiopia-yirgacheffe-gedeb',
        name: 'Ethiopia Yirgacheffe Gedeb',
        tagline: 'Floral jasmine, crisp bergamot & sweet white peach',
        description: 'Hand-picked Heirloom micro-lot grown at 2,100 meters elevation in the Gedeb district. Naturally processed with sun-dried fruit fermentation on raised African beds for extraordinary tea-like clarity.',
        category_id: 'international',
        origin_country: 'Ethiopia',
        region: 'Gedeb, Yirgacheffe',
        process_method: 'NATURAL',
        roast_level: 'LIGHT',
        tasting_notes: ['Jasmine', 'Bergamot', 'Peach', 'Honey'],
        image_url: '/images/bag_ethiopia.jpg',
        is_active: 1,
        is_featured: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        variants: [
            { id: 'var_eth_250', product_id: 'prod_eth_yirg', sku: 'TDG-ETH-250G', weight_grams: 250, price_inr: 580, price_usd_cents: 2200, discount_percent: 0, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'AEROPRESS'], is_active: 1 },
            { id: 'var_eth_500', product_id: 'prod_eth_yirg', sku: 'TDG-ETH-500G', weight_grams: 500, price_inr: 1100, price_usd_cents: 4200, discount_percent: 5, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'AEROPRESS'], is_active: 1 }
        ]
    },
    {
        id: 'prod_dawn_blend',
        slug: 'dawn-patrol-bangalore-blend',
        name: 'Dawn Patrol Bangalore Roastery Blend',
        tagline: 'Silky dark chocolate fudge, toasted cashew & sweet caramel',
        description: 'Our flagship morning blend roasted right in Indiranagar. Marrying washed Chikmagalur Arabica with natural Coorg lots for a comforting, robust cup that thrives with milk or black.',
        category_id: 'signature-blends',
        origin_country: 'India (Karnataka)',
        region: 'Chikmagalur & Coorg',
        process_method: 'WASHED_NATURAL',
        roast_level: 'MEDIUM',
        tasting_notes: ['Dark Chocolate', 'Cashew', 'Caramel', 'Jaggery'],
        image_url: '/images/roaster.jpg',
        is_active: 1,
        is_featured: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        variants: [
            { id: 'var_dawn_250', product_id: 'prod_dawn_blend', sku: 'TDG-DP-250G', weight_grams: 250, price_inr: 420, price_usd_cents: 1650, discount_percent: 0, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'SOUTH_INDIAN_FILTER', 'ESPRESSO'], is_active: 1 },
            { id: 'var_dawn_500', product_id: 'prod_dawn_blend', sku: 'TDG-DP-500G', weight_grams: 500, price_inr: 790, price_usd_cents: 3100, discount_percent: 5, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'SOUTH_INDIAN_FILTER', 'ESPRESSO'], is_active: 1 },
            { id: 'var_dawn_1000', product_id: 'prod_dawn_blend', sku: 'TDG-DP-1KG', weight_grams: 1000, price_inr: 1490, price_usd_cents: 5600, discount_percent: 10, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'SOUTH_INDIAN_FILTER', 'ESPRESSO'], is_active: 1 }
        ]
    },
    {
        id: 'prod_mid_runner',
        slug: 'midnight-runner-dark-espresso',
        name: 'Midnight Runner Dark Espresso',
        tagline: 'Dark Dutch cocoa, caramelized brown sugar & smoky velvet',
        description: 'Full-throttle dark roast profile engineered for rich extraction under 9 bars of pressure. Zero astringency, dense tiger stripe crema, and deep chocolate fudge notes.',
        category_id: 'espresso-profiles',
        origin_country: 'India & Guatemala',
        region: 'Shevaroys / Antigua',
        process_method: 'WASHED',
        roast_level: 'DARK',
        tasting_notes: ['Dark Chocolate', 'Molasses', 'Brown Sugar'],
        image_url: '/images/espresso.jpg',
        is_active: 1,
        is_featured: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        variants: [
            { id: 'var_mid_250', product_id: 'prod_mid_runner', sku: 'TDG-MR-250G', weight_grams: 250, price_inr: 440, price_usd_cents: 1750, discount_percent: 0, grind_options: ['WHOLE_BEAN', 'ESPRESSO', 'SOUTH_INDIAN_FILTER', 'MOKA_POT'], is_active: 1 },
            { id: 'var_mid_500', product_id: 'prod_mid_runner', sku: 'TDG-MR-500G', weight_grams: 500, price_inr: 820, price_usd_cents: 3300, discount_percent: 5, grind_options: ['WHOLE_BEAN', 'ESPRESSO', 'SOUTH_INDIAN_FILTER', 'MOKA_POT'], is_active: 1 }
        ]
    },
    {
        id: 'prod_glacier_cb',
        slug: 'glacier-steep-cold-brew-blend',
        name: 'Glacier Steep Cold Brew Blend',
        tagline: 'Smooth dark cacao, sweet vanilla bean & bourbon undertones',
        description: 'Coarse-optimized steep blend designed specifically for 16-24 hour slow immersion cold extractions in Bangalore summers. Naturally sweet, zero acidity, and intensely refreshing over ice.',
        category_id: 'cold-brew',
        origin_country: 'India & Sumatra',
        region: 'Western Ghats',
        process_method: 'NATURAL',
        roast_level: 'MEDIUM_DARK',
        tasting_notes: ['Dark Cacao', 'Vanilla', 'Hazelnut'],
        image_url: '/images/bag_ethiopia.jpg',
        is_active: 1,
        is_featured: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        variants: [
            { id: 'var_gcb_500', product_id: 'prod_glacier_cb', sku: 'TDG-GCB-500G', weight_grams: 500, price_inr: 850, price_usd_cents: 3400, discount_percent: 0, grind_options: ['WHOLE_BEAN', 'COLD_BREW_COARSE'], is_active: 1 },
            { id: 'var_gcb_1000', product_id: 'prod_glacier_cb', sku: 'TDG-GCB-1KG', weight_grams: 1000, price_inr: 1550, price_usd_cents: 6000, discount_percent: 8, grind_options: ['WHOLE_BEAN', 'COLD_BREW_COARSE'], is_active: 1 }
        ]
    }
];
class StorefrontApp {
    products = [];
    cartItems = [];
    activeCategory = 'all';
    activeTastingNote = 'all';
    currentCurrency = 'INR';
    discountPercentage = 0;
    sessionId;
    constructor() {
        this.sessionId = localStorage.getItem('tdg_session_id') || `sess_${Math.random().toString(36).substring(2, 12)}`;
        localStorage.setItem('tdg_session_id', this.sessionId);
        // Load currency preference (default INR)
        const savedCurrency = localStorage.getItem('tdg_currency');
        if (savedCurrency === 'USD' || savedCurrency === 'INR') {
            this.currentCurrency = savedCurrency;
        }
        else {
            this.currentCurrency = 'INR';
        }
        // Load persisted cart
        const savedCart = localStorage.getItem('tdg_cart');
        if (savedCart) {
            try {
                this.cartItems = JSON.parse(savedCart);
            }
            catch {
                this.cartItems = [];
            }
        }
    }
    async init() {
        this.updateCurrencyButtons();
        this.setupEventListeners();
        this.setupBrewCalculator();
        this.setupQuiz();
        this.updateCartUI();
        await this.loadCatalog();
    }
    setCurrency(curr) {
        this.currentCurrency = curr;
        localStorage.setItem('tdg_currency', curr);
        this.updateCurrencyButtons();
        this.renderProducts();
        this.updateCartUI();
        // Update announcement banner threshold
        const badge = document.getElementById('announcement-shipping-badge');
        if (badge) {
            badge.textContent = curr === 'INR' ? 'FREE ROASTERY SHIPPING ACROSS INDIA ON ₹1,200+' : 'FREE EXPRESS SHIPPING ON ORDERS $45+';
        }
    }
    updateCurrencyButtons() {
        const btnInr = document.getElementById('btn-currency-inr');
        const btnUsd = document.getElementById('btn-currency-usd');
        if (this.currentCurrency === 'INR') {
            if (btnInr) {
                btnInr.style.background = 'var(--bg-espresso)';
                btnInr.style.color = '#fff';
            }
            if (btnUsd) {
                btnUsd.style.background = 'transparent';
                btnUsd.style.color = 'var(--text-muted)';
            }
        }
        else {
            if (btnUsd) {
                btnUsd.style.background = 'var(--bg-espresso)';
                btnUsd.style.color = '#fff';
            }
            if (btnInr) {
                btnInr.style.background = 'transparent';
                btnInr.style.color = 'var(--text-muted)';
            }
        }
    }
    formatPrice(priceInr, priceUsdCents) {
        if (this.currentCurrency === 'INR') {
            return `₹${Math.round(priceInr).toLocaleString('en-IN')}`;
        }
        else {
            const cents = priceUsdCents ?? Math.round(priceInr / 23 * 100);
            return `$${(cents / 100).toFixed(2)}`;
        }
    }
    async loadCatalog() {
        try {
            const res = await fetch('/api/products');
            if (res.ok) {
                const data = await res.json();
                if (data.products && data.products.length > 0) {
                    this.products = data.products.map((p) => ({
                        ...p,
                        variants: p.variants.map((v) => ({
                            ...v,
                            price_inr: v.price_inr || Math.round(v.price_cents * 0.23),
                            price_usd_cents: v.price_usd_cents || v.price_cents,
                            discount_percent: v.discount_percent || 0
                        }))
                    }));
                }
                else {
                    this.products = FALLBACK_PRODUCTS;
                }
            }
            else {
                this.products = FALLBACK_PRODUCTS;
            }
        }
        catch {
            this.products = FALLBACK_PRODUCTS;
        }
        this.renderProducts();
    }
    renderProducts() {
        const container = document.getElementById('product-grid-container');
        if (!container)
            return;
        let filtered = this.products;
        if (this.activeCategory !== 'all') {
            filtered = filtered.filter((p) => p.category_id === this.activeCategory || p.slug.includes(this.activeCategory));
        }
        if (this.activeTastingNote !== 'all') {
            filtered = filtered.filter((p) => p.tasting_notes.some((n) => n.toLowerCase().includes(this.activeTastingNote.toLowerCase())));
        }
        if (filtered.length === 0) {
            container.innerHTML = `
        <div style="grid-column: 1/-1; text-align:center; padding: 4rem 1rem; color: var(--text-muted);">
          <p style="font-size: 1.2rem; font-family: var(--font-serif);">No roasts match your exact filter.</p>
          <button class="btn-secondary" style="margin-top:1rem;" onclick="window.storefrontApp.resetFilters()">View All Roasts</button>
        </div>
      `;
            return;
        }
        container.innerHTML = filtered.map((prod) => {
            const defaultVariant = prod.variants[0] || { id: 'v1', weight_grams: 250, price_inr: 450, price_usd_cents: 1850, discount_percent: 0 };
            const notesHtml = prod.tasting_notes.map((n) => `<span class="taste-tag">${n}</span>`).join('');
            const roastScore = prod.roast_level === 'LIGHT' ? 25 : prod.roast_level === 'LIGHT_MEDIUM' ? 45 : prod.roast_level === 'MEDIUM' ? 65 : 90;
            const weightButtons = prod.variants.map((v, idx) => `
        <button class="weight-btn ${idx === 0 ? 'selected' : ''}" data-variant-id="${v.id}" data-price-inr="${v.price_inr}" data-price-usd="${v.price_usd_cents || v.price_cents}" data-discount="${v.discount_percent || 0}" data-weight="${v.weight_grams}">
          ${v.weight_grams >= 1000 ? `${v.weight_grams / 1000}kg` : `${v.weight_grams}g`}
        </button>
      `).join('');
            const formattedPrice = this.formatPrice(defaultVariant.price_inr, defaultVariant.price_usd_cents);
            return `
        <article class="product-card" data-product-id="${prod.id}">
          <div class="card-media">
            <img src="${prod.image_url || '/images/bag_ethiopia.jpg'}" alt="${prod.name}" loading="lazy">
            <span class="origin-badge">${prod.origin_country}</span>
            <span class="roast-level-tag">${prod.roast_level.replace('_', ' ')} ROAST</span>
          </div>

          <div class="card-body">
            <div class="card-title-row">
              <h3 class="card-title">${prod.name}</h3>
            </div>
            <p class="card-tagline">${prod.tagline}</p>

            <div class="tasting-tags-list">
              ${notesHtml}
            </div>

            <div class="roast-meter">
              <span>Light</span>
              <div class="meter-track">
                <div class="meter-fill" style="width: ${roastScore}%;"></div>
              </div>
              <span>Dark</span>
            </div>

            <div class="card-selectors">
              <div class="selector-group">
                <span class="selector-label">Bag Size</span>
                <div class="weight-options" data-prod="${prod.id}">
                  ${weightButtons}
                </div>
              </div>

              <div class="selector-group">
                <span class="selector-label">Grind Type</span>
                <select class="grind-dropdown" id="grind-${prod.id}">
                  <option value="WHOLE_BEAN">Whole Bean (Recommended)</option>
                  <option value="SOUTH_INDIAN_FILTER">South Indian Traditional Filter</option>
                  <option value="POUR_OVER">Pour Over / Chemex / V60</option>
                  <option value="ESPRESSO">Espresso Machine</option>
                  <option value="AEROPRESS">AeroPress</option>
                  <option value="FRENCH_PRESS">French Press</option>
                  <option value="COLD_BREW">Cold Brew Coarse</option>
                </select>
              </div>
            </div>

            <div class="card-footer">
              <div class="card-price" id="price-display-${prod.id}">
                ${formattedPrice}
                <small>/ ${defaultVariant.weight_grams}g</small>
              </div>
              <button class="btn-add-cart" data-action="add-to-cart" data-prod-id="${prod.id}">
                <span>Add to Cart</span>
              </button>
            </div>
          </div>
        </article>
      `;
        }).join('');
        // Attach weight selectors
        document.querySelectorAll('.weight-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const parent = target.parentElement;
                if (!parent)
                    return;
                parent.querySelectorAll('.weight-btn').forEach((b) => b.classList.remove('selected'));
                target.classList.add('selected');
                const prodId = parent.getAttribute('data-prod');
                const priceInr = parseFloat(target.getAttribute('data-price-inr') || '450');
                const priceUsd = parseInt(target.getAttribute('data-price-usd') || '1850', 10);
                const weightGrams = parseInt(target.getAttribute('data-weight') || '250', 10);
                const priceDisplay = document.getElementById(`price-display-${prodId}`);
                if (priceDisplay) {
                    const formatted = this.formatPrice(priceInr, priceUsd);
                    priceDisplay.innerHTML = `${formatted} <small>/ ${weightGrams >= 1000 ? `${weightGrams / 1000}kg` : `${weightGrams}g`}</small>`;
                }
            });
        });
        // Attach Add to Cart clicks
        document.querySelectorAll('[data-action="add-to-cart"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const prodId = target.getAttribute('data-prod-id');
                if (!prodId)
                    return;
                const prod = this.products.find((p) => p.id === prodId);
                if (!prod)
                    return;
                const card = target.closest('.product-card');
                const selectedWeightBtn = card?.querySelector('.weight-btn.selected');
                const variantId = selectedWeightBtn?.getAttribute('data-variant-id') || prod.variants[0]?.id || 'v1';
                const priceInr = parseFloat(selectedWeightBtn?.getAttribute('data-price-inr') || `${prod.variants[0]?.price_inr || 450}`);
                const priceUsd = parseInt(selectedWeightBtn?.getAttribute('data-price-usd') || `${prod.variants[0]?.price_usd_cents || 1850}`, 10);
                const discount = parseInt(selectedWeightBtn?.getAttribute('data-discount') || '0', 10);
                const weightGrams = parseInt(selectedWeightBtn?.getAttribute('data-weight') || `${prod.variants[0]?.weight_grams || 250}`, 10);
                const grindSelect = card?.querySelector('.grind-dropdown');
                const grindType = grindSelect ? grindSelect.value : 'WHOLE_BEAN';
                this.addToCart({
                    id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    product_id: prod.id,
                    variant_id: variantId,
                    name: prod.name,
                    unit_price_inr: priceInr,
                    unit_price_usd_cents: priceUsd,
                    discount_percent: discount,
                    weight_grams: weightGrams,
                    grind_type: grindType,
                    quantity: 1,
                    image_url: prod.image_url || '/images/bag_ethiopia.jpg'
                });
                // Visual feedback
                target.innerHTML = '<span>✓ Added!</span>';
                target.style.background = 'var(--accent-emerald)';
                setTimeout(() => {
                    target.innerHTML = '<span>Add to Cart</span>';
                    target.style.background = 'var(--accent-terracotta)';
                }, 1200);
            });
        });
    }
    addToCart(item) {
        const existing = this.cartItems.find((i) => i.variant_id === item.variant_id && i.grind_type === item.grind_type);
        if (existing) {
            existing.quantity += item.quantity;
        }
        else {
            this.cartItems.push(item);
        }
        this.saveCart();
        this.updateCartUI();
        this.openCart();
    }
    saveCart() {
        localStorage.setItem('tdg_cart', JSON.stringify(this.cartItems));
    }
    updateCartUI() {
        const headerBadge = document.getElementById('header-cart-count');
        const drawerCount = document.getElementById('cart-items-count');
        const container = document.getElementById('cart-items-container');
        const subtotalEl = document.getElementById('cart-subtotal');
        const shippingEl = document.getElementById('cart-shipping');
        const totalEl = document.getElementById('cart-total');
        const discountRow = document.getElementById('cart-discount-row');
        const discountEl = document.getElementById('cart-discount');
        const totalQty = this.cartItems.reduce((acc, it) => acc + it.quantity, 0);
        if (headerBadge)
            headerBadge.textContent = `${totalQty}`;
        if (drawerCount)
            drawerCount.textContent = `${totalQty}`;
        if (!container)
            return;
        if (this.cartItems.length === 0) {
            container.innerHTML = `
        <div style="text-align:center; padding: 4rem 1rem; color: var(--text-muted);">
          <p style="font-size: 1.15rem; font-family: var(--font-serif); margin-bottom: 0.5rem;">Your cart is empty</p>
          <p style="font-size: 0.88rem;">Select your favorite beans and roast profiles to get started!</p>
        </div>
      `;
            if (subtotalEl)
                subtotalEl.textContent = this.currentCurrency === 'INR' ? '₹0' : '$0.00';
            if (shippingEl)
                shippingEl.textContent = this.currentCurrency === 'INR' ? '₹0' : '$0.00';
            if (totalEl)
                totalEl.textContent = this.currentCurrency === 'INR' ? '₹0' : '$0.00';
            if (discountRow)
                discountRow.style.display = 'none';
            return;
        }
        let subtotalInr = 0;
        let subtotalUsdCents = 0;
        this.cartItems.forEach((it) => {
            subtotalInr += (it.unit_price_inr * it.quantity);
            subtotalUsdCents += (it.unit_price_usd_cents * it.quantity);
        });
        const isFreeShipping = this.currentCurrency === 'INR' ? subtotalInr >= 1200 : subtotalUsdCents >= 4500;
        const shippingInr = isFreeShipping ? 0 : 90;
        const shippingUsdCents = isFreeShipping ? 0 : 495;
        const discountAmountInr = (subtotalInr * this.discountPercentage);
        const discountAmountUsdCents = (subtotalUsdCents * this.discountPercentage);
        const finalInr = Math.max(0, subtotalInr - discountAmountInr + shippingInr);
        const finalUsdCents = Math.max(0, subtotalUsdCents - discountAmountUsdCents + shippingUsdCents);
        container.innerHTML = this.cartItems.map((item, idx) => {
            const itemPriceStr = this.formatPrice(item.unit_price_inr, item.unit_price_usd_cents);
            return `
        <div class="cart-item-card">
          <img src="${item.image_url}" alt="${item.name}" class="cart-item-img">
          <div class="cart-item-info">
            <div class="cart-item-name">${item.name}</div>
            <div class="cart-item-variant">${item.weight_grams >= 1000 ? `${item.weight_grams / 1000}kg` : `${item.weight_grams}g`} · ${item.grind_type.replace(/_/g, ' ')}</div>
            <div class="cart-item-price">${itemPriceStr}</div>
            <div class="cart-qty-ctrl">
              <button class="qty-btn" data-action="dec" data-index="${idx}">-</button>
              <span style="font-size:0.9rem; font-weight:600;">${item.quantity}</span>
              <button class="qty-btn" data-action="inc" data-index="${idx}">+</button>
              <button style="background:none; border:none; color:var(--text-light); font-size:0.8rem; margin-left:auto; cursor:pointer;" data-action="del" data-index="${idx}">Remove</button>
            </div>
          </div>
        </div>
      `;
        }).join('');
        if (subtotalEl)
            subtotalEl.textContent = this.formatPrice(subtotalInr, subtotalUsdCents);
        if (shippingEl)
            shippingEl.textContent = isFreeShipping ? 'FREE' : this.formatPrice(shippingInr, shippingUsdCents);
        if (totalEl)
            totalEl.textContent = this.formatPrice(finalInr, finalUsdCents);
        if (this.discountPercentage > 0 && discountRow && discountEl) {
            discountRow.style.display = 'flex';
            discountEl.textContent = `-${this.formatPrice(discountAmountInr, discountAmountUsdCents)}`;
        }
        // Attach quantity adjustments
        container.querySelectorAll('[data-action="inc"]').forEach((b) => {
            b.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index') || '0', 10);
                this.cartItems[idx].quantity += 1;
                this.saveCart();
                this.updateCartUI();
            });
        });
        container.querySelectorAll('[data-action="dec"]').forEach((b) => {
            b.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index') || '0', 10);
                if (this.cartItems[idx].quantity > 1) {
                    this.cartItems[idx].quantity -= 1;
                }
                else {
                    this.cartItems.splice(idx, 1);
                }
                this.saveCart();
                this.updateCartUI();
            });
        });
        container.querySelectorAll('[data-action="del"]').forEach((b) => {
            b.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index') || '0', 10);
                this.cartItems.splice(idx, 1);
                this.saveCart();
                this.updateCartUI();
            });
        });
    }
    setupEventListeners() {
        // Currency Switcher
        document.getElementById('btn-currency-inr')?.addEventListener('click', () => this.setCurrency('INR'));
        document.getElementById('btn-currency-usd')?.addEventListener('click', () => this.setCurrency('USD'));
        // Open & Close Drawers
        document.getElementById('btn-open-cart')?.addEventListener('click', () => this.openCart());
        document.getElementById('btn-close-cart')?.addEventListener('click', () => this.closeCart());
        document.getElementById('cart-drawer-overlay')?.addEventListener('click', () => this.closeCart());
        document.getElementById('btn-open-agent')?.addEventListener('click', () => this.openAgent());
        document.getElementById('btn-close-agent')?.addEventListener('click', () => this.closeAgent());
        document.getElementById('agent-drawer-overlay')?.addEventListener('click', () => this.closeAgent());
        // Category Tabs
        document.querySelectorAll('#category-tabs-container .category-tab').forEach((tab) => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('#category-tabs-container .category-tab').forEach((t) => t.classList.remove('active'));
                const target = e.currentTarget;
                target.classList.add('active');
                this.activeCategory = target.getAttribute('data-category') || 'all';
                this.renderProducts();
            });
        });
        // Flavor Note Pills
        document.querySelectorAll('#flavor-pills-container .note-pill').forEach((pill) => {
            pill.addEventListener('click', (e) => {
                document.querySelectorAll('#flavor-pills-container .note-pill').forEach((p) => p.classList.remove('active'));
                const target = e.currentTarget;
                target.classList.add('active');
                this.activeTastingNote = target.getAttribute('data-note') || 'all';
                this.renderProducts();
            });
        });
        // Promo Code Trigger
        document.getElementById('btn-apply-welcome')?.addEventListener('click', () => {
            this.discountPercentage = 0.10;
            this.updateCartUI();
            alert('🎉 10% WELCOME10 coupon applied to your order!');
        });
        // Checkout Trigger
        document.getElementById('btn-checkout-trigger')?.addEventListener('click', async () => {
            if (this.cartItems.length === 0) {
                alert('Your cart is empty! Please add some delicious coffee first.');
                return;
            }
            const checkoutBtn = document.getElementById('btn-checkout-trigger');
            checkoutBtn.disabled = true;
            checkoutBtn.textContent = 'Securing Your Bangalore Roast...';
            try {
                const res = await fetch('/api/checkout/session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Session-Token': this.sessionId },
                    body: JSON.stringify({
                        customer_email: 'customer@dailygrind.coffee',
                        cart_id: this.sessionId,
                        currency: this.currentCurrency.toLowerCase(),
                        items: this.cartItems.map((i) => ({
                            variant_id: i.variant_id,
                            quantity: i.quantity,
                            unit_price_cents: this.currentCurrency === 'INR' ? Math.round(i.unit_price_inr * 100) : i.unit_price_usd_cents,
                            product_name: i.name
                        }))
                    })
                });
                const data = await res.json();
                if (data.checkout_url) {
                    window.location.href = data.checkout_url;
                }
                else {
                    alert('🎉 Thank you for your order! Your batch has been reserved for roasting at our Indiranagar roastery.');
                    this.cartItems = [];
                    this.saveCart();
                    this.updateCartUI();
                    this.closeCart();
                }
            }
            catch {
                alert('🎉 Order simulated! Your beans are scheduled for roasting.');
                this.cartItems = [];
                this.saveCart();
                this.updateCartUI();
                this.closeCart();
            }
            finally {
                checkoutBtn.disabled = false;
                checkoutBtn.textContent = 'Proceed to Secure Checkout';
            }
        });
        // AI Barista Chat Form
        const agentForm = document.getElementById('agent-chat-form');
        agentForm?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('agent-chat-input');
            const text = input.value.trim();
            if (!text)
                return;
            input.value = '';
            this.appendMessage('user', text);
            const loadingBubble = this.appendMessage('agent', 'Consulting our Bangalore cupping table...');
            try {
                const res = await fetch('/api/agent/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Session-Token': this.sessionId },
                    body: JSON.stringify({ message: text })
                });
                if (res.ok) {
                    const data = await res.json();
                    loadingBubble.innerHTML = data.reply.replace(/\n/g, '<br>');
                    if (data.action_card && data.action_card.type === 'ADD_TO_CART') {
                        const cardBox = document.createElement('div');
                        cardBox.style.cssText = 'background: #fff; border: 1px solid var(--border-subtle); padding: 1rem; border-radius: var(--radius-md); margin-top: 0.6rem; box-shadow: var(--shadow-sm);';
                        cardBox.innerHTML = `
              <strong style="display:block; margin-bottom: 0.3rem;">✨ Add Recommended Coffee:</strong>
              <div style="font-size: 0.9rem; color: var(--text-main); margin-bottom: 0.6rem;">${data.action_card.product_name} (${data.action_card.weight_grams}g · ${data.action_card.grind_type})</div>
              <button class="btn-primary" style="font-size:0.82rem; padding: 0.4rem 1rem;" id="btn-agent-add-${Date.now()}">
                Add to Cart (${this.formatPrice(450, 1850)})
              </button>
            `;
                        loadingBubble.appendChild(cardBox);
                        cardBox.querySelector('button')?.addEventListener('click', () => {
                            this.addToCart({
                                id: `agent_item_${Date.now()}`,
                                product_id: data.action_card.product_id || 'prod_chik_attikan',
                                variant_id: data.action_card.variant_id || 'var_att_250',
                                name: data.action_card.product_name,
                                weight_grams: data.action_card.weight_grams || 250,
                                grind_type: data.action_card.grind_type || 'WHOLE_BEAN',
                                unit_price_inr: 450,
                                unit_price_usd_cents: 1850,
                                discount_percent: 0,
                                quantity: 1,
                                image_url: '/images/pour_over.jpg'
                            });
                        });
                    }
                }
                else {
                    loadingBubble.textContent = "I'd love to recommend our Chikmagalur Attikan Estate honey process for sweet jaggery and red apple notes, or our Dawn Patrol Bangalore blend for morning comfort!";
                }
            }
            catch {
                loadingBubble.textContent = "For traditional filter kaapi or pour over, try our Chikmagalur Attikan Estate. For a rich dark espresso with thick crema, Midnight Runner is phenomenal!";
            }
        });
        // Order Lookup Form
        const orderForm = document.getElementById('order-lookup-form');
        orderForm?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('order-lookup-input');
            const orderNum = input.value.trim();
            const resultBox = document.getElementById('order-lookup-result');
            if (!resultBox)
                return;
            resultBox.style.display = 'block';
            resultBox.innerHTML = `
        <div style="background: var(--bg-primary); padding: 1.5rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1rem;">
            <strong>Order: ${orderNum}</strong>
            <span style="background: var(--accent-sage); color: var(--accent-emerald); padding: 0.2rem 0.6rem; border-radius: var(--radius-pill); font-size: 0.78rem; font-weight:700;">IN ROASTER</span>
          </div>
          <p style="font-size:0.9rem; color: var(--text-muted); line-height:1.5;">
            Your specialty batch is being convection-roasted in Indiranagar, Bangalore. It will degas for 12 hours and ship via express roastery courier across India!
          </p>
        </div>
      `;
        });
    }
    appendMessage(role, text) {
        const container = document.getElementById('agent-messages-container');
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${role}`;
        bubble.textContent = text;
        container?.appendChild(bubble);
        container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        return bubble;
    }
    setupBrewCalculator() {
        const coffeeSlider = document.getElementById('coffee-grams-slider');
        const ratioSlider = document.getElementById('brew-ratio-slider');
        const coffeeVal = document.getElementById('coffee-grams-val');
        const ratioVal = document.getElementById('brew-ratio-val');
        const waterVal = document.getElementById('calc-water-val');
        const yieldVal = document.getElementById('calc-yield-val');
        const bloomVal = document.getElementById('calc-bloom-val');
        const updateCalc = () => {
            const grams = parseInt(coffeeSlider.value, 10);
            const ratio = parseInt(ratioSlider.value, 10);
            const totalWater = grams * ratio;
            const bloom = grams * 3;
            const cups = Math.max(1, Math.round(totalWater / 180));
            if (coffeeVal)
                coffeeVal.textContent = `${grams}g`;
            if (ratioVal)
                ratioVal.textContent = `1:${ratio}`;
            if (waterVal)
                waterVal.textContent = `${totalWater}g`;
            if (yieldVal)
                yieldVal.textContent = `~${cups} cup${cups > 1 ? 's' : ''}`;
            if (bloomVal)
                bloomVal.textContent = `${bloom}g`;
        };
        coffeeSlider?.addEventListener('input', updateCalc);
        ratioSlider?.addEventListener('input', updateCalc);
        // Method Card Presets
        document.querySelectorAll('.brew-card').forEach((card) => {
            card.addEventListener('click', (e) => {
                document.querySelectorAll('.brew-card').forEach((c) => c.classList.remove('active'));
                const target = e.currentTarget;
                target.classList.add('active');
                const r = target.getAttribute('data-ratio');
                if (r && ratioSlider) {
                    ratioSlider.value = r;
                    updateCalc();
                }
            });
        });
    }
    setupQuiz() {
        const optionsContainer = document.getElementById('quiz-options-container');
        const questionTitle = document.getElementById('quiz-question-title');
        const resultBox = document.getElementById('quiz-result-box');
        let currentStep = 1;
        let selectedMethod = 'POUR_OVER';
        let selectedFlavor = 'JAGGERY';
        optionsContainer?.querySelectorAll('.quiz-option-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const val = e.currentTarget.getAttribute('data-value') || 'POUR_OVER';
                if (currentStep === 1) {
                    selectedMethod = val;
                    currentStep = 2;
                    if (questionTitle)
                        questionTitle.textContent = '2. What tasting notes excite your palate?';
                    if (optionsContainer) {
                        optionsContainer.innerHTML = `
              <button class="quiz-option-btn" data-step="2" data-value="JAGGERY">
                <span>🍯 Sugarcane Jaggery & Red Apple</span>
              </button>
              <button class="quiz-option-btn" data-step="2" data-value="TROPICAL">
                <span>🥭 Ripe Jackfruit & Wild Honey</span>
              </button>
              <button class="quiz-option-btn" data-step="2" data-value="CHOCOLATE">
                <span>🍫 Dark Chocolate Fudge & Cashew</span>
              </button>
              <button class="quiz-option-btn" data-step="2" data-value="FLORAL">
                <span>🌸 Delicate Jasmine & White Peach</span>
              </button>
            `;
                        this.setupQuiz();
                    }
                }
                else if (currentStep === 2) {
                    selectedFlavor = val;
                    if (optionsContainer)
                        optionsContainer.style.display = 'none';
                    if (questionTitle)
                        questionTitle.textContent = '✨ Your Ideal Bangalore Roast Match';
                    let recName = 'Chikmagalur Attikan Estate Honey';
                    let recTag = 'Sugarcane jaggery, red apple & hazelnut';
                    let recImg = '/images/pour_over.jpg';
                    let recPriceInr = 450;
                    let recPriceUsd = 1850;
                    let recProdId = 'prod_chik_attikan';
                    let recVarId = 'var_att_250';
                    if (selectedFlavor === 'TROPICAL') {
                        recName = 'Araku Valley Red Honey Micro-Lot';
                        recTag = 'Ripe jackfruit, wild honey & orange peel';
                        recImg = '/images/bag_ethiopia.jpg';
                        recPriceInr = 490;
                        recPriceUsd = 1950;
                        recProdId = 'prod_araku_honey';
                        recVarId = 'var_ara_250';
                    }
                    else if (selectedFlavor === 'CHOCOLATE') {
                        recName = 'Dawn Patrol Bangalore Roastery Blend';
                        recTag = 'Silky dark chocolate fudge & toasted cashew';
                        recImg = '/images/roaster.jpg';
                        recPriceInr = 420;
                        recPriceUsd = 1650;
                        recProdId = 'prod_dawn_blend';
                        recVarId = 'var_dawn_250';
                    }
                    else if (selectedFlavor === 'FLORAL') {
                        recName = 'Ethiopia Yirgacheffe Gedeb';
                        recTag = 'Jasmine floral & sweet white peach';
                        recImg = '/images/bag_ethiopia.jpg';
                        recPriceInr = 580;
                        recPriceUsd = 2200;
                        recProdId = 'prod_eth_yirg';
                        recVarId = 'var_eth_250';
                    }
                    if (resultBox) {
                        resultBox.style.display = 'block';
                        const formatted = this.formatPrice(recPriceInr, recPriceUsd);
                        resultBox.innerHTML = `
              <div style="background: rgba(255,255,255,0.08); border-radius: var(--radius-md); padding: 1.5rem; display: flex; gap: 1.5rem; align-items: center; text-align: left;">
                <img src="${recImg}" style="width: 90px; height: 90px; border-radius: var(--radius-sm); object-fit: cover;">
                <div style="flex-grow:1;">
                  <h4 style="font-family: var(--font-serif); font-size: 1.3rem; margin-bottom: 0.3rem;">${recName}</h4>
                  <p style="color: rgba(253,250,246,0.8); font-size: 0.9rem; margin-bottom: 0.8rem;">${recTag}</p>
                  <button class="btn-primary" id="btn-quiz-add" style="padding: 0.5rem 1.2rem; font-size: 0.88rem;">
                    Add 250g to Cart (${formatted})
                  </button>
                </div>
              </div>
            `;
                        document.getElementById('btn-quiz-add')?.addEventListener('click', () => {
                            this.addToCart({
                                id: `quiz_rec_${Date.now()}`,
                                product_id: recProdId,
                                variant_id: recVarId,
                                name: recName,
                                weight_grams: 250,
                                grind_type: selectedMethod === 'SOUTH_INDIAN_FILTER' ? 'SOUTH_INDIAN_FILTER' : selectedMethod === 'ESPRESSO' ? 'ESPRESSO' : 'POUR_OVER',
                                unit_price_inr: recPriceInr,
                                unit_price_usd_cents: recPriceUsd,
                                discount_percent: 0,
                                quantity: 1,
                                image_url: recImg
                            });
                        });
                    }
                }
            });
        });
    }
    openCart() {
        document.getElementById('cart-drawer')?.classList.add('open');
        document.getElementById('cart-drawer-overlay')?.classList.add('open');
    }
    closeCart() {
        document.getElementById('cart-drawer')?.classList.remove('open');
        document.getElementById('cart-drawer-overlay')?.classList.remove('open');
    }
    openAgent() {
        document.getElementById('agent-drawer')?.classList.add('open');
        document.getElementById('agent-drawer-overlay')?.classList.add('open');
    }
    closeAgent() {
        document.getElementById('agent-drawer')?.classList.remove('open');
        document.getElementById('agent-drawer-overlay')?.classList.remove('open');
    }
    resetFilters() {
        this.activeCategory = 'all';
        this.activeTastingNote = 'all';
        document.querySelectorAll('#category-tabs-container .category-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('#flavor-pills-container .note-pill').forEach((p) => p.classList.remove('active'));
        document.querySelector('#category-tabs-container .category-tab[data-category="all"]')?.classList.add('active');
        document.querySelector('#flavor-pills-container .note-pill[data-note="all"]')?.classList.add('active');
        this.renderProducts();
    }
}
const app = new StorefrontApp();
window.storefrontApp = app;
app.init();
export {};
