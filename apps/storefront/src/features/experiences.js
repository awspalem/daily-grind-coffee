/**
 * Experiences feature UI. Owned by one agent — see docs/roadmap-gaps.md.
 * Build all DOM through the helpers in ./shared.ts; do not edit main.ts or index.html.
 *
 * One section renders all four bookable experiences, because they are one primitive: the
 * teleconsultation differs from the estate visit only in mode, duration and what funds it.
 *
 * Every timestamp arrives from the API as UTC ISO and is rendered in Asia/Kolkata, labelled IST,
 * so the customer and the roastery never read a slot as two different instants.
 */
import { apiFetch, esc, isSignedIn, mountFeatureSection, registerNavPill } from './shared';
const SECTION_ID = 'experiences';
const ROASTERY_TZ = 'Asia/Kolkata';
const state = {
    experiences: [],
    bookings: [],
    balances: [],
    openSlotsFor: null,
    busy: false,
};
// ---------------------------------------------------------------------------
// Formatting — always Asia/Kolkata
// ---------------------------------------------------------------------------
/** SQLite writes CURRENT_TIMESTAMP without a Z; treating that as local would shift it 5h30m. */
function asDate(iso) {
    if (!iso)
        return null;
    const normalised = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z';
    const d = new Date(normalised);
    return isNaN(d.getTime()) ? null : d;
}
function fmtDateTime(iso) {
    const d = asDate(iso);
    if (!d)
        return '';
    return new Intl.DateTimeFormat('en-IN', {
        weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
        hour12: true, timeZone: ROASTERY_TZ,
    }).format(d) + ' IST';
}
function fmtDate(iso) {
    const d = asDate(iso);
    if (!d)
        return '';
    return new Intl.DateTimeFormat('en-IN', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: ROASTERY_TZ,
    }).format(d);
}
function fmtRange(booking) {
    return booking.is_multi_day
        ? `${fmtDate(booking.starts_at)} — ${fmtDate(booking.ends_at)}`
        : fmtDateTime(booking.starts_at);
}
function money(cents, currency = 'inr') {
    const code = (currency || 'inr').toUpperCase();
    try {
        return new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en-US', {
            style: 'currency', currency: code, maximumFractionDigits: 0,
        }).format((cents || 0) / 100);
    }
    catch {
        return `${code} ${((cents || 0) / 100).toFixed(2)}`;
    }
}
function creditsFor(code) {
    if (!code)
        return 0;
    const balance = state.balances.find((b) => b.entitlement_code === code);
    if (!balance)
        return 0;
    return balance.unlimited ? Infinity : balance.remaining_units;
}
function toast(message, tone = 'ok') {
    const host = document.getElementById('experiences-toast');
    if (!host)
        return;
    host.textContent = message;
    host.style.display = 'block';
    host.style.background = tone === 'ok' ? 'rgba(46, 120, 74, 0.09)' : 'rgba(200, 90, 50, 0.09)';
    host.style.color = tone === 'ok' ? '#2e784a' : 'var(--accent-terracotta)';
}
// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function durationLabel(exp) {
    if (exp.is_multi_day)
        return 'Multi-day';
    if (!exp.duration_minutes)
        return '';
    return exp.duration_minutes >= 60
        ? `${Math.round((exp.duration_minutes / 60) * 10) / 10} hr`
        : `${exp.duration_minutes} min`;
}
function experienceCard(exp) {
    const credits = creditsFor(exp.entitlement_code);
    const hasCredit = credits > 0;
    const priceLabel = exp.deposit_cents > 0
        ? `${money(exp.price_cents, exp.currency)} <small style="color:var(--text-muted); font-weight:400;">· ${money(exp.deposit_cents, exp.currency)} deposit</small>`
        : money(exp.price_cents, exp.currency);
    const meta = [durationLabel(exp), exp.mode === 'VIDEO' ? 'Online' : esc(exp.location_name || 'At the roastery')]
        .filter(Boolean).map((m) => `<span>${m}</span>`).join('<span aria-hidden="true"> · </span>');
    const slotsOpen = state.openSlotsFor === exp.id;
    return `
    <article class="product-card" style="padding: 1.6rem;">
      <div class="card-title-row" style="align-items: flex-start; gap: 0.6rem;">
        <h3 class="card-title" style="margin: 0;">${esc(exp.name)}</h3>
        ${hasCredit ? `<span style="background: rgba(46,120,74,0.12); color:#2e784a; font-size:0.72rem; font-weight:700; letter-spacing:0.06em; padding:0.28rem 0.6rem; border-radius:999px; white-space:nowrap;">
          ${credits === Infinity ? 'INCLUDED' : `${credits} CREDIT${credits === 1 ? '' : 'S'}`}
        </span>` : ''}
      </div>
      ${exp.tagline ? `<p class="card-tagline" style="margin: 0.35rem 0 0.7rem;">${esc(exp.tagline)}</p>` : ''}
      <p style="font-size: 0.82rem; color: var(--text-muted); letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 0.9rem;">${meta}</p>
      <p style="font-size: 0.95rem; line-height: 1.6; color: var(--text-muted); margin-bottom: 1.2rem;">${esc(exp.description || '')}</p>

      <div class="card-footer" style="margin-top: auto; display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap;">
        <span class="card-price">${priceLabel}</span>
        <button class="btn-primary" data-exp-toggle="${esc(exp.id)}" aria-expanded="${slotsOpen}">
          ${slotsOpen ? 'Hide dates' : exp.slot_count ? 'See dates' : 'Dates coming soon'}
        </button>
      </div>

      ${slotsOpen ? `<div style="margin-top: 1.3rem; border-top: 1px solid var(--border-subtle); padding-top: 1.2rem;">${slotList(exp)}</div>` : ''}
    </article>
  `;
}
function slotList(exp) {
    if (!exp.next_slots.length) {
        return `<p style="color: var(--text-muted); font-size: 0.92rem;">No dates are open just yet. We publish new dates at the start of each month.</p>`;
    }
    const rows = exp.next_slots.map((slot) => {
        const when = exp.is_multi_day
            ? `${fmtDate(slot.starts_at)} — ${fmtDate(slot.ends_at)}`
            : fmtDateTime(slot.starts_at);
        const seats = slot.is_full
            ? '<span style="color: var(--accent-terracotta); font-weight: 600;">Full — join the waitlist</span>'
            : `${slot.seats_available} of ${slot.seats_total} places left`;
        return `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap; padding: 0.7rem 0; border-bottom: 1px solid var(--border-subtle);">
        <div>
          <strong style="display:block; color: var(--text-main); font-size: 0.98rem;">${esc(when)}</strong>
          <span style="font-size: 0.85rem; color: var(--text-muted);">
            ${esc(seats)}${slot.staff_name ? ` · with ${esc(slot.staff_name)}` : ''}
          </span>
        </div>
        <button class="btn-secondary" style="padding: 0.55rem 1.2rem; font-size: 0.9rem;"
                data-slot-book="${esc(slot.id)}" data-exp="${esc(exp.id)}">
          ${slot.is_full ? 'Join waitlist' : 'Book'}
        </button>
      </div>
    `;
    }).join('');
    // seats span is pre-built HTML in the full case, so it is written raw; every other interpolation
    // above is escaped.
    return rows.replace(/&lt;span style="color: var\(--accent-terracotta\); font-weight: 600;"&gt;Full — join the waitlist&lt;\/span&gt;/g, '<span style="color: var(--accent-terracotta); font-weight: 600;">Full — join the waitlist</span>');
}
function bookingRow(b) {
    const statusTone = {
        CONFIRMED: '#2e784a', HOLD: '#b07d2b', PENDING_PAYMENT: '#b07d2b', WAITLIST_OFFERED: '#b07d2b',
        WAITLISTED: '#7a7068', CANCELLED: '#8c7e72', EXPIRED: '#8c7e72', NO_SHOW: '#c85a32', COMPLETED: '#2e784a',
    };
    const tone = statusTone[b.status] || '#7a7068';
    const needsAction = ['HOLD', 'PENDING_PAYMENT', 'WAITLIST_OFFERED'].includes(b.status);
    const funding = b.funding_source === 'ENTITLEMENT'
        ? 'Paid with your subscription credit'
        : b.funding_source === 'PAID'
            ? `${money(b.deposit_cents > 0 ? b.deposit_cents : b.amount_cents, b.currency)} paid`
            : b.status === 'WAITLISTED' ? 'Nothing charged while you wait' : '';
    // Dietary and accessibility notes are customer-authored free text. They go through esc() like
    // everything else here, but they are the field most worth being explicit about.
    const notes = [
        b.dietary_notes ? `Dietary: ${esc(b.dietary_notes)}` : '',
        b.accessibility_notes ? `Accessibility: ${esc(b.accessibility_notes)}` : '',
    ].filter(Boolean).join(' · ');
    const actions = [];
    if (needsAction)
        actions.push(`<button class="btn-primary" style="padding:0.5rem 1.1rem; font-size:0.88rem;" data-bk-confirm="${esc(b.id)}">Confirm</button>`);
    if (b.can_self_manage) {
        actions.push(`<button class="btn-secondary" style="padding:0.5rem 1.1rem; font-size:0.88rem;" data-bk-reschedule="${esc(b.id)}">Reschedule</button>`);
        actions.push(`<button class="btn-secondary" style="padding:0.5rem 1.1rem; font-size:0.88rem;" data-bk-cancel="${esc(b.id)}">Cancel</button>`);
    }
    if (b.status === 'CONFIRMED') {
        actions.push(`<a class="btn-secondary" style="padding:0.5rem 1.1rem; font-size:0.88rem;" href="${esc(icsUrl(b))}">Add to calendar</a>`);
    }
    return `
    <div style="background:#fff; border:1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 1.2rem 1.4rem; margin-bottom: 0.9rem;">
      <div style="display:flex; align-items:baseline; justify-content:space-between; gap:0.8rem; flex-wrap:wrap;">
        <strong style="font-size:1.02rem; color: var(--text-main);">${esc(b.experience_name)}</strong>
        <span style="color:${tone}; font-size:0.74rem; font-weight:700; letter-spacing:0.08em;">${esc(b.status.replace(/_/g, ' '))}</span>
      </div>
      <p style="margin:0.35rem 0 0; color: var(--text-muted); font-size:0.92rem;">
        ${esc(fmtRange(b))}${b.party_size > 1 ? ` · party of ${b.party_size}` : ''}
        ${b.location && b.mode !== 'VIDEO' ? ` · ${esc(b.location)}` : ''}
      </p>
      <p style="margin:0.25rem 0 0; color: var(--text-muted); font-size:0.85rem;">
        Ref ${esc(b.booking_reference)}${funding ? ` · ${esc(funding)}` : ''}
      </p>
      ${notes ? `<p style="margin:0.25rem 0 0; color: var(--text-muted); font-size:0.85rem;">${notes}</p>` : ''}
      ${b.status === 'CONFIRMED' && b.mode === 'VIDEO' && b.meeting_url
        ? `<p style="margin:0.5rem 0 0; font-size:0.92rem;"><a href="${esc(b.meeting_url)}" target="_blank" rel="noopener">Join the video call</a></p>` : ''}
      ${actions.length ? `<div style="display:flex; gap:0.6rem; flex-wrap:wrap; margin-top:0.9rem;">${actions.join('')}</div>` : ''}
    </div>
  `;
}
function icsUrl(b) {
    const base = window.__API_BASE__ || 'https://api.dailyroast.in';
    return `${base}/api/experiences/bookings/${b.id}/calendar.ics?token=${b.ics_token}`;
}
function render() {
    const section = mountFeatureSection(SECTION_ID);
    const upcoming = state.bookings.filter((b) => !['CANCELLED', 'EXPIRED'].includes(b.status));
    section.innerHTML = `
    <div class="section-header">
      <span class="section-label">AT THE ROASTERY & ON THE CALL</span>
      <h2 class="section-title">Experiences You Can Book</h2>
      <p class="section-subtitle">
        Fifteen minutes with a roaster on video, a morning on the roastery floor, a cupping table,
        or three days at origin. All times are India Standard Time.
      </p>
    </div>

    <div id="experiences-toast" role="status" style="display:none; max-width:720px; margin:0 auto 1.6rem; padding:0.85rem 1.2rem; border-radius: var(--radius-lg); font-size:0.94rem; text-align:center;"></div>

    <div class="product-grid" id="experiences-grid">
      ${state.experiences.map(experienceCard).join('')}
    </div>

    ${isSignedIn() ? `
      <div style="max-width: 760px; margin: 3.2rem auto 0;">
        <h3 class="section-title" style="font-size: 1.6rem; text-align:center;">Your Bookings</h3>
        <div id="experiences-bookings" style="margin-top: 1.4rem;">
          ${upcoming.length
        ? upcoming.map(bookingRow).join('')
        : '<p style="text-align:center; color: var(--text-muted);">You have no bookings yet.</p>'}
        </div>
      </div>
    ` : `
      <p style="text-align:center; color: var(--text-muted); margin-top: 2.4rem;">
        Sign in to book an experience and to see the credits included with your subscription.
      </p>
    `}
  `;
    wire(section);
}
// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------
function wire(section) {
    section.querySelectorAll('[data-exp-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-exp-toggle');
            state.openSlotsFor = state.openSlotsFor === id ? null : id;
            render();
        });
    });
    section.querySelectorAll('[data-slot-book]').forEach((btn) => {
        btn.addEventListener('click', () => book(btn.getAttribute('data-exp'), btn.getAttribute('data-slot-book')));
    });
    section.querySelectorAll('[data-bk-confirm]').forEach((btn) => {
        btn.addEventListener('click', () => confirmBooking(btn.getAttribute('data-bk-confirm')));
    });
    section.querySelectorAll('[data-bk-cancel]').forEach((btn) => {
        btn.addEventListener('click', () => cancelBooking(btn.getAttribute('data-bk-cancel')));
    });
    section.querySelectorAll('[data-bk-reschedule]').forEach((btn) => {
        btn.addEventListener('click', () => reschedule(btn.getAttribute('data-bk-reschedule')));
    });
}
async function book(experienceId, slotId) {
    if (!isSignedIn()) {
        toast('Please sign in first — your bookings live in your account.', 'error');
        return;
    }
    if (state.busy)
        return;
    const exp = state.experiences.find((e) => e.id === experienceId);
    if (!exp)
        return;
    let partySize = 1;
    if (exp.mode !== 'VIDEO' && exp.max_party_size > 1) {
        const answer = window.prompt(`How many of you are coming? (1–${exp.max_party_size})`, '1');
        if (answer === null)
            return;
        partySize = Math.max(1, Math.min(parseInt(answer, 10) || 1, exp.max_party_size));
    }
    let dietaryNotes = '';
    let accessibilityNotes = '';
    if (exp.collects_notes) {
        dietaryNotes = window.prompt('Any dietary requirements? (optional)', '') || '';
        accessibilityNotes = window.prompt('Anything we should know to make this accessible for you? (optional)', '') || '';
    }
    state.busy = true;
    // A client-side key means a double tap reuses the held row instead of taking a second seat.
    const idempotencyKey = `sf_${slotId}_${Date.now()}`;
    const res = await apiFetch('/api/experiences/bookings', {
        method: 'POST',
        json: { slotId, partySize, dietaryNotes, accessibilityNotes, idempotencyKey },
    });
    state.busy = false;
    if (!res.success) {
        toast(res.error || 'Could not hold that place.', 'error');
        return;
    }
    if (res.waitlisted) {
        toast('That date is full — you are on the waitlist. We will email you the moment a place opens.');
        await refresh();
        return;
    }
    toast('Place held for 15 minutes. Confirm it below to lock it in.');
    await refresh();
    document.getElementById('experiences-bookings')?.scrollIntoView({ behavior: 'smooth' });
}
async function confirmBooking(bookingId) {
    if (state.busy)
        return;
    state.busy = true;
    const res = await apiFetch(`/api/experiences/bookings/${bookingId}/confirm`, { method: 'POST', json: {} });
    state.busy = false;
    if (!res.success) {
        toast(res.error || 'Could not confirm that booking.', 'error');
        return;
    }
    if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
    }
    toast(res.fundingSource === 'ENTITLEMENT'
        ? 'Booked using your subscription credit. Check your inbox for the calendar invite.'
        : 'Booked. Check your inbox for the calendar invite.');
    await refresh();
}
async function cancelBooking(bookingId) {
    const booking = state.bookings.find((b) => b.id === bookingId);
    const policy = booking?.cancellation_policy ? `\n\n${booking.cancellation_policy}` : '';
    if (!window.confirm(`Cancel this booking?${policy}`))
        return;
    state.busy = true;
    const res = await apiFetch(`/api/experiences/bookings/${bookingId}/cancel`, { method: 'POST', json: {} });
    state.busy = false;
    if (!res.success) {
        toast(res.error || 'Could not cancel that booking.', 'error');
        return;
    }
    toast(res.entitlementRestored
        ? 'Cancelled. Your credit is back on your account.'
        : res.refundStatus === 'REFUNDED'
            ? 'Cancelled and refunded — allow a few working days.'
            : 'Cancelled.');
    await refresh();
}
async function reschedule(bookingId) {
    const booking = state.bookings.find((b) => b.id === bookingId);
    if (!booking)
        return;
    const res = await apiFetch(`/api/experiences/catalog/${encodeURIComponent(booking.experience_id)}`);
    const options = (res.slots || []).filter((s) => s.id !== booking.slot_id && !s.is_full);
    if (!options.length) {
        toast('There are no other open dates right now.', 'error');
        return;
    }
    const menu = options
        .map((s, i) => `${i + 1}. ${booking.is_multi_day ? fmtDate(s.starts_at) : fmtDateTime(s.starts_at)} (${s.seats_available} left)`)
        .join('\n');
    const answer = window.prompt(`Move to which date?\n\n${menu}\n\nEnter a number:`, '1');
    if (answer === null)
        return;
    const choice = options[(parseInt(answer, 10) || 0) - 1];
    if (!choice) {
        toast('That was not one of the options.', 'error');
        return;
    }
    state.busy = true;
    const moved = await apiFetch(`/api/experiences/bookings/${bookingId}/reschedule`, {
        method: 'POST',
        json: { slotId: choice.id },
    });
    state.busy = false;
    if (!moved.success) {
        toast(moved.error || 'Could not move that booking.', 'error');
        return;
    }
    toast('Moved. A fresh confirmation is on its way.');
    await refresh();
}
/**
 * Stripe sends the customer back to the storefront with ?booking_settle=<id>. Verifying the
 * payment here (rather than in routes/webhooks.ts, which belongs to another feature) is what turns
 * the pending booking into a confirmed one.
 */
