/**
 * Storefront DOM contract, checked against the real index.html and the real stylesheet.
 *
 * This suite exists because of two escapes, both invisible to `tsc` and to the bundler.
 *
 * First, `registerNavPill` appended a bare <a> to <nav>, outside `ul.nav-links` — so the pills
 * rendered as default blue underlined links, ran together with no gap, and survived the 768px
 * rule that hides the nav on phones.
 *
 * Then, with the pills correctly inside the list, the desktop header simply could not hold
 * them: seven links, the brand and four action controls already nearly filled the 1280px
 * container, so five more wrapped every label onto two lines and collided the currency toggle
 * with the last link.
 *
 * The header is therefore left exactly as authored, and feature links live in the footer. The
 * assertions below encode that rule in both directions: nothing may be added to the header, and
 * what is added to the footer must sit in the structure the footer CSS expects.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

function storefrontRoot(): string {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'index.html')) && existsSync(join(dir, 'src', 'features', 'shared.ts'))) return dir;
    const candidate = join(dir, 'apps', 'storefront');
    if (existsSync(join(candidate, 'index.html'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate apps/storefront from ${process.cwd()}`);
}

const ROOT = storefrontRoot();
const CSS = readFileSync(join(ROOT, 'src', 'styles', 'index.css'), 'utf8');

/**
 * Loads the shipped markup and points the DOM globals at it, then imports the *real*
 * registerNavPill. Importing rather than re-implementing is the point — a transliterated copy
 * would have passed happily while the shipped code was broken.
 */
async function loadPage() {
  const dom = new JSDOM(readFileSync(join(ROOT, 'index.html'), 'utf8'), { pretendToBeVisual: true });
  (globalThis as any).document = dom.window.document;
  (globalThis as any).window = dom.window;

  const { registerNavPill } = await import('../src/features/shared');
  return { document: dom.window.document, registerNavPill };
}

/** Every label main.ts registers, in the order it registers them. */
const FEATURE_PILLS: Array<[string, string]> = [
  ['customer-profile', 'Your Profile'],
  ['loyalty-programme', 'Points'],
  ['referral-programme', 'Refer'],
  ['subscription-plans', 'Club'],
  ['experiences', 'Experiences'],
];

test('nav: the header is left exactly as authored', async () => {
  const { document, registerNavPill } = await loadPage();
  const before = document.querySelector('header')!.innerHTML;

  for (const [id, label] of FEATURE_PILLS) registerNavPill(id, label);

  assert.equal(
    document.querySelector('header')!.innerHTML,
    before,
    'the header row has no overflow handling — a feature may not add to it'
  );
  assert.equal(document.querySelectorAll('header [data-feature-nav]').length, 0);
});

test('nav: the original seven nav links are all still there', async () => {
  const { document, registerNavPill } = await loadPage();
  for (const [id, label] of FEATURE_PILLS) registerNavPill(id, label);

  const items = [...document.querySelectorAll('.nav-links > li')];
  assert.equal(items.length, 7, 'this is the configuration that fits inside 1280px');
  assert.deepEqual(
    items.map((li) => li.querySelector('a')?.textContent),
    ['Our Roasts', '3x 100g Flight', 'Flavor Wheel', 'Coffee Quiz', 'Brewing Guides', 'Bangalore Roastery', 'Track Order']
  );
});

test('nav: feature links land in a footer column, wrapped in <li> inside its <ul>', async () => {
  const { document, registerNavPill } = await loadPage();
  for (const [id, label] of FEATURE_PILLS) registerNavPill(id, label);

  const column = document.querySelector('[data-feature-nav-column]')!;
  assert.ok(column, 'the account column must be created on first use');
  assert.ok(column.classList.contains('footer-col'), 'it must carry the class the footer CSS targets');
  assert.equal(column.parentElement, document.querySelector('.footer-container'));
  assert.ok(column.querySelector('h4'), 'the sibling columns all carry a heading');

  const list = column.querySelector('ul')!;
  const pills = [...document.querySelectorAll('[data-feature-nav]')];
  assert.equal(pills.length, FEATURE_PILLS.length);
  for (const pill of pills) {
    assert.equal(pill.parentElement?.tagName, 'LI', `${pill.textContent} must be wrapped in an <li>`);
    assert.equal(pill.parentElement!.parentElement, list, `${pill.textContent} must sit inside the column list`);
  }
});

