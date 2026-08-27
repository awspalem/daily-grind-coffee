/**
 * Command palette — the global Cmd+K / Ctrl+K launcher.
 * Reads NAV from router.ts; renders a fuzzy-filtered list of routes and a
 * small set of quick actions (open label modal, open restock modal).
 * Keyboard: ↑/↓ navigate, Enter selects, Esc closes, ⌘K toggles.
 */
import { triggerHaptic, esc } from '../features/shared';
import { NAV, type NavEntry, type NavRoute, navigate } from '../router';

interface PaletteItem {
  id: string;
  label: string;
  sub?: string;
  iconHtml: string;
  section: string;
  action: () => void;
  isExternal?: boolean;
}

let open = false;
let activeIndex = 0;
let items: PaletteItem[] = [];
let inputEl: HTMLInputElement | null = null;
let resultsEl: HTMLElement | null = null;
let backdropEl: HTMLElement | null = null;
let countEl: HTMLElement | null = null;

function buildItems(): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const entry of NAV) {
    if (entry.kind === 'link') {
      out.push({
        id: `link:${entry.key}`,
        label: entry.label,
        sub: 'Opens in this app · external page',
        iconHtml: entry.icon,
        section: 'External',
        action: () => { window.location.href = entry.href; },
        isExternal: true,
      });
    } else {
      out.push({
        id: `route:${entry.key}`,
        label: entry.label,
        sub: entry.subtitle,
        iconHtml: entry.icon,
        section: entry.section,
        action: () => navigate(`/${entry.key}`),
      });
    }
  }
  // Quick actions
  out.push({
    id: 'action:open-label',
    label: 'Open Bag Label Studio',
    sub: 'Open the thermal label & QR generator',
    iconHtml: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2h6a2 2 0 0 1 2 2v6a2 2 0 0 1-.59 1.41l-8 8a2 2 0 0 1-2.82 0l-6-6a2 2 0 0 1 0-2.82l8-8A2 2 0 0 1 12 2Z"></path><circle cx="15.5" cy="8.5" r="1.25"></circle></svg>',
    section: 'Quick Actions',
    action: () => { document.getElementById('btn-open-label-modal')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); },
  });
  out.push({
    id: 'action:restock',
    label: 'Restock Green Silos',
    sub: 'Log a green-bean restock to the inventory ledger',
    iconHtml: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
    section: 'Quick Actions',
    action: () => { document.getElementById('btn-quick-restock')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); },
  });
  return out;
}

function score(query: string, item: PaletteItem): number {
  if (!query) return 1; // show everything when no query
  const q = query.toLowerCase();
  const lbl = item.label.toLowerCase();
  const sub = (item.sub ?? '').toLowerCase();
  const sec = item.section.toLowerCase();
  if (lbl === q) return 100;
  if (lbl.startsWith(q)) return 80;
  if (lbl.includes(q)) return 60;
  if (sec.includes(q)) return 30;
  if (sub.includes(q)) return 20;
  // Word-boundary fuzzy match
  let qi = 0;
  for (let i = 0; i < lbl.length && qi < q.length; i++) {
    if (lbl[i] === q[qi]) qi++;
  }
  return qi === q.length ? 10 : 0;
}

