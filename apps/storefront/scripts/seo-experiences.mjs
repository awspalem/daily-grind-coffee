/**
 * Experience pages — `/experiences/<slug>.html` and `/experiences/index.html`.
 *
 * The four bookable experiences (teleconsult, roastery tour, cupping session, estate visit)
 * are listed at the public endpoint `/api/experiences` and described in
 * `packages/db/migrations/0016_experiences_bookings.sql`. Until now they only lived
 * behind the SPA `#experiences` anchor, so `curl https://dailyroast.in/experiences/...`
 * returned nothing — same problem the original coffee pages solved, smaller surface.
 *
 * Each experience now gets a real URL with a `Course` JSON-LD block (Google reads the
 * `Course` type for bookable classes/workshops/tastings) plus a `BreadcrumbList`. The
 * estate visit, which is multi-day, declares `hasCourseInstance` with a `CourseInstance`
 * that carries the `courseMode: "onsite"` and a window; the teleconsultation uses
 * `courseMode: "online"`. Educational level is set by `experience_type`.
 */
import { SITE, esc, jsonLd, priceInr } from './seo-data.mjs';
import { PAGE_CSS, experienceBreadcrumb } from './seo-render.mjs';

/**
 * Educational level, derived from `experience_type`. Teleconsults dial in a single bag,
 * tours are walk-throughs, cuppings introduce flavour wheels, estate visits are a working
 * farm trip. Mapping once, here, means the same string feeds Course and any future page
 * copy that needs it.
 */
const EDU_LEVEL = {
  TELECONSULT: 'beginner',
  ROASTERY_TOUR: 'beginner',
  CUPPING_SESSION: 'intermediate',
  ESTATE_VISIT: 'advanced',
};

const DEFAULT_LEVEL = 'beginner';

/** `experience_type` is uppercase-snake in the API; the `courseMode` reads better as a label. */
const courseModeFor = (e) => (e.mode === 'VIDEO' ? 'online' : 'onsite');

/** Truncates a description to 200 chars at a word boundary for the meta tag and Course summary. */
export function summarize(text, max = 200) {
  if (!text) return '';
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return cut.slice(0, boundary > 60 ? boundary : max).replace(/[,\s]+$/, '') + '…';
}

/**
 * schema.org/Course. `Course` is the closest type Google indexes for tastings, workshops
 * and farm visits — the `Course` type is used for any class-like product, which is
 * exactly what these are. `provider` is the same `Organization` block used elsewhere, and
 * `hasCourseInstance` carries the schedule and the location for the onsite ones.
 */
export function courseSchema(e) {
  const provider = {
    '@type': 'Organization',
    name: 'The Daily Roast',
    sameAs: 'https://dailyroast.in/',
  };
  const url = `${SITE}/experiences/${e.slug}`;
  const offer = buildOffer(e);
  const courseInstance = buildCourseInstance(e);
  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: e.name,
    description: summarize(e.description || e.tagline || e.name),
    provider,
    url,
    courseMode: courseModeFor(e),
    educationalLevel: EDU_LEVEL[e.experience_type] || DEFAULT_LEVEL,
    inLanguage: 'en',
    isAccessibleForFree: Number(e.price_cents || 0) === 0,
    offers: offer,
    hasCourseInstance: courseInstance,
    // coursePrerequisites left off: none of the four are gated on prior coursework, and
    // marking up a prerequisite the booking flow does not actually enforce is a
    // structured-data penalty.
  };
}

/**
 * The price in INR. Uses the same `priceInr` derivation the rest of the generator uses,
 * so the marked-up number matches the page. `availability` flips to
 * `https://schema.org/SoldOut` only when the next slot is full, which `fetchExperiences`
 * cannot know — so the conservative default is `InStock`, and pages surface the actual
 * next slot from the SPA.
 */
function buildOffer(e) {
  const price = priceInr(e.price_cents || 0);
  return {
    '@type': 'Offer',
    price: String(price),
    priceCurrency: 'INR',
    availability: 'https://schema.org/InStock',
    url: `${SITE}/experiences/${e.slug}`,
    validFrom: '2025-01-01',
    category: e.experience_type,
  };
}

/**
 * One `CourseInstance` per experience. The estate visit spans days, so it is a `Event`
 * with start/end; the others are short enough that a `courseSchedule` is enough. A
 * missing schedule is a bigger SEO problem than a wrong one, so even with no slots
 * surfaced yet we emit a placeholder that says "dates coming soon".
 */
