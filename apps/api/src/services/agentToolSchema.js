/**
 * Shared tool & capability schema for the Maya barista agent.
 *
 * The `AGENT_TOOLS` array in apps/api/src/routes/agent.ts is the source of truth that the
 * Groq chat endpoint passes to the model. It is intentionally not exported from that file
 * (it is implementation detail, and the route handler is wired around its closed-over form).
 *
 * The discovery endpoints on apps/api/src/routes/agentDiscovery.ts — MCP server card,
 * OpenAI Apps manifest, OpenAPI subset, tools list, JSON Schemas — need the same shape so
 * external agents can call Maya without reading the source. The block below is a deliberate
 * mirror of agent.ts's AGENT_TOOLS, kept in sync by hand:
 *
 *   - If you add or rename a tool in agent.ts, add or rename it here too.
 *   - If you change a parameter, mirror that here.
 *   - If you tighten an enum, mirror that here.
 *
 * Divergence is a correctness bug, not a style bug: an OpenAPI document that lists parameters
 * the runtime never accepted is worse than no document, because callers will send what the
 * schema says is valid and get a 4xx back. The two files must agree exactly.
 *
 * JSON Schema 2020-12 is the dialect — MCP's November 2025 specification made it the default,
 * and OpenAPI 3.1 also uses it, so the same `inputSchema` can be referenced from all three
 * discovery surfaces without translation.
 */
/** Public origin used by every static descriptor below. Pinned so discovery and runtime agree. */
export const AGENT_PUBLIC_ORIGIN = 'https://api.dailyroast.in';
/** Public storefront origin used by the static descriptors. */
export const STOREFRONT_PUBLIC_ORIGIN = 'https://dailyroast.in';
/** Semantic version of the agent. Bump on any change to the public descriptor shape. */
export const AGENT_VERSION = '1.0.0';
/** MCP protocol version this server speaks. Pinned to the November 2025 release line. */
export const MCP_PROTOCOL_VERSION = '2025-11-25';
/** Schemas referenced from multiple places. Extracted so the agent.ts mirror and discovery
 *  surface never disagree on an enum or default. */
