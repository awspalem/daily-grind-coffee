/**
 * Notification & consent centre (gap 6.10 / 6.12).
 *
 * The render function is pure (state in, HTML string out), so the channel copy and the push
 * special-casing are pinned here without a DOM. Wiring to the consent API is checked against the
 * module source the way voice.test.ts checks its feature module.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { notificationCentreHtml, pushConsentGranted } from '../src/features/notifications';

function storefrontRoot(): string {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'src', 'features', 'notifications.ts'))) return dir;
    const candidate = join(dir, 'apps', 'storefront');
    if (existsSync(join(candidate, 'src', 'features', 'notifications.ts'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate apps/storefront from ${process.cwd()}`);
}

const SRC = readFileSync(join(storefrontRoot(), 'src', 'features', 'notifications.ts'), 'utf8');

const CHANNELS = ['marketing_email', 'product_news', 'back_in_stock', 'push'];

function baseState(overrides: Record<string, unknown> = {}): any {
  return {
    loaded: true,
    signedIn: true,
    prefs: { marketing_email: false, product_news: false, back_in_stock: true, push: true },
    channels: CHANNELS,
    pushSupported: true,
    pushConfigured: true,
    pushPermission: 'granted',
    pushSubscribed: true,
    vapidKey: 'BKEY',
    ...overrides,
  };
}

test('renders a human label and description for every optional channel', () => {
  const html = notificationCentreHtml(baseState());
  for (const label of [
    'Promotions', // "&" is escaped in the rendered HTML
    'New arrivals',
    'Back-in-stock alerts',
    'Browser push notifications',
  ]) {
    assert.ok(html.includes(label), `missing label: ${label}`);
  }
  // raw channel ids appear only as data attributes, never as visible text between tags
  assert.doesNotMatch(html, /<span[^>]*>[^<]*marketing_email/);
});

test('signed-out state asks the visitor to sign in and renders no toggles', () => {
  const html = notificationCentreHtml(baseState({ signedIn: false }));
  assert.match(html, /[Ss]ign in/);
  assert.ok(!html.includes('data-notif-channel'));
});

test('non-push checkboxes reflect the consent map', () => {
  const html = notificationCentreHtml(baseState());
  assert.match(html, /data-notif-channel="back_in_stock"[^>]*checked/);
  assert.doesNotMatch(html, /data-notif-channel="marketing_email"[^>]*checked/);
});

test('push toggle is only checked when consent AND permission AND a live subscription agree', () => {
  // consent true but nothing subscribed in this browser → off, not on
  const noSub = notificationCentreHtml(baseState({ pushSubscribed: false }));
  assert.doesNotMatch(noSub, /data-notif-channel="push"[^>]*checked/);

  const denied = notificationCentreHtml(baseState({ pushPermission: 'denied', pushSubscribed: false }));
  assert.doesNotMatch(denied, /data-notif-channel="push"[^>]*checked/);
  assert.match(denied, /[Bb]locked in your browser settings/);

  const on = notificationCentreHtml(baseState());
  assert.match(on, /data-notif-channel="push"[^>]*checked/);
});

test('push toggle degrades when unsupported or unconfigured', () => {
  const unsupported = notificationCentreHtml(baseState({ pushSupported: false }));
  assert.match(unsupported, /data-notif-channel="push"[^>]*disabled/);
  assert.match(unsupported, /[Nn]ot available/);

  const unconfigured = notificationCentreHtml(baseState({ pushConfigured: false }));
  assert.match(unconfigured, /data-notif-channel="push"[^>]*disabled/);
});

test('this consent centre is kept visibly distinct from the Phase-1 interests list', () => {
  const html = notificationCentreHtml(baseState());
  assert.match(html, /Keep in touch/);
  assert.match(html, /transactional email are always sent/i);
});

test('the module wires channel changes to PUT /api/customer/notifications', () => {
  assert.match(SRC, /'\/api\/customer\/notifications'/);
  assert.match(SRC, /method:\s*'PUT'/);
  assert.match(SRC, /preferences:\s*\{\s*\[channel\]:\s*value\s*\}/);
});

test('the push toggle requests permission and calls subscribe + unsubscribe routes', () => {
  assert.match(SRC, /Notification\.requestPermission\(\)/);
  assert.match(SRC, /'\/api\/customer\/push\/subscribe'/);
  assert.match(SRC, /'\/api\/customer\/push\/unsubscribe'/);
  assert.match(SRC, /sub\.unsubscribe\(\)/);
});

// ---------------------------------------------------------------------------------------
// Push consent gate — the cross-device half of "don't resurrect a subscription after opt-out"
// ---------------------------------------------------------------------------------------

/** Runs `fn` with localStorage/fetch stubbed, then restores whatever was there before. */
async function withApi(
  respond: (path: string) => unknown,
  fn: () => Promise<void>
): Promise<void> {
  const g = globalThis as any;
  const priorStorage = g.localStorage;
  const priorFetch = g.fetch;
  g.localStorage = { getItem: () => 'sess_test', removeItem: () => {}, setItem: () => {} };
  g.fetch = async (url: string) => {
    const body = respond(String(url));
    if (body === undefined) throw new Error('network down');
    return { status: 200, json: async () => body, clone: () => ({ json: async () => body }) };
  };
  try {
    await fn();
  } finally {
    g.localStorage = priorStorage;
    g.fetch = priorFetch;
  }
}

