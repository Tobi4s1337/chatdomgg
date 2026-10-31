import { noteHz, type PaletteNote } from '../palette';
import { generator, logRange, range } from './rng';
import type { CallKey } from './scene';
import type { GenesisWeather } from './types';
import type { CueVoice } from './voice';

/**
 * Every one-shot sound of the land, authored as synthesis. A call is built from the event's own seeded generator,
 * so no two calls are the same; `take` is the call's kind (a gull's single cry, its long laughing call, its mew)
 * and never repeats twice in a row (see the conductor). Everything is written into `voice.out` at its authored
 * level; distance, air and pan are applied by the layer afterwards.
 *
 * Creature calls are stylised from field knowledge of each species (pitch range, rhythm, contour), not copied
 * from any recording. Tuned things people made (the bell buoy, the bell garden's chimes) sit in the kingdom's
 * D major pentatonic palette, like the windows and the beacon.
 */
export interface CallContext {
  weather: GenesisWeather;
  night: number;
  /** A per-kingdom seed: each kingdom's blackbird keeps its own phrases. */
  kingdom: number;
}

export interface CallDesign {
  takes: number;
  /** Authored trim in dB, applied on the voice output. */
  level: number;
  build(voice: CueVoice, r: () => number, take: number, context: CallContext): void;
}

interface Note {
  at: number;
  len: number;
  /** Frequency through the note, x in 0..1. */
  f: (x: number) => number;
  amp: number;
  /** Share of the note spent rising; the rest falls as a smooth half-cosine. */
  attack?: number;
}

const POINTS_PER_SECOND = 700;

/**
 * Sings `notes` on one oscillator (plus optional harmonics that follow it): the frequency and amplitude contours
 * of the whole phrase are written as two curves, so a phrase of twenty notes costs one source per partial.
 */
function sing(voice: CueVoice, notes: readonly Note[], type: OscillatorType, target: AudioNode,
  options: { harmonics?: readonly number[]; vibrato?: { hz: number; depth: number }; delay?: number } = {}): void {
  if (notes.length === 0) return;
  const start = voice.t + (options.delay ?? 0);
  const total = Math.max(...notes.map(note => note.at + note.len)) + 0.02;
  const count = Math.max(8, Math.ceil(total * POINTS_PER_SECOND));
  const frequency = new Float32Array(count), amplitude = new Float32Array(count);
  let held = notes[0]!.f(0);
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * total;
    let level = 0;
    for (const note of notes) {
      if (t < note.at || t > note.at + note.len) continue;
      const x = (t - note.at) / note.len, attack = note.attack ?? 0.12;
      held = note.f(x);
      level = note.amp * (x < attack ? Math.sin((Math.PI / 2) * (x / attack)) : 0.5 + 0.5 * Math.cos((Math.PI * (x - attack)) / (1 - attack)));
      break;
    }
    const vibrato = options.vibrato ? 1 + options.vibrato.depth * Math.sin(2 * Math.PI * options.vibrato.hz * t) : 1;
    frequency[i] = held * vibrato;
    amplitude[i] = level;
  }
  const partials = [1, ...(options.harmonics ?? [])];
  partials.forEach((share, index) => {
    if (share <= 0) return;
    const osc = voice.osc(type, frequency[0]! * (index + 1), start, start + total + 0.01);
    const multiple = index + 1;
    osc.frequency.setValueCurveAtTime(multiple === 1 ? frequency : frequency.map(value => value * multiple), start, total);
    const amp = voice.gain(0);
    amp.gain.setValueCurveAtTime(share === 1 ? amplitude : amplitude.map(value => value * share), start, total);
    voice.chain(osc, amp, target);
  });
}

/** Coloured noise shaped by an amplitude contour (and optionally a moving band), for splashes, flutter and rumble. */
function breath(voice: CueVoice, total: number, amp: (t: number) => number, target: AudioNode,
  options: { colour?: 'white' | 'pink' | 'brown'; type?: BiquadFilterType; band?: (t: number) => number; q?: number; delay?: number } = {}): void {
  const start = voice.t + (options.delay ?? 0);
  const count = Math.max(8, Math.ceil(total * POINTS_PER_SECOND));
  const amplitude = new Float32Array(count), band = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * total;
    amplitude[i] = Math.max(0, amp(t));
    band[i] = options.band ? options.band(t) : 1000;
  }
  const filter = voice.filter(options.type ?? 'bandpass', band[0]!, options.q ?? 0.8);
  if (options.band) filter.frequency.setValueCurveAtTime(band, start, total);
  const gain = voice.gain(0);
  gain.gain.setValueCurveAtTime(amplitude, start, total);
  voice.chain(voice.noise(start, start + total + 0.01, options.colour ?? 'white'), filter, gain, target);
}

