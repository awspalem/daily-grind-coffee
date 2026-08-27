import { triggerHaptic, adminFetch, toast, openInlineModal, esc } from '../features/shared';

/**
 * Persistent chrome that survives navigation: the mobile drawer and the
 * quick-restock shortcut. Anything here is wired exactly once at boot — never
 * inside a route module, since those remount on every visit.
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

interface InventoryRow {
  variant_id: string;
  sku: string;
  available_stock: number;
  product_name: string;
  weight_grams: number;
}

function setupQuickRestock(): void {
  const btn = document.getElementById('btn-quick-restock');
  if (!btn) return;
  btn.addEventListener('click', () => {
    triggerHaptic();
    void openRestockModal();
  });
}

async function openRestockModal(): Promise<void> {
  // Load the inventory list so the operator can pick which variant they're
  // restocking. We fall back to a free-text lot name if the inventory API
  // hasn't loaded or returns nothing (so the modal still works on a fresh
  // deploy with no stock yet).
  const inv = await adminFetch<{ inventory?: InventoryRow[]; error?: string }>('/api/admin/inventory');
  const rows = inv.inventory || [];

  const variantOptions = rows.length
    ? rows.map((r) => `
        <option value="${esc(r.variant_id)}" data-sku="${esc(r.sku)}">
          ${esc(r.product_name)} · ${r.weight_grams}g · ${esc(r.sku)} (${r.available_stock} in stock)
        </option>`).join('')
    : '';

  const bodyHtml = `
    <form class="inline-modal-form" id="restock-form" novalidate>
      <div class="inline-form-field">
        <label for="restock-variant">Variant (green-coffee lot)</label>
        ${rows.length
          ? `<select id="restock-variant" name="variant_id" required>
               <option value="" disabled selected>Choose a variant…</option>
               ${variantOptions}
             </select>`
          : `<input type="text" id="restock-variant" name="lot_name" placeholder="e.g. Chikmagalur Attikan Estate Honey" required />`}
      </div>
      <div class="inline-form-row">
        <div class="inline-form-field">
          <label for="restock-kg">Restock amount (kg)</label>
          <input type="number" id="restock-kg" name="kg" min="0.1" step="0.1" value="60" required />
        </div>
        <div class="inline-form-field">
          <label for="restock-reason">Reason (optional)</label>
          <input type="text" id="restock-reason" name="reason" placeholder="e.g. New harvest arrival" value="Quick restock from top bar" />
        </div>
      </div>
      <div class="inline-form-error" id="restock-error" hidden></div>
    </form>
  `;

  openInlineModal({
    title: 'Restock Green Silos',
    bodyHtml,
    primaryLabel: 'Log Restock',
    secondaryLabel: 'Cancel',
    onPrimary: async (close) => {
      const form = document.getElementById('restock-form') as HTMLFormElement | null;
      const errEl = document.getElementById('restock-error');
      if (!form) { close(); return; }
      const fd = new FormData(form);
      const variantId = String(fd.get('variant_id') || '').trim();
      const lotName   = String(fd.get('lot_name') || '').trim();
      const kg        = Number(fd.get('kg'));
      const reason    = String(fd.get('reason') || '').trim() || 'Quick restock from top bar';
      if ((!variantId && !lotName) || !kg || kg <= 0) {
        if (errEl) { errEl.textContent = 'Please pick a variant and enter a positive kg amount.'; errEl.hidden = false; }
        return;
      }
      if (errEl) errEl.hidden = true;
      const payload: Record<string, unknown> = { movement_type: 'RESTOCK', quantity_delta: kg, reason };
      if (variantId) payload.variant_id = variantId;
      else payload.lot_name = lotName;
      const result = await adminFetch<{ new_available_stock?: number; error?: string }>('/api/admin/inventory/adjust', { method: 'POST', json: payload });
      if (result.success) {
        const stock = result.new_available_stock;
        toast(`Logged +${kg}kg restock${typeof stock === 'number' ? ` · stock now ${stock}` : ''}`, 'success');
        close();
      } else {
        if (errEl) { errEl.textContent = result.error || 'Could not log restock.'; errEl.hidden = false; }
      }
    },
  });
}

export function initShell(): void {
  setupMobileDrawer();
  setupQuickRestock();
}
