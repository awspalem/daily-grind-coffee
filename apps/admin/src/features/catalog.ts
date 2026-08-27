import { adminFetch, esc, triggerHaptic, toast, API_BASE } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-catalog">
    <div class="panel-header">
      <div>
        <h2 class="panel-title">Product Catalog</h2>
        <span style="font-size: 0.85rem; color: var(--text-muted);">Add new roasts, retire old ones, and manage bag-size variants — changes go live on the storefront immediately</span>
      </div>
      <button class="btn-table-action" id="btn-add-product">+ Add Product</button>
    </div>

    <div style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem;">
      <form id="product-add-form" style="display: none; flex-direction: column; gap: 0.9rem; background: var(--admin-bg); border: 1px solid var(--admin-border); border-radius: var(--radius-md); padding: 1.2rem;">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem;">
          <div style="display: flex; flex-direction: column; gap: 0.3rem;">
            <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Name</label>
            <input id="product-name" type="text" required placeholder="e.g. Coorg Peaberry Natural" class="admin-input-styled" style="min-height: 44px;">
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.3rem;">
            <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Category</label>
            <select id="product-category" required class="admin-input-styled" style="min-height: 44px;"></select>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.3rem;">
            <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Origin Country</label>
            <input id="product-origin" type="text" required placeholder="e.g. India" class="admin-input-styled" style="min-height: 44px;">
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.3rem;">
            <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Roast Level</label>
            <select id="product-roast-level" required class="admin-input-styled" style="min-height: 44px;">
              <option value="LIGHT">Light</option>
              <option value="MEDIUM_LIGHT">Medium-Light</option>
              <option value="MEDIUM" selected>Medium</option>
              <option value="MEDIUM_DARK">Medium-Dark</option>
              <option value="DARK">Dark</option>
            </select>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.3rem;">
          <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Description</label>
          <textarea id="product-description" required rows="2" placeholder="Short tasting/description copy for the storefront" class="admin-input-styled"></textarea>
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.3rem;">
          <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Product Image</label>
          <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
            <input id="product-image-file" type="file" accept="image/*" style="color: var(--text-main);">
            <span id="product-image-status" style="font-size: 0.8rem; color: var(--text-muted);">No image uploaded yet</span>
            <img id="product-image-preview" style="display: none; height: 44px; width: 44px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--admin-border);">
          </div>
          <input id="product-image-url" type="hidden">
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem;">
          <div style="display: flex; flex-direction: column; gap: 0.3rem;">
            <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Bag Size (grams)</label>
            <input id="product-weight" type="number" required value="250" class="admin-input-styled" style="min-height: 44px;">
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.3rem;">
            <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Price (cents/paise)</label>
            <input id="product-price" type="number" required placeholder="e.g. 1850" class="admin-input-styled" style="min-height: 44px;">
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.3rem;">
            <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Initial Stock</label>
            <input id="product-initial-stock" type="number" value="0" class="admin-input-styled" style="min-height: 44px;">
          </div>
        </div>

        <div style="display: flex; gap: 0.75rem;">
          <button type="submit" class="btn-table-action">Create Product</button>
          <button type="button" class="btn-table-action" id="btn-cancel-add-product" style="background: transparent;">Cancel</button>
        </div>
      </form>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr><th>Product</th><th>Category</th><th>Roast Level</th><th>Variants</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody id="catalog-table-body"><tr><td colspan="6" style="text-align:center; color:var(--text-muted);">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
  </section>
