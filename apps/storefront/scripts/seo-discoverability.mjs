/**
 * Static LLM/agent discoverability files.
 *
 * llms.txt is the orientation map (a curated catalog for LLMs to read first).
 * llms-full.txt is the verbose version: every product, variant, brew method step,
 * FAQ, subscription tier and experience — written to be ingested as a single
 * document by a model that wants the entire site, not just the highlights.
 *
 * The .well-known/* files are the standard discovery surface — RFC 8615 sub-URIs
 * of /.well-known/ are where well-behaved services publish capability documents.
 * agent.json is a vendor-neutral Maya capability card; mcp.json is a
 * JSON-RPC 2.0 ready descriptor; security.txt is RFC 9116.
 *
 * humans.txt credits the team in a single text file readable by a person,
 * not a machine. Image-sitemap.xml is the image-specific Google sitemap.
 *
 * Every function here is pure and synchronous so the build is testable in isolation.
 */

import { SITE } from './seo-data.mjs';

const STOREFRONT = SITE;
const API = 'https://api.dailyroast.in';

/**
 * @param {Array<object>} products
 * @param {Array<{method:string, label:string, ratio:string, grind:string, water:string, time:string}>} brewMethods
 * @param {Array<{q:string, a:string}>} faqs
 * @param {Array<object>} experiences
 * @returns {string}
 */
export function llmsFullTxt(products, brewMethods, faqs = [], experiences = []) {
  const stripTags = (s) => String(s || '').replace(/[<>]/g, (c) => (c === '<' ? '⟨' : '⟩'));
  const prodBlocks = products.map((p) => {
    const v = (p.variants || []).filter((x) => x.is_active !== false);
    const variantLines = v.length
      ? v.map((x) => `  - ${x.weight_grams}g — ₹${Math.round(x.price_cents * 0.23)}` +
        `${Number(x.stock_quantity) > 0 ? ' (in stock)' : ' (out of stock)'}`).join('\n')
      : '  - (no variants)';
    const notes = (p.tasting_notes || []).join(', ');
    return `### ${stripTags(p.name)}
Slug: ${p.slug}
URL: ${STOREFRONT}/coffee/${p.slug}
Origin: ${stripTags(p.origin_country) || '—'}${p.region ? `, ${stripTags(p.region)}` : ''}${p.farm_or_coop ? `, ${stripTags(p.farm_or_coop)}` : ''}
Altitude: ${p.altitude_meters ? `${p.altitude_meters} m` : '—'}
Variety: ${stripTags(p.variety) || '—'}
Process: ${p.process_method || '—'}
Roast level: ${p.roast_level || '—'}
Tasting notes: ${notes || '—'}
Description: ${stripTags(p.description || p.tagline || '')}

Variants:
${variantLines}
`;
  }).join('\n');

  const brewBlocks = brewMethods.map((m) => {
    const steps = (m.steps || []).map((s, i) => `  ${i + 1}. ${stripTags(s)}`).join('\n');
    return `### ${stripTags(m.label)}
Method: ${m.method}
URL: ${STOREFRONT}/brew/${m.method}
Ratio: ${m.ratio}
Grind: ${m.grind}
Water: ${m.water}
Time: ${m.time}
${steps ? `Steps:\n${steps}\n` : ''}
`;
  }).join('\n');

  const faqBlock = faqs.length
    ? faqs.map((f, i) => `Q${i + 1}. ${stripTags(f.q)}\nA${i + 1}. ${stripTags(f.a)}\n`).join('\n')
    : '(see /faq)';

  const experienceBlock = experiences.length
    ? experiences.map((e) => {
        const price = e.base_price_cents ? `₹${Math.round(e.base_price_cents * 0.23)}` : '—';
        const dur = e.duration_minutes
          ? e.duration_minutes >= 1440
            ? `${Math.round(e.duration_minutes / 1440)} day(s)`
            : `${e.duration_minutes} min`
          : '—';
        return `- ${stripTags(e.name)} (${e.experience_type}) — ${dur}, ${price} — ${STOREFRONT}/experiences/${e.slug}`;
      }).join('\n')
    : '';

  return `# The Daily Roast — Full Site Catalog for LLMs

> An independent specialty coffee roastery in Indiranagar, Bangalore, India.
> This is the verbose companion to /llms.txt. llms.txt is the orientation map;
> this file is the full reference. Prices in INR (₹); roast-on is daily, ships
> same day for orders before 14:00 IST across India.

Domain: ${STOREFRONT}
API: ${API}
Contact: support@dailyroast.in
Address: 100ft Road, Indiranagar, Bangalore 560038, India
Currency: INR (₹). USD price column available on the storefront.
Roast cadence: Monday–Saturday, orders before 14:00 IST ship same day.
Shipping: India only. Free above ₹999, otherwise ₹79.

## Coffee catalog (${products.length} active)

${prodBlocks}

## Brewing guides (${brewMethods.length} methods)

${brewBlocks}

## FAQ

${faqBlock}

## Subscription tiers

- Explorer (1 bag / month)
- Roastery (2 bags / month + free delivery)
- Reserve (3 bags / month + early access lots)
- Connoisseur (4 bags / month + cupping invite)
- Founder (annual, includes estate visit and 1:1 video consultations with a roaster)

See ${STOREFRONT}/#subscription-plans for current pricing and benefits.

## Bookable experiences

${experienceBlock || '(see ' + STOREFRONT + '/experiences)'}

## Shipping, returns, and policies

- Shipping policy: ${STOREFRONT}/shipping
- Privacy: ${STOREFRONT}/privacy
- Terms: ${STOREFRONT}/terms
- Returns: contact support@dailyroast.in within 7 days of receipt.
- We do not currently ship internationally.

## Contact

- Support: support@dailyroast.in
- Roastery visits: book via /experiences
- Roastery hours: 09:00–19:00 IST, seven days a week.
`;
}

