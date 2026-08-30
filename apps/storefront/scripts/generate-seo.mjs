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
import { readPosts, postPage, blogIndexPage, relatedPosts, coffeeCtaSlugs, blogAsideHtml } from './seo-blog.mjs';
import { faqPage } from './seo-faq.mjs';
import { aeoPage, aeoFeed, aeoSnippetsForPage, aeoAsideHtml } from './seo-aeo.mjs';
import { agentCapabilityTxt, agentLandingHtml } from './seo-agent.mjs';
import { fetchExperiences, experiencePage, experiencesIndexPage } from './seo-experiences.mjs';
import {
  llmsFullTxt,
  humansTxt,
  securityTxt,
  agentJson,
  mcpJson,
  imageSitemap,
  aiRobotsTxt,
} from './seo-discoverability.mjs';

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

/**
 * Two coffees sharing a photograph means they also share an og:image, so the same picture
 * represents both in every link preview. Migration 0018 separated the three pairs that existed;
 * this reports a regression rather than failing the build, because it is a content gap the
 * catalog can legitimately have for a while and no reason to block a deploy.
 */
const byImage = new Map();
for (const p of products) {
  if (!p.image_url) continue;
  const key = p.image_url.split('?')[0];
  byImage.set(key, [...(byImage.get(key) || []), p.slug]);
}
for (const [image, slugs] of byImage) {
  if (slugs.length > 1) {
    console.warn(`seo: WARNING ${slugs.join(' and ')} share one photo (${image.split('/').pop()}) ` +
      `— their social cards will be identical.`);
  }
}
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

/**
 * The journal. Read from apps/storefront/content/blog/*.md — plain Markdown so a post can be
 * added or edited without touching code. A malformed post throws (house style); a future-dated
 * one is held back until its date.
 */
const posts = readPosts(join(ROOT, 'content', 'blog'));

/*
 * A post CTA that points at /coffee/<slug> is only a real link if that product page gets
 * generated, and the product list is a live fetch — so slug correctness is a runtime property.
 * Fail the build on a miss rather than ship a 404 as a post's primary call to action, exactly
 * as the brew-recipe check above refuses a card that promises a guide with no recipe.
 */
const productSlugs = new Set(products.map((p) => p.slug));
const deadCtas = coffeeCtaSlugs(posts).filter((c) => !productSlugs.has(c.coffee));
if (deadCtas.length) {
  throw new Error(`Blog CTAs point at coffee pages that will not be generated: ` +
    `${deadCtas.map((c) => `${c.post} -> /coffee/${c.coffee}`).join(', ')}. ` +
    `Retarget the cta_href to /coffee/ (always generated) or fix the slug.`);
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

mkdirSync(join(DIST, 'blog'), { recursive: true });
for (const p of posts) {
  writeFileSync(join(DIST, 'blog', `${p.slug}.html`), postPage(p, css, relatedPosts(posts, p.slug)));
}
writeFileSync(join(DIST, 'blog', 'index.html'), blogIndexPage(posts, css));

writeFileSync(join(DIST, 'sitemap.xml'), sitemap(products, brewMethods, posts));
writeFileSync(join(DIST, 'llms.txt'), llmsTxt(products, brewMethods, posts));

// Agent-facing discovery surface. agent.txt is the plain-text capability card (the
// llms.txt equivalent for agent-shaped consumers); agent.html is a minimal HTML page
// that meta-refreshes to it and lists the same endpoints as plain <a> links, so the
// surface is reachable from the homepage without modifying the owned index.html head.
writeFileSync(join(DIST, 'agent.txt'), agentCapabilityTxt());
writeFileSync(join(DIST, 'agent.html'), agentLandingHtml());

// LLM discoverability — verbose catalog, standard .well-known/ files, and image-sitemap.
// The .well-known/ directory is a public directory; Cloudflare Pages serves it as
// static content just like the rest of dist/, so writing into it here is enough to
// expose /llms-full.txt, /.well-known/agent.json, etc.
writeFileSync(join(DIST, 'llms-full.txt'), llmsFullTxt(products, brewMethods));
writeFileSync(join(DIST, 'humans.txt'), humansTxt());
mkdirSync(join(DIST, '.well-known'), { recursive: true });
writeFileSync(join(DIST, '.well-known', 'agent.json'), agentJson());
writeFileSync(join(DIST, '.well-known', 'mcp.json'), mcpJson());
writeFileSync(join(DIST, '.well-known', 'security.txt'), securityTxt());
writeFileSync(join(DIST, 'image-sitemap.xml'), imageSitemap(products));
writeFileSync(join(DIST, 'robots.txt'), aiRobotsTxt());

// AEO — Answer Engine Optimization. aeo.html is the human-readable Q&A page; aeo-feed.json
// is the machine-readable feed for LLM ingestion (third LLM-readable file alongside
// llms.txt and llms-full.txt). Inject the homepage aside so the AEO page is reachable
// from /, and inject per-page snippets for products/brews so LLMs find direct answers.
writeFileSync(join(DIST, 'aeo.html'), aeoPage(css));
writeFileSync(join(DIST, 'aeo-feed.json'), JSON.stringify(aeoFeed(), null, 2));
const distIndex = join(DIST, 'index.html');
const indexHtml = readFileSync(distIndex, 'utf8');
// Both homepage asides are injected just before </main>: the AEO Q&A link and a teaser that
// links the three newest journal posts, so the blog gets real internal links from / and not
// just a footer entry.
const withAsides = indexHtml
  .replace('</main>', `${aeoAsideHtml()}\n${blogAsideHtml(posts)}\n</main>`);
if (withAsides !== indexHtml) writeFileSync(distIndex, withAsides);

const urlCount = (sitemap(products, brewMethods, posts).match(/<loc>/g) || []).length;
console.log(`seo: ${products.length} coffee + ${brewMethods.length} brew + ${posts.length} journal + faq, ${urlCount} sitemap urls, llms.txt, llms-full.txt, agent.txt, aeo.html, .well-known/, image-sitemap.xml`);

// ------------------------------------------------------------------------------------------
// Experiences — Course JSON-LD, individual /experiences/<slug>.html pages, and an index.
//
// Sits at the end of the pipeline so a failing experiences fetch does not lose the
// product/brew/FAQ pages already on disk: those are the site, this just adds the
// bookable experiences the SPA was already showing behind `#experiences`.
const experiences = await fetchExperiences(API);
mkdirSync(join(DIST, 'experiences'), { recursive: true });
for (const e of experiences) {
  writeFileSync(join(DIST, 'experiences', `${e.slug}.html`), experiencePage(e, css));
}
writeFileSync(join(DIST, 'experiences', 'index.html'), experiencesIndexPage(experiences, css));

console.log(`seo: + ${experiences.length} experiences (Course schema) and /experiences/ index`);
