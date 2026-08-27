import { adminFetch, esc, triggerHaptic } from './shared';
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
  PENDING_PAYMENT: { label: 'Pending Payment', cls: 'neutral' },
  PAID: { label: 'Paid', cls: 'paid' },
  ROASTING: { label: 'Roasting', cls: 'roasting' },
  PACKED: { label: 'Packed', cls: 'packed' },
  SHIPPED: { label: 'Shipped', cls: 'shipped' },
  DELIVERED: { label: 'Delivered', cls: 'delivered' },
  CANCELLED: { label: 'Cancelled', cls: 'cancelled' },
  REFUNDED: { label: 'Refunded', cls: 'neutral' },
};

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

const PANEL_HTML = `
  <section class="section-panel" id="panel-orders">
    <div class="panel-header">
      <div>
        <h2 class="panel-title">Bangalore Dispatch &amp; Orders</h2>
        <span style="font-size: 0.85rem; color: var(--text-muted);">Real-time dispatch status, GST Tax Invoices (HSN 0901), &amp; bag labels</span>
      </div>
      <span style="background: var(--accent-bg); color: var(--accent); padding: 0.3rem 0.8rem; border-radius: var(--radius-pill); font-size: 0.8rem; font-weight:700;">
        Karnataka GSTIN: 29AABCT0123M1Z5
      </span>
    </div>

    <div class="table-responsive">
      <table class="data-table">
        <thead>
          <tr><th>Order</th><th>Customer</th><th>Coffee &amp; Grind</th><th>Total</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody id="orders-table-body">
          <tr><td colspan="6" style="text-align:center; color:var(--text-muted);">Loading orders…</td></tr>
        </tbody>
      </table>
    </div>
  </section>
`;

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('orders-table-body')!;

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
        <tr data-order-id="${esc(order.id)}">
          <td data-label="Order"><strong>${esc(order.order_number)}</strong><br><span style="color:var(--text-muted); font-size:0.78rem;">${new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span></td>
          <td data-label="Customer">${esc(order.shipping_address?.name || order.customer_email)}${order.shipping_address?.city ? `<br><span style="color:var(--text-muted); font-size:0.78rem;">${esc(order.shipping_address.city)}${order.shipping_address.state ? ', ' + esc(order.shipping_address.state) : ''}</span>` : ''}</td>
          <td data-label="Coffee & Grind">${itemsSummary(order.items)}</td>
          <td data-label="Total"><strong style="color: var(--emerald);">₹${displayTotal.toLocaleString('en-IN')}</strong></td>
          <td data-label="Status"><span class="status-badge ${meta.cls}">${meta.label}</span>${trackingLine}</td>
          <td data-label="Actions">
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; width: 100%;">
              <button class="btn-table-action btn-order-invoice" style="flex:1; min-height:42px;">GST Invoice</button>
              ${presetId ? `<button class="btn-table-action btn-order-label" data-preset="${esc(presetId)}" style="flex:1; min-height:42px;">Label</button>` : ''}
              ${nextStatus ? `<button class="btn-table-action btn-order-advance" data-next="${esc(nextStatus)}" style="width:100%; min-height:42px;">Advance to ${esc(STATUS_META[nextStatus]?.label || nextStatus)} ➔</button>` : ''}
            </div>
          </td>
        </tr>
      `;
    };

    const load = async () => {
      const data = await adminFetch<{ orders: Order[]; error?: string }>('/api/admin/orders');
      if (!data.success) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--rose);">Could not load orders: ${esc(data.error || 'Unknown error')}</td></tr>`;
        return;
      }

      const orders = data.orders || [];
      if (orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No orders yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = orders.map(renderRow).join('');

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
          const confirmMsg = isPacking
            ? `Advance ${order.order_number} to Packed? If it ships to an Indian address, this pushes the order to Shiprocket for pickup.`
            : `Advance ${order.order_number} to ${STATUS_META[nextStatus]?.label || nextStatus}?`;
          if (!confirm(confirmMsg)) return;

          triggerHaptic();
          target.setAttribute('disabled', 'true');
          target.textContent = 'Updating…';

          const result = await adminFetch<{ message?: string; error?: string; shiprocket_error?: string; shiprocket_skipped_reason?: string }>(
            `/api/admin/orders/${encodeURIComponent(orderId)}/status`,
            { method: 'POST', json: { status: nextStatus } }
          );

          if (result.success) {
            await load();
            if (result.shiprocket_error) {
              alert(`Order advanced, but the Shiprocket push failed: ${result.shiprocket_error}. Enter tracking manually once resolved.`);
            } else if (result.shiprocket_skipped_reason) {
              alert(`Order advanced. Shiprocket was skipped: ${result.shiprocket_skipped_reason}`);
            }
          } else {
            alert(`Could not advance order: ${result.error || 'Unknown error'}`);
            target.removeAttribute('disabled');
            target.textContent = `Advance to ${STATUS_META[nextStatus]?.label || nextStatus} ➔`;
          }
        });
      });
    };

    load();
  },
};

export default route;