/** A decaying partial: struck metal, wood, a bell. */
function ring(voice: CueVoice, frequency: number, at: number, peak: number, tau: number, target: AudioNode, type: OscillatorType = 'sine'): void {
  const start = voice.t + at, amp = voice.gain(0);
  voice.envelope(amp.gain, start, 0.002, peak, tau);
  voice.chain(voice.osc(type, frequency, start, start + 0.002 + tau * 7), amp, target);
}

const glide = (from: number, to: number, curve = 1) => (x: number) => from + (to - from) * x ** curve;
const arch = (from: number, peak: number, to: number, top = 0.3) => (x: number) =>
  x < top ? from + (peak - from) * Math.sin((Math.PI / 2) * (x / top)) : peak + (to - peak) * ((x - top) / (1 - top)) ** 1.3;

// ---------------------------------------------------------------------------------------------------------------
// Sea and shore birds
// ---------------------------------------------------------------------------------------------------------------

const gull: CallDesign = {
  takes: 3, level: -3,
  build(voice, r, take) {
    // A nasal, harmonic-rich cry: a sawtooth through the gull's throat formant and a soft breath.
    const throat = voice.filter('bandpass', range(r(), 1500, 2100), 1.6), soften = voice.filter('lowpass', 4600, 0.7);
    voice.chain(throat, soften, voice.out);
    const f = range(r(), 640, 860), notes: Note[] = [];
    if (take === 0) {
      const count = 1 + Math.floor(r() * 2);
      for (let i = 0; i < count; i++) notes.push({ at: i * range(r(), 0.42, 0.6), len: range(r(), 0.32, 0.46), f: arch(f * 0.78, f * 1.08, f * 0.8, 0.18), amp: 0.9 - i * 0.15, attack: 0.1 });
    } else if (take === 1) {
      // The long call: a rising scream, then a laughing run that hurries and falls.
      notes.push({ at: 0, len: 0.5, f: arch(f * 0.75, f * 1.18, f * 1.05, 0.5), amp: 0.85, attack: 0.3 });
      let at = 0.62, gap = 0.2;
      const count = 6 + Math.floor(r() * 5);
      for (let i = 0; i < count; i++) {
        const pitch = f * (1.08 - (i / count) * 0.28) * range(r(), 0.97, 1.03);
        notes.push({ at, len: range(r(), 0.1, 0.15), f: arch(pitch * 0.85, pitch, pitch * 0.82, 0.25), amp: 0.8 - (i / count) * 0.35, attack: 0.2 });
        at += gap; gap = Math.max(0.135, gap * 0.95);
      }
    } else {
      const count = 2 + Math.floor(r() * 2);
      for (let i = 0; i < count; i++) notes.push({ at: i * range(r(), 0.3, 0.5), len: range(r(), 0.18, 0.28), f: glide(f * 1.2, f * 0.92), amp: 0.55, attack: 0.35 });
    }
    sing(voice, notes, 'sawtooth', throat, { vibrato: { hz: range(r(), 22, 30), depth: 0.012 } });
    const last = notes[notes.length - 1]!;
    breath(voice, last.at + last.len, t => notes.some(note => t >= note.at && t <= note.at + note.len) ? 0.12 : 0, throat, { band: () => 2400, q: 0.9 });
    voice.send = 0.22;
  },
};

const oystercatcher: CallDesign = {
  takes: 2, level: -9,
  build(voice, r, take) {
    const f = range(r(), 2800, 3300), notes: Note[] = [];
    const count = take === 0 ? 7 + Math.floor(r() * 8) : 2 + Math.floor(r() * 2);
    let at = 0, gap = take === 0 ? 0.2 : 0.26;
    for (let i = 0; i < count; i++) {
      const pitch = f * (take === 0 ? 1 - (i / count) * 0.12 : 1) * range(r(), 0.98, 1.02);
      notes.push({ at, len: range(r(), 0.07, 0.1), f: arch(pitch * 0.9, pitch, pitch * 0.82, 0.2), amp: take === 0 && i > count - 3 ? 0.6 : 0.85, attack: 0.08 });
      at += gap; gap = Math.max(0.11, gap * 0.93);
    }
    sing(voice, notes, 'sine', voice.out, { harmonics: [0.22, 0.06] });
    voice.send = 0.2;
  },
};

