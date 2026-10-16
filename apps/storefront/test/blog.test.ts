/**
 * The journal pages are generated from Markdown at build time and are the only place long-form
 * content ("what does single origin mean", "how to dial in espresso") is served as real HTML.
 * The things that would quietly break them — a mangled front-matter title, an unescaped table
 * cell, a future-dated post shipping anyway, a dead sitemap URL — are pinned here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
// @ts-expect-error — plain ESM build helpers, deliberately not TypeScript.
import { readPosts, renderMarkdown, postPage, blogIndexPage, relatedPosts, coffeeCtaSlugs, blogAsideHtml } from '../scripts/seo-blog.mjs';
// @ts-expect-error — see above.
import { sitemap, llmsTxt } from '../scripts/seo-render.mjs';

function storefrontRoot(): string {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'index.html')) && existsSync(join(dir, 'scripts', 'seo-blog.mjs'))) return dir;
    const candidate = join(dir, 'apps', 'storefront');
    if (existsSync(join(candidate, 'index.html'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate apps/storefront from ${process.cwd()}`);
}

const ROOT = storefrontRoot();
const BLOG_DIR = join(ROOT, 'content', 'blog');
const CSS = '/assets/x.css';

const parseLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

test('blog: every post file parses and has the required front matter', () => {
  const posts = readPosts(BLOG_DIR);
  assert.ok(posts.length >= 1);
  for (const p of posts) {
    for (const key of ['slug', 'title', 'description', 'date', 'cta'] as const) {
      assert.ok(p[key], `${p.slug || '(no slug)'} is missing ${key}`);
    }
    assert.ok(p.cta.label && p.cta.href, `${p.slug} has an incomplete cta`);
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('blog: the content directory and the parsed post count agree (no post silently dropped)', () => {
  const onDisk = readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md')).length;
  const parsed = readPosts(BLOG_DIR, { today: '2999-01-01' }).length;
  assert.equal(parsed, onDisk, 'a .md file failed to parse or was filtered out');
});

test('blog: a future-dated post is held back, not shipped', () => {
  const all = readPosts(BLOG_DIR, { today: '2999-01-01' });
  const asOfLaunch = readPosts(BLOG_DIR, { today: '2000-01-01' });
  assert.equal(asOfLaunch.length, 0, 'nothing should publish before it is written');
  assert.ok(all.length > asOfLaunch.length);
});

test('blog: titles keep colons and quotes intact through the front-matter parser', () => {
  const posts = readPosts(BLOG_DIR);
  const meter = posts.find((p) => p.slug === 'reading-a-roast-meter');
  assert.ok(meter, 'expected the roast-meter post');
  assert.ok(meter.title.includes(': acidity, body and sweetness'), `title was truncated: ${meter.title}`);
});

test('blog: markdown escapes before inline markup — a literal "<22s" survives', () => {
  const html = renderMarkdown([
    '| Shot | Fix |',
    '| --- | --- |',
    '| Runs fast (<22s) | Grind **finer** |',
  ].join('\n'));
  assert.match(html, /Runs fast \(&lt;22s\)/, 'the < was dropped or treated as a tag');
  assert.match(html, /<strong>finer<\/strong>/, 'bold inside a cell should still render');
  assert.doesNotMatch(html, /&amp;lt;/, 'double-escaped: inline markup ran before esc');
});

test('blog: markdown links render as anchors with the href intact', () => {
  const html = renderMarkdown('See [the guide](/blog/pour-over-at-home-v60) for more.');
  assert.match(html, /<a href="\/blog\/pour-over-at-home-v60">the guide<\/a>/);
});

test('blog: a hostile front-matter value cannot break out of the markup', () => {
  const html = renderMarkdown('A paragraph with <script>alert(1)</script> in it.');
  assert.doesNotMatch(html, /<script>alert/);
});

test('blog: every post page carries valid BlogPosting + BreadcrumbList JSON-LD', () => {
  for (const p of readPosts(BLOG_DIR)) {
    const blocks = parseLd(postPage(p, CSS));
    const types = blocks.map((b) => b['@type']).sort();
    assert.deepEqual(types, ['BlogPosting', 'BreadcrumbList'], `${p.slug} JSON-LD types`);
    const posting: any = blocks.find((b) => b['@type'] === 'BlogPosting');
    assert.equal(posting.datePublished, p.date);
    assert.equal(posting.url, `https://dailyroast.in/blog/${p.slug}`);
  }
});

test('blog: each post page is canonical to itself, not the homepage or the index', () => {
  for (const p of readPosts(BLOG_DIR)) {
    const html = postPage(p, CSS);
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)![1];
    assert.equal(canonical, `https://dailyroast.in/blog/${p.slug}`);
  }
});

test('blog: no post links to a route that does not exist', () => {
  // The real routes are /coffee/<slug>, /brew/<method>, /experiences/<slug>, /faq, /blog/<slug>,
  // and homepage hash anchors. /category/ and /product/ were never routes.
  const bad = /\]\((\/(?:category|product)\/[^)]*)\)/g;
  for (const file of readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md'))) {
    const raw = readFileSync(join(BLOG_DIR, file), 'utf8');
    const hit = bad.exec(raw);
    assert.equal(hit, null, `${file} links a dead route: ${hit?.[1]}`);
  }
});

test('blog: the sitemap lists /blog/ and every published post, and still lists products', () => {
  const posts = readPosts(BLOG_DIR);
  const xml = sitemap([{ slug: 'a-coffee', image_url: null }], [], posts);
  assert.ok(xml.includes('<loc>https://dailyroast.in/blog/</loc>'));
  for (const p of posts) assert.ok(xml.includes(`<loc>https://dailyroast.in/blog/${p.slug}</loc>`), p.slug);
  assert.ok(xml.includes('<loc>https://dailyroast.in/coffee/a-coffee</loc>'), 'products must not be lost');
});

test('blog: llms.txt gains a Journal section without losing the coffee section', () => {
  const posts = readPosts(BLOG_DIR);
  const txt = llmsTxt([{ name: 'A Coffee', slug: 'a-coffee', tagline: 't', variants: [] }], [], posts);
  assert.ok(txt.includes('## Journal'));
  assert.ok(txt.includes('## Coffee'));
  assert.ok(txt.includes('/blog/' + posts[0].slug));
});

test('blog: the index links every post', () => {
  const posts = readPosts(BLOG_DIR);
  const html = blogIndexPage(posts, CSS);
  for (const p of posts) assert.ok(html.includes(`href="/blog/${p.slug}"`), p.slug);
});

test('blog: a /coffee/<slug> CTA is only accepted if that product exists at build time', () => {
  // The product pages come from a live fetch, so a well-formed /coffee/<slug> href can still
  // 404. coffeeCtaSlugs surfaces the (post -> coffee) pairs generate-seo.mjs checks.
  const pairs = coffeeCtaSlugs(readPosts(BLOG_DIR));
  for (const { post, coffee } of pairs) {
    assert.match(coffee, /^[a-z0-9-]+$/, `${post} CTA slug looks wrong: ${coffee}`);
  }
  // Every post either points at a specific coffee or at an always-generated route.
  for (const p of readPosts(BLOG_DIR)) {
    assert.match(p.cta.href, /^\/(coffee\/[a-z0-9-]+|coffee\/|#[a-z-]+)$/, `${p.slug}: ${p.cta.href}`);
  }
});

test('blog: related posts differ per post and never include the post itself', () => {
  const posts = readPosts(BLOG_DIR);
  const first = relatedPosts(posts, posts[0].slug).map((p: any) => p.slug);
  const second = relatedPosts(posts, posts[1].slug).map((p: any) => p.slug);
  assert.ok(!first.includes(posts[0].slug));
  assert.notDeepEqual(first, second, 'every page would carry the same "more from the journal" links');
});

test('blog: the homepage teaser links the three newest posts and the index', () => {
  const posts = readPosts(BLOG_DIR);
  const aside = blogAsideHtml(posts);
  for (const p of posts.slice(0, 3)) assert.ok(aside.includes(`/blog/${p.slug}`), p.slug);
  assert.ok(aside.includes('href="/blog/"'));
  assert.ok(!aside.includes(`/blog/${posts[3].slug}`), 'the teaser is the newest three, not all');
  assert.equal(blogAsideHtml([]), '', 'no posts means no teaser, not an empty box');
});

test('blog: the index is ordered newest first', () => {
  const posts = readPosts(BLOG_DIR);
  const dates = posts.map((p) => p.date);
  assert.deepEqual([...dates], [...dates].sort().reverse(), 'index must read as a feed');
});
