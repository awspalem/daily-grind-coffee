/**
 * Pure rendering for the generated pages — no network, no filesystem. Kept separate from
 * generate-seo.mjs so the suite can feed it fixture products and assert on the markup, rather
 * than only finding out at build time that a page came out wrong.
 */
import { SITE, esc, jsonLd, priceInr, roastLabel, processLabel, grindLabel } from './seo-data.mjs';

/*
 * These pages borrow the site stylesheet, which is written around the SPA's own markup, so a
 * few things it never has to style — a plain content column, a breadcrumb, a data table —
 * arrive as browser defaults. Notably every link renders as underlined blue, which is the same
 * defect the nav pills had. Scoped here rather than added to index.css: it is presentation for
 * these generated pages only.
 */
export const PAGE_CSS = `<style>
  body { background: var(--bg-main, #fcf9f5); }
  main a { color: var(--accent-terracotta, #c2410c); text-decoration: none; }
  main a:hover { text-decoration: underline; }
  main h2 { font-family: var(--font-serif, Georgia, serif); font-size: 1.35rem; margin: 2.4rem 0 0.8rem; }
  main table th, main table td { border-bottom: 1px solid rgba(0,0,0,0.07); }
  /* The origin shot is editorial, not the whole page — cap it and crop rather than let a
     tall source image push every fact below the fold. */
  .hero-shot { width: 100%; height: clamp(220px, 38vh, 420px); object-fit: cover; border-radius: 14px; margin-bottom: 2rem; }
  .site-footer a { color: inherit; opacity: 0.85; text-decoration: none; }
  .site-footer a:hover { text-decoration: underline; }
  .footer-bottom { display: flex; flex-wrap: wrap; gap: 0.8rem; justify-content: space-between; }
</style>`;

export const cheapestVariant = (p) =>
  [...(p.variants || [])].filter((v) => v.is_active !== false)
    .sort((a, b) => Number(a.price_cents) - Number(b.price_cents))[0];

export function productSchema(p) {
  const variants = (p.variants || []).filter((v) => v.is_active !== false);
  const offers = variants.map((v) => ({
    '@type': 'Offer',
    sku: v.sku,
    name: `${v.weight_grams}g`,
    price: String(priceInr(v.price_cents)),
    priceCurrency: 'INR',
    // The storefront defaults to the rupee toggle, so INR is what a visitor actually sees.
    availability: Number(v.stock_quantity) > 0
      ? 'https://schema.org/InStock'
      : 'https://schema.org/OutOfStock',
    url: `${SITE}/coffee/${p.slug}`,
    itemCondition: 'https://schema.org/NewCondition',
    seller: { '@type': 'Organization', name: 'The Daily Roast Roastery' },
  }));

  const props = [
    p.origin_country && { '@type': 'PropertyValue', name: 'Origin', value: p.origin_country },
    p.region && { '@type': 'PropertyValue', name: 'Region', value: p.region },
    p.farm_or_coop && { '@type': 'PropertyValue', name: 'Farm or co-operative', value: p.farm_or_coop },
    p.altitude_meters && { '@type': 'PropertyValue', name: 'Altitude', value: `${p.altitude_meters} m` },
    p.variety && { '@type': 'PropertyValue', name: 'Variety', value: p.variety },
    p.process_method && { '@type': 'PropertyValue', name: 'Process', value: processLabel(p.process_method) },
    p.roast_level && { '@type': 'PropertyValue', name: 'Roast level', value: roastLabel(p.roast_level) },
  ].filter(Boolean);

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.description || p.tagline,
    sku: cheapestVariant(p)?.sku,
    image: p.image_url ? [p.image_url] : undefined,
    category: p.category_name,
    url: `${SITE}/coffee/${p.slug}`,
    brand: { '@type': 'Brand', name: 'The Daily Roast' },
    additionalProperty: props.length ? props : undefined,
    // No aggregateRating or review: there are no reviews on these pages. Marking up ratings
    // that a visitor cannot see on the page is exactly what earns a structured-data penalty.
    offers: offers.length === 1 ? offers[0] : {
      '@type': 'AggregateOffer',
      priceCurrency: 'INR',
      lowPrice: String(Math.min(...variants.map((v) => priceInr(v.price_cents)))),
      highPrice: String(Math.max(...variants.map((v) => priceInr(v.price_cents)))),
      offerCount: offers.length,
      offers,
    },
  };
}

