/**
 * Agent-protocol discovery endpoints for Maya, the AI barista.
 *
 * This module is the public, machine-readable face of the agent. It exposes five surfaces that
 * other agents (Anthropic's MCP clients, OpenAI's Apps SDK, LangChain, custom-built bots) can
 * read to discover what Maya is, what she can do, and how to call her:
 *
 *   GET  /api/agent/card                  — Anthropic "Skills" / A2A-style agent card (static)
 *   GET  /api/agent/manifest.json         — OpenAI Apps SDK manifest (static)
 *   GET  /api/agent/openapi.json          — OpenAPI 3.1 subset for the chat endpoints (static)
 *   GET  /api/agent/tools                 — list of public tools (name + description + schema URL)
 *   GET  /api/agent/tools/:name/schema.json — JSON Schema 2020-12 for one tool's input
 *   GET  /.well-known/mcp.json            — Anthropic MCP server descriptor (static)
 *
 * The six descriptors are static JSON, served with permissive CORS and a one-hour
 * `Cache-Control`. That is deliberate: MCP discovery is a `GET` probe clients run before
 * they connect, and the right answer to "how often should they poll?" is "as often as your
 * capabilities change", not "every chat turn". 3600s gives clients room to cache without
 * pinning the descriptor to a version that quietly rots.
 *
 * The tool list here is hand-mirrored from apps/api/src/routes/agent.ts's `AGENT_TOOLS`,
 * kept in sync via the shared module apps/api/src/services/agentToolSchema.ts. See the
 * comment at the top of that file for the rule.
 */
import { Hono } from 'hono';
import type { Env } from '../types/env';
import {
  AGENT_PUBLIC_ORIGIN,
  AGENT_VERSION,
  MCP_PROTOCOL_VERSION,
  PUBLIC_AGENT_TOOLS,
  STOREFRONT_PUBLIC_ORIGIN,
} from '../services/agentToolSchema';

const agentDiscoveryApp = new Hono<{ Bindings: Env }>();

/** Cache-Control applied to every static descriptor: clients can cache for an hour. */
const DISCOVERY_CACHE_CONTROL = 'public, max-age=3600';

/** Permissive CORS for the discovery endpoints so a browser-resident MCP client can fetch
 *  them without a preflight round-trip per discovery probe. */
const DISCOVERY_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

/** Apply the shared discovery headers (cache, content-type, CORS, nosniff) to a response. */
function withDiscoveryHeaders(c: any, body: unknown) {
  // CORS first — applied to every response, including errors, so a preflight is the only
  // round trip a browser client ever needs.
  for (const [k, v] of Object.entries(DISCOVERY_CORS_HEADERS)) c.header(k, v as string);
  c.header('Content-Type', 'application/json; charset=utf-8');
  c.header('Cache-Control', DISCOVERY_CACHE_CONTROL);
  c.header('X-Content-Type-Options', 'nosniff');
  return c.json(body);
}

/** Pre-flight handler so OPTIONS never reaches the route body. Mounted on the app below. */
function handleOptions(c: any) {
  for (const [k, v] of Object.entries(DISCOVERY_CORS_HEADERS)) c.header(k, v as string);
  return c.body(null, 204);
}

// ----------------------------------------------------------------------------
// Agent card — Anthropic "Skills" / A2A-style static descriptor
// ----------------------------------------------------------------------------

/**
 * GET /api/agent/card
 *
 * A simple agent card suitable for use in Anthropic's Skills / agent-card conventions
 * and the A2A protocol's `AgentCard` shape. This is the page a human (or agent) reads
 * first to learn what Maya is, who made her, and where her endpoints live.
 */
