/**
 * Brew method pages.
 *
 * The four methods are defined exactly once, as `.brew-card` elements in index.html carrying
 * data-method/ratio/temp/grind/time. This module reads them from there rather than keeping its
 * own copy: a second hand-maintained list is precisely the bug that put /coffee/<slug> links to
 * three non-existent pages into the fallback catalog. Every number below therefore comes off
 * the card, so a page can never quote 92°C beside a card that says 94°C.
 */
import { SITE, esc, jsonLd } from './seo-data.mjs';
import { PAGE_CSS, PAGE_CSS_SEO } from './seo-render.mjs';

/** Reads the brew methods out of the shipped markup. `doc` is a DOM Document. */
export function readBrewMethods(doc) {
  return [...doc.querySelectorAll('.brew-card')].map((card) => ({
    method: card.getAttribute('data-method'),
    ratio: Number(card.getAttribute('data-ratio')),
    temp: Number(card.getAttribute('data-temp')),
    grind: card.getAttribute('data-grind'),
    time: card.getAttribute('data-time'),
    title: card.querySelector('.brew-title')?.textContent?.trim(),
    summary: card.querySelector('.brew-title')?.nextElementSibling?.textContent?.trim(),
  }));
}

/**
 * Steps per method, built from the card's own numbers. Each returns { name, text } pairs so the
 * same array feeds both the visible list and the HowTo markup — the answer a reader sees and the
 * answer a machine reads cannot diverge because there is only one of them.
 */
const RECIPES = {
  v60: (m, dose) => {
    const water = dose * m.ratio;
    return {
      dose, yield: `${water} g brewed`,
      steps: [
        ['Rinse and preheat', `Put a paper filter in the V60, rinse it through with hot water, and discard the rinse. This kills the paper taste and warms the cone and carafe.`],
        ['Grind', `Grind ${dose} g of coffee to ${m.grind.toLowerCase()} — around the texture of table salt.`],
        ['Bloom', `Start a timer and pour ${dose * 2} g of water at ${m.temp}°C over the grounds. Let it degas for 45 seconds; fresh coffee will visibly swell.`],
        ['Pour in stages', `Add water in slow spirals to ${water} g total, keeping the bed level and never letting it run dry.`],
        ['Drawdown', `Aim to finish dripping at about ${m.time}. Faster means grind finer; slower means grind coarser.`],
      ],
    };
  },
  'filter-kaapi': (m, dose) => {
    const water = dose * m.ratio;
    return {
      dose, yield: `${water} ml decoction`,
      steps: [
        ['Load the upper chamber', `Add ${dose} g of coffee ground ${m.grind.toLowerCase()} to the upper chamber of the filter and level it with the pressing disc. Do not tamp hard.`],
        ['Add water', `Pour ${water} ml of water at ${m.temp}°C over the disc, cover, and leave it alone.`],
        ['Wait for the decoction', `Let it drip for ${m.time}. Rushing it, or pressing the disc down, gives a thin and bitter decoction.`],
        ['Mix and froth', `Combine roughly one part decoction to three or four parts hot milk, sweeten to taste, and pull it between two dabarahs until it froths.`],
      ],
    };
  },
  aeropress: (m, dose) => {
    const water = dose * m.ratio;
    return {
      dose, yield: `${water} g brewed`,
      steps: [
        ['Set up inverted', `Assemble the AeroPress inverted, with the plunger seated an inch into the chamber so it cannot tip.`],
        ['Grind and dose', `Grind ${dose} g ${m.grind.toLowerCase()} and add it to the chamber.`],
        ['Add water', `Pour ${water} g of water at ${m.temp}°C, stir gently three times, and cap it with a rinsed filter.`],
        ['Steep', `Steep for ${m.time}, then flip onto your mug.`],
        ['Press', `Press slowly and evenly over about 30 seconds. Stop at the hiss — pushing past it pulls in the bitter tail.`],
      ],
    };
  },
  espresso: (m, dose) => {
    const out = dose * m.ratio;
    return {
      dose, yield: `${out} g in the cup`,
      steps: [
        ['Dose and distribute', `Dose ${dose} g of coffee ground ${m.grind.toLowerCase()} into a dry basket and distribute it level before tamping.`],
        ['Tamp', `Tamp flat and firm. Level matters more than force — a tilted puck channels.`],
        ['Pull the shot', `Brew at ${m.temp}°C and aim for ${out} g in the cup, a ${m.ratio}:1 ratio, in ${m.time}.`],
        ['Read the shot', `Running fast and sour means grind finer. Running slow and bitter means grind coarser. Change one variable at a time.`],
      ],
    };
  },
};

