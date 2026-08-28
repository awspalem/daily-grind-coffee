import { icons } from './icons';
import { triggerHaptic, esc } from './features/shared';
import { closeMobileDrawer } from './core/shell';

export interface RouteModule {
  /** Returning a cleanup function is optional — only needed for anything not scoped to `container`. */
  mount(container: HTMLElement): void | (() => void) | Promise<void | (() => void)>;
}

export interface NavRoute {
  kind: 'route';
  key: string;
  label: string;
  subtitle: string;
  section: string;
  icon: string;
  load: () => Promise<RouteModule>;
}

export interface NavLink {
  kind: 'link';
  key: string;
  label: string;
  icon: string;
  href: string;
}

export type NavEntry = NavRoute | NavLink;

// Single source of truth for sidebar order, labels, icons, subtitles, and
// lazy-loaded route modules. `subtitle` is shown under the page title in the
// top bar; `section` is the sidebar group this entry belongs to.
export const NAV: NavEntry[] = [
  // Operations
  { kind: 'route', key: 'overview',  label: 'Daily Operations',          subtitle: "Today's orders, stock & roastery briefing",     section: 'Operations',         icon: icons.dashboard, load: () => import('./features/overview').then((m) => m.default) },
  { kind: 'route', key: 'orders',    label: 'Order Fulfillment',         subtitle: 'Dispatch, GST invoices & bag labels',           section: 'Operations',         icon: icons.truck,    load: () => import('./features/orders').then((m) => m.default) },
  { kind: 'route', key: 'roasts',    label: 'Batch Roaster & Loss Log',  subtitle: 'Green kg in, roasted kg out, loss calibration', section: 'Operations',         icon: icons.flame,    load: () => import('./features/roasts').then((m) => m.default) },
  { kind: 'route', key: 'inventory', label: 'Inventory Management',      subtitle: 'Stock levels, restocks, damage & returns',       section: 'Operations',         icon: icons.box,      load: () => import('./features/inventory').then((m) => m.default) },
  { kind: 'route', key: 'labels',    label: 'Bag Labels & QR Studio',    subtitle: '3" × 4" thermal label designer & QR',            section: 'Operations',         icon: icons.tag,      load: () => import('./features/labels').then((m) => m.default) },
  { kind: 'route', key: 'sourcing',  label: 'Sourcing Scanner & Season Calendar', subtitle: 'Green-bean lots, harvest windows & roast plan', section: 'Operations', icon: icons.folder, load: () => import('./features/sourcing').then((m) => m.default) },

  // Catalog & Pricing
  { kind: 'route', key: 'catalog',         label: 'Product Catalog',         subtitle: 'Manage products, variants & imagery',                section: 'Catalog & Pricing', icon: icons.leaf,     load: () => import('./features/catalog').then((m) => m.default) },
  { kind: 'route', key: 'pricing',         label: 'Catalog, Pricing & Discounts', subtitle: 'INR/USD price control & discount engine',        section: 'Catalog & Pricing', icon: icons.percent,  load: () => import('./features/pricing').then((m) => m.default) },
  { kind: 'route', key: 'coupons',         label: 'Promo Coupons Engine',    subtitle: 'Code-based discounts for the storefront',            section: 'Catalog & Pricing', icon: icons.ticket,   load: () => import('./features/coupons').then((m) => m.default) },
  { kind: 'route', key: 'promotions',      label: 'Sales & Promotions',      subtitle: 'Time-bounded sales linked to optional coupons',      section: 'Catalog & Pricing', icon: icons.percent,  load: () => import('./features/promotions').then((m) => m.default) },
  { kind: 'route', key: 'plans',           label: 'Subscription Plans',      subtitle: 'EXPLORER · CONNOISSEUR · FOUNDER tier CRUD',         section: 'Catalog & Pricing', icon: icons.layers,   load: () => import('./features/plans').then((m) => m.default) },
  { kind: 'route', key: 'subscriptions',   label: 'Subscribe & Save',        subtitle: 'Active, paused, past-due & cancelled subscribers',   section: 'Catalog & Pricing', icon: icons.refresh,  load: () => import('./features/subscriptions').then((m) => m.default) },
  { kind: 'route', key: 'limited-editions',label: 'Limited Editions',        subtitle: 'Drops, launch windows & unit caps',                  section: 'Catalog & Pricing', icon: icons.sparkle,  load: () => import('./features/limited-editions').then((m) => m.default) },

  // Economics
  { kind: 'route', key: 'capacity',  label: 'Capacity vs Demand Matrix', subtitle: 'Roaster kg tier vs. breakeven demand',        section: 'Economics', icon: icons.gauge,    load: () => import('./features/economics/capacity').then((m) => m.default) },
  { kind: 'route', key: 'capex',     label: 'Roaster Pricing & CapEx',   subtitle: 'India-market roaster benchmarks, 5-yr depreciation', section: 'Economics', icon: icons.factory,  load: () => import('./features/economics/capex').then((m) => m.default) },
  { kind: 'route', key: 'economics', label: 'Unit Economics & Margins',  subtitle: 'Live margin & breakeven controller',         section: 'Economics', icon: icons.dollar,   load: () => import('./features/economics/unit-economics').then((m) => m.default) },

  // Customer & Marketing
  { kind: 'route', key: 'reviews',      label: 'Customer Reviews',        subtitle: 'Moderation queue with verified-purchase context', section: 'Customer & Marketing', icon: icons.star,      load: () => import('./features/reviews').then((m) => m.default) },
  { kind: 'route', key: 'experiences',  label: 'Roastery Experiences',    subtitle: 'Cupping, tours & bookable sessions',               section: 'Customer & Marketing', icon: icons.calendar,  load: () => import('./features/experiences').then((m) => m.default) },
  { kind: 'route', key: 'channels',     label: 'Communication Channels',  subtitle: 'IG, WA, email & outreach planning',               section: 'Customer & Marketing', icon: icons.megaphone, load: () => import('./features/channels').then((m) => m.default) },
  { kind: 'route', key: 'campaigns',    label: 'Social Media Campaigns',  subtitle: 'DRAFT → SCHEDULED → LIVE → COMPLETED lifecycle',  section: 'Customer & Marketing', icon: icons.send,      load: () => import('./features/campaigns').then((m) => m.default) },

  // External — always rendered at the bottom of the sidebar as a ghost link
  { kind: 'link', key: 'investor', label: 'Investor Readiness & Growth', icon: icons.rocket, href: '/investor.html' },
];