agentDiscoveryApp.get('/card', (c) => {
  const body = {
    id: 'the-daily-roast-maya',
    name: 'Maya — Master Barista',
    description:
      'Recommends specialty coffee from The Daily Roast (Bangalore) and answers brew questions. Can add to cart with user confirmation.',
    version: AGENT_VERSION,
    author: { name: 'The Daily Roast', url: STOREFRONT_PUBLIC_ORIGIN + '/' },
    homepage: STOREFRONT_PUBLIC_ORIGIN + '/',
    capabilities: ['recommend_coffee', 'brew_advice', 'cart_actions', 'voice_io'],
    endpoints: {
      chat: `${AGENT_PUBLIC_ORIGIN}/api/agent/chat`,
      stream: `${AGENT_PUBLIC_ORIGIN}/api/agent/chat/stream`,
      card: `${AGENT_PUBLIC_ORIGIN}/api/agent/card`,
      tools: `${AGENT_PUBLIC_ORIGIN}/api/agent/tools`,
      openapi: `${AGENT_PUBLIC_ORIGIN}/api/agent/openapi.json`,
      manifest: `${AGENT_PUBLIC_ORIGIN}/api/agent/manifest.json`,
      mcp_descriptor: `${AGENT_PUBLIC_ORIGIN}/.well-known/mcp.json`,
    },
    rate_limits: { requests_per_minute_ip: 20, session_per_minute: 10 },
    languages: ['en-IN', 'en-US'],
  };
  return withDiscoveryHeaders(c, body);
});

// ----------------------------------------------------------------------------
// OpenAI Apps SDK manifest
// ----------------------------------------------------------------------------

/**
 * GET /api/agent/manifest.json
 *
 * OpenAI's Apps SDK is built on the Model Context Protocol and extends it with a manifest
 * document and a chat-embedded UI layer. The static manifest advertises Maya as an
 * app that ChatGPT (or any Apps-SDK-compatible host) can invoke.
 *
 * Shape: derived from the OpenAI Apps SDK developer documentation (OpenAI DevDay 2025;
 * subsequent SDK updates through 2026). The SDK treats unknown top-level fields as
 * forward-compatible, so any field we add here is harmless; required fields we drop
 * would not be.
 */
agentDiscoveryApp.get('/manifest.json', (c) => {
  const body = {
    schema_version: '2026-01-26',
    name: 'the-daily-roast-maya',
    display_name: 'Maya — Master Barista',
    version: AGENT_VERSION,
    description:
      'Recommends specialty coffee from The Daily Roast (Bangalore) and answers brew questions. Can add to cart with user confirmation.',
    logo_url: `${STOREFRONT_PUBLIC_ORIGIN}/icon-180.png`,
    homepage_url: STOREFRONT_PUBLIC_ORIGIN + '/',
    contact_email: 'hello@dailyroast.in',
    legal_notice_url: `${STOREFRONT_PUBLIC_ORIGIN}/terms`,
    privacy_policy_url: `${STOREFRONT_PUBLIC_ORIGIN}/privacy`,
    categories: ['food_and_drink', 'shopping', 'lifestyle'],
    screenshots: [
      `${STOREFRONT_PUBLIC_ORIGIN}/og-default.png`,
    ],
    authorization: {
      type: 'none',
      description:
        'Anonymous chat is allowed. Customer actions (cart, subscription) require an X-Customer-Session obtained via /api/customer/login.',
    },
    api_spec: `${AGENT_PUBLIC_ORIGIN}/api/agent/openapi.json`,
    server: {
      type: 'mcp',
      mcp_version: MCP_PROTOCOL_VERSION,
      descriptor_url: `${AGENT_PUBLIC_ORIGIN}/.well-known/mcp.json`,
    },
    locales: ['en-IN', 'en-US'],
    tool_definitions: PUBLIC_AGENT_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema_url: `${AGENT_PUBLIC_ORIGIN}/api/agent/tools/${t.name}/schema.json`,
      confirmation_required: t.confirmationRequired,
    })),
    display_modes: ['inline_card', 'picture_in_picture'],
  };
  return withDiscoveryHeaders(c, body);
});

// ----------------------------------------------------------------------------
// OpenAPI 3.1 subset for the agent chat endpoints
// ----------------------------------------------------------------------------

/**
 * GET /api/agent/openapi.json
 *
 * A hand-written OpenAPI 3.1 document describing POST /api/agent/chat and
 * POST /api/agent/chat/stream. The point: an agent that wants to call Maya over plain
 * HTTP can read this, know the request body, the response shape, the error codes, and
 * the security scheme, without reading the source.
 */
