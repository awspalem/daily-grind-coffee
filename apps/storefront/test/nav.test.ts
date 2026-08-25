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
