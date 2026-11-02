import { seeded } from './law';

/**
 * The pier's continuous textures, baked once into seamless loops in plain JavaScript: water lapping at the piles
 * and rain on the water. A lap is a swell, a slap on the pile, the hollow knock inside it and a gurgle of bubbles;
 * rain is thousands of single drops, a few of them ringing as bubbles and a few landing on the deck. Laid down
 * event by event, they never sound like a filtered hiss, and once baked they cost one looping buffer to play.
 *
 * Events are written into a circular buffer, so a lap that starts near the end finishes at the beginning. The
 * filtered noise under them is run twice over the same input, so its filters enter the loop already settled and
 * the seam is continuous. Every recipe is deterministic for its seed.
 *
 * Baking is a generator that yields after about `TEXTURE_CHUNK` samples of work, so a frame only ever pays a
 * slice of it.
 */
export const TEXTURE_CHUNK = 12000;

export type TextureRecipe = Generator<void, Float32Array, void>;

/** RBJ cookbook biquad, direct form I. Coefficients may move between samples for slow sweeps. */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;

  set(type: 'lowpass' | 'highpass' | 'bandpass', frequency: number, q: number, sampleRate: number): this {
    const w = (2 * Math.PI * Math.min(frequency, sampleRate * 0.45)) / sampleRate;
    const cos = Math.cos(w), alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
    if (type === 'lowpass') { this.b0 = (1 - cos) / 2; this.b1 = 1 - cos; this.b2 = (1 - cos) / 2; }
    else if (type === 'highpass') { this.b0 = (1 + cos) / 2; this.b1 = -(1 + cos); this.b2 = (1 + cos) / 2; }
    else { this.b0 = alpha; this.b1 = 0; this.b2 = -alpha; }
    this.b0 /= a0; this.b1 /= a0; this.b2 /= a0;
    this.a1 = (-2 * cos) / a0; this.a2 = (1 - alpha) / a0;
    return this;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }

  reset(): this { this.x1 = this.x2 = this.y1 = this.y2 = 0; return this; }
}

/** Gain that brings band-passed white noise back to about the level `amp` asks for, whatever the band. */
function bandScale(frequency: number, q: number, sampleRate: number): number {
  const fraction = Math.min(1, frequency / q / (sampleRate / 2));
  return 1 / Math.sqrt(Math.max(fraction, 1e-4));
}

const filter = new Biquad();

/**
 * A burst of noise through one filter: a linear attack, then an exponential fall. Written into `out` around the
 * loop. Answers how many samples it wrote.
 */
function burst(out: Float32Array, sampleRate: number, random: () => number, at: number, type: 'lowpass' | 'highpass' | 'bandpass',
  frequency: number, q: number, attack: number, tau: number, amp: number): number {
  const length = out.length, start = Math.floor(at * sampleRate), rise = Math.max(1, Math.round(attack * sampleRate));
  const n = rise + Math.ceil(tau * 7 * sampleRate), fall = Math.exp(-1 / (tau * sampleRate));
  const scale = amp * (type === 'bandpass' ? bandScale(frequency, q, sampleRate) : 1);
  filter.reset().set(type, frequency, q, sampleRate);
  let env = 0;
  for (let j = 0; j < n; j++) {
    env = j < rise ? j / rise : env * fall;
    const index = (start + j) % length;
    out[index] = out[index]! + filter.run(random() * 2 - 1) * env * scale;
  }
  return n;
}

/**
 * One bubble: the ringing of a small air cavity in water (its Minnaert resonance), a sine that rises in pitch as
 * the bubble nears the surface and dies away fast. This is what makes water sound like water rather than hiss.
 */
function bubble(out: Float32Array, sampleRate: number, at: number, f0: number, tau: number, rise: number, amp: number): number {
  const length = out.length, start = Math.floor(at * sampleRate), n = Math.ceil(tau * 7 * sampleRate);
  const attack = Math.max(1, Math.round(0.0007 * sampleRate)), fall = Math.exp(-1 / (tau * sampleRate));
  let env = 1, phase = 0;
  for (let j = 0; j < n; j++) {
    const time = j / sampleRate, f = f0 * (1 + (rise * time) / tau);
    phase += (2 * Math.PI * f) / sampleRate;
    env *= fall;
    const index = (start + j) % length;
    out[index] = out[index]! + Math.sin(phase) * env * Math.min(1, j / attack) * amp;
  }
  return n;
}

/**
 * Filtered noise under the events, modulated by whole cycles of the loop. Run twice over identical noise so the
 * filters' state at the seam is the state they would have had anyway.
 */
