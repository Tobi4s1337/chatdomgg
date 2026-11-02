import type { PierCueOptions, PierMood } from './types';

/**
 * The pier's sound rules as plain numbers: placement, loudness, envelopes, the voice limit, the rest clock and how
 * each continuous bed follows the game. Nothing here touches Web Audio, so all of it is tested directly.
 */

/** At most this many one-shots sound at once; a new one takes the place of the oldest. */
export const MAX_VOICES = 12;
/** Scheduling lead so a cue's first milliseconds are never cut by the render quantum. */
export const LEAD_SECONDS = 0.01;
/** A continuous bed that has been asked for silence this long is stopped, so a resting pier costs no audio work. */
export const BED_REST_SECONDS = 2;
/** How long a voice that gives way takes to fade: short enough to free it, long enough never to click. */
export const STEAL_FADE_SECONDS = 0.025;

/** Distance law, the same as the kingdom's own cues: gain = 1 / (1 + distance / 8 m). */
export const DISTANCE_REFERENCE = 8;
/** Air: past a metre the top softens, low-pass at 18 kHz / (1 + distance / 6 m), never below 1.2 kHz. */
export const AIR_REFERENCE = 6;
/** Past this a walker's cue is not played at all: under −17 dB and dull, it would only take a voice. */
export const HEARING_METRES = 56;

export function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

export function clamp01(value: number): number { return clamp(value, 0, 1); }

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function dbToGain(db: number): number { return 10 ** (db / 20); }

export interface Placement {
  /** Distance gain. */
  readonly gain: number;
  readonly pan: number;
  /** Low-pass for the air between, in Hz, or null when the sound is close enough to keep its top. */
  readonly air: number | null;
  /** Multiplier on the cue's reverb send: far sounds are heard more through the open air than directly. */
  readonly wet: number;
}

/** Where a cue sits, or null when it should not play (not finite, or too far away to matter). */
export function placeCue(options: PierCueOptions = {}): Placement | null {
  const distance = options.distance ?? 0, pan = options.pan ?? 0;
  if (!Number.isFinite(distance) || !Number.isFinite(pan)) return null;
  const metres = Math.max(0, distance);
  if (metres > HEARING_METRES) return null;
  const gain = 1 / (1 + metres / DISTANCE_REFERENCE);
  return {
    gain,
    pan: clamp(pan, -1, 1),
    air: metres > 1 ? Math.max(1200, 18000 / (1 + metres / AIR_REFERENCE)) : null,
    wet: 1 + 1.5 * (1 - gain),
  };
}

export interface Shade {
  /** Loudness multiplier: 0.55 (−5 dB) at intensity 0, 1 at 0.5, 1.45 (+3 dB) at 1. */
  readonly level: number;
  /** Filter multiplier: 0.66 at 0, 1 at 0.5, 1.52 at 1 (about ±0.6 octave). */
  readonly bright: number;
  /** Body multiplier for splashes and slaps: bigger fish are lower and longer. 0.7 at 0, 1 at 0.5, 1.3 at 1. */
  readonly size: number;
}

export function shade(intensity?: number): Shade {
  const i = intensity === undefined || !Number.isFinite(intensity) ? 0.5 : clamp01(intensity);
  return { level: 0.55 + 0.9 * i, bright: 2 ** ((i - 0.5) * 1.2), size: 0.7 + 0.6 * i };
}

/** The time constant of an exponential fall that is `db` down after `seconds`. */
export function tauFor(seconds: number, db = 60): number {
  return seconds / ((db / 20) * Math.LN10);
}

/** How long an exponential fall with time constant `tau` takes to be `db` down. */
export function tailFor(tau: number, db = 70): number {
  return tau * (db / 20) * Math.LN10;
}

/** A linear attack to `peak`, then an exponential fall with time constant `tau`: the shape every strike uses. */
export function envelopeAt(time: number, attack: number, peak: number, tau: number): number {
  if (!(time >= 0)) return 0;
  const rise = Math.max(attack, 0.001);
  if (time < rise) return (peak * time) / rise;
  return peak * Math.exp(-(time - rise) / tau);
}

/** A raised-cosine swell from 0 to `peak` in `points` steps: no corner at either end. */
export function swellCurve(peak: number, points = 33): Float32Array {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) curve[i] = peak * (0.5 - 0.5 * Math.cos((Math.PI * i) / (points - 1)));
  return curve;
}

/** Never the same take twice in a row. */
export function nextVariation(last: number | undefined, count: number, random: () => number): number {
  if (count < 2) return 0;
  if (last === undefined || last < 0 || last >= count) return Math.floor(random() * count) % count;
  return (last + 1 + (Math.floor(random() * (count - 1)) % (count - 1))) % count;
}

/** One-shots in the order they started. Admitting past the limit hands back the oldest, which must give way. */
export class VoicePool<T> {
  private readonly order: T[] = [];

  constructor(readonly limit = MAX_VOICES) {
    if (!(limit >= 1)) throw new RangeError('pier sound: a voice pool needs room for one voice');
  }

  get size(): number { return this.order.length; }

  /** Adds `voice`; answers the voice that has to make room, if any. */
  admit(voice: T): T | undefined {
    if (this.order.includes(voice)) return undefined;
    this.order.push(voice);
    return this.order.length > this.limit ? this.order.shift() : undefined;
  }

  release(voice: T): void {
    const index = this.order.indexOf(voice);
    if (index >= 0) this.order.splice(index, 1);
  }

  /** Empties the pool and answers every voice that was in it, oldest first. */
  clear(): T[] { return this.order.splice(0); }
}

/** A bed's rest clock: answers true once the bed has been unwanted for `rest` seconds of audio time. */
export class RestClock {
  private quietSince = Number.NaN;

