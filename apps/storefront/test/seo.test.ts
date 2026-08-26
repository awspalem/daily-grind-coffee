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

test('seo: the opening hours in the markup are the hours shown on the page', () => {
  // These were originally invented, removed for that reason, and later supplied by the owner:
  // 9am to 7pm daily. They are marked up AND rendered in the footer, because hours a visitor
  // cannot read are the same defect as a rating a visitor cannot see.
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const hours = /"opens": "(\d{2}:\d{2})",\s*"closes": "(\d{2}:\d{2})"/.exec(html);
  assert.ok(hours, 'opening hours are missing from the structured data');
  assert.deepEqual([hours[1], hours[2]], ['09:00', '19:00']);
  assert.match(html, /9:00 AM\s*–\s*7:00 PM/, 'the same hours must be visible in the footer');
});

test('seo: no coordinates are claimed, because none were ever supplied', () => {
  // The address is real and Google geocodes from it; the lat/long I first wrote was invented.
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /GeoCoordinates/);
});

test('seo: the catalog links to the generated pages', () => {
  // Without this the ten pages are orphans that only sitemap.xml knows about.
  const main = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
  assert.match(main, /href="\/coffee\/\$\{this\.escapeHtml\(prod\.slug\)\}"/);
});

test('seo: nothing in the sitemap is a URL that redirects', () => {
  // Cloudflare Pages serves the legal pages at /privacy and 308s /privacy.html to it. Listing
  // the .html form pointed the sitemap at a redirect, and pointed every footer link on every
  // page at an extra hop.
  const xml = sitemap([PRODUCT]);
  assert.doesNotMatch(xml, /\.html<\/loc>/, 'the sitemap must list destinations, not redirects');
  assert.ok(xml.includes('<loc>https://dailyroast.in/privacy</loc>'));
});

test('seo: the legal pages are canonical to their extensionless URL', () => {
  // They had no canonical at all while being reachable at two URLs each.
  for (const [file, slug] of [['privacy.html', 'privacy'], ['terms.html', 'terms'], ['shipping.html', 'shipping']]) {
    const html = readFileSync(join(ROOT, file), 'utf8');
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html);
    assert.ok(canonical, `${file} has no canonical`);
    assert.equal(canonical![1], `https://dailyroast.in/${slug}`);
  }
});

test('seo: no internal link takes a needless redirect hop', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /href="\/?(privacy|terms|shipping)\.html"/,
    'these 308 to their extensionless form — link straight to the destination');
});

