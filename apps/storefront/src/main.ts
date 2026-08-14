import type { Product, Cart, BrewingGuide, GrindType, Order } from '@daily-grind/shared-types';

// State
let allProducts: Product[] = [];
let filteredProducts: Product[] = [];
let currentCategory = 'all';
let currentRoast = 'ALL';
let currentCart: Cart | null = null;
let chatMessages: { role: 'user' | 'assistant'; content: string }[] = [];

// Session token in LocalStorage
function getSessionToken(): string {
  let token = localStorage.getItem('tdg_session_token');
  if (!token) {
    token = 'sess_' + crypto.randomUUID().replace(/-/g, '');
    localStorage.setItem('tdg_session_token', token);
  }
  return token;
}

// API Helper
async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-Session-Token', getSessionToken());
  if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// Analytics telemetry helper
async function trackEvent(eventName: 'product_view' | 'add_to_cart' | 'checkout_started' | 'purchase', productId?: string, meta?: any) {
  try {
    await fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': getSessionToken() },
      body: JSON.stringify({
        event_name: eventName,
        session_id: getSessionToken(),
        product_id: productId,
        metadata: meta,
      }),
    });
  } catch (e) {
    // Non-blocking telemetry
  }
}

// Format Price
function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// 1. Initial Load
async function initApp() {
  setupEventListeners();
  await Promise.all([
    loadProducts(),
    loadBrewingGuides(),
    refreshCart(),
  ]);
  trackEvent('product_view', undefined, { page: 'home' });
}

// 2. Fetch & Render Products
async function loadProducts() {
  try {
    const data = await apiRequest<{ success: boolean; products: Product[] }>('/api/products');
    allProducts = data.products || [];
    filterAndRenderProducts();
    renderSpotlightCard();
  } catch (err) {
    console.error('Failed to load products:', err);
    const container = document.getElementById('products-container');
    if (container) {
      container.innerHTML = `<div class="error-msg">Unable to load catalog from edge API. Please refresh.</div>`;
    }
  }
}

