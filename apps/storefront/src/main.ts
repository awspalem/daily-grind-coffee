import type { Cart, CartItem, Product, ProductVariant } from '@daily-grind/shared-types';

interface LocalCartItem {
  id: string;
  variant_id: string;
  product_id: string;
  name: string;
  weight_grams: number;
  grind_type: string;
  unit_price_cents: number;
  quantity: number;
  image_url: string;
}

// Fallback curated catalog data for seamless coffee consumer exploration
const FALLBACK_PRODUCTS: any[] = [
  {
    id: 'prod_eth_yirg',
    slug: 'ethiopia-yirgacheffe-gedeb',
    name: 'Ethiopia Yirgacheffe Gedeb',
    tagline: 'Floral jasmine, crisp bergamot & sweet white peach',
    description: 'Hand-picked Heirloom micro-lot grown at 2,100 meters elevation in the Gedeb district. Naturally processed with sun-dried fruit fermentation on raised African beds for extraordinary tea-like clarity.',
    category_id: 'single-origin',
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
      { id: 'var_eth_250', product_id: 'prod_eth_yirg', sku: 'TDG-ETH-250G', weight_grams: 250, price_cents: 1950, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'AEROPRESS'], is_active: 1 },
      { id: 'var_eth_500', product_id: 'prod_eth_yirg', sku: 'TDG-ETH-500G', weight_grams: 500, price_cents: 3600, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'AEROPRESS'], is_active: 1 },
      { id: 'var_eth_1000', product_id: 'prod_eth_yirg', sku: 'TDG-ETH-1KG', weight_grams: 1000, price_cents: 6800, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'AEROPRESS'], is_active: 1 }
    ]
  },
  {
    id: 'prod_col_pink',
    slug: 'colombia-pink-bourbon-huila',
    name: 'Colombia Pink Bourbon Huila',
    tagline: 'Papaya nectar, pink grapefruit & wildflower honey',
    description: 'Rare Pink Bourbon mutation cultivated on the volcanic slopes of San Adolfo, Huila. Fully washed with a 36-hour extended anaerobic fermentation for intense tropical fruit aromatics.',
    category_id: 'single-origin',
    origin_country: 'Colombia',
    region: 'San Adolfo, Huila',
    process_method: 'WASHED',
    roast_level: 'LIGHT_MEDIUM',
    tasting_notes: ['Papaya', 'Pink Grapefruit', 'Honey', 'Citrus'],
    image_url: '/images/pour_over.jpg',
    is_active: 1,
    is_featured: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    variants: [
      { id: 'var_col_250', product_id: 'prod_col_pink', sku: 'TDG-COL-250G', weight_grams: 250, price_cents: 2200, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'ESPRESSO'], is_active: 1 },
      { id: 'var_col_500', product_id: 'prod_col_pink', sku: 'TDG-COL-500G', weight_grams: 500, price_cents: 4100, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'ESPRESSO'], is_active: 1 }
    ]
  },
  {
    id: 'prod_dawn_blend',
    slug: 'dawn-patrol-signature-blend',
    name: 'Dawn Patrol Roastery Blend',
    tagline: 'Silky milk chocolate, toasted hazelnut & candied orange',
    description: 'Our award-winning everyday morning ritual blend. Combining Colombia washed Bourbon with natural Brazil Cerrado for a creamy, well-rounded cup that shines with or without oat milk.',
    category_id: 'signature-blends',
    origin_country: 'Colombia & Brazil',
    region: 'Huila / Minas Gerais',
    process_method: 'WASHED_NATURAL',
    roast_level: 'MEDIUM',
    tasting_notes: ['Milk Chocolate', 'Hazelnut', 'Toffee', 'Caramel'],
    image_url: '/images/roaster.jpg',
    is_active: 1,
    is_featured: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    variants: [
      { id: 'var_dawn_250', product_id: 'prod_dawn_blend', sku: 'TDG-DP-250G', weight_grams: 250, price_cents: 1750, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'FRENCH_PRESS', 'ESPRESSO'], is_active: 1 },
      { id: 'var_dawn_500', product_id: 'prod_dawn_blend', sku: 'TDG-DP-500G', weight_grams: 500, price_cents: 3200, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'FRENCH_PRESS', 'ESPRESSO'], is_active: 1 },
      { id: 'var_dawn_1000', product_id: 'prod_dawn_blend', sku: 'TDG-DP-1KG', weight_grams: 1000, price_cents: 5900, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'FRENCH_PRESS', 'ESPRESSO'], is_active: 1 }
    ]
  },
  {
    id: 'prod_mid_runner',
    slug: 'midnight-runner-dark-espresso',
    name: 'Midnight Runner Dark Espresso',
    tagline: 'Dark Dutch cocoa, caramelized brown sugar & smoky velvet',
    description: 'Full-throttle dark roast profile engineered for rich extraction under 9 bars of pressure. Zero astringency, dense crema, and deep chocolate fudge notes.',
    category_id: 'espresso-profiles',
    origin_country: 'Guatemala & Sumatra',
    region: 'Antigua / Kerinci',
    process_method: 'WASHED',
    roast_level: 'DARK',
    tasting_notes: ['Dark Chocolate', 'Molasses', 'Brown Sugar'],
    image_url: '/images/espresso.jpg',
    is_active: 1,
    is_featured: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    variants: [
      { id: 'var_mid_250', product_id: 'prod_mid_runner', sku: 'TDG-MR-250G', weight_grams: 250, price_cents: 1850, grind_options: ['WHOLE_BEAN', 'ESPRESSO', 'MOKA_POT', 'FRENCH_PRESS'], is_active: 1 },
      { id: 'var_mid_500', product_id: 'prod_mid_runner', sku: 'TDG-MR-500G', weight_grams: 500, price_cents: 3400, grind_options: ['WHOLE_BEAN', 'ESPRESSO', 'MOKA_POT', 'FRENCH_PRESS'], is_active: 1 }
    ]
  },
  {
    id: 'prod_glacier_cb',
    slug: 'glacier-steep-cold-brew-blend',
    name: 'Glacier Steep Cold Brew Blend',
    tagline: 'Smooth dark cacao, sweet vanilla bean & bourbon undertones',
    description: 'Coarse-optimized steep blend designed specifically for 16-24 hour slow immersion cold extractions. Naturally sweet, zero bitter acidity, and intensely refreshing over ice.',
    category_id: 'cold-brew',
    origin_country: 'Sumatra & Colombia',
    region: 'Highland Tropics',
    process_method: 'NATURAL',
    roast_level: 'MEDIUM_DARK',
    tasting_notes: ['Cacao', 'Vanilla', 'Toffee'],
    image_url: '/images/bag_ethiopia.jpg',
    is_active: 1,
    is_featured: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    variants: [
      { id: 'var_gcb_500', product_id: 'prod_glacier_cb', sku: 'TDG-GCB-500G', weight_grams: 500, price_cents: 3400, grind_options: ['WHOLE_BEAN', 'COLD_BREW_COARSE'], is_active: 1 },
      { id: 'var_gcb_1000', product_id: 'prod_glacier_cb', sku: 'TDG-GCB-1KG', weight_grams: 1000, price_cents: 6200, grind_options: ['WHOLE_BEAN', 'COLD_BREW_COARSE'], is_active: 1 }
    ]
  }
];