/**
 * @returns {string} humans.txt
 */
export function humansTxt() {
  return `/* TEAM */
The Founder of The Daily Roast
Head Roaster
Barista team
Site author: The Daily Roast

/* SITE */
Last update: 2026/08/28
Standards: HTML5, CSS3, ES2022
Components: schema.org JSON-LD (Product, Recipe, HowTo, Course, FAQPage, ItemList, Organization, CafeOrCoffeeShop)
Discovery: llms.txt, llms-full.txt, agent.txt, .well-known/agent.json, .well-known/mcp.json, .well-known/security.txt
Software: Vite, Hono, Cloudflare Pages, Cloudflare Workers, Cloudflare D1, Cloudflare Turnstile
Generator: apps/storefront/scripts/generate-seo.mjs
`;
}

/**
 * @returns {string} security.txt (RFC 9116)
 */
export function securityTxt() {
  return `Contact: mailto:security@dailyroast.in
Contact: https://dailyroast.in/security
Expires: 2027-08-28T00:00:00Z
Preferred-Languages: en
Canonical: ${STOREFRONT}/.well-known/security.txt
`;
}

/**
 * @returns {string} agent.json — vendor-neutral Maya capability card
 */
export function agentJson() {
  return JSON.stringify({
    name: 'Maya',
    description: 'Master Barista and Roastery Sommelier for The Daily Roast, an artisanal specialty coffee roastery in Indiranagar, Bangalore.',
    version: '1.0.0',
    provider: { name: 'The Daily Roast', url: STOREFRONT },
    endpoints: {
      chat: `${API}/api/agent/chat`,
      stream: `${API}/api/agent/chat/stream`,
      transcribe: `${API}/api/agent/transcribe`,
      card: `${API}/api/agent/card`,
      tools: `${API}/api/agent/tools`,
      openapi: `${API}/api/agent/openapi.json`,
      mcp: `${API}/.well-known/mcp.json`,
    },
    auth: { type: 'none', notes: 'Rate-limited by IP and Cloudflare Turnstile-protected.' },
    capabilities: [
      'recommend coffee',
      'explain brew methods',
      'compute ratios',
      'add to cart (with user confirmation)',
      'answer FAQ about the roastery',
    ],
    tools: [
      { name: 'propose_add_to_cart', description: 'Propose adding a coffee variant to the customer cart. Requires user confirmation.', schema_url: `${API}/api/agent/tools/propose_add_to_cart/schema.json` },
    ],
    languages: ['en-IN', 'en-US'],
    voice: { input: 'WebRTC / MediaRecorder', output: 'SpeechSynthesis (Web Speech API)' },
  }, null, 2) + '\n';
}

