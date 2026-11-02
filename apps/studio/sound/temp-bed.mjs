// TEMPORARY SCORE FOR THE ROUGH CUT. NEVER PUBLISH, NEVER SHIP, NEVER UPLOAD.
//
// Synthesises the teaser's temporary music bed offline in plain Node (no dependencies): an 88 s piece in D major at
// 94 BPM that follows the shot list's chapters, so the rough cut can be timed and cut on beats until Tobias picks the
// real music. Everything is synthesised here: a Karplus-Strong lute with double courses, bowed-string ensembles from
// band-limited (PolyBLEP) saws, a formant-filtered choir, a horn section, a flute, a celesta, taiko and timpani, an
// anvil, and a Freeverb-style hall. Then a look-ahead limiter, a 24-bit WAV, a two-pass loudnorm copy at -18 LUFS,
// measurements and a spectrogram.
//
//   nice -n 19 node apps/studio/sound/temp-bed.mjs            # render, normalise, measure
//   nice -n 19 node apps/studio/sound/temp-bed.mjs --no-ffmpeg # render the WAV and the grid only
//
// Writes  <media>/audio/music/temp-bed.wav              raw mix, 48 kHz, 24-bit, stereo, sample peak -1.5 dBFS
//         <media>/audio/music/temp-bed-18lufs.wav       loudness-normalised copy (-18 LUFS, true peak below -1 dBTP)
//         <media>/audio/music/temp-bed-spectrogram.png  (and a close-up of the forge strike)
//         <media>/audio/music/README.md                 the TEMPORARY label beside the audio
//         apps/studio/sound/temp-bed.json               tempo, every beat and bar, chapters, hit points, loudness
// <media> is $CHATDOM_TEASER_MEDIA or /srv/chatdom/media/teaser. Every ffmpeg runs under nice -n 19 with
// -threads 4. Deterministic: the same code renders the same samples.

import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MEDIA = process.env.CHATDOM_TEASER_MEDIA ?? '/srv/chatdom/media/teaser';
const OUT = join(MEDIA, 'audio/music');
const RAW = join(OUT, 'temp-bed.wav');
const NORM = join(OUT, 'temp-bed-18lufs.wav');
const JSON_OUT = join(HERE, 'temp-bed.json');
const RUN_FFMPEG = !process.argv.includes('--no-ffmpeg');

// ---------------------------------------------------------------------------------------------------------------
// The grid. 94 BPM in 4/4 with a two-beat pickup: beat n sits at n * BEAT, bar 1 starts on beat 2.
// ---------------------------------------------------------------------------------------------------------------
const SR = 48000;
const DURATION = 88;
const N = DURATION * SR;
const BPM = 94;
const BEAT = 60 / BPM;
const PICKUP = 2;
/** Seconds at bar `bar` (1-based; bar 0 is the pickup) and beat `beat` (1-based, fractional allowed). */
const at = (bar, beat = 1) => (PICKUP + (bar - 1) * 4 + (beat - 1)) * BEAT;
const beats = n => n * BEAT;

// ---------------------------------------------------------------------------------------------------------------
// Small tools
// ---------------------------------------------------------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let seedCounter = 1;
const nextRandom = () => rng(0x9e3779b9 ^ Math.imul(seedCounter++, 0x85ebca6b));
const mtof = m => 440 * 2 ** ((m - 69) / 12);
const cents = c => 2 ** (c / 1200);
const db = x => 10 ** (x / 20);
const panGains = p => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];
/** Raised-cosine attack and release: no corner, no click. */
function envAt(n, att, relStart, rel) {
  let a = 1;
  if (n < att) a = 0.5 - 0.5 * Math.cos(Math.PI * n / att);
  if (n >= relStart) { const k = (n - relStart) / rel; a *= k >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * k); }
  return a;
}
function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/** Zero-delay-feedback state-variable filter (stable under modulation). Outputs lp, bp (unity peak), hp. */
class SVF {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.lp = 0; this.bp = 0; this.hp = 0; }
  set(fc, q) {
    const g = Math.tan(Math.PI * Math.min(Math.max(fc, 10), SR * 0.47) / SR);
    this.k = 1 / q; this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
    return this;
  }
  tick(v0) {
    const v3 = v0 - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2; this.bp = this.k * v1; this.hp = v0 - this.k * v1 - v2;
    return v2;
  }
}

