import { adminFetch, esc, triggerHaptic, toast, confirmModal } from './shared';
import { icons } from '../icons';
import { ROASTERY_LOT_PRESETS } from '../utils/thermalLabel';
import { openLabelModalForOrder, openInvoiceModalForOrder } from './orders-core';
import type { RouteModule } from '../router';

interface OrderItem {
  id: string;
  product_name: string;
  weight_grams: number;
  grind_type: string;
  quantity: number;
  total_price_cents: number;
}

interface ShippingAddress {
  name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

interface Order {
  id: string;
  order_number: string;
  customer_email: string;
  status: string;
  total_cents: number;
  currency: string;
  tracking_number?: string | null;
  carrier?: string | null;
  created_at: string;
  items: OrderItem[];
  shipping_address: ShippingAddress | null;
}

// order.total_cents is USD; GST invoices are inherently INR-denominated and there's no live
// FX feed, so this reuses the same fixed display factor the rest of the admin app already
// uses for the same USD-cents-to-INR conversion (see overview.ts, pricing.ts).
const CENTS_TO_INR = 0.23;

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDING_PAYMENT: { label: 'Pending', cls: 'pending' },
  PAID: { label: 'Paid', cls: 'paid' },
  ROASTING: { label: 'Roasting', cls: 'roasting' },
  PACKED: { label: 'Packed', cls: 'packed' },
  SHIPPED: { label: 'Shipped', cls: 'shipped' },
  DELIVERED: { label: 'Delivered', cls: 'delivered' },
  CANCELLED: { label: 'Cancelled', cls: 'cancelled' },
  REFUNDED: { label: 'Refunded', cls: 'neutral' },
};

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'ALL',             label: 'All' },
  { key: 'PENDING_PAYMENT', label: 'Pending' },
  { key: 'PAID',            label: 'Paid' },
  { key: 'ROASTING',        label: 'Roasting' },
  { key: 'PACKED',          label: 'Packed' },
  { key: 'SHIPPED',         label: 'Shipped' },
  { key: 'DELIVERED',       label: 'Delivered' },
  { key: 'CANCELLED',       label: 'Cancelled' },
];

// Forward-only fulfillment path. CANCELLED/REFUNDED are exceptional, out-of-band states this
// screen doesn't drive into — not offered by the Advance button.
const FORWARD_CYCLE: Record<string, string> = {
  PENDING_PAYMENT: 'PAID',
  PAID: 'ROASTING',
  ROASTING: 'PACKED',
  PACKED: 'SHIPPED',
  SHIPPED: 'DELIVERED',
};

const GRIND_KEYWORDS: Array<[string, string]> = [
  ['attikan', 'chikmagalur_attikan'],
  ['araku', 'araku_red_honey'],
  ['yirgacheffe', 'ethiopia_yirgacheffe'],
  ['dawn patrol', 'dawn_patrol'],
  ['midnight runner', 'midnight_runner'],
];

/**
 * The thermal-label studio only knows 5 hardcoded lots (src/utils/thermalLabel.ts) — a much
 * smaller set than the real product catalog can hold. Matching by keyword instead of assuming
 * every order item has a label preset means an unmatched product simply doesn't get a Label
 * button, rather than silently printing a label for the wrong coffee.
 */
function matchLotPresetId(productName: string): string | null {
  const lower = productName.toLowerCase();
  for (const [keyword, presetId] of GRIND_KEYWORDS) {
    if (lower.includes(keyword)) return presetId;
  }
  return null;
}

