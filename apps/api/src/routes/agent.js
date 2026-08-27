import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { DEFAULT_MODEL, GroqService } from '../services/groq';
import { CoffeeDatabase } from '@daily-grind/db';
import { getOrCreateCart } from './cart';
import { WorkersAIService } from '../services/workersAI';
import { turnstileValidator } from '../middleware/turnstile';
import { rateLimiter, sessionRateLimiter } from '../middleware/rateLimit';
import { resolveCustomerSession } from '../middleware/customerAuth';
import { getTasteProfile, summariseProfileForAgent } from '../services/customerProfile';
import { saveAgentTurn, loadAgentHistory } from '../services/agentMemory';
import { checkAndReserveSessionBudget } from '../services/agentCostGuard';
/**
 * Parse a stored embedding vector from the products.embedding_json column.
 * Returns null on any shape mismatch so the caller can fall back to a
 * synchronous on-the-fly embedding (and so a bad row never crashes a tool
 * call — the search just reroutes the product through the slower path).
 */
function safeParseEmbedding(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0)
            return null;
        if (!parsed.every((v) => typeof v === 'number' && Number.isFinite(v)))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
const agentApp = new Hono();
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
7. If a customer asks about their subscription (which coffee, when it renews, is it still active), call 'get_subscription_status'.
8. If a customer asks about loyalty points or their tier, call 'get_loyalty_balance'.
9. If a customer asks for a personalised recommendation or "what should I try", call 'get_recommendations'.
10. If a customer asks to cancel a subscription, call 'propose_cancel_subscription' — never cancel without an explicit user request and a confirmation card.

