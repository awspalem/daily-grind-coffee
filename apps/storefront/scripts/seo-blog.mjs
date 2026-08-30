/**
 * The journal: /blog/<slug> pages and a /blog/ index, generated from the Markdown files in
 * apps/storefront/content/blog/.
 *
 * Same reasoning as the coffee and brew pages — the shop is a single client-rendered URL, so
 * long-form content that could earn organic traffic ("how to dial in espresso", "what does
 * single origin mean") has to be served as real HTML at its own URL or it may as well not
 * exist. The posts are plain Markdown so they can be edited without touching code; this module
 * is the only place that knows how to turn them into pages.
 *
 * Pure except for readPosts (filesystem only, no network). Rendering is separated so the test
 * suite can feed it fixtures.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SITE, esc, jsonLd } from './seo-data.mjs';
import { PAGE_CSS } from './seo-render.mjs';

const REQUIRED = ['title', 'slug', 'description', 'date', 'cta_label', 'cta_href'];

/**
 * Front matter is a deliberately tiny subset of YAML: `key: value`, one per line, values are
 * bare scalars (no quoting, no nesting). A post is written by us, not fetched, so the parser
 * can be strict and simple — but it still splits on the *first* colon only, because titles and
 * descriptions contain them ("How to read our roast meters: acidity, body and sweetness").
 */
function parseFrontMatter(raw, file) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error(`${file}: no front matter block`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    if (i === -1) throw new Error(`${file}: front-matter line without a colon: ${line}`);
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

/**
 * Read and validate every post. Mirrors the house style of fetchProducts / the brew-recipe
 * check in generate-seo.mjs: a malformed post fails the build rather than silently dropping a
 * URL from the sitemap, and a post dated in the future is held back rather than shipped with a
 * datePublished a crawler will discount.
 */
export function readPosts(dir, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) throw new Error(`No .md posts in ${dir}`);

  const posts = [];
  const seen = new Set();
  for (const file of files) {
    const { meta, body } = parseFrontMatter(readFileSync(join(dir, file), 'utf8'), file);
    for (const key of REQUIRED) {
      if (!meta[key]) throw new Error(`${file}: missing required front-matter field "${key}"`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.slug)) {
      throw new Error(`${file}: slug "${meta.slug}" is not a clean kebab-case slug`);
    }
    if (seen.has(meta.slug)) throw new Error(`${file}: duplicate slug "${meta.slug}"`);
    seen.add(meta.slug);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
      throw new Error(`${file}: date "${meta.date}" must be YYYY-MM-DD`);
    }
    if (meta.date > today) {
      console.warn(`seo: holding back /blog/${meta.slug} — dated ${meta.date}, in the future`);
      continue;
    }
    posts.push({
      slug: meta.slug,
      title: meta.title,
      description: meta.description,
      date: meta.date,
      tags: (meta.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
      cta: { label: meta.cta_label, href: meta.cta_href },
      bodyHtml: renderMarkdown(body),
    });
  }
  // Newest first — the index reads as a feed.
  posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));
  return posts;
}

/**
 * Slugs a post's CTA points at with `/coffee/<slug>`. generate-seo.mjs checks these against the
 * live product list and fails the build on a miss — a well-formed href to a coffee page that was
 * never generated is the same defect as the brew cards that once linked three non-existent pages.
 */
export function coffeeCtaSlugs(posts) {
  const out = [];
  for (const p of posts) {
    const m = /^\/coffee\/([a-z0-9-]+)\/?$/.exec(p.cta.href);
    if (m) out.push({ post: p.slug, coffee: m[1] });
  }
  return out;
}

// --------------------------------------------------------------------------- Markdown rendering
//
// A small renderer for the subset the posts actually use: ATX headings, paragraphs, ordered and
// unordered lists (with soft-wrapped continuation lines), pipe tables, horizontal rules,
// blockquotes, and inline **bold** / `code` / [links](/x). Everything is HTML-escaped before any
// inline markup runs, so a literal "(<22s)" in a table cell survives as text and a generated
// <strong> is never double-escaped. Hrefs in our posts are site-relative or plain https with no
// query strings, so escaping them as text is safe.

function inline(rawText) {
  let t = esc(rawText);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href}">${label}</a>`);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return t;
}

const splitRow = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

const BLOCK_START = /^(#{1,6}\s|[-*]\s|\d+\.\s|>\s?|\|)/;

export function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      // The page <h1> is the post title, so body headings start at <h2>: `##` -> h2, `###` -> h3.
      const level = Math.min(Math.max(heading[1].length, 2), 6);
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    if (/^\|(.+)\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|(.+)\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      out.push(renderTable(header, rows));
      continue;
    }

    if (/^[-*]\s+/.test(line)) { i = collectList(lines, i, out, 'ul', /^[-*]\s+/); continue; }
    if (/^\d+\.\s+/.test(line)) { i = collectList(lines, i, out, 'ol', /^\d+\.\s+/); continue; }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i]) && !/^---+\s*$/.test(lines[i])) {
      buf.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }

  return out.join('\n');
}

