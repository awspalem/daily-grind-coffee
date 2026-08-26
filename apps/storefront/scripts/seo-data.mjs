/**
 * Shared vocabulary for the generated pages.
 *
 * `price_cents` from the API is USD cents; the storefront derives the rupee price from it with
 * a fixed 0.23 factor (see the products fetch in main.ts). The generated pages MUST use that
 * same derivation rather than a prettier one of their own: a price in structured data that
 * disagrees with the price on the page is worse than no structured data at all, because search
 * engines surface the marked-up figure and shoppers arrive expecting it.
 *
 * That factor implies about Rs 23 to the dollar, which is not a real exchange rate — see
 * docs/roadmap-gaps.md. Whichever way that gets resolved, these pages will keep matching the
 * storefront, because they read the same field through the same function.
 */
export const INR_PER_PRICE_CENT = 0.23;

export const priceInr = (cents) => Math.round(Number(cents) * INR_PER_PRICE_CENT);

export const SITE = 'https://dailyroast.in';

const ROAST = {
  LIGHT: 'Light', MEDIUM_LIGHT: 'Medium-light', MEDIUM: 'Medium',
  MEDIUM_DARK: 'Medium-dark', DARK: 'Dark',
};

const PROCESS = {
  WASHED: 'Washed', NATURAL: 'Natural', HONEY: 'Honey', ANAEROBIC: 'Anaerobic',
  MONSOONED: 'Monsooned', SEMI_WASHED: 'Semi-washed',
};

const GRIND = {
  WHOLE_BEAN: 'Whole bean', POUR_OVER: 'Pour over', SOUTH_INDIAN_FILTER: 'South Indian filter',
  ESPRESSO: 'Espresso', AEROPRESS: 'AeroPress', FRENCH_PRESS: 'French press',
  COLD_BREW: 'Cold brew', COLD_BREW_COARSE: 'Cold brew (coarse)', MOKA_POT: 'Moka pot',
};

export const roastLabel = (v) => ROAST[v] || titleish(v);
export const processLabel = (v) => PROCESS[v] || titleish(v);
export const grindLabel = (v) => GRIND[v] || titleish(v);

function titleish(v) {
  if (!v) return '';
  return String(v).toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** HTML-escape. Every value below is API data, so none of it may be trusted into markup. */
export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * JSON-LD needs to survive inside a <script> element, where the parser looks for `</script`
 * before it looks for JSON. Escaping the angle brackets is what stops a stray value closing
 * the block early.
 */
export const jsonLd = (obj) =>
  JSON.stringify(obj, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