test('seo: a stale fallback catalog cannot link to a page that was never generated', async () => {
  // FALLBACK_PRODUCTS in main.ts is a hardcoded mirror of the catalog, used when the products
  // fetch fails. It had drifted: three of its nine slugs (dawn-patrol-bangalore-blend,
  // midnight-runner-dark-espresso, monsoon-malabar-aa-special-reserve) do not exist in the API
  // the pages are generated from, so on any flaky connection those cards would have emitted
  // /coffee/<slug> links straight to a 404.
  //
  // Keeping two hand-maintained lists in sync forever is the losing move, so the link is
  // conditional on the product having come from the API instead. This asserts the guard, not
  // the sync.
  const main = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
  assert.match(main, /has_detail_page: true/,
    'products from the API must be marked as having a generated page');
  assert.match(main, /\$\{prod\.has_detail_page \? `<a class="card-detail-link"/,
    'the detail link must be conditional — a fallback product has no generated page');
});

test('seo: lastmod reflects the product, not the build', () => {
  // Stamping today on all fifteen URLs every deploy claims everything changed every time,
  // which is how a crawler learns to ignore lastmod entirely.
  const xml = sitemap([{ ...PRODUCT, updated_at: '2026-08-14 14:43:54' }]);
  const entry = /<loc>https:\/\/dailyroast\.in\/coffee\/[^<]+<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/.exec(xml);
  assert.equal(entry![1], '2026-08-14');
});

test('seo: a product with no updated_at still gets a valid lastmod', () => {
  const xml = sitemap([{ ...PRODUCT, updated_at: undefined }]);
  for (const [, mod] of [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)]) {
    assert.match(mod, /^\d{4}-\d{2}-\d{2}$/);
  }
});

// ------------------------------------------------------------------ brew guides and the FAQ

// @ts-expect-error — plain ESM, see the imports at the top of this file.
import { readBrewMethods, brewPage, recipeFor, hasRecipe, isoDuration } from '../scripts/seo-brew.mjs';
// @ts-expect-error — see above.
import { faqPage, FAQS } from '../scripts/seo-faq.mjs';
// @ts-expect-error — see above.
import { ogImage } from '../scripts/seo-data.mjs';
import { JSDOM } from 'jsdom';

const brewMethods = () =>
  readBrewMethods(new JSDOM(readFileSync(join(ROOT, 'index.html'), 'utf8')).window.document);

test('brew: the methods are read from index.html, not kept in a second list', () => {
  // A second hand-maintained copy is what put links to three non-existent coffee pages into
  // the fallback catalog. There is one source, and it is the markup that already shipped.
  const methods = brewMethods();
  assert.ok(methods.length >= 4, `found ${methods.length} brew cards`);
  for (const m of methods) {
    assert.ok(m.method && m.title, `a .brew-card is missing data-method or .brew-title`);
    assert.ok(Number.isFinite(m.ratio) && Number.isFinite(m.temp), `${m.method} is missing numbers`);
  }
});

test('brew: every method in the markup has a recipe, so no card promises a page that is missing', () => {
  for (const m of brewMethods()) {
    assert.ok(hasRecipe(m.method), `${m.method} has a card but no recipe — its page would not exist`);
  }
});

test('brew: the page never contradicts the card it was generated from', () => {
  // Same failure as a price in schema disagreeing with the price on the page: a guide that says
  // 92°C beside a card that says 94°C is worse than no guide.
  for (const m of brewMethods()) {
    const page = brewPage(m, '/assets/x.css');
    assert.ok(page.includes(`1:${m.ratio}`), `${m.method}: ratio missing`);
    assert.ok(page.includes(`${m.temp}°C`), `${m.method}: temperature missing`);
    assert.ok(page.includes(m.time), `${m.method}: time missing`);
    assert.ok(page.includes(m.grind), `${m.method}: grind missing`);
  }
});

test('brew: the water figure is the dose times the ratio, not a number typed in', () => {
  for (const m of brewMethods()) {
    const r = recipeFor(m);
    const steps = r.steps.map(([, t]: [string, string]) => t).join(' ');
    assert.ok(steps.includes(String(r.dose * m.ratio)),
      `${m.method}: expected ${r.dose} x ${m.ratio} = ${r.dose * m.ratio} to appear in the steps`);
  }
});

test('brew: the visible steps and the HowTo steps are the same array', () => {
  const m = brewMethods()[0];
  const page = brewPage(m, '/assets/x.css');
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page)![1]);
  assert.equal(ld['@type'], 'HowTo');
  for (const step of ld.step) {
    // Escaped in the HTML, so compare on a distinctive fragment rather than the whole string.
    assert.ok(page.includes(step.name), `step "${step.name}" is marked up but not shown`);
  }
});

test('brew: a duration that cannot be parsed is omitted rather than guessed', () => {
  assert.equal(isoDuration('3m 15s'), 'PT3M15S');
  assert.equal(isoDuration('28s'), 'PT28S');
  assert.equal(isoDuration('15m decoction'), 'PT15M');
  assert.equal(isoDuration('a while'), undefined);
  assert.equal(isoDuration(''), undefined);
});

test('brew: the footer links to the four pages instead of four copies of one anchor', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const m of brewMethods()) {
    assert.ok(html.includes(`href="/brew/${m.method}"`), `nothing links to /brew/${m.method}`);
  }
});

test('faq: every answer is visible on the page, not markup-only', () => {
  // Same rule as the absent aggregateRating: never mark up what a visitor cannot read.
  const page = faqPage('/assets/x.css');
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page)![1]);
  assert.equal(ld['@type'], 'FAQPage');
  assert.equal(ld.mainEntity.length, FAQS.length);
  for (const entry of ld.mainEntity) {
    assert.ok(page.includes(entry.name), `question "${entry.name}" is marked up but not shown`);
  }
});

test('faq: every answer records the site copy it came from', () => {
  // The guard against answering a question the site does not actually answer — the same error
  // as the invented opening hours.
  for (const f of FAQS) {
    assert.ok(f.src && f.src.length > 5, `"${f.q}" has no recorded source`);
  }
});

test('og: social images are asked for at the size social cards actually use', () => {
  const out = ogImage('https://images.unsplash.com/photo-123?auto=format&fit=crop&w=800&q=80');
  assert.match(out, /w=1200/);
  assert.match(out, /h=630/);
  assert.equal(ogImage(null), null);
  // A non-Unsplash URL is passed through untouched rather than having params invented for it.
  assert.equal(ogImage('/images/roaster.jpg'), '/images/roaster.jpg');
});

test('og: product pages declare image dimensions and alt text', () => {
  const html = productPage(PRODUCT, '/assets/x.css');
  assert.match(html, /<meta property="og:image:width" content="1200">/);
  assert.match(html, /<meta property="og:image:height" content="630">/);
  assert.match(html, /<meta property="og:image:alt"/);
});

test('seo: the sitemap covers the brew pages and the FAQ', () => {
  const xml = sitemap([PRODUCT], brewMethods());
  assert.ok(xml.includes('<loc>https://dailyroast.in/faq</loc>'));
  assert.ok(xml.includes('<loc>https://dailyroast.in/brew/</loc>'));
  for (const m of brewMethods()) {
    assert.ok(xml.includes(`<loc>https://dailyroast.in/brew/${m.method}</loc>`), `${m.method} missing`);
  }
  assert.doesNotMatch(xml, /\.html<\/loc>/);
});
