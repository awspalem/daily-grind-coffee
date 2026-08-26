/**
 * Generates the pages that give this site something to index.
 *
 * The problem this solves is not missing meta tags — those were already fine. It is that the
 * whole shop lived at one URL: ten coffees, five plans and four experiences all behind `#`
 * anchors on `/`, with the catalog fetched client-side, so `curl https://dailyroast.in/` came
 * back with zero product cards. One URL cannot rank for ten different coffees, and nothing —
 * a search engine or an assistant answering "where do I buy Attikan Estate honey-process" —
 * has anything to link to but the homepage.
 *
 * So each coffee gets a real URL with its text served in the HTML. Everything else here
 * (Product/Offer markup, the sitemap, llms.txt) is downstream of that and worth little
 * without it.
 *
 * Runs after `vite build` and writes into dist/, so the generated pages share the hashed
 * stylesheet the rest of the site was built with.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { productPage, indexPage, sitemap, llmsTxt } from './seo-render.mjs';
import { readBrewMethods, brewPage, brewIndexPage, hasRecipe } from './seo-brew.mjs';
import { faqPage } from './seo-faq.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const API = process.env.SEO_API_BASE || 'https://api.dailyroast.in';

/** Products the pages are built from. A failed fetch must stop the build, not quietly ship nothing. */
async function fetchProducts() {
  let res;
  try {
    res = await fetch(`${API}/api/products`, { signal: AbortSignal.timeout(20000) });
  } catch (err) {
    throw new Error(`Could not reach ${API}/api/products (${err.message}). ` +
      'These pages are the site\'s only indexable product content — refusing to build without them.');
  }
  if (!res.ok) throw new Error(`${API}/api/products returned ${res.status}`);
  const body = await res.json();
  const products = (body.products || []).filter((p) => p.is_active !== false && p.slug);
  if (products.length === 0) {
    throw new Error('The products API returned nothing usable. Refusing to emit an empty catalog: ' +
      'a sitemap that loses ten URLs is read as ten pages deliberately removed.');
  }
  return products;
}

/** The hashed stylesheet vite just emitted, so generated pages look like the rest of the site. */
function builtStylesheet() {
  const assets = join(DIST, 'assets');
  const css = readdirSync(assets).filter((f) => f.endsWith('.css')).sort();
  if (css.length === 0) throw new Error('No built stylesheet in dist/assets — run vite build first.');
  return `/assets/${css[0]}`;
}

// ------------------------------------------------------------------------------------------

const products = await fetchProducts();
const css = builtStylesheet();

/**
 * The brew methods are defined once, as .brew-card elements in index.html. Reading them out of
 * the shipped markup rather than keeping a copy here is deliberate: a second hand-maintained
 * list is what put links to three non-existent coffee pages into the fallback catalog.
 */
const brewMethods = readBrewMethods(new JSDOM(readFileSync(join(ROOT, 'index.html'), 'utf8')).window.document);
const withoutRecipe = brewMethods.filter((m) => !hasRecipe(m.method));
if (withoutRecipe.length) {
  throw new Error(`Brew methods in index.html with no recipe in seo-brew.mjs: ` +
    `${withoutRecipe.map((m) => m.method).join(', ')}. Add one, or these methods silently ` +
    `get no page while the card keeps promising a guide.`);
}

mkdirSync(join(DIST, 'coffee'), { recursive: true });
mkdirSync(join(DIST, 'brew'), { recursive: true });
for (const p of products) {
  writeFileSync(join(DIST, 'coffee', `${p.slug}.html`), productPage(p, css));
}
writeFileSync(join(DIST, 'coffee', 'index.html'), indexPage(products, css));

for (const m of brewMethods) writeFileSync(join(DIST, 'brew', `${m.method}.html`), brewPage(m, css));
writeFileSync(join(DIST, 'brew', 'index.html'), brewIndexPage(brewMethods, css));
writeFileSync(join(DIST, 'faq.html'), faqPage(css));

writeFileSync(join(DIST, 'sitemap.xml'), sitemap(products, brewMethods));
writeFileSync(join(DIST, 'llms.txt'), llmsTxt(products, brewMethods));

const urlCount = (sitemap(products, brewMethods).match(/<loc>/g) || []).length;
console.log(`seo: ${products.length} coffee + ${brewMethods.length} brew + faq, ${urlCount} sitemap urls, llms.txt`);