function filterAndRenderProducts() {
  filteredProducts = allProducts.filter((p) => {
    const matchCategory = currentCategory === 'all' || p.category_id.includes(currentCategory) || p.slug.includes(currentCategory);
    const matchRoast = currentRoast === 'ALL' || p.roast_level === currentRoast;
    return matchCategory && matchRoast;
  });

  const container = document.getElementById('products-container');
  if (!container) return;

  if (filteredProducts.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 48px 0; color: var(--text-muted);">
      <h3>No coffees match this filter combination.</h3>
      <p>Try selecting "All Coffees" or "Any Roast".</p>
    </div>`;
    return;
  }

  container.innerHTML = filteredProducts.map((p) => {
    const initialVariant = p.variants[0] || { id: '', price_cents: 0, weight_grams: 250, grind_options: ['WHOLE_BEAN'] };
    const notesHtml = p.tasting_notes.map((n) => `<span class="note-tag">${n}</span>`).join('');

    return `
      <div class="product-card" id="card-${p.id}" data-product-id="${p.id}">
        <div class="product-card-top">
          <img src="${p.image_url}" alt="${p.name}" class="product-image" loading="lazy" />
          <span class="roast-pill">${p.roast_level.replace('_', ' ')}</span>
        </div>
        
        <h3 class="product-title">${p.name}</h3>
        <div class="product-origin-meta">${p.origin_country} · ${p.region} · ${p.process_method}</div>
        
        <div class="product-notes">${notesHtml}</div>

        <!-- Flavor Spectrum Profile -->
        <div class="flavor-meters">
          <div class="meter-row">
            <span>Acidity / Brightness</span>
            <div class="meter-track"><div class="meter-fill" style="width: ${(p.acidity_score / 5) * 100}%"></div></div>
          </div>
          <div class="meter-row">
            <span>Body & Texture</span>
            <div class="meter-track"><div class="meter-fill" style="width: ${(p.body_score / 5) * 100}%"></div></div>
          </div>
          <div class="meter-row">
            <span>Sweetness</span>
            <div class="meter-track"><div class="meter-fill" style="width: ${(p.sweetness_score / 5) * 100}%"></div></div>
          </div>
        </div>

        <!-- Variant & Grind Selectors -->
        <div class="card-selectors">
          <select class="custom-select variant-select" data-product-id="${p.id}">
            ${p.variants.map((v) => `<option value="${v.id}" data-price="${v.price_cents}">${v.weight_grams}g Bag (${formatPrice(v.price_cents)})</option>`).join('')}
          </select>

          <select class="custom-select grind-select" data-product-id="${p.id}">
            <option value="WHOLE_BEAN">Whole Bean</option>
            <option value="POUR_OVER">Pour Over (V60)</option>
            <option value="ESPRESSO">Fine Espresso</option>
            <option value="AEROPRESS">AeroPress</option>
            <option value="DRIP">Standard Drip</option>
            <option value="FRENCH_PRESS">Coarse French Press</option>
            <option value="COLD_BREW">Cold Brew Coarse</option>
          </select>
        </div>

        <div class="product-card-footer">
          <div class="product-price" id="price-display-${p.id}">
            ${formatPrice(initialVariant.price_cents)}
          </div>
          <button class="btn btn-primary btn-add-cart" data-product-id="${p.id}">
            <span>Add to Cart</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Attach card event listeners
  container.querySelectorAll('.variant-select').forEach((el) => {
    el.addEventListener('change', (e) => {
      const select = e.target as HTMLSelectElement;
      const pid = select.getAttribute('data-product-id');
      const opt = select.selectedOptions[0];
      const price = Number(opt.getAttribute('data-price') || 0);
      const priceEl = document.getElementById(`price-display-${pid}`);
      if (priceEl) priceEl.innerText = formatPrice(price);
    });
  });

  container.querySelectorAll('.btn-add-cart').forEach((el) => {
    el.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      const pid = btn?.getAttribute('data-product-id');
      if (!pid) return;

      const card = document.getElementById(`card-${pid}`);
      const variantSelect = card?.querySelector('.variant-select') as HTMLSelectElement;
      const grindSelect = card?.querySelector('.grind-select') as HTMLSelectElement;

      const variantId = variantSelect?.value;
      const grindType = (grindSelect?.value || 'WHOLE_BEAN') as GrindType;

      if (!variantId) return;

      btn!.disabled = true;
      btn!.innerHTML = `<span>Adding...</span>`;

      try {
        await addToCart(variantId, grindType, 1);
        trackEvent('add_to_cart', pid, { variant_id: variantId, grind: grindType });
        btn!.innerHTML = `<span>Added ✓</span>`;
        setTimeout(() => {
          btn!.innerHTML = `<span>Add to Cart</span>`;
          btn!.disabled = false;
        }, 1200);
        openCartDrawer();
      } catch (err: any) {
        alert(err.message || 'Error adding to cart');
        btn!.innerHTML = `<span>Add to Cart</span>`;
        btn!.disabled = false;
      }
    });
  });
}

function renderSpotlightCard() {
  const spotlight = document.getElementById('hero-spotlight');
  const featured = allProducts.find((p) => p.is_featured) || allProducts[0];
  if (!spotlight || !featured) return;

  spotlight.innerHTML = `
    <div class="spotlight-card">
      <span class="spotlight-badge">Master Roaster's Spotlight</span>
      <img src="${featured.image_url}" alt="${featured.name}" class="spotlight-img" />
      <h3 class="spotlight-title">${featured.name}</h3>
      <p class="spotlight-tagline">"${featured.tagline}"</p>
      
      <div class="product-notes">
        ${featured.tasting_notes.map((n) => `<span class="note-tag">${n}</span>`).join('')}
      </div>

      <div class="spotlight-footer">
        <div>
          <span style="font-size: 0.8rem; color: var(--text-muted); display: block;">Starting at</span>
          <span class="spotlight-price">${formatPrice(featured.variants[0]?.price_cents || 1950)}</span>
        </div>
        <a href="#card-${featured.id}" class="btn btn-primary btn-sm">
          <span>View Roast Details</span>
        </a>
      </div>
    </div>
  `;
}