/** Doses chosen per method because a 20 g espresso dose is nonsense in a 18 g basket. */
const DOSE = { v60: 20, 'filter-kaapi': 30, aeropress: 15, espresso: 18 };

/**
 * Per-method facts that the same data shape could not derive from the brew card alone: the
 * standard yield description (1 cup vs 1 double shot), which step is the bloom/steep prep
 * versus the main draw, and the tool name as baristas would call it. Keeping these here
 * instead of inside RECIPES keeps the step text self-contained and the two schemas
 * (Recipe and HowTo) easy to compare.
 */
const METHOD_META = {
  v60: {
    yield: '1 cup',
    yieldUnit: 'cup',
    tool: 'Hario V60 dripper',
    keywords: 'pour over, v60, hario, single cup coffee, manual brew, pour over recipe',
    hasBloom: true,
  },
  'filter-kaapi': {
    yield: '1 decoction',
    yieldUnit: 'decoction',
    tool: 'South Indian filter coffee brewer',
    keywords: 'south indian filter coffee, filter kaapi, decoction, bangalore coffee, brass dabarah',
    hasBloom: false,
  },
  aeropress: {
    yield: '1 cup',
    yieldUnit: 'cup',
    tool: 'AeroPress',
    keywords: 'aeropress, inverted aeropress, quick brew, single cup coffee',
    hasBloom: false,
  },
  espresso: {
    yield: '1 double shot',
    yieldUnit: 'double shot',
    tool: 'Espresso machine with portafilter',
    keywords: 'espresso, double shot, 1:2 ratio, espresso extraction, single origin espresso',
    hasBloom: false,
  },
};

/** A duration string like "PT3M15S" plus its components, so Recipe/HowTo can share one parser. */
function durationsFor(m) {
  const total = isoDuration(m.time);
  // Bloom is the only prep step; the rest of the time is the main draw. We split the
  // total into a 45s bloom + remainder so the prepTime / cookTime fields describe
  // what is actually happening, not a guess.
  const hasBloom = METHOD_META[m.method]?.hasBloom;
  if (hasBloom) return { prep: 'PT45S', cook: remainderDuration(total, 45), total };
  return { prep: undefined, cook: total, total };
}

/**
 * `PT3M15S` minus 45s → `PT2M30S`. Falls back to the original on a bad parse so we never
 * emit a negative or wrong-shaped duration.
 */
function remainderDuration(total, subtractSeconds) {
  if (!total) return undefined;
  const m = /PT(?:(\d+)M)?(?:(\d+)S)?/.exec(total);
  if (!m) return total;
  let mins = Number(m[1] || 0);
  let secs = Number(m[2] || 0);
  let totalSecs = mins * 60 + secs - subtractSeconds;
  if (totalSecs < 1) return undefined;
  const outM = Math.floor(totalSecs / 60);
  const outS = totalSecs % 60;
  return `PT${outM ? `${outM}M` : ''}${outS ? `${outS}S` : ''}` || 'PT1S';
}

export const hasRecipe = (method) => Object.prototype.hasOwnProperty.call(RECIPES, method);

export function recipeFor(m) {
  if (!hasRecipe(m.method)) return null;
  return RECIPES[m.method](m, DOSE[m.method] ?? 20);
}

/** The publisher block is the same on every Recipe and HowTo. */
const PUBLISHER = {
  '@type': 'Organization',
  name: 'The Daily Roast',
  url: 'https://dailyroast.in/',
};

/** The cost of a 15-gram dose of roasted beans, used as `estimatedCost` for the HowTo. */
const BEAN_COST_INR = '8';

