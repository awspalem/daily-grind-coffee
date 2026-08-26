/**
 * The generated pages are the site's only indexable product content, so the things that would
 * quietly destroy their value get pinned here.
 *
 * Background: before this, the entire shop lived at one URL. Ten coffees, five plans and four
 * experiences all sat behind `#` anchors on `/`, and the catalog was fetched client-side, so
 * `curl https://dailyroast.in/` returned zero product cards. One URL cannot rank for ten
 * different coffees, and nothing had anything to link to but the homepage. Meta tags and schema
 * were never the problem — they were already fine — which is why the fix is pages, and why what
 * is asserted below is mostly about the pages being real and self-describing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
// @ts-expect-error — plain ESM helpers, deliberately not TypeScript: they run under node in the build.
import { productPage, indexPage, sitemap, llmsTxt, metaDescription, productSchema } from '../scripts/seo-render.mjs';
// @ts-expect-error — see above.
import { priceInr } from '../scripts/seo-data.mjs';

function storefrontRoot(): string {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'index.html')) && existsSync(join(dir, 'scripts', 'seo-render.mjs'))) return dir;
    const candidate = join(dir, 'apps', 'storefront');
    if (existsSync(join(candidate, 'index.html'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate apps/storefront from ${process.cwd()}`);
}

const ROOT = storefrontRoot();

/** Shaped like the real /api/products payload, including the fields most likely to be absent. */
const PRODUCT = {
  id: 'prod_test',
  slug: 'chikmagalur-attikan-estate-honey',
  name: 'Chikmagalur Attikan Estate Honey',
  tagline: 'Sweet sugarcane jaggery, red apple & roasted hazelnut.',
  description: 'Shade-grown at 1,750m in the Baba Budan Giri range of Chikmagalur, Karnataka.',
  category_name: 'Indian Micro-Lots',
  origin_country: 'India',
  region: 'Chikmagalur, Karnataka',
  farm_or_coop: 'Attikan Estate',
  altitude_meters: 1750,
  variety: 'S.795 & SLN 9',
  process_method: 'HONEY',
  roast_level: 'MEDIUM_LIGHT',
  tasting_notes: ['Jaggery', 'Red Apple'],
  image_url: 'https://example.com/a.jpg',
  is_active: true,
  variants: [
    { id: 'v1', sku: 'A-250', weight_grams: 250, price_cents: 1850, grind_options: ['WHOLE_BEAN'], is_active: true, stock_quantity: 80 },
    { id: 'v2', sku: 'A-500', weight_grams: 500, price_cents: 3400, grind_options: ['POUR_OVER'], is_active: true, stock_quantity: 0 },
  ],
};

const parseLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]));

test('seo: every JSON-LD block on a product page is valid JSON', () => {
  const blocks = parseLd(productPage(PRODUCT, '/assets/x.css'));
  assert.ok(blocks.length >= 2, 'expected Product and BreadcrumbList');
  assert.deepEqual(blocks.map((b) => b['@type']).sort(), ['BreadcrumbList', 'Product']);
});

test('seo: the page is canonical to itself, not to the homepage', () => {
  // Copying the homepage's `<link rel="canonical" href="https://dailyroast.in/">` into these
  // pages would point all ten at "/" and waste the entire exercise.
  const html = productPage(PRODUCT, '/assets/x.css');
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)![1];
  assert.equal(canonical, `https://dailyroast.in/coffee/${PRODUCT.slug}`);
});

test('seo: every marked-up price appears as text on the page', () => {
  // A price in structured data that disagrees with the page is worse than no structured data:
  // search engines surface the marked-up figure and shoppers arrive expecting it.
  const html = productPage(PRODUCT, '/assets/x.css');
  const schema: any = parseLd(html).find((b) => b['@type'] === 'Product');
  const offers = schema.offers['@type'] === 'Offer' ? [schema.offers] : schema.offers.offers;
  assert.ok(offers.length > 0);
  for (const offer of offers) {
    assert.ok(html.includes(`₹${offer.price}`), `₹${offer.price} is marked up but never shown`);
  }
});

test('seo: prices are derived the same way the storefront derives them', () => {
  // main.ts computes the rupee price as Math.round(price_cents * 0.23). If these ever diverge,
  // the page and the schema disagree with the shop.
  assert.equal(priceInr(1850), Math.round(1850 * 0.23));
  assert.equal(priceInr(3400), Math.round(3400 * 0.23));
});

test('seo: stock state is carried per variant, not assumed in stock', () => {
  const schema: any = parseLd(productPage(PRODUCT, '/assets/x.css')).find((b) => b['@type'] === 'Product');
  const offers = schema.offers.offers;
  assert.equal(offers[0].availability, 'https://schema.org/InStock');
  assert.equal(offers[1].availability, 'https://schema.org/OutOfStock', 'stock_quantity 0 must not be marked InStock');
});