async function handleReturnFromStripe() {
    const params = new URLSearchParams(window.location.search);
    const settleId = params.get('booking_settle');
    const claimId = params.get('booking_claim');
    if (settleId) {
        const res = await apiFetch(`/api/experiences/bookings/${settleId}/settle`, { method: 'POST', json: {} });
        toast(res.success ? 'Payment received — your place is confirmed.' : (res.error || 'We could not confirm that payment yet.'), res.success ? 'ok' : 'error');
    }
    if (claimId) {
        // Arrived from a waitlist-offer email; the seat is already held, it just needs funding.
        await confirmBooking(claimId);
    }
    if (settleId || claimId) {
        params.delete('booking_settle');
        params.delete('booking_claim');
        const qs = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + '#experiences');
    }
}
async function refresh() {
    const catalog = await apiFetch('/api/experiences');
    state.experiences = catalog.success ? (catalog.experiences || []) : [];
    if (isSignedIn()) {
        const [bookings, balances] = await Promise.all([
            apiFetch('/api/experiences/bookings'),
            apiFetch('/api/experiences/me/entitlements'),
        ]);
        state.bookings = bookings.success ? (bookings.bookings || []) : [];
        state.balances = balances.success ? (balances.balances || []) : [];
    }
    else {
        state.bookings = [];
        state.balances = [];
    }
    render();
}
export function initExperiences(app) {
    void app;
    registerNavPill(SECTION_ID, 'Experiences');
    refresh().then(handleReturnFromStripe).catch((err) => console.error('[experiences] init failed', err));
}
