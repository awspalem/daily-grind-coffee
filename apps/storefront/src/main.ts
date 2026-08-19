// The Daily Grind — Bangalore Specialty Coffee Storefront Interactive Client
import type { Cart, CartItem, Order, Product, ProductVariant } from '@daily-grind/shared-types';
import { buildGSTInvoiceFromOrder, renderGSTInvoiceHTML } from './utils/gstInvoice';

export type Currency = 'INR' | 'USD';

// Cloudflare Pages' `_redirects` 200-status rewrite does not proxy the Worker API reliably
// (POST requests 405 at the Pages edge, GET requests fall through to the SPA shell instead of
// reaching the Worker) — so we call the Worker's own URL directly. The Worker already sends
// permissive CORS headers (access-control-allow-origin: *), so no proxy is needed.
const API_BASE = 'https://daily-grind-api.awspalem.workers.dev';

interface LocalCartItem {
  id: string;
  variant_id: string;
  product_id: string;
  name: string;
  weight_grams: number;
  grind_type: string;
  unit_price_inr: number;
  unit_price_usd_cents: number;
  discount_percent: number;
  quantity: number;
  image_url: string;
  subscription_frequency?: string | null;
  custom_notes?: string | null;
}

// Curated Bangalore & Global Specialty Catalog
const FALLBACK_PRODUCTS: any[] = [
  {
    id: 'prod_taster_flight',
    slug: 'curated-taster-flight-3x100g',
    name: 'Curated 3x 100g Roastery Taster Flight',
    tagline: 'Pick 3 distinct 100g micro-lots from our Indian and global roastery',
    description: 'Explore three rare micro-lot profiles in custom nitrogen-flushed 100g sample pouches. Choose your favorite trio from Chikmagalur Attikan, Araku Valley Red Honey, Ethiopia Yirgacheffe, Dawn Patrol, and more.',
    category_id: 'indian-estates',
    origin_country: 'India & Global',
    region: 'Bangalore Roastery Selection',
    process_method: 'WASHED',
    roast_level: 'MEDIUM',
    tasting_notes: ['Discovery Flight', '3x 100g Pouches', 'Custom Trio', 'Freshly Roasted'],
    image_url: '/images/pour_over.jpg',
    is_active: 1,
    is_featured: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    variants: [
      { id: 'var_flight_300', product_id: 'prod_taster_flight', sku: 'TDG-FLIGHT-300G', weight_grams: 300, price_inr: 590, price_usd_cents: 2400, discount_percent: 0, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'SOUTH_INDIAN_FILTER', 'ESPRESSO', 'AEROPRESS', 'FRENCH_PRESS', 'COLD_BREW'], is_active: 1 }
    ]
  },
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
    tasting_notes: ['Dark Cacao', 'Vanilla', 'Hazelnut', 'Bourbon Spice'],
    image_url: '/images/bag_ethiopia.jpg',
    is_active: 1,
    is_featured: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    variants: [
      { id: 'var_gcb_500', product_id: 'prod_glacier_cb', sku: 'TDG-GCB-500G', weight_grams: 500, price_inr: 850, price_usd_cents: 3400, discount_percent: 0, grind_options: ['WHOLE_BEAN', 'COLD_BREW_COARSE'], is_active: 1 },
      { id: 'var_gcb_1000', product_id: 'prod_glacier_cb', sku: 'TDG-GCB-1KG', weight_grams: 1000, price_inr: 1550, price_usd_cents: 6000, discount_percent: 8, grind_options: ['WHOLE_BEAN', 'COLD_BREW_COARSE'], is_active: 1 }
    ]
  },
  {
    id: 'prod_monsoon_malabar',
    slug: 'monsoon-malabar-aa-special-reserve',
    name: 'Monsoon Malabar AA Special Reserve',
    tagline: 'Cardamom spice, warm cinnamon bark & dark baker’s cacao',
    description: 'Naturally cured by monsoon sea winds along the Malabar Coast of Karnataka and Kerala. Ultra-low acidity, syrupy heavy body, and intense aromas of green cardamom, clove spice, and dark chocolate.',
    category_id: 'indian-estates',
    origin_country: 'India',
    region: 'Malabar Coast & Chikmagalur',
    process_method: 'MONSOONED',
    roast_level: 'MEDIUM_DARK',
    tasting_notes: ['Cardamom', 'Cinnamon Bark', 'Dark Cocoa', 'Spiced Wood'],
    image_url: '/images/roaster.jpg',
    is_active: 1,
    is_featured: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    variants: [
      { id: 'var_mon_250', product_id: 'prod_monsoon_malabar', sku: 'TDG-MON-250G', weight_grams: 250, price_inr: 470, price_usd_cents: 1900, discount_percent: 0, grind_options: ['WHOLE_BEAN', 'SOUTH_INDIAN_FILTER', 'POUR_OVER', 'MOKA_POT'], is_active: 1 },
      { id: 'var_mon_500', product_id: 'prod_monsoon_malabar', sku: 'TDG-MON-500G', weight_grams: 500, price_inr: 880, price_usd_cents: 3500, discount_percent: 5, grind_options: ['WHOLE_BEAN', 'SOUTH_INDIAN_FILTER', 'POUR_OVER', 'MOKA_POT'], is_active: 1 }
    ]
  },
  {
    id: 'prod_col_geisha',
    slug: 'colombia-huila-pink-bourbon',
    name: 'Colombia Huila Pink Bourbon',
    tagline: 'Pink guava, ripe papaya, sugarcane syrup & jasmine florals',
    description: 'Rare Pink Bourbon varietal grown by master producers on volcanic slopes in Huila, Colombia. Crisp malic acidity, sparkling stone fruit notes, and crystalline honey sweetness.',
    category_id: 'international',
    origin_country: 'Colombia',
    region: 'San Agustin, Huila',
    process_method: 'WASHED',
    roast_level: 'LIGHT_MEDIUM',
    tasting_notes: ['Pink Guava', 'Papaya', 'Sugar Cane', 'Jasmine'],
    image_url: '/images/bag_ethiopia.jpg',
    is_active: 1,
    is_featured: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    variants: [
      { id: 'var_col_250', product_id: 'prod_col_geisha', sku: 'TDG-COL-250G', weight_grams: 250, price_inr: 590, price_usd_cents: 2300, discount_percent: 0, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'AEROPRESS'], is_active: 1 },
      { id: 'var_col_500', product_id: 'prod_col_geisha', sku: 'TDG-COL-500G', weight_grams: 500, price_inr: 1120, price_usd_cents: 4300, discount_percent: 5, grind_options: ['WHOLE_BEAN', 'POUR_OVER', 'AEROPRESS'], is_active: 1 }
    ]
  }
];

export interface FlavorCategoryDef {
  id: 'floral' | 'fruity' | 'sweet' | 'chocolate_nutty' | 'spiced' | string;
  name: string;
  color: string;
  icon: string;
  subNotes: string[];
  keywords: string[];
  description: string;
}

export const SCA_FLAVOR_CATEGORIES: FlavorCategoryDef[] = [
  {
    id: 'floral',
    name: 'Floral',
    color: '#b85d94',
    icon: '🌸',
    subNotes: ['Jasmine', 'Bergamot', 'Orange Blossom', 'Honeysuckle', 'Rose', 'Black Tea'],
    keywords: ['jasmine', 'bergamot', 'blossom', 'floral', 'honeysuckle', 'rose', 'tea', 'verbena'],
    description: 'Ethereal jasmine blossom, crisp bergamot citrus, and delicate tea-like honeysuckle sweetness.'
  },
  {
    id: 'fruity',
    name: 'Fruity',
    color: '#e0533b',
    icon: '🍓',
    subNotes: ['Jackfruit', 'Red Apple', 'White Peach', 'Pink Guava', 'Papaya', 'Orange Peel', 'Black Cherry'],
    keywords: ['jackfruit', 'apple', 'peach', 'guava', 'papaya', 'orange', 'cherry', 'fruit', 'citrus', 'plum', 'berry'],
    description: 'Vibrant sun-ripened jackfruit, crisp red apple, sweet white peach, and sparkling tropical fruit.'
  },
  {
    id: 'sweet',
    name: 'Sweet',
    color: '#d97706',
    icon: '🍯',
    subNotes: ['Sugarcane Jaggery', 'Wild Blossom Honey', 'Caramel Toffee', 'Vanilla Bean', 'Brown Sugar', 'Molasses'],
    keywords: ['jaggery', 'honey', 'caramel', 'toffee', 'vanilla', 'sugar', 'molasses', 'sweet', 'cane'],
    description: 'Rich Karnataka sugarcane jaggery, forest honey, butterscotch caramel, and soothing vanilla.'
  },
  {
    id: 'chocolate_nutty',
    name: 'Chocolate & Nutty',
    color: '#6e3922',
    icon: '🍫',
    subNotes: ['Dark Cacao Nibs', 'Roasted Hazelnut', 'Toasted Cashew', 'Chocolate Fudge', 'Toasted Pecan'],
    keywords: ['chocolate', 'hazelnut', 'cashew', 'cacao', 'cocoa', 'fudge', 'pecan', 'almond', 'nut', 'nibs'],
    description: 'Silky dark Belgian cacao fudge, freshly toasted Western Ghats cashews, and roasted hazelnuts.'
  },
  {
    id: 'spiced',
    name: 'Spiced',
    color: '#991b1b',
    icon: '🌶️',
    subNotes: ['Malabar Cardamom', 'Cinnamon Bark', 'Spiced Rum', 'Smoky Cedar', 'Clove', 'Brown Spice'],
    keywords: ['cardamom', 'cinnamon', 'spice', 'spiced', 'rum', 'cedar', 'smoky', 'clove', 'pepper', 'wood'],
    description: 'Aromatic Malabar green cardamom, warm cinnamon stick, smoky cured cedar, and spiced dark rum.'
  }
];

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180.0;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad)
  };
}

function describeWedgePath(cx: number, cy: number, rInner: number, rOuter: number, startDeg: number, endDeg: number): string {
  const p1 = polarToCartesian(cx, cy, rOuter, startDeg);
  const p2 = polarToCartesian(cx, cy, rOuter, endDeg);
  const p3 = polarToCartesian(cx, cy, rInner, endDeg);
  const p4 = polarToCartesian(cx, cy, rInner, startDeg);

  const largeArc = endDeg - startDeg > 180 ? 1 : 0;

  return `M ${p1.x} ${p1.y} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${rInner} ${rInner} 0 ${largeArc} 0 ${p4.x} ${p4.y} Z`;
}

class StorefrontApp {
  private products: any[] = [];
  private cartItems: LocalCartItem[] = [];
  private activeCategory: string = 'all';
  private activeTastingNote: string = 'all';
  private searchQuery: string = '';
  private reviewSummary: Record<string, { avg_rating: number; review_count: number }> = {};
  private customerSessionToken: string | null = null;
  private customerEmail: string | null = null;
  private activeFlavorWheelCategory: string = 'all';
  private currentCurrency: Currency = 'INR';
  private discountPercentage: number = 0;
  private appliedCouponCode: string | null = null;
  private sessionId: string;
  private deferredInstallPrompt: any = null;
  private productSubState: Record<string, { isSub: boolean; frequency: string }> = {};
  private flightState = {
    slot1: 'prod_chik_attikan',
    slot2: 'prod_araku_honey',
    slot3: 'prod_eth_yirg',
    grind: 'WHOLE_BEAN',
    isSub: false,
    frequency: '2_WEEKS'
  };
  private chatHistory: { role: 'user' | 'assistant'; content: string }[] = [];
  private modalFocusReturnEl: HTMLElement | null = null;

  constructor() {
    this.sessionId = localStorage.getItem('tdg_session_id') || `sess_${Math.random().toString(36).substring(2, 12)}`;
    localStorage.setItem('tdg_session_id', this.sessionId);
    
    // Load currency preference (default INR)
    const savedCurrency = localStorage.getItem('tdg_currency') as Currency;
    if (savedCurrency === 'USD' || savedCurrency === 'INR') {
      this.currentCurrency = savedCurrency;
    } else {
      this.currentCurrency = 'INR';
    }

    // Load persisted cart
    const savedCart = localStorage.getItem('tdg_cart');
    if (savedCart) {
      try {
        this.cartItems = JSON.parse(savedCart);
      } catch {
        this.cartItems = [];
      }
    }

    this.customerSessionToken = localStorage.getItem('tdg_customer_session');
    this.customerEmail = localStorage.getItem('tdg_customer_email');
  }

  async init() {
    this.updateCurrencyButtons();
    this.setupEventListeners();
    this.setupBrewCalculator();
    this.setupQuiz();
    this.setupPWA();
    this.setupFlavorWheel();
    this.setupFlightBuilder();
    this.setupAccountModal();
    this.setupNewsletterForm();
    this.renderFlavorWheelSVGs();
    this.updateCartUI();
    this.handleQRCodeDeepLink();
    this.handleOrderConfirmationDeepLink();
    this.handleResumeOrderDeepLink();
    this.handleReviewProductDeepLink();
    await this.loadCatalog();
  }

  setCurrency(curr: Currency) {
    this.currentCurrency = curr;
    localStorage.setItem('tdg_currency', curr);
    this.updateCurrencyButtons();
    this.renderProducts();
    this.updateFlightPricingUI();
    this.updateCartUI();

    // Update announcement banner threshold
    const badge = document.getElementById('announcement-shipping-badge');
    if (badge) {
      badge.textContent = curr === 'INR' ? 'FREE ROASTERY SHIPPING ACROSS INDIA ON ₹1,200+' : 'FREE EXPRESS SHIPPING ON ORDERS $45+';
    }
  }

