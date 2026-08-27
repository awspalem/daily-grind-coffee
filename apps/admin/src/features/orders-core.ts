import { triggerHaptic } from './shared';
import { ROASTERY_LOT_PRESETS, generateThermalLabelHTML, BagLabelConfig } from '../utils/thermalLabel';
import { buildGSTInvoiceFromOrder, renderGSTInvoiceHTML } from '../utils/gstInvoice';

/**
 * The bag-label and GST-invoice modals live outside every route's content (siblings of
 * #route-outlet in index.html) and are triggered from multiple tabs (the labels tab's own
 * studio, the orders tab's row buttons, and the top-bar's "Generate Bag Label & QR"
 * shortcut). They're wired once at boot, not per-route.
 *
 * The modal's own lot/date/batch/grind/size fields are a separate, self-contained mini-form
 * from the labels tab's studio form — under routing only one of the two can ever be visible
 * at once, so there's no live two-way sync between them (the old always-in-DOM version had
 * one); opening the modal always seeds it fresh from whatever triggered it.
 */

function formatRoastDateDisplay(dateVal: string): string {
  if (!dateVal) return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  const d = new Date(dateVal);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
}

function modalConfig(): BagLabelConfig {
  const lotSelect = document.getElementById('modal-lot-select') as HTMLSelectElement;
  const dateInput = document.getElementById('modal-roast-date') as HTMLInputElement;
  const batchInput = document.getElementById('modal-batch-id') as HTMLInputElement;
  const grindSelect = document.getElementById('modal-grind-select') as HTMLSelectElement;
  const sizeSelect = document.getElementById('modal-bag-size') as HTMLSelectElement;

  const preset = ROASTERY_LOT_PRESETS.find((p) => p.id === lotSelect?.value) || ROASTERY_LOT_PRESETS[0];

  return {
    lotName: preset.name,
    lotSlug: preset.slug,
    region: preset.region,
    elevation: preset.elevation,
    processMethod: preset.processMethod,
    roastLevel: preset.roastLevel,
    tastingNotes: preset.tastingNotes,
    roastDate: formatRoastDateDisplay(dateInput?.value || ''),
    batchId: batchInput?.value.trim() || 'BATCH-8821',
    grindType: grindSelect?.value || preset.recommendedGrind,
    bagSize: sizeSelect?.value || '250g',
    roasteryLocation: 'Indiranagar Roastery, Bangalore',
  };
}

function renderModalLabelPreview(): void {
  const el = document.getElementById('modal-thermal-label-preview');
  if (el) el.innerHTML = generateThermalLabelHTML(modalConfig());
}

function initLabelModal(): void {
  const modal = document.getElementById('modal-bag-label');
  const todayStr = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('modal-roast-date') as HTMLInputElement | null;
  if (dateInput && !dateInput.value) dateInput.value = todayStr;

  document.getElementById('btn-open-label-modal')?.addEventListener('click', () => {
    triggerHaptic();
    modal?.classList.add('active');
    renderModalLabelPreview();
  });

  document.getElementById('modal-label-close')?.addEventListener('click', () => modal?.classList.remove('active'));
  document.getElementById('modal-label-cancel')?.addEventListener('click', () => modal?.classList.remove('active'));

  ['modal-lot-select', 'modal-roast-date', 'modal-batch-id', 'modal-grind-select', 'modal-bag-size'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', renderModalLabelPreview);
    document.getElementById(id)?.addEventListener('change', renderModalLabelPreview);
  });

  document.getElementById('modal-label-print')?.addEventListener('click', () => {
    triggerHaptic();
    document.body.classList.remove('print-gst-invoice');
    document.body.classList.add('print-thermal-label');
    window.print();
    setTimeout(() => document.body.classList.remove('print-thermal-label'), 1000);
  });

  renderModalLabelPreview();
}

/** Called by order-row "Label" buttons (orders.ts). */
export function openLabelModalForOrder(opts: { lot: string; grind: string; size: string; batch: string }): void {
  triggerHaptic();
  const lotSelect = document.getElementById('modal-lot-select') as HTMLSelectElement | null;
  const grindSelect = document.getElementById('modal-grind-select') as HTMLSelectElement | null;
  const sizeSelect = document.getElementById('modal-bag-size') as HTMLSelectElement | null;
  const batchInput = document.getElementById('modal-batch-id') as HTMLInputElement | null;

  if (lotSelect) lotSelect.value = opts.lot;
  if (grindSelect) grindSelect.value = opts.grind;
  if (sizeSelect) sizeSelect.value = opts.size;
  if (batchInput) batchInput.value = opts.batch;
  renderModalLabelPreview();

  document.getElementById('modal-bag-label')?.classList.add('active');
}

function initInvoiceModal(): void {
  const modal = document.getElementById('modal-gst-invoice');

  document.getElementById('modal-invoice-close')?.addEventListener('click', () => modal?.classList.remove('active'));
  document.getElementById('modal-invoice-cancel')?.addEventListener('click', () => modal?.classList.remove('active'));

  document.getElementById('modal-invoice-print')?.addEventListener('click', () => {
    triggerHaptic();
    document.body.classList.remove('print-thermal-label');
    document.body.classList.add('print-gst-invoice');
    window.print();
    setTimeout(() => document.body.classList.remove('print-gst-invoice'), 1000);
  });
}

/** Called by order-row "GST Invoice" buttons (orders.ts). */
export function openInvoiceModalForOrder(orderData: {
  orderId: string;
  customerName: string;
  customerLocation?: string;
  productDescription: string;
  totalAmountInr: number;
}): void {
  triggerHaptic();
  const invoiceData = buildGSTInvoiceFromOrder(orderData);
  const contentEl = document.getElementById('modal-invoice-content');
  if (contentEl) contentEl.innerHTML = renderGSTInvoiceHTML(invoiceData);
  document.getElementById('modal-gst-invoice')?.classList.add('active');
}

export function initOrdersCore(): void {
  initLabelModal();
  initInvoiceModal();
}