function* bed(out: Float32Array, sampleRate: number, seed: number, filters: readonly Biquad[], leak: number,
  level: (phase: number) => number): Generator<void, void, void> {
  const length = out.length;
  let work = 0;
  for (let pass = 0; pass < 2; pass++) {
    const noise = seeded(seed);
    let drift = 0, gain = level(0);
    for (let i = 0; i < length; i++) {
      // A leaky integrator darkens the noise towards the weight of moving water before the filters shape it.
      let x = noise() * 2 - 1;
      if (leak > 0) { drift = drift * leak + x * (1 - leak) * 6; x = drift; }
      for (let f = 0; f < filters.length; f++) x = filters[f]!.run(x);
      // The level moves slowly; it is read every 64 samples.
      if ((i & 63) === 0) gain = level(i / length);
      if (pass === 1) out[i] = out[i]! + x * gain;
      if (++work >= TEXTURE_CHUNK) { work = 0; yield; }
    }
  }
}

/** Water lapping at the piles of a small wooden pier. */
export function* lapLoop(sampleRate: number, seconds: number, seed: number): TextureRecipe {
  const random = seeded(seed), length = Math.round(seconds * sampleRate), out = new Float32Array(length);
  const cycles = (period: number) => Math.max(1, Math.round(seconds / period));
  const k1 = cycles(3.3), k2 = cycles(1.9), p1 = random() * Math.PI * 2, p2 = random() * Math.PI * 2;
  // The body of water moving under the deck, kept low: it joins the laps together, it is not the sound.
  yield* bed(out, sampleRate, (seed ^ 0x51ed27) >>> 0, [new Biquad().set('lowpass', 260, 0.7, sampleRate), new Biquad().set('highpass', 55, 0.6, sampleRate)],
    0.992, phase => 0.12 * (0.6 + 0.28 * Math.sin(2 * Math.PI * k1 * phase + p1) + 0.12 * Math.sin(2 * Math.PI * k2 * phase + p2)));

  const sweep = new Biquad();
  let at = random() * 0.4, work = 0;
  while (at < seconds) {
    const strength = 0.45 + 0.55 * random();
    // The swell rising against the pile: noise through a resonant low-pass that opens and closes.
    const swell = 0.45 + 0.3 * random(), peakHz = 620 + 420 * random(), start = Math.floor(at * sampleRate);
    const n = Math.ceil(swell * 1.8 * sampleRate), rise = swell * 0.35, tau = swell * 0.2;
    sweep.reset();
    for (let j = 0; j < n; j++) {
      const time = j / sampleRate;
      if ((j & 31) === 0) {
        const shape = time < rise ? time / rise : Math.exp(-(time - rise) / (swell * 0.3));
        sweep.set('lowpass', 220 + (peakHz - 220) * shape, 1.5, sampleRate);
      }
      const env = time < rise ? 0.5 - 0.5 * Math.cos((Math.PI * time) / rise) : Math.exp(-(time - rise) / tau);
      const index = (start + j) % length;
      out[index] = out[index]! + sweep.run(random() * 2 - 1) * env * strength * 0.55;
    }
    work += n;

    // The slap where it meets the wood, and the hollow knock of the water inside the pile's lee.
    const slap = at + rise + (random() - 0.5) * 0.03;
    work += burst(out, sampleRate, random, slap, 'bandpass', 700 + 650 * random(), 1.1, 0.0015, 0.018 + 0.02 * random(), strength * 0.32);
    work += burst(out, sampleRate, random, slap + 0.004, 'bandpass', 240 + 90 * random(), 3.4, 0.003, 0.04 + 0.015 * random(), strength * 0.16);

    // The water falling back: a little gurgle of bubbles.
    const bubbles = 2 + Math.floor(random() * 4);
    for (let b = 0; b < bubbles; b++) {
      work += bubble(out, sampleRate, slap + 0.015 + random() * 0.32, 330 + 820 * random(), 0.01 + 0.024 * random(),
        0.35 + 0.5 * random(), strength * (0.05 + 0.08 * random()));
    }
    // Now and then a drop off the edge of the boards.
    if (random() < 0.42) {
      const drip = slap + 0.35 + random() * 0.9;
      work += burst(out, sampleRate, random, drip, 'bandpass', 2600, 1.5, 0.0004, 0.0018, 0.05);
      work += bubble(out, sampleRate, drip + 0.001, 1150 + 1100 * random(), 0.006 + 0.008 * random(), 0.6, 0.075);
    }

    // Laps come unevenly; sometimes a second one follows close behind the first.
    at += random() < 0.2 ? 0.32 + 0.2 * random() : 0.85 + 1.7 * random();
    if (work >= TEXTURE_CHUNK) { work = 0; yield; }
  }
  return normalisePeak(out, 0.85);
}