export const breadcrumb = (p) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
    { '@type': 'ListItem', position: 2, name: 'Coffee', item: `${SITE}/coffee/` },
    { '@type': 'ListItem', position: 3, name: p.name, item: `${SITE}/coffee/${p.slug}` },
  ],
});

/**
 * Search engines truncate around 155-160 characters; the point of doing it here is to choose
 * where the cut lands. Slicing blind ended a description mid-word ("with bal"), which is the
 * one thing worse than letting the engine truncate it.
 */
export function metaDescription(p) {
  const full = [p.tagline, p.description].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (full.length <= 158) return full;
  const cut = full.slice(0, 158);
  const boundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return cut.slice(0, boundary > 90 ? boundary : 158).replace(/[,\s]+$/, '') + '…';
}

export function productPage(p, css) {
  const v = cheapestVariant(p);
  const from = v ? priceInr(v.price_cents) : null;
  const notes = Array.isArray(p.tasting_notes) ? p.tasting_notes : [];
  const title = `${p.name} — ${p.region || p.origin_country} Coffee | The Daily Roast`;
  const desc = metaDescription(p);

  const spec = [
    ['Origin', p.origin_country], ['Region', p.region], ['Estate or co-op', p.farm_or_coop],
    ['Altitude', p.altitude_meters ? `${p.altitude_meters} m above sea level` : null],
    ['Variety', p.variety], ['Process', processLabel(p.process_method)],
    ['Roast level', roastLabel(p.roast_level)],
  ].filter(([, val]) => val);

  const grinds = [...new Set((p.variants || []).flatMap((x) => x.grind_options || []))];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc.trim())}">
