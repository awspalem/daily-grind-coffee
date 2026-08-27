/**
 * Shared UI primitives used across 3+ admin features.
 *
 * Anything visual that's repeated verbatim (or near-verbatim) in three or
 * more features lives here. One-off renderings stay in their feature file.
 */
import { esc } from '../features/shared';

// ---------------------------------------------------------------------------
// Skeleton loaders
// Used in every feature's mount() while its initial fetch is in flight. The
// raw class name is `.skeleton`; these helpers just produce the right
// dimensions and label-cell widths so rows line up with their final table.
// ---------------------------------------------------------------------------

export function skeletonText(widthPx: number, heightPx = 14): string {
  return `<span class="skeleton" style="display:inline-block; width:${widthPx}px; height:${heightPx}px;">&nbsp;</span>`;
}

export function skeletonBadge(): string {
  return `<span class="skeleton" style="display:inline-block; width:80px; height:22px; border-radius:9999px;">&nbsp;</span>`;
}

export function skeletonButton(widthPx = 110): string {
  return `<span class="skeleton" style="display:inline-block; width:${widthPx}px; height:30px; border-radius:8px;">&nbsp;</span>`;
}

export function skeletonTableRow(columnWidths: number[], opts: { height?: number; badgeCols?: number[] } = {}): string {
  const { height = 14, badgeCols = [] } = opts;
  return `<tr>${columnWidths.map((w, i) => `<td>${badgeCols.includes(i) ? skeletonBadge() : skeletonText(w, height)}</td>`).join('')}</tr>`;
}

// ---------------------------------------------------------------------------
// Status badges
// Centralised so the case-class name (paid / shipped / etc.) and label stay
// in sync with the CSS in styles/admin.css. Ad-hoc badge HTML in feature
// files should reach for this helper instead of re-deriving the className.
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: 'Pending',
  PAID: 'Paid',
  ROASTING: 'Roasting',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
  ACTIVE: 'Active',
  PAST_DUE: 'Past Due',
  PAUSED: 'Paused',
  LOW_STOCK: 'Low Stock',
  IN_STOCK: 'In Stock',
  INACTIVE: 'Inactive',
};

const STATUS_CLASS: Record<string, string> = {
  PENDING_PAYMENT: 'pending',
  PAID: 'paid',
  ROASTING: 'roasting',
  PACKED: 'packed',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  REFUNDED: 'neutral',
  ACTIVE: 'paid',
  PAST_DUE: 'low-stock',
  PAUSED: 'neutral',
  LOW_STOCK: 'low-stock',
  IN_STOCK: 'paid',
  INACTIVE: 'low-stock',
};

export function statusBadge(status: string, fallbackLabel?: string): string {
  const cls = STATUS_CLASS[status] || 'neutral';
  const label = STATUS_LABELS[status] || fallbackLabel || status;
  return `<span class="status-badge ${cls}">${esc(label)}</span>`;
}

// ---------------------------------------------------------------------------
// Empty state
// The "this thing is empty" message is rendered in nearly every feature.
// Centralise so the visual treatment stays consistent.
// ---------------------------------------------------------------------------

export interface EmptyStateOptions {
  title: string;
  body?: string;
  icon?: string;
  action?: { label: string; id?: string; href?: string };
}

export function emptyStateHtml(opts: EmptyStateOptions): string {
  return `
    <div class="empty-state">
      ${opts.icon ? `<div class="empty-state-icon">${opts.icon}</div>` : ''}
      <div class="empty-state-title">${esc(opts.title)}</div>
      ${opts.body ? `<div class="empty-state-body">${esc(opts.body)}</div>` : ''}
      ${opts.action
        ? (opts.action.href
            ? `<a class="btn-secondary empty-state-action" href="${esc(opts.action.href)}">${esc(opts.action.label)}</a>`
            : `<button type="button" class="btn-secondary empty-state-action"${opts.action.id ? ` id="${esc(opts.action.id)}"` : ''}>${esc(opts.action.label)}</button>`)
        : ''}
    </div>`;
}

// ---------------------------------------------------------------------------
// Error state — used by data tables that fail to load. Carries a Retry hook.
// ---------------------------------------------------------------------------

export function tableErrorHtml(message: string, retryId: string): string {
  return `<tr><td colspan="100">
    ${emptyStateHtml({
      title: 'Could not load data',
      body: message,
      action: { label: 'Retry', id: retryId },
    })}
  </td></tr>`;
}
