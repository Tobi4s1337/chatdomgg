import { generator, logRange, range } from './rng';

/**
 * Textures the live graph cannot make cheaply from filtered noise, synthesised here sample by sample from a seed:
 * a brook's bubbles, rain on ground and on water, crickets and grasshoppers. They are played as overlapping grains
 * from random offsets (see `beds.ts`), so a listener never hears the same seconds twice in a row.
 *
 * The liquid sounds follow the physical bubble model of K. van den Doel, "Physically-based models for liquid
 * sounds" (ACM TAP, 2005): a struck bubble rings at its Minnaert frequency, damped by viscosity and radiation, and
 * its pitch rises as it nears the surface. Written from the paper; no code was taken.
 */
export type TextureKey = 'babble' | 'rush' | 'rain-ground' | 'rain-leaves' | 'rain-water' | 'crickets' | 'grasshoppers';

export interface TextureSpec { key: TextureKey; seconds: number; rate: number }

/** Lengths and rates: long enough that grains from distant offsets never sound alike; rates just above the band. */
export const TEXTURES: Readonly<Record<TextureKey, TextureSpec>> = {
  babble: { key: 'babble', seconds: 9, rate: 24000 },
  rush: { key: 'rush', seconds: 7, rate: 32000 },
  'rain-ground': { key: 'rain-ground', seconds: 6, rate: 32000 },
  'rain-leaves': { key: 'rain-leaves', seconds: 6, rate: 32000 },
  'rain-water': { key: 'rain-water', seconds: 6, rate: 32000 },
  crickets: { key: 'crickets', seconds: 8, rate: 32000 },
  grasshoppers: { key: 'grasshoppers', seconds: 10, rate: 32000 },
};

/** Every texture is normalised to this RMS so bed gains mean the same thing for each; peaks stay under 0.9. */
export const TEXTURE_RMS = 0.1;

export function synthTexture(key: TextureKey, seed: number): Float32Array {
  const spec = TEXTURES[key];
  const data = new Float32Array(Math.round(spec.seconds * spec.rate));
  const random = generator(seed ^ hashKey(key));
  switch (key) {
    case 'babble': brook(data, spec.rate, random, { perSecond: 210, low: 210, high: 2400, rise: 0.1, floor: 0.12 }); break;
    case 'rush': brook(data, spec.rate, random, { perSecond: 900, low: 480, high: 5200, rise: 0.14, floor: 0.4 }); break;
    case 'rain-ground': drops(data, spec.rate, random, { perSecond: 520, bright: [900, 3200], bubble: 0.02 }); break;
    case 'rain-leaves': drops(data, spec.rate, random, { perSecond: 640, bright: [2600, 7500], bubble: 0 }); break;
    case 'rain-water': drops(data, spec.rate, random, { perSecond: 420, bright: [1500, 5000], bubble: 0.32 }); break;
    case 'crickets': crickets(data, spec.rate, random); break;
    case 'grasshoppers': grasshoppers(data, spec.rate, random); break;
  }
  return normalise(data);
}

function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return h >>> 0;
}

/**
 * One ringing bubble added into `data` (van den Doel): Minnaert pitch, rising as it surfaces, damped. Computed as a
 * decaying rotation (two multiplies per sample) whose step is re-tuned every 16 samples for the rising pitch, and
 * stopped once it has fallen ~43 dB, where a dense texture hides it.
 */
function bubble(data: Float32Array, rate: number, at: number, f0: number, amplitude: number, rise: number): void {
  const damping = 0.043 * f0 + 0.0014 * f0 ** 1.5;
  const length = Math.min(data.length - at, Math.ceil((5 / damping) * rate));
  const sigma = rise * damping, decay = Math.exp(-damping / rate), onset = rate * 0.0004;
  let re = 0, im = amplitude, c = 1, s = 0;
  for (let i = 0; i < length; i++) {
    if ((i & 15) === 0) {
      const w = (2 * Math.PI * f0 * (1 + (sigma * i) / rate)) / rate;
      c = decay * Math.cos(w); s = decay * Math.sin(w);
    }
    const next = re * c - im * s;
    im = re * s + im * c; re = next;
    // A 0.4 ms onset so the bubble's start is a breath, not a click.
    data[at + i]! += i < onset ? im * (i / onset) : im;
  }
}

/**
 * A brook: bubbles arrive in clusters (gurgles) whose density follows a slow random swell, over a soft wash of
 * low-passed noise. `rush` is the same water falling harder: denser, smaller, higher bubbles and more wash.
 */
function brook(data: Float32Array, rate: number, random: () => number,
  options: { perSecond: number; low: number; high: number; rise: number; floor: number }): void {
  const seconds = data.length / rate;
  // Slow swell of activity (0.4–1.6 Hz wobble) so the water seems to talk rather than hiss evenly.
  const knots = Array.from({ length: Math.ceil(seconds * 3) + 2 }, () => random());
  const swell = (t: number) => {
    const x = t * 3, k = Math.floor(x), f = x - k, a = knots[k]!, b = knots[k + 1]!;
    return a + (b - a) * (f * f * (3 - 2 * f));
  };
  let t = 0;
  while (t < seconds) {
    const density = options.perSecond * (0.35 + 1.3 * swell(t));
    t += -Math.log(1 - random()) / density;
    const at = Math.floor(t * rate);
    if (at >= data.length) break;
    // Bigger bubbles (lower) are commoner and louder in a brook; small high ones sparkle on top.
    const f0 = logRange(random() ** 1.7, options.low, options.high);
    const amplitude = (f0 / 600) ** -0.55 * range(random(), 0.15, 1) * 0.5;
    bubble(data, rate, at, f0, amplitude, options.rise * range(random(), 0.6, 1.4));
  }
  // The wash under the bubbles: brown-ish noise with a gentle lift around 500 Hz.
  let low = 0, lower = 0;
  for (let i = 0; i < data.length; i++) {
    const white = random() * 2 - 1;
    low += 0.12 * (white - low);
    lower += 0.02 * (low - lower);
    data[i]! += (low - lower) * options.floor * 2.2;
  }
}

