/**
 * Emits a .webp beside every local raster image in dist/, then rewrites the built HTML to serve
 * it through a <picture>.
 *
 * Why it works this way. A <source> is chosen on its declared `type` alone, and the <img>
 * fallback runs only when the *format* is unsupported — never when the chosen source 404s. The
 * homepage previously shipped a hand-written <source> pointing at a .webp nobody generated, so
 * the hero and the roastery photo rendered as empty boxes in every browser that supports webp
 * (all of them), while `npm run build && npm test` stayed green. See commit a3da7b0.
 *
 * The rule that keeps that from coming back: a <source> is only ever written for a file this
 * script has just produced, in the same run. Nothing is hand-authored, so nothing can go stale
 * against its source, and a conversion failure removes the <source> rather than leaving a
 * dangling one. Committing .webp files next to the .jpg would reintroduce exactly the old
 * failure — a stale webp always wins over a fresh jpg, invisibly.
 *
 * Runs after generate-seo.mjs so the pages that script writes (coffee, brew, journal, aeo) get
 * the same treatment as index.html.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const IMAGES = join(DIST, 'images');

/** Every file under `dir` whose extension is in `exts`, recursively. */
function walk(dir, exts) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full, exts));
    else if (exts.includes(extname(entry).toLowerCase())) out.push(full);
  }
  return out;
}

// -------------------------------------------------------------------- convert

const sources = walk(IMAGES, ['.jpg', '.jpeg', '.png']);

/** Public path (e.g. "/images/pour_over.jpg") -> its generated webp path. */
const converted = new Map();
let savedBytes = 0;

for (const src of sources) {
  const webpPath = join(dirname(src), `${basename(src, extname(src))}.webp`);
  try {
    // effort 5 is the point where the extra CPU stops buying meaningful size on these photos.
    await sharp(src).webp({ quality: 78, effort: 5 }).toFile(webpPath);

    const before = statSync(src).size;
    const after = statSync(webpPath).size;
    // A webp that is not smaller is not worth an extra request path; leave the jpg alone.
    if (after >= before) continue;

    converted.set(`/images/${basename(src)}`, `/images/${basename(webpPath)}`);
    savedBytes += before - after;
  } catch (err) {
    console.warn(`webp: could not convert ${basename(src)} — ${err.message}`);
  }
}

// ------------------------------------------------------------------- rewrite

const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTR = /\bsrc\s*=\s*["']([^"']+)["']/i;

/**
 * Wraps each <img> whose src has a generated webp in a <picture>. Images already inside a
 * <picture> are left alone, as are remote ones — the catalog's images are client-rendered from
 * the API and never appear in the built HTML at all.
 */
function addPictureSources(html) {
  let count = 0;
  const out = html.replace(IMG_TAG, (tag, offset) => {
    const src = tag.match(SRC_ATTR)?.[1];
    const webp = src && converted.get(src);
    if (!webp) return tag;
    if (/<picture[^>]*>\s*$/i.test(html.slice(Math.max(0, offset - 400), offset))) return tag;

    count++;
    return `<picture><source type="image/webp" srcset="${webp}">${tag}</picture>`;
  });
  return { out, count };
}

let pagesTouched = 0;
let imgsWrapped = 0;

for (const page of walk(DIST, ['.html'])) {
  const html = readFileSync(page, 'utf8');
  const { out, count } = addPictureSources(html);
  if (!count) continue;
  writeFileSync(page, out);
  pagesTouched++;
  imgsWrapped += count;
}

console.log(
  `webp: ${converted.size} image(s) converted (−${(savedBytes / 1024).toFixed(0)}kB), ` +
    `${imgsWrapped} <img> wrapped across ${pagesTouched} page(s)`
);
