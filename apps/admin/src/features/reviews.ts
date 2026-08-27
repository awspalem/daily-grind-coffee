import { adminFetch, esc, triggerHaptic } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-reviews">
    <div class="panel-header"><h2 class="panel-title">Customer Reviews</h2></div>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Product</th><th>Rating</th><th>Customer</th><th>Comment</th><th>Verified</th><th>Date</th><th>Action</th></tr></thead>
        <tbody id="reviews-table-body"></tbody>
      </table>
    </div>
  </section>
`;

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;
    const tbody = document.getElementById('reviews-table-body')!;

    const render = (reviews: any[]) => {
      if (reviews.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No reviews yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = reviews.map((r) => `
        <tr>
          <td data-label="Product">${esc(r.product_name)}</td>
          <td data-label="Rating">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</td>
          <td data-label="Customer">${esc(r.customer_name)}</td>
          <td data-label="Comment" style="max-width: 320px; white-space: normal;">${esc(r.comment)}</td>
          <td data-label="Verified">${r.is_verified_purchase ? '✓' : '—'}</td>
          <td data-label="Date">${new Date(r.created_at).toLocaleDateString()}</td>
          <td data-label="Action"><button class="btn-table-action" data-delete-review="${r.id}">Delete</button></td>
        </tr>
      `).join('');
    };

    const load = async () => {
      const data = await adminFetch<{ reviews: any[] }>('/api/admin/reviews');
      render(data.reviews || []);
    };
    load();

    tbody.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-delete-review]') as HTMLElement | null;
      if (!btn) return;
      const reviewId = btn.getAttribute('data-delete-review')!;
      if (!confirm('Delete this review? This cannot be undone.')) return;

      triggerHaptic();
      const result = await adminFetch<{ error?: string }>(`/api/admin/reviews/${reviewId}`, { method: 'DELETE' });
      if (result.success) {
        await load();
      } else {
        alert(`Could not delete review: ${result.error || 'Unknown error'}`);
      }
    });
  },
};

export default route;
