/**
 * Admin experiences management (5.1, 5.2, 5.5) — the catalog, the slot calendar, the roster,
 * attendance marking and blackout dates.
 * Build DOM through ./shared.ts helpers; do not edit main.ts or index.html.
 *
 * This panel is what makes bookings possible at all: an experience with no open slot can never
 * be booked, so slot creation is the primary action here rather than an afterthought.
 */

import { adminFetch, esc, mountAdminPanel, panelBody, registerAdminNavItem } from './shared';

const PANEL = 'panel-experiences';

interface Experience {
  id: string;
  slug: string;
  name: string;
  mode: string;
  status: string;
  price_cents: number;
  deposit_cents: number;
  default_capacity: number;
  duration_minutes: number | null;
  entitlement_code: string | null;
  is_multi_day?: number;
}

interface Slot {
  id: string;
  experience_id: string;
  experience_name: string;
  mode: string;
  starts_at: string;
  ends_at: string;
  seats_total: number;
  seats_booked: number;
  staff_name: string | null;
  meeting_url: string | null;
  status: string;
}

function inr(cents: number): string {
  return '₹' + Math.round((cents || 0) / 100).toLocaleString('en-IN');
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * `datetime-local` yields a wall-clock string with no zone. Converting through Date here means
 * the instant sent to the API is the one the operator saw in their own timezone — which is the
 * roastery's, for the people who staff these sessions.
 */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function initAdminExperiences(portal: any): void {
  void portal;

  mountAdminPanel(PANEL, 'Experiences & Bookings');
  registerAdminNavItem('experiences', 'Experiences', PANEL);
  const body = panelBody(PANEL);
  if (!body) return;

  body.innerHTML = `
    <div style="overflow-x: auto;">
      <table class="data-table">
        <thead><tr>
          <th>Experience</th><th>Mode</th><th>Price</th><th>Deposit</th><th>Capacity</th><th>Funded by</th><th>Status</th><th>Action</th>
        </tr></thead>
        <tbody id="exp-table-body"><tr><td colspan="8">Loading…</td></tr></tbody>
      </table>
    </div>

    <h3 style="margin-top: 2rem;">Add a slot</h3>
    <form id="slot-form" style="display: grid; gap: 0.8rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
      <label>Experience<select name="experienceId" id="slot-experience"></select></label>
      <label>Starts<input name="startsAt" type="datetime-local" required /></label>
      <label>Ends <span style="color:var(--text-muted); font-size:0.78rem;">(blank = use duration)</span>
        <input name="endsAt" type="datetime-local" /></label>
      <label>Seats<input name="seatsTotal" type="number" min="1" placeholder="default capacity" /></label>
      <label>Host<input name="staffName" /></label>
      <label>Host email<input name="staffEmail" type="email" /></label>
      <label>Video room URL <span style="color:var(--text-muted); font-size:0.78rem;">(VIDEO only)</span>
        <input name="meetingUrl" type="url" /></label>
      <label style="grid-column: 1 / -1;">Notes<input name="notes" /></label>
      <div style="grid-column: 1 / -1; display: flex; gap: 0.6rem; align-items: center;">
        <button type="submit" class="btn-table-action">Create slot</button>
        <span id="slot-form-error" style="color: var(--danger, #c0392b); font-size: 0.85rem;"></span>
      </div>
    </form>

    <h3 style="margin-top: 2rem;">Upcoming slots</h3>
    <div style="overflow-x: auto;">
      <table class="data-table">
        <thead><tr>
          <th>Experience</th><th>When</th><th>Seats</th><th>Host</th><th>Status</th><th>Action</th>
        </tr></thead>
        <tbody id="slot-table-body"><tr><td colspan="6">Loading…</td></tr></tbody>
      </table>
    </div>

    <div id="roster-host" style="margin-top: 1.6rem;"></div>

    <h3 style="margin-top: 2rem;">Blackout dates</h3>
    <form id="blackout-form" style="display: grid; gap: 0.8rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
      <label>Experience <span style="color:var(--text-muted); font-size:0.78rem;">(blank = all)</span>
        <select name="experienceId" id="blackout-experience"></select></label>
      <label>From<input name="startsAt" type="datetime-local" required /></label>
      <label>To<input name="endsAt" type="datetime-local" required /></label>
      <label>Reason<input name="reason" /></label>
      <div style="grid-column: 1 / -1; display: flex; gap: 0.6rem; align-items: center;">
        <button type="submit" class="btn-table-action">Add blackout</button>
        <span id="blackout-error" style="color: var(--danger, #c0392b); font-size: 0.85rem;"></span>
      </div>
    </form>
    <div style="overflow-x: auto; margin-top: 1rem;">
      <table class="data-table">
        <thead><tr><th>Experience</th><th>From</th><th>To</th><th>Reason</th><th>Action</th></tr></thead>
        <tbody id="blackout-table-body"><tr><td colspan="5">Loading…</td></tr></tbody>
      </table>
    </div>
  `;

  const expBody = body.querySelector<HTMLElement>('#exp-table-body')!;
  const slotBody = body.querySelector<HTMLElement>('#slot-table-body')!;
  const rosterHost = body.querySelector<HTMLElement>('#roster-host')!;
  const blackoutBody = body.querySelector<HTMLElement>('#blackout-table-body')!;
  let experiences: Experience[] = [];

  async function loadExperiences(): Promise<void> {
    const res = await adminFetch<{ experiences?: Experience[] }>('/api/experiences/admin/experiences');
    experiences = res.success ? res.experiences || [] : [];

    expBody.innerHTML = experiences.length
      ? experiences.map((e) => `
          <tr>
            <td data-label="Experience"><strong>${esc(e.name)}</strong><br />
              <span style="color:var(--text-muted); font-size:0.82rem;">${esc(e.slug)}</span></td>
            <td data-label="Mode">${esc(e.mode)}</td>
            <td data-label="Price">${esc(inr(e.price_cents))}</td>
            <td data-label="Deposit">${e.deposit_cents ? esc(inr(e.deposit_cents)) : '—'}</td>
            <td data-label="Capacity">${esc(e.default_capacity)}</td>
            <td data-label="Funded by">${e.entitlement_code ? esc(e.entitlement_code) : 'Paid only'}</td>
            <td data-label="Status">${esc(e.status)}</td>
            <td data-label="Action">
              <button class="btn-table-action" data-exp-status="${esc(e.id)}" data-next="${e.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED'}">
                ${e.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
              </button>
            </td>
          </tr>`).join('')
      : '<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">No experiences in the catalog.</td></tr>';

    expBody.querySelectorAll<HTMLElement>('[data-exp-status]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const res = await adminFetch(`/api/experiences/admin/experiences/${encodeURIComponent(btn.dataset.expStatus!)}`, {
          method: 'PATCH',
          json: { status: btn.dataset.next },
        });
        if (!res.success) { alert(res.error || 'Could not change the status'); return; }
        await loadExperiences();
      });
    });

    const pickers = [
      body!.querySelector<HTMLSelectElement>('#slot-experience'),
      body!.querySelector<HTMLSelectElement>('#blackout-experience'),
    ];
    const optionsHtml = experiences
      .map((e) => `<option value="${esc(e.id)}">${esc(e.name)} (${esc(e.mode)})</option>`)
      .join('');
    if (pickers[0]) pickers[0].innerHTML = optionsHtml;
    if (pickers[1]) pickers[1].innerHTML = `<option value="">All experiences</option>${optionsHtml}`;
  }

  async function loadSlots(): Promise<void> {
    const res = await adminFetch<{ slots?: Slot[] }>('/api/experiences/admin/slots?upcoming=1');
    const slots = res.success ? res.slots || [] : [];

    slotBody.innerHTML = slots.length
      ? slots.map((s) => `
          <tr>
            <td data-label="Experience">${esc(s.experience_name)}</td>
            <td data-label="When">${esc(when(s.starts_at))} → ${esc(when(s.ends_at))}</td>
            <td data-label="Seats">${esc(s.seats_booked)} / ${esc(s.seats_total)}</td>
            <td data-label="Host">${esc(s.staff_name || '—')}</td>
            <td data-label="Status">${esc(s.status)}</td>
            <td data-label="Action">
              <button class="btn-table-action" data-roster="${esc(s.id)}">Roster</button>
              <button class="btn-table-action" data-promote="${esc(s.id)}">Promote waitlist</button>
              ${s.status !== 'CANCELLED' ? `<button class="btn-table-action" data-cancel-slot="${esc(s.id)}">Cancel</button>` : ''}
            </td>
          </tr>`).join('')
      : '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No upcoming slots — nothing can be booked until you add one.</td></tr>';

    slotBody.querySelectorAll<HTMLElement>('[data-roster]').forEach((btn) => {
      btn.addEventListener('click', () => void loadRoster(btn.dataset.roster!));
    });

    slotBody.querySelectorAll<HTMLElement>('[data-promote]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const res = await adminFetch<{ promotedBookingId?: string | null }>(
          `/api/experiences/admin/slots/${encodeURIComponent(btn.dataset.promote!)}/promote-waitlist`,
          { method: 'POST' }
        );
        alert(res.promotedBookingId ? 'Offered the seat to the next person on the waitlist.' : 'Nobody is waiting for this slot.');
        await loadSlots();
      });
    });

    slotBody.querySelectorAll<HTMLElement>('[data-cancel-slot]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        // Cancelling a slot cancels every live booking on it, refunding payments and returning
        // entitlements. Spell that out — it is not recoverable from this screen.
        if (!confirm('Cancel this slot? Everyone booked on it is cancelled, refunded, and told by email.')) return;
        const res = await adminFetch<{ cancelledBookings?: number }>(
          `/api/experiences/admin/slots/${encodeURIComponent(btn.dataset.cancelSlot!)}`,
          { method: 'DELETE' }
        );
        if (!res.success) { alert(res.error || 'Could not cancel the slot'); return; }
        alert(`Slot cancelled. ${res.cancelledBookings ?? 0} booking(s) were cancelled and refunded.`);
        rosterHost.innerHTML = '';
        await loadSlots();
      });
    });
  }

  async function loadRoster(slotId: string): Promise<void> {
    const res = await adminFetch<{ slot?: any; roster?: any[] }>(
      `/api/experiences/admin/slots/${encodeURIComponent(slotId)}/roster`
    );
    if (!res.success) { rosterHost.innerHTML = `<p style="color:var(--danger,#c0392b);">${esc(res.error || 'Could not load the roster')}</p>`; return; }

    const bookings = res.roster || [];
    rosterHost.innerHTML = `
      <h3>Roster — ${esc(res.slot?.experience_name || '')} · ${esc(when(res.slot?.starts_at))}</h3>
      <div style="overflow-x: auto;">
        <table class="data-table">
          <thead><tr>
            <th>Guest</th><th>Seats</th><th>Status</th><th>Funded by</th><th>Notes</th><th>Action</th>
          </tr></thead>
          <tbody>
            ${bookings.length ? bookings.map((b) => `
              <tr>
                <td data-label="Guest">${esc(b.customer_name || b.customer_email)}<br />
                  <span style="color:var(--text-muted); font-size:0.8rem;">${esc(b.booking_reference)}${b.contact_phone ? ' · ' + esc(b.contact_phone) : ''}</span></td>
                <td data-label="Seats">${esc(b.seats)}${b.party_size ? ` (party ${esc(b.party_size)})` : ''}</td>
                <td data-label="Status">${esc(b.status)}${b.attended_at ? ' · attended' : ''}${b.no_show_at ? ' · no-show' : ''}</td>
                <td data-label="Funded by">${esc(b.funding_source || '—')}${b.amount_cents ? ` · ${esc(inr(b.amount_cents))}` : ''}</td>
                <td data-label="Notes" style="max-width: 260px; white-space: normal;">${esc([b.dietary_notes, b.accessibility_notes].filter(Boolean).join(' · ') || '—')}</td>
                <td data-label="Action">
                  <button class="btn-table-action" data-attend="${esc(b.id)}" data-outcome="ATTENDED">Attended</button>
                  <button class="btn-table-action" data-attend="${esc(b.id)}" data-outcome="NO_SHOW">No-show</button>
                </td>
              </tr>`).join('')
              : '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">Nobody booked yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    rosterHost.querySelectorAll<HTMLElement>('[data-attend]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const res = await adminFetch(`/api/experiences/admin/bookings/${encodeURIComponent(btn.dataset.attend!)}/attendance`, {
          method: 'POST',
          json: { outcome: btn.dataset.outcome },
        });
        if (!res.success) { alert(res.error || 'Could not mark attendance'); return; }
        await loadRoster(slotId);
      });
    });
  }

  async function loadBlackouts(): Promise<void> {
    const res = await adminFetch<{ blackouts?: any[] }>('/api/experiences/admin/blackouts');
    const rows = res.success ? res.blackouts || [] : [];
    blackoutBody.innerHTML = rows.length
      ? rows.map((b) => `
          <tr>
            <td data-label="Experience">${esc(b.experience_name || 'All')}</td>
            <td data-label="From">${esc(when(b.starts_at))}</td>
            <td data-label="To">${esc(when(b.ends_at))}</td>
            <td data-label="Reason">${esc(b.reason || '—')}</td>
            <td data-label="Action"><button class="btn-table-action" data-del-blackout="${esc(b.id)}">Remove</button></td>
          </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No blackout dates.</td></tr>';

    blackoutBody.querySelectorAll<HTMLElement>('[data-del-blackout]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await adminFetch(`/api/experiences/admin/blackouts/${encodeURIComponent(btn.dataset.delBlackout!)}`, { method: 'DELETE' });
        await loadBlackouts();
      });
    });
  }

  body.querySelector<HTMLFormElement>('#slot-form')!.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target as HTMLFormElement;
    const errorEl = body!.querySelector<HTMLElement>('#slot-form-error')!;
    errorEl.textContent = '';

    const data = new FormData(form);
    const startsAt = localInputToIso(String(data.get('startsAt') || ''));
    if (!startsAt) { errorEl.textContent = 'A start time is required'; return; }
    const seats = String(data.get('seatsTotal') || '').trim();

    const res = await adminFetch('/api/experiences/admin/slots', {
      method: 'POST',
      json: {
        experienceId: data.get('experienceId'),
        startsAt,
        endsAt: localInputToIso(String(data.get('endsAt') || '')) || undefined,
        seatsTotal: seats === '' ? undefined : Number(seats),
        staffName: String(data.get('staffName') || '').trim() || null,
        staffEmail: String(data.get('staffEmail') || '').trim() || null,
        meetingUrl: String(data.get('meetingUrl') || '').trim() || null,
        notes: String(data.get('notes') || '').trim() || null,
      },
    });
    if (!res.success) { errorEl.textContent = res.error || 'Could not create the slot'; return; }
    form.reset();
    await loadSlots();
  });

  body.querySelector<HTMLFormElement>('#blackout-form')!.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target as HTMLFormElement;
    const errorEl = body!.querySelector<HTMLElement>('#blackout-error')!;
    errorEl.textContent = '';

    const data = new FormData(form);
    const startsAt = localInputToIso(String(data.get('startsAt') || ''));
    const endsAt = localInputToIso(String(data.get('endsAt') || ''));
    if (!startsAt || !endsAt) { errorEl.textContent = 'A blackout needs a start and an end'; return; }

    const res = await adminFetch('/api/experiences/admin/blackouts', {
      method: 'POST',
      json: {
        experienceId: String(data.get('experienceId') || '') || null,
        startsAt,
        endsAt,
        reason: String(data.get('reason') || '').trim() || null,
      },
    });
    if (!res.success) { errorEl.textContent = res.error || 'Could not add the blackout'; return; }
    form.reset();
    await loadBlackouts();
  });

  void (async () => {
    await loadExperiences();
    await loadSlots();
    await loadBlackouts();
  })();
}