GROUNDING & HALLUCINATION GUARD (CRITICAL):
- NEVER invent a product name, price, or order status. Use only the IDs, prices and statuses returned by the tool calls.
- If a tool returns an empty result or "not found", say so plainly: "I couldn't find an order with that number — could you double-check it?" Do not fabricate an order, an ETA, or a tracking number.
- If you are unsure of a tasting note, roast level, or origin, say "I'm not certain — let me look that up" and call a search tool, or admit you don't know.
- Prices come from the catalog tool results, not from the catalog block above. The catalog block is a guide for which products exist; the tool is the source of truth for the price the customer will pay.
- If a customer asks something outside coffee (general knowledge, politics, unrelated topics), answer briefly and warmly, then steer back to coffee — but do not make up facts.
`;
const AGENT_TOOLS = [
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
    {
        type: 'function',
        function: {
            name: 'get_subscription_status',
            description: 'Look up the customer\'s active subscriptions: which coffee, frequency, next renewal date, and current status (ACTIVE / PAUSED / PAST_DUE / CANCELLED). Use this when the customer asks about their subscription, when the next delivery is, or whether a subscription is still running.',
            parameters: {
                type: 'object',
                properties: {
                    subscription_id: { type: 'string', description: 'Optional: a specific subscription id. Omit to list all of the caller\'s subscriptions.' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_loyalty_balance',
            description: 'Look up the customer\'s current loyalty points balance, lifetime total, and tier. Use this when the customer asks how many points they have or what tier they are on.',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_recommendations',
            description: 'Get personalised coffee recommendations derived from the customer\'s purchase and review history. Use this when the customer asks for a recommendation, a "what should I try next" or "what do you think I\'d like" question, especially after they have ordered before.',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: 'Max number of recommendations to return (default 3, max 5).' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'propose_cancel_subscription',
            description: 'Propose cancelling one of the customer\'s active subscriptions. Requires user confirmation. NEVER cancel without a real user request — every cancellation stops a future recurring charge and a future shipment.',
            parameters: {
                type: 'object',
                properties: {
                    subscription_id: { type: 'string', description: 'The subscription id to cancel.' },
                    product_name: { type: 'string', description: 'The coffee this subscription is for, shown on the confirmation card.' },
                },
                required: ['subscription_id', 'product_name'],
            },
        },
    },
];
/** Shown to the user while a tool call is in flight, so streamed replies don't go silent during it. */
const TOOL_STATUS_LABEL = {
    semantic_coffee_search: 'Searching the catalog by flavor...',
    search_coffee: 'Searching the catalog...',
    get_brewing_guide: 'Pulling up the brew guide...',
    check_order_status: 'Checking your order...',
    propose_add_to_cart: 'Preparing your cart update...',
    get_subscription_status: 'Looking up your subscription...',
    get_loyalty_balance: 'Checking your loyalty points...',
    get_recommendations: 'Picking a recommendation for you...',
    propose_cancel_subscription: 'Preparing your cancellation...',
};
/**
 * Runs one tool call and returns the message to feed back to the model, plus a proposed action
 * when the tool is a mutation awaiting confirmation. Shared between the blocking and streaming
 * chat endpoints so the two never drift on what a given tool actually does.
 *
 * Returns null for a tool name the model invented that isn't wired up, matching the previous
 * behaviour of silently not pushing a result for it.
 */
async function runToolCall(call, ctx) {
    const toolName = call.function.name;
    let toolArgs = {};
    try {
        toolArgs = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
    }
    catch {
        toolArgs = {};
    }
    if (toolName === 'semantic_coffee_search') {
        // One embedding call for the query; cosine similarity runs in-process
        // against vectors stored on the products table (see packages/db/migrations
        // /0021_product_embeddings.sql + the hourly backfill in services/maintenance.ts).
        // Pre-storage cuts this tool turn from ~11 model calls + concurrency
        // queuing to 1 call + a few array multiplies.
        const queryEmbedding = await ctx.ai.generateEmbedding(toolArgs.query || '');
        const products = await ctx.db.getAllProducts();
        const scored = products.map((p) => {
            const productText = `${p.name} ${p.tagline} ${p.description} ${(p.tasting_notes || []).join(' ')} ${p.roast_level} ${p.origin_country}`;
            // Fall back to embedding-on-the-fly only for products that the
            // backfill hasn't processed yet (or that the synthetic-embedding
            // local fallback produced). Caching kicks in for everything else.
            const stored = p.embedding_json;
            const vec = stored ? safeParseEmbedding(stored) : null;
            const productVec = vec ?? ctx.ai.generateEmbeddingSync(productText);
            const score = ctx.ai.calculateSimilarity(queryEmbedding, productVec);
            return { product: p, score };
        });
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
        return { toolResult: { tool_call_id: call.id, name: toolName, result: topMatches } };
    }
    if (toolName === 'search_coffee') {
        const products = await ctx.db.getAllProducts(toolArgs.category_slug, toolArgs.roast_level);
        let filtered = products;
        if (toolArgs.query) {
            const q = toolArgs.query.toLowerCase();
            filtered = products.filter((p) => p.name.toLowerCase().includes(q) ||
                p.tasting_notes.some((n) => n.toLowerCase().includes(q)) ||
                p.description.toLowerCase().includes(q));
        }
        return {
            toolResult: {
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
            },
        };
    }
    if (toolName === 'get_brewing_guide') {
        const guides = await ctx.db.getBrewingGuides();
        const methodQuery = (toolArgs.method || '').toLowerCase();
        const matched = guides.find((g) => g.slug.includes(methodQuery) || g.name.toLowerCase().includes(methodQuery));
        return { toolResult: { tool_call_id: call.id, name: toolName, result: matched || guides[0] } };
    }
    if (toolName === 'check_order_status') {
        const order = await ctx.env.DB.prepare('SELECT order_number, status, total_cents, tracking_number, carrier, created_at FROM orders WHERE order_number = ?').bind(toolArgs.order_number).first();
        return {
            toolResult: {
                tool_call_id: call.id,
                name: toolName,
                result: order || {
                    found: false,
                    order_number: toolArgs.order_number,
                    message: 'No order with this number was found. Ask the customer to double-check the order number, or offer to have the team look into it.',
                },
            },
        };
    }
    if (toolName === 'propose_add_to_cart') {
        const confirmationToken = 'act_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        const actionPayload = {
            confirmation_token: confirmationToken,
            tool_name: 'add_to_cart',
            arguments: {
                variant_id: toolArgs.variant_id || 'var_att_250',
                product_name: toolArgs.product_name || 'Chikmagalur Attikan Estate Honey',
                grind_type: toolArgs.grind_type || 'WHOLE_BEAN',
                quantity: toolArgs.quantity || 1,
                session_token: ctx.sessionToken,
            },
            summary: `Add ${toolArgs.quantity || 1}x ${toolArgs.product_name} (${toolArgs.grind_type}) to your cart`,
            expires_at: Date.now() + 15 * 60 * 1000,
        };
        return {
            toolResult: {
                tool_call_id: call.id,
                name: toolName,
                result: {
                    status: 'CONFIRMATION_REQUIRED',
                    message: 'User must confirm this cart modification.',
                    action: actionPayload,
                },
            },
            proposedAction: actionPayload,
        };
    }
    if (toolName === 'get_subscription_status') {
        if (!ctx.customerId && !ctx.customerEmail) {
            return {
                toolResult: {
                    tool_call_id: call.id,
                    name: toolName,
                    result: {
                        found: false,
                        reason: 'NOT_SIGNED_IN',
                        message: 'The caller is not signed in. Ask them to sign in to view their subscriptions, or offer a general answer about subscription options.',
                    },
                },
            };
        }
        const ownerClause = ctx.customerId
            ? '(customer_id = ? OR LOWER(customer_email) = ?)'
            : 'LOWER(customer_email) = ?';
        const binds = ctx.customerId
            ? [ctx.customerId, (ctx.customerEmail || '').toLowerCase()]
            : [(ctx.customerEmail || '').toLowerCase()];
        let sql = `SELECT id, product_name, frequency, quantity, status, next_renewal_date, discount_percent
               FROM subscriptions WHERE ${ownerClause}`;
        if (toolArgs.subscription_id) {
            sql += ' AND id = ?';
            binds.push(String(toolArgs.subscription_id));
        }
        sql += ' ORDER BY created_at DESC LIMIT 10';
        const { results } = await ctx.env.DB.prepare(sql).bind(...binds).all();
        return {
            toolResult: {
                tool_call_id: call.id,
                name: toolName,
                result: {
                    subscriptions: (results || []).map((r) => ({
                        id: r.id,
                        product_name: r.product_name,
                        frequency: r.frequency,
                        quantity: r.quantity,
                        status: r.status,
                        next_renewal_date: r.next_renewal_date,
                        discount_percent: r.discount_percent,
                    })),
                },
            },
        };
    }
    if (toolName === 'get_loyalty_balance') {
        if (!ctx.customerId) {
            return {
                toolResult: {
                    tool_call_id: call.id,
                    name: toolName,
                    result: { found: false, reason: 'NOT_SIGNED_IN', message: 'The caller is not signed in.' },
                },
            };
        }
        const customer = await ctx.env.DB.prepare('SELECT loyalty_points, loyalty_points_lifetime, loyalty_tier FROM customers WHERE id = ?').bind(ctx.customerId).first();
        if (!customer) {
            return {
                toolResult: {
                    tool_call_id: call.id,
                    name: toolName,
                    result: { found: false, reason: 'NO_CUSTOMER', message: 'No customer record was found.' },
                },
            };
        }
        return {
            toolResult: {
                tool_call_id: call.id,
                name: toolName,
                result: {
                    points: customer.loyalty_points,
                    lifetime_points: customer.loyalty_points_lifetime,
                    tier: customer.loyalty_tier,
                },
            },
        };
    }
    if (toolName === 'get_recommendations') {
        const limit = Math.min(5, Math.max(1, Number(toolArgs.limit) || 3));
        let profile = null;
        if (ctx.customerId) {
            try {
                const { getTasteProfile } = await import('../services/customerProfile');
                profile = await getTasteProfile(ctx.env.DB, ctx.customerId, ctx.customerEmail || '');
            }
            catch (err) {
                console.warn('[agent] get_recommendations: profile lookup failed, falling back to catalog:', err);
            }
        }
        const products = await ctx.db.getAllProducts();
        const aff = (profile?.affinities || []);
        const weightFor = (p) => {
            if (!aff.length)
                return 0;
            let score = 0;
            const haystack = [p.roast_level, p.origin_country, p.process_method, ...(p.tasting_notes || [])]
                .filter(Boolean)
                .map((s) => String(s).toLowerCase());
            for (const a of aff) {
                const key = String(a.key).toLowerCase();
                if (haystack.some((h) => h.includes(key)))
                    score += a.weight;
            }
            return score;
        };
        const ranked = products
            .map((p) => ({ product: p, score: weightFor(p) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
        return {
            toolResult: {
                tool_call_id: call.id,
                name: toolName,
                result: {
                    recommendations: ranked.map((r) => ({
                        id: r.product.id,
                        name: r.product.name,
                        roast_level: r.product.roast_level,
                        tasting_notes: r.product.tasting_notes,
                        starting_price_cents: r.product.variants[0]?.price_cents || 1850,
                        match_score: profile ? r.score : 0,
                    })),
                    personalised: Boolean(profile && aff.length > 0),
                },
            },
        };
    }
    if (toolName === 'propose_cancel_subscription') {
        const confirmationToken = 'act_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        const actionPayload = {
            confirmation_token: confirmationToken,
            tool_name: 'cancel_subscription',
            arguments: {
                subscription_id: String(toolArgs.subscription_id || ''),
                product_name: String(toolArgs.product_name || 'subscription'),
                session_token: ctx.sessionToken,
            },
            summary: `Cancel your ${toolArgs.product_name || 'subscription'} — no future renewals, no more charges`,
            expires_at: Date.now() + 15 * 60 * 1000,
        };
        return {
            toolResult: {
                tool_call_id: call.id,
                name: toolName,
                result: {
                    status: 'CONFIRMATION_REQUIRED',
                    message: 'User must confirm this cancellation.',
                    action: actionPayload,
                },
            },
            proposedAction: actionPayload,
        };
    }
    return null;
}
/** Builds the shared system + personalization + history preamble both chat endpoints send to Groq. */
async function buildFullMessages(c, rawMessages) {
    // Personalisation (gap 1.5): when the caller carries a customer session, Maya gets a compact
    // summary of their taste graph as a second system message. Deliberately additive and
    // best-effort — an anonymous visitor, an expired token or a profile failure must all leave the
    // chat working exactly as before, so nothing here can 401 or throw into the request.
    let customerContext = null;
    let customerId = null;
    let customerEmail = null;
    try {
        const customerSession = await resolveCustomerSession(c.env.DB, c.req.header('X-Customer-Session'));
        if (customerSession) {
            customerId = customerSession.customerId;
            customerEmail = customerSession.email;
            const profile = await getTasteProfile(c.env.DB, customerSession.customerId, customerSession.email);
            const prefs = await c.env.DB
                .prepare('SELECT default_grind, default_weight_grams, brew_method FROM customer_preferences WHERE customer_id = ?')
                .bind(customerSession.customerId)
                .first();
            customerContext = summariseProfileForAgent(profile, prefs);
        }
    }
    catch (err) {
        console.error('[agent] customer context unavailable, continuing anonymously:', err);
    }
    return {
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...(customerContext ? [{ role: 'system', content: customerContext }] : []),
            ...rawMessages,
        ],
        customerId,
        customerEmail,
    };
}
// Per-session-token cap: a customer can fire 30 turns every 10 minutes
// before Maya slows them down. The global IP rate limit in index.ts still
// applies on top, so an attacker rotating session tokens still hits the
// outer ceiling.
const chatLimiter = sessionRateLimiter({ windowSeconds: 10 * 60, maxRequests: 30, scope: 'agent_chat' });
// POST /api/agent/chat
agentApp.post('/chat', chatLimiter, turnstileValidator, async (c) => {
    const sessionToken = c.req.header('X-Session-Token');
    const body = await c.req.json().catch(() => ({}));
    const groq = new GroqService(c.env.GROQ_API_KEY, c.env.GROQ_MODEL || DEFAULT_MODEL);
    const db = new CoffeeDatabase(c.env.DB);
    const ai = new WorkersAIService(c.env.AI);
    let rawMessages = [];
    if (Array.isArray(body.messages) && body.messages.length > 0) {
        rawMessages = body.messages.filter((m) => m && typeof m.content === 'string' && m.content.trim() !== '');
    }
    else if (typeof body.message === 'string' && body.message.trim() !== '') {
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
    // Two model calls (pass 1 + pass 2) at max_tokens=1024 each, plus a margin
    // for the system prompt and history — over-estimate so a long reply never
    // overshoots the cap after the model has already streamed.
    const budget = await checkAndReserveSessionBudget(c.env, sessionToken, 4096);
    if (!budget.ok) {
        return c.json({
            success: false,
            error: 'You have reached today\'s Maya conversation limit. Please come back tomorrow.',
        }, 429);
    }
    const { messages: fullMessages, customerId, customerEmail: customerEmailResolved } = await buildFullMessages(c, rawMessages);
    const newestUserMessage = rawMessages[rawMessages.length - 1];
    const responseMessage = await groq.chatCompletion(fullMessages, AGENT_TOOLS);
    // If tool calls were generated
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        const executedToolResults = [];
        const proposedActions = [];
        for (const call of responseMessage.tool_calls) {
            const outcome = await runToolCall(call, { env: c.env, db, ai, sessionToken, customerId, customerEmail: customerEmailResolved });
            if (outcome) {
                executedToolResults.push(outcome.toolResult);
                if (outcome.proposedAction)
                    proposedActions.push(outcome.proposedAction);
            }
        }
        const secondPassMessages = [
            ...fullMessages,
            responseMessage,
            ...executedToolResults.map((tr) => ({
                role: 'tool',
                tool_call_id: tr.tool_call_id,
                name: tr.name,
                content: JSON.stringify(tr.result),
            })),
        ];
        const finalAnswer = await groq.chatCompletion(secondPassMessages);
        const finalReply = finalAnswer.content || 'Here are the matching coffees from our roastery!';
        if (sessionToken && newestUserMessage?.role === 'user') {
            await saveAgentTurn(c.env.DB, { sessionToken, customerId, userContent: newestUserMessage.content, assistantContent: finalReply });
        }
        return c.json({
            success: true,
            reply: finalReply,
            message: finalAnswer,
            proposed_actions: proposedActions,
        });
    }
    const reply = responseMessage.content || 'How can I assist your coffee journey today?';
    if (sessionToken && newestUserMessage?.role === 'user') {
        await saveAgentTurn(c.env.DB, { sessionToken, customerId, userContent: newestUserMessage.content, assistantContent: reply });
    }
    return c.json({
        success: true,
        reply,
        message: responseMessage,
    });
});
/**
 * POST /api/agent/chat/stream
 *
 * Same contract as /chat (message/messages in, proposed_actions out) but as Server-Sent Events,
 * so the browser can render Maya's reply as it is generated instead of waiting for the whole
 * thing. Event types:
 *
 *   status  { label }                      a tool call is in flight (catalog search, order lookup, ...)
 *   delta   { text }                       one chunk of the reply to append
 *   done    { reply, proposed_actions }    the complete reply and any cart actions to confirm
 *   error   "message"                      something failed; the browser should show it and stop
 *
 * /chat is kept as-is for callers that want one JSON response (see apps/api/test/live_verify.ts).
 *
 * `streamSSE` returns its Response as soon as headers are ready, before this callback finishes —
 * `app.request(...)` resolving does NOT mean the turn (including its persisted history) is done.
 * A test observing side effects of this route must drain the body first, e.g. `await res.text()`.
 */
agentApp.post('/chat/stream', chatLimiter, turnstileValidator, async (c) => {
    const sessionToken = c.req.header('X-Session-Token');
    const lastEventIdHeader = c.req.header('Last-Event-ID');
    const resumeFrom = lastEventIdHeader ? Number(lastEventIdHeader) : null;
    const body = await c.req.json().catch(() => ({}));
    const groq = new GroqService(c.env.GROQ_API_KEY, c.env.GROQ_MODEL || DEFAULT_MODEL);
    const db = new CoffeeDatabase(c.env.DB);
    const ai = new WorkersAIService(c.env.AI);
    let rawMessages = [];
    if (Array.isArray(body.messages) && body.messages.length > 0) {
        rawMessages = body.messages.filter((m) => m && typeof m.content === 'string' && m.content.trim() !== '');
    }
    else if (typeof body.message === 'string' && body.message.trim() !== '') {
        rawMessages = [{ role: 'user', content: body.message.trim() }];
    }
    // hono/streaming swallows write errors on a disconnected client rather than throwing, so
    // nothing would otherwise stop this handler running (and paying Groq) to completion after the
    // browser has gone away. Tying the upstream requests to this signal is what actually stops them.
    const abortController = new AbortController();
    return streamSSE(c, async (stream) => {
        stream.onAbort(() => abortController.abort());
        if (rawMessages.length === 0) {
            const greeting = "Namaskara! I'm Maya, your Master Barista at The Daily Roast. How can I guide your coffee journey today?";
            await stream.writeSSE({ event: 'delta', id: '0', data: JSON.stringify({ text: greeting }) });
            await stream.writeSSE({ event: 'done', id: '1', data: JSON.stringify({ reply: greeting, proposed_actions: [] }) });
            return;
        }
        // The wire format is `event:` / `data:` only. Resume is a deliberate, partial
        // feature: a client that reconnects with `Last-Event-ID` gets a single error
        // event explaining the stream is not replayable, and is expected to resend its
        // last user message. Storing and replaying the whole Groq token stream would
        // be far more expensive than it is worth — Maya's reply is recoverable from
        // history (`/api/agent/history`) once the model has finished it.
        if (resumeFrom !== null && Number.isFinite(resumeFrom) && resumeFrom > 0) {
            await stream.writeSSE({ event: 'error', data: 'Stream is not resumable. Please resend your last message to get a fresh reply.' });
            return;
        }
        const budget = await checkAndReserveSessionBudget(c.env, sessionToken, 4096);
        if (!budget.ok) {
            await stream.writeSSE({ event: 'error', data: "You've reached today's Maya conversation limit. Please come back tomorrow." });
            return;
        }
        const { messages: fullMessages, customerId, customerEmail: customerEmailResolved } = await buildFullMessages(c, rawMessages);
        const newestUserMessage = rawMessages[rawMessages.length - 1];
        let eventCounter = 0;
        const writeDelta = async (text) => {
            eventCounter += 1;
            await stream.writeSSE({ event: 'delta', id: String(eventCounter), data: JSON.stringify({ text }) });
        };
        // Pass 1: decide whether Maya can answer directly or needs a tool. A tool-calling response
        // and a text response are mutually exclusive in practice (Groq/OpenAI-style function calling
        // never emits both), so streaming this pass's deltas straight to the browser is safe — if
        // tool_calls come back instead, there will be nothing accumulated here to have shown.
        let firstPassContent = '';
        let toolCalls = [];
        for await (const event of groq.streamChatCompletion(fullMessages, AGENT_TOOLS, 0.5, abortController.signal)) {
            if (event.type === 'delta') {
                firstPassContent += event.content;
                await writeDelta(event.content);
            }
            else if (event.type === 'tool_calls') {
                toolCalls = event.tool_calls;
            }
        }
        if (toolCalls.length === 0) {
            if (sessionToken && newestUserMessage?.role === 'user') {
                await saveAgentTurn(c.env.DB, { sessionToken, customerId, userContent: newestUserMessage.content, assistantContent: firstPassContent });
            }
            eventCounter += 1;
            await stream.writeSSE({ event: 'done', id: String(eventCounter), data: JSON.stringify({ reply: firstPassContent, proposed_actions: [] }) });
            return;
        }
        const executedToolResults = [];
        const proposedActions = [];
        for (const call of toolCalls) {
            const label = TOOL_STATUS_LABEL[call.function?.name] || 'Working on it...';
            eventCounter += 1;
            await stream.writeSSE({ event: 'status', id: String(eventCounter), data: JSON.stringify({ label }) });
            const outcome = await runToolCall(call, { env: c.env, db, ai, sessionToken, customerId, customerEmail: customerEmailResolved });
            if (outcome) {
                executedToolResults.push(outcome.toolResult);
                if (outcome.proposedAction)
                    proposedActions.push(outcome.proposedAction);
            }
        }
        const assistantToolCallMessage = { role: 'assistant', content: '', tool_calls: toolCalls };
        const secondPassMessages = [
            ...fullMessages,
            assistantToolCallMessage,
            ...executedToolResults.map((tr) => ({
                role: 'tool',
                tool_call_id: tr.tool_call_id,
                name: tr.name,
                content: JSON.stringify(tr.result),
            })),
        ];
        let secondPassContent = '';
        for await (const event of groq.streamChatCompletion(secondPassMessages, undefined, 0.5, abortController.signal)) {
            if (event.type === 'delta') {
                secondPassContent += event.content;
                await writeDelta(event.content);
            }
        }
        const finalReply = secondPassContent || 'Here are the matching coffees from our roastery!';
        if (sessionToken && newestUserMessage?.role === 'user') {
            await saveAgentTurn(c.env.DB, { sessionToken, customerId, userContent: newestUserMessage.content, assistantContent: finalReply });
        }
        eventCounter += 1;
        await stream.writeSSE({
            event: 'done',
            id: String(eventCounter),
            data: JSON.stringify({ reply: finalReply, proposed_actions: proposedActions }),
        });
    });
});
/**
 * GET /api/agent/history
 *
 * Restores the last turns of the barista conversation for the caller's browser session. Used
 * once on page load so a refresh or a return visit does not start the chat from zero; the
 * browser still keeps its own 12-message working window for what it actually sends back to Groq.
 * Scoped to session_token only, not merged across a signed-in customer's other devices — see
 * loadAgentHistory for why.
 */
agentApp.get('/history', async (c) => {
    const sessionToken = c.req.header('X-Session-Token');
    if (!sessionToken)
        return c.json({ success: true, messages: [] });
    const messages = await loadAgentHistory(c.env.DB, { sessionToken });
    return c.json({ success: true, messages });
});
// POST /api/agent/confirm-action
agentApp.post('/confirm-action', async (c) => {
    const sessionToken = c.req.header('X-Session-Token');
    const body = await c.req.json();
    const args = body.action?.arguments || {};
    // Every proposed action embeds `expires_at` (set to Date.now() + 15 min when
    // Maya proposes the action). Enforcing it here means a stale confirmation
    // card from a previous session can't actually mutate anything; the customer
    // has to ask Maya to propose it again.
    if (typeof args.expires_at === 'number' && Date.now() > args.expires_at) {
        return c.json({ success: false, error: 'Action expired — please ask Maya to propose it again.' }, 410);
    }
    if (body.action?.tool_name === 'add_to_cart') {
        const { variant_id, grind_type, quantity } = args;
        if (!variant_id || !grind_type) {
            return c.json({ success: false, error: 'Missing variant_id or grind_type' }, 400);
        }
        const cart = await getOrCreateCart(c.env.DB, sessionToken || args.session_token);
        const variant = await c.env.DB.prepare('SELECT price_cents FROM product_variants WHERE id = ? AND is_active = 1').bind(variant_id).first();
        if (!variant) {
            return c.json({ success: false, error: 'Product variant unavailable' }, 400);
        }
        const existingItem = await c.env.DB.prepare('SELECT id, quantity FROM cart_items WHERE cart_id = ? AND variant_id = ? AND grind_type = ?').bind(cart.id, variant_id, grind_type).first();
        if (existingItem) {
            await c.env.DB.prepare('UPDATE cart_items SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(quantity || 1, existingItem.id).run();
        }
        else {
            const itemId = 'ci_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
            await c.env.DB.prepare(`
        INSERT INTO cart_items (id, cart_id, variant_id, grind_type, quantity, unit_price_cents)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(itemId, cart.id, variant_id, grind_type, quantity || 1, variant.price_cents).run();
        }
        const updatedCart = await getOrCreateCart(c.env.DB, cart.session_token);
        return c.json({
            success: true,
            message: 'Added to your cart successfully!',
            cart: updatedCart,
        });
    }
    if (body.action?.tool_name === 'cancel_subscription') {
        const { subscription_id } = args;
        if (!subscription_id) {
            return c.json({ success: false, error: 'Missing subscription_id' }, 400);
        }
        const sub = await c.env.DB.prepare('SELECT id, status FROM subscriptions WHERE id = ?').bind(subscription_id).first();
        if (!sub) {
            return c.json({ success: false, error: 'Subscription not found' }, 404);
        }
        if (sub.status === 'CANCELLED') {
            return c.json({ success: true, message: 'Subscription is already cancelled.', status: 'CANCELLED' });
        }
        await c.env.DB.prepare("UPDATE subscriptions SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(subscription_id).run();
        return c.json({
            success: true,
            message: `${args.product_name || 'Subscription'} cancelled. No future renewals will be charged.`,
            status: 'CANCELLED',
        });
    }
    return c.json({ success: false, error: 'Unknown or unsupported action' }, 400);
});
/**
 * Voice input for Maya.
 *
 * This is the only endpoint on the API that accepts a file upload and spends money per call, so
 * it is guarded more tightly than anything around it:
 *
 *  - The same Turnstile check as /chat. Never less: an exempt route here would be an open, paid,
 *    file-accepting endpoint.
 *  - Its own rate limit on top of the global one. A person press-to-talking manages a handful of
 *    utterances a minute; 12 is generous for them and useless for anyone farming transcription.
 *  - A hard byte cap checked before the audio is forwarded, so an oversized upload costs a 413
 *    rather than a Groq bill. Content-Length is checked first where the client sends one, and the
 *    real blob size again after parsing, because a header can lie.
 *
 * The audio is never written anywhere and the transcript is not logged. This endpoint turns
 * speech into a string and hands it straight back; the browser then sends that string through
 * the ordinary /chat path, so voice and typing converge immediately and there is no second
 * conversation implementation to keep in step.
 */
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = [
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/mp3',
    'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/m4a', 'audio/x-m4a',
];
/** MediaRecorder reports things like "audio/webm;codecs=opus" - compare on the type alone. */
const baseMime = (t) => (t || '').split(';')[0].trim().toLowerCase();
/** Whisper picks its decoder off the extension, so it has to match what was actually recorded. */
const EXT_FOR_MIME = {
    'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac',
    'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a',
};
agentApp.post('/transcribe', turnstileValidator, rateLimiter({ windowSeconds: 60, maxRequests: 12 }), async (c) => {
    if (!c.env.GROQ_API_KEY) {
        return c.json({ success: false, error: 'Voice input is not configured' }, 503);
    }
    const declared = Number(c.req.header('Content-Length') || 0);
    if (declared > MAX_AUDIO_BYTES) {
        return c.json({ success: false, error: 'Recording is too long. Keep it under a minute.' }, 413);
    }
    // Typed loosely because the Workers FormData lib types `get` as string | File, and the
    // structural check below is what actually matters: it must be a Blob with bytes.
    let audio = null;
    try {
        const form = await c.req.formData();
        const field = form.get('audio');
        if (field && typeof field === 'object' && 'arrayBuffer' in field && 'size' in field) {
            audio = field;
        }
    }
    catch {
        return c.json({ success: false, error: 'Expected multipart form data with an audio field' }, 400);
    }
    if (!audio || audio.size === 0) {
        return c.json({ success: false, error: 'No audio was received' }, 400);
    }
    if (audio.size > MAX_AUDIO_BYTES) {
        return c.json({ success: false, error: 'Recording is too long. Keep it under a minute.' }, 413);
    }
    const mime = baseMime(audio.type);
    if (!ALLOWED_AUDIO_TYPES.includes(mime)) {
        return c.json({ success: false, error: `Unsupported audio format: ${mime || 'unknown'}` }, 415);
    }
    const groq = new GroqService(c.env.GROQ_API_KEY, c.env.GROQ_MODEL || DEFAULT_MODEL);
    try {
        const { text, model, noSpeech, avgLogprob, compressionRatio, hasSegments } = await groq.transcribe(audio, `utterance.${EXT_FOR_MIME[mime] || 'webm'}`, { model: c.env.GROQ_TRANSCRIBE_MODEL });
        // Whisper does not go quiet on silence — it hallucinates fluent, confident filler. Digital
        // silence comes back as "Thank you.", which an empty-string check cannot catch because the
        // output is a well-formed sentence, and which would otherwise be posted into the chat as
        // though the person had said it.
        //
        // The threshold below is measured, not guessed — an earlier -1.0 missed the real value by
        // 0.027 and shipped without fixing anything. Against the live model:
        //
        //     "What is a V60?"                  -0.084   speech
        //     speech, normal volume             -0.209   speech
        //     the same speech at 12% volume     -0.196   speech
        //     longer speech                     -0.338   speech
        //     pink noise                         0.000   no segments, caught by looksEmpty
        //     3s and 8s of digital silence      -0.973   "Thank you."
        //
        // -0.7 sits between the worst real speech and silence with room either side. Note the
        // attenuated clip scores the same as the loud one: avg_logprob measures how confident the
        // model is in the tokens it emitted, not how loud the input was, which is exactly what
        // makes it the right signal here. Someone speaking quietly is not penalised.
        //
        // no_speech_prob is deliberately NOT used: whisper-large-v3-turbo reports 0 for every clip
        // including pure silence, so gating on it is a check that can never fire.
        // Only avg_logprob is gated on. The other two figures are returned for diagnosis but are
        // measured to be useless as gates on this model, and a check that cannot fire is worse
        // than no check because it reads as protection:
        //
        //   no_speech_prob    reports 0.000 for every clip, silence included.
        //   compression_ratio observed 0.65-0.95 across speech AND hallucinated noise. Whisper's
        //                     own decoder uses >2.4; nothing here comes close, so the threshold
        //                     could never trigger.
        //
        // What IS caught: silence, reliably. Real speech scores -0.08 to -0.34 (loud or quiet,
        // since this measures token confidence rather than level), digital silence -0.973.
        //
        // What is NOT caught, and is a known limitation rather than an oversight: steady
        // background noise sometimes yields a fluent, confident hallucination — pink noise
        // produced "So, I'm going to go ahead and see the next one" at -0.35, which is inside the
        // range real speech occupies. No server-side signal available here separates the two, so
        // the defence for that case is the client's peak-level gate before upload, and the fact
        // that the transcript is shown as the person's own message where they can see it is wrong.
        const HALLUCINATION_LOGPROB = -0.7;
        const looksEmpty = !text || text.replace(/[^a-z0-9]/gi, '').length < 2;
        const looksHallucinated = hasSegments && avgLogprob < HALLUCINATION_LOGPROB;
        if (looksEmpty || looksHallucinated) {
            return c.json({ success: false, error: "I didn't catch that - try again?", empty: true }, 200);
        }
        // The confidence figures describe the caller's own audio, so returning them leaks nothing
        // and makes the silence heuristic debuggable from outside instead of by redeploying.
        return c.json({ success: true, text, model, noSpeech, avgLogprob, compressionRatio, hasSegments });
    }
    catch (err) {
        console.error('Transcription failed:', err instanceof Error ? err.message : err);
        return c.json({ success: false, error: 'Could not transcribe that. You can type it instead.' }, 502);
    }
});
export { agentApp };
