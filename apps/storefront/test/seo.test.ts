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
// @ts-expect-error — see above. Agent capability surface (Maya discovery).
import { agentCapabilityTxt, agentLandingHtml } from '../scripts/seo-agent.mjs';

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
  // The homepage now also carries an Organization block, but only as the legal-entity root
  // for the roastery: CafeOrCoffeeShop.parentOrganization points at it, and WebSite.publisher
  // points at it. That keeps the four blocks in one entity graph; the failure mode the old
  // assertion was guarding against is an Organization with no link to the cafe.
  if (types.includes('Organization')) {
    const org = blocks.find((b) => b['@type'] === 'Organization') as any;
    const cafe = blocks.find((b) => b['@type'] === 'CafeOrCoffeeShop') as any;
    const site = blocks.find((b) => b['@type'] === 'WebSite') as any;
    assert.ok(org['@id'], 'the Organization block must carry an @id so it can be linked');
    assert.equal(cafe.parentOrganization?.['@id'], org['@id'],
      'CafeOrCoffeeShop must declare its parent Organization by @id');
    assert.equal(site.publisher?.['@id'], org['@id'],
      'WebSite.publisher must resolve to the Organization @id');
  }
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

// --------------------------------------------------------------- homepage ItemList and Organization

test('seo: the homepage ItemList covers the 10 catalog coffees in order', () => {
  // The catalog is generated at build time, but the homepage is a hand-edited SPA. The ItemList
  // is the bridge: it has to list the same 10 slugs, in the same order, with the public name and
  // a description, or the entity graph from the homepage dead-ends at the homepage.
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const blocks: any[] = parseLd(html);
  const list = blocks.find((b) => b['@type'] === 'ItemList');
  assert.ok(list, 'no ItemList block on the homepage');
  assert.equal(list.numberOfItems, 10);
  assert.equal(list.itemListOrder, 'https://schema.org/ItemListOrderAscending');
  assert.equal(list.itemListElement.length, 10);
  for (let i = 0; i < list.itemListElement.length; i++) {
    const item = list.itemListElement[i];
    assert.equal(item['@type'], 'ListItem');
    assert.equal(item.position, i + 1, `item ${i + 1} must be position ${i + 1}`);
    assert.ok(item.name, `item ${i + 1} is missing a name`);
    assert.match(item.url, /^https:\/\/dailyroast\.in\/coffee\/[a-z0-9-]+$/,
      `item ${i + 1} url ${item.url} is not a /coffee/<slug> URL`);
    assert.ok(item.description, `item ${i + 1} is missing a description (use the existing tagline)`);
  }
  // Positions are strictly increasing and consecutive.
  for (let i = 1; i < list.itemListElement.length; i++) {
    assert.equal(list.itemListElement[i].position - list.itemListElement[i - 1].position, 1);
  }
});

test('seo: the homepage Organization carries social profiles, logo, and a reachable @id', () => {
  // The Organization block is the legal-entity root that holds the social profiles (which the
  // CafeOrCoffeeShop type does not accept) and the @id the other blocks link to.
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const blocks: any[] = parseLd(html);
  const org = blocks.find((b) => b['@type'] === 'Organization');
  assert.ok(org, 'no Organization block on the homepage');
  assert.equal(org['@id'], 'https://dailyroast.in/#organization');
  assert.ok(org.name && org.url, 'Organization must carry name and url');
  assert.ok(Array.isArray(org.logo) && org.logo.length >= 2, 'logo should be an array with svg + 512 png');
  assert.ok(org.logo.includes('https://dailyroast.in/favicon.svg'));
  assert.ok(org.logo.includes('https://dailyroast.in/icon-512.png'));
  assert.ok(org.email && org.telephone, 'Organization must carry email and telephone');
  // sameAs is the whole point of having an Organization block: it lets a Knowledge Panel merge
  // duplicate social profiles into one entity.
  assert.ok(Array.isArray(org.sameAs) && org.sameAs.length >= 5,
    'sameAs must list at least five social profiles');
  const joined = org.sameAs.join(' ');
  for (const needle of [
    'instagram.com/dailyroast.in',
    'facebook.com/dailyroast.in',
    'x.com/dailyroast_in',
    'linkedin.com/company/the-daily-roast',
    'youtube.com/@dailyroast',
  ]) {
    assert.ok(joined.includes(needle), `sameAs is missing ${needle}`);
  }
});

