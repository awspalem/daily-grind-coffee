/**
 * Notification & consent centre (roadmap gap 6.10 / 6.12).
 *
 * This is the *delivery consent* surface: it drives the per-channel checks at the optional-send
 * call sites (`customer_channel_consent`, migration 0030, `GET`/`PUT /api/customer/notifications`)
 * and the explicit Web Push opt-in for this browser.
 *
 * It is deliberately NOT the "Keep in touch" block in the profile feature — that one
 * (`/api/profile/preferences`, Phase 1 `customer_channel_optins`) records what a customer is
 * *interested in* and does not gate any send. The two lists look similar, so this section carries
 * a heading that names the difference.
 *
 * Build all DOM through ./shared.ts helpers; nothing at module top level may touch `document`,
 * `window`, `localStorage` or `Notification` (the API test suite imports this file under Node).
 */
import {
  API_BASE,
  apiFetch,
  esc,
  isSignedIn,
  mountFeatureSection,
  registerNavPill,
  toast,
  urlBase64ToArrayBuffer,
} from './shared';

const SECTION_ID = 'notification-settings';

interface ChannelMeta {
  label: string;
  description: string;
}

/** Human copy for every optional channel the API can return (`OPTIONAL_CHANNELS`). */
const CHANNEL_META: Record<string, ChannelMeta> = {
  marketing_email: {
    label: 'Promotions & offers',
    description: 'Discounts, seasonal sales and campaign emails. Off unless you ask in.',
  },
  product_news: {
    label: 'New arrivals & roastery news',
    description: 'New coffees, limited editions and stories from the roastery. Off unless you ask in.',
  },
  back_in_stock: {
    label: 'Back-in-stock alerts',
    description: 'An email when a coffee you asked about is roasted and available again.',
  },
  push: {
    label: 'Browser push notifications',
    description: 'Order, subscription and booking updates pushed to this device.',
  },
};

const NON_PUSH_ORDER = ['marketing_email', 'product_news', 'back_in_stock'];

interface NotificationState {
  loaded: boolean;
  signedIn: boolean;
  prefs: Record<string, boolean>;
  channels: string[];
  pushSupported: boolean;
  pushConfigured: boolean;
  pushPermission: 'default' | 'granted' | 'denied';
  pushSubscribed: boolean;
  vapidKey: string | null;
}

const state: NotificationState = {
  loaded: false,
  signedIn: false,
  prefs: {},
  channels: [],
  pushSupported: false,
  pushConfigured: false,
  pushPermission: 'default',
  pushSubscribed: false,
  vapidKey: null,
};

let section: HTMLElement | null = null;
let busy = false;

// ---------------------------------------------------------------------------------------
// Rendering — pure: `notificationCentreHtml` takes state and returns a string, so the test
// can assert on the labels and wiring without a DOM.
// ---------------------------------------------------------------------------------------

function panel(inner: string): string {
  return `<div style="background:var(--surface-card, #fff); border:1px solid var(--border-subtle, #e7e0d4); border-radius:var(--radius-md, 12px); padding:1.5rem; max-width:640px; margin:0 auto;">${inner}</div>`;
}

function channelRow(channel: string, meta: ChannelMeta, checked: boolean, disabled: boolean, note: string): string {
  return `<label style="display:flex; gap:0.8rem; align-items:flex-start; padding:0.85rem 0; border-top:1px solid var(--border-subtle, #e7e0d4);">
      <input type="checkbox" data-notif-channel="${esc(channel)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}
        style="margin-top:0.2rem; width:1.1rem; height:1.1rem; flex-shrink:0;">
      <span>
        <span style="font-weight:600; display:block;">${esc(meta.label)}</span>
        <span style="color:var(--text-muted, #7a7266); font-size:0.86rem;">${esc(meta.description)}</span>
        ${note ? `<span style="color:var(--text-muted, #7a7266); font-size:0.82rem; display:block; margin-top:0.2rem; font-style:italic;">${esc(note)}</span>` : ''}
      </span>
    </label>`;
}

