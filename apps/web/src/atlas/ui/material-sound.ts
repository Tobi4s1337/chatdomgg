/** Short, quiet material cues for the Atlas's own controls. No context exists until a gesture asks for a cue. */
export type AtlasMaterialCue = 'press' | 'shutter' | 'wax';
export interface AtlasMaterialSoundOptions {
  now?: () => number;
  contextFactory?: () => AudioContext;
  /** Runs `run` once the gesture's answer has been painted; returns a cancel. */
  afterPaint?: (run: () => void) => () => void;
}
interface Voice { stop(): void }
interface Intent { kind: AtlasMaterialCue; at: number }
const MIN_GAP_MS = 40;
const MAX_RESUME_AGE_MS = 160;
/** The very first cue waits for its answer to be painted before the device opens, so it may arrive a little later. */
const FIRST_CUE_MAX_AGE_MS = 450;
const MAX_VOICES = 3;

/** A press that never becomes a click (a drag, a cancelled touch) stops waiting for one after this long. */
const CLICK_WAIT_MS = 400;

/**
 * After the gesture's answer is on screen: a pointerdown is answered by its click, which can come a finger-lift
 * later, so this waits for the click, lets two frames paint what it opened, then runs when the page is next idle.
 */
function browserAfterPaint(run: () => void): () => void {
  if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') {
    const timer = setTimeout(run, 16);
    return () => clearTimeout(timer);
  }
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idle: number | undefined;
  let waiting = true;
  const answered = () => {
    if (!waiting) return;
    waiting = false;
    window.removeEventListener('click', answered, true);
    clearTimeout(timer);
    // A card can mount a step after its click, so the device also waits for the first idle moment after two frames.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(run, { timeout: 200 });
        else timer = setTimeout(run, 0);
      });
    });
  };
  window.addEventListener('click', answered, true);
  timer = setTimeout(answered, CLICK_WAIT_MS);
  return () => {
    waiting = false;
    window.removeEventListener('click', answered, true);
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    if (idle !== undefined && typeof cancelIdleCallback === 'function') cancelIdleCallback(idle);
  };
}

function browserContext(): AudioContext {
  if (typeof AudioContext === 'undefined') throw new Error('Audio is unavailable');
  return new AudioContext({ latencyHint: 'interactive' });
}

/**
 * Opening an audio device can take tens of milliseconds, which must never sit between a tap and the card it opens.
 * A gesture that opens nothing (a tap into the search field, a key) primes the context ahead of time; when the very
 * first gesture is itself a selection, the context is opened after the answering frame is painted and the cue follows.
 *
 * A tap has a hollow wooden body, a shutter has a soft grainy scrape, and wax lands with a lower, padded thud.
 * Each strike varies its resonance and grain deterministically. These are interface sounds, never map activity.
 */
export class AtlasMaterialSound {
  private readonly now: () => number;
  private readonly contextFactory: () => AudioContext;
  private readonly afterPaint: (run: () => void) => () => void;
  private opening = false;
  private cancelOpening: (() => void) | null = null;
  private context: AudioContext | null = null;
  private voices: Voice[] = [];
  private pending: Intent | null = null;
  private resuming: Promise<void> | null = null;
  private lastAt = -Infinity;
  private serial = 0;
  private stopped = false;
  private unavailable = false;
  private silent = false;

  constructor(options: AtlasMaterialSoundOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.contextFactory = options.contextFactory ?? browserContext;
    this.afterPaint = options.afterPaint ?? browserAfterPaint;
  }

  get muted(): boolean { return this.silent; }

  setMuted(muted: boolean): void {
    this.silent = muted;
    if (muted) {
      this.pending = null;
      this.stopVoices();
    }
  }

  /**
   * Call from a real gesture that opens nothing (a tap into the search field, a key): the context is opened now,
   * inside the gesture, so the next cue is struck at once. Nothing sounds.
   */
  prime(): void {
    if (this.stopped || this.silent || this.unavailable || this.context) return;
    const context = this.open();
    if (context && context.state === 'suspended') {
      try { void context.resume().catch(() => {}); } catch { /* A later gesture tries again. */ }
    }
  }

