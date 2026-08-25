/**
 * Storefront DOM contract, checked against the real index.html and the real stylesheet.
 *
 * This suite exists because of a specific escape. `registerNavPill` appended a bare <a> to
 * <nav>, as a sibling of `ul.nav-links` rather than an item inside it. Everything about the
 * nav's appearance and behaviour hangs off that parent — `.nav-links a` removes the underline,
 * the `ul` supplies the gap, and `@media (max-width: 768px) { .nav-links { display: none } }`
 * is what takes the nav off phones. The stray anchors therefore rendered as default blue
 * underlined links with no spacing, survived on mobile where the nav is meant to vanish, and
 * pushed the header wider than the viewport.
 *
 * None of that is visible to `tsc` or to a bundler: the markup was valid, the types were fine,
 * and the build was green. It shipped to production twice. What follows asserts the structural
 * relationships the CSS actually depends on.
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

test('nav: every feature pill is an <li> inside ul.nav-links', async () => {
  const { document, registerNavPill } = await loadPage();
  for (const [id, label] of FEATURE_PILLS) registerNavPill(id, label);

  const list = document.querySelector('ul.nav-links')!;
  const pills = [...document.querySelectorAll('[data-feature-nav]')];

  assert.equal(pills.length, FEATURE_PILLS.length);
  for (const pill of pills) {
    assert.equal(pill.parentElement?.tagName, 'LI', `${pill.textContent} must be wrapped in an <li>`);
    assert.equal(pill.parentElement!.parentElement, list, `${pill.textContent} must sit inside ul.nav-links`);
  }
});

test('nav: nothing is appended to <nav> as a sibling of the list', async () => {
  const { document, registerNavPill } = await loadPage();
  for (const [id, label] of FEATURE_PILLS) registerNavPill(id, label);

  // A single <ul> child is the whole invariant: anything else is outside the cascade and
  // outside the mobile hide.
  const children = [...document.querySelector('header nav')!.children];
  assert.deepEqual(children.map((c) => c.tagName), ['UL']);
});

test('nav: registering the same pill twice adds nothing', async () => {
  const { document, registerNavPill } = await loadPage();
  registerNavPill('experiences', 'Experiences');
  registerNavPill('experiences', 'Experiences');
  registerNavPill('experiences', 'Something else');

  assert.equal(document.querySelectorAll('[data-feature-nav="experiences"]').length, 1);
});

test('nav: no two entries carry the same label', async () => {
  const { document, registerNavPill } = await loadPage();
  for (const [id, label] of FEATURE_PILLS) registerNavPill(id, label);

  const labels = [...document.querySelectorAll('.nav-links a')].map((a) => a.textContent?.trim());
  assert.equal(new Set(labels).size, labels.length, `duplicate nav labels: ${labels.join(' | ')}`);
});

test('nav: every pill points at a section the page will actually have', async () => {
  const { document, registerNavPill } = await loadPage();
  for (const [id, label] of FEATURE_PILLS) registerNavPill(id, label);

  for (const pill of document.querySelectorAll('[data-feature-nav]')) {
    assert.equal(pill.getAttribute('href'), `#${pill.getAttribute('data-feature-nav')}`);
  }
});

test('nav: the header does not grow unbounded as features are added', async () => {
  const { document, registerNavPill } = await loadPage();
  for (const [id, label] of FEATURE_PILLS) registerNavPill(id, label);

  // The desktop header lays the links out in a single flex row with a 2rem gap. There is no
  // overflow treatment, so the count is the only thing keeping it on one line.
  const items = document.querySelectorAll('.nav-links > li').length;
  assert.ok(items <= 12, `${items} nav items — the header row has no overflow handling`);
});

// ---------------------------------------------------------------- the CSS the markup relies on

test('nav: the mobile rule that hides the whole nav is still present', () => {
  const rule = /@media\s*\(max-width:\s*768px\)[\s\S]*?\.nav-links\s*\{[^}]*display:\s*none/;
  assert.match(CSS, rule, 'phones rely on .nav-links being hidden wholesale');
});

test('nav: link styling comes from the list, which is why pills must live in it', () => {
  assert.match(CSS, /\.nav-links a\s*\{[\s\S]*?text-decoration:\s*none/);
  assert.match(CSS, /\.nav-links\s*\{[\s\S]*?gap:/, 'the spacing between entries is the ul’s gap');
});