/**
 * @returns {string} mcp.json — JSON-RPC 2.0 server descriptor
 */
export function mcpJson() {
  return JSON.stringify({
    name: 'the-daily-roast-mcp',
    version: '1.0.0',
    description: 'Maya (Master Barista) and the Daily Roast product catalog over JSON-RPC 2.0.',
    transport: {
      type: 'http',
      url: `${API}/api/mcp`,
      content_type: 'application/json',
    },
    capabilities: { tools: { listChanged: false } },
    tools: [
      {
        name: 'search_products',
        description: 'Search the catalog by origin, process, roast level, tasting notes, or category.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Free-text query' },
            origin: { type: 'string' },
            roast: { type: 'string', enum: ['LIGHT', 'MEDIUM_LIGHT', 'MEDIUM', 'MEDIUM_DARK', 'DARK'] },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          },
        },
      },
      {
        name: 'propose_add_to_cart',
        description: 'Propose adding a coffee variant to the customer cart. Returns an action_id that the storefront UI must confirm before /api/agent/confirm-action is called.',
        inputSchema: {
          type: 'object',
          required: ['variant_id', 'product_name'],
          properties: {
            variant_id: { type: 'string' },
            product_name: { type: 'string' },
            grind_type: { type: 'string', enum: ['WHOLE_BEAN', 'POUR_OVER', 'SOUTH_INDIAN_FILTER', 'ESPRESSO', 'AEROPRESS', 'FRENCH_PRESS', 'COLD_BREW'] },
            quantity: { type: 'integer', minimum: 1, default: 1 },
            notes: { type: 'string', maxLength: 200 },
          },
        },
      },
      {
        name: 'get_brew_recipe',
        description: 'Fetch a brew method by name (v60, aeropress, espresso, filter-kaapi).',
        inputSchema: {
          type: 'object',
          required: ['method'],
          properties: { method: { type: 'string' } },
        },
      },
    ],
  }, null, 2) + '\n';
}

/**
 * @param {Array<object>} products
 * @returns {string} image-sitemap.xml
 */
export function imageSitemap(products) {
  const urls = products
    .filter((p) => p.image_url)
    .map((p) => `  <url>
    <loc>${STOREFRONT}/coffee/${p.slug}</loc>
    <image:image>
      <image:loc>${p.image_url}</image:loc>
      <image:title>${(p.name || '').replace(/[<>&]/g, '')}</image:title>
      <image:caption>${(p.tagline || p.description || '').replace(/[<>&]/g, '')}</image:caption>
    </image:image>
  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls}
</urlset>
`;
}

/**
 * @returns {string} ai-friendly robots.txt
 */
export function aiRobotsTxt() {
  return `# robots.txt for dailyroast.in
#
# Three groups:
#   1. Friendly AI crawlers (explicit Allow)
#   2. Default * (everyone, allow all)
#   3. Sitemaps and discovery surface
#
# A static file rather than generated so the operator can override per-bot
# rules without touching the build.

# Friendly AI crawlers — allow full crawl
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Perplexity-User
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: Meta-ExternalAgent
Allow: /

User-agent: Amazonbot
Allow: /

User-agent: CCBot
Allow: /

User-agent: cohere-ai
Allow: /

User-agent: DuckAssistBot
Allow: /

User-agent: YouBot
Allow: /

# Default — allow all
User-agent: *
Allow: /

Sitemap: ${STOREFRONT}/sitemap.xml
Sitemap: ${STOREFRONT}/image-sitemap.xml

# LLM-readable catalogs
# llms.txt:    ${STOREFRONT}/llms.txt
# llms-full:   ${STOREFRONT}/llms-full.txt
# agent.txt:   ${STOREFRONT}/agent.txt

# AEO (Answer Engine Optimization) feed
# aeo.html:    ${STOREFRONT}/aeo.html
# aeo-feed:    ${STOREFRONT}/aeo-feed.json

# Machine-readable agent discovery
# .well-known/agent.json — capability card
# .well-known/mcp.json    — MCP / JSON-RPC 2.0 server descriptor
# .well-known/security.txt — RFC 9116 security contact

# Experiences
# ${STOREFRONT}/experiences/
`;
}