test('nav: the account column is created once, not once per feature', async () => {
  const { document, registerNavPill } = await loadPage();
  for (const [id, label] of FEATURE_PILLS) registerNavPill(id, label);

  assert.equal(document.querySelectorAll('[data-feature-nav-column]').length, 1);
});

test('nav: registering the same pill twice adds nothing', async () => {
  const { document, registerNavPill } = await loadPage();
  registerNavPill('experiences', 'Experiences');
  registerNavPill('experiences', 'Experiences');
  registerNavPill('experiences', 'Something else');

  assert.equal(document.querySelectorAll('[data-feature-nav="experiences"]').length, 1);
});

test('nav: no two feature entries carry the same label', async () => {
  const { document, registerNavPill } = await loadPage();
  for (const [id, label] of FEATURE_PILLS) registerNavPill(id, label);

  const labels = [...document.querySelectorAll('[data-feature-nav]')].map((a) => a.textContent?.trim());
  assert.equal(new Set(labels).size, labels.length, `duplicate labels: ${labels.join(' | ')}`);
});

test('nav: every pill points at a section the page will actually have', async () => {
  const { document, registerNavPill } = await loadPage();
  for (const [id, label] of FEATURE_PILLS) registerNavPill(id, label);

  for (const pill of document.querySelectorAll('[data-feature-nav]')) {
    assert.equal(pill.getAttribute('href'), `#${pill.getAttribute('data-feature-nav')}`);
  }
});

test('nav: the footer column grows instead of the header', async () => {
  const { document, registerNavPill } = await loadPage();
  for (const [id, label] of FEATURE_PILLS) registerNavPill(id, label);

  // Footer columns are a wrapping grid, so adding to them is safe in a way adding to the
  // single-row header is not.
  assert.equal(
    document.querySelectorAll('[data-feature-nav-column] li').length,
    FEATURE_PILLS.length
  );
});

// ---------------------------------------------------------------- the CSS the markup relies on

test('nav: the mobile rule that hides the whole nav is still present', () => {
  const rule = /@media\s*\(max-width:\s*768px\)[\s\S]*?\.nav-links\s*\{[^}]*display:\s*none/;
  assert.match(CSS, rule, 'phones rely on .nav-links being hidden wholesale');
});

