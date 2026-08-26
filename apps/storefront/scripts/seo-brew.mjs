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
import { PAGE_CSS } from './seo-render.mjs';

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

export const hasRecipe = (method) => Object.prototype.hasOwnProperty.call(RECIPES, method);

export function recipeFor(m) {
  if (!hasRecipe(m.method)) return null;
  return RECIPES[m.method](m, DOSE[m.method] ?? 20);
}

function howTo(m, r) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: `How to brew ${m.title}`,
    description: m.summary,
    url: `${SITE}/brew/${m.method}`,
    totalTime: isoDuration(m.time),
    supply: [
      { '@type': 'HowToSupply', name: `${r.dose} g of freshly roasted coffee` },
      { '@type': 'HowToSupply', name: `Water at ${m.temp}°C` },
    ],
    tool: [{ '@type': 'HowToTool', name: m.title }],
    step: r.steps.map(([name, text], i) => ({
      '@type': 'HowToStep', position: i + 1, name, text,
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/brew/${esc(m.method)}">
<meta name="theme-color" content="#1b1614">
<meta property="og:type" content="article">
<meta property="og:url" content="${SITE}/brew/${esc(m.method)}">
<meta property="og:site_name" content="The Daily Roast">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${esc(desc)}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="${css}">
${PAGE_CSS}
<script type="application/ld+json">
${jsonLd(howTo(m, r))}
</script>
</head>
<body>
<header class="site-header">
  <div class="nav-container">
    <a href="/" class="brand-logo"><div><span class="brand-name">THE DAILY ROAST</span></div></a>
    <div class="nav-actions"><a class="btn-primary" href="/#catalog">Shop all roasts</a></div>
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
    it the day it ships. <a href="/coffee/">See all ten coffees</a>, or start with the
    <a href="/#quiz">taste quiz</a> if you are not sure.</p>
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
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/brew/">
<meta property="og:title" content="Brewing Guides | The Daily Roast">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="${css}">
${PAGE_CSS}
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
    <div class="nav-actions"><a class="btn-primary" href="/#catalog">Shop all roasts</a></div>
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