<link rel="canonical" href="${SITE}/coffee/${esc(p.slug)}">
<meta name="theme-color" content="#1b1614">
<meta property="og:type" content="product">
<meta property="og:url" content="${SITE}/coffee/${esc(p.slug)}">
<meta property="og:site_name" content="The Daily Roast">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc.trim())}">
${p.image_url ? `<meta property="og:image" content="${esc(p.image_url)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc.trim())}">
${p.image_url ? `<meta name="twitter:image" content="${esc(p.image_url)}">` : ''}
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="stylesheet" href="${css}">
${PAGE_CSS}
<script type="application/ld+json">
${jsonLd(productSchema(p))}
</script>
<script type="application/ld+json">
${jsonLd(breadcrumb(p))}
</script>
</head>
<body>
<header class="site-header">
  <div class="nav-container">
    <a href="/" class="brand-logo"><div><span class="brand-name">THE DAILY ROAST</span></div></a>
    <div class="nav-actions"><a class="btn-primary" href="/#catalog">Shop all roasts</a></div>
  </div>
</header>

<main id="main-content" style="max-width: 900px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem;">
  <nav aria-label="Breadcrumb" style="font-size: 0.85rem; margin-bottom: 1.6rem;">
    <a href="/">Home</a> · <a href="/coffee/">Coffee</a> · <span>${esc(p.name)}</span>
  </nav>

  <article>
    <p class="section-label">${esc(p.category_name || 'Specialty Coffee')}</p>
    <h1 class="section-title" style="margin: 0.3rem 0 0.6rem;">${esc(p.name)}</h1>
    ${p.tagline ? `<p class="section-subtitle" style="margin: 0 0 1.4rem;">${esc(p.tagline)}</p>` : ''}
    ${from ? `<p style="font-size: 1.3rem; font-weight: 600; margin-bottom: 1.6rem;">From ₹${from}<span style="font-size: 0.9rem; font-weight: 400;"> · ${esc(v.weight_grams)}g</span></p>` : ''}

    ${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" width="800" height="500" loading="lazy" class="hero-shot">` : ''}

    <p style="font-size: 1.02rem; line-height: 1.75; margin-bottom: 2rem;">${esc(p.description || '')}</p>

    ${notes.length ? `<h2>Tasting notes</h2><p>${notes.map(esc).join(' · ')}</p>` : ''}

    ${spec.length ? `<h2>Origin and processing</h2>
    <table style="width:100%; border-collapse: collapse; margin-bottom: 2rem;">
      <tbody>
        ${spec.map(([k, val]) => `<tr><th scope="row" style="text-align:left; padding:0.5rem 1rem 0.5rem 0; font-weight:600; white-space:nowrap;">${esc(k)}</th><td style="padding:0.5rem 0;">${esc(val)}</td></tr>`).join('\n        ')}
      </tbody>
    </table>` : ''}

    ${(p.variants || []).length ? `<h2>Sizes</h2>
    <table style="width:100%; border-collapse: collapse; margin-bottom: 2rem;">
      <thead><tr><th scope="col" style="text-align:left; padding:0.5rem 1rem 0.5rem 0;">Size</th><th scope="col" style="text-align:left; padding:0.5rem 0;">Price</th></tr></thead>
      <tbody>
        ${p.variants.filter((x) => x.is_active !== false).map((x) =>
          `<tr><td style="padding:0.5rem 1rem 0.5rem 0;">${esc(x.weight_grams)}g</td><td style="padding:0.5rem 0;">₹${priceInr(x.price_cents)}</td></tr>`).join('\n        ')}
      </tbody>
    </table>` : ''}

    ${grinds.length ? `<h2>Ground to order</h2><p>Ground fresh the day it ships, for ${grinds.map((g) => esc(grindLabel(g))).join(', ')}.</p>` : ''}

    <h2>Roasted in Bangalore, shipped fresh</h2>
    <p>Roasted to order at our Indiranagar roastery on 100ft Road and dispatched within 24 hours,
    anywhere in India. Free shipping over ₹1,200.</p>

    <p style="margin-top: 2.5rem;">
      <a class="btn-primary" href="/#catalog">Buy ${esc(p.name)}</a>
    </p>
  </article>
</main>

<footer class="site-footer">
  <div class="footer-bottom" style="max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem;">
    <span>&copy; 2026 The Daily Roast Roastery Pvt Ltd · Bangalore, India</span>
    <span><a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a> · <a href="/shipping.html">Shipping &amp; Returns</a></span>
  </div>