export function notificationCentreHtml(s: NotificationState): string {
  if (!s.signedIn) {
    return panel('<p style="color:var(--text-muted, #7a7266); margin:0;">Sign in to manage which notifications we send you.</p>');
  }
  if (!s.loaded) {
    return panel('<p style="color:var(--text-muted, #7a7266); margin:0;">Loading your notification settings…</p>');
  }

  const rows = NON_PUSH_ORDER
    .filter((ch) => s.channels.includes(ch))
    .map((ch) => channelRow(ch, CHANNEL_META[ch], !!s.prefs[ch], false, ''))
    .join('');

  // Push reflects BOTH the consent row AND this browser's actual subscription state.
  const pushChecked = !!s.prefs.push && s.pushPermission === 'granted' && s.pushSubscribed;
  let pushNote = '';
  let pushDisabled = false;
  if (!s.pushSupported) {
    pushDisabled = true;
    pushNote = 'Not available — this browser does not support push notifications.';
  } else if (!s.pushConfigured) {
    pushDisabled = true;
    pushNote = 'Not available right now — push delivery is not configured.';
  } else if (s.pushPermission === 'denied') {
    pushNote = 'Blocked in your browser settings. Allow notifications for this site to turn this on.';
  }
  const pushRow = s.channels.includes('push')
    ? channelRow('push', CHANNEL_META.push, pushChecked, pushDisabled, pushNote)
    : '';

  return panel(`
    <div style="margin-bottom:0.4rem;">
      <span class="section-label" style="letter-spacing:0.12em; text-transform:uppercase; font-size:0.72rem; color:var(--accent-terracotta, #b5623f); font-weight:700;">Your Account</span>
      <h2 style="font-family:var(--font-serif, Georgia, serif); font-size:1.5rem; margin:0.3rem 0 0.4rem;">Notification Settings</h2>
      <p style="color:var(--text-muted, #7a7266); font-size:0.9rem; margin:0;">
        Delivery consent for optional messages. Order confirmations and other transactional email are always sent.
        (Your browsing interests live under <em>Keep in touch</em> in Your Coffee Profile.)
      </p>
    </div>
    ${rows}
    ${pushRow}
  `);
}

function render(): void {
  if (!section) return;
  state.signedIn = isSignedIn();
  section.innerHTML = notificationCentreHtml(state);
}

// ---------------------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------------------

function probePushEnvironment(): void {
  state.pushSupported =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    typeof Notification !== 'undefined';
  state.pushPermission = state.pushSupported ? Notification.permission : 'default';
}

/**
 * `navigator.serviceWorker.ready` never settles when registration fails to activate (blocked,
 * insecure origin) — it does not reject, so a bare `await` hangs forever. Race it against a
 * timeout so a broken SW degrades to "not subscribed" instead of a permanent spinner / locked
 * toggles.
 */