// 3. Brewing Guides
async function loadBrewingGuides() {
  try {
    const data = await apiRequest<{ success: boolean; guides: BrewingGuide[] }>('/api/brewing-guides');
    const container = document.getElementById('guides-container');
    if (!container || !data.guides) return;

    const icons: Record<string, string> = {
      'hario-v60-pour-over': '⏳',
      'inverted-aeropress': '🚀',
      'french-press-immersion': '🏺',
    };

    container.innerHTML = data.guides.map((g) => `
      <div class="guide-card">
        <div class="guide-icon">${icons[g.slug] || '☕'}</div>
        <h3 class="guide-title">${g.name}</h3>
        
        <div class="guide-specs">
          <div class="spec-item">
            <span>Ratio</span>
            <strong>${g.ratio_description}</strong>
          </div>
          <div class="spec-item">
            <span>Water Temp</span>
            <strong>${g.water_temp_celsius}°C</strong>
          </div>
          <div class="spec-item">
            <span>Recommended Grind</span>
            <strong>${g.grind_recommendation}</strong>
          </div>
          <div class="spec-item">
            <span>Target Time</span>
            <strong>${Math.floor(g.brew_time_seconds / 60)}m ${g.brew_time_seconds % 60}s</strong>
          </div>
        </div>

        <ol class="guide-steps">
          ${g.steps.map((s) => `<li>${s.instruction}</li>`).join('')}
        </ol>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load brewing guides:', err);
  }
}

// 4. Cart Operations
async function refreshCart() {
  try {
    const data = await apiRequest<{ success: boolean; cart: Cart }>('/api/cart');
    currentCart = data.cart;
    updateCartUI();
  } catch (err) {
    console.error('Failed to refresh cart:', err);
  }
}

async function addToCart(variantId: string, grindType: GrindType, quantity: number = 1) {
  const data = await apiRequest<{ success: boolean; cart: Cart }>('/api/cart/items', {
    method: 'POST',
    body: JSON.stringify({
      variant_id: variantId,
      grind_type: grindType,
      quantity,
    }),
  });
  currentCart = data.cart;
  updateCartUI();
}

async function updateCartItemQuantity(itemId: string, newQuantity: number) {
  const data = await apiRequest<{ success: boolean; cart: Cart }>(`/api/cart/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ quantity: newQuantity }),
  });
  currentCart = data.cart;
  updateCartUI();
}