test('seo: the catalog index page emits an ItemList whose items are full Product objects', () => {
  // An LLM scraping /coffee/ should get the full Product graph in one document, not have to
  // dereference ten URLs (and risk a partial graph if any one is rate-limited). Schema.org
  // allows nesting entities through `item`, so the Product is the value, not a string.
  const html = indexPage([PRODUCT, { ...PRODUCT, slug: 'second' }], '/assets/x.css');
  const blocks: any[] = parseLd(html);
  const types = blocks.map((b) => b['@type']);
  assert.ok(types.includes('CollectionPage'), 'the catalog page still emits a CollectionPage');
  assert.ok(types.includes('ItemList'), 'the catalog page now also emits a top-level ItemList');
  const productList = blocks.find((b) => b['@type'] === 'ItemList' &&
    Array.isArray(b.itemListElement) && b.itemListElement[0]?.item);
  assert.ok(productList, 'no ItemList whose items carry the full Product object');
  assert.equal(productList.itemListElement.length, 2);
  for (let i = 0; i < productList.itemListElement.length; i++) {
    const li = productList.itemListElement[i];
    assert.equal(li['@type'], 'ListItem');
    assert.equal(li.position, i + 1);
    assert.equal(li.item['@type'], 'Product', 'item must be a full Product, not a URL string');
    assert.equal(li.url, li.item.url, 'the ListItem url must match the nested Product url');
    assert.ok(li.item.offers, 'the nested Product must carry offers');
    assert.ok(li.item.name, 'the nested Product must carry a name');
  }
});