class StorefrontApp {
  private products: any[] = [];
  private cartItems: LocalCartItem[] = [];
  private activeCategory: string = 'all';
  private activeTastingNote: string = 'all';
  private discountCents: number = 0;
  private sessionId: string;

  constructor() {
    this.sessionId = localStorage.getItem('tdg_session_id') || `sess_${Math.random().toString(36).substring(2, 12)}`;
    localStorage.setItem('tdg_session_id', this.sessionId);
    
    // Load persisted cart
    const savedCart = localStorage.getItem('tdg_cart');
    if (savedCart) {
      try {
        this.cartItems = JSON.parse(savedCart);
      } catch {
        this.cartItems = [];
      }
    }
  }

  async init() {
    this.setupEventListeners();
    this.setupBrewCalculator();
    this.setupQuiz();
    this.updateCartUI();
    await this.loadCatalog();
  }

  private async loadCatalog() {
    try {
      const res = await fetch('/api/products');
      if (res.ok) {
        const data = await res.json() as { products: any[] };
        if (data.products && data.products.length > 0) {
          this.products = data.products;
        } else {
          this.products = FALLBACK_PRODUCTS;
        }
      } else {
        this.products = FALLBACK_PRODUCTS;
      }
    } catch {
      this.products = FALLBACK_PRODUCTS;
    }
    this.renderProducts();
  }

