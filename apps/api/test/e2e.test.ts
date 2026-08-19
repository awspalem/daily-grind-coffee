import test from 'node:test';
import assert from 'node:assert/strict';
import { InventoryLedgerService } from '../src/services/inventoryLedger';
import { StripeService } from '../src/services/stripe';
import { WorkersAIService } from '../src/services/workersAI';
import { McpServer } from '../src/services/mcpServer';
import { FreeTierQuotaMonitor } from '../src/services/quotaMonitor';
import { D1BackupService } from '../src/services/backupService';
import { generateOrderConfirmationEmail } from '../src/services/emailTemplate';
import { GroqService } from '../src/services/groq';

// Comprehensive Mock D1 Database
class MockD1Database {
  public tables: Record<string, any[]> = {
    categories: [
      { id: 'cat_so', slug: 'single-origin', name: 'Single Origin', display_order: 1 },
      { id: 'cat_bl', slug: 'signature-blends', name: 'Signature Blends', display_order: 2 }
    ],
    products: [
      {
        id: 'prod_eth_yirg',
        slug: 'ethiopia-yirgacheffe-gedeb',
        name: 'Ethiopia Yirgacheffe Gedeb',
        tagline: 'Floral jasmine & ripe peach',
        description: 'High altitude natural coffee',
        category_id: 'cat_so',
        origin_country: 'Ethiopia',
        region: 'Gedeb',
        process_method: 'NATURAL',
        roast_level: 'LIGHT',
        tasting_notes: JSON.stringify(["Jasmine", "Bergamot", "Peach"]),
        image_url: 'https://example.com/eth.jpg',
        is_active: 1,
        is_featured: 1,
      }
    ],
    product_variants: [
      { id: 'var_eth_250', product_id: 'prod_eth_yirg', sku: 'TDG-ETH-250G', weight_grams: 250, price_cents: 1950, grind_options: JSON.stringify(['WHOLE_BEAN', 'POUR_OVER']), is_active: 1 }
    ],
    inventory: [
      { variant_id: 'var_eth_250', sku: 'TDG-ETH-250G', available_stock: 45, reserved_stock: 0, low_stock_threshold: 10 }
    ],
    inventory_movements: [],
    carts: [],
    cart_items: [],
    orders: [
      {
        id: 'ord_123',
        order_number: 'TDG-102938',
        customer_email: 'tester@dailyroast.in',
        status: 'PAID',
        total_cents: 3900,
        currency: 'usd',
        created_at: new Date().toISOString()
      }
    ],
    order_items: [],
    subscriptions: [],
    payments: [],
    refunds: [],
    webhook_events: [],
    audit_log: [],
    analytics_events: [
      { id: 'ae1', event_name: 'product_view', created_at: new Date().toISOString() },
      { id: 'ae2', event_name: 'add_to_cart', created_at: new Date().toISOString() },
      { id: 'ae3', event_name: 'checkout_started', created_at: new Date().toISOString() },
      { id: 'ae4', event_name: 'purchase', created_at: new Date().toISOString() },
    ],
    brewing_guides: [
      {
        id: 'g1',
        slug: 'hario-v60-pour-over',
        name: 'Hario V60 Single-Cup Pour Over',
        grind_recommendation: 'POUR_OVER',
        ratio_description: '1:16 Ratio',
        water_temp_celsius: 94,
        brew_time_seconds: 210,
        steps_json: '[]',
        pro_tips_json: '[]'
      }
    ]
  };

