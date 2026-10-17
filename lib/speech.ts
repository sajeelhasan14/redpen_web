// The tutor's voice, and the student's.
//
// Speech out prefers a neural voice from /api/speak (set ELEVENLABS_API_KEY or
// OPENAI_API_KEY) and falls back to the browser's own synthesis, which on macOS
// means the old system voices. Speech in is the browser's recognizer.
// Every path degrades to silence rather than breaking the lesson.

// Best first. Apple's Siri voices are not exposed to browsers, so the nicest
// available are the newer premium ones; Samantha is the old robot, and last.
const VOICE_RANK = [
  /(ava|allison|susan|zoe|nathan|evan|joelle).*(premium|enhanced)/i,
  /google (uk|us) english/i,
  /^(serena|stephanie|matilda|isha|arthur|martha)\b/i,
  /^(karen|moira|tessa|daniel|catherine|gordon)\b/i,
  /^(flo|sandy|shelley|reed|rocko|eddy)\b/i,
  /samantha/i,
];

/**
 * Chrome returns an empty voice list until `voiceschanged` fires, so the first
 * utterance would fall back to the default voice. Call once at startup.
 */
export function warmVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', () => window.speechSynthesis.getVoices());
}

let muted = false;
/** Everything waiting on speech to finish; stopSpeaking() releases them at once. */
const pending = new Set<() => void>();
/** Whether a neural voice is configured server-side; null until asked. */
let neural: boolean | null = null;
/** The audio element currently playing, so it can be stopped mid-sentence. */
let current: HTMLAudioElement | null = null;
/** Bumped on every stop, so audio that arrives late is discarded. */
let generation = 0;

export function setMuted(m: boolean) {
  muted = m;
  if (m) stopSpeaking();
}
export function isMuted() {
  return muted;
}

async function neuralAvailable() {
  if (neural !== null) return neural;
  try {
    const r = await fetch('/api/speak');
    neural = Boolean(((await r.json()) as { available?: boolean }).available);
  } catch {
    neural = false;
  }
  return neural;
}

/** Fire-and-forget: used where the caller does not wait (a one-line marking). */
export function speak(text: string, onEnd?: () => void) {
  if (muted || !text) {
    onEnd?.();
    return;
  }
  void speakAsync(text).then(() => onEnd?.());
}

/** Fetches one line's audio. Kept as a promise so the next line can be started early. */
function fetchAudio(text: string): Promise<Blob | null> {
  return fetch('/api/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
    .then((r) => (r.ok ? r.blob() : null))
    .catch(() => null);
}

/** The line we have already started generating, so playback does not wait for it. */
let prefetched: { text: string; blob: Promise<Blob | null> } | null = null;

/**
 * Starts generating a line's audio before it is needed. The neural voice takes
 * ~1.8s to first sound, so without this every lesson step would stall.
 */
export function prefetchSpeech(text: string) {
  if (muted || !text || neural === false) return;
  prefetched = { text, blob: fetchAudio(text) };
}

/** Speaks with the neural voice. Resolves true if it actually played. */
async function speakNeural(text: string): Promise<boolean> {
  try {
    const ready = prefetched?.text === text ? prefetched.blob : fetchAudio(text);
    prefetched = null;
    const stamp = generation;
    const blob = await ready;
    if (!blob) return false;
    // Stopped or muted while the audio was still being fetched: say nothing.
    if (muted || stamp !== generation) return true;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    current = audio;
    await new Promise<void>((resolve) => {
      const done = () => {
        URL.revokeObjectURL(url);
        if (current === audio) current = null;
        pending.delete(done);
        resolve();
      };
      // In `pending` so stopSpeaking() releases it: pausing an element fires no
      // event, so without this an interrupted line would hang until it ended.
      pending.add(done);
      audio.onended = done;
      audio.onerror = done;
      audio.onpause = done;
      audio.play().catch(done);
    });
    return true;
  } catch {
    return false;
  }
}

/** The browser's own synthesis, with the least-bad available voice. */
function speakBrowser(text: string): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pending.delete(finish);
      resolve();
    };
    pending.add(finish);

    if (typeof window === 'undefined' || !window.speechSynthesis || !text) return finish();

    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const timer = setTimeout(finish, 600 + words * 380 + 1500);

    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 1.0;
    const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
    const voice = VOICE_RANK.map((re) => voices.find((v) => re.test(v.name))).find(Boolean);
    if (voice) u.voice = voice;
    const end = () => {
      clearTimeout(timer);
      // Let the last word land before the next step starts.
      setTimeout(finish, 250);
    };
    u.onend = end;
    u.onerror = end;
    window.speechSynthesis.speak(u);
  });
}

/** Speaks, resolving when the voice has finished (or been stopped). */
export async function speakAsync(text: string): Promise<void> {
  if (!text) return;
  if (muted) {
    // Still leave reading time so a lesson keeps a human pace.
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    await new Promise<void>((resolve) => {
      const finish = () => {
        pending.delete(finish);
        resolve();
      };
      pending.add(finish);
      setTimeout(finish, Math.min(600 + words * 260, 3000));
    });
    return;
  }
  if (await neuralAvailable()) {
    if (await speakNeural(text)) return;
    neural = false; // the service failed; do not keep trying this session
  }
  await speakBrowser(text);
}

export function stopSpeaking() {
  prefetched = null;
  generation++;
  if (current) {
    current.pause();
    current = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
  // Safari does not fire onend for a cancelled utterance; release waiters ourselves.
  for (const f of Array.from(pending)) f();
}

/** Minimal shape of the (still prefixed in most browsers) Web Speech recognizer. */
interface Recognizer {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export interface PushToTalk {
  supported: boolean;
  /** Start listening. onResult fires with the transcript; onEnd fires when listening stops. */
  start(onResult: (text: string) => void, onEnd: () => void): void;
  /** Stop listening; a pending result is still delivered. */
  stop(): void;
}

export function createRecognizer(): PushToTalk {
  const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
  const Ctor = (w?.SpeechRecognition ?? w?.webkitSpeechRecognition) as (new () => Recognizer) | undefined;
  if (!Ctor) return { supported: false, start: () => {}, stop: () => {} };

  let rec: Recognizer | null = null;
  return {
    supported: true,
    start(onResult, onEnd) {
      rec = new Ctor();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => onResult(e.results[0][0].transcript);
      rec.onerror = () => onEnd();
      rec.onend = () => onEnd();
      rec.start();
    },
    stop() {
      try {
        rec?.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
