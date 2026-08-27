import { adminFetch, esc, triggerHaptic } from './shared';
import type { RouteModule } from '../router';

const PANEL_HTML = `
  <section class="section-panel" id="panel-roasts">
    <div class="panel-header">
      <h2 class="panel-title">Batch Roaster Log &amp; Loss Calibrator</h2>
      <span style="font-size: 0.85rem; color: var(--text-muted);">Log green in vs roasted out to compute actual yield and real-world COGS</span>
    </div>

    <div style="padding: 1.5rem;">
      <form id="roast-batch-form" style="display: grid; grid-template-columns: repeat(4, 1fr) auto; gap: 1rem; align-items: end; background: var(--admin-bg); padding: 1.2rem; border-radius: var(--radius-md); margin-bottom: 1.5rem;">
        <div>
          <label style="display:block; font-size: 0.78rem; font-weight:600; color:var(--text-muted); margin-bottom:0.3rem;">Coffee Lot</label>
          <select id="batch-lot-select" class="admin-input-styled" style="width:100%;">
            <option value="Chikmagalur Attikan Honey">Chikmagalur Attikan Honey</option>
            <option value="Araku Valley Red Honey">Araku Valley Red Honey</option>
            <option value="Ethiopia Yirgacheffe Gedeb">Ethiopia Yirgacheffe Gedeb</option>
            <option value="Dawn Patrol Bangalore Blend">Dawn Patrol Bangalore Blend</option>
            <option value="Midnight Runner Dark Espresso">Midnight Runner Dark Espresso</option>
          </select>
        </div>
        <div>
          <label style="display:block; font-size: 0.78rem; font-weight:600; color:var(--text-muted); margin-bottom:0.3rem;">Green In (kg)</label>
          <input type="number" id="batch-green-in" value="12.0" step="0.1" required class="admin-input-styled" style="width:100%;">
        </div>
        <div>
          <label style="display:block; font-size: 0.78rem; font-weight:600; color:var(--text-muted); margin-bottom:0.3rem;">Roasted Out (kg)</label>
          <input type="number" id="batch-roasted-out" value="10.2" step="0.1" required class="admin-input-styled" style="width:100%;">
        </div>
        <div>
          <label style="display:block; font-size: 0.78rem; font-weight:600; color:var(--text-muted); margin-bottom:0.3rem;">Profile Curve</label>
          <input type="text" id="batch-profile" value="Light-Medium (198°C Drop)" class="admin-input-styled" style="width:100%;">
        </div>
        <button type="submit" class="btn-admin-action" style="padding: 0.55rem 1.2rem;">Log Batch</button>
      </form>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr><th>Batch ID</th><th>Lot / Varietal</th><th>Green In</th><th>Roasted Out</th><th>Roast Loss %</th><th>Calculated Green Cost / Bag</th><th>Status</th></tr>
          </thead>
          <tbody id="batch-table-body"></tbody>
        </table>
      </div>
    </div>
  </section>
`;

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;

    const form = document.getElementById('roast-batch-form') as HTMLFormElement;
    const tbody = document.getElementById('batch-table-body')!;

    const render = (batches: any[]) => {
      tbody.innerHTML = batches.map((b) => {
        const lossPct = Number(b.roast_loss_percent);
        const greenCostPerBag = ((0.25 / (1 - lossPct / 100)) * 610).toFixed(2);
        return `
          <tr>
            <td data-label="Batch ID"><strong>${esc(b.id)}</strong></td>
            <td data-label="Lot Name">${esc(b.lot_name)}</td>
            <td data-label="Green In">${b.green_kg_in} kg</td>
            <td data-label="Roasted Out">${b.roasted_kg_out} kg</td>
            <td data-label="Roast Loss %"><strong style="color: var(--emerald);">${lossPct}%</strong></td>
            <td data-label="Green Cost / Bag">₹${greenCostPerBag} / 250g</td>
            <td data-label="Status"><span class="status-badge paid">Calibrated</span></td>
          </tr>
        `;
      }).join('');
    };

    const load = async () => {
      const data = await adminFetch<{ batches: any[] }>('/api/admin/roast-batches');
      render(data.batches || []);
    };
    load();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      triggerHaptic();
      const lotSelect = document.getElementById('batch-lot-select') as HTMLSelectElement;
      const greenInput = document.getElementById('batch-green-in') as HTMLInputElement;
      const roastedInput = document.getElementById('batch-roasted-out') as HTMLInputElement;
      const profileInput = document.getElementById('batch-profile') as HTMLInputElement;

      const result = await adminFetch<{ message?: string; error?: string }>('/api/admin/roast-batch', {
        method: 'POST',
        json: {
          lot_name: lotSelect.value,
          green_kg_in: parseFloat(greenInput.value),
          roasted_kg_out: parseFloat(roastedInput.value),
          roaster_profile: profileInput.value,
        },
      });

      if (result.success) {
        await load();
        alert(result.message || 'Batch logged.');
      } else {
        alert(`Could not log batch: ${result.error || 'Unknown error'}`);
      }
    });
  },
};

export default route;