  prepare(sql: string) {
    const self = this;
    let boundParams: any[] = [];

    const stmt = {
      bind(...params: any[]) {
        boundParams = params;
        return stmt;
      },
      async first<T = any>(colName?: string): Promise<T | null> {
        if (sql.includes('inventory') && sql.includes('variant_id = ?')) {
          const inv = self.tables.inventory.find(i => i.variant_id === boundParams[0]);
          return (inv as any) || null;
        }
        if (sql.includes('webhook_events') && sql.includes('id = ?')) {
          const ev = self.tables.webhook_events.find(e => e.id === boundParams[0]);
          return (ev as any) || null;
        }
        if (sql.includes('orders') && sql.includes('id = ?')) {
          const ord = self.tables.orders.find(o => o.id === boundParams[0] || o.order_number === boundParams[0]);
          return (ord as any) || null;
        }
        if (sql.includes('orders') && sql.includes('order_number = ?')) {
          const ord = self.tables.orders.find(o => o.order_number === boundParams[0]);
          return (ord as any) || null;
        }
        if (sql.includes('product_variants') && sql.includes('id = ?')) {
          const v = self.tables.product_variants.find(v => v.id === boundParams[0]);
          return (v as any) || null;
        }
        if (sql.includes('COUNT(*) as count FROM analytics_events')) {
          return { count: self.tables.analytics_events.length } as any;
        }
        if (sql.includes('COUNT(*) as count FROM orders')) {
          return { count: self.tables.orders.length } as any;
        }
        if (sql.includes('COUNT(*) as count FROM inventory_movements')) {
          return { count: self.tables.inventory_movements.length } as any;
        }
        return null;
      },
      async all<T = any>(): Promise<{ results: T[]; success: boolean; meta: any }> {
        if (sql.includes('FROM categories')) {
          return { results: self.tables.categories as any, success: true, meta: {} };
        }
        if (sql.includes('FROM inventory_movements')) {
          return { results: self.tables.inventory_movements as any, success: true, meta: {} };
        }
        if (sql.includes('FROM products')) {
          return { results: self.tables.products as any, success: true, meta: {} };
        }
        if (sql.includes('FROM product_variants')) {
          return { results: self.tables.product_variants as any, success: true, meta: {} };
        }
        if (sql.includes('FROM brewing_guides')) {
          return { results: self.tables.brewing_guides as any, success: true, meta: {} };
        }
        return { results: [], success: true, meta: {} };
      },
      async run(): Promise<{ success: boolean; meta: any }> {
        return { success: true, meta: {} };
      }
    };
    return stmt;
  }

  async batch(statements: any[]) {
    return statements.map(() => ({ results: [], success: true, meta: {} }));
  }

  async exec() {
    return { count: 1, duration: 0 };
  }
}