agentDiscoveryApp.get('/openapi.json', (c) => {
  const body = {
    openapi: '3.1.0',
    info: {
      title: 'Maya — Master Barista API',
      version: AGENT_VERSION,
      description:
        'Conversational barista agent for The Daily Roast, a specialty coffee roastery in Indiranagar, Bangalore. The agent recommends coffees, answers brew questions, and (with user confirmation) proposes adding items to a customer cart.',
      contact: { name: 'The Daily Roast', url: STOREFRONT_PUBLIC_ORIGIN, email: 'hello@dailyroast.in' },
    },
    servers: [
      { url: AGENT_PUBLIC_ORIGIN, description: 'Production' },
    ],
    tags: [
      { name: 'agent', description: 'Conversational barista agent' },
    ],
    paths: {
      '/api/agent/chat': {
        post: {
          tags: ['agent'],
          operationId: 'chat',
          summary: 'Send a message to Maya and receive a JSON reply.',
          description:
            'One-shot chat endpoint. The request body is either a single `message` string or a `messages` array; the response is the agent reply plus any tool calls it made and any `proposed_actions` that need user confirmation.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChatRequest' },
                examples: {
                  simple: {
                    summary: 'Single user message',
                    value: {
                      message: 'Which Indian estate would you recommend for filter kaapi?',
                    },
                  },
                  multi: {
                    summary: 'Multi-turn conversation',
                    value: {
                      messages: [
                        { role: 'user', content: 'I like jaggery notes.' },
                        { role: 'assistant', content: 'Great — do you brew with a South Indian filter?' },
                        { role: 'user', content: 'Yes. What should I try?' },
                      ],
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Successful reply from Maya.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ChatResponse' },
                },
              },
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '403': { $ref: '#/components/responses/TurnstileFailed' },
            '429': { $ref: '#/components/responses/RateLimited' },
            '500': { $ref: '#/components/responses/InternalError' },
          },
        },
      },
      '/api/agent/chat/stream': {
        post: {
          tags: ['agent'],
          operationId: 'chatStream',
          summary: 'Send a message to Maya and receive a Server-Sent Events stream.',
          description:
            'Streaming variant of /api/agent/chat. The response is `text/event-stream` with one of these event names: `status` (a tool is in flight), `delta` (one chunk of the reply), `done` (terminal: full reply + proposed_actions), `error` (terminal: the message was unrecoverable).',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChatRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'SSE stream. Each event is one JSON-encoded payload.',
              content: {
                'text/event-stream': {
                  schema: { $ref: '#/components/schemas/ChatStreamResponse' },
                },
              },
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '403': { $ref: '#/components/responses/TurnstileFailed' },
            '429': { $ref: '#/components/responses/RateLimited' },
            '500': { $ref: '#/components/responses/InternalError' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        CustomerSession: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Customer-Session',
          description:
            'Optional. Adds personalisation (taste profile, loyalty, subscription) to Maya\'s context. Issued by /api/customer/login. The chat endpoint itself does not require it.',
        },
        Turnstile: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Turnstile-Token',
          description:
            'Required in production deployments. Cloudflare Turnstile bot-challenge token. The development environment bypasses this check.',
        },
      },
      schemas: {
        ChatMessage: {
          type: 'object',
          required: ['role', 'content'],
          additionalProperties: false,
          properties: {
            role: { type: 'string', enum: ['user', 'assistant', 'system'] },
            content: { type: 'string', minLength: 1 },
          },
        },
        ChatRequest: {
          type: 'object',
          additionalProperties: false,
          properties: {
            message: { type: 'string', minLength: 1, description: 'Single user message. Mutually exclusive with `messages`.' },
            messages: {
              type: 'array',
              items: { $ref: '#/components/schemas/ChatMessage' },
              minItems: 1,
              description: 'Multi-turn conversation. Mutually exclusive with `message`.',
            },
            session_id: {
              type: 'string',
              description:
                'Optional client-side session id. When provided, Maya restores the conversation history for this session before generating the next turn.',
            },
          },
        },
        ProposedAction: {
          type: 'object',
          required: ['confirmation_token', 'tool_name', 'arguments', 'summary', 'expires_at'],
          additionalProperties: true,
          properties: {
            confirmation_token: {
              type: 'string',
              description: 'Single-use token; the storefront sends it back in /api/agent/confirm-action.',
            },
            tool_name: { type: 'string', enum: ['add_to_cart', 'cancel_subscription'] },
            arguments: { type: 'object', additionalProperties: true },
            summary: { type: 'string', description: 'Human-readable description shown on the confirmation card.' },
            expires_at: { type: 'integer', description: 'Unix epoch (ms) after which this token is invalid.' },
          },
        },
        ChatResponse: {
          type: 'object',
          required: ['success', 'reply'],
          additionalProperties: true,
          properties: {
            success: { type: 'boolean' },
            reply: { type: 'string', description: 'The assistant reply, ready to render.' },
            message: { $ref: '#/components/schemas/ChatMessage' },
            tool_calls: { type: 'array', items: { type: 'object', additionalProperties: true } },
            proposed_actions: {
              type: 'array',
              items: { $ref: '#/components/schemas/ProposedAction' },
              description: 'Actions that need user confirmation before they take effect.',
            },
          },
        },
        ChatStreamEvent: {
          type: 'object',
          required: ['event'],
          additionalProperties: true,
          properties: {
            event: { type: 'string', enum: ['status', 'delta', 'done', 'error'] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ChatStreamResponse: {
          type: 'array',
          description: 'SSE event stream. Each item is one event from the chat stream.',
          items: { $ref: '#/components/schemas/ChatStreamEvent' },
        },
        Error: {
          type: 'object',
          required: ['success', 'error'],
          additionalProperties: true,
          properties: {
            success: { type: 'boolean', const: false },
            error: { type: 'string' },
          },
        },
      },
      responses: {
        BadRequest: {
          description: 'Request was malformed (missing body, unparseable JSON, empty messages).',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        TurnstileFailed: {
          description: 'Cloudflare Turnstile bot-challenge token missing or invalid.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        RateLimited: {
          description: 'IP or session rate limit hit, or the daily cost cap is exhausted.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        InternalError: {
          description: 'Upstream model call failed. Retry with backoff.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
    security: [],
  };
  return withDiscoveryHeaders(c, body);
});

// ----------------------------------------------------------------------------
// Public tools list + per-tool JSON Schemas
// ----------------------------------------------------------------------------

/**
 * GET /api/agent/tools
 *
 * The list of public tools Maya exposes, with a link to each tool's input schema. An
 * agent can read this once, then `fetch` the per-tool schema as needed.
 */
agentDiscoveryApp.get('/tools', (c) => {
  const body = {
    version: AGENT_VERSION,
    count: PUBLIC_AGENT_TOOLS.length,
    tools: PUBLIC_AGENT_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      schema_url: `${AGENT_PUBLIC_ORIGIN}/api/agent/tools/${t.name}/schema.json`,
      confirmation_required: t.confirmationRequired,
    })),
  };
  return withDiscoveryHeaders(c, body);
});

/**
 * GET /api/agent/tools/:name/schema.json
 *
 * JSON Schema 2020-12 for a single tool's input. The tool name must match one of the
 * entries in `PUBLIC_AGENT_TOOLS`; unknown names return 404 so callers do not silently
 * receive an empty schema and assume the tool takes no arguments.
 */
agentDiscoveryApp.get('/tools/:name/schema.json', (c) => {
  const name = c.req.param('name');
  const tool = PUBLIC_AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) {
    return withDiscoveryHeaders(c, {
      success: false,
      error: `Unknown tool: ${name}. See /api/agent/tools for the list of public tools.`,
    });
  }
  const body = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${AGENT_PUBLIC_ORIGIN}/api/agent/tools/${tool.name}/schema.json`,
    title: tool.name,
    description: tool.description,
    type: 'object',
    ...tool.inputSchema,
    'x-agent': {
      name: tool.name,
      confirmation_required: tool.confirmationRequired,
      tool_call_protocol: 'mcp',
    },
  };
  return withDiscoveryHeaders(c, body);
});

// ----------------------------------------------------------------------------
// MCP server card (SEP-1649 / SEP-1960) — declared further below on mcpWellKnownApp
// ----------------------------------------------------------------------------

// CORS preflight on every GET above, so a browser MCP client never trips.
agentDiscoveryApp.options('*', handleOptions);

// ----------------------------------------------------------------------------
// MCP well-known descriptor — mounted at the host root, not under /api/agent
// ----------------------------------------------------------------------------

/**
 * The MCP server card lives at `/.well-known/mcp.json` per SEP-1649/SEP-1960, which is the
 * host root rather than under `/api/agent`. It is split into its own Hono app so the
 * index.ts mount points stay clean: one app per URL prefix.
 *
 * Kept in this file (rather than a sibling module) so the descriptor and the rest of the
 * agent surface share a single source of truth for PUBLIC_AGENT_TOOLS, MCP_PROTOCOL_VERSION
 * and the origin constants.
 */
const mcpWellKnownApp = new Hono<{ Bindings: Env }>();

/**
 * GET /.well-known/mcp.json — MCP server card.
 *
 * Same body as the in-app `/.well-known/mcp.json` route would have served; hoisted to its
 * own Hono app so the host-root mount serves only this one path, leaving `/api/agent/*`
 * to the main agentDiscoveryApp. The body is static — the actual MCP transport requires a
 * long-running process for tool calls; this descriptor is what an MCP client reads to
 * discover us before opening that connection.
 *
 * Shape follows SEP-1649 (serverInfo + transport + capabilities) and SEP-1960 (endpoints
 * array) in one document, pinned to the MCP November 2025 protocol version. Update
 * `MCP_PROTOCOL_VERSION` in apps/api/src/services/agentToolSchema.ts if the runtime ever
 * speaks a different protocol version.
 */
mcpWellKnownApp.get('/.well-known/mcp.json', (c) => {
  const body = {
    $schema: 'https://modelcontextprotocol.io/schemas/server-card/v1.0',
    version: '1.0',
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: {
      name: 'the-daily-roast-maya',
      version: AGENT_VERSION,
      description:
        'Maya, the AI barista for The Daily Roast (Bangalore). Recommends specialty coffee, answers brew questions, and proposes cart actions with user confirmation.',
      homepage: STOREFRONT_PUBLIC_ORIGIN + '/',
    },
    transport: {
      // The actual chat endpoint. MCP transport requires a long-running process; this
      // descriptor points a client at the HTTP surface it can call over plain HTTPS.
      type: 'streamable-http',
      url: `${AGENT_PUBLIC_ORIGIN}/api/agent/chat`,
      alternate_url: `${AGENT_PUBLIC_ORIGIN}/api/agent/chat/stream`,
    },
    capabilities: {
      tools: true,
      resources: false,
      prompts: false,
      streaming: true,
    },
    tools: PUBLIC_AGENT_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      inputSchemaUrl: `${AGENT_PUBLIC_ORIGIN}/api/agent/tools/${t.name}/schema.json`,
      confirmationRequired: t.confirmationRequired,
    })),
    auth: {
      // Anonymous chat is allowed. Customer-scoped tools (cart, subscription) need a
      // session token via /api/customer/login — that is documented per-tool in the
      // OpenAPI subset at /api/agent/openapi.json, not in this discovery descriptor.
      type: 'none',
    },
    // SEP-1960-compatible parallel view. Same server, expressed as an endpoint list so
    // a client that only knows SEP-1960 still has something to read.
    mcp_version: MCP_PROTOCOL_VERSION,
    endpoints: [
      {
        url: `${AGENT_PUBLIC_ORIGIN}/api/agent/chat`,
        transport: 'http',
        capabilities: ['tools'],
        streaming: false,
      },
      {
        url: `${AGENT_PUBLIC_ORIGIN}/api/agent/chat/stream`,
        transport: 'sse',
        capabilities: ['tools', 'streaming'],
      },
    ],
    card: `${AGENT_PUBLIC_ORIGIN}/api/agent/card`,
    openapi: `${AGENT_PUBLIC_ORIGIN}/api/agent/openapi.json`,
  };
  return withDiscoveryHeaders(c, body);
});

mcpWellKnownApp.options('/.well-known/mcp.json', handleOptions);

export { agentDiscoveryApp, mcpWellKnownApp };