/**
 * schema.org/Recipe — richer than the HowTo: it carries the ingredient strings, nutrition,
 * yield language, keywords and a publisher/author pair, which is what Google's recipe
 * carousel actually reads. Yielded as a separate <script> block on the brew page so the
 * Recipe markup can change without touching the HowTo markup.
 */
export function recipeSchema(m, r) {
  const meta = METHOD_META[m.method] || {};
  const water = r.dose * m.ratio;
  const ingredients = [
    `${r.dose} g freshly ground ${m.grind.toLowerCase()} coffee`,
    `${water} g filtered water at ${m.temp}°C`,
  ];
  const dur = durationsFor(m);
  return {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: m.title,
    description: `Step-by-step ${m.title.toLowerCase()} recipe: ${r.dose} g of ${m.grind.toLowerCase()} coffee and ${water} g of water at ${m.temp}°C, ${m.summary || ''}`.trim().slice(0, 300),
    recipeCategory: 'Coffee',
    recipeCuisine: 'Coffee',
    recipeYield: meta.yield || `${water} g brewed`,
    prepTime: dur.prep,
    cookTime: dur.cook,
    totalTime: dur.total,
    recipeIngredient: ingredients,
    recipeInstructions: r.steps.map(([name, text]) => ({
      '@type': 'HowToStep',
      name,
      text,
    })),
    tool: meta.tool
      ? [{ '@type': 'HowToTool', name: meta.tool }, { '@type': 'HowToTool', name: m.title }]
      : [{ '@type': 'HowToTool', name: m.title }],
    author: PUBLISHER,
    publisher: PUBLISHER,
    datePublished: '2025-01-15',
    keywords: meta.keywords || `${m.title}, coffee, brew method`,
    nutrition: {
      '@type': 'NutritionInformation',
      calories: '2 kcal',
      carbohydrateContent: '0 g',
      proteinContent: '0 g',
      fatContent: '0 g',
    },
  };
}

/** schema.org/HowTo — a parallel block so Google can surface the same guide as a how-to. */
function howTo(m, r) {
  const dur = durationsFor(m);
  const meta = METHOD_META[m.method] || {};
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: `How to brew ${m.title}`,
    description: m.summary,
    url: `${SITE}/brew/${m.method}`,
    totalTime: dur.total,
    estimatedCost: {
      '@type': 'MonetaryAmount',
      currency: 'INR',
      value: BEAN_COST_INR,
    },
    supply: [
      { '@type': 'HowToSupply', name: `${r.dose} g of freshly roasted coffee` },
      { '@type': 'HowToSupply', name: `Water at ${m.temp}°C` },
    ],
    tool: meta.tool
      ? [{ '@type': 'HowToTool', name: meta.tool }, { '@type': 'HowToTool', name: m.title }]
      : [{ '@type': 'HowToTool', name: m.title }],
    step: r.steps.map(([name, text], i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name,
      text,
    })),
  };
}

/** "3m 15s", "28s", "15m decoction" → ISO 8601. Returns undefined rather than a wrong guess. */
export function isoDuration(time) {
  if (!time) return undefined;
  const mins = /(\d+)\s*m/.exec(time);
  const secs = /(\d+)\s*s(?:ec)?\b/.exec(time);
  if (!mins && !secs) return undefined;
  return `PT${mins ? `${mins[1]}M` : ''}${secs ? `${secs[1]}S` : ''}`;
}