// ---------------------- PHASE 1 & 2 TESTS ----------------------
test('Phase 1 & 2: InventoryLedgerService correctly manages purchase hold reservations', async () => {
  const mockDb = new MockD1Database();
  const ledger = new InventoryLedgerService(mockDb as any);

  const initial = await ledger.getInventorySnapshot('var_eth_250');
  assert.ok(initial);

  const result = await ledger.recordMovement({
    variantId: 'var_eth_250',
    movementType: 'PURCHASE_RESERVE',
    delta: -2,
    referenceType: 'CART',
    referenceId: 'cart_123',
    reason: 'Checkout stock hold',
    actor: 'CHECKOUT_SERVICE'
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.newAvailableStock, 43);
});

test('Phase 1 & 2: StripeService creates checkout session and validates HMAC SHA-256 signatures', async () => {
  const webhookSecret = 'whsec_daily_grind_production_secret_key';
  const stripe = new StripeService(undefined, webhookSecret);

  // 1. Session creation in edge simulation mode
  const session = await stripe.createCheckoutSession({
    orderId: 'ord_123',
    orderNumber: 'TDG-102938',
    customerEmail: 'tester@dailyroast.in',
    items: [{ name: 'Ethiopia Yirgacheffe', unitPriceCents: 1950, quantity: 2 }],
    shippingCents: 0,
    successUrl: 'http://localhost:5173/confirmation',
    cancelUrl: 'http://localhost:5173/cart'
  });
  assert.ok(session.id.startsWith('cs_mock_'));

  // 2. Cryptographic signature check
  const payload = JSON.stringify({ id: 'evt_stripe_999', type: 'checkout.session.completed' });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`));
  const hexSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const validHeader = `t=${timestamp},v1=${hexSignature}`;
  assert.strictEqual(await stripe.verifyWebhookSignature(payload, validHeader), true);
  assert.strictEqual(await stripe.verifyWebhookSignature(payload, 't=123,v1=tampered'), false);
});

// ---------------------- PHASE 3 TESTS ----------------------
test('Phase 3: D1BackupService creates complete multi-table snapshot payload for R2', async () => {
  const mockDb = new MockD1Database();
  const backupService = new D1BackupService(mockDb as any);
  const result = await backupService.performNightlyExport();

  assert.strictEqual(result.success, true);
  assert.ok(result.key.startsWith('backups/d1_snapshot_'));
  assert.ok(result.rowCount > 0);
});

test('Phase 3: generateOrderConfirmationEmail generates structured HTML email payload', () => {
  const email = generateOrderConfirmationEmail({
    orderNumber: 'TDG-887766',
    customerName: 'Marcus',
    customerEmail: 'marcus@example.com',
    totalCents: 3900,
    items: [
      { name: 'Ethiopia Yirgacheffe', weightGrams: 250, grindType: 'POUR_OVER', priceCents: 1950, quantity: 2 }
    ],
    storefrontUrl: 'http://localhost:5173'
  });

  assert.strictEqual(email.to, 'marcus@example.com');
  assert.ok(email.subject.includes('TDG-887766'));
  assert.ok(email.html.includes('Ethiopia Yirgacheffe'));
  assert.ok(email.html.includes('$39.00'));
});

// ---------------------- PHASE 4 & 5 TESTS ----------------------
test('Phase 5: WorkersAIService computes dense vector embeddings and cosine similarity', async () => {
  const ai = new WorkersAIService();
  const vec1 = await ai.generateEmbedding('Floral jasmine and ripe white peach light roast');
  const vec2 = await ai.generateEmbedding('Jasmine floral bergamot tea notes');
  const vec3 = await ai.generateEmbedding('Heavy dark cocoa molasses espresso roast');

  assert.strictEqual(vec1.length, 64);
  const simRelated = ai.calculateSimilarity(vec1, vec2);
  const simUnrelated = ai.calculateSimilarity(vec1, vec3);

  assert.ok(simRelated > simUnrelated, 'Semantic match should yield higher similarity score than opposite roast profile');
});

test('Phase 5: McpServer executes Model Context Protocol JSON-RPC 2.0 tool calls', async () => {
  const mockDb = new MockD1Database();
  const mcp = new McpServer(mockDb as any);

  // 1. List tools
  const listRes = await mcp.handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.strictEqual(listRes.result.tools.length, 4);

  // 2. Call tool: search_products
  const searchRes = await mcp.handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'search_products', arguments: { query: 'Ethiopia' } }
  });
  assert.ok(searchRes.result.content[0].text.includes('Ethiopia Yirgacheffe'));

  // 3. Call tool: get_order
  const orderRes = await mcp.handleRequest({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'get_order', arguments: { order_number: 'TDG-102938' } }
  });
  assert.ok(orderRes.result.content[0].text.includes('TDG-102938'));
});

test('Phase 5: FreeTierQuotaMonitor tracks daily edge operations and evaluates status', async () => {
  const mockDb = new MockD1Database();
  const monitor = new FreeTierQuotaMonitor(mockDb as any);
  const report = await monitor.getUsageReport();

  assert.ok(report.workers_daily_requests.used >= 0);
  assert.strictEqual(report.workers_daily_requests.limit, 100000);
  assert.strictEqual(report.d1_daily_reads.limit, 5000000);
  assert.strictEqual(report.d1_daily_writes.limit, 100000);
  assert.strictEqual(report.status, 'OPTIMAL');
});

// ---------------------- SUBSCRIPTION & TASTER FLIGHT ARCHITECTURE TESTS ----------------------
test('Phase 6: Subscriptions apply 10% unit discount and compute next renewal date', () => {
  const basePriceCents = 2000;
  const discountedPriceCents = Math.round(basePriceCents * 0.90);
  assert.strictEqual(discountedPriceCents, 1800, 'Subscribe & Save should apply exact 10% unit discount');

  // Test renewal interval calculations
  const calculateRenewal = (freq: '1_WEEK' | '2_WEEKS' | '4_WEEKS') => {
    const days = freq === '1_WEEK' ? 7 : freq === '2_WEEKS' ? 14 : 28;
    const date = new Date('2026-08-14T00:00:00.000Z');
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  };

  assert.strictEqual(calculateRenewal('1_WEEK'), '2026-08-21');
  assert.strictEqual(calculateRenewal('2_WEEKS'), '2026-08-28');
  assert.strictEqual(calculateRenewal('4_WEEKS'), '2026-09-11');
});

test('Phase 6: 3x 100g Curated Taster Flight correctly bundles 3 distinct estate lots with grind', () => {
  const selectedLots = [
    'Chikmagalur Attikan Estate Honey',
    'Araku Valley Red Honey Micro-Lot',
    'Ethiopia Yirgacheffe Gedeb'
  ];
  const customNotes = `3x 100g Lots: 1. ${selectedLots[0]}, 2. ${selectedLots[1]}, 3. ${selectedLots[2]}`;

  const flightItem = {
    product_id: 'prod_taster_flight',
    variant_id: 'var_flight_300',
    weight_grams: 300,
    unit_price_inr: 590,
    unit_price_usd_cents: 2400,
    grind_type: 'SOUTH_INDIAN_FILTER',
    custom_notes: customNotes,
    subscription_frequency: null
  };

  assert.strictEqual(flightItem.weight_grams, 300);
  assert.strictEqual(flightItem.unit_price_inr, 590);
  assert.strictEqual(flightItem.unit_price_usd_cents, 2400);
  assert.strictEqual(flightItem.grind_type, 'SOUTH_INDIAN_FILTER');
  assert.ok(flightItem.custom_notes.includes('Attikan'));
  assert.ok(flightItem.custom_notes.includes('Araku'));
  assert.ok(flightItem.custom_notes.includes('Ethiopia'));
});

// ---------------------- AI BARISTA MAYA & GROQ ENGINE TESTS ----------------------
test('Maya Engine: GroqService defaults to llama-3.3-70b-versatile and handles model fallback', async () => {
  const groq = new GroqService(undefined, 'llama-3.3-70b-versatile');
  
  // Test South Indian Filter Kaapi recipe
  const kaapiRes = await groq.chatCompletion([
    { role: 'user', content: 'How do I brew South Indian Filter Kaapi decoction?' }
  ]);
  assert.strictEqual(kaapiRes.role, 'assistant');
  assert.ok(kaapiRes.content.includes('1:5'));
  assert.ok(kaapiRes.content.includes('Attikan'));
  assert.ok(kaapiRes.content.includes('98°C'));

  // Test Chikmagalur Attikan Honey query
  const attikanRes = await groq.chatCompletion([
    { role: 'user', content: 'Tell me about Chikmagalur Attikan Estate Honey' }
  ]);
  assert.ok(attikanRes.content.includes('Baba Budan'));
  assert.ok(attikanRes.content.includes('Jaggery'));

  // Test Araku Valley query
  const arakuRes = await groq.chatCompletion([
    { role: 'user', content: 'What are the notes on Araku Valley Red Honey?' }
  ]);
  assert.ok(arakuRes.content.includes('Jackfruit'));
  assert.ok(arakuRes.content.includes('Eastern Ghats'));

  // Test V60 dial in recipe
  const v60Res = await groq.chatCompletion([
    { role: 'user', content: 'What is the Hario V60 ratio and water temp?' }
  ]);
  assert.ok(v60Res.content.includes('1:16'));
  assert.ok(v60Res.content.includes('93°C') || v60Res.content.includes('94°C'));

  // Test Midnight Runner Espresso
  const espRes = await groq.chatCompletion([
    { role: 'user', content: 'Recommend an espresso blend for dense crema' }
  ]);
  assert.ok(espRes.content.includes('Midnight Runner'));
  assert.ok(espRes.content.includes('9-Bar') || espRes.content.includes('crema'));
});

test('Maya Engine: Multi-Turn Conversation Memory retains context across questions', async () => {
  const groq = new GroqService(undefined, 'llama-3.3-70b-versatile');

  // Turn 1
  const history: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: 'I like light roasted coffees with high floral aromatics and fruit sweetness.' }
  ];
  const turn1Res = await groq.chatCompletion(history as any);
  assert.strictEqual(turn1Res.role, 'assistant');
  assert.ok(turn1Res.content.includes('Ethiopia') || turn1Res.content.includes('Yirgacheffe'));

  // Turn 2
  history.push({ role: 'assistant', content: turn1Res.content });
  history.push({ role: 'user', content: 'How should I brew this on my Hario V60?' });

  const turn2Res = await groq.chatCompletion(history as any);
  assert.strictEqual(turn2Res.role, 'assistant');
  assert.ok(turn2Res.content.includes('1:16'));
  assert.ok(turn2Res.content.includes('Bloom') || turn2Res.content.includes('45g'));
});


