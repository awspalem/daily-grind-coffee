/**
 * Tests for the Maya agent discovery endpoints.
 *
 * These routes are static descriptors (no DB, no model calls), so the test setup is
 * deliberately minimal: a one-off Hono app with the same mounts as index.ts would
 * make, and an Env that satisfies the `Bindings` type. The tests assert the shape
 * other agents will read against, not the implementation, because that is the
 * interface under contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { agentDiscoveryApp, mcpWellKnownApp } from './agentDiscovery';
import { PUBLIC_AGENT_TOOLS } from '../services/agentToolSchema';
import type { Env } from '../types/env';

const envFor = (): Env => ({
  DB: {} as any,
  ENVIRONMENT: 'test',
  STOREFRONT_URL: 'https://dailyroast.in',
  ADMIN_URL: 'https://admin.dailyroast.in',
  CURRENCY: 'inr',
} as Env);

function makeApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/agent', agentDiscoveryApp);
  app.route('/', mcpWellKnownApp);
  return app;
}

async function get(app: Hono<{ Bindings: Env }>, path: string): Promise<Response> {
  return app.request(path, { method: 'GET' }, envFor());
}

// ----------------------------------------------------------------------------- card

test('agent-discovery: GET /api/agent/card returns a valid card shape', async () => {
  const res = await get(makeApp(), '/api/agent/card');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  // CORS preflight essentials for browser-resident MCP clients
  assert.equal(res.headers.get('access-control-allow-origin'), '*');

  const body = await res.json() as any;
  assert.equal(body.id, 'the-daily-roast-maya');
  assert.equal(body.name, 'Maya — Master Barista');
  assert.equal(body.version, '1.0.0');
  assert.ok(Array.isArray(body.capabilities), 'capabilities must be an array');
  for (const cap of ['recommend_coffee', 'brew_advice', 'cart_actions', 'voice_io']) {
    assert.ok(body.capabilities.includes(cap), `capabilities missing ${cap}`);
  }
  assert.equal(body.endpoints.chat, 'https://api.dailyroast.in/api/agent/chat');
  assert.equal(body.endpoints.stream, 'https://api.dailyroast.in/api/agent/chat/stream');
  assert.equal(body.endpoints.card, 'https://api.dailyroast.in/api/agent/card');
  assert.equal(body.endpoints.tools, 'https://api.dailyroast.in/api/agent/tools');
  assert.equal(body.rate_limits.requests_per_minute_ip, 20);
  assert.ok(Array.isArray(body.languages));
  assert.equal(typeof body.author.name, 'string');
  assert.equal(typeof body.homepage, 'string');
});

// ----------------------------------------------------------------------------- tools list

test('agent-discovery: GET /api/agent/tools lists propose_add_to_cart with its schema URL', async () => {
  const res = await get(makeApp(), '/api/agent/tools');
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.count, PUBLIC_AGENT_TOOLS.length);
  assert.ok(Array.isArray(body.tools));
  const propose = body.tools.find((t: any) => t.name === 'propose_add_to_cart');
  assert.ok(propose, 'propose_add_to_cart must be in the public tool list');
  assert.equal(typeof propose.description, 'string');
  assert.ok(propose.description.length > 0, 'description must not be empty');
  assert.equal(
    propose.schema_url,
    'https://api.dailyroast.in/api/agent/tools/propose_add_to_cart/schema.json'
  );
  assert.equal(propose.confirmation_required, true);

  // every tool entry has a schema_url that actually points at the per-tool schema
  for (const t of body.tools) {
    assert.match(t.schema_url, /\/api\/agent\/tools\/[^/]+\/schema\.json$/);
  }
});

// ----------------------------------------------------------------------------- per-tool schema

test('agent-discovery: propose_add_to_cart schema is valid JSON Schema 2020-12', async () => {
  const res = await get(makeApp(), '/api/agent/tools/propose_add_to_cart/schema.json');
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.match(body.$schema, /json-schema\.org\/draft\/2020-12/);
  assert.equal(body.type, 'object');
  assert.equal(body.title, 'propose_add_to_cart');

  // Required fields per the task brief.
  const required = new Set(body.required);
  assert.ok(required.has('variant_id'));
  assert.ok(required.has('product_name'));
  assert.ok(required.has('grind_type'));

  // Enum covers the eight grinds the runtime accepts. The discovery schema must
  // match the runtime exactly (see agentToolSchema.ts's "kept in sync" comment):
  // a schema that advertises seven values when the agent accepts eight would have
  // callers send "DRIP" and see a 4xx they did not expect.
  const grindEnum = body.properties.grind_type.enum;
  assert.deepEqual(grindEnum, [
    'WHOLE_BEAN', 'POUR_OVER', 'SOUTH_INDIAN_FILTER',
    'ESPRESSO', 'AEROPRESS', 'DRIP', 'FRENCH_PRESS', 'COLD_BREW',
  ]);

  // Optional field constraints
  assert.equal(body.properties.quantity.type, 'integer');
  assert.equal(body.properties.quantity.default, 1);
  assert.equal(body.properties.notes.maxLength, 200);

  // The x-agent extension flags confirmation requirement for callers that pre-validate.
  assert.equal(body['x-agent'].confirmation_required, true);
});

test('agent-discovery: unknown tool schema returns an error envelope, not an empty schema', async () => {
  // The bug we want to avoid: a typo'd tool name returning `{}` and the caller assuming
  // the tool takes no arguments. The route must signal "not found" instead.
  const res = await get(makeApp(), '/api/agent/tools/does_not_exist/schema.json');
  const body = await res.json() as any;
  assert.equal(body.success, false);
  assert.match(body.error, /Unknown tool/);
});

// ----------------------------------------------------------------------------- MCP descriptor

test('agent-discovery: GET /.well-known/mcp.json is a valid SEP-1649 server card', async () => {
  const res = await get(makeApp(), '/.well-known/mcp.json');
  assert.equal(res.status, 200);
  const body = await res.json() as any;

  // SEP-1649 required fields
  assert.match(body.$schema, /modelcontextprotocol\.io\/schemas\/server-card/);
  assert.equal(body.version, '1.0');
  assert.ok(body.protocolVersion, 'protocolVersion is required');
  assert.equal(body.serverInfo.name, 'the-daily-roast-maya');
  assert.equal(body.serverInfo.version, '1.0.0');
  assert.equal(typeof body.serverInfo.description, 'string');

  // Transport points at the chat endpoint
  assert.equal(body.transport.type, 'streamable-http');
  assert.equal(body.transport.url, 'https://api.dailyroast.in/api/agent/chat');
  assert.match(body.transport.alternate_url, /\/api\/agent\/chat\/stream$/);

  // Capabilities must advertise tools: true and explicitly NOT resources / prompts
  assert.equal(body.capabilities.tools, true);
  assert.equal(body.capabilities.resources, false);
  assert.equal(body.capabilities.prompts, false);

  // SEP-1960 parallel view: mcp_version + endpoints array
  assert.equal(typeof body.mcp_version, 'string');
  assert.ok(Array.isArray(body.endpoints));
  assert.ok(body.endpoints.length >= 2);
  for (const ep of body.endpoints) {
    assert.match(ep.url, /^https:\/\//);
    assert.ok(['http', 'sse', 'streamable-http'].includes(ep.transport));
    assert.ok(Array.isArray(ep.capabilities));
  }

  // The descriptor advertises the same tool list the runtime has, hand-mirrored.
  assert.ok(Array.isArray(body.tools));
  assert.equal(body.tools.length, PUBLIC_AGENT_TOOLS.length);
  for (const t of body.tools) {
    assert.ok(typeof t.name === 'string' && t.name.length > 0);
    assert.ok(typeof t.inputSchema === 'object' && t.inputSchema !== null);
    assert.match(t.inputSchemaUrl, /\/api\/agent\/tools\/[^/]+\/schema\.json$/);
  }
});

// ----------------------------------------------------------------------------- OpenAI Apps manifest

test('agent-discovery: GET /api/agent/manifest.json is a valid Apps SDK manifest', async () => {
  const res = await get(makeApp(), '/api/agent/manifest.json');
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.ok(typeof body.schema_version === 'string');
  assert.equal(body.name, 'the-daily-roast-maya');
  assert.equal(body.display_name, 'Maya — Master Barista');
  assert.equal(typeof body.description, 'string');
  assert.equal(typeof body.logo_url, 'string');
  assert.ok(typeof body.contact_email === 'string' && body.contact_email.includes('@'));
  assert.equal(body.api_spec, 'https://api.dailyroast.in/api/agent/openapi.json');
  assert.equal(body.server.type, 'mcp');
  assert.equal(body.server.descriptor_url, 'https://api.dailyroast.in/.well-known/mcp.json');
  assert.ok(Array.isArray(body.tool_definitions));
  for (const t of body.tool_definitions) {
    assert.ok(typeof t.name === 'string');
    assert.match(t.input_schema_url, /\/api\/agent\/tools\/[^/]+\/schema\.json$/);
    assert.equal(typeof t.confirmation_required, 'boolean');
  }
});

// ----------------------------------------------------------------------------- OpenAPI 3.1 subset

test('agent-discovery: GET /api/agent/openapi.json is a valid OpenAPI 3.1 document', async () => {
  const res = await get(makeApp(), '/api/agent/openapi.json');
  assert.equal(res.status, 200);
  const body = await res.json() as any;

  // OpenAPI 3.1 top-level required field
  assert.equal(body.openapi, '3.1.0');

  // Must document both chat endpoints
  assert.ok(body.paths['/api/agent/chat'], 'chat path missing');
  assert.ok(body.paths['/api/agent/chat/stream'], 'chat/stream path missing');

  // Chat path: POST with a requestBody that references a message schema
  const chat = body.paths['/api/agent/chat'].post;
  assert.equal(chat.operationId, 'chat');
  const requestSchema = chat.requestBody.content['application/json'].schema;
  assert.ok(requestSchema.$ref, 'chat request must be a $ref');
  const requestDef = body.components.schemas[requestSchema.$ref.split('/').pop()];
  assert.ok(requestDef.properties.messages || requestDef.properties.message,
    'chat request must accept either messages or message');
  for (const code of ['200', '400', '403', '429', '500']) {
    assert.ok(chat.responses[code], `chat response ${code} missing`);
  }

  // Streaming path declares the SSE media type
  const stream = body.paths['/api/agent/chat/stream'].post;
  assert.equal(stream.operationId, 'chatStream');
  assert.ok(stream.responses['200'].content['text/event-stream'],
    'streaming path must declare text/event-stream content type');

  // Security scheme: X-Customer-Session as an apiKey in header
  assert.ok(body.components.securitySchemes.CustomerSession);
  assert.equal(body.components.securitySchemes.CustomerSession.in, 'header');
  assert.equal(body.components.securitySchemes.CustomerSession.name, 'X-Customer-Session');

  // Servers: must point at the production API origin
  assert.ok(Array.isArray(body.servers));
  assert.equal(body.servers[0].url, 'https://api.dailyroast.in');

  // The ChatRequest schema distinguishes between a single message and a message array.
  const chatReq = body.components.schemas.ChatRequest;
  assert.equal(chatReq.properties.message.type, 'string');
  assert.equal(chatReq.properties.messages.type, 'array');
});