/** Rain on open water and a wooden deck. */
export function* rainLoop(sampleRate: number, seconds: number, seed: number): TextureRecipe {
  const random = seeded(seed), length = Math.round(seconds * sampleRate), out = new Float32Array(length);
  const k = Math.max(1, Math.round(seconds / 2.3)), p = random() * Math.PI * 2;
  // The wash of very many far drops; it is the floor, the near drops below are the sound.
  yield* bed(out, sampleRate, (seed ^ 0x2c1b3c6d) >>> 0, [new Biquad().set('highpass', 450, 0.6, sampleRate), new Biquad().set('lowpass', 5200, 0.6, sampleRate)],
    0, phase => 0.05 * (0.85 + 0.15 * Math.sin(2 * Math.PI * k * phase + p)));

  const drops = Math.round(950 * seconds);
  let work = 0;
  for (let d = 0; d < drops; d++) {
    const at = random() * seconds, size = random() ** 5;
    // A drop meeting water: a tiny broadband tick; few are loud, most are faint.
    work += burst(out, sampleRate, random, at, 'bandpass', 1900 + 5200 * random(), 0.9, 0.0002, 0.0006 + 0.0009 * random(), 0.025 + 0.32 * size);
    // Some trap a bubble and ring.
    if (random() < 0.14) work += bubble(out, sampleRate, at + 0.0004, 1600 + 2600 * random(), 0.003 + 0.006 * random(), 0.9, 0.03 + 0.12 * size);
    // A few land on the boards instead: a duller tick of wet wood.
    if (random() < 0.012) work += burst(out, sampleRate, random, at, 'bandpass', 950 + 400 * random(), 2.2, 0.0004, 0.006, 0.22);
    if (work >= TEXTURE_CHUNK) { work = 0; yield; }
  }
  return normaliseRms(out, 0.16, 0.95);
}

/** Pink noise (Paul Kellet's filter), seamless as a loop: the air every continuous bed breathes through. */
export function pinkLoop(sampleRate: number, seconds: number, seed: number): Float32Array {
  const length = Math.round(seconds * sampleRate), out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let pass = 0; pass < 2; pass++) {
    const noise = seeded(seed);
    for (let i = 0; i < length; i++) {
      const white = noise() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759; b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856; b4 = 0.55 * b4 + white * 0.5329522; b5 = -0.7616 * b5 - white * 0.016898;
      if (pass === 1) out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
    }
  }
  return normaliseRms(out, 0.2, 0.95);
}

export function normalisePeak(data: Float32Array, peak: number): Float32Array {
  let max = 0;
  for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]!));
  if (max > 0) { const scale = peak / max; for (let i = 0; i < data.length; i++) data[i] = data[i]! * scale; }
  return data;
}

/** Brings the loop to an RMS level, then rounds off the rare peak above 0.6 so nothing passes `ceiling`. */
export function normaliseRms(data: Float32Array, rms: number, ceiling: number): Float32Array {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
  const now = Math.sqrt(sum / Math.max(1, data.length));
  if (now === 0) return data;
  const scale = rms / now, knee = 0.6, room = ceiling - knee;
  for (let i = 0; i < data.length; i++) {
    const x = data[i]! * scale, size = Math.abs(x);
    data[i] = size <= knee ? x : Math.sign(x) * (knee + room * Math.tanh((size - knee) / room));
  }
  return data;
}

/** Several recipes baked one slice at a time. */
export class TextureJob {
  private index = 0;
  private readonly done: Float32Array[] = [];

  constructor(private readonly recipes: readonly TextureRecipe[]) {}

  get ready(): boolean { return this.index >= this.recipes.length; }

  /** The finished loops, in recipe order, once every recipe is baked. */
  get result(): readonly Float32Array[] | null { return this.ready ? this.done : null; }

  /** Does one slice of work; answers whether everything is baked. */
  step(): boolean {
    if (this.ready) return true;
    const next = this.recipes[this.index]!.next();
    if (next.done) { this.done.push(next.value); this.index++; }
    return this.ready;
  }

  /** Bakes the rest at once. */
  finish(): readonly Float32Array[] {
    while (!this.step()) { /* keep baking */ }
    return this.done;
  }
}
