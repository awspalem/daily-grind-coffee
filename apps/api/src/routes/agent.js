import { Hono } from 'hono';
import { GroqService } from '../services/groq';
import { CoffeeDatabase } from '@daily-grind/db';
import { getOrCreateCart } from './cart';
import { WorkersAIService } from '../services/workersAI';
import { turnstileValidator } from '../middleware/turnstile';
const agentApp = new Hono();
const SYSTEM_PROMPT = `
You are the master roaster and AI Barista for "The Daily Grind", an artisanal specialty coffee roastery.
Your personality is warm, knowledgeable, passionate about ethical sourcing, and precise about extraction.

Guidelines:
1. Recommend coffees from our curated catalog based on customer tastes (acidity, body, notes, roast levels).
2. Share precise brewing instructions, water-to-coffee ratios, and temperatures for V60, AeroPress, French Press, Espresso, and Cold Brew.
3. If a customer wants to purchase or add coffee to their cart, call the 'propose_add_to_cart' tool so they receive an interactive confirmation card. NEVER silently modify carts.
4. If a customer asks about their order, use 'check_order_status'.
5. Use 'semantic_coffee_search' to find matching flavour profiles or extraction guides using vector similarity.
6. Keep your tone engaging and formatted with clean bullet points and markdown.
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
                    query: { type: 'string', description: 'Flavor note or keyword e.g. "floral", "chocolate", "espresso"' },
                    roast_level: {
                        type: 'string',
                        enum: ['LIGHT', 'MEDIUM_LIGHT', 'MEDIUM', 'MEDIUM_DARK', 'DARK'],
                        description: 'Roast level filter',
                    },
                    category_slug: { type: 'string', description: 'Category slug e.g. "single-origin", "espresso-roasts"' },
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
                        enum: ['v60', 'aeropress', 'french-press', 'espresso', 'cold-brew'],
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
                    order_number: { type: 'string', description: 'Order number (e.g. TDG-123456)' },
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
                    variant_id: { type: 'string', description: 'Variant ID (e.g. var_eth_250)' },
                    product_name: { type: 'string', description: 'Product name' },
                    grind_type: {
                        type: 'string',
                        enum: ['WHOLE_BEAN', 'POUR_OVER', 'ESPRESSO', 'AEROPRESS', 'DRIP', 'FRENCH_PRESS', 'COLD_BREW'],
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
    const body = await c.req.json().catch(() => ({}));
    const groq = new GroqService(c.env.GROQ_API_KEY, c.env.GROQ_MODEL);
    const db = new CoffeeDatabase(c.env.DB);
    const ai = new WorkersAIService(c.env.AI);
    const incomingMessages = body.messages || (body.message ? [{ role: 'user', content: body.message }] : []);
    const fullMessages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...incomingMessages,
    ];
    const responseMessage = await groq.chatCompletion(fullMessages, AGENT_TOOLS);
    // If tool calls were generated
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        const executedToolResults = [];
        const proposedActions = [];
        for (const call of responseMessage.tool_calls) {
            const toolName = call.function.name;
            let toolArgs = {};
            try {
                toolArgs = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
            }
            catch (e) {
                toolArgs = {};
            }
            if (toolName === 'semantic_coffee_search') {
                const queryEmbedding = await ai.generateEmbedding(toolArgs.query);
                const products = await db.getAllProducts();
                const scored = await Promise.all(products.map(async (p) => {
                    const productText = `${p.name} ${p.tagline} ${p.description} ${p.tasting_notes.join(' ')} ${p.roast_level} ${p.origin_country}`;
                    const pEmb = await ai.generateEmbedding(productText);
                    const score = ai.calculateSimilarity(queryEmbedding, pEmb);
                    return { product: p, score };
                }));
                scored.sort((a, b) => b.score - a.score);
                const topMatches = scored.slice(0, 3).map((s) => ({
                    name: s.product.name,
                    roast: s.product.roast_level,
                    notes: s.product.tasting_notes,
                    match_score: Math.round(s.score * 100) + '%',
                    starting_price: `$${(s.product.variants[0]?.price_cents / 100).toFixed(2)}`,
                    variants: s.product.variants.map((v) => ({ id: v.id, weight: `${v.weight_grams}g`, price: `$${(v.price_cents / 100).toFixed(2)}` })),
                }));
                executedToolResults.push({
                    tool_call_id: call.id,
                    name: toolName,
                    result: topMatches,
                });
            }
            else if (toolName === 'search_coffee') {
                const products = await db.getAllProducts(toolArgs.category_slug, toolArgs.roast_level);
                let filtered = products;
                if (toolArgs.query) {
                    const q = toolArgs.query.toLowerCase();
                    filtered = products.filter((p) => p.name.toLowerCase().includes(q) ||
                        p.tasting_notes.some((n) => n.toLowerCase().includes(q)) ||
                        p.description.toLowerCase().includes(q));
                }
                executedToolResults.push({
                    tool_call_id: call.id,
                    name: toolName,
                    result: filtered.map((p) => ({
                        id: p.id,
                        name: p.name,
                        roast_level: p.roast_level,
                        tasting_notes: p.tasting_notes,
                        price_from: `$${(p.variants[0]?.price_cents / 100).toFixed(2)}`,
                        variants: p.variants.map((v) => ({ id: v.id, weight: `${v.weight_grams}g`, price: `$${(v.price_cents / 100).toFixed(2)}` })),
                    })),
                });
            }
            else if (toolName === 'get_brewing_guide') {
                const guides = await db.getBrewingGuides();
                const matched = guides.find((g) => g.slug.includes(toolArgs.method) || g.name.toLowerCase().includes(toolArgs.method));
                executedToolResults.push({
                    tool_call_id: call.id,
                    name: toolName,
                    result: matched || guides[0],
                });
            }
            else if (toolName === 'check_order_status') {
                const order = await c.env.DB.prepare('SELECT order_number, status, total_cents, tracking_number, carrier, created_at FROM orders WHERE order_number = ?').bind(toolArgs.order_number).first();
                executedToolResults.push({
                    tool_call_id: call.id,
                    name: toolName,
                    result: order || { error: 'No order found with that order number' },
                });
            }
            else if (toolName === 'propose_add_to_cart') {
                const confirmationToken = 'act_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
                const actionPayload = {
                    confirmation_token: confirmationToken,
                    tool_name: 'add_to_cart',
                    arguments: {
                        variant_id: toolArgs.variant_id,
                        product_name: toolArgs.product_name,
                        grind_type: toolArgs.grind_type,
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
    const body = await c.req.json();
    if (body.action?.tool_name === 'add_to_cart') {
        const { variant_id, grind_type, quantity } = body.action.arguments;
        const cart = await getOrCreateCart(c.env.DB, sessionToken || body.action.arguments.session_token);
        const variant = await c.env.DB.prepare('SELECT price_cents FROM product_variants WHERE id = ? AND is_active = 1').bind(variant_id).first();
        if (!variant) {
            return c.json({ success: false, error: 'Product variant unavailable' }, 400);
        }
        const existingItem = await c.env.DB.prepare('SELECT id, quantity FROM cart_items WHERE cart_id = ? AND variant_id = ? AND grind_type = ?').bind(cart.id, variant_id, grind_type).first();
        if (existingItem) {
            await c.env.DB.prepare('UPDATE cart_items SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(quantity, existingItem.id).run();
        }
        else {
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
