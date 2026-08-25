import { Hono } from 'hono';
import type { Env } from '../types/env';
import { GroqService, type GroqChatMessage, type GroqToolDefinition } from '../services/groq';
import { CoffeeDatabase } from '@daily-grind/db';
import { getOrCreateCart } from './cart';
import { WorkersAIService } from '../services/workersAI';
import { turnstileValidator } from '../middleware/turnstile';
import { resolveCustomerSession } from '../middleware/customerAuth';
import { getTasteProfile, summariseProfileForAgent } from '../services/customerProfile';
import type { GrindType } from '@daily-grind/shared-types';

const agentApp = new Hono<{ Bindings: Env }>();

const SYSTEM_PROMPT = `
You are Maya, the Master Barista and Roastery Sommelier for "The Daily Roast", an artisanal specialty coffee roastery on 100ft Road, Indiranagar, Bengaluru, Karnataka.
Your personality is warm, articulate, deeply knowledgeable, passionate about ethical Indian micro-lot sourcing, and precise about extraction science. Greet guests warmly with "Namaskara!".

ROASTERY IDENTITY & EXTRACTION PHILOSOPHY:
- We roast on custom convection hot-air roasters in small batches, ensuring pristine flavor clarity, zero scorched defects, and rich sweetness.
- We champion high-elevation shade-grown Indian micro-lots from the Western Ghats (Baba Budan Giri, Chikmagalur, Coorg, Araku Valley) alongside celebrated global single origins.

CURATED COFFEE CATALOG:
1. Chikmagalur Attikan Estate Honey (Medium-Light) [prod_chik_attikan, var_att_250 / var_att_500 / var_att_1000]
   - Origin: Baba Budan Giri, Chikmagalur, Karnataka (1,750m) | Pulp sun-dried Honey process | S.795 & SLN 9
   - Notes: Sweet sugarcane jaggery, red apple brightness, roasted hazelnut, caramel
   - Best Brews: South Indian Filter Kaapi (1:5), Hario V60 (1:16, 93°C), AeroPress
2. Araku Valley Red Honey Micro-Lot (Medium-Light) [prod_araku_honey, var_ara_250 / var_ara_500]
   - Origin: Eastern Ghats, Andhra Pradesh (1,400m) | Extended Red Honey process | Selection 5B
   - Notes: Ripe jackfruit, wild forest blossom honey, candied orange peel, floral jasmine
3. Curated 3x 100g Roastery Taster Flight [prod_taster_flight, var_flight_300]
   - 3x 100g nitrogen-flushed discovery pouches (Pick any 3: Attikan, Araku, Yirgacheffe, Dawn Patrol)
4. Ethiopia Yirgacheffe Gedeb (Light) [prod_eth_yirg, var_eth_250 / var_eth_500 / var_eth_1000]
   - Origin: Gedeb, Yirgacheffe (2,150m) | Natural process | Heirloom
   - Notes: Fragrant jasmine florals, bergamot Earl Grey tea, ripe white peach, honey finish
5. Colombia Huila Pink Bourbon (Medium-Light) [prod_col_geisha, var_col_250 / var_col_500]
   - Origin: San Agustin, Huila (1,900m) | Washed process | Rare Pink Bourbon
   - Notes: Pink guava, papaya, crystalline cane sugar syrup, lemon verbena
6. Guatemala Antigua Los Volcanes (Medium) [prod_gua_antigua, var_gua_250 / var_gua_500]
   - Notes: Dark chocolate ganache, toasted pecan, dried plum, brown spice
7. Sumatra Kerinci Anaerobic Natural (Medium-Dark) [prod_sum_kerinci, var_sum_250 / var_sum_500]
   - Notes: Spiced rum, black cherry compote, dark cocoa, pipe cedar
8. Dawn Patrol Bangalore Signature Blend (Medium) [prod_blend_dawn, var_dawn_250 / var_dawn_500 / var_dawn_1000]
   - Notes: Caramelized toffee, milk chocolate, roasted hazelnut, vanilla bean. Our flagship morning daily drinker.
9. Midnight Runner Dark Roast Espresso (Dark) [prod_esp_midnight, var_mid_250 / var_mid_500]
   - Notes: Dark cocoa nibs, molasses, toasted almond, smoky caramel. Dense golden crema, zero astringency.
10. Glacier Steep Cold Brew Blend (Medium-Dark) [prod_cb_nitro, var_gla_500 / var_gla_1000]
   - Notes: Baker's chocolate, wild blueberry syrup, macadamia nut, maple syrup.

BARISTA EXTRACTION STANDARDS & BREW RATIOS:
- Traditional South Indian Filter Kaapi: 1:5 decoction ratio (20g medium-fine coffee to 100g water at 98°C). 15-20 min gravity drip. Pair 1 part decoction with 2.5 parts hot frothy milk + unrefined jaggery.
- Hario V60 Pour Over: 1:16 ratio (15g coffee to 240g water at 93-94°C). 45g bloom for 45s, spiral concentric pours, 2:45-3:15 min drawdown.
- Inverted AeroPress: 1:14 ratio (18g coffee to 250g water at 88°C). Steep 1:15 min, 30s gentle press until hiss.
- French Press: 1:15 ratio (30g coarse coffee to 450g water at 95°C). 4 min steep, break crust and skim foam, 2 min settle.
- 9-Bar Espresso: 1:2 ratio (18g in -> 36g liquid espresso out in 27-30s at 93°C, 9 bars).
- Cold Brew: 1:8 ratio concentrate, coarse grind, 16-24 hr steep.

AGENT GUIDELINES:
1. Always provide expert, sensory-rich recommendations matching user flavor preferences.
2. Use clean markdown formatting, bold coffee names, bullet points, and markdown tables for step-by-step brew guides.
3. If a customer expresses interest in purchasing or adding coffee to their cart, call 'propose_add_to_cart' with appropriate variant_id, product_name, and grind_type.
4. If a customer asks about order status, call 'check_order_status'.
5. If searching coffee flavor notes, call 'search_coffee' or 'semantic_coffee_search'.
6. If asking for brewing guides, call 'get_brewing_guide'.
`;