function updateCartUI() {
  const badge = document.getElementById('cart-badge-count');
  const navTotal = document.getElementById('cart-nav-total');
  const drawerCount = document.getElementById('cart-drawer-count');
  const subtotalEl = document.getElementById('cart-subtotal');
  const discountRow = document.getElementById('cart-discount-row');
  const discountEl = document.getElementById('cart-discount');
  const totalEl = document.getElementById('cart-total');
  const itemsContainer = document.getElementById('cart-items-container');

  const totalItems = currentCart?.items?.reduce((acc, it) => acc + it.quantity, 0) || 0;
  const subtotal = currentCart?.subtotal_cents || 0;
  const discount = currentCart?.discount_cents || 0;
  const total = currentCart?.total_cents || 0;

  if (badge) badge.innerText = totalItems.toString();
  if (navTotal) navTotal.innerText = formatPrice(total);
  if (drawerCount) drawerCount.innerText = `(${totalItems} item${totalItems === 1 ? '' : 's'})`;
  if (subtotalEl) subtotalEl.innerText = formatPrice(subtotal);
  if (totalEl) totalEl.innerText = formatPrice(total);

  if (discount > 0 && discountRow && discountEl) {
    discountRow.classList.remove('hidden');
    discountEl.innerText = `-${formatPrice(discount)}`;
  } else if (discountRow) {
    discountRow.classList.add('hidden');
  }

  if (!itemsContainer) return;

  if (!currentCart?.items || currentCart.items.length === 0) {
    itemsContainer.innerHTML = `
      <div style="text-align: center; padding: 48px 0; color: var(--text-muted);">
        <div style="font-size: 2.5rem; margin-bottom: 8px;">🛒</div>
        <h4>Your roast cart is empty</h4>
        <p style="font-size: 0.9rem; margin-top: 4px;">Explore our single-origin and espresso roasts above.</p>
      </div>
    `;
    return;
  }

  itemsContainer.innerHTML = currentCart.items.map((item) => `
    <div class="cart-item-row">
      <img src="${item.image_url}" alt="${item.product_name}" class="cart-item-img" />
      <div class="cart-item-details">
        <span class="cart-item-name">${item.product_name}</span>
        <span class="cart-item-meta">${item.weight_grams}g · ${item.grind_type.replace('_', ' ')}</span>
        
        <div class="cart-item-actions">
          <div class="qty-control">
            <button class="qty-btn" onclick="window.changeItemQty('${item.id}', ${item.quantity - 1})">-</button>
            <span class="qty-val">${item.quantity}</span>
            <button class="qty-btn" onclick="window.changeItemQty('${item.id}', ${item.quantity + 1})">+</button>
          </div>
          <strong style="color: var(--roast-espresso);">${formatPrice(item.line_total_cents)}</strong>
        </div>
      </div>
    </div>
  `).join('');
}

// Global hook for quantity click
(window as any).changeItemQty = (itemId: string, qty: number) => {
  updateCartItemQuantity(itemId, Math.max(0, qty));
};

// 5. Drawer and Modal Controls
function openCartDrawer() {
  document.getElementById('cart-drawer')?.classList.remove('hidden');
  document.getElementById('cart-backdrop')?.classList.remove('hidden');
}

function closeCartDrawer() {
  document.getElementById('cart-drawer')?.classList.add('hidden');
  document.getElementById('cart-backdrop')?.classList.add('hidden');
}

function openAIDrawer() {
  document.getElementById('ai-drawer')?.classList.remove('hidden');
  document.getElementById('ai-backdrop')?.classList.remove('hidden');
  if (chatMessages.length === 0) {
    appendChatMessage('assistant', `Welcome! I'm your dedicated Roastery AI Barista. Tell me about the coffees or brew methods you enjoy, or let me recommend a single origin matching your palate!`);
  }
}

function closeAIDrawer() {
  document.getElementById('ai-drawer')?.classList.add('hidden');
  document.getElementById('ai-backdrop')?.classList.add('hidden');
}

function openCheckoutModal() {
  if (!currentCart || currentCart.items.length === 0) {
    alert('Please add items to your cart before checking out.');
    return;
  }
  trackEvent('checkout_started', undefined, { items_count: currentCart.items.length, total: currentCart.total_cents });
  closeCartDrawer();
  document.getElementById('checkout-modal')?.classList.remove('hidden');
}

function closeCheckoutModal() {
  document.getElementById('checkout-modal')?.classList.add('hidden');
}