function render(query: string): void {
  if (!resultsEl) return;
  const scored = items
    .map((it) => ({ it, s: score(query, it) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s);

  if (scored.length === 0) {
    resultsEl.innerHTML = `
      <div class="cmd-k-empty">
        No matches for <strong>${esc(query)}</strong>.<br>
        Try a page name like "orders" or "inventory".
      </div>`;
    if (countEl) countEl.textContent = '0 results';
    activeIndex = 0;
    return;
  }

  // Group by section
  const bySection = new Map<string, typeof scored>();
  for (const r of scored) {
    const arr = bySection.get(r.it.section) ?? [];
    arr.push(r);
    bySection.set(r.it.section, arr);
  }
  const flat: PaletteItem[] = [];
  let html = '';
  for (const [section, arr] of bySection) {
    html += `<div class="cmd-k-section-label">${esc(section)}</div>`;
    for (const r of arr) {
      const idx = flat.length;
      flat.push(r.it);
      html += `
        <button type="button" class="cmd-k-item" data-idx="${idx}" role="option">
          <span class="cmd-k-icon">${r.it.iconHtml}</span>
          <span class="cmd-k-item-main">
            <span class="cmd-k-item-label">${esc(r.it.label)}</span>
            ${r.it.sub ? `<span class="cmd-k-item-sub">${esc(r.it.sub)}</span>` : ''}
          </span>
        </button>`;
    }
  }
  resultsEl.innerHTML = html;
  activeIndex = Math.min(activeIndex, flat.length - 1);
  highlightActive();
  if (countEl) countEl.textContent = `${scored.length} result${scored.length === 1 ? '' : 's'}`;
  // Wire up clicks
  resultsEl.querySelectorAll<HTMLButtonElement>('.cmd-k-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      const item = flat[idx];
      if (item) selectItem(item);
    });
  });
}

function highlightActive(): void {
  if (!resultsEl) return;
  resultsEl.querySelectorAll<HTMLButtonElement>('.cmd-k-item').forEach((btn, i) => {
    btn.classList.toggle('active', i === activeIndex);
    if (i === activeIndex) btn.scrollIntoView({ block: 'nearest' });
  });
}

function selectItem(item: PaletteItem): void {
  triggerHaptic();
  closePalette();
  // Run the action on the next tick so the palette can close first (some actions
  // open modals and we want the backdrop click event to fully resolve first)
  setTimeout(() => item.action(), 0);
}

function openPalette(): void {
  if (open) return;
  backdropEl = document.getElementById('cmd-k-backdrop');
  inputEl = document.getElementById('cmd-k-input') as HTMLInputElement | null;
  resultsEl = document.getElementById('cmd-k-results');
  countEl = document.getElementById('cmd-k-count');
  if (!backdropEl || !inputEl || !resultsEl) return;
  backdropEl.style.display = 'flex';
  backdropEl.setAttribute('aria-hidden', 'false');
  backdropEl.classList.add('visible');
  inputEl.value = '';
  activeIndex = 0;
  items = buildItems();
  render('');
  open = true;
  setTimeout(() => inputEl?.focus(), 0);
}

function closePalette(): void {
  if (!open) return;
  open = false;
  backdropEl = document.getElementById('cmd-k-backdrop');
  if (backdropEl) {
    backdropEl.classList.remove('visible');
    backdropEl.setAttribute('aria-hidden', 'true');
    backdropEl.style.display = 'none';
  }
}

function onKey(e: KeyboardEvent): void {
  // Toggle with ⌘K / Ctrl+K regardless of focus state
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    open ? closePalette() : openPalette();
    return;
  }
  if (!open) return;
  if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
  if (!resultsEl) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, resultsEl.querySelectorAll('.cmd-k-item').length - 1);
    highlightActive();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    highlightActive();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const btn = resultsEl.querySelectorAll<HTMLButtonElement>('.cmd-k-item')[activeIndex];
    btn?.click();
  }
}

function wireTrigger(): void {
  const trigger = document.getElementById('btn-open-palette');
  trigger?.addEventListener('click', openPalette);
  const closeBtn = document.getElementById('cmd-k-close');
  closeBtn?.addEventListener('click', closePalette);
  const backdrop = document.getElementById('cmd-k-backdrop');
  backdrop?.addEventListener('click', (e) => { if (e.target === backdrop) closePalette(); });
  const input = document.getElementById('cmd-k-input');
  input?.addEventListener('input', () => {
    activeIndex = 0;
    render((input as HTMLInputElement).value);
  });
}

export function initCommandPalette(): void {
  wireTrigger();
  document.addEventListener('keydown', onKey);
}