test('nav: the footer column styling the links rely on exists', () => {
  assert.match(CSS, /\.footer-col h4\s*\{/, 'the column heading is styled by class, not inherited');
  assert.match(CSS, /\.footer-col a\s*\{[\s\S]*?text-decoration:\s*none/,
    'without this rule the links render as default blue underlines, exactly as in the header');
});

// ------------------------------------------------- the responsive header contract, pinned here
//
// The header's intrinsic width is about 1620px: brand 263, seven links 802, four controls 505.
// It has therefore never fitted on a 1280 or 1440 display, and the two failed attempts to make
// it fit are both worth remembering. Letting flex shrink the links wrapped every label onto two
// lines. Adding `white-space: nowrap` stopped the wrapping and pushed the whole *page* sideways
// instead — 1614px of scrollWidth in a 1440px viewport.
//
// What actually fixed it was noticing that the flex child of .nav-container is the <nav>
// wrapper, not `.nav-links`: without `min-width: 0` on <nav>, its default `min-width: auto`
// pinned it to its intrinsic width and no shrinking anywhere inside could take effect. With
// that unblocked, the header gives things up in a measured order rather than overflowing.
//
// Measured after the fix, every width from 769 to 1920: page overflow 0, links clipped 0.

test('header: the <nav> wrapper can shrink, or nothing inside it can', () => {
  assert.match(
    CSS,
    /\.nav-container\s*>\s*nav\s*\{[^}]*min-width:\s*0/,
    'without min-width: 0 here the header pins itself to ~1620px and pushes the page sideways'
  );
});

test('header: the degradation ladder spends the cheapest thing first', () => {
  // Each step must appear under a breakpoint no wider than the step before it, so the header
  // only ever gives up more as the screen narrows.
  const steps: Array<[number, RegExp, string]> = [
    [1899, /\.btn-ai-barista \.barista-full\s*\{\s*display:\s*none/, "the barista button's parenthetical"],
    [1679, /\.nav-links li:has\(#nav-story-link\)\s*\{\s*display:\s*none/, 'Bangalore Roastery'],
    [1439, /\.nav-links li:has\(#nav-wheel-link\)\s*\{\s*display:\s*none/, 'Flavor Wheel'],
    [1279, /\.nav-links li:has\(#nav-brew-link\)\s*\{\s*display:\s*none/, 'Brewing Guides'],
    [1099, /\.nav-links li:has\(#nav-quiz-link\)\s*\{\s*display:\s*none/, 'Coffee Quiz'],
    [979, /\.btn-ai-barista \.barista-label\s*\{\s*display:\s*none/, "Ask Maya's label (the button stays, icon-only)"],
    [879, /\.nav-links li:has\(#nav-flight-link\)\s*\{\s*display:\s*none/, '3x 100g Flight'],
  ];

  for (const [width, rule, what] of steps) {
    const block = new RegExp(`@media \\(max-width: ${width}px\\) \\{([\\s\\S]*?)\\n\\}`).exec(CSS);
    assert.ok(block, `the ${width}px step is missing entirely`);
    assert.match(block![1], rule, `${what} should be given up at ${width}px`);
  }
});

test('header: Ask Maya outlives every nav link but one', () => {
  // Maya is the only thing on this page a plain shop site could not do. If a future edit hides
  // her to make room for "Flavor Wheel", that is a regression, not a tidy-up.
  const maya = CSS.indexOf('@media (max-width: 979px)');
  const flight = CSS.indexOf('@media (max-width: 879px)');
  assert.ok(maya > 0 && flight > maya, 'Ask Maya must be surrendered later than all but one link');
});

test('layout: nothing bleeds past the viewport on a phone', () => {
  // `margin: 0 -0.5rem` on the quiz section made the document 8px wider than a 390px screen,
  // which is a full-page horizontal scroll for one section's visual bleed.
  assert.doesNotMatch(
    CSS,
    /\.quiz-section\s*\{[^}]*margin:\s*0\s+-[\d.]/,
    'a negative horizontal margin here scrolls the whole page sideways on mobile'
  );
});

test('layout: the experiences grid centres its last row instead of stranding a card', () => {
  const block = /\.experiences-grid\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(block, '.experiences-grid must be styled — it no longer borrows .product-grid');
  assert.match(block![1], /flex-wrap:\s*wrap/);
  assert.match(block![1], /justify-content:\s*center/,
    'four cards in a three-up grid left one alone against a wall of empty space');
});

test('header: Maya is reachable at every width, not just the ones with a header button', () => {
  // The bottom tab bar that carries Maya on phones only appears at 768px. Hiding the header
  // button at 979px therefore left 769–979 — iPad portrait is 810 and 834 — with no way to
  // reach her at all. She goes icon-only in that band instead of away.
  const band = /@media \(max-width: 979px\) \{([\s\S]*?)\n\}/.exec(CSS);
  assert.ok(band, 'the 979px step is missing');
  assert.doesNotMatch(band![1], /\.btn-ai-barista\s*\{\s*display:\s*none/,
    'hiding the button here strands Maya between 769 and 768px');
  assert.match(band![1], /\.barista-label\s*\{\s*display:\s*none/);
});

test('header: the icon-only button still announces itself', async () => {
  const { document } = await loadPage();
  const btn = document.querySelector('#btn-open-agent')!;
  assert.ok(btn.getAttribute('aria-label'), 'with the label hidden this is all a screen reader has');
  assert.equal(document.querySelector('.barista-spark')?.getAttribute('aria-hidden'), 'true',
    'the sparkle is decoration; the aria-label carries the meaning');
});

test('nav: every link the header can drop has a home in the footer', async () => {
  const { document } = await loadPage();
  const footer = document.querySelector('footer')!;
  const footerTargets = new Set(
    [...footer.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href'))
  );

  // The ladder hides these as the screen narrows. A link that exists nowhere at 1366px is the
  // same failure as the silent clipping this all replaced.
  for (const href of ['#taster-flight', '#flavor-wheel', '#quiz', '#brew-guide', '#roastery-story']) {
    assert.ok(footerTargets.has(href), `${href} is dropped from the header but absent from the footer`);
  }
});

test('layout: the header row fits a 360px phone', () => {
  // Wordmark + currency pills + two icon buttons came to 376px in a 360px viewport.
  assert.match(CSS, /@media \(max-width: 380px\) \{[\s\S]*?\.brand-name,[\s\S]*?display:\s*none/);
});