test('seo: the sitemap includes image:image for every product with an image', () => {
  // Google Images surfaces sitemap <image:image> entries directly, and the products fetch
  // includes image_url for every active product — so the sitemap has to carry it, not drop it.
  // ns-aware XML parsing matters here: the namespace prefix is `image:`, not the default one.
  const products = [
    { ...PRODUCT, image_url: 'https://cdn.example.com/a.jpg' },
    { ...PRODUCT, slug: 'no-image', image_url: null },
  ];
  const xml = sitemap(products, []);
  // The image namespace must be declared on the root.
  assert.match(xml, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
  // The product with an image gets one <image:image> entry; the one without does not.
  const withImage = xml.match(/<loc>https:\/\/dailyroast\.in\/coffee\/chikmagalur-attikan-estate-honey<\/loc>[\s\S]*?<\/url>/);
  assert.ok(withImage, 'product URL block not found in sitemap');
  assert.match(withImage[0], /<image:image>[\s\S]*<image:loc>https:\/\/cdn\.example\.com\/a\.jpg<\/image:loc>[\s\S]*<\/image:image>/);
  const withoutImage = xml.match(/<loc>https:\/\/dailyroast\.in\/coffee\/no-image<\/loc>[\s\S]*?<\/url>/);
  assert.ok(withoutImage);
  assert.doesNotMatch(withoutImage[0], /<image:image>/);
});

test('seo: the homepage carries the local-SEO and rich-snippet meta tags', () => {
  // Robots directives, author/publisher and the geo.* / ICBM tags all need to be in the head
  // of the homepage. The hand-edited SPA is the only place these get set.
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">/);
  assert.match(html, /<meta name="author" content="The Daily Roast">/);
  assert.match(html, /<meta name="publisher" content="The Daily Roast">/);
  assert.match(html, /<meta name="geo\.region" content="IN-KA">/);
  assert.match(html, /<meta name="geo\.placename" content="Bangalore">/);
  assert.match(html, /<meta name="geo\.position" content="12\.9716;77\.6412">/);
  assert.match(html, /<meta name="ICBM" content="12\.9716, 77\.6412">/);
  // og:image dimensions, alt, type and locale for the social cards.
  assert.match(html, /<meta property="og:image:width" content="1200">/);
  assert.match(html, /<meta property="og:image:height" content="630">/);
  assert.match(html, /<meta property="og:image:alt"/);
  assert.match(html, /<meta property="og:image:type" content="image\/jpeg">/);
  assert.match(html, /<meta property="og:locale" content="en_IN">/);
  assert.match(html, /<meta property="og:locale:alternate" content="en_US">/);
});

test('seo: the legal pages are stamped 2026-01-15 in the sitemap, not today', () => {
  // Stamping today on the legal pages every build claimed /privacy changes on every deploy.
  // The legal copy changes on a long cycle, so a fixed lastmod is more honest.
  const xml = sitemap([], []);
  for (const path of ['/shipping', '/privacy', '/terms']) {
    const block = xml.match(new RegExp(`<loc>https:\\/\\/dailyroast\\.in${path}<\\/loc>[\\s\\S]*?<\\/url>`));
    assert.ok(block, `${path} not in sitemap`);
    assert.match(block[0], /<lastmod>2026-01-15<\/lastmod>/);
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
  const blocks = parseLd(page);
  const howTo = blocks.find((b: any) => b['@type'] === 'HowTo');
  assert.ok(howTo, 'expected a HowTo JSON-LD block on the brew page');
  for (const step of howTo.step) {
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

test('seo: the Search Console verification tag is still in the homepage head', () => {
  // Google re-checks this periodically. Losing it in a refactor un-verifies the property, which
  // silently cuts off indexing data and the ability to submit sitemaps — and nothing else in the
  // build would notice.
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const tag = /<meta name="google-site-verification" content="([^"]+)">/.exec(html);
  assert.ok(tag, 'the google-site-verification meta tag is missing');
  assert.equal(tag![1], 'M2ZhVCVSu1Pw3NQTufnYieht7RZf6226kzyQogzsklM');
  assert.ok(html.indexOf(tag![0]) < html.indexOf('</head>'), 'it must be inside <head>');
});

// ----------------------------------------------------------------------- agent discovery

test('agent: agent.txt is well-formed and contains every discovery endpoint', () => {
  // The body is the entire point: an autonomous agent reading /agent.txt must be able to
  // find every endpoint it needs (MCP descriptor, card, OpenAPI, tools list, llms.txt)
  // without reading any other file.
  const txt = agentCapabilityTxt();
  assert.ok(txt.startsWith('# The Daily Roast — Agent Capability Card'),
    'agent.txt must start with the H1 title so a parser that picks the first line gets a name');
  for (const url of [
    'https://api.dailyroast.in/api/agent/card',
    'https://api.dailyroast.in/api/agent/tools',
    'https://api.dailyroast.in/api/agent/openapi.json',
    'https://api.dailyroast.in/.well-known/mcp.json',
    'https://api.dailyroast.in/api/agent/manifest.json',
    'https://dailyroast.in/llms.txt',
    'https://dailyroast.in/llms-full.txt',
    'https://dailyroast.in/sitemap.xml',
    'https://api.dailyroast.in/api/agent/chat',
    'https://api.dailyroast.in/api/agent/tools/propose_add_to_cart/schema.json',
  ]) {
    assert.ok(txt.includes(url), `agent.txt is missing ${url}`);
  }
  // The chat endpoint is the headline: an agent that reads this and cannot call /api/agent/chat
  // has been given nothing.
  assert.match(txt, /POST https:\/\/api\.dailyroast\.in\/api\/agent\/chat/);
  assert.match(txt, /propose_add_to_cart/);
  // Authentication guidance is in the file: the chat endpoint is anonymous but rate-limited.
  assert.match(txt, /X-Customer-Session/);
});

test('agent: agent.txt documents authentication, CORS, and rate limits', () => {
  // The file should not just list URLs — it should tell a caller the constraints (CORS,
  // turnstile, session auth) that the runtime will enforce. An agent that learns about
  // the rate limit from a 429 is one that has already burned part of its budget.
  const txt = agentCapabilityTxt();
  assert.match(txt, /CORS|Access-Control-Allow-Origin/i, 'CORS guidance missing');
  assert.match(txt, /Turnstile/i, 'Turnstile mention missing');
  assert.match(txt, /rate-limit/i, 'rate-limit mention missing');
});

test('agent: agent.html is a minimal landing page that meta-refreshes to /agent.txt', () => {
  // /agent.txt is the canonical surface; /agent.html is a fallback for clients that
  // follow links but not text files. It must redirect, list the endpoints as anchors,
  // and be self-canonical so the HTML form is not indexed alongside the text form.
  const html = agentLandingHtml();
  assert.match(html, /<meta http-equiv="refresh" content="0; url=\/agent\.txt">/,
    'agent.html must meta-refresh to /agent.txt');
  assert.match(html, /<link rel="canonical" href="https:\/\/dailyroast\.in\/agent\.html">/,
    'agent.html must self-canonical so it does not compete with /agent.txt');
  assert.match(html, /<link rel="alternate" type="text\/plain" href="https:\/\/dailyroast\.in\/agent\.txt" title="[^"]*">/,
    'agent.html must advertise /agent.txt as a text/plain alternate');
  for (const url of [
    '/api/agent/card',
    '/api/agent/tools',
    '/api/agent/openapi.json',
    '/.well-known/mcp.json',
    '/api/agent/manifest.json',
  ]) {
    assert.ok(html.includes(url), `agent.html is missing link to ${url}`);
  }
});

test('agent: generate-seo.mjs emits both /agent.txt and /agent.html in the build', () => {
  // The build wires the capability surface into dist/. The discovery text file is what
  // an agent will actually fetch; the HTML page is how a browser-resident bot finds it
  // without modifying the owned index.html. Both must be present after a build.
  const generate = readFileSync(join(ROOT, 'scripts', 'generate-seo.mjs'), 'utf8');
  assert.match(generate, /agentCapabilityTxt\(\)/, 'generate-seo.mjs must call agentCapabilityTxt()');
  assert.match(generate, /agentLandingHtml\(\)/, 'generate-seo.mjs must call agentLandingHtml()');
  assert.match(generate, /['"]agent\.txt['"]/, 'generate-seo.mjs must write dist/agent.txt');
  assert.match(generate, /['"]agent\.html['"]/, 'generate-seo.mjs must write dist/agent.html');
});

// ----------------------------------------------------------------- Recipe / HowTo rich results
//
// The brew pages now carry a Recipe block (Google recipe carousels) and a HowTo block
// (how-to rich results) as two separate <script type="application/ld+json"> tags. Both
// have to be valid JSON, and the fields the engines actually index — recipeIngredient,
// recipeInstructions, hasCourseInstance, etc. — must be present and well-typed.

test('brew: every brew page emits a Recipe block with the engine-indexed fields', () => {
  for (const m of brewMethods()) {
    const page = brewPage(m, '/assets/x.css');
    const blocks: any[] = parseLd(page);
    const recipe = blocks.find((b) => b['@type'] === 'Recipe');
    assert.ok(recipe, `${m.method}: no Recipe JSON-LD block`);
    assert.equal(recipe['@context'], 'https://schema.org');
    assert.equal(recipe.name, m.title);
    assert.equal(recipe.recipeCategory, 'Coffee');
    assert.equal(recipe.recipeCuisine, 'Coffee');
    // recipeIngredient must be an array, with both the coffee and the water described in
    // a way a parser can recognise (number + unit + description).
    assert.ok(Array.isArray(recipe.recipeIngredient), 'recipeIngredient must be an array');
    assert.ok(recipe.recipeIngredient.length >= 2, 'recipe must list coffee and water');
    const joined = recipe.recipeIngredient.join(' ').toLowerCase();
    assert.match(joined, /coffee/, 'recipeIngredient must mention coffee');
    assert.match(joined, /water/, 'recipeIngredient must mention water');
    // recipeInstructions is an array of HowToStep with @type, name, text.
    assert.ok(Array.isArray(recipe.recipeInstructions));
    for (const step of recipe.recipeInstructions) {
      assert.equal(step['@type'], 'HowToStep');
      assert.ok(step.name && step.text, 'every step must have a name and text');
    }
    // Author and publisher are both the Daily Roast, and datePublished is the static
    // stamp the brief asks for.
    assert.equal(recipe.author.name, 'The Daily Roast');
    assert.equal(recipe.publisher.name, 'The Daily Roast');
    assert.equal(recipe.datePublished, '2025-01-15');
    // The nutrition block is the reason Google started showing a "calories" column
    // for black coffee, so it has to be there and well-shaped.
    assert.equal(recipe.nutrition['@type'], 'NutritionInformation');
    assert.match(recipe.nutrition.calories, /kcal/);
  }
});

test('brew: every brew page emits a HowTo block with a numbered step array and cost', () => {
  // Same data shape as the visible list, so the answer a reader sees and the answer a
  // machine reads cannot diverge. estimatedCost is a MonetaryAmount in INR.
  for (const m of brewMethods()) {
    const page = brewPage(m, '/assets/x.css');
    const blocks: any[] = parseLd(page);
    const howTo = blocks.find((b) => b['@type'] === 'HowTo');
    assert.ok(howTo, `${m.method}: no HowTo JSON-LD block`);
    assert.equal(howTo['@context'], 'https://schema.org');
    assert.match(howTo.name, new RegExp(m.title, 'i'));
    assert.ok(Array.isArray(howTo.step) && howTo.step.length >= 3, 'HowTo must have a step array');
    let last = 0;
    for (const step of howTo.step) {
      assert.equal(step['@type'], 'HowToStep');
      assert.equal(typeof step.position, 'number');
      assert.ok(step.position > last, 'positions must be strictly increasing from 1');
      last = step.position;
      assert.ok(step.name && step.text, 'every HowTo step must have a name and text');
    }
    assert.equal(howTo.estimatedCost['@type'], 'MonetaryAmount');
    assert.equal(howTo.estimatedCost.currency, 'INR');
    assert.ok(howTo.estimatedCost.value, 'estimatedCost.value must be present');
  }
});

test('brew: the Recipe and HowTo blocks on the same page cover the same steps', () => {
  // The visible list and both blocks should not drift: same step count, same names.
  for (const m of brewMethods()) {
    const page = brewPage(m, '/assets/x.css');
    const blocks: any[] = parseLd(page);
    const recipe = blocks.find((b) => b['@type'] === 'Recipe');
    const howTo = blocks.find((b) => b['@type'] === 'HowTo');
    assert.ok(recipe && howTo, `${m.method}: missing one of Recipe/HowTo`);
    assert.equal(recipe.recipeInstructions.length, howTo.step.length, 'step counts must match');
    for (let i = 0; i < recipe.recipeInstructions.length; i++) {
      assert.equal(recipe.recipeInstructions[i].name, howTo.step[i].name,
        `step ${i + 1} name differs between Recipe and HowTo`);
    }
  }
});

test('faq: every Q&A is in the FAQPage schema, with the right shape and count', () => {
  // Same guard as the coffee pages: never mark up what a visitor cannot read. The
  // page already has a visible Q&A list per FAQS, so the schema must have one entry
  // per FAQS row, each shaped like a Question/Answer pair.
  const page = faqPage('/assets/x.css');
  const blocks: any[] = parseLd(page);
  const faq = blocks.find((b) => b['@type'] === 'FAQPage');
  assert.ok(faq, 'expected an FAQPage JSON-LD block');
  assert.equal(faq['@context'], 'https://schema.org');
  assert.equal(faq.mainEntity.length, FAQS.length,
    `expected ${FAQS.length} mainEntity entries, found ${faq.mainEntity.length}`);
  for (let i = 0; i < FAQS.length; i++) {
    const q = faq.mainEntity[i];
    assert.equal(q['@type'], 'Question');
    assert.equal(q.name, FAQS[i].q);
    assert.equal(q.acceptedAnswer['@type'], 'Answer');
    assert.equal(q.acceptedAnswer.text, FAQS[i].a);
  }
});

// ----------------------------------------------------------------- Experience / Course pages

// @ts-expect-error — plain ESM, see the imports at the top of this file.
import { experiencePage, experiencesIndexPage, courseSchema, fetchExperiences, summarize } from '../scripts/seo-experiences.mjs';

const EXPERIENCE = {
  id: 'exp_tour_roastery',
  slug: 'roastery-tour',
  name: 'Roastery Tour',
  tagline: 'Green bean to first crack, with the drum running.',
  description: 'Ninety minutes on the roastery floor: the green store, the sample roaster, a live production roast on the drum, and the cooling tray. Ends with a cup of whatever came off the roaster that morning.',
  experience_type: 'ROASTERY_TOUR',
  mode: 'ONSITE',
  duration_minutes: 90,
  is_multi_day: 0,
  default_capacity: 12,
  price_cents: 150000,
  deposit_cents: 0,
  currency: 'inr',
  entitlement_code: 'TOUR_SEAT',
  cancellation_cutoff_hours: 24,
  cancellation_policy: 'Free to reschedule or cancel up to 24 hours before the tour.',
  refund_on_cancel: 1,
  location_name: 'The Daily Roast Roastery',
  location_address: 'Survey 42, Coffee Board Road, Bengaluru 560001',
  image_url: 'https://example.com/roastery.jpg',
  status: 'ACTIVE',
};

const TELECONSULT = {
  ...EXPERIENCE,
  id: 'exp_consult_15',
  slug: 'barista-teleconsultation',
  name: '15-Minute Barista Teleconsultation',
  duration_minutes: 15,
  price_cents: 90000,
  location_name: null,
  location_address: null,
  experience_type: 'TELECONSULT',
  mode: 'VIDEO',
};

test('experiences: each experience page emits a Course block with provider, offers and courseMode', () => {
  for (const e of [EXPERIENCE, TELECONSULT]) {
    const page = experiencePage(e, '/assets/x.css');
    const blocks: any[] = parseLd(page);
    const course = blocks.find((b) => b['@type'] === 'Course');
    assert.ok(course, `${e.slug}: no Course JSON-LD block`);
    assert.equal(course['@context'], 'https://schema.org');
    assert.equal(course.name, e.name);
    assert.equal(course.provider['@type'], 'Organization');
    assert.equal(course.provider.name, 'The Daily Roast');
    assert.equal(course.provider.sameAs, 'https://dailyroast.in/');
    // The price has to be the same as on the page — schema-vs-page drift is the
    // failure mode the product tests already pin.
    const onPage = new RegExp(`₹${course.offers.price}`).test(page);
    assert.ok(onPage, `price ${course.offers.price} must appear as text on the page`);
    assert.equal(course.offers.priceCurrency, 'INR');
    // ONSITE ⇒ "onsite", VIDEO ⇒ "online". Educational level follows the
    // experience_type mapping and defaults to "beginner".
    assert.equal(course.courseMode, e.mode === 'VIDEO' ? 'online' : 'onsite');
    assert.equal(course.educationalLevel, e.experience_type === 'CUPPING_SESSION' ? 'intermediate'
      : e.experience_type === 'ESTATE_VISIT' ? 'advanced' : 'beginner');
    // The instance is the schedule + location. Even with no slots surfaced we
    // still emit one — the page is a stub the SPA fills in.
    assert.ok(course.hasCourseInstance, 'Course must have a hasCourseInstance');
  }
});

test('experiences: the experience page has a Course-shaped breadcrumb and a real breadcrumb bar', () => {
  const page = experiencePage(EXPERIENCE, '/assets/x.css');
  const blocks: any[] = parseLd(page);
  const crumb = blocks.find((b) => b['@type'] === 'BreadcrumbList');
  assert.ok(crumb, 'expected a BreadcrumbList JSON-LD block');
  assert.equal(crumb.itemListElement.length, 3);
  assert.deepEqual(
    crumb.itemListElement.map((c: any) => c.name),
    ['Home', 'Experiences', EXPERIENCE.name],
  );
  // The visible breadcrumb matches the schema so a screen reader reads the same
  // trail the engine does.
  assert.match(page, /<a href="\/">Home<\/a> · <a href="\/experiences\/">Experiences<\/a> · <span>Roastery Tour<\/span>/);
});

test('experiences: the index page lists every experience with a CollectionPage schema', () => {
  const html = experiencesIndexPage([EXPERIENCE, TELECONSULT], '/assets/x.css');
  const blocks: any[] = parseLd(html);
  const col = blocks.find((b) => b['@type'] === 'CollectionPage');
  assert.ok(col, 'expected a CollectionPage JSON-LD block');
  assert.equal(col.mainEntity.numberOfItems, 2);
  assert.deepEqual(
    col.mainEntity.itemListElement.map((i: any) => i.url),
    [
      'https://dailyroast.in/experiences/roastery-tour',
      'https://dailyroast.in/experiences/barista-teleconsultation',
    ],
  );
  // The visible list links to each page so a crawler finds them without the
  // sitemap having been updated yet.
  assert.ok(html.includes('href="/experiences/roastery-tour"'));
  assert.ok(html.includes('href="/experiences/barista-teleconsultation"'));
});

test('experiences: the Course block is valid JSON and round-trips through JSON.parse', () => {
  // The whole point of escaping < and > inside the script block is that the embedded
  // JSON parses cleanly — and "valid JSON" was a hard rule.
  for (const e of [EXPERIENCE, TELECONSULT]) {
    const schema = courseSchema(e);
    const json = JSON.stringify(schema);
    const round = JSON.parse(json);
    assert.equal(round['@type'], 'Course');
    assert.equal(round.provider.name, 'The Daily Roast');
  }
});

test('experiences: a hostile experience name does not break out of the JSON-LD block', () => {
  // The same defence as the product pages: never let API data close the <script>
  // element early. The existing jsonLd() helper handles this — the test just pins
  // the contract.
  const hostile = { ...EXPERIENCE, name: 'Tour "><script>alert(1)</script>', description: 'a</script>test' };
  const page = experiencePage(hostile, '/assets/x.css');
  assert.doesNotMatch(page, /<\/script><script>alert/);
  assert.doesNotThrow(() => parseLd(page));
});

test('experiences: summarize() truncates at a word boundary, never mid-word', () => {
  // Same reason metaDescription does it: a description that ends "with bal" is
  // worse than letting the engine truncate.
  const long = 'Shade grown at seventeen hundred and fifty metres in the Baba Budan Giri range of Chikmagalur Karnataka with a pulp sun dried honey process producing a silky medium body and balanced brightness throughout';
  const out = summarize(long, 80);
  assert.ok(out.length <= 82, `summary is ${out.length} chars`);
  const kept = out.replace(/…$/, '');
  assert.ok(long.startsWith(kept), 'summary must be a prefix of the source');
});

// ------------------------------------------------------------------------------------------
// Discoverability — llms-full.txt, .well-known/, humans.txt, image-sitemap, AI robots.
// These are the files an LLM or agent reaches first; they get tested at the same fidelity
// as the page renderers, because a half-broken agent card is worse than none.
import {
  llmsFullTxt,
  humansTxt,
  securityTxt,
  agentJson,
  mcpJson,
  imageSitemap,
  aiRobotsTxt,
} from '../scripts/seo-discoverability.mjs';

test('discoverability: llmsFullTxt covers every product, every brew, and the FAQ', () => {
  const brewFixture = { method: 'v60', label: 'Hario V60', ratio: '1:16', grind: 'medium-fine', water: '93-94°C', time: '3:00-3:15', steps: ['Bloom 45g for 45s', 'Spiral pour to 240g', 'Drawdown'] };
  const out = llmsFullTxt([PRODUCT, { ...PRODUCT, slug: 'second', name: 'Second Bean' }],
    [brewFixture],
    [{ q: 'How fresh is your coffee?', a: '7-14 days for peak.' }]);
  assert.ok(out.includes(PRODUCT.name), 'every product name is in the catalog');
  assert.ok(out.includes('second'), 'every product slug is in the catalog');
  assert.ok(out.includes('Hario V60'), 'every brew method is in the catalog');
  assert.ok(out.includes('How fresh is your coffee?'), 'FAQ Q is in the catalog');
  assert.ok(out.includes('7-14 days for peak.'), 'FAQ A is in the catalog');
  assert.ok(out.includes('Subscription tiers'), 'subscription tier section is present');
});

test('discoverability: llmsFullTxt escapes hostile product names instead of breaking the doc', () => {
  const hostile = { ...PRODUCT, name: 'Bean<script>alert(1)</script>' };
  const out = llmsFullTxt([hostile], []);
  assert.doesNotMatch(out, /<script>alert\(1\)<\/script>/,
    'product name is data, must be HTML-escaped or omitted in plain text');
});

test('discoverability: humans.txt credits the team and is RFC-style formatted', () => {
  const out = humansTxt();
  assert.match(out, /\/\* TEAM \*\//);
  assert.match(out, /\/\* SITE \*\//);
  assert.match(out, /Last update:/);
});

test('discoverability: security.txt is RFC 9116 compliant', () => {
  const out = securityTxt();
  assert.match(out, /Contact: mailto:security@/);
  assert.match(out, /Expires: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
  assert.match(out, /Canonical: https:\/\/dailyroast\.in\/.well-known\/security\.txt/);
});

test('discoverability: agent.json is valid JSON and points at the chat endpoint', () => {
  const parsed = JSON.parse(agentJson());
  assert.equal(parsed.name, 'Maya');
  assert.match(parsed.endpoints.chat, /^https:\/\/api\.dailyroast\.in\/api\/agent\/chat$/);
  assert.ok(Array.isArray(parsed.tools));
  assert.ok(parsed.tools.some((t: any) => t.name === 'propose_add_to_cart'));
});

test('discoverability: mcp.json declares JSON-RPC 2.0 + a tools list', () => {
  const parsed = JSON.parse(mcpJson());
  assert.equal(parsed.name, 'the-daily-roast-mcp');
  assert.equal(parsed.transport.type, 'http');
  assert.ok(Array.isArray(parsed.tools));
  assert.ok(parsed.tools.some((t: any) => t.name === 'search_products'));
  assert.ok(parsed.tools.some((t: any) => t.name === 'propose_add_to_cart'));
});

test('discoverability: image-sitemap emits one url per product with an image', () => {
  const xml = imageSitemap([PRODUCT, { ...PRODUCT, slug: 'noimg', image_url: null }]);
  assert.match(xml, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
  assert.match(xml, /\/coffee\/chikmagalur-attikan-estate-honey/);
  assert.doesNotMatch(xml, /\/coffee\/noimg/,
    'a product without an image should not appear in the image sitemap');
  assert.match(xml, /<image:loc>https:\/\/example\.com\/a\.jpg<\/image:loc>/);
});

test('discoverability: AI robots.txt explicitly allows every major AI crawler', () => {
  const out = aiRobotsTxt();
  for (const bot of [
    'GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended',
    'Applebot-Extended', 'Meta-ExternalAgent', 'Amazonbot', 'CCBot',
    'cohere-ai', 'DuckAssistBot', 'YouBot', 'anthropic-ai',
  ]) {
    assert.match(out, new RegExp(`User-agent: ${bot}\\b[\\s\\S]*?Allow: \\/`),
      `${bot} must be explicitly allowed`);
  }
  assert.match(out, /Sitemap: https:\/\/dailyroast\.in\/sitemap\.xml/);
  assert.match(out, /Sitemap: https:\/\/dailyroast\.in\/image-sitemap\.xml/);
});