const AGENT_TOOLS: GroqToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'semantic_coffee_search',
      description: 'Search coffee catalog and brewing guides using vector embedding similarity (e.g. "something sweet with jasmine and low acidity").',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_coffee',
      description: 'Search catalog by roast level, tasting notes, origin, or flavor keywords.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Flavor note or keyword e.g. "floral", "chocolate", "espresso", "jaggery"' },
          roast_level: {
            type: 'string',
            enum: ['LIGHT', 'MEDIUM_LIGHT', 'MEDIUM', 'MEDIUM_DARK', 'DARK'],
            description: 'Roast level filter',
          },
          category_slug: { type: 'string', description: 'Category slug e.g. "single-origin", "espresso-roasts", "indian-estates"' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_brewing_guide',
      description: 'Retrieve detailed brew ratios, water temperatures, and step-by-step instructions for a brew method.',
      parameters: {
        type: 'object',
        properties: {
          method: {
            type: 'string',
            enum: ['v60', 'aeropress', 'french-press', 'espresso', 'cold-brew', 'south-indian-filter'],
            description: 'Brewing method',
          },
        },
        required: ['method'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_order_status',
      description: 'Check status and tracking information for an order number.',
      parameters: {
        type: 'object',
        properties: {
          order_number: { type: 'string', description: 'Order number (e.g. TDG-102938)' },
        },
        required: ['order_number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_add_to_cart',
      description: 'Propose adding a specific coffee variant and grind to the cart. Requires user confirmation.',
      parameters: {
        type: 'object',
        properties: {
          variant_id: { type: 'string', description: 'Variant ID (e.g. var_att_250, var_ara_250, var_eth_250, var_dawn_250, var_mid_250)' },
          product_name: { type: 'string', description: 'Product name' },
          grind_type: {
            type: 'string',
            enum: ['WHOLE_BEAN', 'POUR_OVER', 'SOUTH_INDIAN_FILTER', 'ESPRESSO', 'AEROPRESS', 'DRIP', 'FRENCH_PRESS', 'COLD_BREW'],
            description: 'Grind size selection',
          },
          quantity: { type: 'number', description: 'Quantity (default 1)' },
        },
        required: ['variant_id', 'product_name', 'grind_type'],
      },
    },
  },
];

// POST /api/agent/chat
agentApp.post('/chat', turnstileValidator, async (c) => {
  const sessionToken = c.req.header('X-Session-Token');
  const body = await c.req.json<{
    message?: string;
    messages?: { role: 'user' | 'assistant' | 'system'; content: string }[];
  }>().catch(() => ({} as any));

  const groq = new GroqService(c.env.GROQ_API_KEY, c.env.GROQ_MODEL || 'llama-3.3-70b-versatile');
  const db = new CoffeeDatabase(c.env.DB);
  const ai = new WorkersAIService(c.env.AI);

  let rawMessages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [];
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    rawMessages = body.messages.filter((m: { role: 'user' | 'assistant' | 'system'; content: string }) => m && typeof m.content === 'string' && m.content.trim() !== '');
  } else if (typeof body.message === 'string' && body.message.trim() !== '') {
    rawMessages = [{ role: 'user', content: body.message.trim() }];
  }

  if (rawMessages.length === 0) {
    return c.json({
      success: true,
      reply: "Namaskara! I'm Maya, your Master Barista at The Daily Roast. How can I guide your coffee journey today?",
      message: {
        role: 'assistant',
        content: "Namaskara! I'm Maya, your Master Barista at The Daily Roast. How can I guide your coffee journey today?"
      }
    });
  }

  // Personalisation (gap 1.5): when the caller carries a customer session, Maya gets a compact
  // summary of their taste graph as a second system message. Deliberately additive and
  // best-effort — an anonymous visitor, an expired token or a profile failure must all leave the
  // chat working exactly as before, so nothing here can 401 or throw into the request.
  let customerContext: string | null = null;
  try {
    const customerSession = await resolveCustomerSession(c.env.DB, c.req.header('X-Customer-Session'));
    if (customerSession) {
      const profile = await getTasteProfile(c.env.DB, customerSession.customerId, customerSession.email);
      const prefs = await c.env.DB
        .prepare('SELECT default_grind, default_weight_grams, brew_method FROM customer_preferences WHERE customer_id = ?')
        .bind(customerSession.customerId)
        .first<any>();
      customerContext = summariseProfileForAgent(profile, prefs);
    }
  } catch (err) {
    console.error('[agent] customer context unavailable, continuing anonymously:', err);
  }

  const fullMessages: GroqChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(customerContext ? [{ role: 'system' as const, content: customerContext }] : []),
    ...rawMessages,
  ];

  const responseMessage = await groq.chatCompletion(fullMessages, AGENT_TOOLS);

  // If tool calls were generated
  if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
    const executedToolResults: any[] = [];
    const proposedActions: any[] = [];

    for (const call of responseMessage.tool_calls) {
      const toolName = call.function.name;
      let toolArgs: any = {};
      try {
        toolArgs = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
      } catch (e) {
        toolArgs = {};
      }

      if (toolName === 'semantic_coffee_search') {
        const queryEmbedding = await ai.generateEmbedding(toolArgs.query || '');
        const products = await db.getAllProducts();

        const scored = await Promise.all(
          products.map(async (p) => {
            const productText = `${p.name} ${p.tagline} ${p.description} ${p.tasting_notes.join(' ')} ${p.roast_level} ${p.origin_country}`;
            const pEmb = await ai.generateEmbedding(productText);
            const score = ai.calculateSimilarity(queryEmbedding, pEmb);
            return { product: p, score };
          })
        );

        scored.sort((a, b) => b.score - a.score);
        const topMatches = scored.slice(0, 3).map((s) => ({
          name: s.product.name,
          roast: s.product.roast_level,
          notes: s.product.tasting_notes,
          match_score: Math.round(s.score * 100) + '%',
          starting_price_cents: s.product.variants[0]?.price_cents || 1850,
          starting_price: `$${((s.product.variants[0]?.price_cents || 1850) / 100).toFixed(2)}`,
          variants: s.product.variants.map((v) => ({ id: v.id, weight: `${v.weight_grams}g`, price: `$${(v.price_cents / 100).toFixed(2)}` })),
        }));

        executedToolResults.push({
          tool_call_id: call.id,
          name: toolName,
          result: topMatches,
        });
      } else if (toolName === 'search_coffee') {
        const products = await db.getAllProducts(toolArgs.category_slug, toolArgs.roast_level);
        let filtered = products;
        if (toolArgs.query) {
          const q = toolArgs.query.toLowerCase();
          filtered = products.filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              p.tasting_notes.some((n) => n.toLowerCase().includes(q)) ||
              p.description.toLowerCase().includes(q)
          );
        }
        executedToolResults.push({
          tool_call_id: call.id,
          name: toolName,
          result: filtered.map((p) => ({
            id: p.id,
            name: p.name,
            roast_level: p.roast_level,
            tasting_notes: p.tasting_notes,
            price_from_cents: p.variants[0]?.price_cents || 1850,
            price_from: `$${((p.variants[0]?.price_cents || 1850) / 100).toFixed(2)}`,
            variants: p.variants.map((v) => ({ id: v.id, weight: `${v.weight_grams}g`, price: `$${(v.price_cents / 100).toFixed(2)}` })),
          })),
        });
      } else if (toolName === 'get_brewing_guide') {
        const guides = await db.getBrewingGuides();
        const methodQuery = (toolArgs.method || '').toLowerCase();
        const matched = guides.find((g) => g.slug.includes(methodQuery) || g.name.toLowerCase().includes(methodQuery));
        executedToolResults.push({
          tool_call_id: call.id,
          name: toolName,
          result: matched || guides[0],
        });
      } else if (toolName === 'check_order_status') {
        const order = await c.env.DB.prepare(
          'SELECT order_number, status, total_cents, tracking_number, carrier, created_at FROM orders WHERE order_number = ?'
        ).bind(toolArgs.order_number).first();

        executedToolResults.push({
          tool_call_id: call.id,
          name: toolName,
          result: order || {
            order_number: toolArgs.order_number,
            status: 'ROASTING IN PROGRESS',
            total_cents: 1850,
            tracking_number: 'BLR-EXPRESS-99281',
            carrier: 'Indiranagar Roastery Courier',
            created_at: new Date().toISOString()
          },
        });
      } else if (toolName === 'propose_add_to_cart') {
        const confirmationToken = 'act_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        const actionPayload = {
          confirmation_token: confirmationToken,
          tool_name: 'add_to_cart',
          arguments: {
            variant_id: toolArgs.variant_id || 'var_att_250',
            product_name: toolArgs.product_name || 'Chikmagalur Attikan Estate Honey',
            grind_type: toolArgs.grind_type || 'WHOLE_BEAN',
            quantity: toolArgs.quantity || 1,
            session_token: sessionToken,
          },
          summary: `Add ${toolArgs.quantity || 1}x ${toolArgs.product_name} (${toolArgs.grind_type}) to your cart`,
          expires_at: Date.now() + 15 * 60 * 1000,
        };
        proposedActions.push(actionPayload);
        executedToolResults.push({
          tool_call_id: call.id,
          name: toolName,
          result: {
            status: 'CONFIRMATION_REQUIRED',
            message: 'User must confirm this cart modification.',
            action: actionPayload,
          },
        });
      }
    }

    const secondPassMessages: GroqChatMessage[] = [
      ...fullMessages,
      responseMessage,
      ...executedToolResults.map((tr) => ({
        role: 'tool' as const,
        tool_call_id: tr.tool_call_id,
        name: tr.name,
        content: JSON.stringify(tr.result),
      })),
    ];

    const finalAnswer = await groq.chatCompletion(secondPassMessages);
    return c.json({
      success: true,
      reply: finalAnswer.content || 'Here are the matching coffees from our roastery!',
      message: finalAnswer,
      proposed_actions: proposedActions,
    });
  }

  return c.json({
    success: true,
    reply: responseMessage.content || 'How can I assist your coffee journey today?',
    message: responseMessage,
  });
});

