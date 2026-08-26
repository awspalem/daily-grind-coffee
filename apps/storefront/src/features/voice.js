/**
 * Voice for Maya: press-to-talk capture sent to Groq Whisper, and spoken replies.
 *
 * Two rules shape everything here.
 *
 * First, voice is strictly additive. Every entry point below feature-detects, and a browser
 * without MediaRecorder, a denied microphone, a failed upload and a failed transcription all
 * leave the typed chat behaving exactly as it does today. The mic button is not rendered at all
 * where it cannot work, rather than rendered and then failing when pressed.
 *
 * Second, a transcript is user input like any other. It goes back through the same
 * sendAgentMessage path a typed message uses, so there is one conversation implementation, one
 * escaping path and one history. Nothing here writes to the DOM directly.
 *
 * Press-to-talk rather than always-listening is deliberate and not just a UX preference: iOS
 * Safari will not start capture, or speak, outside a user gesture, and an always-on microphone
 * on a coffee shop's website is not a thing anyone asked for.
 */
/** Formats MediaRecorder can produce, in the order we would rather have them. */
const PREFERRED_MIME = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
];
export function pickMimeType() {
    if (typeof MediaRecorder === 'undefined')
        return null;
    for (const type of PREFERRED_MIME) {
        if (MediaRecorder.isTypeSupported?.(type))
            return type;
    }
    // Safari has historically supported recording while reporting nothing; let it choose.
    return '';
}
export function canRecord() {
    return typeof MediaRecorder !== 'undefined'
        && typeof navigator !== 'undefined'
        && !!navigator.mediaDevices?.getUserMedia
        // getUserMedia is unavailable on insecure origins, so this is a real gate, not a formality.
        && (typeof window === 'undefined' || window.isSecureContext !== false);
}
export function canSpeak() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
}
/** Longest single utterance we will record. Also enforced as a byte cap on the server. */
export const MAX_RECORDING_MS = 45_000;
/**
 * Below this peak amplitude a recording is background noise, not speech.
 *
 * This exists because Whisper does not go quiet on silence — it hallucinates fluent filler.
 * Three seconds of digital silence transcribed as "Thank you." in testing, which would have
 * been posted into the chat as though the person had said it. The server rejects that using the
 * model's own no_speech_prob, but catching it here as well means an empty room never costs an
 * API call and the person gets told immediately instead of after a round trip.
 */
export const SILENCE_PEAK_THRESHOLD = 0.02;
/**
 * Starts capture and resolves the recorded audio when stopped. The caller owns the returned
 * handle; the stream's tracks are always stopped, including on the error paths, because leaving
 * them live keeps the browser's recording indicator on after the UI says it has finished.
 */
export async function startRecording(onStop) {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
    });
    const mimeType = pickMimeType();
    const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    const chunks = [];
    let cancelled = false;
    let timeout;
    // Peak metering. Wrapped because AudioContext is unavailable or blocked in some contexts, and
    // failing to meter must never stop someone recording — it only costs us the silence check.
    let peak = 0;
    let audioCtx = null;
    let meterFrame;
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
            audioCtx = new Ctx();
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);
            const buf = new Float32Array(analyser.fftSize);
            const sample = () => {
                analyser.getFloatTimeDomainData(buf);
                for (let i = 0; i < buf.length; i++) {
                    const v = Math.abs(buf[i]);
                    if (v > peak)
                        peak = v;
                }
                meterFrame = requestAnimationFrame(sample);
            };
            sample();
        }
    }
    catch { /* metering is optional */ }
    const release = () => {
        if (timeout)
            clearTimeout(timeout);
        if (meterFrame !== undefined)
            cancelAnimationFrame(meterFrame);
        audioCtx?.close().catch(() => { });
        for (const track of stream.getTracks())
            track.stop();
    };
    recorder.addEventListener('dataavailable', (e) => {
        if (e.data?.size > 0)
            chunks.push(e.data);
    });
    recorder.addEventListener('stop', () => {
        release();
        if (cancelled)
            return onStop(null);
        const type = recorder.mimeType || mimeType || 'audio/webm';
        onStop(new Blob(chunks, { type }));
    });
    recorder.addEventListener('error', () => {
        release();
        onStop(null, 'Recording failed');
    });
    recorder.start();
    // A stuck recording is a hot microphone and, eventually, a rejected upload. Cap it here too.
    timeout = setTimeout(() => {
        if (recorder.state === 'recording')
            recorder.stop();
    }, MAX_RECORDING_MS);
    return {
        stop: () => { if (recorder.state === 'recording')
            recorder.stop(); },
        cancel: () => { cancelled = true; if (recorder.state === 'recording')
            recorder.stop();
        else
            release(); },
        peakLevel: () => peak,
    };
}
/**
 * Sends one utterance for transcription. Returns the text, or a message safe to show the user.
 * Never throws: the caller's job is to keep the chat usable whatever happened here.
 */
export async function transcribe(apiBase, audio, sessionId) {
    const form = new FormData();
    // The extension matters to Whisper's decoder, and it has to match what was actually recorded.
    const ext = (audio.type.split(';')[0].split('/')[1] || 'webm').replace('mpeg', 'mp3');
    form.append('audio', audio, `utterance.${ext}`);
    try {
        const res = await fetch(`${apiBase}/api/agent/transcribe`, {
            method: 'POST',
            headers: { 'X-Session-Token': sessionId },
            body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            return { error: data.error || 'Could not transcribe that. You can type it instead.' };
        }
        return { text: data.text };
    }
    catch {
        return { error: 'Could not reach the roastery. You can type it instead.' };
    }
}
/**
 * Strips the parts of a reply that are meant to be seen rather than heard. Maya answers in
 * markdown with the occasional emoji, and a synthesiser will happily read "asterisk asterisk
 * Chikmagalur asterisk asterisk" or announce every coffee cup.
 */
export function speakableText(markdown) {
    return (markdown || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_#>]+/g, ' ')
        .replace(/^\s*[-•]\s*/gm, ', ')
        .replace(/\|/g, ' ')
        // Emoji and pictographs, which screen readers and synthesisers verbalise unhelpfully.
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
        .replace(/₹\s?(\d)/g, 'rupees $1')
        .replace(/\s{2,}/g, ' ')
        .trim();
}
let currentUtterance = null;
/** Picks an Indian English voice where one exists, since Maya is a Bangalore barista. */
function pickVoice() {
    const voices = window.speechSynthesis.getVoices?.() || [];
    if (voices.length === 0)
        return null;
    return voices.find((v) => v.lang === 'en-IN')
        || voices.find((v) => v.lang?.startsWith('en-IN'))
        || voices.find((v) => v.lang?.startsWith('en-GB'))
        || voices.find((v) => v.lang?.startsWith('en'))
        || null;
}
export function speak(markdown, onEnd) {
    if (!canSpeak())
        return onEnd?.();
    const text = speakableText(markdown);
    if (!text)
        return onEnd?.();
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 1200));
    const voice = pickVoice();
    if (voice)
        utterance.voice = voice;
    utterance.lang = voice?.lang || 'en-IN';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.addEventListener('end', () => { currentUtterance = null; onEnd?.(); });
    utterance.addEventListener('error', () => { currentUtterance = null; onEnd?.(); });
    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
}
export function stopSpeaking() {
    if (!canSpeak())
        return;
    window.speechSynthesis.cancel();
    currentUtterance = null;
}
export const isSpeaking = () => canSpeak() && window.speechSynthesis.speaking;
