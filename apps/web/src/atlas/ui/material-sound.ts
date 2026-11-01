/** Short, quiet material cues for the Atlas's own controls. No context exists until a gesture asks for a cue. */
export type AtlasMaterialCue = 'press' | 'shutter' | 'wax';
export interface AtlasMaterialSoundOptions {
  now?: () => number;
  contextFactory?: () => AudioContext;
}
interface Voice { stop(): void }
interface Intent { kind: AtlasMaterialCue; at: number }
const MIN_GAP_MS = 40;
const MAX_RESUME_AGE_MS = 160;
const MAX_VOICES = 3;

function browserContext(): AudioContext {
  if (typeof AudioContext === 'undefined') throw new Error('Audio is unavailable');
  return new AudioContext({ latencyHint: 'interactive' });
}

/**
 * A tap has a hollow wooden body, a shutter has a soft grainy scrape, and wax lands with a lower, padded thud.
 * Each strike varies its resonance and grain deterministically. These are interface sounds, never map activity.
 */
export class AtlasMaterialSound {
  private readonly now: () => number;
  private readonly contextFactory: () => AudioContext;
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
  }

  get muted(): boolean { return this.silent; }

  setMuted(muted: boolean): void {
    this.silent = muted;
    if (muted) {
      this.pending = null;
      this.stopVoices();
    }
  }

  /** Call only from a real control gesture; a hidden embed, timer or live frame must never call this. */
  play(kind: AtlasMaterialCue): void {
    if (this.stopped || this.silent || this.unavailable) return;
    const at = this.now();
    if (at - this.lastAt < MIN_GAP_MS) return;
    this.lastAt = at;
    let context = this.context;
    if (!context) {
      try { context = this.context = this.contextFactory(); }
      catch { this.unavailable = true; return; }
    }
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