  private updateCurrencyButtons() {
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
    } else {
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

  formatPrice(priceInr: number, priceUsdCents?: number): string {
    if (this.currentCurrency === 'INR') {
      return `₹${Math.round(priceInr).toLocaleString('en-IN')}`;
    } else {
      const cents = priceUsdCents ?? Math.round(priceInr / 23 * 100);
      return `$${(cents / 100).toFixed(2)}`;
    }
  }

  private async loadCatalog() {
    try {
      const res = await fetch(`${API_BASE}/api/products`);
      if (res.ok) {
        const data = await res.json() as { products: any[] };
        if (data.products && data.products.length > 0) {
          this.products = data.products.map((p) => ({
            ...p,
            variants: p.variants.map((v: any) => ({
              ...v,
              price_inr: v.price_inr || Math.round(v.price_cents * 0.23),
              price_usd_cents: v.price_usd_cents || v.price_cents,
              discount_percent: v.discount_percent || 0
            }))
          }));
        } else {
          this.products = FALLBACK_PRODUCTS;
        }
      } else {
        this.products = FALLBACK_PRODUCTS;
      }
    } catch {
      this.products = FALLBACK_PRODUCTS;
    }

    const countAllEl = document.getElementById('count-wheel-all');
    if (countAllEl) {
      countAllEl.textContent = `${this.products.length} Roasts`;
    }

    try {
      const res = await fetch(`${API_BASE}/api/reviews/summary`);
      if (res.ok) {
        const data = await res.json() as { success: boolean; summary: Record<string, { avg_rating: number; review_count: number }> };
        this.reviewSummary = data.summary || {};
      }
    } catch {
      // Reviews are non-critical — leave summary empty rather than blocking catalog render
    }

    this.renderProducts();
    this.renderFlavorWheelSVGs();
    this.injectProductStructuredData();
  }

  // Emits Product/Offer/AggregateRating JSON-LD for the full catalog so Google can surface
  // price and star-rating rich snippets — this SPA has no per-product URLs, so this is scoped
  // to the whole catalog on the one page that exists rather than per-product pages.
  private injectProductStructuredData() {
    if (this.products.length === 0) return;

    let script = document.getElementById('product-ld-json') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = 'product-ld-json';
      script.type = 'application/ld+json';
      document.head.appendChild(script);
    }

    const itemListElement = this.products.map((prod, idx) => {
      const variant = prod.variants[0];
      const rating = this.reviewSummary[prod.id];
      const inStock = variant ? (typeof variant.stock_quantity !== 'number' || variant.stock_quantity > 0) : true;

      const product: Record<string, unknown> = {
        '@type': 'Product',
        name: prod.name,
        description: prod.tagline || prod.description,
        image: prod.image_url ? new URL(prod.image_url, window.location.origin).toString() : undefined,
        sku: variant?.sku,
        brand: { '@type': 'Brand', name: 'The Daily Grind' },
        offers: variant ? {
          '@type': 'Offer',
          priceCurrency: this.currentCurrency,
          price: (this.currentCurrency === 'INR' ? variant.price_inr : (variant.price_usd_cents || variant.price_cents) / 100).toFixed(2),
          availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          url: `${window.location.origin}/#catalog`
        } : undefined,
        aggregateRating: rating ? {
          '@type': 'AggregateRating',
          ratingValue: rating.avg_rating,
          reviewCount: rating.review_count
        } : undefined
      };

      return { '@type': 'ListItem', position: idx + 1, item: product };
    });

    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement
    });
  }

  private renderProducts() {
    const container = document.getElementById('product-grid-container');
    if (!container) return;

    let filtered = this.products;

    if (this.searchQuery.trim() !== '') {
      const q = this.searchQuery.trim().toLowerCase();
      filtered = filtered.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.tagline || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.origin_country || '').toLowerCase().includes(q) ||
        (p.roast_level || '').toLowerCase().replace(/_/g, ' ').includes(q) ||
        p.tasting_notes.some((n: string) => n.toLowerCase().includes(q))
      );
    }

    if (this.activeCategory !== 'all') {
      filtered = filtered.filter((p) => p.category_id === this.activeCategory || p.slug.includes(this.activeCategory));
    }

    if (this.activeTastingNote !== 'all') {
      filtered = filtered.filter((p) => p.tasting_notes.some((n: string) => n.toLowerCase().includes(this.activeTastingNote.toLowerCase())));
    }

    let activeWheelCatDef: FlavorCategoryDef | undefined;
    if (this.activeFlavorWheelCategory !== 'all') {
      activeWheelCatDef = SCA_FLAVOR_CATEGORIES.find((c) => c.id === this.activeFlavorWheelCategory);
      if (activeWheelCatDef) {
        filtered = filtered.filter((p) => this.matchesFlavorCategory(p, activeWheelCatDef!));
      }
    }

    if (filtered.length === 0) {
      const emptyMessage = this.searchQuery.trim() !== ''
        ? `No roasts match "${this.escapeHtml(this.searchQuery.trim())}".`
        : 'No roasts match your exact flavor filter.';
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align:center; padding: 4rem 1rem; color: var(--text-muted);">
          <p style="font-size: 1.2rem; font-family: var(--font-serif);">${emptyMessage}</p>
          <button class="btn-secondary" style="margin-top:1rem;" onclick="window.storefrontApp.resetFilters()">View All Roasts</button>
        </div>
      `;
      return;
    }

    // Bestseller badge is derived from real review counts (top 2 reviewed roasts),
    // never hard-coded, so it stays honest as review data changes.
    const bestsellerIds = new Set(
      Object.entries(this.reviewSummary)
        .filter(([, rs]) => rs.review_count > 0)
        .sort((a, b) => b[1].review_count - a[1].review_count)
        .slice(0, 2)
        .map(([id]) => id)
    );

    container.innerHTML = filtered.map((prod) => {
      // stock_quantity is only present when data came from the live API (see loadCatalog) —
      // FALLBACK_PRODUCTS has no inventory backing, so treat "unknown" as "don't gate on stock".
      const hasStockData = prod.variants.length > 0 && typeof prod.variants[0].stock_quantity === 'number';
      const inStockVariant = hasStockData ? prod.variants.find((v: any) => v.stock_quantity > 0) : undefined;
      const defaultVariant = inStockVariant || prod.variants[0] || { id: 'v1', weight_grams: 250, price_inr: 450, price_usd_cents: 1850, discount_percent: 0 };
      const isProductSoldOut = hasStockData && !inStockVariant;

      const isWheelMatch = Boolean(activeWheelCatDef && this.matchesFlavorCategory(prod, activeWheelCatDef));

      const subState = this.productSubState[prod.id] || { isSub: false, frequency: '2_WEEKS' };
      this.productSubState[prod.id] = subState;
      const isSub = subState.isSub;
      const subFreq = subState.frequency;

      const subPriceInr = Math.round(defaultVariant.price_inr * 0.90);
      const subPriceUsd = Math.round(defaultVariant.price_usd_cents * 0.90);

      const displayPriceInr = isSub ? subPriceInr : defaultVariant.price_inr;
      const displayPriceUsd = isSub ? subPriceUsd : defaultVariant.price_usd_cents;

      const formattedPrice = this.formatPrice(displayPriceInr, displayPriceUsd);
      const originalFormattedPrice = this.formatPrice(defaultVariant.price_inr, defaultVariant.price_usd_cents);

      const notesHtml = prod.tasting_notes.map((n: string) => {
        let isNoteMatched = false;
        if (activeWheelCatDef) {
          isNoteMatched = activeWheelCatDef.keywords.some((k) => n.toLowerCase().includes(k.toLowerCase())) ||
                          activeWheelCatDef.subNotes.some((sn) => n.toLowerCase().includes(sn.toLowerCase()));
        }
        if (isNoteMatched && activeWheelCatDef) {
          return `<span class="taste-tag tag-match" style="background: ${activeWheelCatDef.color}; color:#fff;">${n}</span>`;
        }
        return `<span class="taste-tag">${n}</span>`;
      }).join('');
      
      const roastScore = prod.roast_level === 'LIGHT' ? 25 : prod.roast_level === 'LIGHT_MEDIUM' ? 45 : prod.roast_level === 'MEDIUM' ? 65 : prod.roast_level === 'MEDIUM_DARK' ? 78 : 90;

      const weightButtons = prod.variants.map((v: any) => {
        const variantSoldOut = hasStockData && v.stock_quantity <= 0;
        return `
        <button class="weight-btn ${v.id === defaultVariant.id ? 'selected' : ''}" data-variant-id="${v.id}" data-price-inr="${v.price_inr}" data-price-usd="${v.price_usd_cents || v.price_cents}" data-discount="${v.discount_percent || 0}" data-weight="${v.weight_grams}" data-stock="${hasStockData ? v.stock_quantity : ''}" ${variantSoldOut ? 'disabled title="Sold out"' : ''}>
          ${v.weight_grams >= 1000 ? `${v.weight_grams / 1000}kg` : `${v.weight_grams}g`}
        </button>
      `;
      }).join('');

      let stockBadgeHtml = '';
      if (isProductSoldOut) {
        stockBadgeHtml = `<span class="stock-badge sold-out">Sold Out</span>`;
      } else if (hasStockData && defaultVariant.stock_quantity > 0 && defaultVariant.stock_quantity <= 8) {
        stockBadgeHtml = `<span class="stock-badge low-stock">Only ${defaultVariant.stock_quantity} left</span>`;
      }

      let merchBadgeHtml = '';
      if (bestsellerIds.has(prod.id)) {
        merchBadgeHtml = `<span class="merch-badge bestseller">Bestseller</span>`;
      } else {
        const daysOld = (Date.now() - new Date(prod.created_at).getTime()) / 86400000;
        if (Number.isFinite(daysOld) && daysOld >= 0 && daysOld <= 45) {
          merchBadgeHtml = `<span class="merch-badge is-new">New</span>`;
        }
      }

      return `
        <article class="product-card ${isWheelMatch ? 'wheel-match' : ''} ${isProductSoldOut ? 'is-sold-out' : ''}" data-product-id="${prod.id}">
          <div class="card-media">
            <img src="${prod.image_url || '/images/bag_ethiopia.jpg'}" alt="${prod.name}" loading="lazy">
            <span class="origin-badge">${prod.origin_country}</span>
            <span class="roast-level-tag">${prod.roast_level.replace('_', ' ')} ROAST</span>
            ${stockBadgeHtml}
            ${merchBadgeHtml}
          </div>

          <div class="card-body">
            <div class="card-title-row">
              <h3 class="card-title">${prod.name}</h3>
            </div>
            <p class="card-tagline">${prod.tagline}</p>

            ${(() => {
              const rs = this.reviewSummary[prod.id];
              const stars = rs ? '★'.repeat(Math.round(rs.avg_rating)) + '☆'.repeat(5 - Math.round(rs.avg_rating)) : '';
              return `<button type="button" class="product-rating-badge" data-action="open-reviews" data-prod-id="${prod.id}" data-prod-name="${this.escapeHtml(prod.name)}">
                ${rs ? `<span class="stars">${stars}</span> ${rs.avg_rating} (${rs.review_count} review${rs.review_count === 1 ? '' : 's'})` : 'Be the first to review'}
              </button>`;
            })()}

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

              <!-- One-Time Purchase vs Subscribe & Save 10% Toggle -->
              <div class="selector-group">
                <span class="selector-label">Purchase Option</span>
                <div class="sub-toggle-container ${isSub ? 'active-sub' : ''}" id="sub-toggle-box-${prod.id}">
                  <div class="sub-switch-row">
                    <button class="sub-switch-btn ${!isSub ? 'selected' : ''}" data-action="toggle-sub" data-sub="false" data-prod-id="${prod.id}" type="button">
                      🛒 One-Time
                    </button>
                    <button class="sub-switch-btn ${isSub ? 'selected' : ''}" data-action="toggle-sub" data-sub="true" data-prod-id="${prod.id}" type="button">
                      ✨ Subscribe &amp; Save <span class="sub-save-tag">-10%</span>
                    </button>
                  </div>
                  <div class="sub-frequency-row" id="sub-freq-row-${prod.id}" style="${isSub ? 'display: flex;' : 'display: none;'}">
                    <div class="sub-freq-label">
                      <span>Delivery Frequency</span>
                      <span style="color:var(--accent-emerald);">10% Off Every Order</span>
                    </div>
                    <div class="sub-freq-pills" data-prod="${prod.id}">
                      <button class="sub-freq-pill ${subFreq === '1_WEEK' ? 'selected' : ''}" data-action="select-freq" data-freq="1_WEEK" data-prod-id="${prod.id}" type="button">Every 1 Week</button>
                      <button class="sub-freq-pill ${subFreq === '2_WEEKS' ? 'selected' : ''}" data-action="select-freq" data-freq="2_WEEKS" data-prod-id="${prod.id}" type="button">Every 2 Weeks</button>
                      <button class="sub-freq-pill ${subFreq === '4_WEEKS' ? 'selected' : ''}" data-action="select-freq" data-freq="4_WEEKS" data-prod-id="${prod.id}" type="button">Every 4 Weeks</button>
                    </div>
                    <div class="sub-perk-caption">☕ Freshly roasted &amp; dispatched right before renewal. Swap or cancel anytime.</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="card-footer">
              <div class="card-price" id="price-display-${prod.id}">
                ${isSub ? `<span class="price-original-struck">${originalFormattedPrice}</span>` : ''}
                <span>${formattedPrice}</span>
                ${isSub ? `<span class="price-discount-tag">-10% CLUB</span>` : ''}
                <small>/ ${defaultVariant.weight_grams}g</small>
              </div>
              <button class="btn-add-cart" data-action="add-to-cart" data-prod-id="${prod.id}" ${isProductSoldOut ? 'disabled' : ''}>
                <span>${isProductSoldOut ? 'Sold Out' : 'Add to Cart'}</span>
              </button>
            </div>
          </div>
        </article>
      `;
    }).join('');

    // Attach review badges
    document.querySelectorAll('[data-action="open-reviews"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.triggerHaptic();
        const target = e.currentTarget as HTMLElement;
        const prodId = target.getAttribute('data-prod-id') || '';
        const prodName = target.getAttribute('data-prod-name') || 'this coffee';
        this.openReviewsModal(prodId, prodName);
      });
    });

    // Attach weight selectors
    document.querySelectorAll('.weight-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const parent = target.parentElement;
        if (!parent) return;
        parent.querySelectorAll('.weight-btn').forEach((b) => b.classList.remove('selected'));
        target.classList.add('selected');

        const prodId = parent.getAttribute('data-prod') || '';
        const priceInr = parseFloat(target.getAttribute('data-price-inr') || '450');
        const priceUsd = parseInt(target.getAttribute('data-price-usd') || '1850', 10);
        const weightGrams = parseInt(target.getAttribute('data-weight') || '250', 10);

        this.updateCardPriceDisplay(prodId, priceInr, priceUsd, weightGrams);
      });
    });

    // Attach Subscribe & Save toggles
    document.querySelectorAll('[data-action="toggle-sub"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.triggerHaptic();
        const target = e.currentTarget as HTMLElement;
        const prodId = target.getAttribute('data-prod-id') || '';
        const isSub = target.getAttribute('data-sub') === 'true';

        if (!this.productSubState[prodId]) {
          this.productSubState[prodId] = { isSub: false, frequency: '2_WEEKS' };
        }
        this.productSubState[prodId].isSub = isSub;

        const card = target.closest('.product-card');
        const toggleBox = card?.querySelector(`#sub-toggle-box-${prodId}`);
        const freqRow = card?.querySelector(`#sub-freq-row-${prodId}`) as HTMLElement;
        
        // Update button states
        toggleBox?.querySelectorAll('[data-action="toggle-sub"]').forEach((b) => b.classList.remove('selected'));
        target.classList.add('selected');

        if (isSub) {
          toggleBox?.classList.add('active-sub');
          if (freqRow) freqRow.style.display = 'flex';
        } else {
          toggleBox?.classList.remove('active-sub');
          if (freqRow) freqRow.style.display = 'none';
        }

        // Recompute price display for selected weight
        const selectedWeightBtn = card?.querySelector('.weight-btn.selected') as HTMLElement;
        const priceInr = parseFloat(selectedWeightBtn?.getAttribute('data-price-inr') || '450');
        const priceUsd = parseInt(selectedWeightBtn?.getAttribute('data-price-usd') || '1850', 10);
        const weightGrams = parseInt(selectedWeightBtn?.getAttribute('data-weight') || '250', 10);

        this.updateCardPriceDisplay(prodId, priceInr, priceUsd, weightGrams);
      });
    });

    // Attach frequency selectors
    document.querySelectorAll('[data-action="select-freq"]').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        this.triggerHaptic();
        const target = e.currentTarget as HTMLElement;
        const prodId = target.getAttribute('data-prod-id') || '';
        const freq = target.getAttribute('data-freq') || '2_WEEKS';

        if (!this.productSubState[prodId]) {
          this.productSubState[prodId] = { isSub: true, frequency: '2_WEEKS' };
        }
        this.productSubState[prodId].frequency = freq;

        const parent = target.parentElement;
        parent?.querySelectorAll('.sub-freq-pill').forEach((p) => p.classList.remove('selected'));
        target.classList.add('selected');
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
        const basePriceInr = parseFloat(selectedWeightBtn?.getAttribute('data-price-inr') || `${prod.variants[0]?.price_inr || 450}`);
        const basePriceUsd = parseInt(selectedWeightBtn?.getAttribute('data-price-usd') || `${prod.variants[0]?.price_usd_cents || 1850}`, 10);
        const discount = parseInt(selectedWeightBtn?.getAttribute('data-discount') || '0', 10);
        const weightGrams = parseInt(selectedWeightBtn?.getAttribute('data-weight') || `${prod.variants[0]?.weight_grams || 250}`, 10);
        const grindSelect = card?.querySelector('.grind-dropdown') as HTMLSelectElement;
        const grindType = grindSelect ? grindSelect.value : 'WHOLE_BEAN';

        const subState = this.productSubState[prod.id] || { isSub: false, frequency: '2_WEEKS' };
        const isSub = subState.isSub;
        const unitPriceInr = isSub ? Math.round(basePriceInr * 0.90) : basePriceInr;
        const unitPriceUsd = isSub ? Math.round(basePriceUsd * 0.90) : basePriceUsd;

        this.addToCart({
          id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          product_id: prod.id,
          variant_id: variantId,
          name: prod.name,
          unit_price_inr: unitPriceInr,
          unit_price_usd_cents: unitPriceUsd,
          discount_percent: isSub ? 10 : discount,
          weight_grams: weightGrams,
          grind_type: grindType,
          quantity: 1,
          image_url: prod.image_url || '/images/bag_ethiopia.jpg',
          subscription_frequency: isSub ? subState.frequency : null,
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

    this.observeProductViews(container);
  }

  // Fires `product_view` once per product per session, on genuine scroll-into-view — not on
  // every re-render (search keystrokes / filter clicks re-render the grid constantly, and a
  // per-render ping would flood analytics_events and skew the admin funnel's view-based ratios).
  private viewedProductIds = new Set<string>();
  private productViewObserver: IntersectionObserver | null = null;
  private observeProductViews(container: HTMLElement) {
    this.productViewObserver?.disconnect();
    this.productViewObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const prodId = (entry.target as HTMLElement).getAttribute('data-product-id');
        if (!prodId || this.viewedProductIds.has(prodId)) continue;
        this.viewedProductIds.add(prodId);
        this.trackEvent('product_view', { product_id: prodId });
        this.productViewObserver?.unobserve(entry.target);
      }
    }, { threshold: 0.5 });
    container.querySelectorAll('.product-card').forEach((card) => this.productViewObserver?.observe(card));
  }

  private updateCardPriceDisplay(prodId: string, basePriceInr: number, basePriceUsd: number, weightGrams: number) {
    const priceDisplay = document.getElementById(`price-display-${prodId}`);
    if (!priceDisplay) return;

    const subState = this.productSubState[prodId] || { isSub: false, frequency: '2_WEEKS' };
    const isSub = subState.isSub;

    const subPriceInr = Math.round(basePriceInr * 0.90);
    const subPriceUsd = Math.round(basePriceUsd * 0.90);

    const displayPriceInr = isSub ? subPriceInr : basePriceInr;
    const displayPriceUsd = isSub ? subPriceUsd : basePriceUsd;

    const formattedPrice = this.formatPrice(displayPriceInr, displayPriceUsd);
    const originalFormattedPrice = this.formatPrice(basePriceInr, basePriceUsd);
    const weightLabel = weightGrams >= 1000 ? `${weightGrams / 1000}kg` : `${weightGrams}g`;

    if (isSub) {
      priceDisplay.innerHTML = `
        <span class="price-original-struck">${originalFormattedPrice}</span>
        <span>${formattedPrice}</span>
        <span class="price-discount-tag">-10% CLUB</span>
        <small>/ ${weightLabel}</small>
      `;
    } else {
      priceDisplay.innerHTML = `
        <span>${formattedPrice}</span>
        <small>/ ${weightLabel}</small>
      `;
    }
  }

  private setupFlightBuilder() {
    const slotSelects = [
      document.getElementById('flight-select-slot1') as HTMLSelectElement,
      document.getElementById('flight-select-slot2') as HTMLSelectElement,
      document.getElementById('flight-select-slot3') as HTMLSelectElement,
    ];

    const availableCoffees = [
      { id: 'prod_chik_attikan', name: 'Chikmagalur Attikan Estate Honey', origin: 'Chikmagalur, Karnataka', process: 'Honey Process', roast: 'Medium-Light', notes: '🍯 Sugarcane Jaggery · Red Apple · Roasted Hazelnut · Caramel' },
      { id: 'prod_araku_honey', name: 'Araku Valley Red Honey Micro-Lot', origin: 'Araku Valley, Andhra Pradesh', process: 'Red Honey', roast: 'Light-Medium', notes: '🥭 Ripe Jackfruit · Wild Blossom Honey · Candied Orange Peel' },
      { id: 'prod_eth_yirg', name: 'Ethiopia Yirgacheffe Gedeb', origin: 'Gedeb, Ethiopia', process: 'Natural Process', roast: 'Light Roast', notes: '🌸 Floral Jasmine · Crisp Bergamot Tea · Sweet White Peach' },
      { id: 'prod_dawn_blend', name: 'Dawn Patrol Bangalore Roastery Blend', origin: 'Chikmagalur & Coorg', process: 'Washed & Natural', roast: 'Medium Roast', notes: '🍫 Dark Chocolate Fudge · Toasted Cashew · Caramel' },
      { id: 'prod_mid_runner', name: 'Midnight Runner Dark Espresso', origin: 'Shevaroys / Antigua', process: 'Washed Process', roast: 'Dark Roast', notes: '🍫 Dark Dutch Cocoa · Molasses · Smoky Velvet Crema' },
      { id: 'prod_monsoon_malabar', name: 'Monsoon Malabar AA Special Reserve', origin: 'Malabar Coast, Karnataka', process: 'Monsooned Cured', roast: 'Medium-Dark', notes: '🌶️ Malabar Cardamom · Cinnamon Bark · Dark Cocoa' },
      { id: 'prod_col_geisha', name: 'Colombia Huila Pink Bourbon', origin: 'San Agustin, Huila', process: 'Washed Process', roast: 'Light-Medium', notes: '🍓 Pink Guava · Papaya · Sugarcane Syrup · Jasmine' },
      { id: 'prod_glacier_cb', name: 'Glacier Steep Cold Brew Blend', origin: 'Western Ghats', process: 'Natural Immersion', roast: 'Medium-Dark', notes: '🧊 Dark Cacao · Vanilla Bean · Bourbon Undertones' }
    ];

    slotSelects.forEach((sel, idx) => {
      if (!sel) return;
      sel.innerHTML = availableCoffees.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
      const slotKey = `slot${idx + 1}` as 'slot1' | 'slot2' | 'slot3';
      sel.value = this.flightState[slotKey];
      sel.addEventListener('change', (e) => {
        this.triggerHaptic();
        const val = (e.target as HTMLSelectElement).value;
        this.flightState[slotKey] = val;
        this.updateFlightSlotCard(idx + 1, val, availableCoffees);
        document.querySelectorAll('.flight-preset-btn').forEach((b) => b.classList.remove('active'));
      });
    });

    // Initial slot card updates
    slotSelects.forEach((_, idx) => {
      const slotKey = `slot${idx + 1}` as 'slot1' | 'slot2' | 'slot3';
      this.updateFlightSlotCard(idx + 1, this.flightState[slotKey], availableCoffees);
    });

    // Preset Buttons
    document.querySelectorAll('.flight-preset-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.triggerHaptic();
        document.querySelectorAll('.flight-preset-btn').forEach((b) => b.classList.remove('active'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('active');
        const preset = target.getAttribute('data-preset');

        if (preset === 'india-estates') {
          this.flightState.slot1 = 'prod_chik_attikan';
          this.flightState.slot2 = 'prod_araku_honey';
          this.flightState.slot3 = 'prod_dawn_blend';
        } else if (preset === 'global-explorer') {
          this.flightState.slot1 = 'prod_eth_yirg';
          this.flightState.slot2 = 'prod_col_geisha';
          this.flightState.slot3 = 'prod_chik_attikan';
        } else if (preset === 'roasters-choice') {
          this.flightState.slot1 = 'prod_chik_attikan';
          this.flightState.slot2 = 'prod_araku_honey';
          this.flightState.slot3 = 'prod_eth_yirg';
        } else if (preset === 'dark-espresso') {
          this.flightState.slot1 = 'prod_mid_runner';
          this.flightState.slot2 = 'prod_dawn_blend';
          this.flightState.slot3 = 'prod_glacier_cb';
        }

        slotSelects.forEach((sel, idx) => {
          if (sel) {
            const slotKey = `slot${idx + 1}` as 'slot1' | 'slot2' | 'slot3';
            sel.value = this.flightState[slotKey];
            this.updateFlightSlotCard(idx + 1, this.flightState[slotKey], availableCoffees);
          }
        });
      });
    });

    // Flight Subscription Toggle
    const btnOneTime = document.getElementById('flight-sub-btn-onetime');
    const btnClub = document.getElementById('flight-sub-btn-club');
    const freqRow = document.getElementById('flight-sub-freq-row');
    const subContainer = document.getElementById('flight-sub-container');

    btnOneTime?.addEventListener('click', () => {
      this.triggerHaptic();
      this.flightState.isSub = false;
      btnOneTime.classList.add('selected');
      btnClub?.classList.remove('selected');
      subContainer?.classList.remove('active-sub');
      if (freqRow) freqRow.style.display = 'none';
      this.updateFlightPricingUI();
    });

    btnClub?.addEventListener('click', () => {
      this.triggerHaptic();
      this.flightState.isSub = true;
      btnClub.classList.add('selected');
      btnOneTime?.classList.remove('selected');
      subContainer?.classList.add('active-sub');
      if (freqRow) freqRow.style.display = 'flex';
      this.updateFlightPricingUI();
    });

    freqRow?.querySelectorAll('.sub-freq-pill').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        this.triggerHaptic();
        freqRow.querySelectorAll('.sub-freq-pill').forEach((p) => p.classList.remove('selected'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('selected');
        this.flightState.frequency = target.getAttribute('data-freq') || '2_WEEKS';
      });
    });

    // Universal Grind Selection
    const grindSelect = document.getElementById('flight-universal-grind') as HTMLSelectElement;
    grindSelect?.addEventListener('change', () => {
      this.flightState.grind = grindSelect.value;
    });

    // 1-Click "Add Taster Flight to Cart"
    document.getElementById('btn-add-flight-to-cart')?.addEventListener('click', () => {
      this.triggerHaptic();
      const coffee1 = availableCoffees.find((c) => c.id === this.flightState.slot1);
      const coffee2 = availableCoffees.find((c) => c.id === this.flightState.slot2);
      const coffee3 = availableCoffees.find((c) => c.id === this.flightState.slot3);

      const baseInr = 590;
      const baseUsdCents = 2400;
      const unitPriceInr = this.flightState.isSub ? Math.round(baseInr * 0.90) : baseInr;
      const unitPriceUsdCents = this.flightState.isSub ? Math.round(baseUsdCents * 0.90) : baseUsdCents;

      const grindVal = grindSelect ? grindSelect.value : 'WHOLE_BEAN';
      const notesSummary = `3x 100g Lots: 1. ${coffee1?.name || 'Attikan Honey'}, 2. ${coffee2?.name || 'Araku Red Honey'}, 3. ${coffee3?.name || 'Ethiopia Yirgacheffe'}`;

      this.addToCart({
        id: `flight_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        product_id: 'prod_taster_flight',
        variant_id: 'var_flight_300',
        name: 'Curated 3x 100g Taster Flight',
        weight_grams: 300,
        grind_type: grindVal,
        unit_price_inr: unitPriceInr,
        unit_price_usd_cents: unitPriceUsdCents,
        discount_percent: this.flightState.isSub ? 10 : 0,
        quantity: 1,
        image_url: '/images/pour_over.jpg',
        subscription_frequency: this.flightState.isSub ? this.flightState.frequency : null,
        custom_notes: notesSummary,
      });

      const btn = document.getElementById('btn-add-flight-to-cart');
      if (btn) {
        const origHtml = btn.innerHTML;
        btn.innerHTML = '<span>✓ Taster Flight Added!</span>';
        btn.style.background = 'var(--accent-emerald)';
        setTimeout(() => {
          btn.innerHTML = origHtml;
          btn.style.background = 'var(--accent-terracotta)';
        }, 1500);
      }
    });

    this.updateFlightPricingUI();
  }

  private updateFlightSlotCard(slotNum: number, coffeeId: string, availableCoffees: any[]) {
    const coffee = availableCoffees.find((c) => c.id === coffeeId);
    if (!coffee) return;

    const titleEl = document.getElementById(`slot-name-${slotNum}`);
    const metaEl = document.getElementById(`slot-meta-${slotNum}`);
    const notesEl = document.getElementById(`slot-notes-${slotNum}`);

    if (titleEl) titleEl.textContent = coffee.name;

    if (metaEl) {
      metaEl.innerHTML = `
        <span class="slot-meta-tag">${coffee.origin}</span>
        <span class="slot-meta-tag">${coffee.process}</span>
        <span class="slot-meta-tag">${coffee.roast}</span>
      `;
    }

    if (notesEl) {
      notesEl.textContent = coffee.notes;
    }
  }

  private updateFlightPricingUI() {
    const priceDisplay = document.getElementById('flight-price-display');
    const footerPrice = document.getElementById('flight-footer-price');
    const subnote = document.getElementById('flight-price-subnote');

    const baseInr = 590;
    const baseUsd = 2400;

    if (this.flightState.isSub) {
      const subInr = Math.round(baseInr * 0.90); // 531
      const subUsd = Math.round(baseUsd * 0.90); // 2160
      const formatted = this.formatPrice(subInr, subUsd);
      const origFormatted = this.formatPrice(baseInr, baseUsd);

      if (priceDisplay) {
        priceDisplay.innerHTML = `<span class="price-original-struck" style="color:rgba(255,255,255,0.6);">${origFormatted}</span> <span>${formatted}</span>`;
      }
      if (footerPrice) {
        footerPrice.innerHTML = `<span class="price-original-struck">${origFormatted}</span> <span>${formatted} (300g · Save 10%)</span>`;
      }
      if (subnote) {
        subnote.textContent = `${formatted} Recurring Roastery Club · Free Priority Shipping Across India`;
      }
    } else {
      const formatted = this.formatPrice(baseInr, baseUsd);
      if (priceDisplay) priceDisplay.textContent = formatted;
      if (footerPrice) footerPrice.textContent = `${formatted} (300g Total)`;
      if (subnote) {
        subnote.textContent = this.currentCurrency === 'INR' ? '₹590 (INR) / $24.00 (USD) · Free Priority Roastery Dispatch' : '$24.00 (USD) · Free Priority Roastery Dispatch';
      }
    }
  }

  addToCart(item: LocalCartItem) {
    const existing = this.cartItems.find(
      (i) => i.variant_id === item.variant_id && 
             i.grind_type === item.grind_type && 
             (i.subscription_frequency || null) === (item.subscription_frequency || null) &&
             (i.custom_notes || null) === (item.custom_notes || null)
    );
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      this.cartItems.push(item);
    }
    this.saveCart();
    this.updateCartUI();
    this.openCart();
    this.trackEvent('add_to_cart', { product_id: item.product_id, metadata: { variant_id: item.variant_id, quantity: item.quantity } });
    this.announce(`${item.name} added to cart.`);
  }

  // Screen readers don't reliably announce a button's own text swapping to "Added!" — an
  // aria-live region gives a consistent announcement regardless of what triggered the add.
  private announce(message: string) {
    const region = document.getElementById('sr-live-region');
    if (region) region.textContent = message;
  }

  // Fire-and-forget funnel telemetry for the admin analytics dashboard (GET /api/analytics/funnel).
  // Never blocks or throws on the caller — a dropped analytics ping should never break checkout.
  private trackEvent(eventName: 'product_view' | 'add_to_cart' | 'checkout_started' | 'purchase', opts: { product_id?: string; metadata?: Record<string, unknown> } = {}) {
    fetch(`${API_BASE}/api/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_name: eventName,
        session_id: this.sessionId,
        product_id: opts.product_id,
        metadata: opts.metadata
      })
    }).catch(() => { /* analytics is best-effort */ });
  }

  private saveCart() {
    localStorage.setItem('tdg_cart', JSON.stringify(this.cartItems));
  }

  private escapeHtml(value: string): string {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
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

  private updateCartUI() {
    const headerBadge = document.getElementById('header-cart-count');
    const mobBadge = document.getElementById('mob-cart-count');
    const drawerCount = document.getElementById('cart-items-count');
    const container = document.getElementById('cart-items-container');
    const subtotalEl = document.getElementById('cart-subtotal');
    const shippingEl = document.getElementById('cart-shipping');
    const totalEl = document.getElementById('cart-total');
    const discountRow = document.getElementById('cart-discount-row');
    const discountEl = document.getElementById('cart-discount');

    const totalQty = this.cartItems.reduce((acc, it) => acc + it.quantity, 0);
    if (headerBadge) headerBadge.textContent = `${totalQty}`;
    if (mobBadge) mobBadge.textContent = `${totalQty}`;
    if (drawerCount) drawerCount.textContent = `${totalQty}`;

    if (!container) return;

    if (this.cartItems.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding: 4rem 1rem; color: var(--text-muted);">
          <p style="font-size: 1.15rem; font-family: var(--font-serif); margin-bottom: 0.5rem;">Your cart is empty</p>
          <p style="font-size: 0.88rem;">Select your favorite beans and roast profiles to get started!</p>
        </div>
      `;
      if (subtotalEl) subtotalEl.textContent = this.currentCurrency === 'INR' ? '₹0' : '$0.00';
      if (shippingEl) shippingEl.textContent = this.currentCurrency === 'INR' ? '₹0' : '$0.00';
      if (totalEl) totalEl.textContent = this.currentCurrency === 'INR' ? '₹0' : '$0.00';
      if (discountRow) discountRow.style.display = 'none';
      // An emptied cart drops any applied coupon too — otherwise a stale discount (possibly now
      // invalid/expired/below minimum) would silently reapply to whatever gets added next,
      // without ever being re-validated until checkout.
      this.discountPercentage = 0;
      this.appliedCouponCode = null;
      const couponStatusEl = document.getElementById('cart-coupon-status');
      const couponInputEl = document.getElementById('cart-coupon-input') as HTMLInputElement | null;
      if (couponStatusEl) couponStatusEl.textContent = '';
      if (couponInputEl) couponInputEl.value = '';
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
      const subBadgeHtml = item.subscription_frequency 
        ? `<div class="cart-club-badge">🔄 The Daily Club (${item.subscription_frequency.replace('_', ' ')}) · 10% Off</div>`
        : '';
      const notesHtml = item.custom_notes
        ? `<div class="cart-flight-detail">${item.custom_notes}</div>`
        : '';

      return `
        <div class="cart-item-card">
          <img src="${item.image_url}" alt="${item.name}" class="cart-item-img">
          <div class="cart-item-info">
            <div class="cart-item-name">${item.name}</div>
            <div class="cart-item-variant">${item.weight_grams >= 1000 ? `${item.weight_grams / 1000}kg` : `${item.weight_grams}g`} · ${item.grind_type.replace(/_/g, ' ')}</div>
            ${notesHtml}
            ${subBadgeHtml}
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

    if (subtotalEl) subtotalEl.textContent = this.formatPrice(subtotalInr, subtotalUsdCents);
    if (shippingEl) shippingEl.textContent = isFreeShipping ? 'FREE' : this.formatPrice(shippingInr, shippingUsdCents);
    if (totalEl) totalEl.textContent = this.formatPrice(finalInr, finalUsdCents);

    if (this.discountPercentage > 0 && discountRow && discountEl) {
      discountRow.style.display = 'flex';
      discountEl.textContent = `-${this.formatPrice(discountAmountInr, discountAmountUsdCents)}`;
    }

    // Attach quantity adjustments
    container.querySelectorAll('[data-action="inc"]').forEach((b) => {
      b.addEventListener('click', (e) => {
        this.triggerHaptic();
        const idx = parseInt((e.currentTarget as HTMLElement).getAttribute('data-index') || '0', 10);
        this.cartItems[idx].quantity += 1;
        this.saveCart();
        this.updateCartUI();
      });
    });

    container.querySelectorAll('[data-action="dec"]').forEach((b) => {
      b.addEventListener('click', (e) => {
        this.triggerHaptic();
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
        this.triggerHaptic();
        const idx = parseInt((e.currentTarget as HTMLElement).getAttribute('data-index') || '0', 10);
        this.cartItems.splice(idx, 1);
        this.saveCart();
        this.updateCartUI();
      });
    });
  }

  private setupEventListeners() {
    // Escape closes whatever's open — modals didn't have any keyboard dismissal at all.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const hadOpenBackdrop = document.querySelector('.storefront-modal-backdrop.active') !== null;
      document.querySelectorAll('.storefront-modal-backdrop.active').forEach((m) => {
        m.classList.remove('active');
        m.setAttribute('aria-hidden', 'true');
      });
      if (hadOpenBackdrop) this.releaseFocusTrap();
      if (document.getElementById('flavor-wheel-modal')?.getAttribute('aria-hidden') === 'false') {
        this.closeFlavorWheelModal();
      }
      if (document.getElementById('cart-drawer')?.classList.contains('open')) {
        this.closeCart();
      }
      if (document.getElementById('agent-drawer')?.classList.contains('open')) {
        this.closeAgent();
      }
    });

    // Trap Tab focus inside whichever modal/drawer is currently open, so keyboard users can't
    // tab out to the obscured page behind the overlay.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const openModal = document.querySelector<HTMLElement>(
        '.storefront-modal-backdrop.active, #flavor-wheel-modal[aria-hidden="false"]'
      );
      if (!openModal) return;
      const focusable = this.getFocusable(openModal);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // Currency Switcher
    document.getElementById('btn-currency-inr')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.setCurrency('INR');
    });
    document.getElementById('btn-currency-usd')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.setCurrency('USD');
    });

    // Open & Close Drawers / Bottom Sheets
    document.getElementById('btn-open-cart')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.openCart();
    });
    document.getElementById('btn-close-cart')?.addEventListener('click', () => this.closeCart());
    document.getElementById('cart-drawer-overlay')?.addEventListener('click', () => this.closeCart());

    document.getElementById('btn-open-agent')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.openAgent();
    });
    document.getElementById('btn-close-agent')?.addEventListener('click', () => this.closeAgent());
    document.getElementById('agent-drawer-overlay')?.addEventListener('click', () => this.closeAgent());

    // Mobile Bottom Navigation Bar Items
    const mobNavExplore = document.getElementById('mob-nav-explore');
    const mobNavRoasts = document.getElementById('mob-nav-roasts');
    const mobNavCalc = document.getElementById('mob-nav-calc');
    const mobNavAgent = document.getElementById('mob-nav-agent');
    const mobNavCart = document.getElementById('mob-nav-cart');

    const updateActiveMobNav = (activeId: string) => {
      document.querySelectorAll('.mobile-nav-item').forEach((item) => item.classList.remove('active'));
      document.getElementById(activeId)?.classList.add('active');
    };

    mobNavExplore?.addEventListener('click', (e) => {
      e.preventDefault();
      this.triggerHaptic();
      updateActiveMobNav('mob-nav-explore');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    mobNavRoasts?.addEventListener('click', (e) => {
      e.preventDefault();
      this.triggerHaptic();
      updateActiveMobNav('mob-nav-roasts');
      document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
    });

    mobNavCalc?.addEventListener('click', (e) => {
      e.preventDefault();
      this.triggerHaptic();
      updateActiveMobNav('mob-nav-calc');
      document.getElementById('brew-guide')?.scrollIntoView({ behavior: 'smooth' });
    });

    mobNavAgent?.addEventListener('click', () => {
      this.triggerHaptic();
      updateActiveMobNav('mob-nav-agent');
      this.openAgent();
    });

    mobNavCart?.addEventListener('click', () => {
      this.triggerHaptic();
      updateActiveMobNav('mob-nav-cart');
      this.openCart();
    });

    // Touch Drag-to-Dismiss on Bottom Sheets (Mobile Gesture)
    this.setupSheetDragDismiss('cart-drawer', 'cart-drag-handle', () => this.closeCart());
    this.setupSheetDragDismiss('agent-drawer', 'agent-drag-handle', () => this.closeAgent());

    // Product Search
    const searchInput = document.getElementById('catalog-search-input') as HTMLInputElement | null;
    let searchDebounce: ReturnType<typeof setTimeout> | null = null;
    searchInput?.addEventListener('input', (e) => {
      const value = (e.target as HTMLInputElement).value;
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        this.searchQuery = value;
        this.renderProducts();
      }, 200);
    });

    // Category Tabs
    document.querySelectorAll('#category-tabs-container .category-tab').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        this.triggerHaptic();
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

    // Promo Code Apply — validated against real coupons in D1; checkout.ts re-validates again
    // at charge time, this is purely for cart-preview display.
    document.getElementById('btn-apply-coupon')?.addEventListener('click', async () => {
      this.triggerHaptic();
      const input = document.getElementById('cart-coupon-input') as HTMLInputElement;
      const statusEl = document.getElementById('cart-coupon-status');
      const code = input?.value.trim();
      if (!code) return;

      const subtotalUsdCents = this.cartItems.reduce((acc, it) => acc + (it.unit_price_usd_cents * it.quantity), 0);
      if (statusEl) {
        statusEl.textContent = 'Checking code...';
        statusEl.style.color = 'var(--text-muted)';
      }

      try {
        const res = await fetch(`${API_BASE}/api/cart/coupon/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, subtotal_cents: subtotalUsdCents })
        });
        const data = await res.json() as { success: boolean; discount_cents?: number; code?: string; error?: string };
        if (data.success && data.discount_cents != null && subtotalUsdCents > 0) {
          this.discountPercentage = data.discount_cents / subtotalUsdCents;
          this.appliedCouponCode = data.code || code.toUpperCase();
          if (statusEl) {
            statusEl.textContent = `✓ ${this.appliedCouponCode} applied!`;
            statusEl.style.color = 'var(--accent-emerald)';
          }
        } else {
          this.discountPercentage = 0;
          this.appliedCouponCode = null;
          if (statusEl) {
            statusEl.textContent = data.error || 'Invalid coupon code';
            statusEl.style.color = 'var(--accent-terracotta)';
          }
        }
      } catch {
        if (statusEl) {
          statusEl.textContent = 'Could not validate code — please try again.';
          statusEl.style.color = 'var(--accent-terracotta)';
        }
      }
      this.updateCartUI();
    });

    // Checkout Trigger
    document.getElementById('btn-checkout-trigger')?.addEventListener('click', async () => {
      if (this.cartItems.length === 0) {
        alert('Your cart is empty! Please add some delicious coffee first.');
        return;
      }

      const checkoutBtn = document.getElementById('btn-checkout-trigger') as HTMLButtonElement;
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = 'Securing Your Bangalore Roast...';
      this.trackEvent('checkout_started', { metadata: { item_count: this.cartItems.length } });

      try {
        const res = await fetch(`${API_BASE}/api/checkout/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Session-Token': this.sessionId },
          body: JSON.stringify({
            customer_email: 'customer@dailygrind.coffee',
            cart_id: this.sessionId,
            currency: this.currentCurrency.toLowerCase(),
            coupon_code: this.appliedCouponCode || undefined,
            items: this.cartItems.map((i) => ({
              variant_id: i.variant_id,
              quantity: i.quantity,
              grind_type: i.grind_type,
              unit_price_cents: this.currentCurrency === 'INR' ? Math.round(i.unit_price_inr * 100) : i.unit_price_usd_cents,
              product_name: i.name,
              subscription_frequency: i.subscription_frequency || null,
              custom_notes: i.custom_notes || null
            }))
          })
        });

        const data = await res.json() as { success?: boolean; checkout_url?: string; order_number?: string; error?: string };
        if (data.checkout_url) {
          window.location.href = data.checkout_url;
        } else if (data.success && data.order_number) {
          // Order was created in D1 but Stripe isn't configured on this deploy — no payment
          // redirect to send the shopper through, so surface the real order number directly.
          window.location.href = `${window.location.pathname}?order_number=${encodeURIComponent(data.order_number)}`;
        } else {
          alert(`Checkout failed: ${data.error || 'Please try again.'}`);
        }
      } catch {
        alert('Checkout failed — please check your connection and try again. Your cart has not been cleared.');
      } finally {
        checkoutBtn.disabled = false;
        checkoutBtn.textContent = 'Proceed to Secure Checkout';
      }
    });

    // AI Barista Chat Form & Quick Suggestion Chips
    const agentForm = document.getElementById('agent-chat-form') as HTMLFormElement;
    agentForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('agent-chat-input') as HTMLInputElement;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      this.sendAgentMessage(text);
    });

    document.querySelectorAll('#agent-suggestion-chips .chat-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const prompt = (chip as HTMLElement).getAttribute('data-prompt');
        if (prompt) {
          this.sendAgentMessage(prompt);
        }
      });
    });

    // Order Lookup Form — looks up the real order via GET /api/orders/:identifier
    const orderForm = document.getElementById('order-lookup-form');
    orderForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.triggerHaptic();
      const input = document.getElementById('order-lookup-input') as HTMLInputElement;
      const orderNum = input.value.trim().toUpperCase();
      await this.lookupOrder(orderNum);
    });

    // Customer Invoice Modal Close & Print
    const modalCustInvoice = document.getElementById('modal-customer-invoice');
    document.getElementById('modal-cust-invoice-close')?.addEventListener('click', () => {
      modalCustInvoice?.classList.remove('active');
      modalCustInvoice?.setAttribute('aria-hidden', 'true');
      this.releaseFocusTrap();
    });
    document.getElementById('modal-cust-invoice-cancel')?.addEventListener('click', () => {
      modalCustInvoice?.classList.remove('active');
      modalCustInvoice?.setAttribute('aria-hidden', 'true');
      this.releaseFocusTrap();
    });
    document.getElementById('modal-cust-invoice-print')?.addEventListener('click', () => {
      this.triggerHaptic();
      window.print();
    });

    // Reviews Modal
    const modalReviews = document.getElementById('modal-reviews');
    document.getElementById('modal-reviews-close')?.addEventListener('click', () => {
      modalReviews?.classList.remove('active');
      modalReviews?.setAttribute('aria-hidden', 'true');
      this.releaseFocusTrap();
    });

    // Star picker
    document.querySelectorAll('.review-star-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.triggerHaptic();
        const target = e.currentTarget as HTMLElement;
        const star = parseInt(target.getAttribute('data-star') || '5', 10);
        const ratingInput = document.getElementById('review-rating-input') as HTMLInputElement;
        if (ratingInput) ratingInput.value = String(star);
        document.querySelectorAll('.review-star-btn').forEach((b) => {
          const s = parseInt(b.getAttribute('data-star') || '0', 10);
          b.classList.toggle('filled', s <= star);
        });
      });
    });

    // Review submission
    const reviewForm = document.getElementById('review-submit-form') as HTMLFormElement;
    reviewForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.triggerHaptic();
      const productId = (document.getElementById('review-form-product-id') as HTMLInputElement)?.value;
      const rating = parseInt((document.getElementById('review-rating-input') as HTMLInputElement)?.value || '5', 10);
      const customerName = (document.getElementById('review-name-input') as HTMLInputElement)?.value.trim();
      const orderNumber = (document.getElementById('review-order-input') as HTMLInputElement)?.value.trim();
      const comment = (document.getElementById('review-comment-input') as HTMLTextAreaElement)?.value.trim();
      const statusEl = document.getElementById('review-submit-status');

      if (!productId || !customerName || !comment) return;

      if (statusEl) {
        statusEl.textContent = 'Submitting...';
        statusEl.style.color = 'var(--text-muted)';
      }

      try {
        const res = await fetch(`${API_BASE}/api/reviews`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: productId, customer_name: customerName, rating, comment, order_number: orderNumber || undefined })
        });
        const data = await res.json() as { success: boolean; error?: string };
        if (data.success) {
          if (statusEl) {
            statusEl.textContent = 'Thank you for your review!';
            statusEl.style.color = 'var(--accent-emerald)';
          }
          reviewForm.reset();
          document.querySelectorAll('.review-star-btn').forEach((b) => b.classList.remove('filled'));
          const prodName = document.getElementById('modal-reviews-title')?.getAttribute('data-prod-name') || 'this coffee';
          await this.openReviewsModal(productId, prodName);
          this.loadCatalog();
        } else {
          if (statusEl) {
            statusEl.textContent = data.error || 'Could not submit review — please try again.';
            statusEl.style.color = 'var(--accent-terracotta)';
          }
        }
      } catch {
        if (statusEl) {
          statusEl.textContent = 'Network error — please try again.';
          statusEl.style.color = 'var(--accent-terracotta)';
        }
      }
    });
  }

  async openReviewsModal(productId: string, productName: string) {
    const modal = document.getElementById('modal-reviews');
    const titleEl = document.getElementById('modal-reviews-title');
    const listEl = document.getElementById('modal-reviews-list');
    const productIdInput = document.getElementById('review-form-product-id') as HTMLInputElement;
    const statusEl = document.getElementById('review-submit-status');
    if (!modal || !listEl) return;

    if (titleEl) {
      titleEl.textContent = `Reviews — ${productName}`;
      titleEl.setAttribute('data-prod-name', productName);
    }
    if (productIdInput) productIdInput.value = productId;
    if (statusEl) statusEl.textContent = '';
    listEl.innerHTML = `<p style="color: var(--text-muted); text-align:center; padding: 1rem;">Loading reviews...</p>`;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    this.trapFocusIn(modal);

    try {
      const res = await fetch(`${API_BASE}/api/reviews/${encodeURIComponent(productId)}`);
      const data = await res.json() as { success: boolean; reviews: any[]; avg_rating: number | null; review_count: number };
      if (!data.success || data.reviews.length === 0) {
        listEl.innerHTML = `<p style="color: var(--text-muted); text-align:center; padding: 1rem;">No reviews yet — be the first to share your thoughts!</p>`;
        return;
      }
      listEl.innerHTML = data.reviews.map((r) => {
        const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
        const date = new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        return `
          <div class="review-card">
            <div class="review-card-stars">${stars}</div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin: 0.3rem 0;">
              <strong style="font-size: 0.92rem;">${this.escapeHtml(r.customer_name)}</strong>
              ${r.is_verified_purchase ? '<span style="font-size: 0.72rem; color: var(--accent-emerald); font-weight: 700;">✓ Verified Purchase</span>' : ''}
            </div>
            <p style="font-size: 0.88rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 0.3rem;">${this.escapeHtml(r.comment)}</p>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${date}</span>
          </div>
        `;
      }).join('');
    } catch {
      listEl.innerHTML = `<p style="color: var(--text-muted); text-align:center; padding: 1rem;">Couldn't load reviews right now.</p>`;
    }
  }

  private setupNewsletterForm() {
    const form = document.getElementById('newsletter-form') as HTMLFormElement | null;
    const statusEl = document.getElementById('newsletter-status');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.triggerHaptic();
      const emailInput = document.getElementById('newsletter-email') as HTMLInputElement;
      const email = emailInput.value.trim();
      if (!email) return;

      const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
      submitBtn.disabled = true;
      if (statusEl) { statusEl.textContent = 'Subscribing...'; statusEl.style.color = 'var(--text-inverse)'; }

      try {
        const res = await fetch(`${API_BASE}/api/customer/newsletter/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json() as { success: boolean; error?: string };
        if (data.success) {
          if (statusEl) { statusEl.textContent = "✓ You're on the list — welcome!"; statusEl.style.color = 'var(--accent-gold)'; }
          form.reset();
        } else if (statusEl) {
          statusEl.textContent = data.error || 'Could not subscribe — please try again.';
          statusEl.style.color = 'var(--accent-terracotta)';
        }
      } catch {
        if (statusEl) {
          statusEl.textContent = 'Could not subscribe — please check your connection.';
          statusEl.style.color = 'var(--accent-terracotta)';
        }
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  private setupAccountModal() {
    const modal = document.getElementById('modal-account');
    const requestForm = document.getElementById('account-login-request-form') as HTMLFormElement;
    const verifyForm = document.getElementById('account-login-verify-form') as HTMLFormElement;
    const loggedInView = document.getElementById('account-logged-in-view');

    document.getElementById('btn-open-account')?.addEventListener('click', () => {
      this.triggerHaptic();
      modal?.classList.add('active');
      modal?.setAttribute('aria-hidden', 'false');
      this.renderAccountModalState();
      if (modal) this.trapFocusIn(modal);
    });
    document.getElementById('modal-account-close')?.addEventListener('click', () => {
      modal?.classList.remove('active');
      modal?.setAttribute('aria-hidden', 'true');
      this.releaseFocusTrap();
    });

    requestForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.triggerHaptic();
      const emailInput = document.getElementById('account-login-email') as HTMLInputElement;
      const statusEl = document.getElementById('account-login-request-status');
      const email = emailInput.value.trim();
      if (!email) return;

      if (statusEl) { statusEl.textContent = 'Sending code...'; statusEl.style.color = 'var(--text-muted)'; }
      try {
        const res = await fetch(`${API_BASE}/api/customer/login/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json() as { success: boolean; error?: string };
        if (data.success) {
          requestForm.style.display = 'none';
          verifyForm.style.display = 'block';
          (verifyForm as any).dataset.pendingEmail = email;
          if (statusEl) statusEl.textContent = '';
        } else if (statusEl) {
          statusEl.textContent = data.error || 'Could not send code — please try again.';
          statusEl.style.color = 'var(--accent-terracotta)';
        }
      } catch {
        if (statusEl) { statusEl.textContent = 'Network error — please try again.'; statusEl.style.color = 'var(--accent-terracotta)'; }
      }
    });

    verifyForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.triggerHaptic();
      const codeInput = document.getElementById('account-login-code') as HTMLInputElement;
      const statusEl = document.getElementById('account-login-verify-status');
      const email = (verifyForm as any).dataset.pendingEmail;
      const code = codeInput.value.trim();
      if (!email || !code) return;

      if (statusEl) { statusEl.textContent = 'Verifying...'; statusEl.style.color = 'var(--text-muted)'; }
      try {
        const res = await fetch(`${API_BASE}/api/customer/login/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code }),
        });
        const data = await res.json() as { success: boolean; session_token?: string; email?: string; error?: string };
        if (data.success && data.session_token) {
          const sessionToken = data.session_token;
          const resolvedEmail = data.email || email;
          this.customerSessionToken = sessionToken;
          this.customerEmail = resolvedEmail;
          localStorage.setItem('tdg_customer_session', sessionToken);
          localStorage.setItem('tdg_customer_email', resolvedEmail);
          codeInput.value = '';
          this.renderAccountModalState();
        } else if (statusEl) {
          statusEl.textContent = data.error || 'Invalid or expired code';
          statusEl.style.color = 'var(--accent-terracotta)';
        }
      } catch {
        if (statusEl) { statusEl.textContent = 'Network error — please try again.'; statusEl.style.color = 'var(--accent-terracotta)'; }
      }
    });

    loggedInView?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.id === 'btn-account-logout') {
        this.triggerHaptic();
        fetch(`${API_BASE}/api/customer/logout`, {
          method: 'POST',
          headers: { 'X-Customer-Session': this.customerSessionToken || '' },
        }).catch(() => {});
        this.customerSessionToken = null;
        this.customerEmail = null;
        localStorage.removeItem('tdg_customer_session');
        localStorage.removeItem('tdg_customer_email');
        this.renderAccountModalState();
      }
    });
  }

  private async renderAccountModalState() {
    const requestForm = document.getElementById('account-login-request-form') as HTMLFormElement;
    const verifyForm = document.getElementById('account-login-verify-form') as HTMLFormElement;
    const loggedInView = document.getElementById('account-logged-in-view');
    const summaryEl = document.getElementById('account-summary');
    if (!requestForm || !verifyForm || !loggedInView || !summaryEl) return;

    if (!this.customerSessionToken) {
      requestForm.style.display = 'block';
      requestForm.reset();
      verifyForm.style.display = 'none';
      loggedInView.style.display = 'none';
      return;
    }

    requestForm.style.display = 'none';
    verifyForm.style.display = 'none';
    loggedInView.style.display = 'block';
    summaryEl.innerHTML = `<p style="text-align:center; color: var(--text-muted); padding: 1rem;">Loading your account...</p>`;

    try {
      const res = await fetch(`${API_BASE}/api/customer/me`, {
        headers: { 'X-Customer-Session': this.customerSessionToken },
      });
      if (res.status === 401) {
        // Session expired/invalid server-side — clear it and fall back to login
        this.customerSessionToken = null;
        this.customerEmail = null;
        localStorage.removeItem('tdg_customer_session');
        localStorage.removeItem('tdg_customer_email');
        this.renderAccountModalState();
        return;
      }
      const data = await res.json() as { success: boolean; customer?: any };
      if (!data.success || !data.customer) {
        summaryEl.innerHTML = `<p style="text-align:center; color: var(--accent-terracotta); padding: 1rem;">Couldn't load your account right now.</p>`;
        return;
      }

      const c = data.customer;
      const ordersHtml = (c.recent_orders || []).length > 0
        ? c.recent_orders.map((o: any) => {
            const { label, statusClass } = this.orderStatusDisplay(o.status);
            const totalDisplay = `$${(o.total_cents / 100).toFixed(2)}`;
            return `
              <div style="display:flex; justify-content:space-between; align-items:center; padding: 0.6rem 0; border-bottom: 1px solid var(--border-subtle);">
                <div>
                  <strong style="font-size: 0.88rem;">${this.escapeHtml(o.order_number)}</strong>
                  <div style="font-size: 0.78rem; color: var(--text-muted);">${new Date(o.created_at).toLocaleDateString()}</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-size: 0.85rem; font-weight: 700;">${totalDisplay}</div>
                  <span style="font-size: 0.7rem; color: var(--accent-emerald); font-weight: 700;">${label}</span>
                </div>
              </div>
            `;
          }).join('')
        : `<p style="font-size: 0.85rem; color: var(--text-muted);">No orders yet.</p>`;

      const addressesHtml = (c.addresses || []).length > 0
        ? c.addresses.map((a: any) => `
            <div style="padding: 0.6rem 0; border-bottom: 1px solid var(--border-subtle); font-size: 0.85rem; color: var(--text-muted);">
              ${this.escapeHtml(a.name)} — ${this.escapeHtml(a.line1)}, ${this.escapeHtml(a.city)}, ${this.escapeHtml(a.state)} ${this.escapeHtml(a.postal_code)}
            </div>
          `).join('')
        : `<p style="font-size: 0.85rem; color: var(--text-muted);">No saved addresses yet.</p>`;

      summaryEl.innerHTML = `
        <div style="text-align:center; margin-bottom: 1.2rem;">
          <strong style="font-size: 1rem;">${this.escapeHtml(c.email)}</strong>
          <div style="font-size: 0.82rem; color: var(--accent-gold); font-weight: 700; margin-top: 0.3rem;">✨ ${c.loyalty_points} Loyalty Points</div>
        </div>
        <h4 style="font-size: 0.9rem; margin-bottom: 0.4rem;">Recent Orders</h4>
        <div style="margin-bottom: 1.2rem;">${ordersHtml}</div>
        <h4 style="font-size: 0.9rem; margin-bottom: 0.4rem;">Saved Addresses</h4>
        <div style="margin-bottom: 1.2rem;">${addressesHtml}</div>
        <button type="button" id="btn-account-logout" class="btn-secondary" style="width:100%; padding: 0.6rem;">Log Out</button>
      `;
    } catch {
      summaryEl.innerHTML = `<p style="text-align:center; color: var(--accent-terracotta); padding: 1rem;">Couldn't load your account right now.</p>`;
    }
  }

  private orderStatusDisplay(status: string): { label: string; statusClass: string; desc: string } {
    switch (status) {
      case 'PENDING_PAYMENT':
        return { label: 'AWAITING PAYMENT', statusClass: 'accent-terracotta', desc: 'We\'re still waiting on payment confirmation for this order.' };
      case 'PAID':
        return { label: 'PAID & QUEUED', statusClass: 'accent-gold', desc: 'Payment confirmed — queued for the next roasting batch at our Indiranagar roastery.' };
      case 'ROASTING':
        return { label: 'ROASTING IN PROGRESS', statusClass: 'accent-emerald', desc: 'Your batch is currently in the convection roast cycle. It will degas before packaging.' };
      case 'PACKED':
        return { label: 'PACKED', statusClass: 'accent-emerald', desc: 'Freshly roasted, degassed, and nitrogen-sealed. Ready to hand off to courier.' };
      case 'SHIPPED':
        return { label: 'DISPATCHED · IN TRANSIT', statusClass: 'accent-terracotta', desc: 'Dispatched via courier and on its way to you.' };
      case 'DELIVERED':
        return { label: 'DELIVERED', statusClass: 'accent-emerald', desc: 'Delivered! We hope you enjoy every cup.' };
      case 'CANCELLED':
        return { label: 'CANCELLED', statusClass: 'accent-terracotta', desc: 'This order was cancelled.' };
      case 'REFUNDED':
        return { label: 'REFUNDED', statusClass: 'accent-terracotta', desc: 'This order was refunded.' };
      default:
        return { label: status, statusClass: 'accent-emerald', desc: '' };
    }
  }

  async lookupOrder(orderNum: string) {
    const resultBox = document.getElementById('order-lookup-result');
    if (!resultBox || !orderNum) return;

    resultBox.style.display = 'block';
    resultBox.innerHTML = `<p style="text-align:center; color: var(--text-muted); padding: 1rem;">Looking up order ${orderNum}...</p>`;

    let order: Order | null = null;
    try {
      const res = await fetch(`${API_BASE}/api/orders/${encodeURIComponent(orderNum)}`);
      const data = await res.json() as { success: boolean; order?: Order };
      if (data.success && data.order) {
        order = data.order;
      }
    } catch {
      // network error — order stays null, handled below
    }

    if (!order) {
      resultBox.innerHTML = `
        <div style="background: var(--bg-primary); padding: 1.6rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); text-align: center;">
          <strong style="color: var(--text-main);">No order found for "${orderNum}"</strong>
          <p style="font-size:0.88rem; color: var(--text-muted); margin-top: 0.5rem;">Double-check your order number — it should look like TDG-XXXXXX.</p>
        </div>
      `;
      return;
    }

    const { label, statusClass, desc } = this.orderStatusDisplay(order.status);
    const itemSummary = this.escapeHtml(order.items.length === 1
      ? `${order.items[0].product_name} (${order.items[0].weight_grams}g · ${order.items[0].grind_type})`
      : `${order.items[0]?.product_name || 'Coffee'} + ${order.items.length - 1} more item${order.items.length > 2 ? 's' : ''}`);
    const totalDisplay = order.currency === 'usd'
      ? `$${(order.total_cents / 100).toFixed(2)}`
      : `₹${Math.round(order.total_cents / 100)}`;
    // shipping_address fields are shopper-entered at checkout and this page is public (anyone
    // with the order number can look it up) — escape before rendering to close a stored-XSS path.
    const customerName = this.escapeHtml(order.shipping_address?.name || order.customer_email);
    const customerLoc = order.shipping_address ? this.escapeHtml(`${order.shipping_address.city}, ${order.shipping_address.state}`) : '';

    resultBox.innerHTML = `
      <div style="background: var(--bg-primary); padding: 1.6rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); box-shadow: var(--shadow-sm);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 0.8rem; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <strong style="font-size: 1.1rem; color: var(--text-main);">Order: ${order.order_number}</strong>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.1rem;">Customer: ${customerName}${customerLoc ? ` (${customerLoc})` : ''}</div>
          </div>
          <span style="background: var(--accent-sage); color: var(--accent-emerald); padding: 0.3rem 0.8rem; border-radius: var(--radius-pill); font-size: 0.78rem; font-weight:700; letter-spacing: 0.04em;">${label}</span>
        </div>

        <div style="margin: 0.8rem 0; padding: 0.8rem 1rem; background: #fff; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
          <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-main);">${itemSummary}</div>
          <div style="font-size: 0.8rem; color: var(--accent-terracotta); font-weight: 700; margin-top: 0.2rem;">Total: ${totalDisplay}${order.tracking_number ? ` · Tracking: ${order.tracking_number}` : ''}</div>
        </div>

        <p style="font-size:0.88rem; color: var(--text-muted); line-height:1.5; margin-bottom: 1.2rem;">
          ${desc}
        </p>

        <div style="display: flex; gap: 0.8rem; flex-wrap: wrap;">
          ${order.currency !== 'usd' ? `
          <button class="btn-primary" id="btn-view-order-gst-invoice" style="padding: 0.7rem 1.4rem; font-size: 0.88rem; display: inline-flex; align-items: center; gap: 0.5rem;">
            🧾 View & Print GST Tax Invoice (HSN 0901)
          </button>` : ''}
          <a href="#brew-guide" class="btn-secondary" style="padding: 0.7rem 1.2rem; font-size: 0.88rem; text-decoration: none; display: inline-flex; align-items: center; gap: 0.4rem; border-radius: var(--radius-pill);">
            ☕ Maya's Brew Guide
          </a>
        </div>
      </div>
    `;

    document.getElementById('btn-view-order-gst-invoice')?.addEventListener('click', () => {
      this.triggerHaptic();
      const invoiceData = buildGSTInvoiceFromOrder({
        orderId: order!.order_number,
        customerName,
        customerLocation: customerLoc,
        customerEmail: order!.customer_email,
        productDescription: itemSummary,
        totalAmountInr: Math.round(order!.total_cents / 100)
      });

      const invoiceContentEl = document.getElementById('modal-cust-invoice-content');
      const modalCustInvoice = document.getElementById('modal-customer-invoice');

      if (invoiceContentEl) {
        invoiceContentEl.innerHTML = renderGSTInvoiceHTML(invoiceData);
      }
      if (modalCustInvoice) {
        modalCustInvoice.classList.add('active');
        modalCustInvoice.setAttribute('aria-hidden', 'false');
        this.trapFocusIn(modalCustInvoice);
      }
    });
  }

  // After a successful Stripe redirect back, checkout.ts sends ?order_id=...&order_number=...
  // — surface the real order instead of leaving the shopper on a blank homepage.
  private handleOrderConfirmationDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const orderNumber = params.get('order_number');
    if (!orderNumber) return;

    // Guard against double-counting the same order if the confirmation URL is refreshed/revisited.
    const purchaseTrackedKey = `tdg_purchase_tracked_${orderNumber}`;
    if (!sessionStorage.getItem(purchaseTrackedKey)) {
      sessionStorage.setItem(purchaseTrackedKey, '1');
      this.trackEvent('purchase', { metadata: { order_number: orderNumber } });
    }

    this.cartItems = [];
    this.discountPercentage = 0;
    this.appliedCouponCode = null;
    this.saveCart();
    this.updateCartUI();

    setTimeout(() => {
      document.getElementById('track-order')?.scrollIntoView({ behavior: 'smooth' });
      const input = document.getElementById('order-lookup-input') as HTMLInputElement | null;
      if (input) input.value = orderNumber;
      this.lookupOrder(orderNumber);
    }, 400);
  }

  // Resumes an abandoned-cart recovery email's "Complete Your Order" link — the original order
  // was already cancelled (and its stock reservation released) by the abandoned-checkout cron,
  // so this just repopulates the local cart from the order's items; the normal checkout button
  // flow then creates a fresh order with a real-time stock/price check.
  private async handleResumeOrderDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const orderNumber = params.get('resume_order');
    if (!orderNumber) return;

    try {
      const res = await fetch(`${API_BASE}/api/orders/${encodeURIComponent(orderNumber)}`);
      const data = await res.json() as { success: boolean; order?: Order };
      if (!data.success || !data.order || data.order.items.length === 0) return;

      this.cartItems = data.order.items.map((it) => ({
        id: 'resumed_' + it.id,
        variant_id: it.variant_id,
        product_id: it.variant_id,
        name: it.product_name,
        weight_grams: it.weight_grams,
        grind_type: it.grind_type,
        unit_price_inr: Math.round(it.unit_price_cents * 0.23),
        unit_price_usd_cents: it.unit_price_cents,
        discount_percent: 0,
        quantity: it.quantity,
        image_url: '/images/roaster.jpg',
        subscription_frequency: it.subscription_frequency || null,
        custom_notes: it.custom_notes || null,
      }));
      this.saveCart();
      this.updateCartUI();

      setTimeout(() => {
        this.openCart();
      }, 400);
    } catch {
      // Resume failed silently — shopper can still shop normally, nothing to recover from here
    }
  }

  // Opens the reviews modal for a specific product when a shopper clicks a review-request
  // email's "Rate this coffee" link.
  private async handleReviewProductDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('review_product');
    if (!productId) return;

    try {
      const res = await fetch(`${API_BASE}/api/products/${encodeURIComponent(productId)}`);
      const data = await res.json() as { success: boolean; product?: { name: string } };
      const productName = data.success && data.product ? data.product.name : 'this coffee';
      setTimeout(() => {
        this.openReviewsModal(productId, productName);
      }, 400);
    } catch {
      // No product found for this id — nothing to open
    }
  }

  async sendAgentMessage(text: string) {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();
    this.triggerHaptic();

    // 1. Append user message to UI
    this.appendMessage('user', cleanText);

    // 2. Add to chat history (multi-turn memory)
    this.chatHistory.push({ role: 'user', content: cleanText });
    if (this.chatHistory.length > 12) {
      this.chatHistory = this.chatHistory.slice(-12);
    }

    // 3. Show loading bubble
    const loadingBubble = this.appendMessage('agent', 'Consulting our Indiranagar cupping table...');

    try {
      const res = await fetch(`${API_BASE}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': this.sessionId },
        body: JSON.stringify({ messages: this.chatHistory })
      });

      if (res.ok) {
        const data = await res.json() as {
          success: boolean;
          reply: string;
          proposed_actions?: any[];
          action_card?: any;
        };

        const replyContent = data.reply || "I'd love to help you find your next favourite roast or dial in your brew!";
        this.chatHistory.push({ role: 'assistant', content: replyContent });
        if (this.chatHistory.length > 12) {
          this.chatHistory = this.chatHistory.slice(-12);
        }

        // Render formatted markdown inside bubble
        loadingBubble.innerHTML = this.renderMarkdown(replyContent);

        // Render interactive action cards if present
        this.renderAgentActionCards(loadingBubble, data, cleanText, replyContent);
      } else {
        const fallbackReply = "I highly recommend our **Chikmagalur Attikan Estate Honey** for sweet sugarcane jaggery and red apple notes, or our **Dawn Patrol Bangalore Blend** for morning comfort!";
        this.chatHistory.push({ role: 'assistant', content: fallbackReply });
        loadingBubble.innerHTML = this.renderMarkdown(fallbackReply);
        this.renderAgentActionCards(loadingBubble, { success: true, reply: fallbackReply }, cleanText, fallbackReply);
      }
    } catch {
      const fallbackReply = "For traditional filter kaapi or pour over, try our **Chikmagalur Attikan Estate Honey**. For a rich dark espresso with thick golden crema, **Midnight Runner** is phenomenal!";
      this.chatHistory.push({ role: 'assistant', content: fallbackReply });
      loadingBubble.innerHTML = this.renderMarkdown(fallbackReply);
      this.renderAgentActionCards(loadingBubble, { success: true, reply: fallbackReply }, cleanText, fallbackReply);
    }
  }

  private renderAgentActionCards(bubble: HTMLElement, data: any, userQuery: string, replyText: string) {
    const lowerQuery = userQuery.toLowerCase();
    const lowerReply = replyText.toLowerCase();

    // Map known products for 1-click cart action cards
    const knownProducts: Record<string, { id: string; variantId: string; name: string; weight: number; inr: number; usd: number; grind: string; img: string }> = {
      attikan: { id: 'prod_chik_attikan', variantId: 'var_att_250', name: 'Chikmagalur Attikan Estate Honey', weight: 250, inr: 450, usd: 1850, grind: 'SOUTH_INDIAN_FILTER', img: '/images/pour_over.jpg' },
      chikmagalur: { id: 'prod_chik_attikan', variantId: 'var_att_250', name: 'Chikmagalur Attikan Estate Honey', weight: 250, inr: 450, usd: 1850, grind: 'SOUTH_INDIAN_FILTER', img: '/images/pour_over.jpg' },
      araku: { id: 'prod_araku_honey', variantId: 'var_ara_250', name: 'Araku Valley Red Honey Micro-Lot', weight: 250, inr: 490, usd: 1950, grind: 'POUR_OVER', img: '/images/bag_ethiopia.jpg' },
      yirgacheffe: { id: 'prod_eth_yirg', variantId: 'var_eth_250', name: 'Ethiopia Yirgacheffe Gedeb', weight: 250, inr: 580, usd: 2200, grind: 'POUR_OVER', img: '/images/bag_ethiopia.jpg' },
      ethiopia: { id: 'prod_eth_yirg', variantId: 'var_eth_250', name: 'Ethiopia Yirgacheffe Gedeb', weight: 250, inr: 580, usd: 2200, grind: 'POUR_OVER', img: '/images/bag_ethiopia.jpg' },
      flight: { id: 'prod_taster_flight', variantId: 'var_flight_300', name: 'Curated 3x 100g Roastery Taster Flight', weight: 300, inr: 590, usd: 2400, grind: 'WHOLE_BEAN', img: '/images/pour_over.jpg' },
      dawn: { id: 'prod_dawn_blend', variantId: 'var_dawn_250', name: 'Dawn Patrol Bangalore Roastery Blend', weight: 250, inr: 420, usd: 1650, grind: 'WHOLE_BEAN', img: '/images/roaster.jpg' },
      midnight: { id: 'prod_mid_runner', variantId: 'var_mid_250', name: 'Midnight Runner Dark Espresso', weight: 250, inr: 440, usd: 1750, grind: 'ESPRESSO', img: '/images/espresso.jpg' },
      monsoon: { id: 'prod_monsoon_malabar', variantId: 'var_mon_250', name: 'Monsoon Malabar AA Special Reserve', weight: 250, inr: 470, usd: 1900, grind: 'SOUTH_INDIAN_FILTER', img: '/images/roaster.jpg' },
      colombia: { id: 'prod_col_geisha', variantId: 'var_col_250', name: 'Colombia Huila Pink Bourbon', weight: 250, inr: 590, usd: 2300, grind: 'POUR_OVER', img: '/images/bag_ethiopia.jpg' },
      glacier: { id: 'prod_glacier_cb', variantId: 'var_gcb_500', name: 'Glacier Steep Cold Brew Blend', weight: 500, inr: 850, usd: 3400, grind: 'COLD_BREW_COARSE', img: '/images/bag_ethiopia.jpg' },
    };

    // 1. Proposed actions from tool calls or explicit action card
    let actionItem: any = null;

    if (data.proposed_actions && data.proposed_actions.length > 0) {
      const act = data.proposed_actions[0];
      if (act.tool_name === 'add_to_cart' && act.arguments) {
        const pName = act.arguments.product_name || 'Specialty Coffee Selection';
        const vId = act.arguments.variant_id || 'var_att_250';
        const gType = act.arguments.grind_type || 'WHOLE_BEAN';
        const pKey = Object.keys(knownProducts).find((k) => pName.toLowerCase().includes(k)) || 'attikan';
        const matched = knownProducts[pKey];
        actionItem = {
          product_id: matched ? matched.id : 'prod_chik_attikan',
          variant_id: vId,
          name: pName,
          weight_grams: matched ? matched.weight : 250,
          grind_type: gType,
          unit_price_inr: matched ? matched.inr : 450,
          unit_price_usd_cents: matched ? matched.usd : 1850,
          image_url: matched ? matched.img : '/images/pour_over.jpg'
        };
      }
    } else if (data.action_card && data.action_card.type === 'ADD_TO_CART') {
      actionItem = {
        product_id: data.action_card.product_id || 'prod_chik_attikan',
        variant_id: data.action_card.variant_id || 'var_att_250',
        name: data.action_card.product_name,
        weight_grams: data.action_card.weight_grams || 250,
        grind_type: data.action_card.grind_type || 'WHOLE_BEAN',
        unit_price_inr: data.action_card.price_inr || 450,
        unit_price_usd_cents: data.action_card.price_usd_cents || 1850,
        image_url: data.action_card.image_url || '/images/pour_over.jpg'
      };
    } else {
      // Check if user query or assistant reply strongly references one of our coffees
      for (const [key, item] of Object.entries(knownProducts)) {
        if (lowerReply.includes(key) || lowerQuery.includes(key)) {
          actionItem = {
            product_id: item.id,
            variant_id: item.variantId,
            name: item.name,
            weight_grams: item.weight,
            grind_type: item.grind,
            unit_price_inr: item.inr,
            unit_price_usd_cents: item.usd,
            image_url: item.img
          };
          break;
        }
      }
    }

    // Render Action Card Box
    const cardBox = document.createElement('div');
    cardBox.className = 'chat-action-card';

    if (actionItem) {
      const priceFormatted = this.formatPrice(actionItem.unit_price_inr, actionItem.unit_price_usd_cents);
      const prettyGrind = actionItem.grind_type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase());
      cardBox.innerHTML = `
        <div class="chat-action-title">✨ Recommended Coffee (1-Click Add):</div>
        <div class="chat-action-meta"><strong>${actionItem.name}</strong> (${actionItem.weight_grams}g · ${prettyGrind})</div>
        <div class="chat-action-actions">
          <button type="button" class="btn-primary btn-chat-add" style="font-size:0.8rem; padding: 0.4rem 0.9rem; display:inline-flex; align-items:center; gap: 0.35rem;">
            🛒 Add to Cart (${priceFormatted})
          </button>
        </div>
      `;

      cardBox.querySelector('.btn-chat-add')?.addEventListener('click', (e) => {
        this.triggerHaptic();
        this.addToCart({
          id: `agent_item_${Date.now()}`,
          product_id: actionItem.product_id,
          variant_id: actionItem.variant_id,
          name: actionItem.name,
          weight_grams: actionItem.weight_grams,
          grind_type: actionItem.grind_type,
          unit_price_inr: actionItem.unit_price_inr,
          unit_price_usd_cents: actionItem.unit_price_usd_cents,
          discount_percent: 0,
          quantity: 1,
          image_url: actionItem.image_url
        });
        const targetBtn = e.currentTarget as HTMLButtonElement;
        if (targetBtn) {
          targetBtn.textContent = '✓ Added to Cart!';
          targetBtn.style.background = 'var(--accent-emerald)';
          setTimeout(() => {
            targetBtn.textContent = `🛒 Add to Cart (${priceFormatted})`;
            targetBtn.style.background = '';
          }, 2000);
        }
      });
    }

    // Check if brewing guide or live timer is relevant
    const isBrewContext = lowerReply.includes('v60') || lowerReply.includes('kaapi') || lowerReply.includes('filter') || lowerReply.includes('aeropress') || lowerReply.includes('espresso') || lowerReply.includes('ratio') || lowerReply.includes('bloom') || lowerQuery.includes('brew') || lowerQuery.includes('v60') || lowerQuery.includes('filter');

    if (isBrewContext) {
      let targetMethod = 'v60';
      let targetGrams = 15;
      let targetRatio = 16;
      if (lowerReply.includes('kaapi') || lowerReply.includes('filter') || lowerReply.includes('decoction')) {
        targetMethod = 'filter-kaapi';
        targetGrams = 20;
        targetRatio = 5;
      } else if (lowerReply.includes('aeropress')) {
        targetMethod = 'aeropress';
        targetGrams = 18;
        targetRatio = 14;
      } else if (lowerReply.includes('espresso')) {
        targetMethod = 'espresso';
        targetGrams = 18;
        targetRatio = 2;
      }

      const timerBtn = document.createElement('button');
      timerBtn.type = 'button';
      timerBtn.className = 'btn-secondary btn-chat-timer';
      timerBtn.style.cssText = 'font-size: 0.78rem; padding: 0.4rem 0.85rem; border-radius: var(--radius-pill); cursor: pointer; display:inline-flex; align-items:center; gap: 0.35rem;';
      timerBtn.innerHTML = `⏱️ Launch Live Brew Timer (${targetRatio === 5 ? '1:5 Kaapi' : `1:${targetRatio} ${targetMethod.toUpperCase()}`})`;
      timerBtn.addEventListener('click', () => {
        this.triggerHaptic();
        this.closeAgent();
        const brewSection = document.getElementById('brew-guide');
        brewSection?.scrollIntoView({ behavior: 'smooth' });

        // Select brew card
        const card = document.querySelector(`.brew-card[data-method="${targetMethod}"]`) as HTMLElement;
        if (card) {
          document.querySelectorAll('.brew-card').forEach((c) => c.classList.remove('active'));
          card.classList.add('active');
        }

        // Adjust sliders
        const doseSlider = document.getElementById('coffee-grams-slider') as HTMLInputElement;
        const ratioSlider = document.getElementById('brew-ratio-slider') as HTMLInputElement;
        if (doseSlider) doseSlider.value = targetGrams.toString();
        if (ratioSlider) ratioSlider.value = targetRatio.toString();
        doseSlider?.dispatchEvent(new Event('input'));
        ratioSlider?.dispatchEvent(new Event('input'));
      });

      const actionsContainer = cardBox.querySelector('.chat-action-actions');
      if (actionsContainer) {
        actionsContainer.appendChild(timerBtn);
      } else {
        cardBox.innerHTML = `<div class="chat-action-actions"></div>`;
        cardBox.querySelector('.chat-action-actions')?.appendChild(timerBtn);
      }
    }

    // If cardBox has content, append it to bubble
    if (cardBox.querySelector('.chat-action-actions')?.hasChildNodes()) {
      bubble.appendChild(cardBox);
    }
  }

  private renderMarkdown(md: string): string {
    if (!md) return '';

    // Escape raw HTML before any markdown processing — this is rendered via innerHTML, and the
    // content originates from the LLM (which can be prompt-injected into emitting raw
    // HTML/script tags). None of the markdown patterns below target &/</>, so escaping first is
    // safe and closes that off without disturbing table/header/list/bold/italic parsing.
    md = this.escapeHtml(md);

    // Handle Markdown Tables
    const lines = md.split('\n');
    let inTable = false;
    let tableHtml = '';
    const processedLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('|') && line.endsWith('|')) {
        if (!inTable) {
          inTable = true;
          tableHtml = '<div style="overflow-x:auto; margin: 0.6rem 0;"><table>';
          const headers = line.split('|').slice(1, -1).map((h) => h.trim());
          tableHtml += '<thead><tr>' + headers.map((h) => `<th>${this.formatInlineMarkdown(h)}</th>`).join('') + '</tr></thead><tbody>';
          if (i + 1 < lines.length && lines[i + 1].trim().startsWith('|') && lines[i + 1].includes('---')) {
            i++; // skip separator line
          }
        } else {
          const cells = line.split('|').slice(1, -1).map((c) => c.trim());
          tableHtml += '<tr>' + cells.map((c) => `<td>${this.formatInlineMarkdown(c)}</td>`).join('') + '</tr>';
        }
      } else {
        if (inTable) {
          inTable = false;
          tableHtml += '</tbody></table></div>';
          processedLines.push(tableHtml);
          tableHtml = '';
        }
        processedLines.push(line);
      }
    }
    if (inTable) {
      tableHtml += '</tbody></table></div>';
      processedLines.push(tableHtml);
    }

    let text = processedLines.join('\n');

    // Headers
    text = text.replace(/^#### (.*$)/gim, '<h5 style="margin: 0.5rem 0 0.2rem; font-weight:700; color: var(--text-main); font-size: 0.9rem;">$1</h5>');
    text = text.replace(/^### (.*$)/gim, '<h4 style="margin: 0.6rem 0 0.3rem; font-weight:700; color: var(--accent-terracotta); font-size: 0.96rem;">$1</h4>');
    text = text.replace(/^## (.*$)/gim, '<h3 style="margin: 0.7rem 0 0.3rem; font-weight:700; color: var(--text-main); font-size: 1.05rem;">$1</h3>');

    // Lists
    text = text.replace(/^\s*[-*•]\s+(.*$)/gim, '<li style="margin-left: 1.2rem; margin-bottom: 0.25rem;">$1</li>');
    text = text.replace(/^\s*(\d+)\.\s+(.*$)/gim, '<li style="margin-left: 1.2rem; margin-bottom: 0.25rem;">$2</li>');

    // Inline styles
    text = this.formatInlineMarkdown(text);

    // Newlines
    text = text.replace(/\n\n+/g, '<br><br>');
    text = text.replace(/\n/g, '<br>');

    // Clean extra breaks around divs/tables/headers
    text = text.replace(/<\/div><br>/g, '</div>');
    text = text.replace(/<br><div/g, '<div');
    text = text.replace(/<\/h4><br>/g, '</h4>');
    text = text.replace(/<\/h5><br>/g, '</h5>');

    return text;
  }

  private formatInlineMarkdown(str: string): string {
    return str
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code style="background: rgba(0,0,0,0.06); padding: 0.15rem 0.35rem; border-radius: 3px; font-size: 0.88em;">$1</code>');
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
    let selectedFlavor = 'JAGGERY';

    optionsContainer?.querySelectorAll('.quiz-option-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const val = (e.currentTarget as HTMLElement).getAttribute('data-value') || 'POUR_OVER';

        if (currentStep === 1) {
          selectedMethod = val;
          currentStep = 2;
          if (questionTitle) questionTitle.textContent = '2. What tasting notes excite your palate?';
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
        } else if (currentStep === 2) {
          selectedFlavor = val;
          if (optionsContainer) optionsContainer.style.display = 'none';
          if (questionTitle) questionTitle.textContent = '✨ Your Ideal Bangalore Roast Match';

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
          } else if (selectedFlavor === 'CHOCOLATE') {
            recName = 'Dawn Patrol Bangalore Roastery Blend';
            recTag = 'Silky dark chocolate fudge & toasted cashew';
            recImg = '/images/roaster.jpg';
            recPriceInr = 420;
            recPriceUsd = 1650;
            recProdId = 'prod_dawn_blend';
            recVarId = 'var_dawn_250';
          } else if (selectedFlavor === 'FLORAL') {
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

  private setupSheetDragDismiss(drawerId: string, handleId: string, closeCallback: () => void) {
    const drawer = document.getElementById(drawerId);
    const handle = document.getElementById(handleId);
    if (!drawer || !handle) return;

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    handle.addEventListener('touchstart', (e: TouchEvent) => {
      if (window.innerWidth > 768) return;
      startY = e.touches[0].clientY;
      currentY = startY;
      isDragging = true;
      drawer.style.transition = 'none';
    }, { passive: true });

    handle.addEventListener('touchmove', (e: TouchEvent) => {
      if (!isDragging || window.innerWidth > 768) return;
      currentY = e.touches[0].clientY;
      const deltaY = Math.max(0, currentY - startY);
      drawer.style.transform = `translateY(${deltaY}px)`;
    }, { passive: true });

    handle.addEventListener('touchend', () => {
      if (!isDragging || window.innerWidth > 768) return;
      isDragging = false;
      drawer.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
      const deltaY = currentY - startY;
      if (deltaY > 80) {
        this.triggerHaptic();
        closeCallback();
      } else {
        drawer.style.transform = 'translateY(0)';
      }
    });
  }

  openCart() {
    this.triggerHaptic();
    const drawer = document.getElementById('cart-drawer');
    if (drawer) {
      drawer.style.transform = '';
      drawer.style.transition = '';
      drawer.classList.add('open');
    }
    document.getElementById('cart-drawer-overlay')?.classList.add('open');
    document.querySelectorAll('.mobile-nav-item').forEach((i) => i.classList.remove('active'));
    document.getElementById('mob-nav-cart')?.classList.add('active');
  }

  closeCart() {
    const drawer = document.getElementById('cart-drawer');
    if (drawer) {
      drawer.classList.remove('open');
      drawer.style.transform = '';
    }
    document.getElementById('cart-drawer-overlay')?.classList.remove('open');
  }

  openAgent() {
    this.triggerHaptic();
    const drawer = document.getElementById('agent-drawer');
    if (drawer) {
      drawer.style.transform = '';
      drawer.style.transition = '';
      drawer.classList.add('open');
    }
    document.getElementById('agent-drawer-overlay')?.classList.add('open');
    document.querySelectorAll('.mobile-nav-item').forEach((i) => i.classList.remove('active'));
    document.getElementById('mob-nav-agent')?.classList.add('active');
  }

  closeAgent() {
    const drawer = document.getElementById('agent-drawer');
    if (drawer) {
      drawer.classList.remove('open');
      drawer.style.transform = '';
    }
    document.getElementById('agent-drawer-overlay')?.classList.remove('open');
  }

  private setupPWA() {
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
    });

    window.addEventListener('appinstalled', () => {
      console.log('[PWA] The Daily Grind installed successfully');
      this.deferredInstallPrompt = null;
    });
  }

  private renderFlavorWheelSVGs() {
    const mainGroup = document.getElementById('wheel-sectors-group');
    const modalGroup = document.getElementById('modal-wheel-sectors-group');

    const totalCategories = SCA_FLAVOR_CATEGORIES.length;
    const sectorAngle = 360 / totalCategories;

    if (mainGroup) {
      mainGroup.innerHTML = SCA_FLAVOR_CATEGORIES.map((cat, idx) => {
        const startDeg = idx * sectorAngle;
        const endDeg = startDeg + sectorAngle;
        const pathD = describeWedgePath(0, 0, 46, 148, startDeg, endDeg);
        const midDeg = (startDeg + endDeg) / 2;
        const textPos = polarToCartesian(0, 0, 96, midDeg);
        const isActive = this.activeFlavorWheelCategory === cat.id;

        return `
          <g class="wheel-wedge-group" data-category="${cat.id}">
            <path d="${pathD}" fill="${cat.color}" class="wheel-wedge ${isActive ? 'active' : ''}" data-category="${cat.id}">
              <title>${cat.name}: ${cat.subNotes.slice(0, 3).join(', ')}</title>
            </path>
            <text x="${textPos.x}" y="${textPos.y}" text-anchor="middle" dominant-baseline="central" class="wedge-label">
              ${cat.icon} ${cat.name}
            </text>
          </g>
        `;
      }).join('');
    }

    if (modalGroup) {
      modalGroup.innerHTML = SCA_FLAVOR_CATEGORIES.map((cat, idx) => {
        const startDeg = idx * sectorAngle;
        const endDeg = startDeg + sectorAngle;
        const pathD = describeWedgePath(0, 0, 54, 175, startDeg, endDeg);
        const midDeg = (startDeg + endDeg) / 2;
        const textPos = polarToCartesian(0, 0, 114, midDeg);
        const isActive = this.activeFlavorWheelCategory === cat.id;

        return `
          <g class="modal-wheel-wedge-group" data-category="${cat.id}">
            <path d="${pathD}" fill="${cat.color}" class="wheel-wedge ${isActive ? 'active' : ''}" data-category="${cat.id}">
              <title>${cat.name}: ${cat.description}</title>
            </path>
            <text x="${textPos.x}" y="${textPos.y}" text-anchor="middle" dominant-baseline="central" class="wedge-label" font-size="12">
              ${cat.icon} ${cat.name}
            </text>
          </g>
        `;
      }).join('');
    }

    document.querySelectorAll('.wheel-wedge').forEach((wedge) => {
      wedge.addEventListener('click', (e) => {
        const catId = (e.currentTarget as SVGElement).getAttribute('data-category');
        if (catId) {
          this.triggerHaptic();
          this.setFlavorCategory(catId === this.activeFlavorWheelCategory ? 'all' : catId, true);
        }
      });
    });
  }

  private setupFlavorWheel() {
    document.querySelectorAll('#flavor-wheel-pills .wheel-cat-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.triggerHaptic();
        const cat = (e.currentTarget as HTMLElement).getAttribute('data-category') || 'all';
        this.setFlavorCategory(cat, true);
      });
    });

    document.getElementById('btn-clear-wheel-filter')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.setFlavorCategory('all');
    });

    document.getElementById('btn-open-flavor-wheel-modal')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.openFlavorWheelModal();
    });

    document.getElementById('btn-close-wheel-modal')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.closeFlavorWheelModal();
    });

    document.getElementById('btn-apply-modal-filter')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.closeFlavorWheelModal();
      document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
    });

    document.getElementById('flavor-wheel-modal')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        this.closeFlavorWheelModal();
      }
    });
  }

  setFlavorCategory(category: string, scrollToCatalog: boolean = false) {
    this.activeFlavorWheelCategory = category;

    document.querySelectorAll('#flavor-wheel-pills .wheel-cat-btn').forEach((btn) => {
      const cat = btn.getAttribute('data-category');
      if (cat === category) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    document.querySelectorAll('.wheel-wedge').forEach((wedge) => {
      const cat = wedge.getAttribute('data-category');
      if (cat === category) {
        wedge.classList.add('active');
      } else {
        wedge.classList.remove('active');
      }
    });

    const statusIndicator = document.getElementById('active-flavor-status');
    const statusText = document.getElementById('active-flavor-text');
    if (category !== 'all') {
      const catDef = SCA_FLAVOR_CATEGORIES.find((c) => c.id === category);
      if (statusIndicator && statusText && catDef) {
        statusIndicator.style.display = 'inline-flex';
        statusText.innerHTML = `Filtering by <strong style="color: ${catDef.color}">${catDef.icon} ${catDef.name}</strong>`;
      }
    } else {
      if (statusIndicator) {
        statusIndicator.style.display = 'none';
      }
    }

    this.updateModalFlavorDetails(category);
    this.renderProducts();

    if (scrollToCatalog && category !== 'all') {
      const catalogEl = document.getElementById('catalog');
      if (catalogEl) {
        catalogEl.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  private updateModalFlavorDetails(category: string) {
    const iconEl = document.getElementById('detail-category-icon');
    const titleEl = document.getElementById('detail-category-title');
    const descEl = document.getElementById('detail-category-desc');
    const subnotesEl = document.getElementById('detail-subnotes-container');
    const matchedEl = document.getElementById('detail-matched-coffees');

    const catDef = SCA_FLAVOR_CATEGORIES.find((c) => c.id === category);

    if (!catDef || category === 'all') {
      if (iconEl) iconEl.textContent = '✨';
      if (titleEl) titleEl.textContent = 'All Flavor Families';
      if (descEl) descEl.textContent = 'Select any sector (Floral, Fruity, Sweet, Chocolate/Nutty, Spiced) to highlight matching cupping notes.';
      if (subnotesEl) {
        subnotesEl.innerHTML = `
          <span class="taste-tag">Jasmine</span>
          <span class="taste-tag">Jackfruit</span>
          <span class="taste-tag">Jaggery</span>
          <span class="taste-tag">Dark Chocolate</span>
          <span class="taste-tag">Cardamom</span>
        `;
      }
      if (matchedEl) {
        matchedEl.innerHTML = this.products.slice(0, 3).map((p) => `
          <div class="matched-coffee-pill">
            <span class="matched-coffee-name">${p.name}</span>
            <span class="matched-coffee-roast">${p.origin_country} · ${p.roast_level.replace('_', ' ')}</span>
          </div>
        `).join('');
      }
      return;
    }

    if (iconEl) iconEl.textContent = catDef.icon;
    if (titleEl) titleEl.textContent = `${catDef.name} Profile`;
    if (descEl) descEl.textContent = catDef.description;

    if (subnotesEl) {
      subnotesEl.innerHTML = catDef.subNotes.map((sn) => `
        <span class="taste-tag tag-match" style="background: ${catDef.color}; color: #fff;">${sn}</span>
      `).join('');
    }

    if (matchedEl) {
      const matched = this.products.filter((p) => this.matchesFlavorCategory(p, catDef));
      if (matched.length === 0) {
        matchedEl.innerHTML = `<p style="font-size:0.85rem; color: var(--text-muted);">No current roasts in this exact profile.</p>`;
      } else {
        matchedEl.innerHTML = matched.map((p) => `
          <div class="matched-coffee-pill">
            <span class="matched-coffee-name">${p.name}</span>
            <span class="matched-coffee-roast">${p.origin_country} · ${p.roast_level.replace('_', ' ')}</span>
          </div>
        `).join('');
      }
    }
  }

  private matchesFlavorCategory(product: any, catDef: FlavorCategoryDef): boolean {
    const notes = (product.tasting_notes || []).map((n: string) => n.toLowerCase());
    const desc = (product.description || '').toLowerCase();
    const tagline = (product.tagline || '').toLowerCase();
    const fullText = `${notes.join(' ')} ${desc} ${tagline}`;

    return catDef.keywords.some((kw) => fullText.includes(kw.toLowerCase())) ||
           catDef.subNotes.some((sn) => fullText.includes(sn.toLowerCase()));
  }

  private getFocusable(container: HTMLElement): HTMLElement[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
  }

  // Moves focus into a just-opened modal and remembers what to restore it to on close —
  // without this, keyboard/screen-reader users get stranded on a trigger button behind an overlay.
  private trapFocusIn(modal: HTMLElement) {
    this.modalFocusReturnEl = document.activeElement as HTMLElement;
    const focusable = this.getFocusable(modal);
    (focusable[0] || modal).focus();
  }

  private releaseFocusTrap() {
    this.modalFocusReturnEl?.focus();
    this.modalFocusReturnEl = null;
  }

  openFlavorWheelModal() {
    const modal = document.getElementById('flavor-wheel-modal');
    if (modal) {
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      this.updateModalFlavorDetails(this.activeFlavorWheelCategory);
      this.trapFocusIn(modal);
    }
  }

  closeFlavorWheelModal() {
    const modal = document.getElementById('flavor-wheel-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      this.releaseFocusTrap();
    }
  }

  handleQRCodeDeepLink() {
    try {
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      const fullUrl = window.location.href;

      if (fullUrl.includes('lot=') || hash.includes('brew-guide') || fullUrl.includes('batch=')) {
        const rawParamString = search ? search.slice(1) : (hash.includes('?') ? hash.split('?')[1] : '');
        const params = new URLSearchParams(rawParamString);
        const lotSlug = params.get('lot');
        const grind = params.get('grind');
        const batch = params.get('batch');

        if (lotSlug || grind) {
          setTimeout(() => {
            document.getElementById('brew-guide')?.scrollIntoView({ behavior: 'smooth' });

            if (grind) {
              const cleanedGrind = grind.toLowerCase().replace(/[^a-z0-9]/g, '');
              const methodCard = Array.from(document.querySelectorAll('.brew-card')).find(c => {
                const title = c.querySelector('.brew-title')?.textContent?.toLowerCase() || '';
                return title.includes(cleanedGrind) || (cleanedGrind.includes('filter') && title.includes('filter')) ||
                       (cleanedGrind.includes('v60') && title.includes('v60')) ||
                       (cleanedGrind.includes('espresso') && title.includes('espresso')) ||
                       (cleanedGrind.includes('aeropress') && title.includes('aeropress'));
              }) as HTMLElement | undefined;

              if (methodCard) {
                document.querySelectorAll('.brew-card').forEach((c) => c.classList.remove('active'));
                methodCard.classList.add('active');
                const r = methodCard.getAttribute('data-ratio');
                const ratioSlider = document.getElementById('brew-ratio-slider') as HTMLInputElement;
                if (r && ratioSlider) {
                  ratioSlider.value = r;
                  ratioSlider.dispatchEvent(new Event('input'));
                }
              }
            }

            if (lotSlug) {
              const prettyLot = lotSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              this.appendMessage('agent', `✨ Namaskara! You scanned the thermal bag label for ${prettyLot}${batch ? ` (${batch})` : ''}. For this fresh Bangalore convection roast, I recommend 93°C water with a 1:16 ratio and 45s bloom for optimal jaggery sweetness. Ask me anything about dialing in your brew!`);
              this.openAgent();
            }
          }, 500);
        }
      }
    } catch {
      // Graceful fallback for non-browser/test environments
    }
  }

  resetFilters() {
    this.triggerHaptic();
    this.activeCategory = 'all';
    this.activeTastingNote = 'all';
    this.activeFlavorWheelCategory = 'all';
    this.searchQuery = '';
    const searchInput = document.getElementById('catalog-search-input') as HTMLInputElement | null;
    if (searchInput) searchInput.value = '';

    document.querySelectorAll('#category-tabs-container .category-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('#flavor-pills-container .note-pill').forEach((p) => p.classList.remove('active'));
    document.querySelectorAll('#flavor-wheel-pills .wheel-cat-btn').forEach((p) => p.classList.remove('active'));
    document.querySelectorAll('.wheel-wedge').forEach((w) => w.classList.remove('active'));

    document.querySelector('#category-tabs-container .category-tab[data-category="all"]')?.classList.add('active');
    document.querySelector('#flavor-pills-container .note-pill[data-note="all"]')?.classList.add('active');
    document.querySelector('#flavor-wheel-pills .wheel-cat-btn[data-category="all"]')?.classList.add('active');

    const statusIndicator = document.getElementById('active-flavor-status');
    if (statusIndicator) statusIndicator.style.display = 'none';

    this.renderProducts();
  }
}

const app = new StorefrontApp();
(window as any).storefrontApp = app;
app.init();

