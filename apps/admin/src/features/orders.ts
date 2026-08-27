import { triggerHaptic } from './shared';
import { openLabelModalForOrder, openInvoiceModalForOrder } from './orders-core';
import type { RouteModule } from '../router';

// Pre-existing gap, not fixed here: this table is static/hardcoded, not fetched from the API.
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
          <tr><th>Order ID</th><th>Customer</th><th>Selected Coffee &amp; Grind</th><th>Total</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody id="orders-table-body">
          <tr data-order-id="TDG-102938">
            <td data-label="Order ID"><strong>TDG-102938</strong></td>
            <td data-label="Customer">Rohan Sharma (Indiranagar)</td>
            <td data-label="Coffee & Grind">Chikmagalur Attikan (250g · South Indian Filter)</td>
            <td data-label="Total"><strong style="color: var(--emerald);">₹450</strong></td>
            <td data-label="Status"><span class="status-badge roasting">Roasting</span></td>
            <td data-label="Actions">
              <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; width: 100%;">
                <button class="btn-table-action btn-order-invoice" data-order="TDG-102938" data-customer="Rohan Sharma" data-loc="Indiranagar, Bangalore" data-item="Chikmagalur Attikan Estate Honey (250g · South Indian Filter)" data-total="450" style="flex:1; min-height:42px;">GST Invoice</button>
                <button class="btn-table-action btn-order-label" data-lot="chikmagalur_attikan" data-grind="South Indian Filter" data-size="250g" data-batch="BATCH-8821" style="flex:1; min-height:42px;">Label</button>
                <button class="btn-table-action btn-order-advance" data-message="Batch TDG-102938 advanced to: Degassing & Nitrogen Packed" style="width:100%; min-height:42px;">Advance ➔</button>
              </div>
            </td>
          </tr>
          <tr data-order-id="TDG-102939">
            <td data-label="Order ID"><strong>TDG-102939</strong></td>
            <td data-label="Customer">Priya Nair (Koramangala)</td>
            <td data-label="Coffee & Grind">Midnight Runner Espresso (500g · Whole Bean)</td>
            <td data-label="Total"><strong style="color: var(--emerald);">₹820</strong></td>
            <td data-label="Status"><span class="status-badge paid">Paid &amp; Queued</span></td>
            <td data-label="Actions">
              <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; width: 100%;">
                <button class="btn-table-action btn-order-invoice" data-order="TDG-102939" data-customer="Priya Nair" data-loc="Koramangala, Bangalore" data-item="Midnight Runner Dark Espresso (500g · Whole Bean)" data-total="820" style="flex:1; min-height:42px;">GST Invoice</button>
                <button class="btn-table-action btn-order-label" data-lot="midnight_runner" data-grind="Whole Bean" data-size="500g" data-batch="BATCH-8820" style="flex:1; min-height:42px;">Label</button>
                <button class="btn-table-action btn-order-advance" data-message="Batch TDG-102939 queued for next convection cycle" style="width:100%; min-height:42px;">Advance ➔</button>
              </div>
            </td>
          </tr>
          <tr data-order-id="TDG-102940">
            <td data-label="Order ID"><strong>TDG-102940</strong></td>
            <td data-label="Customer">David Miller (Whitefield)</td>
            <td data-label="Coffee & Grind">Dawn Patrol Bangalore Blend (1kg · Espresso)</td>
            <td data-label="Total"><strong style="color: var(--emerald);">₹1,490</strong></td>
            <td data-label="Status"><span class="status-badge shipped">Shipped</span></td>
            <td data-label="Actions">
              <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; width: 100%;">
                <button class="btn-table-action btn-order-invoice" data-order="TDG-102940" data-customer="David Miller" data-loc="Whitefield, Bangalore" data-item="Dawn Patrol Bangalore Roastery Blend (1kg · Espresso)" data-total="1490" style="flex:1; min-height:42px;">GST Invoice</button>
                <button class="btn-table-action btn-order-label" data-lot="dawn_patrol" data-grind="Espresso (9-Bar)" data-size="1kg" data-batch="BATCH-8819" style="flex:1; min-height:42px;">Label</button>
                <button class="btn-table-action btn-order-advance" data-message="Tracking ID: BLR-EXPRESS-99281 (Shipped via Express Roastery Courier)" style="width:100%; min-height:42px;">View Tracking</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
`;

const route: RouteModule = {
  mount(container) {
    container.innerHTML = PANEL_HTML;

    document.querySelectorAll('.btn-order-invoice').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        openInvoiceModalForOrder({
          orderId: target.getAttribute('data-order') || 'TDG-102938',
          customerName: target.getAttribute('data-customer') || 'Rohan Sharma',
          customerLocation: target.getAttribute('data-loc') || 'Indiranagar, Bangalore',
          productDescription: target.getAttribute('data-item') || 'Chikmagalur Attikan Estate Honey (250g · South Indian Filter)',
          totalAmountInr: parseFloat(target.getAttribute('data-total') || '450'),
        });
      });
    });

    document.querySelectorAll('.btn-order-label').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        openLabelModalForOrder({
          lot: target.getAttribute('data-lot') || 'chikmagalur_attikan',
          grind: target.getAttribute('data-grind') || 'South Indian Filter',
          size: target.getAttribute('data-size') || '250g',
          batch: target.getAttribute('data-batch') || 'BATCH-8821',
        });
      });
    });

    document.querySelectorAll('.btn-order-advance').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        triggerHaptic();
        alert((e.currentTarget as HTMLElement).getAttribute('data-message') || 'Order advanced.');
      });
    });
  },
};

export default route;