function collectList(lines, i, out, tag, marker) {
  const items = [];
  while (i < lines.length && marker.test(lines[i])) {
    let item = lines[i].replace(marker, '');
    i++;
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i]) && !/^---+\s*$/.test(lines[i])) {
      item += ' ' + lines[i].trim();
      i++;
    }
    items.push(`<li>${inline(item)}</li>`);
  }
  out.push(`<${tag}>${items.join('')}</${tag}>`);
  return i;
}

function renderTable(header, rows) {
  const th = header.map((c) => `<th scope="col">${inline(c)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${header.map((_, c) => `<td>${inline(r[c] ?? '')}</td>`).join('')}</tr>`)
    .join('\n      ');
  return `<table style="width:100%; border-collapse: collapse; margin: 1.6rem 0;">
  <thead><tr>${th}</tr></thead>
  <tbody>
      ${body}
  </tbody>
</table>`;
}

// --------------------------------------------------------------------------------- page renders

const BLOG_CSS = `<style>
  .post-body h2 { font-family: var(--font-serif, Georgia, serif); font-size: 1.35rem; margin: 2.4rem 0 0.8rem; }
  .post-body h3 { font-size: 1.08rem; margin: 1.8rem 0 0.6rem; }
  .post-body p, .post-body li { line-height: 1.75; }
  .post-body ul, .post-body ol { padding-left: 1.4rem; margin: 0 0 1.4rem; }
  .post-body li { margin-bottom: 0.4rem; }
  .post-body hr { border: none; border-top: 1px solid rgba(0,0,0,0.12); margin: 2.5rem 0 1.5rem; }
  .post-body table th, .post-body table td { border-bottom: 1px solid rgba(0,0,0,0.08); padding: 0.5rem 0.8rem 0.5rem 0; text-align: left; }
  .post-body code { background: rgba(0,0,0,0.06); padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.9em; }
  .post-cta { display: inline-block; margin-top: 1rem; }
  .post-meta { font-size: 0.85rem; color: var(--text-muted, #6b6b6b); margin-bottom: 1.6rem; }
</style>`;

function shell({ title, description, canonical, css, ld, main }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="en-in" href="${canonical}">
<link rel="alternate" hreflang="x-default" href="${canonical}">
<meta name="theme-color" content="#1b1614">
<meta property="og:type" content="article">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="The Daily Roast">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/images/roaster.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}/images/roaster.jpg">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="stylesheet" href="${css}">
${PAGE_CSS}
${BLOG_CSS}
${ld.map((obj) => `<script type="application/ld+json">\n${jsonLd(obj)}\n</script>`).join('\n')}
</head>
<body>
<header class="site-header">
  <div class="nav-container">
    <a href="/" class="brand-logo"><div><span class="brand-name">THE DAILY ROAST</span></div></a>
    <div class="nav-actions"><a class="btn-primary" href="/#catalog">Shop all coffee</a></div>
  </div>
</header>
${main}
<footer class="site-footer">
  <div class="footer-bottom" style="max-width: 780px; margin: 0 auto; padding: 2rem 1.5rem; display:flex; flex-wrap:wrap; gap:0.8rem; justify-content:space-between;">
    <span>&copy; 2026 The Daily Roast Roastery Pvt Ltd &middot; Bangalore, India</span>
    <span><a href="/blog/">Journal</a> &middot; <a href="/coffee/">Coffee</a> &middot; <a href="/brew/">Brewing guides</a> &middot; <a href="/faq">FAQ</a></span>
  </div>
</footer>
</body>
</html>
`;
}

export function postPage(post, css, related = []) {
  const canonical = `${SITE}/blog/${post.slug}`;
  const posting = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    author: { '@type': 'Organization', name: 'The Daily Roast' },
    publisher: { '@type': 'Organization', name: 'The Daily Roast', url: SITE },
    mainEntityOfPage: canonical,
    url: canonical,
    keywords: post.tags.join(', ') || undefined,
    isPartOf: { '@type': 'Blog', name: 'The Daily Roast Journal', url: `${SITE}/blog/` },
  };
  const crumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Journal', item: `${SITE}/blog/` },
      { '@type': 'ListItem', position: 3, name: post.title, item: canonical },
    ],
  };
  const prettyDate = new Date(post.date + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });

  const main = `<main id="main-content" style="max-width: 780px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem;">
  <nav aria-label="Breadcrumb" style="font-size: 0.85rem; margin-bottom: 1.6rem;">
    <a href="/">Home</a> &middot; <a href="/blog/">Journal</a> &middot; <span>${esc(post.title)}</span>
  </nav>
  <article>
    <h1 class="section-title" style="margin: 0 0 0.6rem;">${esc(post.title)}</h1>
    <p class="post-meta">${esc(prettyDate)}${post.tags.length ? ' &middot; ' + post.tags.map(esc).join(', ') : ''}</p>
    <div class="post-body">