// Sidebar grouping — drives both the visual section labels and the
// command-palette grouping. Order here is the display order top-to-bottom.
export const SECTIONS: Array<{ title: string; keys: string[] }> = [
  { title: 'Operations',          keys: ['overview', 'orders', 'roasts', 'inventory', 'labels', 'sourcing'] },
  { title: 'Catalog & Pricing',   keys: ['catalog', 'pricing', 'coupons', 'promotions', 'plans', 'subscriptions', 'limited-editions'] },
  { title: 'Economics',           keys: ['capacity', 'capex', 'economics'] },
  { title: 'Customer & Marketing', keys: ['reviews', 'experiences', 'channels', 'campaigns'] },
];

const routesByKey = new Map<string, NavRoute>(
  NAV.filter((e): e is NavRoute => e.kind === 'route').map((r) => [r.key, r])
);

let navGeneration = 0;
let activeCleanup: (() => void) | void;

function outlet(): HTMLElement {
  const el = document.getElementById('route-outlet');
  if (!el) throw new Error('#route-outlet is missing from index.html');
  return el;
}

function currentKey(): string {
  const key = location.pathname.replace(/^\//, '');
  return key || 'overview';
}

function syncNavActiveState(key: string): void {
  document.querySelectorAll('.nav-item-btn[data-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === key);
  });
}