const curlew: CallDesign = {
  takes: 2, level: -7,
  build(voice, r, take) {
    const f = range(r(), 1700, 1950), notes: Note[] = [];
    if (take === 0) {
      const count = 2 + Math.floor(r() * 2);
      for (let i = 0; i < count; i++) notes.push({ at: i * range(r(), 0.62, 0.8), len: range(r(), 0.38, 0.5), f: glide(f, f * 1.38, 0.8), amp: 0.8, attack: 0.25 });
    } else {
      // The bubbling song: slow rising notes that hurry into a trill and fade.
      let at = 0, gap = 0.36;
      for (let i = 0; i < 18; i++) {
        const pitch = f * (1 + Math.min(1, i / 9) * 0.45) * range(r(), 0.98, 1.02);
        notes.push({ at, len: Math.max(0.05, gap * 0.8), f: glide(pitch * 0.92, pitch, 0.6), amp: 0.5 + Math.min(i, 8) * 0.05 - Math.max(0, i - 12) * 0.08, attack: 0.3 });
        at += gap; gap = Math.max(0.065, gap * 0.82);
      }
    }
    sing(voice, notes, 'sine', voice.out, { harmonics: [0.12], vibrato: { hz: 7, depth: 0.006 } });
    voice.send = 0.3;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Meadow and woodland
// ---------------------------------------------------------------------------------------------------------------

const skylark: CallDesign = {
  takes: 2, level: -14,
  build(voice, r, take) {
    // A long, high, tumbling song from far overhead: quick notes with turns, a trill now and then.
    const seconds = take === 0 ? range(r(), 3.5, 5.5) : range(r(), 2.2, 3.2), notes: Note[] = [];
    let at = 0, centre = range(r(), 3000, 4200);
    while (at < seconds) {
      if (r() < 0.12) {
        const pitch = centre * range(r(), 1.05, 1.3);
        for (let i = 0; i < 6; i++) notes.push({ at: at + i * 0.04, len: 0.03, f: () => pitch, amp: 0.6, attack: 0.3 });
        at += 0.28;
      } else {
        const a = centre * range(r(), 0.8, 1.25), b = centre * range(r(), 0.75, 1.35), len = range(r(), 0.045, 0.1);
        notes.push({ at, len, f: glide(a, b), amp: range(r(), 0.5, 0.9), attack: 0.25 });
        at += len + range(r(), 0.012, 0.04);
      }
      centre = Math.max(2500, Math.min(5600, centre * range(r(), 0.93, 1.08)));
    }
    sing(voice, notes, 'sine', voice.out, { harmonics: [0.08] });
    voice.send = 0.25;
  },
};

/** A kingdom's blackbird keeps three phrases of its own (seeded by the kingdom) and varies how it ends them. */
const blackbird: CallDesign = {
  takes: 3, level: -8,
  build(voice, r, take, context) {
    const notes: Note[] = [];
    if (take === 2) {
      // Alarm at dusk: a run of sharp "chink"s.
      const count = 4 + Math.floor(r() * 5);
      for (let i = 0; i < count; i++) notes.push({ at: i * range(r(), 0.16, 0.24), len: 0.035, f: () => range(r(), 2600, 3000), amp: 0.7, attack: 0.1 });
      sing(voice, notes, 'sine', voice.out, { harmonics: [0.35, 0.15] });
      voice.send = 0.2;
      return;
    }
    const memory = generator(context.kingdom ^ (0xb1ac + take * 977));
    let at = 0;
    const length = 4 + Math.floor(memory() * 4);
    for (let i = 0; i < length; i++) {
      const pitch = range(memory(), 1500, 2900), len = range(memory(), 0.08, 0.26), shape = Math.floor(memory() * 3);
      const f = shape === 0 ? glide(pitch, pitch * range(memory(), 1.1, 1.3)) : shape === 1 ? glide(pitch * 1.15, pitch * 0.9) : arch(pitch, pitch * 1.18, pitch * 0.95, 0.4);
      notes.push({ at, len: len * range(r(), 0.94, 1.06), f, amp: 0.75 * range(r(), 0.85, 1), attack: 0.2 });
      at += len + range(memory(), 0.02, 0.07);
    }
    // The twitter at the end changes every time: the same tune, never the same flourish.
    const twitter = Math.floor(r() * 7);
    for (let i = 0; i < twitter; i++) {
      const len = range(r(), 0.018, 0.04);
      notes.push({ at: at + 0.04, len, f: glide(range(r(), 3800, 5600), range(r(), 3500, 6000)), amp: 0.32, attack: 0.15 });
      at += len + 0.012;
    }
    sing(voice, notes, 'sine', voice.out, { harmonics: [0.12, 0.03], vibrato: { hz: 9, depth: 0.004 } });
    voice.send = 0.22;
  },
};

const wren: CallDesign = {
  takes: 2, level: -12,
  build(voice, r, take) {
    const notes: Note[] = [];
    const sections = take === 0 ? 3 + Math.floor(r() * 2) : 2;
    let at = 0;
    for (let s = 0; s < sections; s++) {
      const pitch = range(r(), 3800, 6500), rate = range(r(), 14, 24), count = 5 + Math.floor(r() * 9);
      for (let i = 0; i < count; i++) {
        notes.push({ at, len: 0.6 / rate, f: glide(pitch * 1.1, pitch * 0.92), amp: 0.7, attack: 0.15 });
        at += 1 / rate;
      }
      at += range(r(), 0.03, 0.09);
    }
    sing(voice, notes, 'sine', voice.out, { harmonics: [0.1] });
    voice.send = 0.15;
  },
};

const woodpigeon: CallDesign = {
  takes: 2, level: -6,
  build(voice, r, take) {
    // "coo-COO-coo, coo-coo", soft and throaty, once or twice.
    const f = range(r(), 330, 410), notes: Note[] = [], phrases = take === 0 ? 2 : 1;
    const pattern = [[0, 0.36, 0.8], [0.46, 0.5, 1], [1.04, 0.28, 0.7], [1.5, 0.26, 0.75], [1.82, 0.32, 0.7]] as const;
    for (let p = 0; p < phrases; p++) {
      const offset = p * range(r(), 2.3, 2.6);
      for (const [at, len, amp] of pattern) notes.push({ at: offset + at, len, f: arch(f * 0.94, f * 1.04, f * 0.9, 0.35), amp, attack: 0.3 });
    }
    const throat = voice.filter('lowpass', 1100, 0.6);
    voice.chain(throat, voice.out);
    sing(voice, notes, 'triangle', throat, { harmonics: [0.25] });
    voice.send = 0.2;
  },
};

const woodpecker: CallDesign = {
  takes: 2, level: -8,
  build(voice, r, take) {
    if (take === 1) {
      sing(voice, [{ at: 0, len: 0.05, f: glide(2700, 2400), amp: 0.8, attack: 0.1 }], 'sine', voice.out, { harmonics: [0.3, 0.2] });
      voice.send = 0.25;
      return;
    }
    // A drum on dead wood: knocks at 16–20 a second, quickening slightly and fading.
    const count = 12 + Math.floor(r() * 10), rate = range(r(), 16, 20), body = range(r(), 1100, 1700);
    const total = count / rate + 0.05;
    breath(voice, total, t => {
      const k = t * rate * (1 + t * 0.08), phase = k - Math.floor(k);
      return Math.floor(k) < count ? Math.exp(-phase * 16) * (1 - (Math.floor(k) / count) * 0.6) * 0.9 : 0;
    }, voice.out, { band: () => body, q: 3 });
    voice.send = 0.3;
  },
};

const owl: CallDesign = {
  takes: 3, level: -4,
  build(voice, r, take) {
    const f = range(r(), 360, 420);
    const soft = voice.filter('lowpass', 1500, 0.6);
    voice.chain(soft, voice.out);
    if (take === 1) {
      // The female's "ke-wick".
      const sharp = voice.filter('bandpass', 1900, 1.4);
      voice.chain(sharp, voice.out);
      sing(voice, [
        { at: 0, len: 0.07, f: () => 1500, amp: 0.4, attack: 0.1 },
        { at: 0.12, len: 0.3, f: arch(1500, 2050, 1700, 0.45), amp: 0.65, attack: 0.3 },
      ], 'sawtooth', sharp);
      voice.send = 0.35;
      return;
    }
    const notes: Note[] = [{ at: 0, len: range(r(), 0.32, 0.42), f: arch(f * 0.96, f, f * 0.93, 0.4), amp: 0.8, attack: 0.25 }];
    if (take === 0) {
      // The male's full hoot: a long note, a pause, a stutter and a long quavering note.
      const t0 = range(r(), 2.2, 3.2);
      notes.push({ at: t0, len: 0.1, f: () => f * 0.95, amp: 0.4 }, { at: t0 + 0.2, len: 0.1, f: () => f * 0.97, amp: 0.45 },
        { at: t0 + 0.38, len: 0.1, f: () => f, amp: 0.5 }, { at: t0 + 0.6, len: range(r(), 0.75, 0.95), f: arch(f, f * 1.02, f * 0.92, 0.3), amp: 0.85, attack: 0.15 });
    }
    sing(voice, notes, 'sine', soft, { harmonics: [0.16], vibrato: { hz: 6.5, depth: 0.012 } });
    voice.send = 0.4;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Ridges and sky
// ---------------------------------------------------------------------------------------------------------------

/** A rough, rolling throat: sawtooth through a formant with fast irregular amplitude, for corvids. */
function croak(voice: CueVoice, r: () => number, at: number, len: number, f: number, formant: number, roll: number, amp: number): void {
  const throat = voice.filter('bandpass', formant, 1.5), body = voice.filter('lowpass', 3000, 0.7);
  voice.chain(throat, body, voice.out);
  const pulses = new Float32Array(Math.ceil(len * 400));
  for (let i = 0; i < pulses.length; i++) {
    const t = i / 400, window = Math.sin(Math.PI * Math.min(1, t / len)) ** 0.6;
    pulses[i] = window * (0.55 + 0.45 * Math.sin(2 * Math.PI * roll * t + r() * 0.8)) * amp;
  }
  const start = voice.t + at, osc = voice.osc('sawtooth', f, start, start + len + 0.01), gain = voice.gain(0);
  osc.frequency.setValueAtTime(f * 1.05, start);
  osc.frequency.linearRampToValueAtTime(f * 0.9, start + len);
  gain.gain.setValueCurveAtTime(pulses, start, len);
  voice.chain(osc, gain, throat);
}

const raven: CallDesign = {
  takes: 3, level: -6,
  build(voice, r, take) {
    if (take === 0) {
      const count = 1 + Math.floor(r() * 3);
      for (let i = 0; i < count; i++) croak(voice, r, i * range(r(), 0.45, 0.62), range(r(), 0.22, 0.34), range(r(), 380, 520), range(r(), 1000, 1350), range(r(), 45, 70), 0.8);
    } else if (take === 1) {
      croak(voice, r, 0, range(r(), 0.25, 0.35), range(r(), 260, 340), range(r(), 700, 900), range(r(), 22, 30), 0.85);
    } else {
      // The hollow "tok", like a stone dropped into a well.
      sing(voice, [{ at: 0, len: 0.06, f: glide(980, 820), amp: 0.7, attack: 0.08 }, { at: 0.28, len: 0.05, f: glide(940, 800), amp: 0.5, attack: 0.08 }], 'sine', voice.out, { harmonics: [0.4] });
    }
    voice.send = 0.4;
  },
};

const chough: CallDesign = {
  takes: 2, level: -8,
  build(voice, r, take) {
    const ringing = voice.filter('bandpass', range(r(), 2300, 2700), 1.2);
    voice.chain(ringing, voice.out);
    const count = take === 0 ? 1 : 2, f = range(r(), 1700, 2000), notes: Note[] = [];
    for (let i = 0; i < count; i++) notes.push({ at: i * range(r(), 0.32, 0.45), len: range(r(), 0.2, 0.28), f: arch(f * 1.05, f * 1.25, f * 0.85, 0.25), amp: 0.8, attack: 0.12 });
    sing(voice, notes, 'triangle', ringing, { harmonics: [0.5] });
    voice.send = 0.35;
  },
};

const buzzard: CallDesign = {
  takes: 2, level: -12,
  build(voice, r, take) {
    // The mewing "peee-yoo" of a buzzard circling: a long falling note with a little breath in it.
    const f = range(r(), 2200, 2550), notes: Note[] = [], count = take === 0 ? 1 : 2;
    for (let i = 0; i < count; i++) notes.push({ at: i * range(r(), 1.4, 1.9), len: range(r(), 0.9, 1.2), f: arch(f * 0.92, f * 1.04, f * 0.6, 0.35), amp: 0.75, attack: 0.15 });
    const soft = voice.filter('lowpass', 4200, 0.7);
    voice.chain(soft, voice.out);
    sing(voice, notes, 'triangle', soft, { harmonics: [0.15], vibrato: { hz: 5.5, depth: 0.01 } });
    const last = notes[notes.length - 1]!;
    breath(voice, last.at + last.len, t => notes.some(note => t >= note.at && t <= note.at + note.len) ? 0.05 : 0, soft, { band: () => 2200, q: 1.2 });
    voice.send = 0.45;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// River and marsh
// ---------------------------------------------------------------------------------------------------------------

const frog: CallDesign = {
  takes: 2, level: -9,
  build(voice, r, take) {
    // A common frog's low purring croak: a buzzy tone pulsed at 18–28 Hz through a wet formant.
    const formant = voice.filter('bandpass', range(r(), 650, 1000), 2.2), dull = voice.filter('lowpass', 1800, 0.7);
    voice.chain(formant, dull, voice.out);
    const croaks = take === 0 ? 1 : 2;
    for (let c = 0; c < croaks; c++) {
      const at = c * range(r(), 0.5, 0.7), len = range(r(), 0.28, 0.55), rate = range(r(), 18, 28), f = range(r(), 160, 240);
      const pulses = new Float32Array(Math.ceil(len * 500));
      for (let i = 0; i < pulses.length; i++) {
        const t = i / 500, phase = (t * rate) % 1;
        pulses[i] = Math.exp(-phase * 6) * Math.sin(Math.PI * Math.min(1, t / len)) * 0.9;
      }
      const start = voice.t + at, osc = voice.osc('sawtooth', f, start, start + len + 0.01), gain = voice.gain(0);
      gain.gain.setValueCurveAtTime(pulses, start, len);
      voice.chain(osc, gain, formant);
    }
    voice.send = 0.12;
  },
};

const plop: CallDesign = {
  takes: 2, level: -12,
  build(voice, r, take) {
    // A fish rising or a pebble falling in: a bubble's quick upward "plop" and a little splash.
    const f = take === 0 ? range(r(), 170, 260) : range(r(), 300, 460);
    sing(voice, [{ at: 0, len: 0.07, f: x => f * (1 + 3.2 * x ** 1.6), amp: 0.9, attack: 0.05 }], 'sine', voice.out);
    breath(voice, 0.3, t => 0.35 * Math.exp(-t / 0.06) * Math.min(1, t / 0.004), voice.out, { band: () => 1600, q: 0.8, delay: 0.01 });
    voice.send = 0.12;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// The harbour
// ---------------------------------------------------------------------------------------------------------------

const rigging: CallDesign = {
  takes: 3, level: -18,
  build(voice, r, take) {
    // An iron ring on a wooden mast: a dry knock and a short, bright tink, once, twice or a little rattle.
    const strikes = take + 1;
    let at = 0;
    for (let i = 0; i < strikes; i++) {
      const f = range(r(), 1900, 3000), peak = range(r(), 0.4, 0.8) * (i === 0 ? 1 : 0.7);
      ring(voice, f, at, peak, range(r(), 0.06, 0.16), voice.out);
      ring(voice, f * 2.41, at, peak * 0.4, range(r(), 0.03, 0.07), voice.out);
      at += range(r(), 0.09, 0.3);
    }
    breath(voice, at + 0.05, t => Math.exp(-t / 0.01) * 0.3, voice.out, { band: () => 900, q: 1.2 });
    voice.send = 0.1;
  },
};

const hull: CallDesign = {
  takes: 2, level: -10,
  build(voice, r, take) {
    // A moored boat bumping the quay: a hollow wooden thud, the water it pushes, sometimes a second knock.
    const knocks = take === 0 ? 1 : 2, f = range(r(), 95, 150);
    for (let i = 0; i < knocks; i++) {
      const at = i * range(r(), 0.35, 0.6);
      ring(voice, f * range(r(), 0.96, 1.04), at, 0.9 - i * 0.3, 0.06, voice.out);
      ring(voice, f * 2.7, at, 0.25, 0.025, voice.out, 'triangle');
    }
    breath(voice, 0.9, t => 0.3 * Math.sin(Math.PI * Math.min(1, t / 0.9)) ** 2, voice.out, { band: t => 700 - t * 300, q: 0.9, delay: 0.04 });
    voice.send = 0.1;
  },
};

const mooring: CallDesign = {
  takes: 2, level: -16,
  build(voice, r, take) {
    // Rope tightening on a bollard: stick-slip friction, a creak that speeds up and lets go.
    const len = take === 0 ? range(r(), 0.7, 1.2) : range(r(), 0.35, 0.55);
    const start = voice.t, osc = voice.osc('sawtooth', 30, start, start + len + 0.02);
    const fast = range(r(), 55, 85);
    osc.frequency.setValueCurveAtTime(Float32Array.from({ length: 64 }, (_, i) => 22 + (fast - 22) * Math.sin(Math.PI * (i / 63)) ** 1.5), start, len);
    const fibre = voice.filter('bandpass', range(r(), 750, 1150), 4.5), gain = voice.gain(0);
    gain.gain.setValueCurveAtTime(Float32Array.from({ length: 64 }, (_, i) => 0.8 * Math.sin(Math.PI * (i / 63)) ** 0.7), start, len);
    voice.chain(osc, fibre, gain, voice.out);
    voice.send = 0.08;
  },
};

/** Bell buoy offshore: a small bronze bell, D-major-pentatonic tuned, rung by the swell; once, or swung back. */
const BUOY_NOTES: readonly PaletteNote[] = ['A4', 'B4', 'D5'];
const buoy: CallDesign = {
  takes: 2, level: -10,
  build(voice, r, take, context) {
    const note = BUOY_NOTES[Math.floor(generator(context.kingdom ^ 0xb0e)() * BUOY_NOTES.length)]!, f = noteHz(note);
    // A bell's partials: hum, prime, minor-third tierce, quint, nominal; higher ones ring shorter.
    const partials = [[0.5, 0.35, 1.6], [1, 0.6, 1.1], [1.19, 0.32, 0.7], [1.5, 0.22, 0.5], [2, 0.3, 0.35]] as const;
    const strikes = take === 0 ? 1 : 2;
    for (let s = 0; s < strikes; s++) {
      const at = s * range(r(), 0.55, 0.85), force = s === 0 ? 1 : 0.55;
      for (const [ratio, peak, tau] of partials.slice(0, s === 0 ? 5 : 3)) ring(voice, f * ratio, at, peak * force, tau, voice.out);
    }
    voice.send = 0.3;
  },
};

const slap: CallDesign = {
  takes: 3, level: -12,
  build(voice, r, take) {
    // A wave's lip hitting the quay: a wet slap, a falling splash, a bubble or two.
    const bright = [1400, 2000, 1000][take]!, len = range(r(), 0.2, 0.42);
    breath(voice, len, t => Math.min(1, t / 0.004) * Math.exp(-t / (len * 0.28)) * 0.8, voice.out, { type: 'lowpass', band: t => bright * Math.exp(-t * 4) + 300, q: 0.7 });
    if (r() < 0.7) sing(voice, [{ at: 0.03, len: 0.05, f: x => range(r(), 280, 420) * (1 + 1.8 * x), amp: 0.35, attack: 0.1 }], 'sine', voice.out);
    voice.send = 0.1;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Landmarks, mountains, weather
// ---------------------------------------------------------------------------------------------------------------

const wheel: CallDesign = {
  takes: 2, level: -12,
  build(voice, r, take) {
    // A watermill's paddle meeting the race: a heavy splash and a wooden thunk; every other turn the axle groans.
    breath(voice, 0.55, t => Math.min(1, t / 0.01) * Math.exp(-t / 0.13) * 0.8, voice.out, { type: 'lowpass', band: t => 1500 - t * 1600, q: 0.6 });
    ring(voice, range(r(), 80, 96), 0.01, 0.6, 0.07, voice.out);
    if (take === 1) {
      const start = voice.t + 0.2, len = range(r(), 0.45, 0.7), osc = voice.osc('sawtooth', 35, start, start + len + 0.02);
      osc.frequency.setValueCurveAtTime(Float32Array.from({ length: 32 }, (_, i) => 28 + 18 * Math.sin(Math.PI * i / 31)), start, len);
      const wood = voice.filter('bandpass', range(r(), 480, 620), 5), gain = voice.gain(0);
      gain.gain.setValueCurveAtTime(Float32Array.from({ length: 32 }, (_, i) => 0.55 * Math.sin(Math.PI * i / 31)), start, len);
      voice.chain(osc, wood, gain, voice.out);
    }
    voice.send = 0.15;
  },
};

const CHIME_NOTES: readonly PaletteNote[] = ['D6', 'E6', 'F#6', 'A6', 'B6'];
const chimes: CallDesign = {
  takes: 3, level: -16,
  build(voice, r, take) {
    // Hanging tubes in the bell garden knocked by a gust: tuned to the kingdom's palette, with tube overtones.
    const strikes = take + 2;
    let at = 0;
    for (let i = 0; i < strikes; i++) {
      const f = noteHz(CHIME_NOTES[Math.floor(r() * CHIME_NOTES.length)]!), peak = range(r(), 0.35, 0.75);
      ring(voice, f, at, peak, range(r(), 0.7, 1.3), voice.out);
      ring(voice, f * 2.76, at, peak * 0.3, 0.25, voice.out);
      at += range(r(), 0.08, 0.35);
    }
    voice.send = 0.3;
  },
};

const flag: CallDesign = {
  takes: 2, level: -14,
  build(voice, r, take) {
    // A pennant on its pole in a gust: flutter at 7–12 Hz with irregular snaps, then it falls slack.
    const len = take === 0 ? range(r(), 1.4, 2.4) : range(r(), 0.7, 1.1), rate = range(r(), 7, 12), jitter = range(r(), 0, 1);
    const flutter = (t: number) => {
      const swell = Math.sin(Math.PI * Math.min(1, t / len)) ** 0.8, phase = (t * rate + jitter * Math.sin(t * 5)) % 1;
      return swell * (0.25 + 0.75 * Math.exp(-phase * 5));
    };
    breath(voice, len, t => flutter(t) * 0.7, voice.out, { colour: 'pink', band: () => 380, q: 0.9 });
    breath(voice, len, t => flutter(t) ** 3 * 0.35, voice.out, { band: () => 1700, q: 1.1 });
    voice.send = 0.12;
  },
};

const scree: CallDesign = {
  takes: 2, level: -10,
  build(voice, r, take) {
    // Small stones slipping on the ridge: clicks that bunch, speed up and slow, with a dull thud or two.
    const count = take === 0 ? 8 + Math.floor(r() * 8) : 4 + Math.floor(r() * 4);
    const times: number[] = [];
    let at = 0, gap = range(r(), 0.12, 0.2);
    for (let i = 0; i < count; i++) { times.push(at); at += gap * range(r(), 0.5, 1.5); gap *= i < count / 2 ? 0.85 : 1.25; }
    const total = at + 0.1, levels = times.map(() => range(r(), 0.3, 1));
    const clicks = (t: number) => times.reduce((sum, time, i) => t >= time ? sum + levels[i]! * Math.exp(-(t - time) / 0.008) : sum, 0);
    breath(voice, total, t => clicks(t) * 0.7, voice.out, { band: t => 2600 + 900 * Math.sin(t * 9), q: 1.4 });
    breath(voice, total, t => clicks(t) * 0.35, voice.out, { colour: 'brown', type: 'lowpass', band: () => 320, q: 0.7 });
    voice.send = 0.45;
  },
};

const stones: CallDesign = {
  takes: 2, level: -16,
  build(voice, r, take) {
    // Grit and a pebble rolled by the wind in the pass.
    const count = take === 0 ? 3 : 2, times = Array.from({ length: count }, (_, i) => i * range(r(), 0.06, 0.18));
    const total = times[times.length - 1]! + 0.08;
    breath(voice, total, t => times.reduce((sum, time) => t >= time ? sum + Math.exp(-(t - time) / 0.006) : sum, 0) * 0.6, voice.out, { band: () => range(r(), 2200, 3400), q: 1.6 });
    voice.send = 0.3;
  },
};

const DRIP_PITCH = [[900, 1400], [1400, 2100], [2100, 3200]] as const;
const drip: CallDesign = {
  takes: 3, level: -18,
  build(voice, r, take) {
    // A drop from the eaves into a puddle: the trapped bubble's rising "plip".
    const [low, high] = DRIP_PITCH[take]!, f = logRange(r(), low, high);
    sing(voice, [{ at: 0, len: range(r(), 0.03, 0.06), f: x => f * (1 + 0.6 * x), amp: 0.8, attack: 0.04 }], 'sine', voice.out);
    voice.send = 0.08;
  },
};

const thunder: CallDesign = {
  takes: 3, level: -8,
  build(voice, r, take, context) {
    // Rolling thunder: a low swell of several bursts that slowly dulls; a near strike starts with a crack.
    const near = take === 2 && context.weather.storm > 0.6;
    const len = range(r(), 4, 7.5), bursts = 3 + Math.floor(r() * 4);
    const peaks = Array.from({ length: bursts }, (_, i) => ({ at: (i / bursts) * len * 0.7 + r() * 0.4, size: range(r(), 0.4, 1) * (1 - i / (bursts + 1) * 0.5) }));
    const roll = (t: number) => peaks.reduce((sum, peak) => t >= peak.at ? sum + peak.size * Math.min(1, (t - peak.at) / 0.25) * Math.exp(-(t - peak.at) / 0.9) : sum, 0);
    const fade = (t: number) => Math.min(1, (len - t) / 0.8);
    breath(voice, len, t => roll(t) * fade(t) * 0.55, voice.out, { colour: 'brown', type: 'lowpass', band: t => 380 - t * 35, q: 0.5 });
    breath(voice, len, t => roll(t) * fade(t) * (take === 1 ? 0.25 : 0.14), voice.out, { colour: 'pink', type: 'lowpass', band: t => 900 - t * 90, q: 0.5 });
    if (near) breath(voice, 0.6, t => Math.min(1, t / 0.003) * Math.exp(-t / 0.09) * 0.6, voice.out, { type: 'highpass', band: () => 900, q: 0.5 });
    voice.send = 0.25;
  },
};

const branch: CallDesign = {
  takes: 2, level: -16,
  build(voice, r, take) {
    // A bough working in the wind: a slow wooden groan, sometimes with its leaves.
    const len = range(r(), 0.6, 1.4), start = voice.t, osc = voice.osc('sawtooth', 24, start, start + len + 0.02);
    const fast = range(r(), 30, 48);
    osc.frequency.setValueCurveAtTime(Float32Array.from({ length: 48 }, (_, i) => 16 + (fast - 16) * Math.sin(Math.PI * i / 47) ** 2), start, len);
    const wood = voice.filter('bandpass', range(r(), 380, 650), 5.5), gain = voice.gain(0);
    gain.gain.setValueCurveAtTime(Float32Array.from({ length: 48 }, (_, i) => 0.7 * Math.sin(Math.PI * i / 47)), start, len);
    voice.chain(osc, wood, gain, voice.out);
    if (take === 1) breath(voice, len + 0.6, t => 0.3 * Math.sin(Math.PI * Math.min(1, t / (len + 0.6))), voice.out, { colour: 'pink', band: () => 3200, q: 0.7 });
    voice.send = 0.15;
  },
};

export const CALLS: Readonly<Record<CallKey, CallDesign>> = {
  gull, oystercatcher, curlew, skylark, blackbird, wren, woodpigeon, woodpecker, owl, raven, chough, buzzard, frog,
  rigging, hull, mooring, buoy, slap, plop, wheel, chimes, flag, scree, drip, thunder, branch, stones,
};