/** RBJ biquad for the fixed bus EQ. */
class Biquad {
  constructor(type, f, q = 0.707, gainDb = 0) {
    const w = 2 * Math.PI * f / SR, cw = Math.cos(w), sw = Math.sin(w), alpha = sw / (2 * q), A = 10 ** (gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
    else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
    else if (type === 'peak') { b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; }
    else if (type === 'highshelf') {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s;
    } else throw new Error(type);
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = 0; i < x.length; i++) {
      const x0 = x[i], y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0; x[i] = y0;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Buses
// ---------------------------------------------------------------------------------------------------------------
const ONSETS = [];
class Bus {
  constructor(name, { send = 0.2, eq = [], gain = 0 } = {}) {
    this.name = name; this.send = send; this.eq = eq; this.gainDb = gain; this.auto = null;
    this.L = new Float32Array(N); this.R = new Float32Array(N);
  }
  /** Adds a mono signal at time t, panned (equal power), scaled. */
  mono(t, x, gain = 1, pan = 0) {
    ONSETS.push(t);
    const s = Math.round(t * SR), [gl, gr] = panGains(pan);
    const end = Math.min(x.length, N - s);
    for (let i = Math.max(0, -s); i < end; i++) { const v = x[i] * gain; this.L[s + i] += v * gl; this.R[s + i] += v * gr; }
  }
  stereo(t, l, r, gain = 1) {
    ONSETS.push(t);
    const s = Math.round(t * SR), end = Math.min(l.length, N - s);
    for (let i = Math.max(0, -s); i < end; i++) { this.L[s + i] += l[i] * gain; this.R[s + i] += r[i] * gain; }
  }
}
const buses = {
  lute: new Bus('lute', { send: 0.22, eq: [['hp', 75], ['peak', 210, 1.0, 1.5], ['peak', 2800, 1.0, 1.5], ['lp', 10000]] }),
  harp: new Bus('harp', { send: 0.32, eq: [['hp', 110], ['lp', 7000]] }),
  pluck: new Bus('pluck', { send: 0.08, eq: [['hp', 32], ['peak', 90, 1.0, 2], ['lp', 2600]] }),
  strings: new Bus('strings', { send: 0.36, eq: [['hp', 95], ['peak', 320, 0.9, -2], ['lp', 11000]] }),
  low: new Bus('low', { send: 0.16, eq: [['hp', 30], ['lp', 2200]] }),
  choir: new Bus('choir', { send: 0.48, eq: [['hp', 160], ['peak', 3200, 1.0, 1.5], ['lp', 10000]] }),
  brass: new Bus('brass', { send: 0.26, eq: [['hp', 80], ['peak', 250, 0.9, -2], ['peak', 1400, 0.9, 2], ['lp', 8000]] }),
  flute: new Bus('flute', { send: 0.38, eq: [['hp', 220], ['lp', 9000]] }),
  celesta: new Bus('celesta', { send: 0.46, eq: [['hp', 320], ['highshelf', 7000, 0.7, -3], ['lp', 12000]] }),
  drums: new Bus('drums', { send: 0.16, eq: [['hp', 28], ['lp', 9000]] }),
  anvil: new Bus('anvil', { send: 0.42, eq: [['hp', 120], ['lp', 9500]] }),
  air: new Bus('air', { send: 0.35, eq: [['hp', 250], ['lp', 8000]] }),
};

// ---------------------------------------------------------------------------------------------------------------
// Instruments. Each returns a mono or stereo buffer that starts at the note's onset and ends at exactly zero.
// ---------------------------------------------------------------------------------------------------------------

/** One Karplus-Strong string: filtered-noise pluck with a pick-position comb, an averaging loop filter and an allpass for exact tuning. */
function ksString(freq, ring, vel, { t60 = 2.2, bright = 0.5, pick = 0.13, s = 0.5, fade = 0.25 } = {}) {
  const random = nextRandom();
  const len = Math.ceil((ring + fade) * SR), out = new Float32Array(len);
  const P = SR / freq, L = Math.max(2, Math.floor(P - s - 0.1)), d = P - s - L, C = (1 - d) / (1 + d);
  const M = L + 2, hist = new Float32Array(M);
  const exLen = Math.max(4, Math.round(P)), ex = new Float32Array(exLen);
  const a = Math.min(0.95, 0.08 + bright * (0.35 + 0.6 * vel));
  let lp = 0, mean = 0;
  for (let i = 0; i < exLen; i++) { lp += a * ((random() * 2 - 1) - lp); ex[i] = lp; }
  const pp = Math.max(1, Math.round(pick * P));
  for (let i = exLen - 1; i >= pp; i--) ex[i] -= ex[i - pp];
  for (let i = 0; i < exLen; i++) mean += ex[i];
  mean /= exLen;
  const fadeIn = Math.min(exLen, Math.round(0.0008 * SR));
  for (let i = 0; i < exLen; i++) ex[i] = (ex[i] - mean) * vel * (i < fadeIn ? i / fadeIn : 1);
  const g = 10 ** (-3 / (t60 * freq));
  let apx = 0, apy = 0;
  const relStart = Math.round(ring * SR), rel = len - relStart;
  for (let n = 0; n < len; n++) {
    const idx = n % M, ia = (idx - L + 2 * M) % M, ib = (idx - L - 1 + 2 * M) % M;
    const v = (1 - s) * hist[ia] + s * hist[ib];
    const y1 = C * v + apx - C * apy; apx = v; apy = y1;
    const y = (n < exLen ? ex[n] : 0) + g * y1;
    hist[idx] = y;
    out[n] = n < relStart ? y : y * (0.5 + 0.5 * Math.cos(Math.PI * (n - relStart) / rel));
  }
  return out;
}

/** A lute note: two courses a hair apart, slightly spread. */
function lute(t, m, vel, ring = 2.4, pan = -0.18, { bus = buses.lute, t60, bright = 0.5 } = {}) {
  const f = mtof(m), life = t60 ?? (m < 50 ? 3.4 : m < 62 ? 2.8 : m < 74 ? 2.2 : 1.6);
  const a = ksString(f * cents(-1.3), ring, vel, { t60: life, bright, pick: 0.12 });
  const b = ksString(f * cents(1.3), ring, vel * 0.85, { t60: life * 0.92, bright: bright * 0.9, pick: 0.15 });
  bus.mono(t, a, 0.55, pan - 0.08);
  bus.mono(t + 0.004, b, 0.55, pan + 0.08);
}

/** Bowed-string ensemble: detuned band-limited saws with drift and delayed vibrato, a swelling low-pass, spread wide. */
function strings(t, m, dur, vel, { att = 0.5, rel = 1.0, voices = 4, det = 8, spread = 0.7, bright = 1, bus = buses.strings, vib = 1 } = {}) {
  const random = nextRandom(), f = mtof(m);
  const len = Math.round((dur + rel) * SR), L = new Float32Array(len), R = new Float32Array(len);
  const attS = Math.max(16, Math.round(att * SR)), relStart = Math.round(dur * SR), relS = len - relStart;
  const vs = Array.from({ length: voices }, (_, i) => {
    const p = voices === 1 ? 0 : (i / (voices - 1) * 2 - 1) * spread;
    return { ph: random(), det: cents((random() * 2 - 1) * det), drift: random() * 6.28, driftHz: 0.08 + random() * 0.2,
      vibPh: random() * 6.28, vibHz: 4.9 + random() * 0.8, gains: panGains(p) };
  });
  const fl = new SVF(), fr = new SVF(), q = 0.62;
  const base = Math.min(10000, (f * 3.0 + 1400 + 4200 * vel) * bright);
  for (let n = 0; n < len; n++) {
    const e = envAt(n, attS, relStart, relS);
    if ((n & 63) === 0) { const fc = base * (0.42 + 0.58 * e); fl.set(fc, q); fr.set(fc, q); }
    const tt = n / SR, vibDepth = 0.0026 * vib * Math.min(1, Math.max(0, (tt - 0.35) / 0.6));
    let l = 0, r = 0;
    for (const v of vs) {
      const fm = f * v.det * (1 + 0.0012 * Math.sin(v.drift + 6.283 * v.driftHz * tt) + vibDepth * Math.sin(v.vibPh + 6.283 * v.vibHz * tt));
      const dt = fm / SR, x = 2 * v.ph - 1 - polyblep(v.ph, dt);
      v.ph += dt; if (v.ph >= 1) v.ph -= 1;
      l += x * v.gains[0]; r += x * v.gains[1];
    }
    L[n] = fl.tick(l) * e; R[n] = fr.tick(r) * e;
  }
  bus.stereo(t, L, R, vel * 0.32 / Math.sqrt(voices));
}

/** Formant tables (centre Hz, relative gain, bandwidth Hz) for a soft choir. */
const VOWELS = {
  a: [[800, 1, 120], [1150, 0.5, 130], [2900, 0.17, 200], [3900, 0.06, 250]],
  o: [[450, 1, 100], [800, 0.4, 110], [2830, 0.1, 180], [3500, 0.04, 220]],
  u: [[325, 1, 90], [700, 0.25, 100], [2530, 0.03, 170], [3500, 0.012, 220]],
};
/** Choir: a few detuned voices with vibrato into a formant bank per side, a little breath, a slow vowel morph. */
function choir(t, m, dur, vel, { att = 0.7, rel = 1.4, vowel = 'a', to = 'o', voices = 3, pan = 0, spread = 0.6, bus = buses.choir } = {}) {
  const random = nextRandom(), f = mtof(m);
  const len = Math.round((dur + rel) * SR), L = new Float32Array(len), R = new Float32Array(len);
  const attS = Math.max(16, Math.round(att * SR)), relStart = Math.round(dur * SR), relS = len - relStart;
  const sides = [0, 1].map(side => ({
    vs: Array.from({ length: voices }, () => ({ ph: random(), det: cents((random() * 2 - 1) * 9), vibPh: random() * 6.28, vibHz: 5.0 + random() * 0.7, drift: random() * 6.28 })),
    bank: VOWELS.a.map(() => new SVF()), body: new SVF().set(Math.min(1800, f * 3), 0.7), breath: new SVF().set(2600 + side * 400, 1.2),
  }));
  const A = VOWELS[vowel], B = VOWELS[to];
  for (let n = 0; n < len; n++) {
    const e = envAt(n, attS, relStart, relS), tt = n / SR;
    if ((n & 63) === 0) {
      const k = Math.min(1, tt / Math.max(0.5, dur)) * 0.8;
      for (const s of sides) s.bank.forEach((flt, i) => { const fc = A[i][0] + (B[i][0] - A[i][0]) * k, bw = A[i][2] + (B[i][2] - A[i][2]) * k; flt.set(fc, fc / (bw * 1.4)); });
    }
    const vibDepth = 0.0045 * Math.min(1, Math.max(0, (tt - 0.25) / 0.8));
    const k = Math.min(1, tt / Math.max(0.5, dur)) * 0.8;
    for (let side = 0; side < 2; side++) {
      const s = sides[side];
      let x = 0;
      for (const v of s.vs) {
        const fm = f * v.det * (1 + vibDepth * Math.sin(v.vibPh + 6.283 * v.vibHz * tt) + 0.001 * Math.sin(v.drift + 0.9 * tt));
        const dt = fm / SR; x += 2 * v.ph - 1 - polyblep(v.ph, dt);
        v.ph += dt; if (v.ph >= 1) v.ph -= 1;
      }
      x /= voices;
      let y = 0;
      for (let i = 0; i < 4; i++) { s.bank[i].tick(x); y += s.bank[i].bp * (A[i][1] + (B[i][1] - A[i][1]) * k); }
      y += s.body.tick(x) * 0.12 + s.breath.tick((random() * 2 - 1)) * 0.02;
      (side ? R : L)[n] = y * e;
    }
  }
  const [gl, gr] = panGains(pan), w = spread;
  for (let n = 0; n < len; n++) { const l = L[n], r = R[n]; L[n] = (l * (1 + w) + r * (1 - w)) / 2 * gl * 1.41; R[n] = (r * (1 + w) + l * (1 - w)) / 2 * gr * 1.41; }
  bus.stereo(t, L, R, vel * 0.9);
}

/** Horn section: two or three saws with a lip scoop, a brightening low-pass and a soft saturation. */
function brass(t, m, dur, vel, { att = 0.12, rel = 0.45, voices = 3, pan = -0.1, bus = buses.brass } = {}) {
  const random = nextRandom(), f = mtof(m);
  const len = Math.round((dur + rel) * SR), out = new Float32Array(len);
  const attS = Math.max(16, Math.round(att * SR)), relStart = Math.round(dur * SR), relS = len - relStart;
  const vs = Array.from({ length: voices }, () => ({ ph: random(), det: cents((random() * 2 - 1) * 6), vibPh: random() * 6.28 }));
  const flt = new SVF(), flt2 = new SVF(), drive = 1 + 1.4 * vel;
  for (let n = 0; n < len; n++) {
    const tt = n / SR, e = envAt(n, attS, relStart, relS);
    const blare = Math.min(1, tt / (att * 1.3 + 0.02)) * (0.72 + 0.28 * Math.exp(-tt / 0.4));
    if ((n & 31) === 0) { const fc = Math.min(7000, Math.max(260, f * (1.5 + 6.0 * vel * blare * e))); flt.set(fc, 0.9); flt2.set(fc * 1.3, 0.6); }
    const scoop = cents(-28 * Math.exp(-tt / 0.045)), vib = 1 + 0.002 * Math.min(1, Math.max(0, tt - 0.5)) * Math.sin(6.283 * 5.2 * tt);
    let x = 0;
    for (const v of vs) {
      const dt = f * v.det * scoop * vib / SR; x += 2 * v.ph - 1 - polyblep(v.ph, dt);
      v.ph += dt; if (v.ph >= 1) v.ph -= 1;
    }
    x = flt2.tick(flt.tick(x / voices));
    out[n] = Math.tanh(x * drive) / Math.tanh(drive) * e;
  }
  bus.mono(t, out, vel * 0.42, pan);
}

/** Flute: a near-sine with a little second and third harmonic, breath noise, a chiff and a delayed vibrato. */
function flute(t, m, dur, vel, { pan = 0.22, bus = buses.flute } = {}) {
  const random = nextRandom(), f = mtof(m);
  const rel = 0.28, len = Math.round((dur + rel) * SR), out = new Float32Array(len);
  const attS = Math.round(0.07 * SR), relStart = Math.round(dur * SR), relS = len - relStart;
  const breath = new SVF().set(f * 2, 2.5), chiff = new SVF().set(2200, 1.2);
  let ph = 0;
  for (let n = 0; n < len; n++) {
    const tt = n / SR, e = envAt(n, attS, relStart, relS);
    const vib = 1 + 0.0035 * Math.min(1, Math.max(0, (tt - 0.3) / 0.5)) * Math.sin(6.283 * 5.1 * tt);
    ph += f * vib / SR; if (ph > 1) ph -= 1;
    const w = 6.283185307 * ph;
    const tone = Math.sin(w) + 0.16 * Math.sin(2 * w + 0.4) + 0.05 * Math.sin(3 * w + 1.1);
    const nz = random() * 2 - 1;
    const ch = chiff.tick(nz) * 0.25 * Math.exp(-tt / 0.03);
    out[n] = (tone + breath.tick(nz) * 0.08 + ch) * e;
  }
  bus.mono(t, out, vel * 0.3, pan);
}

/** Celesta: struck bars, mostly fundamental with quickly fading upper partials. */
function celesta(t, m, vel, { pan = 0, ring = 2.6, bus = buses.celesta } = {}) {
  const random = nextRandom(), f = mtof(m);
  const len = Math.round(ring * SR), out = new Float32Array(len);
  const parts = [[1, 1, 1.5], [2, 0.28, 0.7], [3, 0.07, 0.35], [4.07, 0.05, 0.18]].filter(([r]) => f * r < SR * 0.42);
  const ph = parts.map(() => random() * 0.2);
  const attS = Math.round(0.0015 * SR), relStart = len - Math.round(0.08 * SR);
  for (let n = 0; n < len; n++) {
    const tt = n / SR;
    let x = 0;
    for (let i = 0; i < parts.length; i++) { const [r, a, d] = parts[i]; x += a * Math.exp(-tt / d) * Math.sin(6.283185307 * (f * r * tt + ph[i])); }
    out[n] = x * envAt(n, attS, relStart, len - relStart);
  }
  bus.mono(t, out, vel * 0.26, pan);
}

/** Drums: a pitched membrane with a pitch drop, a second mode, a skin noise band and a stick click. */
function drum(t, vel, { f0 = 140, f1 = 58, bend = 0.03, decay = 0.45, mode = 1.58, skin = 500, skinQ = 0.9, skinAmt = 0.4, skinDecay = 0.06, click = 0.15, pan = 0, bus = buses.drums, gain = 1 } = {}) {
  const random = nextRandom();
  const len = Math.round(decay * 7 * SR), out = new Float32Array(len);
  const nb = new SVF().set(skin, skinQ), ck = new SVF().set(3000, 0.7);
  let ph = 0, ph2 = 0;
  const attS = Math.round(0.0012 * SR), relStart = len - Math.round(0.01 * SR);
  for (let n = 0; n < len; n++) {
    const tt = n / SR, f = f1 + (f0 - f1) * Math.exp(-tt / bend);
    ph += f / SR; ph2 += f * mode / SR;
    const nz = random() * 2 - 1;
    nb.tick(nz); ck.tick(nz);
    const body = Math.sin(6.283185307 * ph) * Math.exp(-tt / decay) + 0.3 * Math.sin(6.283185307 * ph2) * Math.exp(-tt / (decay * 0.45));
    const x = body + nb.bp * skinAmt * Math.exp(-tt / skinDecay) + ck.hp * click * Math.exp(-tt / 0.004);
    out[n] = x * envAt(n, attS, relStart, len - relStart);
  }
  bus.mono(t, out, vel * 0.55 * gain, pan);
}
const taiko = (t, vel, pan = 0) => drum(t, vel, { f0: 150, f1: 62, bend: 0.025, decay: 0.42, skin: 420, skinAmt: 0.35, click: 0.12, pan });
const odaiko = (t, vel) => drum(t, vel, { f0: 110, f1: 46, bend: 0.04, decay: 0.75, mode: 1.5, skin: 260, skinAmt: 0.3, click: 0.08, gain: 1.15 });
const shime = (t, vel, pan = 0.25) => drum(t, vel, { f0: 420, f1: 330, bend: 0.01, decay: 0.07, mode: 1.7, skin: 1700, skinQ: 1.4, skinAmt: 0.55, skinDecay: 0.03, click: 0.25, pan, gain: 0.55 });
const frame = (t, vel, pan = -0.1) => drum(t, vel, { f0: 120, f1: 84, bend: 0.03, decay: 0.22, skin: 380, skinAmt: 0.3, click: 0.04, pan, gain: 0.7 });

/** Timpani: membrane modes, a felt mallet thump. */
function timpani(t, m, vel, { decay = 1.5, pan = 0.1 } = {}) {
  const random = nextRandom(), f = mtof(m);
  const len = Math.round(decay * 5 * SR), out = new Float32Array(len);
  const modes = [[1, 1, 1], [1.5, 0.55, 0.7], [1.99, 0.3, 0.5], [2.44, 0.16, 0.35]];
  const thump = new SVF().set(260, 0.7);
  const attS = Math.round(0.002 * SR), relStart = len - Math.round(0.02 * SR);
  for (let n = 0; n < len; n++) {
    const tt = n / SR;
    let x = 0;
    for (const [r, a, d] of modes) x += a * Math.exp(-tt / (decay * d)) * Math.sin(6.283185307 * f * r * tt);
    x += thump.tick(random() * 2 - 1) * 1.4 * Math.exp(-tt / 0.025);
    out[n] = x * envAt(n, attS, relStart, len - relStart);
  }
  buses.drums.mono(t, out, vel * 0.42, pan);
}
function timpaniRoll(t0, t1, m, v0, v1) {
  const random = nextRandom();
  for (let t = t0, i = 0; t < t1; t += 1 / 13 + (random() - 0.5) * 0.012, i++) {
    const k = (t - t0) / (t1 - t0);
    timpani(t, m, (v0 + (v1 - v0) * k * k) * (0.85 + 0.15 * random()), { decay: 0.9, pan: i % 2 ? 0.16 : 0.04 });
  }
}

/** Struck steel: free-bar partials (1, 2.76, 5.40, 8.93), each with a slow beat, a hard contact and a thump. */
function anvil(t, vel, { f0 = mtof(74), scale = 1, pan = 0.08, thump = true, bus = buses.anvil } = {}) {
  const random = nextRandom();
  const ring = 3.2 * scale, len = Math.round(ring * SR), out = new Float32Array(len);
  const parts = [[1, 1, 2.6], [2.756, 0.5, 1.5], [5.404, 0.24, 0.8], [8.933, 0.09, 0.4]].filter(([r]) => f0 * r < SR * 0.4);
  const hp = new SVF().set(2400, 0.7);
  const attS = Math.round(0.0006 * SR), relStart = len - Math.round(0.05 * SR);
  for (let n = 0; n < len; n++) {
    const tt = n / SR;
    let x = 0;
    for (const [r, a, d] of parts) { const fr = f0 * r, dd = d * scale; x += a * Math.exp(-tt / dd) * (Math.sin(6.283185307 * fr * tt) + 0.6 * Math.sin(6.283185307 * (fr + 0.7) * tt)) / 1.6; }
    hp.tick(random() * 2 - 1);
    x += hp.hp * 0.9 * Math.exp(-tt / 0.005);
    if (thump) x += Math.sin(6.283185307 * (90 * tt + 1.6 * (1 - Math.exp(-tt / 0.02)))) * 0.6 * Math.exp(-tt / 0.07);
    out[n] = x * envAt(n, attS, relStart, len - relStart);
  }
  bus.mono(t, out, vel * 0.5, pan);
}
const tink = (t, m, vel, pan = 0.3) => anvil(t, vel * 0.5, { f0: mtof(m), scale: 0.07, pan, thump: false });

/** Filtered-noise swell that arrives exactly on `end` (reverse-cymbal or bellows), with a short fade so it never clicks. */
function swell(start, end, vel, { from = 1200, to = 6000, q = 0.8, lowpass = false, bus = buses.air, power = 2.4 } = {}) {
  const random = nextRandom();
  const len = Math.round((end - start) * SR), out = new Float32Array(len), flt = new SVF();
  const relStart = len - Math.round(0.022 * SR);
  for (let n = 0; n < len; n++) {
    const k = n / len;
    if ((n & 63) === 0) flt.set(from * (to / from) ** k, q);
    flt.tick(random() * 2 - 1);
    out[n] = (lowpass ? flt.lp : flt.bp) * k ** power * envAt(n, 0, relStart, len - relStart);
  }
  const random2 = nextRandom(), r2 = new Float32Array(len), flt2 = new SVF();
  for (let n = 0; n < len; n++) { const k = n / len; if ((n & 63) === 0) flt2.set(from * 1.07 * (to / from) ** k, q); flt2.tick(random2() * 2 - 1); r2[n] = (lowpass ? flt2.lp : flt2.bp) * k ** power * envAt(n, 0, relStart, len - relStart); }
  bus.stereo(start, out, r2, vel * 0.5);
}
/** A soft crash of air: band-limited noise that blooms and falls away (no brittle metal). */
function bloom(t, vel, { decay = 1.4 } = {}) {
  for (const side of [0, 1]) {
    const random = nextRandom(), len = Math.round(decay * 5 * SR), out = new Float32Array(len), flt = new SVF().set(4200 + side * 500, 0.6);
    const attS = Math.round(0.004 * SR), relStart = len - Math.round(0.05 * SR);
    for (let n = 0; n < len; n++) { flt.tick(random() * 2 - 1); out[n] = flt.bp * Math.exp(-n / SR / decay) * envAt(n, attS, relStart, len - relStart); }
    buses.air.mono(t, out, vel * 0.42, side ? 0.7 : -0.7);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Harmony. Voicings are written to move by step from one chord to the next.
// ---------------------------------------------------------------------------------------------------------------
const CH = {
  D: { bass: 38, pad: [57, 62, 66, 69], arp: [50, 57, 62, 66, 69, 74] },
  Dadd9: { bass: 38, pad: [57, 62, 64, 66, 69], arp: [50, 57, 64, 66, 69, 74] },
  GD: { bass: 38, pad: [59, 62, 67, 71], arp: [50, 55, 59, 62, 67, 71] },
  G: { bass: 43, pad: [59, 62, 67, 71], arp: [43, 50, 55, 59, 62, 67] },
  Gadd9: { bass: 43, pad: [57, 59, 62, 67], arp: [43, 50, 57, 59, 62, 67] },
  Bm: { bass: 35, pad: [59, 62, 66, 71], arp: [47, 54, 59, 62, 66, 71] },
  Asus4: { bass: 33, pad: [57, 62, 64, 69], arp: [45, 52, 57, 62, 64, 69] },
  A: { bass: 33, pad: [57, 61, 64, 69], arp: [45, 52, 57, 61, 64, 69] },
  AC: { bass: 37, pad: [57, 61, 64, 69], arp: [49, 52, 57, 61, 64, 69] },
  Em7: { bass: 40, pad: [59, 62, 64, 67], arp: [52, 59, 62, 64, 67, 71] },
  A7: { bass: 33, pad: [57, 61, 64, 67], arp: [45, 52, 57, 61, 64, 67] },
};
/** Bar -> [chord, first beat, beats]. Bar 0 is the pickup. */
const BARS = {
  0: [['D', 3, 2]], 1: [['D', 1, 4]], 2: [['GD', 1, 4]], 3: [['Bm', 1, 4]], 4: [['Asus4', 1, 2], ['A', 3, 2]],
  5: [['G', 1, 4]], 6: [['Asus4', 1, 2], ['A', 3, 2]],
  7: [['D', 1, 4]], 8: [['AC', 1, 4]], 9: [['Bm', 1, 4]], 10: [['G', 1, 4]], 11: [['Asus4', 1, 2], ['A', 3, 2]],
  12: [['Dadd9', 1, 4]], 13: [['G', 1, 4]], 14: [['Em7', 1, 2], ['A7', 3, 2]],
  15: [['Bm', 1, 4]], 16: [['Bm', 1, 4]], 17: [['G', 1, 4]], 18: [['A', 1, 4]],
  19: [['D', 1, 4]], 20: [['G', 1, 2], ['A', 3, 2]],
  21: [['Bm', 1, 4]], 22: [['G', 1, 4]], 23: [['D', 1, 4]], 24: [['A', 1, 4]], 25: [['Bm', 1, 4]], 26: [['G', 1, 2], ['A', 3, 2]],
  27: [['D', 1, 4]], 28: [['AC', 1, 4]], 29: [['Bm', 1, 4]], 30: [['G', 1, 4]], 31: [['Asus4', 1, 2], ['A', 3, 2]],
  32: [['Gadd9', 1, 4]], 33: [['D', 1, 4]],
};
const chordsIn = (from, to) => { const out = []; for (let b = from; b <= to; b++) for (const [name, beat, len] of BARS[b]) out.push({ bar: b, name, ch: CH[name], t: at(b, beat), dur: beats(len), beat, len }); return out; };

/** A melody line: [bar, beat, beats, midi, velocity?]. */
function line(notes, play) { for (const [bar, beat, len, m, v = 1] of notes) play(at(bar, beat), m, beats(len), v); }

// The theme, low (the opening and the close) and its answer, high (the Way Home and the rise to the map).
const THEME_A = [
  [1, 1, 1, 57], [1, 2, 1, 62], [1, 3, 1.5, 64], [1, 4.5, 0.5, 66],
  [2, 1, 2, 67], [2, 3, 1, 66], [2, 4, 1, 62],
  [3, 1, 1.5, 66], [3, 2.5, 0.5, 64], [3, 3, 1, 62], [3, 4, 1, 59],
  [4, 1, 2, 62], [4, 3, 2, 61],
];
const answer = bar0 => [
  [bar0, 1, 2, 78], [bar0, 3, 1, 76], [bar0, 4, 1, 74],
  [bar0 + 1, 1, 3, 76], [bar0 + 1, 4, 1, 69],
  [bar0 + 2, 1, 1.5, 74], [bar0 + 2, 2.5, 0.5, 73], [bar0 + 2, 3, 1, 71], [bar0 + 2, 4, 1, 74],
  [bar0 + 3, 1, 2, 74], [bar0 + 3, 3, 1, 71], [bar0 + 3, 4, 1, 74],
  [bar0 + 4, 1, 2, 76], [bar0 + 4, 3, 2, 73],
];

// ---------------------------------------------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------------------------------------------
const ARP = [0, 1, 2, 3, 4, 5, 4, 2];
function arpeggio(c, { from = 0, eighths = c.len * 2, vel = 0.3, play, skip = () => false, octave = 0 }) {
  for (let i = 0; i < eighths; i++) {
    if (skip(i)) continue;
    const m = c.ch.arp[ARP[(i + from) % ARP.length]] + octave;
    play(c.t + i * BEAT / 2, m, vel * (i % 2 ? 0.82 : 1) * (i === 0 ? 1.1 : 1));
  }
}
function strum(t, notes, vel, { gap = 0.022, ring = 2.6, pan = -0.18, bus } = {}) { notes.forEach((m, i) => lute(t + i * gap, m, vel * (1 - i * 0.05), ring, pan, { bus })); }
function pad(c, vel, opts = {}) { for (const m of c.ch.pad) strings(c.t, m, c.dur + (opts.overlap ?? 0.12), vel, opts); }

// --- Opening (pickup + bars 1-4): a lute alone, then the softest strings underneath.
strings(0, 50, beats(2) + 0.1, 0.12, { att: 1.2, rel: 0.6 });
for (const c of chordsIn(0, 4)) {
  const p = c.ch.pad.slice(0, 3);
  for (const m of p) strings(c.t, m, c.dur + 0.2, c.bar === 0 ? 0.13 : 0.23, { att: c.bar <= 1 ? 1.6 : 0.8, rel: 1.0, voices: 3, bright: 0.75 });
}
lute(at(0, 3), 50, 0.42, 3.2);
lute(at(0, 4), 57, 0.32, 2.2);
line(THEME_A, (t, m, d, v) => lute(t, m, 0.72 * v, Math.max(d, 1.1) + 0.6, -0.12));
for (const [bar, m] of [[1, 38], [2, 38], [3, 47], [4, 45]]) { lute(at(bar, 1), m, 0.42, 3.4, -0.3); lute(at(bar, 3), m + 7, 0.26, 2.0, -0.3); }
for (const c of chordsIn(3, 4)) arpeggio(c, { vel: 0.17, play: (t, m, v) => lute(t, m + 12, v, 1.4, 0.35, { bus: buses.harp }), skip: i => i % 2 === 0 });

// --- The island (bars 5-6): the lift. A low drum, the strings swell, horns underneath, the lute sweeps up.
swell(at(4, 3), at(5, 1), 0.5, { from: 900, to: 5200 });
timpaniRoll(at(4, 3.5), at(5, 1) - 0.03, 38, 0.08, 0.4);
odaiko(at(5, 1), 0.8); timpani(at(5, 1), 43, 0.55);
taiko(at(5, 3), 0.4); taiko(at(6, 1), 0.62); taiko(at(6, 4), 0.3); taiko(at(6, 4.5), 0.42);
bloom(at(5, 1), 0.35, { decay: 1.8 });
for (const c of chordsIn(5, 6)) {
  for (const m of c.ch.pad) strings(c.t, m, c.dur + 0.15, 0.46, { att: c.bar === 5 ? 0.35 : 0.2, rel: 0.9 });
  strings(c.t, c.ch.pad[3] + 12, c.dur + 0.15, 0.32, { att: 0.5, rel: 0.9 });
  strings(c.t, c.ch.bass, c.dur + 0.15, 0.55, { bus: buses.low, voices: 3, det: 6, att: 0.15, rel: 0.8, bright: 0.6 });
  strings(c.t, c.ch.bass + 12, c.dur + 0.15, 0.4, { bus: buses.low, voices: 3, det: 6, att: 0.15, rel: 0.8, bright: 0.6 });
  for (const m of [c.ch.bass + 12, c.ch.bass + 19, c.ch.bass + 24]) brass(c.t, m, c.dur - 0.05, 0.26, { att: 0.35, rel: 0.6 });
}
line([[5, 1, 4, 74, 0.9], [6, 1, 2, 76, 0.85], [6, 3, 2, 73, 0.8]], (t, m, d, v) => strings(t, m, d + 0.05, 0.52 * v, { voices: 5, det: 6, att: 0.25, rel: 0.7, bright: 1.1 }));
[43, 50, 55, 59, 62, 67, 71, 74, 79].forEach((m, i) => lute(at(5, 1) + i * BEAT / 4, m, 0.42 + i * 0.025, 1.8, -0.3 + i * 0.07));
celesta(at(5, 1), 86, 0.5, { pan: -0.3 }); celesta(at(5, 1) + 0.01, 93, 0.35, { pan: 0.3 });

// --- The Way Home (bars 7-11): warm and walking. Walking bass, the lute sings the answer, a harp turns underneath.
const WALK = [[7, [38, 45, 42, 40]], [8, [37, 40, 45, 40]], [9, [35, 42, 47, 45]], [10, [43, 47, 50, 47]], [11, [45, 40, 45, 49]]];
for (const [bar, notes] of WALK) notes.forEach((m, i) => { const pl = ksString(mtof(m), BEAT * 1.15, 0.72, { t60: 1.5, bright: 0.25, pick: 0.2 }); buses.pluck.mono(at(bar, i + 1), pl, i === 0 ? 1.05 : 0.88, 0); });
for (const c of chordsIn(7, 11)) {
  pad(c, 0.22, { att: 0.5, rel: 0.9, voices: 3, bright: 0.8 });
  strings(c.t, c.ch.bass + 12, c.dur + 0.1, 0.28, { bus: buses.low, voices: 2, att: 0.3, rel: 0.6, bright: 0.6 });
  arpeggio(c, { vel: 0.26, play: (t, m, v) => lute(t, m + 12, v, 1.2, 0.38, { bus: buses.harp, bright: 0.4 }) });
  frame(c.t, c.beat === 1 ? 0.5 : 0.35); if (c.len === 4) frame(c.t + beats(2), 0.36);
  frame(c.t + beats(c.len - 0.5), 0.16, 0.2);
}
line(answer(7), (t, m, d, v) => lute(t, m, 0.95 * v, Math.max(d, 1.0) + 0.5, -0.12, { t60: 2.8, bright: 0.55 }));
line(answer(7).map(([b, beat, len, m]) => [b, beat, len, m - 12, 0.5]), (t, m, d, v) => strings(t, m, d, 0.2 * v, { voices: 2, det: 5, att: 0.18, rel: 0.4, bright: 0.8, spread: 0.2 }));

// --- Lights (bars 12-14): gentle and glittering. Celesta, the flute enters, the strings sit high and soft.
{
  const random = nextRandom();
  const PENTA = [74, 76, 78, 81, 83, 86, 88, 90, 93, 95];
  for (const c of chordsIn(12, 14)) {
    for (const m of c.ch.pad) strings(c.t, m + (m < 62 ? 12 : 0), c.dur + 0.15, 0.22, { att: 0.7, rel: 1.0, voices: 3, bright: 0.9 });
    strings(c.t, c.ch.bass, c.dur + 0.15, 0.46, { bus: buses.low, voices: 3, att: 0.6, rel: 0.9, bright: 0.5 });
    strum(c.t, c.ch.arp.slice(1, 5), 0.3, { pan: -0.25 });
    const quiet = c.bar === 14;
    for (let i = 0; i < c.len * 2; i++) {
      if (quiet && i % 2) continue;
      const tone = c.ch.arp[ARP[i % 8]] + 24;
      celesta(c.t + i * BEAT / 2, tone, (quiet ? 0.24 : 0.33) * (i % 2 ? 0.75 : 1), { pan: (random() - 0.5) * 0.9 });
      if (!quiet && random() < 0.32) celesta(c.t + i * BEAT / 2 + BEAT / 4, PENTA[Math.floor(random() * PENTA.length)], 0.21, { pan: (random() - 0.5) * 1.2, ring: 1.8 });
    }
  }
  line([[12, 1, 3, 81, 0.9], [12, 4, 1, 78, 0.75], [13, 1, 2, 79, 0.85], [13, 3, 1.5, 83, 0.8], [13, 4.5, 0.5, 81, 0.6], [14, 1, 2, 76, 0.75], [14, 3, 2, 73, 0.6]],
    (t, m, d, v) => flute(t, m, d - 0.04, 0.56 * v));
  celesta(at(14, 1), 93, 0.26, { pan: 0.4, ring: 3 });
}

// --- The Forge (bars 15-18): rhythmic. An ostinato in 3+3+2, the bellows draw, the strike on bar 16 beat 3.
const ostinato = (bar, root, upTo = 8, scale = 1) => {
  const accents = { 0: 0.9, 2: 0.32, 3: 0.75, 5: 0.32, 6: 0.8, 7: 0.38 };
  for (const [i, v] of Object.entries(accents)) {
    const k = Number(i); if (k >= upTo) continue;
    const t = at(bar, 1 + k / 2), m = v > 0.5 ? root : root + 7;
    buses.pluck.mono(t, ksString(mtof(m), BEAT * 0.45, 0.8 * v * scale, { t60: 0.9, bright: 0.36, pick: 0.22 }), 1.5, 0);
    if (v > 0.5) shime(t, 0.6 * v * scale, 0.22);
    else tink(t, k % 3 ? 90 : 83, 0.3 * scale, k % 2 ? 0.45 : -0.35);
  }
};
ostinato(15, 35); ostinato(16, 35, 4);
for (const c of chordsIn(15, 15)) { pad(c, 0.22, { att: 0.4, rel: 0.6, bright: 0.6, voices: 3 }); strings(c.t, 35, c.dur + 0.1, 0.55, { bus: buses.low, voices: 3, att: 0.2, rel: 0.5, bright: 0.5 }); }
strings(at(16, 1), 35, beats(2), 0.55, { bus: buses.low, voices: 3, att: 0.05, rel: 0.2, bright: 0.5 });
for (const m of CH.Bm.pad) strings(at(16, 1), m, beats(1.9), 0.34, { att: 0.9, rel: 0.12, bright: 0.7, voices: 3 });
swell(at(16, 1), at(16, 3) - 0.004, 0.75, { from: 180, to: 1500, q: 0.7, lowpass: true, power: 2 });
const STRIKE = at(16, 3);
anvil(STRIKE, 1.0); odaiko(STRIKE, 1.0); timpani(STRIKE, 35, 0.9, { decay: 1.8 }); bloom(STRIKE, 0.45, { decay: 1.2 });
for (const m of [47, 54, 59, 62, 66]) brass(STRIKE, m, beats(1.6), 0.82, { att: 0.03, rel: 0.7, pan: 0 });
for (const m of [59, 62, 66, 71, 78]) strings(STRIKE, m, beats(1.7), 0.6, { att: 0.02, rel: 1.2 });
strings(STRIKE, 35, beats(1.7), 0.9, { bus: buses.low, voices: 3, att: 0.02, rel: 1.0, bright: 0.6 });
[95, 93, 90, 88, 86, 83, 81].forEach((m, i) => celesta(STRIKE + 0.11 + i * BEAT / 4 * (1 + i * 0.08), m, 0.36 - i * 0.03, { pan: 0.55 - i * 0.16, ring: 1.6 }));
// Flight (bar 17) and landing (bar 18).
for (const c of chordsIn(17, 18)) {
  pad(c, 0.3, { att: c.bar === 17 ? 0.5 : 0.08, rel: 0.6, bright: 0.85 });
  strings(c.t, c.ch.bass + 12, c.dur + 0.1, 0.42, { bus: buses.low, voices: 3, att: 0.3, rel: 0.5, bright: 0.6 });
  for (let i = 0; i < 8; i++) { const m = (i % 2 ? c.ch.bass + 19 : c.ch.bass + 12); buses.pluck.mono(c.t + i * BEAT / 2, ksString(mtof(m), BEAT * 0.45, (c.bar === 17 ? 0.34 : 0.46) + i * 0.02, { t60: 0.8, bright: 0.34 }), 1.4, 0); shime(c.t + i * BEAT / 2, (c.bar === 17 ? 0.16 : 0.26) * (i % 2 ? 0.7 : 1), -0.2); }
}
[55, 59, 62, 67, 71, 74, 79, 83].forEach((m, i) => { celesta(at(17, 1 + i / 2), m + 12, 0.24 + i * 0.03, { pan: -0.6 + i * 0.17, ring: 1.6 }); lute(at(17, 1 + i / 2), m, 0.3 + i * 0.03, 1.2, -0.2); });
const LANDING = at(18, 1);
taiko(LANDING, 0.62); strum(LANDING, [45, 52, 57, 61, 64, 69], 0.55, { gap: 0.018 }); celesta(LANDING, 81, 0.42, { pan: 0.1 }); celesta(LANDING + 0.008, 88, 0.3, { pan: -0.1 });
tink(LANDING + BEAT / 2, 86, 0.35, 0.2);
for (const m of [45, 52, 57, 61]) brass(at(18, 3), m, beats(2), 0.3, { att: 0.6, rel: 0.3 });

// --- Growth (bars 19-20): building. Spiccato strings, rising brass, drums thicken, a roll into the raid.
for (const c of chordsIn(19, 20)) {
  const n = c.len * 2;
  for (let i = 0; i < n; i++) {
    const k = (c.t + i * BEAT / 2 - at(19)) / beats(8);
    const m = c.ch.arp[ARP[i % 8]] + 12;
    strings(c.t + i * BEAT / 2, m, 0.15, 0.46 + 0.55 * k, { att: 0.012, rel: 0.09, voices: 3, vib: 0, bright: 1.05 });
    strings(c.t + i * BEAT / 2, c.ch.bass + (i % 2 ? 12 : 0), 0.2, 0.44 + 0.3 * k, { bus: buses.low, att: 0.01, rel: 0.08, voices: 2, vib: 0, bright: 0.7 });
    shime(c.t + i * BEAT / 2, 0.22 + 0.4 * k, 0.25);
    if (c.bar === 20) shime(c.t + i * BEAT / 2 + BEAT / 4, 0.16 + 0.3 * k, -0.25);
  }
  for (const m of c.ch.pad) brass(c.t, m, c.dur - 0.02, 0.38 + 0.18 * (c.bar - 19) + (c.name === 'A' ? 0.12 : 0), { att: c.bar === 19 ? 0.5 : 0.3, rel: 0.25 });
  for (const m of c.ch.pad) strings(c.t, m + 12, c.dur + 0.05, 0.24 + 0.2 * (c.bar - 19), { att: c.bar === 19 ? 1.2 : 0.5, rel: 0.3, voices: 3 });
}
taiko(at(19, 1), 0.62); taiko(at(19, 3), 0.48); taiko(at(19, 4.5), 0.36); taiko(at(20, 1), 0.72);
timpaniRoll(at(20, 1), at(21, 1) - 0.04, 45, 0.12, 0.85);
for (let i = 0; i < 4; i++) taiko(at(20, 3 + i / 2), 0.4 + i * 0.1, i % 2 ? 0.2 : -0.2);
swell(at(20, 1), at(21, 1), 1.0, { from: 700, to: 6500 });

// --- The raid (bars 21-26): the biggest and most driving. Taiko, a horn call, driving low strings, the choir arrives.
const RAID = at(21, 1);
bloom(RAID, 0.6, { decay: 1.6 }); odaiko(RAID, 1.0); timpani(RAID, 35, 0.85, { decay: 1.6 });
for (const c of chordsIn(21, 26)) {
  const eighths = c.len * 2;
  for (let i = 0; i < eighths; i++) {
    const t = c.t + i * BEAT / 2, m = c.ch.bass + ([0, 0, 12, 0, 0, 12, 0, 12][i % 8]);
    strings(t, m, 0.22, i % 4 === 0 ? 0.72 : 0.55, { bus: buses.low, att: 0.008, rel: 0.1, voices: 3, vib: 0, bright: 0.8 });
    buses.pluck.mono(t, ksString(mtof(c.ch.bass + 12), BEAT * 0.4, i % 4 === 0 ? 0.55 : 0.38, { t60: 0.7, bright: 0.35 }), 0.85, 0);
    shime(t, i % 4 === 2 ? 0.42 : 0.28, 0.3);
  }
  for (const m of c.ch.pad) brass(c.t, m - 12, c.dur - 0.03, 0.42, { att: 0.16, rel: 0.3, pan: -0.25 });
  for (const m of c.ch.pad) strings(c.t, m + 12, c.dur + 0.05, 0.42, { att: 0.25, rel: 0.4, voices: 4 });
  if (c.bar >= 25) for (const m of c.ch.pad) choir(c.t, m + 12, c.dur + 0.05, 0.3 + (c.bar - 25) * 0.08, { att: 0.5, rel: 0.5, vowel: 'a', to: 'a', spread: 0.8 });
}
for (let bar = 21; bar <= 26; bar++) {
  const hits = bar === 26 ? [[0, 1], [3, 0.7]] : [[0, 1], [3, 0.72], [4, 0.88], [6, 0.66], ...(bar % 2 === 0 ? [[7, 0.5]] : [])];
  for (const [i, v] of hits) (i === 0 ? odaiko : taiko)(at(bar, 1 + i / 2), v * (i === 0 ? 0.85 : 1), i % 2 ? 0.15 : -0.1);
}
for (let i = 0; i < 8; i++) taiko(at(26, 3 + i / 4), 0.42 + i * 0.07, i % 2 ? 0.25 : -0.25);
timpaniRoll(at(26, 3), at(27, 1) - 0.04, 38, 0.2, 0.7);
swell(at(26, 1), at(27, 1), 0.6, { from: 900, to: 6000 });
const HORN_CALL = [
  [21, 1, 1.5, 59], [21, 2.5, 0.5, 66], [21, 3, 2, 66],
  [22, 1, 1.5, 67], [22, 2.5, 0.5, 66], [22, 3, 2, 62],
  [23, 1, 1.5, 69], [23, 2.5, 0.5, 66], [23, 3, 1, 62], [23, 4, 1, 66],
  [24, 1, 3, 64], [24, 4, 1, 61],
  [25, 1, 1.5, 71], [25, 2.5, 0.5, 69], [25, 3, 2, 66],
  [26, 1, 1, 67], [26, 2, 1, 71], [26, 3, 2, 73],
];
line(HORN_CALL, (t, m, d) => { brass(t, m, d - 0.04, 0.95, { att: 0.07, rel: 0.25, pan: 0.05 }); brass(t, m - 12, d - 0.04, 0.6, { att: 0.08, rel: 0.25, pan: -0.15 }); });
line(HORN_CALL.filter(([b]) => b >= 25), (t, m, d) => strings(t, m + 12, d, 0.5, { voices: 5, att: 0.06, rel: 0.4, bright: 1.1 }));

// --- Rise to the map (bars 27-31): soaring. The choir sings the answer, strings below it, broad drums, glitter of ink.
const MAP = at(27, 1);
bloom(MAP, 0.4, { decay: 2.2 }); odaiko(MAP, 0.7); timpani(MAP, 38, 0.6, { decay: 2 });
for (const c of chordsIn(27, 31)) {
  const fadeOut = c.bar === 31 ? 0.75 : 1;
  for (const m of c.ch.pad) choir(c.t, m, c.dur + 0.1, 0.3 * fadeOut, { att: 0.35, rel: 0.7, vowel: 'a', to: 'o', spread: 0.9 });
  for (const m of c.ch.pad) strings(c.t, m + 12, c.dur + 0.1, 0.28 * fadeOut, { att: 0.35, rel: 0.6, voices: 4 });
  for (const m of c.ch.pad.slice(0, 3)) brass(c.t, m - 12, c.dur - 0.03, 0.26 * fadeOut, { att: 0.35, rel: 0.35, pan: -0.2 });
  strings(c.t, c.ch.bass, c.dur + 0.1, 0.5 * fadeOut, { bus: buses.low, voices: 3, att: 0.2, rel: 0.6, bright: 0.6 });
  strings(c.t, c.ch.bass + 12, c.dur + 0.1, 0.34 * fadeOut, { bus: buses.low, voices: 3, att: 0.2, rel: 0.6, bright: 0.6 });
  if (c.beat === 1 && c.bar > 27) { timpani(c.t, c.ch.bass + 12 > 47 ? c.ch.bass : c.ch.bass + 12, 0.55 * fadeOut); taiko(c.t, 0.5 * fadeOut); }
  if (c.len === 4 && c.bar < 31) taiko(c.t + beats(2), 0.3);
  strum(c.t, c.ch.arp.slice(0, 4), 0.32 * fadeOut, { pan: -0.3 });
  for (let i = 0; i < c.len * 2; i++) celesta(c.t + i * BEAT / 2, c.ch.arp[ARP[(i + 2) % 8]] + 24, (i % 2 ? 0.2 : 0.28) * fadeOut, { pan: Math.sin(i * 1.7 + c.bar) * 0.6, ring: 2 });
}
line(answer(27), (t, m, d, v) => { choir(t, m, d + 0.03, 0.56 * v, { att: 0.12, rel: 0.5, vowel: 'a', to: 'o', voices: 4, spread: 0.3 }); strings(t, m - 12, d, 0.4 * v, { voices: 5, att: 0.1, rel: 0.5, bright: 1.05 }); });

// --- Close (bars 32-33, tail to 88 s): resolving softly. The lute returns alone over the last strings and voices.
for (const c of chordsIn(32, 33)) {
  const hold = c.bar === 33 ? 1.4 : 0.15;
  for (const m of c.ch.pad) strings(c.t, m, c.dur + hold, 0.19, { att: 0.9, rel: c.bar === 33 ? 2.0 : 1.0, voices: 3, bright: 0.75 });
  for (const m of c.ch.pad.slice(1)) choir(c.t, m + 12, c.dur + hold, 0.18, { att: 1.0, rel: c.bar === 33 ? 1.8 : 1.0, vowel: 'o', to: 'u', spread: 0.8 });
  strings(c.t, c.ch.bass, c.dur + hold, 0.4, { bus: buses.low, voices: 3, att: 0.8, rel: c.bar === 33 ? 2.0 : 1.0, bright: 0.5 });
}
[[32, 1, 43], [32, 2, 50], [32, 3, 57], [32, 4, 59], [32, 4.5, 62], [33, 1, 50], [33, 2, 57], [33, 3, 62], [33, 4, 66]].forEach(([bar, beat, m], i) => lute(at(bar, beat), m, 0.62 + (i === 0 || i === 5 ? 0.06 : 0), 3.2, -0.14));
line([[32, 1, 2, 83, 0.6], [32, 3, 2, 81, 0.55], [33, 1, 3, 78, 0.5]], (t, m, d, v) => flute(t, m, d, 0.6 * v));
const LAST = at(34, 1);
lute(LAST, 69, 0.58, 2.3, -0.1); celesta(LAST + 0.01, 86, 0.3, { pan: 0.2, ring: 2.4 });

// ---------------------------------------------------------------------------------------------------------------
// Mix: bus EQ, send to the hall, master high-pass, look-ahead limiter, edge fades.
// ---------------------------------------------------------------------------------------------------------------
console.log('[temp-bed] notes rendered; mixing');
const mixL = new Float32Array(N), mixR = new Float32Array(N), sendL = new Float32Array(N), sendR = new Float32Array(N);
const BUS_GAIN = { lute: 0.5, harp: -1, pluck: -1.5, strings: 0, low: -2.5, choir: 0.5, brass: -1.5, flute: 0, celesta: 1.5, drums: -2, anvil: -2, air: -6 };
const busStats = {};
const SECTION_EDGES = [0, at(5), at(7), at(12), at(15), at(19), at(21), at(27), at(32), at(34), DURATION + 1];
for (const bus of Object.values(buses)) {
  for (const [type, f, q, g] of bus.eq) { new Biquad(type, f, q, g).run(bus.L); new Biquad(type, f, q, g).run(bus.R); }
  const g = db(BUS_GAIN[bus.name] ?? 0);
  let peak = 0, sum = 0;
  const parts = new Float64Array(SECTION_EDGES.length - 1);
  for (let i = 0, p = 0; i < N; i++) {
    const l = bus.L[i] * g, r = bus.R[i] * g;
    mixL[i] += l; mixR[i] += r; sendL[i] += l * bus.send; sendR[i] += r * bus.send;
    peak = Math.max(peak, Math.abs(l), Math.abs(r)); sum += l * l + r * r;
    while (i >= SECTION_EDGES[p + 1] * SR) p++;
    parts[p] += l * l + r * r;
  }
  busStats[bus.name] = { peakDb: +(20 * Math.log10(peak + 1e-12)).toFixed(1), rmsDb: +(10 * Math.log10(sum / (2 * N) + 1e-24)).toFixed(1),
    byChapter: Array.from(parts, (e, k) => +(10 * Math.log10(e / (2 * (SECTION_EDGES[k + 1] - SECTION_EDGES[k]) * SR) + 1e-12)).toFixed(1)) };
  bus.L = null; bus.R = null;
}
console.log('[temp-bed] buses', JSON.stringify(busStats));

/** Freeverb (Jezar's public-domain design): eight damped combs and four allpasses per side, tunings scaled to 48 kHz. */
function hall(inL, inR, { room = 0.86, damp = 0.42, width = 1, predelay = 0.024 } = {}) {
  const scale = SR / 44100, spread = 23;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], apT = [556, 441, 341, 225];
  const fb = room * 0.28 + 0.7, d1 = damp * 0.4, d2 = 1 - d1;
  const mk = n => ({ buf: new Float32Array(n), i: 0, store: 0 });
  const sides = [0, spread].map(off => ({ combs: combT.map(c => mk(Math.round((c + off) * scale))), aps: apT.map(a => mk(Math.round((a + off) * scale))) }));
  for (const x of [inL, inR]) { new Biquad('hp', 190).run(x); new Biquad('lp', 6500).run(x); }
  const pd = Math.round(predelay * SR), outL = new Float32Array(N), outR = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const input = n >= pd ? (inL[n - pd] + inR[n - pd]) * 0.015 : 0;
    for (let s = 0; s < 2; s++) {
      const side = sides[s];
      let out = 0;
      for (const c of side.combs) {
        const y = c.buf[c.i]; c.store = y * d2 + c.store * d1; c.buf[c.i] = input + c.store * fb;
        if (++c.i >= c.buf.length) c.i = 0; out += y;
      }
      for (const a of side.aps) {
        const b = a.buf[a.i]; const y = -out + b; a.buf[a.i] = out + b * 0.5;
        if (++a.i >= a.buf.length) a.i = 0; out = y;
      }
      (s ? outR : outL)[n] = out;
    }
  }
  const w1 = (width / 2 + 0.5), w2 = (1 - width) / 2;
  for (let n = 0; n < N; n++) { const l = outL[n], r = outR[n]; outL[n] = l * w1 + r * w2; outR[n] = r * w1 + l * w2; }
  return [outL, outR];
}
const [revL, revR] = hall(sendL, sendR);
const REVERB_RETURN = db(4.5);
for (let i = 0; i < N; i++) { mixL[i] += revL[i] * REVERB_RETURN; mixR[i] += revR[i] * REVERB_RETURN; }
for (const x of [mixL, mixR]) { new Biquad('hp', 26, 0.6).run(x); new Biquad('peak', 280, 0.8, -1.5).run(x); new Biquad('highshelf', 4500, 0.7, 2.5).run(x); }

// Level: put the loudest sustained passage at a sensible level, then a look-ahead limiter catches the drum peaks.
const CEILING = db(-1.5);
{
  let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(mixL[i]), Math.abs(mixR[i]));
  const pre = CEILING / peak * db(2.5);
  for (let i = 0; i < N; i++) { mixL[i] *= pre; mixR[i] *= pre; }
}
const limiterStats = (() => {
  const look = Math.round(0.005 * SR), relTau = 0.12 * SR, req = new Float32Array(N);
  for (let i = 0; i < N; i++) { const p = Math.max(Math.abs(mixL[i]), Math.abs(mixR[i])); req[i] = p > CEILING ? CEILING / p : 1; }
  // Running minimum over the look-ahead window (a monotonic deque), then instant attack, smooth release, then a moving average.
  const g1 = new Float32Array(N), dq = new Int32Array(N); let h = 0, t = 0;
  for (let i = N - 1; i >= 0; i--) {
    while (t > h && req[dq[t - 1]] >= req[i]) t--;
    dq[t++] = i;
    while (dq[h] > i + look) h++;
    g1[i] = req[dq[h]];
  }
  const g2 = new Float32Array(N); let g = 1;
  const rc = 1 - Math.exp(-1 / relTau);
  for (let i = 0; i < N; i++) { g = g1[i] < g ? g1[i] : g + (1 - g) * rc; g2[i] = Math.min(g, g1[i]); }
  let acc = 0, minGain = 1, limited = 0;
  for (let i = 0; i < N; i++) {
    acc += g2[i]; if (i >= look) acc -= g2[i - look];
    // Every g2 in the last `look` samples already sits at or below this sample's requirement, so the mean does too.
    const gg = acc / Math.min(i + 1, look);
    mixL[i] *= gg; mixR[i] *= gg;
    if (gg < 0.999) limited++;
    minGain = Math.min(minGain, gg);
  }
  return { maxReductionDb: +(-20 * Math.log10(minGain)).toFixed(2), limitedSeconds: +(limited / SR).toFixed(2) };
})();
console.log('[temp-bed] limiter', JSON.stringify(limiterStats));
{
  const fin = Math.round(0.004 * SR), fout = Math.round(1.6 * SR);
  for (let i = 0; i < fin; i++) { const g = i / fin; mixL[i] *= g; mixR[i] *= g; }
  for (let i = 0; i < fout; i++) { const g = 0.5 + 0.5 * Math.cos(Math.PI * i / fout), j = N - fout + i; mixL[j] *= g; mixR[j] *= g; }
}

// ---------------------------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------------------------
function wav24(path, L, R) {
  const frames = L.length, bytes = Buffer.alloc(44 + frames * 6);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + frames * 6, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(SR, 24);
  bytes.writeUInt32LE(SR * 6, 28); bytes.writeUInt16LE(6, 32); bytes.writeUInt16LE(24, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 6, 40);
  let clipped = 0, peak = 0, o = 44;
  for (let i = 0; i < frames; i++) for (const x of [L[i], R[i]]) {
    peak = Math.max(peak, Math.abs(x));
    let v = Math.round(x * 8388607);
    if (v > 8388607) { v = 8388607; clipped++; } else if (v < -8388608) { v = -8388608; clipped++; }
    bytes.writeIntLE(v, o, 3); o += 3;
  }
  writeFileSync(path, bytes);
  return { clipped, samplePeakDb: +(20 * Math.log10(peak)).toFixed(2) };
}
mkdirSync(OUT, { recursive: true });
const written = wav24(RAW, mixL, mixR);
console.log('[temp-bed] wrote', RAW, JSON.stringify(written));

// Clicks: 1 ms blocks whose energy above 10 kHz jumps 24 dB over the median of the surrounding 60 ms, away from
// every scheduled onset (plucks, drums and strikes are meant to have a transient). Reported for the record.
const discontinuity = (() => {
  const hf = Float32Array.from(mixL, (x, i) => (x + mixR[i]) / 2);
  new Biquad('hp', 10000, 0.7).run(hf); new Biquad('hp', 10000, 0.7).run(hf);
  const B = SR / 1000, blocks = Math.floor(N / B), e = new Float64Array(blocks);
  for (let b = 0; b < blocks; b++) { let s = 0; for (let i = b * B; i < (b + 1) * B; i++) s += hf[i] * hf[i]; e[b] = s / B; }
  const near = t => ONSETS.some(o => t >= o - 0.003 && t <= o + 0.012);
  const found = [];
  for (let b = 30; b < blocks - 30; b++) {
    const win = Array.from(e.subarray(b - 30, b + 30)).sort((x, y) => x - y), med = win[30] + 1e-14;
    if (e[b] > med * 10 ** 2.4 && e[b] > 1e-10 && !near(b / 1000)) found.push(+(b / 1000).toFixed(3));
  }
  return { method: 'energy above 10 kHz per 1 ms, 24 dB over the local median, not at a note onset', unexplained: found.length, at: found.slice(0, 20) };
})();

// ---------------------------------------------------------------------------------------------------------------
// The grid and the markers for the edit
// ---------------------------------------------------------------------------------------------------------------
const r4 = x => Math.round(x * 10000) / 10000;
const chapters = [
  { id: 'opening', shots: 'S01-S03', bar: 1, start: 0, end: at(5), feel: 'Sparse and intimate: a lute alone over the softest strings. Starts with a two-beat pickup; bar 1 lands at 1.277 s.' },
  { id: 'island', shots: 'S04', bar: 5, start: at(5), end: at(7), feel: 'The lift: a low drum, the strings swell, horns underneath, the lute sweeps up. Card: CHATDOM on the downbeat.' },
  { id: 'way-home', shots: 'S05-S07', bar: 7, start: at(7), end: at(12), feel: 'Warm and walking: walking bass, the lute sings the answer to the opening theme, a harp turns, a soft frame drum.' },
  { id: 'lights', shots: 'S08-S09', bar: 12, start: at(12), end: at(15), feel: 'Gentle and glittering: celesta, the flute enters, high soft strings. Bar 14 thins out for the quiet one.' },
  { id: 'forge', shots: 'S10-S12', bar: 15, start: at(15), end: at(19), feel: 'Rhythmic: a 3+3+2 ostinato with hammer tinks, the bellows draw, the anvil strike, then the flight and the landing.' },
  { id: 'growth', shots: 'S13', bar: 19, start: at(19), end: at(21), feel: 'Building: spiccato strings, rising horns, the drums thicken, a roll into the raid.' },
  { id: 'raid', shots: 'S14-S18', bar: 21, start: at(21), end: at(27), feel: 'The biggest and most driving: taiko, a horn call, driving low strings; the choir arrives in bar 25; a drum fill into the map.' },
  { id: 'map', shots: 'S19-S21', bar: 27, start: at(27), end: at(32), feel: 'Soaring: the choir sings the answer, strings and horns below, broad drums, a glitter of ink.' },
  { id: 'close', shots: 'S22', bar: 32, start: at(32), end: at(34), feel: 'Resolving softly: IV to I, the lute alone over the last strings, the flute and the voices.' },
  { id: 'tail', shots: 'after S22', bar: 34, start: at(34), end: DURATION, feel: 'The last lute note and its reverb; faded out over the last 1.6 s.' },
].map(c => ({ ...c, start: r4(c.start), end: r4(c.end) }));
const hits = [
  { id: 'island-reveal', time: at(5, 1), bar: 5, beat: 1, what: 'Low drum and the string swell: the island and the CHATDOM card (S04).' },
  { id: 'way-home', time: at(7, 1), bar: 7, beat: 1, what: 'The walking bass starts (S05).' },
  { id: 'lights', time: at(12, 1), bar: 12, beat: 1, what: 'The celesta begins: chat becomes lights (S08).' },
  { id: 'forge-wish', time: at(15, 1), bar: 15, beat: 1, what: 'The forge ostinato starts (S10).' },
  { id: 'forge-strike', time: STRIKE, bar: 16, beat: 3, what: 'THE HAMMER STRIKE: anvil, drum, a Bm stab and sparks. Put the picture\'s impact frame here (S11).' },
  { id: 'forge-landing', time: LANDING, bar: 18, beat: 1, what: 'The piece lands: a drum, a lute strum and a chime (S12).' },
  { id: 'growth', time: at(19, 1), bar: 19, beat: 1, what: 'The growth build begins (S13).' },
  { id: 'raid-drop', time: RAID, bar: 21, beat: 1, what: 'THE RAID DROP: the full drums and the horn call. Twitch\'s raid notice lands here (S14).' },
  { id: 'map-rise', time: MAP, bar: 27, beat: 1, what: 'THE MAP RISE: the choir and the broad drums; the kingdom falls away into the Atlas (S19).' },
  { id: 'close', time: at(32, 1), bar: 32, beat: 1, what: 'The close: the lute returns (S22). The end card can come in here or on bar 33.' },
  { id: 'final-chord', time: at(33, 1), bar: 33, beat: 1, what: 'The home chord, D major.' },
  { id: 'last-note', time: LAST, bar: 34, beat: 1, what: 'The last lute note; everything after is tail.' },
].map(h => ({ ...h, time: r4(h.time) }));
const CHORD_LABEL = { GD: 'G/D', AC: 'A/C#', Asus4: 'Asus4', Dadd9: 'Dadd9', Gadd9: 'Gadd9' };
const beatTimes = []; for (let n = 0; n * BEAT < DURATION; n++) beatTimes.push(r4(n * BEAT));
const bars = []; for (let b = 1; at(b) < DURATION; b++) bars.push({ bar: b, time: r4(at(b)), chords: (BARS[b] ?? []).map(([name, beat]) => { const label = CHORD_LABEL[name] ?? name; return beat === 1 ? label : `${label} (beat ${beat})`; }).join(', ') || 'tail' });

const grid = {
  status: 'TEMPORARY. A temp bed for the rough cut only. Never publish, never ship, never upload, never put it in a cut that leaves this team. The final music is Tobias\'s decision.',
  generator: 'apps/studio/sound/temp-bed.mjs (offline synthesis in Node, deterministic)',
  files: { raw: RAW, normalised: NORM, spectrogram: join(OUT, 'temp-bed-spectrogram.png'), strikeCloseUp: join(OUT, 'temp-bed-spectrogram-strike.png') },
  format: { sampleRate: SR, channels: 2, bits: 24, durationSeconds: DURATION },
  key: 'D major (the kingdom sound palette is D major pentatonic)',
  tempo: { bpm: BPM, meter: '4/4', beatSeconds: r4(BEAT), barSeconds: r4(4 * BEAT), pickupBeats: PICKUP, firstDownbeat: r4(at(1)), note: 'Beat n is at n * beatSeconds from 0. Bar 1 starts on beat 2 (a two-beat pickup), so bar k starts at (2 + 4(k-1)) * beatSeconds.' },
  chapters,
  hits,
  bars,
  beats: beatTimes,
  mix: { buses: busStats, limiter: limiterStats, written, discontinuity },
};
writeFileSync(JSON_OUT, JSON.stringify(grid, null, 2) + '\n');

writeFileSync(join(OUT, 'README.md'), `# TEMPORARY MUSIC: never publish

Everything in this folder is a **temporary bed for the teaser's rough cut**. It is not the teaser's music. Never
publish it, upload it, ship it, or put it in a cut that leaves the team. The final music is Tobias's decision.

- \`temp-bed.wav\`: the raw mix, 48 kHz, 24-bit, stereo, ${DURATION} s, sample peak -1.5 dBFS.
- \`temp-bed-18lufs.wav\`: the same, loudness-normalised (two-pass loudnorm, linear) to -18 LUFS integrated with the
  true peak below -1 dBTP. Use this one in the edit.
- \`temp-bed-spectrogram.png\`, \`temp-bed-spectrogram-strike.png\`: the whole bed and a close-up of the forge strike.

Made by \`apps/studio/sound/temp-bed.mjs\` (offline synthesis, no samples). The tempo (${BPM} BPM, 4/4, a two-beat pickup),
every beat and bar, the chapter markers and the hit points (forge strike ${r4(STRIKE)} s, raid drop ${r4(RAID)} s,
map rise ${r4(MAP)} s) are in \`apps/studio/sound/temp-bed.json\`.
`);

// ---------------------------------------------------------------------------------------------------------------
// Normalise and measure (ffmpeg, niced, four threads at most)
// ---------------------------------------------------------------------------------------------------------------
function ffmpeg(args) {
  const run = spawnSync('nice', ['-n', '19', 'ffmpeg', '-hide_banner', '-nostats', '-y', '-threads', '4', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr.slice(-2000)}`);
  return run.stderr;
}
const lastJson = text => JSON.parse(text.slice(text.lastIndexOf('{'), text.lastIndexOf('}') + 1));
function ebur128(path) {
  const err = ffmpeg(['-i', path, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = err.slice(err.lastIndexOf('Summary:'));
  const num = re => Number((summary.match(re) ?? [])[1]);
  // Loudest momentary and short-term values from the per-frame log, for the record.
  let maxM = -Infinity, maxS = -Infinity;
  for (const m of err.matchAll(/M:\s*(-?[\d.]+)\s+S:\s*(-?[\d.]+)/g)) { maxM = Math.max(maxM, Number(m[1])); maxS = Math.max(maxS, Number(m[2])); }
  return { integratedLufs: num(/I:\s*(-?[\d.]+) LUFS/), lraLu: num(/LRA:\s*(-?[\d.]+) LU/), truePeakDbtp: num(/Peak:\s*(-?[\d.]+) dBFS/), maxMomentaryLufs: maxM, maxShortTermLufs: maxS };
}
function astats(path) {
  const err = ffmpeg(['-i', path, '-af', 'astats=measure_perchannel=none', '-f', 'null', '-']);
  const pick = key => Number((err.match(new RegExp(`${key}:\\s*(-?[\\d.]+|-inf)`)) ?? [])[1]);
  return { peakDb: pick('Peak level dB'), rmsDb: pick('RMS level dB'), dcOffset: pick('DC offset'), flatFactor: pick('Flat factor'), peakCount: pick('Peak count') };
}

if (RUN_FFMPEG) {
  const I = -18, TP = -1.5, LRA = 20;
  const first = lastJson(ffmpeg(['-i', RAW, '-af', `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`, '-f', 'null', '-']));
  const second = lastJson(ffmpeg(['-i', RAW, '-af',
    `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:measured_I=${first.input_i}:measured_TP=${first.input_tp}:measured_LRA=${first.input_lra}:measured_thresh=${first.input_thresh}:offset=${first.target_offset}:linear=true:print_format=json`,
    '-ar', String(SR), '-c:a', 'pcm_s24le', NORM]));
  ffmpeg(['-i', NORM, '-lavfi', 'showspectrumpic=s=1600x640:legend=1:scale=log:fscale=lin:color=intensity:gain=1', join(OUT, 'temp-bed-spectrogram.png')]);
  ffmpeg(['-ss', String(r4(STRIKE - 1)), '-t', '3', '-i', NORM, '-lavfi', 'showspectrumpic=s=1200x600:legend=1:scale=log:fscale=lin:color=intensity', join(OUT, 'temp-bed-spectrogram-strike.png')]);
  grid.loudness = {
    raw: { ...ebur128(RAW), ...astats(RAW) },
    normalised: { ...ebur128(NORM), ...astats(NORM), loudnorm: { normalizationType: second.normalization_type, inputI: Number(first.input_i), inputTP: Number(first.input_tp), inputLRA: Number(first.input_lra), targetOffset: Number(first.target_offset) } },
    target: { integratedLufs: I, truePeakDbtp: TP, note: 'Two-pass loudnorm, linear; true peak target -1.5 dBTP so the copy stays below -1 dBTP.' },
  };
  writeFileSync(JSON_OUT, JSON.stringify(grid, null, 2) + '\n');
  console.log('[temp-bed] loudness', JSON.stringify(grid.loudness, null, 1));
}
console.log('[temp-bed] grid', JSON_OUT);