test('seo: no ratings are marked up, because no ratings are shown', () => {
  // Marking up a rating a visitor cannot see on the page is what earns a structured-data penalty.
  const html = productPage(PRODUCT, '/assets/x.css');
  assert.doesNotMatch(html, /aggregateRating|"@type": ?"Review"/);
});

test('seo: product data is escaped before it reaches the markup', () => {
  const hostile = { ...PRODUCT, name: 'Attikan "><script>alert(1)</script>', tagline: 'a & b' };
  const html = productPage(hostile, '/assets/x.css');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, 'product names are API data and must be escaped');
  assert.ok(html.includes('a &amp; b'));
});

test('seo: JSON-LD cannot be closed early by a hostile value', () => {
  // Inside a <script>, the parser looks for `</script` before it looks for JSON.
  const hostile = { ...PRODUCT, description: 'x</script><script>alert(1)</script>' };
  const html = productPage(hostile, '/assets/x.css');
  assert.doesNotMatch(html, /<\/script><script>alert/);
  assert.doesNotThrow(() => parseLd(html));
});

test('seo: the meta description is cut at a word boundary', () => {
  // Slicing blind ended one mid-word ("…with bal"), which is worse than letting the engine cut it.
  const long = { ...PRODUCT, description: 'Shade grown at seventeen hundred and fifty metres in the Baba Budan Giri range of Chikmagalur Karnataka with a pulp sun dried honey process producing a silky medium body and balanced brightness throughout' };
  const desc = metaDescription(long);
  assert.ok(desc.length <= 160, `description is ${desc.length} chars`);

  // Checking "no word character before the ellipsis" was the obvious assertion and it is wrong:
  // a correct cut ends on a complete word, so it always has a word character there. The real
  // question is whether the cut landed *between* words in the source, so ask the source.
  const full = [long.tagline, long.description].join(' ').replace(/\s+/g, ' ').trim();
  const kept = desc.replace(/…$/, '');
  assert.ok(full.startsWith(kept), 'the description must be a prefix of the real text');
  assert.match(full.charAt(kept.length), /[\s.,]/, `cut mid-word: "…${kept.slice(-12)}|${full.slice(kept.length, kept.length + 8)}…"`);
});

test('seo: a product with no optional fields still renders', () => {
  // origin, region, altitude, variety and notes are all nullable in the API.
  const sparse = { slug: 'bare', name: 'Bare Bean', variants: [{ sku: 'B', weight_grams: 250, price_cents: 1000, is_active: true, stock_quantity: 1 }] };
  assert.doesNotThrow(() => productPage(sparse, '/assets/x.css'));
  const schema: any = parseLd(productPage(sparse, '/assets/x.css')).find((b) => b['@type'] === 'Product');
  assert.equal(schema.name, 'Bare Bean');
});

test('seo: the sitemap lists every product page and nothing that 404s', () => {
  const xml = sitemap([PRODUCT, { ...PRODUCT, slug: 'second' }]);
  assert.ok(xml.includes(`<loc>https://dailyroast.in/coffee/${PRODUCT.slug}</loc>`));
  assert.ok(xml.includes('<loc>https://dailyroast.in/coffee/second</loc>'));
  assert.ok(xml.includes('<loc>https://dailyroast.in/</loc>'));
  // Google has stated publicly that it ignores both of these.
  assert.doesNotMatch(xml, /changefreq|priority/);
});

test('seo: llms.txt links every coffee at its own URL', () => {
  const txt = llmsTxt([PRODUCT]);
  assert.ok(txt.includes(`https://dailyroast.in/coffee/${PRODUCT.slug}`));
  assert.ok(txt.startsWith('# The Daily Roast'));
});

test('seo: the collection page links out to each coffee', () => {
  // Pages reachable only from sitemap.xml index poorly, so /coffee/ must actually link them.
  const html = indexPage([PRODUCT], '/assets/x.css');
  assert.ok(html.includes(`href="/coffee/${PRODUCT.slug}"`));
});

// ------------------------------------------------------------ the homepage's own structured data

test('seo: the homepage schema parses and describes one business, not two', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const blocks = parseLd(html);
  assert.ok(blocks.length >= 2);
  const types = blocks.map((b) => b['@type']);
  assert.ok(types.includes('CafeOrCoffeeShop'), 'local results read the LocalBusiness type, not Organization');
  assert.ok(types.includes('WebSite'));
  assert.ok(!types.includes('Organization'),
    'a bare Organization block alongside CafeOrCoffeeShop splits one business into two entities');
});

test('seo: the homepage claims no opening hours or coordinates it cannot support', () => {
  // Both were written speculatively and removed: the site states no hours anywhere, and the
  // coordinates were invented. Publishing either as structured data asserts a fact about a real
  // physical location on no evidence.
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /openingHoursSpecification|GeoCoordinates/);
});

test('seo: the catalog links to the generated pages', () => {
  // Without this the ten pages are orphans that only sitemap.xml knows about.
  const main = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
  assert.match(main, /href="\/coffee\/\$\{this\.escapeHtml\(prod\.slug\)\}"/);
});