// 6. AI Barista Chat & Tool Confirmation
function appendChatMessage(role: 'user' | 'assistant', text: string, actionCard?: any) {
  const container = document.getElementById('ai-messages');
  if (!container) return;

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  bubble.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>');

  if (actionCard) {
    const cardEl = document.createElement('div');
    cardEl.className = 'action-card';
    cardEl.innerHTML = `
      <div class="action-card-title">⚡ Proposed Cart Action</div>
      <div class="action-card-desc">${actionCard.summary}</div>
      <button class="btn btn-primary btn-sm btn-confirm-action" id="btn-conf-${actionCard.confirmation_token}">
        Confirm & Add to Cart
      </button>
    `;
    cardEl.querySelector('button')?.addEventListener('click', async () => {
      try {
        const res = await apiRequest<{ success: boolean; cart: Cart }>('/api/agent/confirm-action', {
          method: 'POST',
          body: JSON.stringify({ action: actionCard }),
        });
        currentCart = res.cart;
        updateCartUI();
        cardEl.innerHTML = `<span style="color: #22c55e; font-weight: 700;">✓ Added to Cart Successfully!</span>`;
      } catch (err: any) {
        alert(err.message || 'Action execution failed');
      }
    });
    bubble.appendChild(cardEl);
  }

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

async function sendAIMessage(userText: string) {
  if (!userText.trim()) return;

  appendChatMessage('user', userText);
  chatMessages.push({ role: 'user', content: userText });

  const input = document.getElementById('ai-user-input') as HTMLInputElement;
  if (input) input.value = '';

  try {
    const data = await apiRequest<{
      success: boolean;
      message: { role: string; content: string };
      proposed_actions?: any[];
    }>('/api/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: chatMessages }),
    });

    const reply = data.message?.content || 'Here is what I found for you:';
    chatMessages.push({ role: 'assistant', content: reply });

    const actionCard = data.proposed_actions && data.proposed_actions.length > 0 ? data.proposed_actions[0] : undefined;
    appendChatMessage('assistant', reply, actionCard);
  } catch (err: any) {
    appendChatMessage('assistant', `Sorry, I ran into an edge error: ${err.message}`);
  }
}

