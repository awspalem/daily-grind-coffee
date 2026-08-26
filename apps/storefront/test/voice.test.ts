/**
 * Voice input for Maya.
 *
 * The capture path needs a real microphone and a secure origin, so what is pinned here is
 * everything around it: the text a synthesiser is handed, the format negotiation, and the
 * promise that voice is strictly additive — every failure mode must leave the typed chat
 * exactly as it is today.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { speakableText } from '../src/features/voice';

function storefrontRoot(): string {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'index.html')) && existsSync(join(dir, 'src', 'features', 'voice.ts'))) return dir;
    const candidate = join(dir, 'apps', 'storefront');
    if (existsSync(join(candidate, 'index.html'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate apps/storefront from ${process.cwd()}`);
}

const ROOT = storefrontRoot();
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const VOICE = readFileSync(join(ROOT, 'src', 'features', 'voice.ts'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');

test('voice: markdown is not read aloud as punctuation', () => {
  // Maya answers in markdown. A synthesiser handed it raw says "asterisk asterisk Chikmagalur
  // asterisk asterisk", which is the single most obvious way this feature can sound broken.
  const spoken = speakableText('Try **Chikmagalur Attikan** — a _honey_ process with `1:16` ratio.');
  assert.doesNotMatch(spoken, /[*_`#]/);
  assert.ok(spoken.includes('Chikmagalur Attikan'));
  assert.ok(spoken.includes('1:16'));
});

test('voice: emoji are dropped rather than verbalised', () => {
  const spoken = speakableText('☕ Our Ethiopia Yirgacheffe 🌸 is floral.');
  assert.doesNotMatch(spoken, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  assert.ok(spoken.includes('Ethiopia Yirgacheffe'));
});

test('voice: rupee amounts are spoken as money, not as a symbol', () => {
  assert.match(speakableText('That bag is ₹426.'), /rupees 426/);
});

test('voice: links are read as their text, not their URL', () => {
  const spoken = speakableText('See [our Attikan lot](https://dailyroast.in/coffee/chikmagalur-attikan-estate-honey).');
  assert.ok(spoken.includes('our Attikan lot'));
  assert.doesNotMatch(spoken, /https?:/);
});

test('voice: code blocks and tables do not get read out', () => {
  const spoken = speakableText('Recipe:\n```\n20g coffee\n```\n| a | b |');
  assert.doesNotMatch(spoken, /```/);
  assert.doesNotMatch(spoken, /\|/);
});

test('voice: an empty or markup-only reply produces nothing to speak', () => {
  assert.equal(speakableText('**  **'), '');
  assert.equal(speakableText(''), '');
});

// ------------------------------------------------------------------ the additive-only promise

test('voice: the mic button ships hidden and is only revealed after feature detection', () => {
  // Rendering a mic that fails when pressed is worse than not offering one.
  assert.match(HTML, /id="agent-mic-btn"[^>]*\bhidden\b/);
  assert.match(MAIN, /voice\.canRecord\(\)/);
  assert.match(MAIN, /mic\.hidden = false/);
});

test('voice: the speak toggle ships hidden too', () => {
  assert.match(HTML, /id="agent-speak-toggle"[^>]*\bhidden\b/);
  assert.match(MAIN, /voice\.canSpeak\(\)/);
});

test('voice: recording requires a secure context, because getUserMedia does', () => {
  assert.match(VOICE, /isSecureContext/);
});

test('voice: the microphone is always released, including on the failure paths', () => {
  // A stream left live keeps the browser's recording indicator on after the UI says it stopped.
  const release = /const release = \(\) => \{[\s\S]*?\}/.exec(VOICE);
  assert.ok(release, 'expected a single release() that stops the tracks');
  assert.match(release![0], /track\.stop\(\)/);
  for (const evt of ['stop', 'error']) {
    assert.match(VOICE, new RegExp(`addEventListener\\('${evt}'[\\s\\S]{0,80}release\\(\\)`),
      `the ${evt} handler must release the microphone`);
  }
});

test('voice: a recording is capped in the client as well as the server', () => {
  assert.match(VOICE, /MAX_RECORDING_MS/);
  assert.match(VOICE, /setTimeout\([\s\S]{0,120}recorder\.stop\(\)/);
});

test('voice: the transcript goes back through the ordinary chat path', () => {
  // One conversation implementation, one history, one escaping path. A separate voice renderer
  // would be a second place for user-supplied text to reach innerHTML.
  assert.match(MAIN, /this\.sendAgentMessage\(result\.text\)/);
  assert.doesNotMatch(VOICE, /innerHTML/);
});

test('voice: transcribe never throws, so a failure cannot break the chat', () => {
  const fn = /export async function transcribe\([\s\S]*?\n\}/.exec(VOICE);
  assert.ok(fn);
  assert.match(fn![0], /catch/);
  assert.match(fn![0], /return \{ error:/);
});

test('voice: the filename extension follows what was actually recorded', () => {
  // MediaRecorder gives webm on Chrome and mp4 on Safari, and Whisper picks its decoder off the
  // extension — hardcoding .webm silently mistranscribes every iPhone.
  assert.match(VOICE, /audio\.type\.split/);
  assert.doesNotMatch(VOICE, /`utterance\.webm`/);
});

test('voice: recording stops before Maya speaks, so she is not recorded talking', () => {
  assert.match(MAIN, /voice\.stopSpeaking\(\);[\s\S]{0,120}startRecording|stopSpeaking\(\); \/\/ never record/);
});
