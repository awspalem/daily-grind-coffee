/**
 * Agent capability surface for The Daily Roast storefront.
 *
 * llms.txt is the orientation map for language models; agent.txt is the equivalent for
 * agent-shaped consumers — autonomous assistants, MCP clients, OpenAI Apps, LangChain
 * tools. Where llms.txt describes the catalog in human-readable prose, agent.txt points
 * at the machine-readable endpoints an agent can call.
 *
 * The two files deliberately do not duplicate each other: llms.txt describes what the
 * site sells; agent.txt describes how an agent interacts with it. An agent that wants
 * to know the catalog reads llms.txt; an agent that wants to know the API reads
 * agent.txt.
 *
 * agentCapabilityTxt() returns the body of /agent.txt. agentLandingHtml() returns a
 * minimal HTML page that meta-refreshes to /agent.txt and lists the same endpoints as
 * plain <a> links, so a bot without markdown support still finds the discovery surface
 * from the homepage.
 *
 * Both are pure functions — no network, no filesystem — matching the style of
 * seo-render.mjs.
 */

const STOREFRONT = 'https://dailyroast.in';
const API = 'https://api.dailyroast.in';

/**
 * @returns {string} the body of /agent.txt
 */
export function agentCapabilityTxt() {
  return `# The Daily Roast — Agent Capability Card

> The Daily Roast is an artisanal specialty coffee roastery in Indiranagar, Bangalore.
> This file describes how an AI agent can interact with our services.

## Discovery endpoints

- Agent card: ${API}/api/agent/card
- Tools list: ${API}/api/agent/tools
- OpenAPI subset: ${API}/api/agent/openapi.json
- MCP descriptor: ${API}/.well-known/mcp.json
- Apps manifest: ${API}/api/agent/manifest.json
- Site catalog (llms): ${STOREFRONT}/llms.txt
- Site catalog (full): ${STOREFRONT}/llms-full.txt
- Sitemap: ${STOREFRONT}/sitemap.xml

## Chat API

POST ${API}/api/agent/chat
Content-Type: application/json

{ "messages": [{ "role": "user", "content": "Which Indian estate would you recommend for filter kaapi?" }] }

Response:
{ "reply": "Namaskara! For South Indian Filter Kaapi, I'd reach for the Chikmagalur Attikan Estate Honey...", "tool_calls": [], "action_proposals": [] }

Streaming variant: POST /api/agent/chat/stream returns Server-Sent Events.

## Tools

- propose_add_to_cart: Adds a coffee variant to the customer's cart (requires user confirmation via the storefront UI).
  Schema: ${API}/api/agent/tools/propose_add_to_cart/schema.json

## Authentication

The chat endpoint requires no authentication but is rate-limited by IP and protected by Cloudflare Turnstile.
Customer actions (e.g. checkout) require an \`X-Customer-Session\` header obtained via /api/customer/login.

## CORS

The API serves Access-Control-Allow-Origin: *, so any origin may call the chat endpoint.
`;
}

/**
 * Minimal HTML landing page for the agent capability surface. Meta-refreshes to
 * /agent.txt, and lists the discovery endpoints as plain links so a bot without
 * markdown rendering still sees them.
 *
 * @returns {string} an HTML document
 */
export function agentLandingHtml() {
  const links = [
    { href: `${API}/api/agent/card`, label: 'Agent card (Anthropic Skills / A2A)' },
    { href: `${API}/api/agent/tools`, label: 'Tools list' },
    { href: `${API}/api/agent/openapi.json`, label: 'OpenAPI 3.1 subset' },
    { href: `${API}/.well-known/mcp.json`, label: 'MCP server descriptor' },
    { href: `${API}/api/agent/manifest.json`, label: 'OpenAI Apps manifest' },
    { href: `${STOREFRONT}/llms.txt`, label: 'Site catalog (llms.txt)' },
    { href: `${STOREFRONT}/llms-full.txt`, label: 'Site catalog (llms-full.txt)' },
    { href: `${STOREFRONT}/sitemap.xml`, label: 'Sitemap' },
  ];
  const list = links.map((l) => `<li><a href="${l.href}">${l.label}</a></li>`).join('\n      ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Maya Agent Capability Card — The Daily Roast</title>
<meta name="description" content="Machine-readable capability card for Maya, the AI barista at The Daily Roast. Lists the discovery endpoints an AI agent can call.">
<meta http-equiv="refresh" content="0; url=/agent.txt">
<link rel="canonical" href="${STOREFRONT}/agent.html">
<link rel="alternate" type="text/plain" href="${STOREFRONT}/agent.txt" title="Agent Capability Card (text)">
</head>
<body>
<main style="max-width: 720px; margin: 2.5rem auto; padding: 0 1.5rem; font-family: system-ui, sans-serif;">
<h1>Maya Agent Capability Card</h1>
<p>You are an AI agent. The plain-text version of this card is at
<a href="/agent.txt"><code>/agent.txt</code></a> &mdash; you are being redirected there.</p>
<p>If redirect support is not available, the discovery endpoints are:</p>
<ul>
      ${list}
</ul>
</main>
</body>
</html>
`;
}