test('pushConsentGranted is true only when the server says push is explicitly on', async () => {
  await withApi(
    () => ({ success: true, channels: CHANNELS, preferences: { ...baseState().prefs, push: true } }),
    async () => assert.equal(await pushConsentGranted(), true)
  );
});

test('pushConsentGranted is false after an opt-out, and on anything it cannot read as consent', async () => {
  const cases: unknown[] = [
    { success: true, preferences: { push: false } }, // opted out — the case this exists for
    { success: true, preferences: {} },              // channel missing from the map
    { success: true },                               // no map at all
    { success: false, error: 'SESSION_EXPIRED' },    // signed out elsewhere
    undefined,                                       // network failure
  ];
  for (const body of cases) {
    await withApi(
      () => body,
      async () => assert.equal(await pushConsentGranted(), false, `should not be consent: ${JSON.stringify(body)}`)
    );
  }
});

test('the startup push sync re-registers but never creates a subscription, and honours consent', () => {
  const main = readFileSync(join(storefrontRoot(), 'src', 'main.ts'), 'utf8');
  const sync = main.slice(main.indexOf('async syncPushSubscription()'));
  const body = sync.slice(0, sync.indexOf('\n  }\n'));

  assert.ok(body.includes('pushManager.getSubscription()'), 'should read the existing subscription');
  assert.doesNotMatch(body, /pushManager\.subscribe\(/, 'startup must never create a subscription');
  assert.ok(body.includes('pushConsentGranted()'), 'startup must check consent before re-registering');
  // The consent check has to come before the row is written, or it gates nothing.
  assert.ok(
    body.indexOf('pushConsentGranted()') < body.indexOf('/api/customer/push/subscribe'),
    'consent must be checked before POSTing the subscription'
  );
});

// ---------------------------------------------------------------------------------------
// The shared signed-out prompt (features/shared.ts)
// ---------------------------------------------------------------------------------------

test('the notification centre is titled in every state, signed out included', () => {
  const out = notificationCentreHtml(baseState({ signedIn: false }));
  assert.match(out, /Notification Settings/, 'signed-out state must still say what the section is');
  assert.match(out, /data-signin-cta/, 'and offer a button, not an instruction to go find one');

  // The heading is not duplicated once the panel renders.
  const inHtml = notificationCentreHtml(baseState());
  assert.equal(inHtml.match(/Notification Settings/g)?.length, 1);
});

test('the sign-in prompt opens the account modal through the header control', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><body><button id="btn-open-account"></button><div id="host"></div></body>');
  const g = globalThis as any;
  const priorDoc = g.document;
  const priorWin = g.window;
  g.document = dom.window.document;
  g.window = dom.window;
  try {
    const { signInPrompt, initSignInPrompts } = await import('../src/features/shared');
    const host = dom.window.document.getElementById('host')!;
    host.innerHTML = signInPrompt('Sign in to see your points.', 'Sign in');

    let opened = 0;
    dom.window.document.getElementById('btn-open-account')!.addEventListener('click', () => { opened++; });

    initSignInPrompts();
    host.querySelector<HTMLButtonElement>('[data-signin-cta]')!.click();
    assert.equal(opened, 1, 'clicking the prompt should click the header account control');

    // The message is escaped, not injected raw.
    host.innerHTML = signInPrompt('<img src=x onerror=alert(1)>');
    assert.equal(host.querySelector('img'), null);
  } finally {
    g.document = priorDoc;
    g.window = priorWin;
  }
});