export const GrindTypeSchema = {
    type: 'string',
    enum: [
        'WHOLE_BEAN',
        'POUR_OVER',
        'SOUTH_INDIAN_FILTER',
        'ESPRESSO',
        'AEROPRESS',
        'DRIP',
        'FRENCH_PRESS',
        'COLD_BREW',
    ],
    description: 'Grind size selection. Whole bean is the default for first-time customers.',
};
export const RoastLevelSchema = {
    type: 'string',
    enum: ['LIGHT', 'MEDIUM_LIGHT', 'MEDIUM', 'MEDIUM_DARK', 'DARK'],
    description: 'Roast level filter',
};
export const PUBLIC_AGENT_TOOLS = [
    {
        name: 'semantic_coffee_search',
        description: 'Search coffee catalog and brewing guides using vector embedding similarity (e.g. "something sweet with jasmine and low acidity").',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Natural language search query' },
            },
            required: ['query'],
            additionalProperties: false,
        },
        confirmationRequired: false,
    },
    {
        name: 'search_coffee',
        description: 'Search catalog by roast level, tasting notes, origin, or flavor keywords.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Flavor note or keyword e.g. "floral", "chocolate", "espresso", "jaggery"',
                },
                roast_level: RoastLevelSchema,
                category_slug: {
                    type: 'string',
                    description: 'Category slug e.g. "single-origin", "espresso-roasts", "indian-estates"',
                },
            },
            additionalProperties: false,
        },
        confirmationRequired: false,
    },
    {
        name: 'get_brewing_guide',
        description: 'Retrieve detailed brew ratios, water temperatures, and step-by-step instructions for a brew method.',
        inputSchema: {
            type: 'object',
            properties: {
                method: {
                    type: 'string',
                    enum: ['v60', 'aeropress', 'french-press', 'espresso', 'cold-brew', 'south-indian-filter'],
                    description: 'Brewing method',
                },
            },
            required: ['method'],
            additionalProperties: false,
        },
        confirmationRequired: false,
    },
    {
        name: 'check_order_status',
        description: 'Check status and tracking information for an order number.',
        inputSchema: {
            type: 'object',
            properties: {
                order_number: {
                    type: 'string',
                    description: 'Order number (e.g. TDG-102938)',
                },
            },
            required: ['order_number'],
            additionalProperties: false,
        },
        confirmationRequired: false,
    },
    {
        name: 'propose_add_to_cart',
        description: 'Propose adding a specific coffee variant and grind to the cart. Returns a confirmation token; the customer must confirm in the storefront before the cart is mutated.',
        inputSchema: {
            type: 'object',
            properties: {
                variant_id: {
                    type: 'string',
                    description: 'Variant ID (e.g. var_att_250, var_ara_250, var_eth_250, var_dawn_250, var_mid_250)',
                },
                product_name: { type: 'string', description: 'Product name' },
                grind_type: GrindTypeSchema,
                quantity: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 50,
                    default: 1,
                    description: 'Quantity (default 1)',
                },
                notes: {
                    type: 'string',
                    maxLength: 200,
                    description: 'Optional free-text note for the cart line (e.g. "gift wrap", "no filter papers"). ≤200 chars.',
                },
            },
            required: ['variant_id', 'product_name', 'grind_type'],
            additionalProperties: false,
        },
        confirmationRequired: true,
    },
    {
        name: 'get_subscription_status',
        description: "Look up the customer's active subscriptions: which coffee, frequency, next renewal date, and current status (ACTIVE / PAUSED / PAST_DUE / CANCELLED). Use this when the customer asks about their subscription, when the next delivery is, or whether a subscription is still running.",
        inputSchema: {
            type: 'object',
            properties: {
                subscription_id: {
                    type: 'string',
                    description: "Optional: a specific subscription id. Omit to list all of the caller's subscriptions.",
                },
            },
            additionalProperties: false,
        },
        confirmationRequired: false,
    },
    {
        name: 'get_loyalty_balance',
        description: "Look up the customer's current loyalty points balance, lifetime total, and tier. Use this when the customer asks how many points they have or what tier they are on.",
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
        confirmationRequired: false,
    },
    {
        name: 'get_recommendations',
        description: 'Get personalised coffee recommendations derived from the customer\'s purchase and review history. Use this when the customer asks for a recommendation, a "what should I try next" or "what do you think I\'d like" question, especially after they have ordered before.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 5,
                    default: 3,
                    description: 'Max number of recommendations to return (default 3, max 5).',
                },
            },
            additionalProperties: false,
        },
        confirmationRequired: false,
    },
    {
        name: 'propose_cancel_subscription',
        description: "Propose cancelling one of the customer's active subscriptions. Returns a confirmation token; the customer must confirm in the storefront before the subscription is cancelled. NEVER cancel without a real user request — every cancellation stops a future recurring charge and a future shipment.",
        inputSchema: {
            type: 'object',
            properties: {
                subscription_id: { type: 'string', description: 'The subscription id to cancel.' },
                product_name: {
                    type: 'string',
                    description: 'The coffee this subscription is for, shown on the confirmation card.',
                },
            },
            required: ['subscription_id', 'product_name'],
            additionalProperties: false,
        },
        confirmationRequired: true,
    },
];
/**
 * Convenience: the same tools in the Groq wire format. Kept in sync by construction — both
 * arrays are derived from PUBLIC_AGENT_TOOLS so a change to one cannot diverge from the other
 * silently. Used by code paths that need to feed Groq without importing agent.ts.
 */
export function publicToolsAsGroqDefinitions() {
    return PUBLIC_AGENT_TOOLS.map((t) => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
        },
    }));
}
