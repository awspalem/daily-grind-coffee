import { icons } from './icons';
import { triggerHaptic } from './features/shared';
import { closeMobileDrawer } from './core/shell';

export interface RouteModule {
  /** Returning a cleanup function is optional — only needed for anything not scoped to `container`. */
  mount(container: HTMLElement): void | (() => void) | Promise<void | (() => void)>;
}

interface NavRoute {
  kind: 'route';
  key: string;
  label: string;
  icon: string;
  load: () => Promise<RouteModule>;
}

interface NavLink {
  kind: 'link';
  key: string;
  label: string;
  icon: string;
  href: string;
}

type NavEntry = NavRoute | NavLink;

// Single source of truth for sidebar order, labels, icons, and lazy-loaded route modules.
const NAV: NavEntry[] = [
  { kind: 'route', key: 'overview', label: 'Daily Operations', icon: icons.dashboard, load: () => import('./features/overview').then((m) => m.default) },
  { kind: 'link', key: 'investor', label: 'Investor Readiness & Growth ↗', icon: icons.rocket, href: '/investor.html' },
  { kind: 'route', key: 'labels', label: 'Bag Labels & QR Studio', icon: icons.tag, load: () => import('./features/labels').then((m) => m.default) },
  { kind: 'route', key: 'pricing', label: 'Catalog, Pricing & Discounts', icon: icons.percent, load: () => import('./features/pricing').then((m) => m.default) },
  { kind: 'route', key: 'inventory', label: 'Inventory Management', icon: icons.box, load: () => import('./features/inventory').then((m) => m.default) },
  { kind: 'route', key: 'catalog', label: 'Product Catalog', icon: icons.leaf, load: () => import('./features/catalog').then((m) => m.default) },
  { kind: 'route', key: 'capacity', label: 'Capacity vs Demand Matrix', icon: icons.gauge, load: () => import('./features/economics/capacity').then((m) => m.default) },
  { kind: 'route', key: 'capex', label: 'Roaster Pricing & CapEx', icon: icons.factory, load: () => import('./features/economics/capex').then((m) => m.default) },
  { kind: 'route', key: 'economics', label: 'Unit Economics & Margins', icon: icons.dollar, load: () => import('./features/economics/unit-economics').then((m) => m.default) },
  { kind: 'route', key: 'roasts', label: 'Batch Roaster & Loss Log', icon: icons.flame, load: () => import('./features/roasts').then((m) => m.default) },
  { kind: 'route', key: 'coupons', label: 'Promo Coupons Engine', icon: icons.ticket, load: () => import('./features/coupons').then((m) => m.default) },
  { kind: 'route', key: 'plans', label: 'Subscription Plans', icon: icons.layers, load: () => import('./features/plans').then((m) => m.default) },
  { kind: 'route', key: 'subscriptions', label: 'Subscribe & Save', icon: icons.refresh, load: () => import('./features/subscriptions').then((m) => m.default) },
  { kind: 'route', key: 'reviews', label: 'Customer Reviews', icon: icons.star, load: () => import('./features/reviews').then((m) => m.default) },
  { kind: 'route', key: 'experiences', label: 'Roastery Experiences', icon: icons.calendar, load: () => import('./features/experiences').then((m) => m.default) },
  { kind: 'route', key: 'channels', label: 'Communication Channels', icon: icons.megaphone, load: () => import('./features/channels').then((m) => m.default) },
  { kind: 'route', key: 'campaigns', label: 'Social Media Campaigns', icon: icons.send, load: () => import('./features/campaigns').then((m) => m.default) },
  { kind: 'route', key: 'limited-editions', label: 'Limited Editions', icon: icons.sparkle, load: () => import('./features/limited-editions').then((m) => m.default) },
  { kind: 'route', key: 'promotions', label: 'Sales & Promotions', icon: icons.percent, load: () => import('./features/promotions').then((m) => m.default) },
  { kind: 'route', key: 'orders', label: 'Order Fulfillment', icon: icons.truck, load: () => import('./features/orders').then((m) => m.default) },
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
  document.title = `${route.label.replace(/ ↗$/, '')} · The Daily Roast Admin`;
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

function renderSidebarNav(): void {
  const list = document.getElementById('sidebar-nav');
  if (!list) return;

  list.innerHTML = NAV.map((entry) => {
    if (entry.kind === 'link') {
      return `<li><a href="${entry.href}" class="nav-item-btn nav-item-btn--external">${entry.icon}<span>${entry.label}</span></a></li>`;
    }
    return `<li><button class="nav-item-btn" data-tab="${entry.key}">${entry.icon}<span>${entry.label}</span></button></li>`;
  }).join('');

  list.querySelectorAll<HTMLButtonElement>('button.nav-item-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      triggerHaptic();
      closeMobileDrawer();
      navigate(`/${btn.getAttribute('data-tab')}`);
    });
  });
}

export function initRouter(): void {
  renderSidebarNav();

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