  private renderProducts() {
    const container = document.getElementById('product-grid-container');
    if (!container) return;

    let filtered = this.products;

    if (this.activeCategory !== 'all') {
      filtered = filtered.filter((p) => p.category_id === this.activeCategory || p.slug.includes(this.activeCategory));
    }

    if (this.activeTastingNote !== 'all') {
      filtered = filtered.filter((p) => p.tasting_notes.some((n: string) => n.toLowerCase().includes(this.activeTastingNote.toLowerCase())));
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
      const defaultVariant = prod.variants[0] || { id: 'v1', weight_grams: 250, price_cents: 1950 };
      const notesHtml = prod.tasting_notes.map((n: string) => `<span class="taste-tag">${n}</span>`).join('');
      
      const roastScore = prod.roast_level === 'LIGHT' ? 25 : prod.roast_level === 'LIGHT_MEDIUM' ? 45 : prod.roast_level === 'MEDIUM' ? 65 : 90;

      const weightButtons = prod.variants.map((v: any, idx: number) => `
        <button class="weight-btn ${idx === 0 ? 'selected' : ''}" data-variant-id="${v.id}" data-price="${v.price_cents}" data-weight="${v.weight_grams}">
          ${v.weight_grams >= 1000 ? `${v.weight_grams / 1000}kg` : `${v.weight_grams}g`}
        </button>
      `).join('');

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
                <span class="selector-label">Grind Size</span>
                <select class="grind-dropdown" id="grind-${prod.id}">
                  <option value="WHOLE_BEAN">Whole Bean (Recommended)</option>
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
                $${(defaultVariant.price_cents / 100).toFixed(2)}
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

    // Attach dynamic variant weight toggles
    document.querySelectorAll('.weight-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const parent = target.parentElement;
        if (!parent) return;
        parent.querySelectorAll('.weight-btn').forEach((b) => b.classList.remove('selected'));
        target.classList.add('selected');

        const prodId = parent.getAttribute('data-prod');
        const priceCents = parseInt(target.getAttribute('data-price') || '1950', 10);
        const weightGrams = parseInt(target.getAttribute('data-weight') || '250', 10);
        const priceDisplay = document.getElementById(`price-display-${prodId}`);
        if (priceDisplay) {
          priceDisplay.innerHTML = `$${(priceCents / 100).toFixed(2)} <small>/ ${weightGrams >= 1000 ? `${weightGrams / 1000}kg` : `${weightGrams}g`}</small>`;
        }
      });
    });

    // Attach Add to Cart clicks
    document.querySelectorAll('[data-action="add-to-cart"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const prodId = target.getAttribute('data-prod-id');
        if (!prodId) return;

        const prod = this.products.find((p) => p.id === prodId);
        if (!prod) return;

        const card = target.closest('.product-card');
        const selectedWeightBtn = card?.querySelector('.weight-btn.selected') as HTMLElement;
        const variantId = selectedWeightBtn?.getAttribute('data-variant-id') || prod.variants[0]?.id || 'v1';
        const priceCents = parseInt(selectedWeightBtn?.getAttribute('data-price') || `${prod.variants[0]?.price_cents || 1950}`, 10);
        const weightGrams = parseInt(selectedWeightBtn?.getAttribute('data-weight') || `${prod.variants[0]?.weight_grams || 250}`, 10);
        const grindSelect = card?.querySelector('.grind-dropdown') as HTMLSelectElement;
        const grindType = grindSelect ? grindSelect.value : 'WHOLE_BEAN';

        this.addToCart({
          id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          product_id: prod.id,
          variant_id: variantId,
          name: prod.name,
          unit_price_cents: priceCents,
          weight_grams: weightGrams,
          grind_type: grindType,
          quantity: 1,
          image_url: prod.image_url || '/images/bag_ethiopia.jpg'
        });

        // Haptic button feedback
        target.innerHTML = '<span>✓ Added!</span>';
        target.style.background = 'var(--accent-emerald)';
        setTimeout(() => {
          target.innerHTML = '<span>Add to Cart</span>';
          target.style.background = 'var(--accent-terracotta)';
        }, 1200);
      });
    });
  }

  addToCart(item: LocalCartItem) {
    const existing = this.cartItems.find((i) => i.variant_id === item.variant_id && i.grind_type === item.grind_type);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      this.cartItems.push(item);
    }
    this.saveCart();
    this.updateCartUI();
    this.openCart();
  }

  private saveCart() {
    localStorage.setItem('tdg_cart', JSON.stringify(this.cartItems));
  }

  private updateCartUI() {
    const headerBadge = document.getElementById('header-cart-count');
    const drawerCount = document.getElementById('cart-items-count');
    const container = document.getElementById('cart-items-container');
    const subtotalEl = document.getElementById('cart-subtotal');
    const shippingEl = document.getElementById('cart-shipping');
    const totalEl = document.getElementById('cart-total');
    const discountRow = document.getElementById('cart-discount-row');
    const discountEl = document.getElementById('cart-discount');

    const totalQty = this.cartItems.reduce((acc, it) => acc + it.quantity, 0);
    if (headerBadge) headerBadge.textContent = `${totalQty}`;
    if (drawerCount) drawerCount.textContent = `${totalQty}`;

    if (!container) return;

    if (this.cartItems.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding: 4rem 1rem; color: var(--text-muted);">
          <p style="font-size: 1.15rem; font-family: var(--font-serif); margin-bottom: 0.5rem;">Your cart is empty</p>
          <p style="font-size: 0.88rem;">Select your favorite beans and roast profiles to get started!</p>
        </div>
      `;
      if (subtotalEl) subtotalEl.textContent = '$0.00';
      if (shippingEl) shippingEl.textContent = '$0.00';
      if (totalEl) totalEl.textContent = '$0.00';
      if (discountRow) discountRow.style.display = 'none';
      return;
    }

    const subtotalCents = this.cartItems.reduce((acc, it) => acc + (it.unit_price_cents * it.quantity), 0);
    const shippingCents = subtotalCents >= 4500 ? 0 : 495;
    const finalTotalCents = Math.max(0, subtotalCents - this.discountCents + shippingCents);

    container.innerHTML = this.cartItems.map((item, idx) => `
      <div class="cart-item-card">
        <img src="${item.image_url}" alt="${item.name}" class="cart-item-img">
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-variant">${item.weight_grams >= 1000 ? `${item.weight_grams / 1000}kg` : `${item.weight_grams}g`} · ${item.grind_type.replace('_', ' ')}</div>
          <div class="cart-item-price">$${(item.unit_price_cents / 100).toFixed(2)}</div>
          <div class="cart-qty-ctrl">
            <button class="qty-btn" data-action="dec" data-index="${idx}">-</button>
            <span style="font-size:0.9rem; font-weight:600;">${item.quantity}</span>
            <button class="qty-btn" data-action="inc" data-index="${idx}">+</button>
            <button style="background:none; border:none; color:var(--text-light); font-size:0.8rem; margin-left:auto; cursor:pointer;" data-action="del" data-index="${idx}">Remove</button>
          </div>
        </div>
      </div>
    `).join('');

    if (subtotalEl) subtotalEl.textContent = `$${(subtotalCents / 100).toFixed(2)}`;
    if (shippingEl) shippingEl.textContent = shippingCents === 0 ? 'FREE' : `$${(shippingCents / 100).toFixed(2)}`;
    if (totalEl) totalEl.textContent = `$${(finalTotalCents / 100).toFixed(2)}`;

    if (this.discountCents > 0 && discountRow && discountEl) {
      discountRow.style.display = 'flex';
      discountEl.textContent = `-$${(this.discountCents / 100).toFixed(2)}`;
    }

    // Attach quantity adjustments
    container.querySelectorAll('[data-action="inc"]').forEach((b) => {
      b.addEventListener('click', (e) => {
        const idx = parseInt((e.currentTarget as HTMLElement).getAttribute('data-index') || '0', 10);
        this.cartItems[idx].quantity += 1;
        this.saveCart();
        this.updateCartUI();
      });
    });

    container.querySelectorAll('[data-action="dec"]').forEach((b) => {
      b.addEventListener('click', (e) => {
        const idx = parseInt((e.currentTarget as HTMLElement).getAttribute('data-index') || '0', 10);
        if (this.cartItems[idx].quantity > 1) {
          this.cartItems[idx].quantity -= 1;
        } else {
          this.cartItems.splice(idx, 1);
        }
        this.saveCart();
        this.updateCartUI();
      });
    });

    container.querySelectorAll('[data-action="del"]').forEach((b) => {
      b.addEventListener('click', (e) => {
        const idx = parseInt((e.currentTarget as HTMLElement).getAttribute('data-index') || '0', 10);
        this.cartItems.splice(idx, 1);
        this.saveCart();
        this.updateCartUI();
      });
    });
  }

  private setupEventListeners() {
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
        const target = e.currentTarget as HTMLElement;
        target.classList.add('active');
        this.activeCategory = target.getAttribute('data-category') || 'all';
        this.renderProducts();
      });
    });

    // Flavor Note Pills
    document.querySelectorAll('#flavor-pills-container .note-pill').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        document.querySelectorAll('#flavor-pills-container .note-pill').forEach((p) => p.classList.remove('active'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('active');
        this.activeTastingNote = target.getAttribute('data-note') || 'all';
        this.renderProducts();
      });
    });

    // Promo Code Trigger
    document.getElementById('btn-apply-welcome')?.addEventListener('click', () => {
      const subtotalCents = this.cartItems.reduce((acc, it) => acc + (it.unit_price_cents * it.quantity), 0);
      this.discountCents = Math.round(subtotalCents * 0.1);
      this.updateCartUI();
      alert('🎉 10% WELCOME10 coupon applied to your order!');
    });

    // Stripe Checkout Trigger
    document.getElementById('btn-checkout-trigger')?.addEventListener('click', async () => {
      if (this.cartItems.length === 0) {
        alert('Your cart is empty! Please add some delicious coffee first.');
        return;
      }

      const checkoutBtn = document.getElementById('btn-checkout-trigger') as HTMLButtonElement;
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = 'Securing Your Fresh Batch...';

      try {
        const res = await fetch('/api/checkout/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Session-Token': this.sessionId },
          body: JSON.stringify({
            customer_email: 'customer@dailygrind.coffee',
            cart_id: this.sessionId,
            items: this.cartItems.map((i) => ({
              variant_id: i.variant_id,
              quantity: i.quantity,
              unit_price_cents: i.unit_price_cents,
              product_name: i.name
            }))
          })
        });

        const data = await res.json() as { checkout_url?: string; error?: string };
        if (data.checkout_url) {
          window.location.href = data.checkout_url;
        } else {
          alert('🎉 Thank you for your order! Your batch has been reserved and queued for roasting.');
          this.cartItems = [];
          this.saveCart();
          this.updateCartUI();
          this.closeCart();
        }
      } catch {
        alert('🎉 Order simulated successfully! Your coffee lot is reserved for roasting.');
        this.cartItems = [];
        this.saveCart();
        this.updateCartUI();
        this.closeCart();
      } finally {
        checkoutBtn.disabled = false;
        checkoutBtn.textContent = 'Proceed to Secure Checkout';
      }
    });

    // AI Barista Chat Form
    const agentForm = document.getElementById('agent-chat-form') as HTMLFormElement;
    agentForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('agent-chat-input') as HTMLInputElement;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';

      this.appendMessage('user', text);
      const loadingBubble = this.appendMessage('agent', 'Consulting our flavor notes & cupping table...');

      try {
        const res = await fetch('/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Session-Token': this.sessionId },
          body: JSON.stringify({ message: text })
        });

        if (res.ok) {
          const data = await res.json() as { reply: string; action_card?: any };
          loadingBubble.innerHTML = data.reply.replace(/\n/g, '<br>');

          if (data.action_card && data.action_card.type === 'ADD_TO_CART') {
            const cardBox = document.createElement('div');
            cardBox.style.cssText = 'background: #fff; border: 1px solid var(--border-subtle); padding: 1rem; border-radius: var(--radius-md); margin-top: 0.6rem; box-shadow: var(--shadow-sm);';
            cardBox.innerHTML = `
              <strong style="display:block; margin-bottom: 0.3rem;">✨ Add Recommended Coffee:</strong>
              <div style="font-size: 0.9rem; color: var(--text-main); margin-bottom: 0.6rem;">${data.action_card.product_name} (${data.action_card.weight_grams}g · ${data.action_card.grind_type})</div>
              <button class="btn-primary" style="font-size:0.82rem; padding: 0.4rem 1rem;" id="btn-agent-add-${Date.now()}">
                Add to Cart ($${(data.action_card.price_cents / 100).toFixed(2)})
              </button>
            `;
            loadingBubble.appendChild(cardBox);

            cardBox.querySelector('button')?.addEventListener('click', () => {
              this.addToCart({
                id: `agent_item_${Date.now()}`,
                product_id: data.action_card.product_id || 'prod_eth_yirg',
                variant_id: data.action_card.variant_id || 'var_eth_250',
                name: data.action_card.product_name,
                weight_grams: data.action_card.weight_grams || 250,
                grind_type: data.action_card.grind_type || 'WHOLE_BEAN',
                unit_price_cents: data.action_card.price_cents || 1950,
                quantity: 1,
                image_url: '/images/bag_ethiopia.jpg'
              });
            });
          }
        } else {
          loadingBubble.textContent = "I'd love to recommend our Ethiopia Yirgacheffe Gedeb for bright jasmine and peach notes, or the Dawn Patrol Blend if you enjoy smooth caramel and chocolate with morning breakfast!";
        }
      } catch {
        loadingBubble.textContent = "For pour overs, our Ethiopia Yirgacheffe light roast provides incredible floral clarity! If you prefer a richer espresso, try Midnight Runner for thick dark cocoa crema.";
      }
    });

    // Order Lookup Form
    const orderForm = document.getElementById('order-lookup-form');
    orderForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('order-lookup-input') as HTMLInputElement;
      const orderNum = input.value.trim();
      const resultBox = document.getElementById('order-lookup-result');
      if (!resultBox) return;

      resultBox.style.display = 'block';
      resultBox.innerHTML = `
        <div style="background: var(--bg-primary); padding: 1.5rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1rem;">
            <strong>Order: ${orderNum}</strong>
            <span style="background: var(--accent-sage); color: var(--accent-emerald); padding: 0.2rem 0.6rem; border-radius: var(--radius-pill); font-size: 0.78rem; font-weight:700;">IN ROASTER</span>
          </div>
          <p style="font-size:0.9rem; color: var(--text-muted); line-height:1.5;">
            Your specialty micro-lot beans are currently being convection-roasted in small 12kg batches. They will degas for 12 hours and be sealed in nitrogen-flushed valve bags for dispatch!
          </p>
        </div>
      `;
    });
  }

  private appendMessage(role: 'user' | 'agent', text: string): HTMLElement {
    const container = document.getElementById('agent-messages-container');
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.textContent = text;
    container?.appendChild(bubble);
    container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    return bubble;
  }

  private setupBrewCalculator() {
    const coffeeSlider = document.getElementById('coffee-grams-slider') as HTMLInputElement;
    const ratioSlider = document.getElementById('brew-ratio-slider') as HTMLInputElement;
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

      if (coffeeVal) coffeeVal.textContent = `${grams}g`;
      if (ratioVal) ratioVal.textContent = `1:${ratio}`;
      if (waterVal) waterVal.textContent = `${totalWater}g`;
      if (yieldVal) yieldVal.textContent = `~${cups} cup${cups > 1 ? 's' : ''}`;
      if (bloomVal) bloomVal.textContent = `${bloom}g`;
    };

    coffeeSlider?.addEventListener('input', updateCalc);
    ratioSlider?.addEventListener('input', updateCalc);

    // Method Card Presets
    document.querySelectorAll('.brew-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        document.querySelectorAll('.brew-card').forEach((c) => c.classList.remove('active'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('active');
        const r = target.getAttribute('data-ratio');
        if (r && ratioSlider) {
          ratioSlider.value = r;
          updateCalc();
        }
      });
    });
  }

  private setupQuiz() {
    const optionsContainer = document.getElementById('quiz-options-container');
    const questionTitle = document.getElementById('quiz-question-title');
    const resultBox = document.getElementById('quiz-result-box');

    let currentStep = 1;
    let selectedMethod = 'POUR_OVER';
    let selectedFlavor = 'FLORAL';

    optionsContainer?.querySelectorAll('.quiz-option-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const val = (e.currentTarget as HTMLElement).getAttribute('data-value') || 'POUR_OVER';

        if (currentStep === 1) {
          selectedMethod = val;
          currentStep = 2;
          if (questionTitle) questionTitle.textContent = '2. What flavor profile excites your palate?';
          if (optionsContainer) {
            optionsContainer.innerHTML = `
              <button class="quiz-option-btn" data-step="2" data-value="FLORAL">
                <span>🌸 Bright Jasmine, Citrus & Peach</span>
              </button>
              <button class="quiz-option-btn" data-step="2" data-value="CHOCOLATE">
                <span>🍫 Rich Dark Cocoa & Molasses</span>
              </button>
              <button class="quiz-option-btn" data-step="2" data-value="CARAMEL">
                <span>🍯 Silky Caramel & Toasted Hazelnut</span>
              </button>
              <button class="quiz-option-btn" data-step="2" data-value="TROPICAL">
                <span>🥭 Exotic Papaya & Passion Fruit</span>
              </button>
            `;
            this.setupQuiz();
          }
        } else if (currentStep === 2) {
          selectedFlavor = val;
          if (optionsContainer) optionsContainer.style.display = 'none';
          if (questionTitle) questionTitle.textContent = '✨ Your Ideal Coffee Match';

          let recName = 'Ethiopia Yirgacheffe Gedeb';
          let recTag = 'Floral jasmine & ripe white peach';
          let recImg = '/images/bag_ethiopia.jpg';
          let recPrice = 1950;
          let recProdId = 'prod_eth_yirg';
          let recVarId = 'var_eth_250';

          if (selectedFlavor === 'CHOCOLATE' || selectedMethod === 'ESPRESSO') {
            recName = 'Midnight Runner Dark Espresso';
            recTag = 'Dark Dutch cocoa & brown sugar fudge';
            recImg = '/images/espresso.jpg';
            recPrice = 1850;
            recProdId = 'prod_mid_runner';
            recVarId = 'var_mid_250';
          } else if (selectedFlavor === 'CARAMEL') {
            recName = 'Dawn Patrol Signature Blend';
            recTag = 'Silky milk chocolate & toasted hazelnut';
            recImg = '/images/roaster.jpg';
            recPrice = 1750;
            recProdId = 'prod_dawn_blend';
            recVarId = 'var_dawn_250';
          } else if (selectedFlavor === 'TROPICAL') {
            recName = 'Colombia Pink Bourbon Huila';
            recTag = 'Exotic papaya nectar & pink grapefruit';
            recImg = '/images/pour_over.jpg';
            recPrice = 2200;
            recProdId = 'prod_col_pink';
            recVarId = 'var_col_250';
          }

          if (resultBox) {
            resultBox.style.display = 'block';
            resultBox.innerHTML = `
              <div style="background: rgba(255,255,255,0.08); border-radius: var(--radius-md); padding: 1.5rem; display: flex; gap: 1.5rem; align-items: center; text-align: left;">
                <img src="${recImg}" style="width: 90px; height: 90px; border-radius: var(--radius-sm); object-fit: cover;">
                <div style="flex-grow:1;">
                  <h4 style="font-family: var(--font-serif); font-size: 1.3rem; margin-bottom: 0.3rem;">${recName}</h4>
                  <p style="color: rgba(253,250,246,0.8); font-size: 0.9rem; margin-bottom: 0.8rem;">${recTag}</p>
                  <button class="btn-primary" id="btn-quiz-add" style="padding: 0.5rem 1.2rem; font-size: 0.88rem;">
                    Add 250g to Cart ($${(recPrice / 100).toFixed(2)})
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
                grind_type: selectedMethod === 'ESPRESSO' ? 'ESPRESSO' : 'POUR_OVER',
                unit_price_cents: recPrice,
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
(window as any).storefrontApp = app;
app.init();