/**
 * Rain: many tiny impacts (most faint, a few close) as damped clicks through a one-pole filter of random
 * brightness; on water a share of drops trap a bubble and add the characteristic high plink.
 */
function drops(data: Float32Array, rate: number, random: () => number,
  options: { perSecond: number; bright: readonly [number, number]; bubble: number }): void {
  const seconds = data.length / rate;
  let t = 0;
  while (t < seconds) {
    t += -Math.log(1 - random()) / options.perSecond;
    const at = Math.floor(t * rate);
    if (at >= data.length) break;
    const amplitude = 0.04 + 0.96 * random() ** 4;
    const cutoff = logRange(random(), options.bright[0], options.bright[1]);
    const a = Math.exp((-2 * Math.PI * cutoff) / rate);
    const decay = range(random(), 0.0008, 0.003);
    const length = Math.min(data.length - at, Math.ceil(decay * 7 * rate));
    let state = 0;
    for (let i = 0; i < length; i++) {
      const excite = (random() * 2 - 1) * Math.exp(-i / (decay * rate));
      state = a * state + (1 - a) * excite;
      data[at + i]! += state * amplitude * 1.6;
    }
    if (random() < options.bubble) {
      bubble(data, rate, Math.min(data.length - 1, at + Math.floor(rate * 0.001)), logRange(random(), 1100, 4200), amplitude * range(random(), 0.15, 0.5), 0.25);
    }
  }
}

/**
 * A field of crickets: seven animals, each with its own carrier (4.0–5.3 kHz), chirp rate, pulse count and level,
 * none synchronised. Above the speech band, so a stream voice stays clear over a summer night.
 */
function crickets(data: Float32Array, rate: number, random: () => number): void {
  const seconds = data.length / rate;
  for (let n = 0; n < 7; n++) {
    const carrier = range(random(), 4000, 5300), period = range(random(), 0.42, 0.85), pulses = 3 + Math.floor(random() * 2);
    const pulse = range(random(), 0.011, 0.018), gap = range(random(), 0.008, 0.013);
    const level = range(random(), 0.15, 1) ** 1.5;
    let chirp = random() * period, phase = random() * 6.283;
    while (chirp < seconds) {
      for (let p = 0; p < pulses; p++) {
        const start = Math.floor((chirp + p * (pulse + gap)) * rate), length = Math.floor(pulse * rate);
        for (let i = 0; i < length && start + i < data.length; i++) {
          const shape = Math.sin((Math.PI * i) / length) ** 2;
          phase += (2 * Math.PI * carrier) / rate;
          data[start + i]! += Math.sin(phase) * shape * level * 0.5;
        }
      }
      chirp += period * range(random(), 0.95, 1.05);
    }
  }
}

/**
 * Grasshoppers in warm grass: a few animals stridulating in bursts of 0.6–1.8 s, a buzz of noise in 6–10 kHz
 * pulsed at 25–55 Hz, then silence. Day only; dry and very high, far from a voice.
 */
function grasshoppers(data: Float32Array, rate: number, random: () => number): void {
  const seconds = data.length / rate;
  for (let n = 0; n < 4; n++) {
    const centre = range(random(), 6200, 9500), pulseHz = range(random(), 25, 55), level = range(random(), 0.3, 1);
    // A resonant two-pole band-pass, written out so the texture is the same in every runtime.
    const w = (2 * Math.PI * centre) / rate, q = 3.5, alpha = Math.sin(w) / (2 * q);
    const b0 = alpha / (1 + alpha), a1 = (-2 * Math.cos(w)) / (1 + alpha), a2 = (1 - alpha) / (1 + alpha);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    let t = random() * 2;
    while (t < seconds) {
      const burst = range(random(), 0.6, 1.8), start = Math.floor(t * rate), length = Math.floor(burst * rate);
      for (let i = 0; i < length && start + i < data.length; i++) {
        const time = i / rate;
        const envelope = Math.min(1, time / 0.08, (burst - time) / 0.12);
        const pulse = 0.5 - 0.5 * Math.cos(2 * Math.PI * pulseHz * time);
        const x0 = random() * 2 - 1, y0 = b0 * x0 - b0 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        data[start + i]! += y0 * pulse ** 2 * envelope * level * 0.6;
      }
      t += burst + range(random(), 2, 6);
    }
  }
}

function normalise(data: Float32Array): Float32Array {
  let energy = 0, peak = 0;
  for (const value of data) { energy += value * value; peak = Math.max(peak, Math.abs(value)); }
  const rms = Math.sqrt(energy / Math.max(1, data.length));
  if (rms <= 0) return data;
  const scale = Math.min(TEXTURE_RMS / rms, 0.9 / peak);
  for (let i = 0; i < data.length; i++) data[i]! *= scale;
  return data;
}