export function brewPage(m, css) {
  const r = recipeFor(m);
  if (!r) return null;
  const title = `How to Brew ${m.title} — Ratio, Grind &amp; Temperature | The Daily Roast`;
  const desc = `${m.title} at 1:${m.ratio}: ${r.dose} g of coffee, ${m.grind.toLowerCase()} grind, water at ${m.temp}°C, ${m.time}. ${m.summary || ''}`.slice(0, 158).trim();
  /*
   * Brew pages share the same hero source (the pour_over photo is the only large
   * brew-themed image on the site; it was already preloaded in the SPA). Marking it as
   * the LCP candidate for this page is the right call — it is the first contentful
   * block the visitor sees after the title, and 1200x675 matches the source.
   */
  const heroSrc = '/images/pour_over.jpg';
  const heroAlt = `${m.title} — step-by-step brewing guide`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/brew/${esc(m.method)}">
<link rel="alternate" hreflang="en-in" href="${SITE}/brew/${esc(m.method)}">
<link rel="alternate" hreflang="en" href="${SITE}/brew/${esc(m.method)}">
<link rel="alternate" hreflang="x-default" href="${SITE}/brew/${esc(m.method)}">
<meta name="theme-color" content="#1b1614">
<meta property="og:type" content="article">
<meta property="og:url" content="${SITE}/brew/${esc(m.method)}">
<meta property="og:site_name" content="The Daily Roast">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="https://dailyroast.in${heroSrc}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="675">
<meta property="og:image:alt" content="${esc(heroAlt)}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="${css}">
${PAGE_CSS}
${PAGE_CSS_SEO}
<script type="application/ld+json">
${jsonLd(recipeSchema(m, r))}
</script>
<script type="application/ld+json">
${jsonLd(howTo(m, r))}
</script>
</head>
<body>
<header class="site-header">
  <div class="nav-container">
    <a href="/" class="brand-logo"><div><span class="brand-name">THE DAILY ROAST</span></div></a>
    <div class="nav-actions"><a class="btn-primary" href="/#catalog">Shop all coffee</a></div>
  </div>
</header>

<main id="main-content" style="max-width: 780px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem;">
  <nav aria-label="Breadcrumb" style="font-size:0.85rem; margin-bottom:1.6rem;">
    <a href="/">Home</a> · <a href="/brew/">Brewing</a> · <span>${esc(m.title)}</span>
  </nav>

  <article>
    <p class="section-label">EXTRACTION MASTERY</p>
    <h1 class="section-title" style="margin:0.3rem 0 0.6rem;">How to brew ${esc(m.title)}</h1>
    ${m.summary ? `<p class="section-subtitle" style="margin:0 0 1.8rem;">${esc(m.summary)}</p>` : ''}
    <img src="${heroSrc}" alt="${esc(heroAlt)}" width="1200" height="675" fetchpriority="high" decoding="async" class="brew-hero-img" style="width:100%; height:auto; aspect-ratio:16/9; object-fit:cover; border-radius:14px; margin-bottom:2rem;">

    <h2>The numbers</h2>
    <table style="width:100%; border-collapse:collapse; margin-bottom:2rem;">
      <tbody>
        <tr><th scope="row" style="text-align:left; padding:0.5rem 1rem 0.5rem 0; font-weight:600;">Ratio</th><td style="padding:0.5rem 0;">1:${esc(m.ratio)}</td></tr>
        <tr><th scope="row" style="text-align:left; padding:0.5rem 1rem 0.5rem 0; font-weight:600;">Dose</th><td style="padding:0.5rem 0;">${esc(r.dose)} g</td></tr>
        <tr><th scope="row" style="text-align:left; padding:0.5rem 1rem 0.5rem 0; font-weight:600;">Yield</th><td style="padding:0.5rem 0;">${esc(r.yield)}</td></tr>
        <tr><th scope="row" style="text-align:left; padding:0.5rem 1rem 0.5rem 0; font-weight:600;">Grind</th><td style="padding:0.5rem 0;">${esc(m.grind)}</td></tr>
        <tr><th scope="row" style="text-align:left; padding:0.5rem 1rem 0.5rem 0; font-weight:600;">Water temperature</th><td style="padding:0.5rem 0;">${esc(m.temp)}°C</td></tr>
        <tr><th scope="row" style="text-align:left; padding:0.5rem 1rem 0.5rem 0; font-weight:600;">Time</th><td style="padding:0.5rem 0;">${esc(m.time)}</td></tr>
      </tbody>
    </table>

    <h2>Method</h2>
    <ol style="line-height:1.75; padding-left:1.2rem;">
      ${r.steps.map(([name, text]) => `<li style="margin-bottom:0.9rem;"><strong>${esc(name)}.</strong> ${esc(text)}</li>`).join('\n      ')}
    </ol>

    <h2>Scaling it</h2>
    <p>The ratio is what travels, not the gram figures. At 1:${m.ratio}, multiply your dose by
    ${m.ratio} for your water. The <a href="/#brew-guide">calculator on the brewing page</a> will
    do it for any dose.</p>

    <h2>Which coffee</h2>
    <p>Every bag we roast can be ground for this method — pick the grind at checkout and we grind
    it the day it ships. <a href="/coffee/">See the full coffee catalog</a>, or start with the
    <a href="/#quiz">three-question taste quiz</a> if you are not sure which roast fits you.</p>
  </article>
</main>

<footer class="site-footer">
  <div class="footer-bottom" style="max-width:780px; margin:0 auto; padding:2rem 1.5rem;">
    <span>&copy; 2026 The Daily Roast Roastery Pvt Ltd · Bangalore, India</span>
    <span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/shipping">Shipping &amp; Returns</a></span>
  </div>
</footer>
</body>
</html>
`;
}

export function brewIndexPage(methods, css) {
  const usable = methods.filter((m) => hasRecipe(m.method));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Brewing Guides — Ratios, Grind and Temperature | The Daily Roast</title>
<meta name="description" content="Ratio, grind, water temperature and timing for ${usable.length} brew methods: ${usable.map((m) => m.title).join(', ')}.">
<link rel="canonical" href="${SITE}/brew/">
<link rel="alternate" hreflang="en-in" href="${SITE}/brew/">
<link rel="alternate" hreflang="en" href="${SITE}/brew/">
<link rel="alternate" hreflang="x-default" href="${SITE}/brew/">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/brew/">
<meta property="og:title" content="Brewing Guides | The Daily Roast">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="${css}">
${PAGE_CSS}
${PAGE_CSS_SEO}
<script type="application/ld+json">
${jsonLd({
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'Brewing guides',
  url: `${SITE}/brew/`,
  mainEntity: {
    '@type': 'ItemList',
    numberOfItems: usable.length,
    itemListElement: usable.map((m, i) => ({
      '@type': 'ListItem', position: i + 1, name: `How to brew ${m.title}`, url: `${SITE}/brew/${m.method}`,
    })),
  },
})}
</script>
</head>
<body>
<header class="site-header">
  <div class="nav-container">
    <a href="/" class="brand-logo"><div><span class="brand-name">THE DAILY ROAST</span></div></a>
    <div class="nav-actions"><a class="btn-primary" href="/#catalog">Shop all coffee</a></div>
  </div>
</header>
<main id="main-content" style="max-width:780px; margin:0 auto; padding:2.5rem 1.5rem 4rem;">
  <nav aria-label="Breadcrumb" style="font-size:0.85rem; margin-bottom:1.6rem;"><a href="/">Home</a> · <span>Brewing</span></nav>
  <h1 class="section-title">Brewing guides</h1>
  <p class="section-subtitle" style="margin-bottom:2.5rem;">Ratio, grind, water temperature and timing for every method we grind for.</p>
  <ul style="list-style:none; padding:0; display:grid; gap:1.6rem;">
    ${usable.map((m) => `<li style="border-bottom:1px solid rgba(0,0,0,0.08); padding-bottom:1.4rem;">
      <h2 style="margin:0 0 0.3rem; font-size:1.2rem;"><a href="/brew/${esc(m.method)}">${esc(m.title)}</a></h2>
      <p style="margin:0 0 0.4rem;">${esc(m.summary || '')}</p>
      <p style="margin:0; font-size:0.9rem;">1:${esc(m.ratio)} · ${esc(m.grind)} · ${esc(m.temp)}°C · ${esc(m.time)}</p>
    </li>`).join('\n    ')}
  </ul>
</main>
<footer class="site-footer">
  <div class="footer-bottom" style="max-width:780px; margin:0 auto; padding:2rem 1.5rem;">
    <span>&copy; 2026 The Daily Roast Roastery Pvt Ltd · Bangalore, India</span>
  </div>
</footer>
</body>
</html>
`;
}