function syncHeader(route: NavRoute): void {
  const titleEl = document.getElementById('header-title');
  const subEl   = document.getElementById('header-subtitle');
  const crumbEl = document.getElementById('header-breadcrumb');
  if (titleEl) titleEl.textContent = route.label;
  if (subEl)   subEl.textContent   = route.subtitle;
  if (crumbEl) {
    crumbEl.innerHTML =
      `<span>Roastery</span><span class="bc-sep">/</span>` +
      `<span>${esc(route.section)}</span><span class="bc-sep">/</span>` +
      `<span class="bc-current">${esc(route.label)}</span>`;
  }
}

async function renderRoute(key: string): Promise<void> {
  const route = routesByKey.get(key) ?? routesByKey.get('overview')!;
  const myGeneration = ++navGeneration;

  if (typeof activeCleanup === 'function') {
    try {
      activeCleanup();
    } catch (err) {
      console.error('[router] cleanup failed', err);
    }
  }
  activeCleanup = undefined;

  const el = outlet();
  el.innerHTML = '<div class="route-loading">Loading…</div>';

  let mod: RouteModule;
  try {
    mod = await route.load();
  } catch (err) {
    console.error(`[router] failed to load route "${route.key}"`, err);
    if (myGeneration !== navGeneration) return;
    el.innerHTML = '<div class="route-error">This section failed to load. Try reloading the page.</div>';
    return;
  }
  if (myGeneration !== navGeneration) return;

  el.innerHTML = '';
  const result = await mod.mount(el);
  if (myGeneration !== navGeneration) return;

  activeCleanup = typeof result === 'function' ? result : undefined;
  syncNavActiveState(route.key);
  syncHeader(route);
  document.title = `${route.label} · The Daily Roast Admin`;
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const key = path.replace(/^\//, '') || 'overview';
  if (!routesByKey.has(key)) return;
  if (opts.replace) {
    history.replaceState(null, '', `/${key}`);
  } else {
    history.pushState(null, '', `/${key}`);
  }
  void renderRoute(key);
}

function findEntry(key: string): NavEntry | undefined {
  return NAV.find((e) => e.key === key);
}

function renderGroupedSidebarNav(): void {
  const list = document.getElementById('sidebar-nav');
  if (!list) return;

  const navRoutesByKey = new Map(NAV.filter((e): e is NavRoute => e.kind === 'route').map((r) => [r.key, r]));

  const sectionsHtml = SECTIONS.map((section) => {
    const itemsHtml = section.keys
      .map((k) => navRoutesByKey.get(k))
      .filter((entry): entry is NavRoute => Boolean(entry))
      .map((entry) => `
        <li>
          <button class="nav-item-btn" data-tab="${esc(entry.key)}" type="button">
            ${entry.icon}<span>${esc(entry.label)}</span>
          </button>
        </li>`)
      .join('');
    return `
      <div class="sidebar-section">
        <div class="sidebar-section-label">${esc(section.title)}</div>
        <ul class="sidebar-section-list" style="list-style: none; display: flex; flex-direction: column; gap: 0.15rem;">${itemsHtml}</ul>
      </div>`;
  }).join('');

  // External (Investor Portal) is always last, separated by a divider
  const external = NAV.find((e): e is NavLink => e.kind === 'link');
  const externalHtml = external
    ? `<li><a href="${esc(external.href)}" class="nav-item-btn nav-item-btn--external">${external.icon}<span>${esc(external.label)}</span></a></li>`
    : '';

  list.innerHTML = `
    ${sectionsHtml}
    <div class="sidebar-divider"></div>
    ${externalHtml}
  `;

  list.querySelectorAll<HTMLButtonElement>('button.nav-item-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      triggerHaptic();
      closeMobileDrawer();
      navigate(`/${btn.getAttribute('data-tab')}`);
    });
  });
}

export function initRouter(): void {
  renderGroupedSidebarNav();

  window.addEventListener('popstate', () => {
    void renderRoute(currentKey());
  });

  const startKey = currentKey();
  if (location.pathname === '/' || !routesByKey.has(startKey)) {
    navigate('/overview', { replace: true });
  } else {
    void renderRoute(startKey);
  }
}

// Re-exported so core/cmdK.ts can read them without circular imports
export { findEntry, routesByKey };
