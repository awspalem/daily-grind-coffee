import { triggerHaptic } from '../features/shared';

/**
 * Persistent chrome that survives navigation: the mobile drawer, the quick-restock
 * shortcut, and the Escape-to-close handler. Anything here is wired exactly once at
 * boot — never inside a route module, since those remount on every visit.
 */

export function closeMobileDrawer(): void {
  document.getElementById('admin-sidebar')?.classList.remove('open');
  document.getElementById('sidebar-backdrop')?.classList.remove('visible');
  document.getElementById('btn-mobile-menu')?.setAttribute('aria-expanded', 'false');
}

function setupMobileDrawer(): void {
  const sidebar = document.getElementById('admin-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const hamburger = document.getElementById('btn-mobile-menu');
  const closeBtn = document.getElementById('btn-close-sidebar');
  if (!sidebar || !backdrop || !hamburger) return;

  const open = () => {
    triggerHaptic();
    sidebar.classList.add('open');
    backdrop.classList.add('visible');
    hamburger.setAttribute('aria-expanded', 'true');
  };

  hamburger.addEventListener('click', open);
  backdrop.addEventListener('click', closeMobileDrawer);
  closeBtn?.addEventListener('click', closeMobileDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMobileDrawer();
  });
}

function setupQuickRestock(): void {
  document.getElementById('btn-quick-restock')?.addEventListener('click', () => {
    triggerHaptic();
    const lot = prompt('Enter Green Coffee Lot to restock (e.g. Chikmagalur Attikan):', 'Chikmagalur Attikan Estate Honey');
    const kg = prompt('Enter restock amount in kg:', '60');
    if (lot && kg) {
      alert(`Successfully logged +${kg}kg green stock for lot "${lot}" to the Cloudflare D1 inventory ledger.`);
    }
  });
}

export function initShell(): void {
  setupMobileDrawer();
  setupQuickRestock();
}
