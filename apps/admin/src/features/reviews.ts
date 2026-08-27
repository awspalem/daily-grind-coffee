import { adminFetch, esc, triggerHaptic, toast, confirmModal } from './shared';
import { skeletonTableRow, emptyStateHtml } from '../components/ui';
import { requireRole } from '../components/actor';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-reviews">
    <div class="panel-header">
      <h2 class="panel-title">Customer Reviews</h2>
      <p class="panel-subtitle">Moderation queue — reviews from verified purchases show the green check.</p>
    </div>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Product</th><th>Rating</th><th>Customer</th><th>Comment</th><th>Verified</th><th>Date</th><th>Action</th></tr></thead>
        <tbody id="reviews-table-body"></tbody>
      </table>
    </div>
  </section>
`;

const REVIEW_COL_WIDTHS = [140, 90, 140, 280, 70, 80, 100];

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('reviews-table-body')!;
    tbody.innerHTML = Array.from({ length: 4 }, () => skeletonTableRow(REVIEW_COL_WIDTHS)).join('');

    const render = (reviews: any[]) => {
      if (reviews.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7">${emptyStateHtml({ title: 'No reviews in the queue', body: 'Reviews from customers appear here. Verified-purchase reviews show a green check.' })}</td></tr>`;
        return;
      }
      tbody.innerHTML = reviews.map((r) => {
        const stars = `${'★'.repeat(Math.max(0, Math.min(5, r.rating || 0)))}${'☆'.repeat(5 - Math.max(0, Math.min(5, r.rating || 0)))}`;
        return `
          <tr>
            <td data-label="Product">${esc(r.product_name)}</td>
            <td data-label="Rating" aria-label="${r.rating} out of 5 stars">${stars}</td>
            <td data-label="Customer">${esc(r.customer_name)}</td>
            <td data-label="Comment" style="max-width: 320px; white-space: normal;">${esc(r.comment)}</td>
            <td data-label="Verified">${r.is_verified_purchase ? '<span style="color: var(--emerald); font-weight:700;" aria-label="Verified purchase">✓</span>' : '<span style="color: var(--text-muted);" aria-label="Not verified">—</span>'}</td>
            <td data-label="Date">${new Date(r.created_at).toLocaleDateString()}</td>
            <td data-label="Action">
              <button class="btn-table-action danger" data-delete-review="${esc(r.id)}" aria-label="Delete review by ${esc(r.customer_name)}">Delete</button>
            </td>
          </tr>
        `;
      }).join('');
    };

    const load = async () => {
      const data = await adminFetch<{ reviews: any[] }>('/api/admin/reviews');
      if (!data.success) {
        tbody.innerHTML = `<tr><td colspan="7">${emptyStateHtml({ title: 'Could not load reviews', body: data.error || 'Unknown error', action: { label: 'Retry', id: 'reviews-retry' } })}</td></tr>`;
        document.getElementById('reviews-retry')?.addEventListener('click', () => { void load(); });
        return;
      }
      render(data.reviews || []);
    };
    void load();

    tbody.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-delete-review]') as HTMLElement | null;
      if (!btn) return;
      const reviewId = btn.getAttribute('data-delete-review')!;
      if (!requireRole(['ADMIN', 'SUPPORT'], 'Deleting reviews')) return;

      const ok = await confirmModal({
        title: 'Delete review?',
        body: 'This permanently removes the review from the queue and the storefront. The customer will not be notified. The deletion is recorded in the audit log.',
        confirmLabel: 'Delete review',
        danger: true,
      });
      if (!ok) return;

      triggerHaptic();
      const originalText = btn.textContent;
      btn.setAttribute('disabled', 'true');
      btn.textContent = 'Deleting…';
      const result = await adminFetch<{ error?: string }>(`/api/admin/reviews/${reviewId}`, { method: 'DELETE' });
      btn.removeAttribute('disabled');
      btn.textContent = originalText;

      if (result.success) {
        toast('Review deleted — audit log updated', 'success');
        await load();
      }
    });
  },
};

export default route;