async function serviceWorkerReady(timeoutMs = 3000): Promise<ServiceWorkerRegistration | null> {
  if (!state.pushSupported) return null;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((res) => setTimeout(() => res(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

async function refreshSubscriptionState(): Promise<void> {
  state.pushSubscribed = false;
  const reg = await serviceWorkerReady();
  if (!reg) return;
  try {
    const sub = await reg.pushManager.getSubscription();
    state.pushSubscribed = !!sub;
  } catch {
    state.pushSubscribed = false;
  }
}

async function loadAll(): Promise<void> {
  state.signedIn = isSignedIn();
  if (!state.signedIn) {
    state.loaded = false;
    render();
    return;
  }

  const res = await apiFetch<{ channels: string[]; preferences: Record<string, boolean> }>(
    '/api/customer/notifications'
  );
  if (res.success) {
    state.channels = res.channels || [];
    state.prefs = res.preferences || {};
  }

  probePushEnvironment();

  try {
    const keyRes = await fetch(`${API_BASE}/api/customer/push/vapid-key`);
    if (keyRes.ok) {
      const body = (await keyRes.json()) as { vapid_public_key?: string };
      state.vapidKey = body.vapid_public_key || null;
      state.pushConfigured = !!state.vapidKey;
    } else {
      state.pushConfigured = false;
    }
  } catch {
    state.pushConfigured = false;
  }

  // Paint now; the subscription probe can be slow (or a broken SW makes it time out) and must
  // not hold the whole section on a spinner.
  state.loaded = true;
  render();

  await refreshSubscriptionState();
  render();
}

// ---------------------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------------------

async function putConsent(channel: string, value: boolean): Promise<boolean> {
  const res = await apiFetch<{ preferences: Record<string, boolean> }>('/api/customer/notifications', {
    method: 'PUT',
    json: { preferences: { [channel]: value } },
  });
  if (res.success) {
    state.prefs = res.preferences || { ...state.prefs, [channel]: value };
    return true;
  }
  return false;
}

async function onNonPushChange(channel: string, checkbox: HTMLInputElement): Promise<void> {
  const desired = checkbox.checked;
  checkbox.disabled = true;
  const ok = await putConsent(channel, desired);
  checkbox.disabled = false;
  if (ok) {
    toast(`${CHANNEL_META[channel].label}: ${desired ? 'on' : 'off'}`, 'success');
  } else {
    checkbox.checked = !desired; // revert
    toast('Could not save that change. Please try again.', 'error');
  }
}

async function enablePush(checkbox: HTMLInputElement): Promise<void> {
  if (!state.pushSupported || !state.pushConfigured) {
    checkbox.checked = false;
    toast('Push notifications are not available on this device right now.', 'error');
    return;
  }
  if (Notification.permission === 'denied') {
    checkbox.checked = false;
    toast(
      'Notifications are blocked for this site. Turn them back on in your browser settings, then try again.',
      'error',
      6000
    );
    return;
  }

  const permission = await Notification.requestPermission();
  state.pushPermission = permission;
  if (permission !== 'granted') {
    checkbox.checked = false;
    toast('Push stays off until you allow notifications for this site.', 'info');
    return;
  }

  try {
    const reg = await serviceWorkerReady();
    if (!reg) throw new Error('service worker unavailable');
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(state.vapidKey as string),
      }));

    const savedSub = await apiFetch('/api/customer/push/subscribe', {
      method: 'POST',
      json: { subscription: sub.toJSON() },
    });
    const savedConsent = await putConsent('push', true);
    if (!savedSub.success || !savedConsent) throw new Error('save failed');

    toast('Push notifications are on for this device.', 'success');
  } catch {
    checkbox.checked = false;
    toast('Could not turn on push notifications. Please try again.', 'error');
  } finally {
    await refreshSubscriptionState();
    render();
  }
}

async function disablePush(checkbox: HTMLInputElement): Promise<void> {
  try {
    const reg = await serviceWorkerReady();
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await apiFetch('/api/customer/push/unsubscribe', { method: 'POST', json: { endpoint } });
      }
    }
    await putConsent('push', false);
    toast('Push notifications are off for this device.', 'success');
  } catch {
    checkbox.checked = true;
    toast('Could not turn off push notifications. Please try again.', 'error');
  } finally {
    await refreshSubscriptionState();
    render();
  }
}

function onSectionChange(event: Event): void {
  const target = event.target as HTMLElement | null;
  if (!target || target.tagName !== 'INPUT') return;
  const checkbox = target as HTMLInputElement;
  const channel = checkbox.dataset.notifChannel;
  if (!channel) return;
  if (busy) {
    // A save is already in flight — undo the visual flip the browser just did so the box never
    // shows a state that was never persisted.
    checkbox.checked = !checkbox.checked;
    return;
  }

  busy = true;
  const done = () => {
    busy = false;
  };

  if (channel === 'push') {
    (checkbox.checked ? enablePush(checkbox) : disablePush(checkbox)).finally(done);
  } else {
    onNonPushChange(channel, checkbox).finally(done);
  }
}

// ---------------------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------------------

export function initNotifications(_app: unknown): void {
  section = mountFeatureSection(SECTION_ID);
  registerNavPill(SECTION_ID, 'Notification Settings');
  section.addEventListener('change', onSectionChange);

  void loadAll();

  // main.ts owns sign-in and this feature may not touch it; mirror the profile feature's poll.
  let wasSignedIn = isSignedIn();
  const resyncIfSessionChanged = () => {
    const nowSignedIn = isSignedIn();
    if (nowSignedIn !== wasSignedIn) {
      wasSignedIn = nowSignedIn;
      void loadAll();
    }
  };
  window.addEventListener('focus', resyncIfSessionChanged);
  window.addEventListener('storage', resyncIfSessionChanged);
  setInterval(resyncIfSessionChanged, 5000);
}