${post.bodyHtml}
    </div>
    <p><a class="btn-primary post-cta" href="${esc(post.cta.href)}">${esc(post.cta.label)}</a></p>
  </article>
  ${related.length ? `<aside style="margin-top: 3rem; border-top: 1px solid rgba(0,0,0,0.12); padding-top: 1.5rem;">
    <h2 style="font-size: 1rem; margin: 0 0 0.8rem;">More from the journal</h2>
    <ul style="list-style: none; padding: 0; display: grid; gap: 0.8rem;">
      ${related.map((r) => `<li><a href="/blog/${esc(r.slug)}">${esc(r.title)}</a></li>`).join('\n      ')}
    </ul>
  </aside>` : ''}
</main>`;

  return shell({
    title: `${post.title} | The Daily Roast`,
    description: post.description,
    canonical,
    css,
    ld: [posting, crumb],
    main,
  });
}

export function blogIndexPage(posts, css) {
  const blog = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'The Daily Roast Journal',
    description: 'Brewing guides, sourcing notes and how the shop works, from the roastery in Bangalore.',
    url: `${SITE}/blog/`,
    publisher: { '@type': 'Organization', name: 'The Daily Roast', url: SITE },
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      description: p.description,
      datePublished: p.date,
      url: `${SITE}/blog/${p.slug}`,
    })),
  };
  const crumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Journal', item: `${SITE}/blog/` },
    ],
  };

  const main = `<main id="main-content" style="max-width: 780px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem;">
  <nav aria-label="Breadcrumb" style="font-size: 0.85rem; margin-bottom: 1.6rem;"><a href="/">Home</a> &middot; <span>Journal</span></nav>
  <h1 class="section-title">The Journal</h1>
  <p class="section-subtitle" style="margin-bottom: 2.5rem;">Brewing guides, sourcing notes and how the shop works &mdash; written at the roastery in Bangalore.</p>
  <ul style="list-style: none; padding: 0; display: grid; gap: 2rem;">
    ${posts.map((p) => {
      const prettyDate = new Date(p.date + 'T00:00:00Z').toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
      });
      return `<li style="border-bottom: 1px solid rgba(0,0,0,0.08); padding-bottom: 1.6rem;">
      <p class="post-meta" style="margin: 0 0 0.3rem;">${esc(prettyDate)}</p>
      <h2 style="margin: 0 0 0.4rem; font-size: 1.2rem;"><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></h2>
      <p style="margin: 0;">${esc(p.description)}</p>
    </li>`;
    }).join('\n    ')}
  </ul>
</main>`;

  return shell({
    title: 'The Journal — Brewing Guides & Sourcing Notes | The Daily Roast',
    description: 'Brewing guides, sourcing notes and how the shop works, from The Daily Roast roastery in Bangalore.',
    canonical: `${SITE}/blog/`,
    css,
    ld: [blog, crumb],
    main,
  });
}

/**
 * A small block linking the homepage to the three newest posts, injected just before `</main>`
 * by generate-seo.mjs — the same mechanism the AEO aside uses. Without this the journal is
 * reachable from `/` only through the footer, which passes almost no internal link equity.
 */
export function blogAsideHtml(posts) {
  const latest = posts.slice(0, 3);
  if (!latest.length) return '';
  return `<aside class="journal-teaser" aria-label="From the journal" style="max-width: 820px; margin: 2rem auto; padding: 1.1rem 1.3rem; background: var(--bg-secondary, #f6efe7); border: 1px solid var(--border-subtle, #e3d9cb); border-radius: 10px;">
  <p style="margin: 0 0 0.6rem; font-weight: 600;">From the journal</p>
  <ul style="margin: 0; padding-left: 1.1rem; font-size: 0.92rem; line-height: 1.7;">
    ${latest.map((p) => `<li><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></li>`).join('\n    ')}
  </ul>
  <p style="margin: 0.7rem 0 0; font-size: 0.9rem;"><a href="/blog/">All ${posts.length} guides &amp; notes &rarr;</a></p>
</aside>`;
}

/**
 * Up to `n` other posts for the in-page "more from the journal" block. Takes the ones that
 * follow this post in the (newest-first) list and wraps around, so each post surfaces a
 * different set rather than every page linking the same three newest.
 */
export function relatedPosts(posts, slug, n = 3) {
  const i = posts.findIndex((p) => p.slug === slug);
  if (i === -1) return posts.slice(0, n);
  return [...posts.slice(i + 1), ...posts.slice(0, i)].slice(0, n);
}