  /** Call only from a real control gesture; a hidden embed, timer or live frame must never call this. */
  play(kind: AtlasMaterialCue): void {
    if (this.stopped || this.silent || this.unavailable) return;
    const at = this.now();
    if (at - this.lastAt < MIN_GAP_MS) return;
    this.lastAt = at;
    const context = this.context;
    if (!context) {
      // The first cue waits for the painted answer to its tap; the latest cue asked for in the meantime wins.
      this.pending = { kind, at };
      if (this.opening) return;
      this.opening = true;
      const cancel = this.afterPaint(() => {
        this.opening = false;
        this.cancelOpening = null;
        const intent = this.pending;
        this.pending = null;
        if (!intent || this.stopped || this.silent) return;
        const opened = this.context ?? this.open();
        if (opened && this.now() - intent.at <= FIRST_CUE_MAX_AGE_MS) this.sound(opened, { kind: intent.kind, at: this.now() });
      });
      if (this.opening) this.cancelOpening = cancel;
      return;
    }
    this.sound(context, { kind, at });
  }

  private open(): AudioContext | null {
    try { return (this.context = this.contextFactory()); }
    catch { this.unavailable = true; return null; }
  }

  private sound(context: AudioContext, { kind, at }: Intent): void {
    if (context.state === 'closed') return;
    if (context.state !== 'running') {
      this.pending = { kind, at };
      if (this.resuming) return;
      try {
        this.resuming = context.resume().then(() => {
          const intent = this.pending;
          this.pending = null;
          if (!intent || this.stopped || this.silent || context !== this.context || context.state !== 'running') return;
          // A delayed unlock never replays an old click after the visitor has moved on.
          if (this.now() - intent.at <= MAX_RESUME_AGE_MS) this.strike(context, intent.kind);
        }).catch(() => { this.pending = null; }).finally(() => { this.resuming = null; });
      } catch { this.pending = null; }
      return;
    }
    this.strike(context, kind);
  }

  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.pending = null;
    this.cancelOpening?.();
    this.cancelOpening = null;
    this.opening = false;
    this.stopVoices();
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') {
      try { void context.close().catch(() => {}); } catch { /* A browser may already be closing its audio device. */ }
    }
  }

  private stopVoices(): void {
    for (const voice of [...this.voices]) voice.stop();
  }

  private strike(context: AudioContext, kind: AtlasMaterialCue): void {
    while (this.voices.length >= MAX_VOICES) this.voices[0]!.stop();
    const variation = (++this.serial % 7) / 7;
    const duration = kind === 'shutter' ? 0.23 : kind === 'wax' ? 0.14 : 0.085;
    const body = kind === 'wax' ? 145 : kind === 'shutter' ? 285 : 510;
    const start = context.currentTime;
    const end = start + duration;
    const noise = context.createBufferSource();
    const grain = context.createBuffer(1, Math.max(1, Math.ceil(context.sampleRate * duration)), context.sampleRate);
    const samples = grain.getChannelData(0);
    let seed = Math.imul(this.serial, 0x45d9f3b) | 1;
    for (let i = 0; i < samples.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      samples[i] = ((seed >>> 0) / 0x8000_0000 - 1) * (kind === 'shutter' ? 0.7 : 0.45);
    }
    noise.buffer = grain;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(kind === 'wax' ? 650 : 1_150 + variation * 380, start);
    filter.Q.setValueAtTime(kind === 'shutter' ? 0.7 : 1.25, start);
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(body * (0.93 + variation * 0.14), start);
    oscillator.frequency.exponentialRampToValueAtTime(body * 0.64, end);
    const bodyGain = context.createGain();
    bodyGain.gain.setValueAtTime(kind === 'wax' ? 0.3 : 0.16, start);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(kind === 'wax' ? 0.075 : 0.052, start + 0.003);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    noise.connect(filter); filter.connect(envelope);
    oscillator.connect(bodyGain); bodyGain.connect(envelope);
    envelope.connect(context.destination);
    let ended = false;
    const voice: Voice = { stop: () => {
      if (ended) return;
      ended = true;
      noise.onended = null;
      oscillator.onended = null;
      try { noise.stop(); } catch { /* A scheduled source can already have ended. */ }
      try { oscillator.stop(); } catch { /* A scheduled source can already have ended. */ }
      noise.disconnect(); filter.disconnect(); oscillator.disconnect(); bodyGain.disconnect(); envelope.disconnect();
      const index = this.voices.indexOf(voice);
      if (index >= 0) this.voices.splice(index, 1);
    } };
    this.voices.push(voice);
    noise.onended = () => voice.stop();
    oscillator.onended = () => voice.stop();
    noise.start(start); oscillator.start(start);
    noise.stop(end); oscillator.stop(end);
  }
}