function buildCourseInstance(e) {
  const url = `${SITE}/experiences/${e.slug}`;
  const mode = courseModeFor(e);
  if (Number(e.is_multi_day) === 1) {
    return {
      '@type': 'CourseInstance',
      name: e.name,
      courseMode: mode,
      location: {
        '@type': 'Place',
        name: e.location_name || 'The Daily Roast',
        address: e.location_address || undefined,
      },
      instructor: { '@type': 'Organization', name: 'The Daily Roast Roastery' },
      url,
    };
  }
  return {
    '@type': 'CourseInstance',
    name: e.name,
    courseMode: mode,
    courseWorkload: e.duration_minutes ? `PT${e.duration_minutes}M` : undefined,
    location: mode === 'online'
      ? { '@type': 'VirtualLocation', url: `${url}#book`, name: 'Video call (link sent on booking)' }
      : {
          '@type': 'Place',
          name: e.location_name || 'The Daily Roast',
          address: e.location_address || undefined,
        },
    instructor: { '@type': 'Organization', name: 'The Daily Roast Roastery' },
    url,
  };
}

export function experiencePage(e, css) {
  const price = priceInr(e.price_cents || 0);
  const dur = e.duration_minutes ? `${e.duration_minutes} minutes` : (Number(e.is_multi_day) === 1 ? '3 days' : '60 minutes');
  const title = `${e.name} — Book at The Daily Roast, Bangalore`;
  const desc = summarize(e.description || e.tagline || e.name);
  const mode = courseModeFor(e);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/experiences/${esc(e.slug)}">
<meta name="theme-color" content="#1b1614">
<meta property="og:type" content="product">
<meta property="og:url" content="${SITE}/experiences/${esc(e.slug)}">
<meta property="og:site_name" content="The Daily Roast">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${e.image_url ? `<meta property="og:image" content="${esc(e.image_url)}">` : ''}
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="${css}">
${PAGE_CSS}
<script type="application/ld+json">
${jsonLd(courseSchema(e))}
</script>
<script type="application/ld+json">
${jsonLd(experienceBreadcrumb(e))}
</script>
</head>
<body>
<header class="site-header">
  <div class="nav-container">
    <a href="/" class="brand-logo"><div><span class="brand-name">THE DAILY ROAST</span></div></a>
    <div class="nav-actions"><a class="btn-primary" href="/#experiences">Book on the roastery</a></div>
  </div>
</header>

<main id="main-content" style="max-width: 820px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem;">
  <nav aria-label="Breadcrumb" style="font-size: 0.85rem; margin-bottom: 1.6rem;">
    <a href="/">Home</a> · <a href="/experiences/">Experiences</a> · <span>${esc(e.name)}</span>
  </nav>

  <article>
    <p class="section-label">${esc(String(e.experience_type || '').toLowerCase().replace(/_/g, ' '))}</p>
    <h1 class="section-title" style="margin: 0.3rem 0 0.6rem;">${esc(e.name)}</h1>
    ${e.tagline ? `<p class="section-subtitle" style="margin: 0 0 1.4rem;">${esc(e.tagline)}</p>` : ''}
    ${price > 0 ? `<p style="font-size: 1.3rem; font-weight: 600; margin-bottom: 1.6rem;">From ₹${price}<span style="font-size: 0.9rem; font-weight: 400;"> · per seat</span></p>` : ''}

    ${e.image_url ? `<img src="${esc(e.image_url)}" alt="${esc(e.name)}" width="800" height="500" loading="lazy" class="hero-shot">` : ''}

    <p style="font-size: 1.02rem; line-height: 1.75; margin-bottom: 2rem;">${esc(e.description || '')}</p>

    <h2>What to expect</h2>
    <table style="width:100%; border-collapse: collapse; margin-bottom: 2rem;">
      <tbody>
        <tr><th scope="row" style="text-align:left; padding:0.5rem 1rem 0.5rem 0; font-weight:600;">Format</th><td style="padding:0.5rem 0;">${esc(mode === 'online' ? 'Online (video call)' : 'Onsite at the roastery')}</td></tr>
        <tr><th scope="row" style="text-align:left; padding:0.5rem 1rem 0.5rem 0; font-weight:600;">Duration</th><td style="padding:0.5rem 0;">${esc(dur)}</td></tr>
        ${e.location_name ? `<tr><th scope="row" style="text-align:left; padding:0.5rem 1rem 0.5rem 0; font-weight:600;">Location</th><td style="padding:0.5rem 0;">${esc(e.location_name)}${e.location_address ? ` — ${esc(e.location_address)}` : ''}</td></tr>` : ''}
        <tr><th scope="row" style="text-align:left; padding:0.5rem 1rem 0.5rem 0; font-weight:600;">Skill level</th><td style="padding:0.5rem 0;">${esc(EDU_LEVEL[e.experience_type] || DEFAULT_LEVEL)}</td></tr>
        ${price > 0 ? `<tr><th scope="row" style="text-align:left; padding:0.5rem 1rem 0.5rem 0; font-weight:600;">Price</th><td style="padding:0.5rem 0;">From ₹${price} per seat</td></tr>` : ''}
        ${e.cancellation_policy ? `<tr><th scope="row" style="text-align:left; padding:0.5rem 1rem 0.5rem 0; font-weight:600;">Cancellation</th><td style="padding:0.5rem 0;">${esc(e.cancellation_policy)}</td></tr>` : ''}
      </tbody>
    </table>

    <h2>How to book</h2>
    <p>The booking widget on the <a href="/#experiences">experiences section</a> shows every
    open slot, including waitlist offers. Annual subscribers have tour, cupping and
    teleconsult seats included with their plan.</p>

    <p style="margin-top: 2.5rem;">
      <a class="btn-primary" href="/#experiences">See open dates</a>
    </p>
  </article>
</main>

<footer class="site-footer">
  <div class="footer-bottom" style="max-width: 820px; margin: 0 auto; padding: 2rem 1.5rem;">
    <span>&copy; 2026 The Daily Roast Roastery Pvt Ltd · Bangalore, India</span>
    <span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/shipping">Shipping &amp; Returns</a></span>
  </div>
</footer>
</body>
</html>
`;
}

export function experiencesIndexPage(experiences, css) {
  const list = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Bookable experiences at the roastery',
    url: `${SITE}/experiences/`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: experiences.length,
      itemListElement: experiences.map((e, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: e.name,
        url: `${SITE}/experiences/${e.slug}`,
      })),
    },
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Bookable Experiences — Tastings, Tours &amp; Estate Visits | The Daily Roast</title>
<meta name="description" content="Tastings, roastery tours, barista teleconsultations and a three-day estate visit in Chikmagalur. Book a single seat or spend a year with us on the Daily Roast Club.">
<link rel="canonical" href="${SITE}/experiences/">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/experiences/">
<meta property="og:title" content="Bookable Experiences | The Daily Roast">
<meta property="og:description" content="Tastings, roastery tours, barista teleconsultations and an estate visit in Chikmagalur.">
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
    <div class="nav-actions"><a class="btn-primary" href="/#experiences">Book on the roastery</a></div>
  </div>
</header>
<main id="main-content" style="max-width: 820px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem;">
  <nav aria-label="Breadcrumb" style="font-size:0.85rem; margin-bottom:1.6rem;"><a href="/">Home</a> · <span>Experiences</span></nav>
  <h1 class="section-title">Bookable experiences</h1>
  <p class="section-subtitle" style="margin-bottom:2.5rem;">Tastings, tours, and visits — at the roastery in Bangalore, on video, and on the farm in Chikmagalur.</p>
  <ul style="list-style:none; padding:0; display:grid; gap:1.6rem;">
    ${experiences.map((e) => {
      const price = priceInr(e.price_cents || 0);
      return `<li style="border-bottom:1px solid rgba(0,0,0,0.08); padding-bottom:1.4rem;">
      <h2 style="margin:0 0 0.3rem; font-size:1.2rem;"><a href="/experiences/${esc(e.slug)}">${esc(e.name)}</a></h2>
      <p style="margin:0 0 0.4rem;">${esc(e.tagline || '')}</p>
      <p style="margin:0; font-size:0.9rem;">${esc(courseModeFor(e) === 'online' ? 'Online' : (e.location_name || 'Onsite'))}${e.duration_minutes ? ` · ${esc(e.duration_minutes)} min` : (Number(e.is_multi_day) === 1 ? ' · 3 days' : '')}${price > 0 ? ` · from ₹${price}` : ''}</p>
    </li>`;
    }).join('\n    ')}
  </ul>
  <p style="margin-top: 2.5rem;">
    <a class="btn-primary" href="/#experiences">Book on the roastery</a>
  </p>
</main>
<footer class="site-footer">
  <div class="footer-bottom" style="max-width:820px; margin:0 auto; padding:2rem 1.5rem;">
    <span>&copy; 2026 The Daily Roast Roastery Pvt Ltd · Bangalore, India</span>
  </div>
</footer>
</body>
</html>
`;
}

/**
 * Fetches the public experiences list from the API. Mirrors `fetchProducts` in
 * generate-seo.mjs: a failed fetch stops the build, because emitting a half-baked
 * experiences directory is the same kind of "sitemap that loses URLs" failure the
 * product fetch was hardened against.
 */
export async function fetchExperiences(apiBase) {
  let res;
  try {
    res = await fetch(`${apiBase}/api/experiences`, { signal: AbortSignal.timeout(20000) });
  } catch (err) {
    throw new Error(`Could not reach ${apiBase}/api/experiences (${err.message}). ` +
      'These pages are the only indexable experience content — refusing to build without them.');
  }
  if (!res.ok) throw new Error(`${apiBase}/api/experiences returned ${res.status}`);
  const body = await res.json();
  const experiences = (body.experiences || []).filter((e) => e.status !== 'ARCHIVED' && e.slug);
  if (experiences.length === 0) {
    throw new Error('The experiences API returned nothing usable. Refusing to emit an empty directory: ' +
      'a sitemap that loses four URLs is read as four pages deliberately removed.');
  }
  return experiences;
}