`;

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;

    const tbody = document.getElementById('catalog-table-body')!;
    const form = document.getElementById('product-add-form') as HTMLFormElement;
    const categorySelect = document.getElementById('product-category') as HTMLSelectElement;
    const imageFileInput = document.getElementById('product-image-file') as HTMLInputElement;
    const imageUrlInput = document.getElementById('product-image-url') as HTMLInputElement;
    const imageStatus = document.getElementById('product-image-status');
    const imagePreview = document.getElementById('product-image-preview') as HTMLImageElement;

    const loadCategories = async () => {
      const data = await adminFetch<{ categories: any[] }>('/api/categories');
      categorySelect.innerHTML = (data.categories || []).map((cat) => `<option value="${cat.id}">${esc(cat.name)}</option>`).join('');
    };

    const renderVariantRow = (variant: any) => `
      <tr style="background: rgba(0,0,0,0.03);">
        <td data-label="Variant" colspan="2" style="padding-left: 2.4rem;">${variant.weight_grams}g · ${esc(variant.sku)}</td>
        <td data-label="Price">₹${(variant.price_cents / 100).toFixed(2)}</td>
        <td data-label="Stock">${variant.available_stock ?? 0} available</td>
        <td data-label="Status">${variant.is_active ? '<span class="status-badge paid">Active</span>' : '<span class="status-badge low-stock">Inactive</span>'}</td>
        <td data-label="Action"><button class="btn-table-action" data-variant-toggle="${variant.id}" data-current-active="${variant.is_active ? '1' : '0'}">${variant.is_active ? 'Deactivate' : 'Reactivate'}</button></td>
      </tr>
    `;

    const renderAddVariantRow = (productId: string) => `
      <tr style="background: rgba(0,0,0,0.02);">
        <td colspan="6" style="padding-left: 2.4rem;">
          <details>
            <summary style="cursor: pointer; color: var(--text-muted); font-size: 0.85rem;">+ Add bag-size variant</summary>
            <div style="display: flex; gap: 0.6rem; flex-wrap: wrap; margin-top: 0.6rem; align-items: center;">
              <input type="number" placeholder="Grams" class="new-variant-weight admin-input-styled" style="min-height: 40px; width: 100px;">
              <input type="number" placeholder="Price (cents)" class="new-variant-price admin-input-styled" style="min-height: 40px; width: 130px;">
              <input type="number" placeholder="Initial stock" class="new-variant-stock admin-input-styled" style="min-height: 40px; width: 110px;">
              <button type="button" class="btn-table-action" data-add-variant="${productId}">Add Variant</button>
            </div>
          </details>
        </td>
      </tr>
    `;

    const render = (products: any[]) => {
      tbody.innerHTML = products.map((p) => `
        <tr>
          <td data-label="Product"><strong>${esc(p.name)}</strong></td>
          <td data-label="Category">${esc(p.category_name)}</td>
          <td data-label="Roast Level">${esc(p.roast_level)}</td>
          <td data-label="Variants">${(p.variants || []).length}</td>
          <td data-label="Status">${p.is_active ? '<span class="status-badge paid">Active</span>' : '<span class="status-badge low-stock">Inactive</span>'}</td>
          <td data-label="Action"><button class="btn-table-action" data-product-toggle="${p.id}" data-current-active="${p.is_active ? '1' : '0'}">${p.is_active ? 'Deactivate' : 'Reactivate'}</button></td>
        </tr>
        ${(p.variants || []).map((v: any) => renderVariantRow(v)).join('')}
        ${renderAddVariantRow(p.id)}
      `).join('');
    };

    const load = async () => {
      const data = await adminFetch<{ products: any[] }>('/api/admin/products');
      render(data.products || []);
    };

    loadCategories();
    load();

    tbody.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;

      const productToggle = target.closest('button[data-product-toggle]') as HTMLElement | null;
      if (productToggle) {
        triggerHaptic();
        const nextActive = productToggle.dataset.currentActive !== '1';
        const result = await adminFetch<{ error?: string }>(`/api/admin/products/${productToggle.dataset.productToggle}`, {
          method: 'PATCH', json: { is_active: nextActive },
        });
        if (result.success) await load();
        return;
      }

      const variantToggle = target.closest('button[data-variant-toggle]') as HTMLElement | null;
      if (variantToggle) {
        triggerHaptic();
        const nextActive = variantToggle.dataset.currentActive !== '1';
        const result = await adminFetch<{ error?: string }>(`/api/admin/variants/${variantToggle.dataset.variantToggle}/status`, {
          method: 'PATCH', json: { is_active: nextActive },
        });
        if (result.success) await load();
        return;
      }

      const addVariantBtn = target.closest('button[data-add-variant]') as HTMLElement | null;
      if (addVariantBtn) {
        triggerHaptic();
        const row = addVariantBtn.closest('td') as HTMLElement;
        const weight = Number((row.querySelector('.new-variant-weight') as HTMLInputElement)?.value);
        const price = Number((row.querySelector('.new-variant-price') as HTMLInputElement)?.value);
        const stock = Number((row.querySelector('.new-variant-stock') as HTMLInputElement)?.value) || 0;

        if (!weight || !price) {
          toast('Weight and price are required to add a variant.', 'error');
          return;
        }

        const result = await adminFetch<{ error?: string }>(`/api/admin/products/${addVariantBtn.dataset.addVariant}/variants`, {
          method: 'POST', json: { weight_grams: weight, price_cents: price, initial_stock: stock },
        });

        if (result.success) {
          await load();
        } else {
          toast(`Could not add variant: ${result.error || 'Unknown error'}`, 'error');
        }
      }
    });

    imageFileInput.addEventListener('change', async () => {
      const file = imageFileInput.files?.[0];
      if (!file) return;

      if (imageStatus) imageStatus.textContent = 'Uploading...';

      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE}/api/media/upload`, { method: 'POST', credentials: 'include', body: formData });
      const data = await res.json() as { success: boolean; url?: string; error?: string };

      if (data.success && data.url) {
        imageUrlInput.value = data.url;
        if (imageStatus) imageStatus.textContent = 'Image uploaded';
        if (imagePreview) {
          imagePreview.src = data.url;
          imagePreview.style.display = 'block';
        }
      } else if (imageStatus) {
        imageStatus.textContent = `Upload failed: ${data.error || 'Unknown error'}`;
      }
    });

    document.getElementById('btn-add-product')?.addEventListener('click', () => {
      triggerHaptic();
      form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    });
    document.getElementById('btn-cancel-add-product')?.addEventListener('click', () => {
      form.style.display = 'none';
      form.reset();
      imageUrlInput.value = '';
      if (imageStatus) imageStatus.textContent = 'No image uploaded yet';
      if (imagePreview) imagePreview.style.display = 'none';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      triggerHaptic();

      const payload = {
        name: (document.getElementById('product-name') as HTMLInputElement).value,
        category_id: categorySelect.value,
        origin_country: (document.getElementById('product-origin') as HTMLInputElement).value,
        roast_level: (document.getElementById('product-roast-level') as HTMLSelectElement).value,
        description: (document.getElementById('product-description') as HTMLTextAreaElement).value,
        image_url: imageUrlInput.value || 'https://images.unsplash.com/photo-1587734195503-904fca47e0e9?auto=format&fit=crop&w=800&q=80',
        weight_grams: Number((document.getElementById('product-weight') as HTMLInputElement).value),
        price_cents: Number((document.getElementById('product-price') as HTMLInputElement).value),
        initial_stock: Number((document.getElementById('product-initial-stock') as HTMLInputElement).value) || 0,
      };

      const result = await adminFetch<{ error?: string }>('/api/admin/products', { method: 'POST', json: payload });

      if (result.success) {
        form.style.display = 'none';
        form.reset();
        imageUrlInput.value = '';
        if (imageStatus) imageStatus.textContent = 'No image uploaded yet';
        if (imagePreview) imagePreview.style.display = 'none';
        await load();
      } else {
        toast(`Could not create product: ${result.error || 'Unknown error'}`, 'error');
      }
    });
  },
};

export default route;