function formatGrind(grind: string): string {
  return grind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function itemsSummary(items: OrderItem[]): string {
  if (items.length === 0) return '—';
  return items
    .map((it) => `${esc(it.product_name)} (${it.weight_grams}g · ${esc(formatGrind(it.grind_type))}) ×${it.quantity}`)
    .join('<br>');
}

function skeletonRow(): string {
  return `
    <tr>
      <td><span class="skeleton" style="display:inline-block; width: 90px; height: 14px;">&nbsp;</span></td>
      <td><span class="skeleton" style="display:inline-block; width: 140px; height: 14px;">&nbsp;</span></td>
      <td><span class="skeleton" style="display:inline-block; width: 180px; height: 14px;">&nbsp;</span></td>
      <td><span class="skeleton" style="display:inline-block; width: 70px; height: 14px;">&nbsp;</span></td>
      <td><span class="skeleton" style="display:inline-block; width: 80px; height: 22px; border-radius: 9999px;">&nbsp;</span></td>
      <td><span class="skeleton" style="display:inline-block; width: 120px; height: 30px; border-radius: 8px;">&nbsp;</span></td>
    </tr>`;
}

function panelHtml(): string {
  return `
    <section class="section-panel" id="panel-orders">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Bangalore Dispatch &amp; Orders</h2>
          <p class="panel-subtitle">Real-time dispatch status, GST Tax Invoices (HSN 0901) &amp; bag labels</p>
        </div>
        <span style="background: var(--accent-soft); color: var(--accent-deep); padding: 0.35rem 0.85rem; border-radius: var(--radius-pill); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap;">
          Karnataka GSTIN: 29AABCT0123M1Z5
        </span>
      </div>

      <div class="orders-toolbar">
        <input type="search" class="orders-search" id="orders-search" placeholder="Search order #, customer, or city…" aria-label="Search orders" />
        <div class="orders-pills" id="orders-pills" role="tablist" aria-label="Filter by status">
          ${STATUS_FILTERS.map((f, i) => `
            <button type="button" class="status-pill ${i === 0 ? 'active' : ''}" data-filter="${esc(f.key)}" role="tab" aria-selected="${i === 0 ? 'true' : 'false'}">
              <span>${esc(f.label)}</span>
              <span class="pill-count" data-count="${esc(f.key)}">0</span>
            </button>`).join('')}
        </div>
      </div>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr><th>Order</th><th>Customer</th><th>Coffee &amp; Grind</th><th>Total</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody id="orders-table-body">
            ${skeletonRow()}${skeletonRow()}${skeletonRow()}${skeletonRow()}${skeletonRow()}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

const route: RouteModule = {
  mount(container) {
    container.innerHTML = panelHtml();
    const tbody = document.getElementById('orders-table-body')!;
    const search = document.getElementById('orders-search') as HTMLInputElement | null;
    const pillsEl = document.getElementById('orders-pills')!;
    let activeFilter = 'ALL';
    let orders: Order[] = [];

    const renderRow = (order: Order): string => {
      const meta = STATUS_META[order.status] || { label: order.status, cls: 'neutral' };
      const displayTotal = order.currency?.toLowerCase() === 'inr'
        ? order.total_cents / 100
        : Math.round((order.total_cents / 100) * CENTS_TO_INR);

      const firstItem = order.items[0];
      const presetId = firstItem ? matchLotPresetId(firstItem.product_name) : null;
      const nextStatus = FORWARD_CYCLE[order.status];
      const trackingLine = order.tracking_number
        ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.3rem;">${esc(order.carrier || 'Courier')}: ${esc(order.tracking_number)}</div>`
        : '';

      return `
        <tr data-order-id="${esc(order.id)}" data-status="${esc(order.status)}">
          <td data-label="Order"><strong>${esc(order.order_number)}</strong><br><span style="color:var(--text-muted); font-size:0.78rem;">${new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span></td>
          <td data-label="Customer">${esc(order.shipping_address?.name || order.customer_email)}${order.shipping_address?.city ? `<br><span style="color:var(--text-muted); font-size:0.78rem;">${esc(order.shipping_address.city)}${order.shipping_address.state ? ', ' + esc(order.shipping_address.state) : ''}</span>` : ''}</td>
          <td data-label="Coffee & Grind">${itemsSummary(order.items)}</td>
          <td data-label="Total"><strong style="color: var(--emerald);">₹${displayTotal.toLocaleString('en-IN')}</strong></td>
          <td data-label="Status"><span class="status-badge ${meta.cls}">${meta.label}</span>${trackingLine}</td>
          <td data-label="Actions">
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; width: 100%;">
              <button class="btn-secondary btn-order-invoice" style="flex:1; min-height:38px;">GST Invoice</button>
              ${presetId ? `<button class="btn-secondary btn-order-label" data-preset="${esc(presetId)}" style="flex:1; min-height:38px;">Label</button>` : ''}
              ${nextStatus ? `<button class="btn-secondary btn-order-advance" data-next="${esc(nextStatus)}" style="width:100%; min-height:38px;">Advance to ${esc(STATUS_META[nextStatus]?.label || nextStatus)} →</button>` : ''}
            </div>
          </td>
        </tr>
      `;
    };

    const applyClientFilter = (): void => {
      const q = (search?.value || '').trim().toLowerCase();
      let visibleCount = 0;
      tbody.querySelectorAll<HTMLTableRowElement>('tr[data-order-id]').forEach((row) => {
        const status = row.getAttribute('data-status') || '';
        const matchesStatus = activeFilter === 'ALL' || status === activeFilter;
        const haystack = row.textContent?.toLowerCase() || '';
        const matchesQuery = !q || haystack.includes(q);
        const show = matchesStatus && matchesQuery;
        row.style.display = show ? '' : 'none';
        if (show) visibleCount++;
      });
      // If the table body is now empty after filtering, show a filter-specific empty state
      const existingEmpty = document.getElementById('orders-filter-empty');
      if (visibleCount === 0 && orders.length > 0) {
        if (!existingEmpty) {
          const tr = document.createElement('tr');
          tr.id = 'orders-filter-empty';
          tr.innerHTML = `
            <td colspan="6">
              <div class="empty-state">
                <div class="empty-state-icon">${icons.search}</div>
                <div class="empty-state-title">No matches</div>
                <div class="empty-state-body">No orders match this filter. Try a different status or clear the search.</div>
                <button type="button" class="btn-secondary empty-state-action" id="orders-clear-filter">Clear filters</button>
              </div>
            </td>`;
          tbody.appendChild(tr);
          document.getElementById('orders-clear-filter')?.addEventListener('click', () => {
            if (search) search.value = '';
            activeFilter = 'ALL';
            pillsEl.querySelectorAll<HTMLButtonElement>('.status-pill').forEach((b) => {
              const isActive = b.dataset.filter === 'ALL';
              b.classList.toggle('active', isActive);
              b.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });
            applyClientFilter();
          });
        }
      } else if (existingEmpty) {
        existingEmpty.remove();
      }
    };

    const renderAll = (): void => {
      if (orders.length === 0) {
        tbody.innerHTML = `
          <tr><td colspan="6">
            <div class="empty-state">
              <div class="empty-state-icon">${icons.inbox}</div>
              <div class="empty-state-title">No orders in dispatch queue</div>
              <div class="empty-state-body">As soon as customers check out, their orders will land here ready for roasting, packing, and shipping.</div>
            </div>
          </td></tr>`;
        // Reset pill counts
        pillsEl.querySelectorAll<HTMLElement>('.pill-count').forEach((c) => (c.textContent = '0'));
        return;
      }
      tbody.innerHTML = orders.map(renderRow).join('');

      // Update pill counts
      const counts: Record<string, number> = { ALL: orders.length };
      for (const o of orders) counts[o.status] = (counts[o.status] || 0) + 1;
      pillsEl.querySelectorAll<HTMLElement>('.pill-count').forEach((c) => {
        const k = c.getAttribute('data-count') || '';
        c.textContent = String(counts[k] || 0);
      });

      wireRowHandlers();
      applyClientFilter();
    };

    const wireRowHandlers = (): void => {
      tbody.querySelectorAll('.btn-order-invoice').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const row = (e.currentTarget as HTMLElement).closest('tr')!;
          const order = orders.find((o) => o.id === row.getAttribute('data-order-id'));
          if (!order) return;
          const addr = order.shipping_address;
          openInvoiceModalForOrder({
            orderId: order.order_number,
            customerName: addr?.name || order.customer_email,
            customerEmail: order.customer_email,
            customerLocation: addr ? [addr.line1, addr.line2].filter(Boolean).join(', ') : undefined,
            customerCity: addr?.city,
            customerState: addr?.state,
            customerPostalCode: addr?.postal_code,
            productDescription: order.items.map((it) => `${it.product_name} (${it.weight_grams}g · ${formatGrind(it.grind_type)})`).join(', ') || 'Specialty Coffee',
            totalAmountInr: order.currency?.toLowerCase() === 'inr' ? order.total_cents / 100 : Math.round((order.total_cents / 100) * CENTS_TO_INR),
          });
        });
      });

      tbody.querySelectorAll('.btn-order-label').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const target = e.currentTarget as HTMLElement;
          const row = target.closest('tr')!;
          const order = orders.find((o) => o.id === row.getAttribute('data-order-id'));
          const firstItem = order?.items[0];
          const presetId = target.getAttribute('data-preset');
          const preset = ROASTERY_LOT_PRESETS.find((p) => p.id === presetId);
          if (!order || !preset) return;
          openLabelModalForOrder({
            lot: preset.id,
            grind: firstItem ? formatGrind(firstItem.grind_type) : preset.recommendedGrind,
            size: firstItem ? `${firstItem.weight_grams >= 1000 ? firstItem.weight_grams / 1000 + 'kg' : firstItem.weight_grams + 'g'}` : '250g',
            batch: `ORD-${order.order_number}`,
          });
        });
      });

      tbody.querySelectorAll('.btn-order-advance').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const target = e.currentTarget as HTMLElement;
          const row = target.closest('tr')!;
          const orderId = row.getAttribute('data-order-id')!;
          const order = orders.find((o) => o.id === orderId);
          const nextStatus = target.getAttribute('data-next')!;
          if (!order) return;

          const isPacking = nextStatus === 'PACKED';
          const body = isPacking
            ? `This will move ${order.order_number} to Packed. If it ships to an Indian address, the order will be pushed to Shiprocket for pickup.`
            : `Move ${order.order_number} to ${STATUS_META[nextStatus]?.label || nextStatus}?`;
          const ok = await confirmModal({
            title: `Advance to ${STATUS_META[nextStatus]?.label || nextStatus}?`,
            body,
            confirmLabel: 'Advance',
          });
          if (!ok) return;

          triggerHaptic();
          target.setAttribute('disabled', 'true');
          const originalText = target.textContent;
          target.textContent = 'Updating…';

          const result = await adminFetch<{ message?: string; error?: string; shiprocket_error?: string; shiprocket_skipped_reason?: string }>(
            `/api/admin/orders/${encodeURIComponent(orderId)}/status`,
            { method: 'POST', json: { status: nextStatus } }
          );

          if (result.success) {
            toast(`Order ${order.order_number} advanced to ${STATUS_META[nextStatus]?.label || nextStatus}`, 'success');
            await load();
            if (result.shiprocket_error) {
              toast(`Shiprocket push failed: ${result.shiprocket_error}. Enter tracking manually once resolved.`, 'error', 6000);
            } else if (result.shiprocket_skipped_reason) {
              toast(`Shiprocket skipped: ${result.shiprocket_skipped_reason}`, 'info', 5000);
            }
          } else {
            toast(`Could not advance order: ${result.error || 'Unknown error'}`, 'error');
            target.removeAttribute('disabled');
            target.textContent = originalText;
          }
        });
      });
    };

    // Wire toolbar once
    search?.addEventListener('input', applyClientFilter);
    pillsEl.querySelectorAll<HTMLButtonElement>('.status-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter || 'ALL';
        pillsEl.querySelectorAll<HTMLButtonElement>('.status-pill').forEach((b) => {
          const isActive = b === btn;
          b.classList.toggle('active', isActive);
          b.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        applyClientFilter();
      });
    });

    const load = async () => {
      const data = await adminFetch<{ orders: Order[]; error?: string }>('/api/admin/orders');
      if (!data.success) {
        tbody.innerHTML = `
          <tr><td colspan="6">
            <div class="empty-state">
              <div class="empty-state-icon">${icons.errorIcon}</div>
              <div class="empty-state-title">Could not load orders</div>
              <div class="empty-state-body">${esc(data.error || 'Unknown error')}</div>
              <button type="button" class="btn-secondary empty-state-action" id="orders-retry">Retry</button>
            </div>
          </td></tr>`;
        document.getElementById('orders-retry')?.addEventListener('click', () => { void load(); });
        return;
      }
      orders = data.orders || [];
      renderAll();
    };

    load();
  },
};

export default route;