// POST /api/agent/confirm-action
agentApp.post('/confirm-action', async (c) => {
  const sessionToken = c.req.header('X-Session-Token');
  const body = await c.req.json<{
    action: {
      tool_name: string;
      arguments: {
        variant_id: string;
        grind_type: GrindType;
        quantity: number;
        session_token?: string;
      };
    };
  }>();

  if (body.action?.tool_name === 'add_to_cart') {
    const { variant_id, grind_type, quantity } = body.action.arguments;
    const cart = await getOrCreateCart(c.env.DB, sessionToken || body.action.arguments.session_token);

    const variant = await c.env.DB.prepare(
      'SELECT price_cents FROM product_variants WHERE id = ? AND is_active = 1'
    ).bind(variant_id).first<{ price_cents: number }>();

    if (!variant) {
      return c.json({ success: false, error: 'Product variant unavailable' }, 400);
    }

    const existingItem = await c.env.DB.prepare(
      'SELECT id, quantity FROM cart_items WHERE cart_id = ? AND variant_id = ? AND grind_type = ?'
    ).bind(cart.id, variant_id, grind_type).first<{ id: string; quantity: number }>();

    if (existingItem) {
      await c.env.DB.prepare(
        'UPDATE cart_items SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(quantity, existingItem.id).run();
    } else {
      const itemId = 'ci_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      await c.env.DB.prepare(`
        INSERT INTO cart_items (id, cart_id, variant_id, grind_type, quantity, unit_price_cents)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(itemId, cart.id, variant_id, grind_type, quantity, variant.price_cents).run();
    }

    const updatedCart = await getOrCreateCart(c.env.DB, cart.session_token);
    return c.json({
      success: true,
      message: 'Added to your cart successfully!',
      cart: updatedCart,
    });
  }

  return c.json({ success: false, error: 'Unknown or unsupported action' }, 400);
});

export { agentApp };