</footer>
</body>
</html>
`;
}

export function indexPage(products, css) {
  const list = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Every coffee we roast',
    url: `${SITE}/coffee/`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: products.length,
      itemListElement: products.map((p, i) => ({
        '@type': 'ListItem', position: i + 1, name: p.name, url: `${SITE}/coffee/${p.slug}`,
      })),
    },
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Every Coffee We Roast — Indian Micro-Lots &amp; Global Origins | The Daily Roast</title>
<meta name="description" content="All ${products.length} coffees roasted to order at our Bangalore roastery: Indian estate micro-lots from Chikmagalur and Araku, and single origins from Ethiopia, Colombia, Guatemala and Sumatra.">
<link rel="canonical" href="${SITE}/coffee/">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/coffee/">
<meta property="og:title" content="Every Coffee We Roast | The Daily Roast">
<meta property="og:description" content="All ${products.length} coffees roasted to order at our Bangalore roastery.">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="${css}">
${PAGE_CSS}
<script type="application/ld+json">
${jsonLd(list)}
</script>
</head>
<body>
<header class="site-header">
  <div class="nav-container">
    <a href="/" class="brand-logo"><div><span class="brand-name">THE DAILY ROAST</span></div></a>
    <div class="nav-actions"><a class="btn-primary" href="/#catalog">Shop all roasts</a></div>
  </div>
</header>
<main id="main-content" style="max-width: 900px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem;">
  <nav aria-label="Breadcrumb" style="font-size:0.85rem; margin-bottom:1.6rem;"><a href="/">Home</a> · <span>Coffee</span></nav>
  <h1 class="section-title">Every coffee we roast</h1>
  <p class="section-subtitle" style="margin-bottom:2.5rem;">Roasted to order in Indiranagar, Bangalore, and dispatched within 24 hours.</p>
  <ul style="list-style:none; padding:0; display:grid; gap:1.6rem;">
    ${products.map((p) => {
      const v = cheapestVariant(p);
      return `<li style="border-bottom:1px solid rgba(0,0,0,0.08); padding-bottom:1.4rem;">
      <h2 style="margin:0 0 0.3rem; font-size:1.2rem;"><a href="/coffee/${esc(p.slug)}">${esc(p.name)}</a></h2>
      <p style="margin:0 0 0.4rem;">${esc(p.tagline || '')}</p>
      <p style="margin:0; font-size:0.9rem;">${esc([p.region || p.origin_country, processLabel(p.process_method), roastLabel(p.roast_level) + ' roast'].filter(Boolean).join(' · '))}${v ? ` · from ₹${priceInr(v.price_cents)}` : ''}</p>
    </li>`;
    }).join('\n    ')}
  </ul>
</main>
<footer class="site-footer">
  <div class="footer-bottom" style="max-width:900px; margin:0 auto; padding:2rem 1.5rem;">
    <span>&copy; 2026 The Daily Roast Roastery Pvt Ltd · Bangalore, India</span>
  </div>
</footer>
</body>
</html>
`;
}

/**
 * The sitemap is generated rather than hand-kept. It listed four URLs while the site had
 * fifteen; adding ten more by hand would have gone stale at the next catalog change.
 * No changefreq or priority — Google has said publicly that it ignores both.
 */
export function sitemap(products) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `${SITE}/`,
    `${SITE}/coffee/`,
    ...products.map((p) => `${SITE}/coffee/${p.slug}`),
    `${SITE}/shipping.html`,
    `${SITE}/privacy.html`,
    `${SITE}/terms.html`,
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>\n    <loc>${u}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`).join('\n')}
</urlset>
`;
}

/**
 * llms.txt is a proposed convention, not a standard, and adoption by the assistants it targets
 * is unproven. It costs a few lines and it is a genuinely useful plain-text index of the site,
 * so it is worth having — but the thing that makes this site answerable is the pages above,
 * not this file.
 */
export function llmsTxt(products) {
  return `# The Daily Roast

> An independent specialty coffee roastery in Indiranagar, Bangalore, India. We roast Indian
> estate micro-lots and single origins to order and dispatch within 24 hours across India.

Prices are in Indian rupees. Roasting happens at 100ft Road, Indiranagar, Bangalore 560038.

## Coffee

${products.map((p) => {
  const v = cheapestVariant(p);
  const facts = [p.region || p.origin_country, processLabel(p.process_method) + ' process',
    roastLabel(p.roast_level) + ' roast', v ? `from ₹${priceInr(v.price_cents)}` : null]
    .filter(Boolean).join(', ');
  return `- [${p.name}](${SITE}/coffee/${p.slug}): ${p.tagline || p.description || ''} ${facts}.`;
}).join('\n')}

## The roastery

- [Every coffee we roast](${SITE}/coffee/): the full catalog.
- [Shipping and returns](${SITE}/shipping.html)
- [Privacy policy](${SITE}/privacy.html)
- [Terms of service](${SITE}/terms.html)

## Subscriptions and experiences

The Daily Roast Club has five tiers, from Explorer (one bag a month) to Founder. Annual terms are
prepaid and include 15-minute video consultations with a roaster, roastery tour seats, cupping
table seats and, at the top tier, a place on the annual estate visit in the Western Ghats.
Bookable experiences are a 15-minute barista teleconsultation, a roastery tour, a cupping session
and a three-day estate tour in Chikmagalur. See ${SITE}/#subscription-plans and ${SITE}/#experiences.
`;
}