// 7. Event Listeners Setup
function setupEventListeners() {
  // Drawer openers
  document.getElementById('btn-open-cart')?.addEventListener('click', openCartDrawer);
  document.getElementById('btn-close-cart')?.addEventListener('click', closeCartDrawer);
  document.getElementById('cart-backdrop')?.addEventListener('click', closeCartDrawer);

  document.getElementById('btn-open-ai')?.addEventListener('click', openAIDrawer);
  document.getElementById('btn-hero-quiz')?.addEventListener('click', () => {
    openAIDrawer();
    sendAIMessage('Can you run a quick vector match to find my ideal coffee roast based on my brewing style?');
  });
  document.getElementById('btn-close-ai')?.addEventListener('click', closeAIDrawer);
  document.getElementById('ai-backdrop')?.addEventListener('click', closeAIDrawer);

  // Category Filters
  document.querySelectorAll('#category-filters .filter-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      document.querySelectorAll('#category-filters .filter-chip').forEach((c) => c.classList.remove('active'));
      const target = e.target as HTMLButtonElement;
      target.classList.add('active');
      currentCategory = target.getAttribute('data-category') || 'all';
      filterAndRenderProducts();
    });
  });

  // Roast Filters
  document.querySelectorAll('#roast-filters .roast-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      document.querySelectorAll('#roast-filters .roast-chip').forEach((c) => c.classList.remove('active'));
      const target = e.target as HTMLButtonElement;
      target.classList.add('active');
      currentRoast = target.getAttribute('data-roast') || 'ALL';
      filterAndRenderProducts();
    });
  });

  // Apply Coupon
  document.getElementById('btn-apply-coupon')?.addEventListener('click', async () => {
    const input = document.getElementById('coupon-input') as HTMLInputElement;
    const msg = document.getElementById('coupon-message');
    const code = input?.value.trim();
    if (!code) return;

    try {
      const data = await apiRequest<{ success: boolean; cart: Cart; message: string }>('/api/cart/coupon', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      currentCart = data.cart;
      updateCartUI();
      if (msg) {
        msg.style.color = '#22c55e';
        msg.innerText = data.message;
      }
    } catch (err: any) {
      if (msg) {
        msg.style.color = '#ef4444';
        msg.innerText = err.message;
      }
    }
  });

  // Checkout Modal
  document.getElementById('btn-proceed-checkout')?.addEventListener('click', openCheckoutModal);
  document.getElementById('btn-close-checkout')?.addEventListener('click', closeCheckoutModal);
  document.getElementById('btn-cancel-checkout')?.addEventListener('click', closeCheckoutModal);

  // Checkout Form Submission
  document.getElementById('checkout-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-order') as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = `<span>Securing Order on Edge...</span>`;

    const email = (document.getElementById('checkout-email') as HTMLInputElement).value;
    const name = (document.getElementById('checkout-name') as HTMLInputElement).value;
    const line1 = (document.getElementById('checkout-address') as HTMLInputElement).value;
    const city = (document.getElementById('checkout-city') as HTMLInputElement).value;
    const state = (document.getElementById('checkout-state') as HTMLInputElement).value;
    const postal_code = (document.getElementById('checkout-zip') as HTMLInputElement).value;

    try {
      const res = await apiRequest<{
        success: boolean;
        checkout_url: string;
        order_number: string;
      }>('/api/checkout', {
        method: 'POST',
        body: JSON.stringify({
          customer_email: email,
          shipping_address: {
            name,
            email,
            line1,
            city,
            state,
            postal_code,
            country: 'US',
          },
        }),
      });

      trackEvent('purchase', undefined, { order_number: res.order_number, email });
      if (res.checkout_url) {
        window.location.href = res.checkout_url;
      }
    } catch (err: any) {
      alert(`Checkout failed: ${err.message}`);
      btn.disabled = false;
      btn.innerHTML = `<span>Pay with Stripe Checkout</span>`;
    }
  });

  // AI Chat Form
  document.getElementById('ai-chat-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('ai-user-input') as HTMLInputElement;
    if (input) sendAIMessage(input.value);
  });

  // AI Quick Prompts
  document.querySelectorAll('.prompt-pill').forEach((pill) => {
    pill.addEventListener('click', (e) => {
      const prompt = (e.target as HTMLElement).getAttribute('data-prompt');
      if (prompt) sendAIMessage(prompt);
    });
  });

  // Order Lookup Form
  document.getElementById('order-lookup-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('lookup-input') as HTMLInputElement;
    const resultBox = document.getElementById('order-status-result');
    const orderNum = input.value.trim();
    if (!orderNum || !resultBox) return;

    resultBox.classList.remove('hidden');
    resultBox.innerHTML = `<div>Searching Cloudflare D1 for ${orderNum}...</div>`;

    try {
      const data = await apiRequest<{ success: boolean; order: Order }>(`/api/orders/${orderNum}`);
      const o = data.order;
      resultBox.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div>
            <h4 style="font-size: 1.2rem;">Order #${o.order_number}</h4>
            <span style="font-size: 0.85rem; color: var(--text-muted);">Placed on ${new Date(o.created_at).toLocaleDateString()}</span>
          </div>
          <span class="badge-tag" style="background: var(--roast-crema); color: #fff; font-size: 0.85rem; padding: 6px 14px;">
            Status: ${o.status.replace('_', ' ')}
          </span>
        </div>

        <div style="margin-bottom: 14px; font-size: 0.9rem;">
          <strong>Items in Batch:</strong>
          <ul style="margin-top: 6px; padding-left: 20px;">
            ${o.items.map((it) => `<li>${it.quantity}x ${it.product_name} (${it.weight_grams}g, ${it.grind_type}) — ${formatPrice(it.total_price_cents)}</li>`).join('')}
          </ul>
        </div>

        <div style="font-size: 0.9rem; color: var(--text-secondary); border-top: 1px solid var(--border-subtle); padding-top: 12px;">
          <span>Tracking: <strong>${o.tracking_number || 'Awaiting Carrier Pick-up'}</strong></span> · 
          <span>Carrier: <strong>${o.carrier || 'USPS Priority'}</strong></span>
        </div>
      `;
    } catch (err: any) {
      resultBox.innerHTML = `<div style="color: #ef4444;">No order found with order number "${orderNum}". Please verify and retry.</div>`;
    }
  });
}

// Start
initApp();
