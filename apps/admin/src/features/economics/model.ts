/**
 * Shared state for the capacity/capex/unit-economics trio (main.ts previously kept these as
 * `AdminPortal` instance fields plus two cross-calling callback slots, with an explicit
 * "economics must init before capex" ordering requirement). Under routing only one of the
 * three views is ever mounted at a time, so there's no cross-instance call to order — each
 * view reads this module-scope state, subscribes to changes, and re-renders itself.
 *
 * State lives at module scope, so it persists across navigating away and back within the
 * same page load (matching the old single-page behavior) and resets on a full reload
 * (same as before — there was no persistence layer either).
 */

export interface RoasterTierSpec {
  batchSizeKg: number;
  label: string;
  category: string;
  recommendedRole: string;
  statusClass: 'danger' | 'warning' | 'success' | 'premium';
}

export const ROASTER_TIERS: RoasterTierSpec[] = [
  { batchSizeKg: 1.0, label: '1.0kg Specialty Drum', category: 'Sample / Pilot', recommendedRole: 'Sub-Breakeven (4h: 1,273 kg/yr)', statusClass: 'danger' },
  { batchSizeKg: 1.5, label: '1.5kg Nano Roaster', category: 'Nano Roaster', recommendedRole: 'Sub-Breakeven (4h: 1,909 kg/yr)', statusClass: 'danger' },
  { batchSizeKg: 2.0, label: '2.0kg Micro Commercial', category: 'Micro Commercial', recommendedRole: 'Tight Breakeven (4h: 2,546 kg/yr)', statusClass: 'warning' },
  { batchSizeKg: 3.0, label: '3.0kg Commercial Entry', category: 'Commercial Entry', recommendedRole: 'Breakeven Floor (4h: 3,819 kg/yr)', statusClass: 'success' },
  { batchSizeKg: 5.0, label: '5.0kg Investor Standard', category: 'Investor Standard', recommendedRole: '1.5x – 2.0x Scale (4h: 6,365 kg/yr)', statusClass: 'success' },
  { batchSizeKg: 10.0, label: '10.0kg Wholesale Scaling', category: 'Wholesale Scaling', recommendedRole: 'High Volume (4h: 12,730 kg/yr)', statusClass: 'premium' },
];

export const BREAKEVEN_KG_YEAR = 2483; // Sheet 5 Milestone 1 (requires min 3kg roaster)
export const INVESTOR_LOW_KG_YEAR = 3725; // Sheet 5 Milestone 2, 1.5x (requires min 5kg roaster)
export const INVESTOR_HIGH_KG_YEAR = 4967; // Sheet 5 Milestone 3, 2.0x (requires 5kg-10kg roaster)

export const state = {
  // Base fixed monthly overheads excluding roaster machine depreciation:
  // Founder Salary ₹1,00,000 + Rent/Power (Indiranagar Shed) ₹12,000 + Marketing/CAC/BizDev
  // ₹16,667 + Cloudflare/Ops ₹2,000 = ₹1,30,667/mo
  baseFixedCostExcludingRoaster: 130667,
  auxEquipmentDeprec: 2500, // ₹1.5L grinder/sealer/scales over 5 years (60 mo)
  simulatedRoasterCapEx: 450000, // ₹4.50L default for 3kg Aatomize ARST-3 (Sheet 6)
  simulatedRoasterName: '3kg Commercial (Aatomize ARST-3)',
  monthlyFixedCost: 130667 + 2500 + Math.round(450000 / 60), // ₹1,40,667/mo

  selectedBatchSizeKg: 3.0,
  dailyRoastingHours: 4.0,
  batchCycleMinutes: 50,
  capacityRoastLossPct: 0.15,
  operatingDaysPerMonth: 26,
  operatingDaysPerYear: 312,
  retailPricePerBag: 450,
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(): void {
  listeners.forEach((fn) => fn());
}