  constructor(readonly rest = BED_REST_SECONDS) {}

  update(wanted: boolean, now: number): boolean {
    if (wanted || !Number.isFinite(now)) { this.quietSince = Number.NaN; return false; }
    if (Number.isNaN(this.quietSince)) this.quietSince = now;
    return now - this.quietSince >= this.rest;
  }

  reset(): void { this.quietSince = Number.NaN; }
}

/** How the reel's check sounds at a winding rate. Written into a reused object so a frame allocates nothing. */
export interface ReelShape {
  /** Level of the ratchet's clicks. */
  click: number;
  /** Clicks per second. */
  clickHz: number;
  /** The pawl's ring, Hz. */
  pawlHz: number;
  /** Level of the spool turning and the line laying on. */
  whirr: number;
  whirrHz: number;
}

export function emptyReelShape(): ReelShape { return { click: 0, clickHz: 6, pawlHz: 2200, whirr: 0, whirrHz: 280 }; }

export function reelShape(rate: number, into: ReelShape): ReelShape {
  const r = clamp01(rate);
  into.click = r > 0 ? 0.2 * r ** 0.55 : 0;
  into.clickHz = 6 + 32 * r;
  into.pawlHz = 2200 + 650 * r;
  into.whirr = 0.08 * r;
  into.whirrHz = 280 + 520 * r;
  return into;
}

/** The line and rod under load. */
export interface TensionShape {
  /** The willow's creak: level and stick-slip rate. */
  creak: number;
  creakHz: number;
  /** The line singing under strain: level and pitch. */
  strain: number;
  strainHz: number;
  /** How hard the strain trembles just before it gives (0..1). */
  tremble: number;
}

export function emptyTensionShape(): TensionShape { return { creak: 0, creakHz: 12, strain: 0, strainHz: 900, tremble: 0 }; }

export function tensionShape(value: number, into: TensionShape): TensionShape {
  const t = clamp01(value);
  into.creak = 0.09 * smoothstep(0.08, 0.8, t);
  into.creakHz = 12 + 30 * t;
  into.strain = 0.045 * t ** 2.2;
  into.strainHz = 900 + 1900 * t ** 1.5;
  into.tremble = smoothstep(0.72, 1, t);
  return into;
}

/**
 * The lantern's warmth by the hour: the same law as the town's window glow, so the hum is there exactly when the
 * panes are lit (nothing before 16:12, full from 18:30 to 05:30).
 */
export function lanternWarmth(hour: number): number {
  const h = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 12;
  return smoothstep(4.2, 6.5, Math.abs(h - 12));
}

/** Every layer of the pier bed for one moment. */
export interface AmbienceShape {
  /** Water lapping at the piles. */
  lap: number;
  /** Its top: mist muffles it, wind brightens it. */
  lapTone: number;
  /** Its playback rate: livelier in a breeze, slower and heavier in mist. */
  lapRate: number;
  /** Rain on the water and the deck. */
  rain: number;
  /** Breeze over the water and through the rails. */
  breeze: number;
  /** Mist's hush: a low, close softness. */
  mist: number;
  /** The lantern's flame. */
  lantern: number;
}

export function emptyAmbienceShape(): AmbienceShape { return { lap: 0, lapTone: 5200, lapRate: 1, rain: 0, breeze: 0, mist: 0, lantern: 0 }; }

interface MoodMix { lap: number; tone: number; rate: number; rain: number; breeze: number; mist: number; lantern: number }

const MOODS: Readonly<Record<PierMood, MoodMix>> = {
  clear: { lap: 1, tone: 5200, rate: 1, rain: 0, breeze: 0.22, mist: 0, lantern: 1 },
  breeze: { lap: 1.22, tone: 6800, rate: 1.1, rain: 0, breeze: 1, mist: 0, lantern: 0.85 },
  mist: { lap: 0.78, tone: 1500, rate: 0.93, rain: 0, breeze: 0, mist: 1, lantern: 1 },
  rain: { lap: 0.85, tone: 3800, rate: 1.04, rain: 1, breeze: 0.4, mist: 0, lantern: 0.7 },
};

export function ambienceShape(near: number, mood: PierMood, hour: number, into: AmbienceShape): AmbienceShape {
  const n = clamp01(near), mix = MOODS[mood] ?? MOODS.clear;
  into.lap = 0.11 * n * mix.lap;
  into.lapTone = mix.tone;
  into.lapRate = mix.rate;
  // Weather is all around, but the bed belongs to the pier: it still fades out completely as you walk away.
  into.rain = 0.085 * n ** 0.7 * mix.rain;
  into.breeze = 0.05 * n ** 0.8 * mix.breeze;
  into.mist = 0.045 * n * mix.mist;
  // The flame is small: it is only heard close by.
  into.lantern = 0.048 * n * n * lanternWarmth(hour) * mix.lantern;
  return into;
}

/** A small deterministic generator (mulberry32) for textures and tests. */
export function seeded(seed: number): () => number {
  // The state lives in a typed array: a captured number above 2^30 would be re-boxed on every draw.
  const state = new Uint32Array([seed >>> 0]);
  return () => {
    const t0 = (state[0] = (state[0]! + 0x6d2b79f5) >>> 0);
    let t = Math.imul(t0 ^ (t0 >>> 15), t0 | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same cue twice within this window is one sound, unless the newer one is clearly (3 dB) nearer. */
export const COALESCE_SECONDS = 0.03;

/** Whether a cue at `now` with placement `gain` repeats one that started at `lastAt` with `lastGain`. */
export function coalesces(lastAt: number | undefined, lastGain: number, now: number, gain: number): boolean {
  return lastAt !== undefined && now - lastAt >= 0 && now - lastAt < COALESCE_SECONDS && gain < lastGain * Math.SQRT2;
}
