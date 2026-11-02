/*
 * Original procedural PCM for the campfire. No recordings, samples, speech or external media: every buffer is
 * written here from seeded noise, one-pole filters and damped modes, so there is nothing to license.
 */

export const CAMPFIRE_CUES = ['ask', 'deal', 'night', 'snuff', 'dawn', 'ballot', 'sent', 'spared', 'town', 'wolves', 'ember', 'tap'] as const;
export type CampfireCue = typeof CAMPFIRE_CUES[number];
/** flame: the breath of the fire; crackle: wood splitting and popping; air: the night around the clearing. */
export type CampfireBed = 'flame' | 'crackle' | 'air';
export type CampfireMaterial = CampfireCue | CampfireBed;
export const CAMPFIRE_VARIANTS = 4;

/** Seconds. Bed lengths are coprime-ish so the three loops line up again only after minutes. */
const lengths: Record<CampfireMaterial, number> = {
  ask: .7, deal: 1.05, night: 3.8, snuff: .62, dawn: 1.9, ballot: .42, sent: .78, spared: .46,
  town: 2.5, wolves: 2.2, ember: .09, tap: .09, flame: 7.3, crackle: 10.9, air: 12.7,
};
const beds: readonly CampfireBed[] = ['flame', 'crackle', 'air'];
const materials = Object.keys(lengths) as CampfireMaterial[];
/** Bed loops are rendered this much longer and the tail is crossfaded into the head. */
const LOOP_OVERLAP = .25;
/** Inharmonic body modes for burning wood: a few "species" so neighbouring cracks never ring alike. */
const WOODS: readonly (readonly number[])[] = [[1, 2.31, 3.94], [1, 1.87, 3.12, 4.66], [1, 2.73, 5.38], [1, 1.59, 2.81, 4.3]];

export function isCampfireBed(material: CampfireMaterial): material is CampfireBed {
  return (beds as readonly string[]).includes(material);
}

export function campfireMaterial(context: BaseAudioContext, material: CampfireMaterial, variant: number): AudioBuffer {
  const rate = context.sampleRate, bed = isCampfireBed(material);
  const length = Math.ceil(rate * lengths[material]);
  const buffer = context.createBuffer(1, length, rate), out = buffer.getChannelData(0);
  const v = ((Math.floor(variant) % CAMPFIRE_VARIANTS) + CAMPFIRE_VARIANTS) % CAMPFIRE_VARIANTS;
  const random = seeded(0x2f1c + v * 4099 + materials.indexOf(material) * 7919);
  const pitch = 1 + (v - 1.5) * .022;
  // Beds render past their end so the loop can be crossfaded; cues render exactly their length.
  const data = new Float32Array(bed ? length + Math.ceil(rate * LOOP_OVERLAP) : length);
  const synth = new Synth(data, rate, random);
  switch (material) {
    case 'flame': synth.flame(lengths.flame); break;
    case 'crackle': synth.crackle(lengths.crackle); break;
    case 'air': synth.air(lengths.air); break;
    case 'ask':
      // A soft rising wooden knock, as if someone tapped their log: four knocks climbing, a loose rattle under them.
      [170, 196, 226, 262].forEach((f, i) => synth.knock(i * .085 + (i ? (random() - .5) * .006 : 0), f * pitch, .022 - i * .001, .5 + i * .07, WOODS[2]!));
      for (let i = 0; i < 6; i++) synth.knock(.025 + random() * .28, (1150 + random() * 650) * pitch, .004, .07 + random() * .05, WOODS[0]!);
      break;
    case 'deal': synth.hum(98 * pitch); break;
    case 'night': synth.swell(55 * pitch); break;
    case 'snuff': synth.puff(); break;
    case 'dawn':
      // Two small warm bell strikes, each a pair of modes: C5 then G5.
      synth.bell(0, 523.25 * pitch, .9, 1); synth.bell(.17, 783.99 * pitch, .75, .7); break;
    case 'ballot': synth.knock(0, 410 * pitch, .016, .55, WOODS[2]!); synth.knock(.12, 455 * pitch, .015, .48, WOODS[2]!); break;
    case 'sent': synth.thud(62 * pitch); break;
    case 'spared': synth.knock(0, 300 * pitch, .05, .7, [1, 2.0, 3.9], [1, .55, .1]); break;
    case 'town': synth.chord([196, 246.94, 293.66, 392].map(f => f * pitch)); break;
    case 'wolves': synth.fall(146.83 * pitch, 0, .55); synth.fall(110 * pitch, .38, .8); break;
    case 'ember': synth.knock(0, 3100 * pitch, .0022, .5, [1, 1.62]); synth.grain(0, .001, .25); break;
    case 'tap': synth.knock(0, 1250 * pitch, .004, .45, [1, 2.1]); synth.knock(0, 340 * pitch, .009, .4, [1, 2.4]); break;
  }
  if (bed) {
    // Equal-power crossfade of the rendered tail into the head: the loop point is inaudible and step-free.
    const overlap = data.length - length;
    for (let i = 0; i < length; i++) out[i] = data[i]!;
    for (let i = 0; i < overlap; i++) {
      const w = i / overlap;
      out[i] = data[i]! * Math.sin(w * Math.PI / 2) + data[length + i]! * Math.cos(w * Math.PI / 2);
    }
    normalise(out, material === 'crackle' ? { peak: .8 } : { rms: .16, peak: .85 });
  } else {
    // Out in the open there is no room, only a soft answer from the tree line. It lives inside the buffer, so
    // quiet() cuts it with the cue.
    if (lengths[material] > .2) for (const [delay, gain] of [[.071, .07], [.133, .035]] as const) {
      const offset = Math.round(rate * delay);
      for (let i = data.length - 1; i >= offset; i--) data[i]! += data[i - offset]! * gain;
    }
    normalise(data, { peak: .7 });
    const fade = Math.min(Math.round(rate * .012), data.length);
    for (let i = 0; i < fade; i++) data[data.length - 1 - i]! *= i / fade;
    out.set(data);
  }
  return buffer;
}

/** Writes additively into `data`. All coefficients are rate-independent, so live and offline renders agree. */
class Synth {
  constructor(private readonly data: Float32Array, private readonly rate: number, private readonly random: () => number) {}

  private pole(hz: number) { return 1 - Math.exp(-2 * Math.PI * hz / this.rate); }
  /** A periodic modulator whose period divides the loop, so the loop stays seamless. */
  private cycle(loop: number, hz: number) { return Math.max(1, Math.round(hz * loop)) / loop; }

  /** The fire's breath: dark low roar with a little mid flutter, rising and falling irregularly. */
  flame(loop: number) {
    const { data, rate, random } = this;
    const roar = this.pole(170), sub = this.pole(48), hissLow = this.pole(650), hissHigh = this.pole(2300), drift = this.pole(1.6);
    const f = [.19, .43, .97, 1.9].map(hz => this.cycle(loop, hz)), phase = f.map(() => random() * Math.PI * 2);
    let a = 0, b = 0, s = 0, h1 = 0, h2 = 0, walk = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate, white = random() * 2 - 1;
      a += (white - a) * roar; b += (a - b) * roar; s += (b - s) * sub;
      h1 += (white - h1) * hissLow; h2 += (white - h2) * hissHigh;
      walk += ((random() * 2 - 1) - walk) * drift;
      const breath = .62 + .16 * Math.sin(2 * Math.PI * f[0]! * t + phase[0]!) + .1 * Math.sin(2 * Math.PI * f[1]! * t + phase[1]!)
        + .06 * Math.sin(2 * Math.PI * f[2]! * t + phase[2]!) + .04 * Math.sin(2 * Math.PI * f[3]! * t + phase[3]!) + walk * 15;
      const level = Math.max(.15, breath);
      // The low roar carries the body; the mid band flares only as the flame breathes up.
      data[i]! += (b - s) * 3.2 * level + (h2 - h1) * .14 * level * level;
    }
  }

  /** Burning wood: sparse cracks and ticks, now and then a pop with a spit of sparks and a breath of steam. */
  crackle(loop: number) {
    const { random } = this;
    const end = loop - .3;
    let t = .04;
    while (t < end) {
      const roll = random();
      const wood = WOODS[Math.floor(random() * WOODS.length)]!;
      if (roll < .07) this.pop(t, wood);
      else if (roll < .52) this.crack(t, wood, .14 + random() ** 2 * .34);
      else this.knock(t, (2400 + random() * 2600), .0015 + random() * .0015, .04 + random() * .1, [1, 1.73]);
      // Clusters: wood often splits in a short run of cracks.
      if (random() < .14) {
        let at = t;
        for (let n = 2 + Math.floor(random() * 4); n > 0 && at < end; n--) {
          at += .014 + random() * .05;
          this.crack(at, WOODS[Math.floor(random() * WOODS.length)]!, .06 + random() * .18);
        }
        t = at;
      }
      // Irregular arrivals, slowly varying in density: about four to nine events a second.
      const density = 4 + 3 * (1 + Math.sin(2 * Math.PI * t / loop * 3 + 1.3)) / 2 + random() * 2;
      t += -Math.log(1 - random() * .999) / density;
    }
    // A faint sizzle of embers under it all.
    for (let at = .02; at < end; at += .012 + random() * .04) this.knock(at, 3600 + random() * 2400, .0009, .006 + random() * .018, [1]);
  }

  private crack(at: number, wood: readonly number[], gain: number) {
    const f = 900 + this.random() * 1500;
    this.grain(at, .002 + this.random() * .002, gain * .8);
    this.knock(at, f, .003 + this.random() * .006, gain, wood);
  }

  private pop(at: number, wood: readonly number[]) {
    const { random } = this;
    const gain = .5 + random() * .35;
    this.grain(at, .0025, gain);
    this.knock(at, 380 + random() * 370, .012 + random() * .018, gain, wood);
    this.knock(at + .0015, 1600 + random() * 900, .004, gain * .4, wood);
    if (random() < .4) for (let n = 2 + Math.floor(random() * 2); n > 0; n--) {
      this.knock(at + .04 + random() * .09, 2800 + random() * 2000, .0018, .05 + random() * .07, [1, 1.62]);
    }
    if (random() < .35) this.hiss(at + .01, .08 + random() * .12, .05);
  }

  /** A struck body: a short noise grain into a few inharmonic damped modes. */
  knock(at: number, fundamental: number, decay: number, gain: number, modes: readonly number[], weights?: readonly number[]) {
    const { data, rate, random } = this;
    const start = Math.floor(at * rate);
    if (start < 0 || start >= data.length) return;
    const duration = Math.min(data.length - start, Math.ceil(decay * 9 * rate));
    let grain = 0;
    for (let i = 0; i < duration; i++) {
      const t = i / rate, attack = Math.min(1, t / .0008);
      grain = .55 * grain + .45 * (random() * 2 - 1);
      let sample = grain * Math.exp(-t / Math.max(.0006, decay * .3)) * .3;
      for (let m = 0; m < modes.length; m++) {
        const hz = fundamental * modes[m]!;
        if (hz >= rate * .45) continue;
        sample += Math.sin(2 * Math.PI * hz * t) * Math.exp(-t / (decay / (1 + m * .7))) * (weights?.[m] ?? 1 / (1.6 + m));
      }
      data[start + i]! += sample * gain * attack;
    }
  }

  /** A very short burst of bright noise: the split itself. */
  grain(at: number, decay: number, gain: number) {
    const { data, rate, random } = this;
    const start = Math.floor(at * rate), duration = Math.min(data.length - start, Math.ceil(decay * 7 * rate));
    let low = 0;
    const pole = this.pole(1800);
    for (let i = 0; i < duration; i++) {
      const white = random() * 2 - 1;
      low += (white - low) * pole;
      data[start + i]! += (white - low) * Math.exp(-i / rate / decay) * gain;
    }
  }

  /** Steam or a snuffed wick: band-limited breath. */
  hiss(at: number, decay: number, gain: number, attack = .006) {
    const { data, rate, random } = this;
    const start = Math.floor(at * rate), duration = Math.min(data.length - start, Math.ceil(decay * 6 * rate));
    const lo = this.pole(900), hi = this.pole(4500);
    let a = 0, b = 0;
    for (let i = 0; i < duration; i++) {
      const t = i / rate, white = random() * 2 - 1;
      a += (white - a) * lo; b += (white - b) * hi;
      data[start + i]! += (b - a) * Math.min(1, t / attack) * Math.exp(-t / decay) * gain;
    }
  }

  /** The night around the clearing: wind moving through trees, leaves when it gusts, two quiet crickets. */
  air(loop: number) {
    const { data, rate, random } = this;
    const low = this.pole(110), body = this.pole(620), leafLow = this.pole(1700), leafHigh = this.pole(5200), flutter = this.pole(7);
    const gust = [.07, .16, .37].map(hz => this.cycle(loop, hz)), phase = gust.map(() => random() * Math.PI * 2);
    let a = 0, b = 0, c = 0, l1 = 0, l2 = 0, fl = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate, white = random() * 2 - 1;
      a += (white - a) * body; b += (a - b) * body; c += (b - c) * low;
      l1 += (white - l1) * leafLow; l2 += (white - l2) * leafHigh;
      fl += (Math.abs(random() * 2 - 1) - fl) * flutter;
      const g = .55 + .24 * Math.sin(2 * Math.PI * gust[0]! * t + phase[0]!) + .14 * Math.sin(2 * Math.PI * gust[1]! * t + phase[1]!)
        + .07 * Math.sin(2 * Math.PI * gust[2]! * t + phase[2]!);
      const leaves = Math.max(0, g - .62) * 2.2;
      data[i]! += (b - c) * 2.6 * g + (l2 - l1) * .5 * leaves * (.4 + fl * 1.4);
    }
    // Crickets: near-pure tones in short pulse trains, far enough away to be gentle. Never across the loop seam.
    const crickets = [
      { hz: 4350, pulses: 3, pulse: .014, gap: .022, period: [.95, 1.35], rest: .12, gain: .022 },
      { hz: 4780, pulses: 4, pulse: .011, gap: .019, period: [1.6, 2.4], rest: .3, gain: .013 },
    ];
    for (const cricket of crickets) {
      const chirp = cricket.pulses * (cricket.pulse + cricket.gap);
      for (let at = .3 + random() * .6; at + chirp < loop - .05; at += cricket.period[0]! + random() * (cricket.period[1]! - cricket.period[0]!)) {
        if (random() < cricket.rest) { at += 1.5 + random() * 2; continue; }
        const hz = cricket.hz * (1 + (random() - .5) * .01), level = cricket.gain * (.75 + random() * .25);
        for (let p = 0; p < cricket.pulses; p++) {
          const start = Math.floor((at + p * (cricket.pulse + cricket.gap)) * rate), n = Math.floor(cricket.pulse * rate);
          for (let i = 0; i < n && start + i < data.length; i++) {
            const shape = Math.sin(Math.PI * i / n) ** 2;
            data[start + i]! += Math.sin(2 * Math.PI * hz * (i / rate)) * shape * level * 5;
          }
        }
      }
    }
  }

  /** Cards dealt: a low hum with a slow beating shimmer above it and a whisper at the start. */
  hum(f0: number) {
    const { data, rate } = this;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate, env = Math.sin(Math.min(1, t / .06) * Math.PI / 2) * Math.exp(-t / .34);
      const shimmer = (Math.sin(2 * Math.PI * f0 * 16 * t) + Math.sin(2 * Math.PI * (f0 * 16 + 3.5) * t)) * .5 * Math.exp(-t / .22);
      data[i]! += env * (Math.sin(2 * Math.PI * f0 * t) * .6 + Math.sin(2 * Math.PI * f0 * 2.005 * t) * .3
        + Math.sin(2 * Math.PI * f0 * 3.01 * t) * .12) + shimmer * .06 * Math.min(1, t / .03);
    }
    this.hiss(0, .03, .06, .01);
  }

  /** Night falls: a low drone of a fifth and its octave, swelling in and out over a dark breath. */
  swell(f0: number) {
    const { data, rate, random } = this;
    const rise = 1.3, hold = .5, total = data.length / rate - .3, dark = this.pole(300);
    let breath = 0, breath2 = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate;
      const env = t < rise ? (1 - Math.cos(Math.PI * t / rise)) / 2 : t < rise + hold ? 1 : t < total ? (1 + Math.cos(Math.PI * (t - rise - hold) / (total - rise - hold))) / 2 : 0;
      const white = random() * 2 - 1;
      breath += (white - breath) * dark; breath2 += (breath - breath2) * dark;
      data[i]! += env * (Math.sin(2 * Math.PI * f0 * t) * .5 + Math.sin(2 * Math.PI * f0 * 1.5 * t) * .3
        + Math.sin(2 * Math.PI * f0 * 2 * t) * .28 + Math.sin(2 * Math.PI * f0 * 3 * t) * .1 + breath2 * 1.6);
    }
  }

  /** A lantern goes out: a soft puff of air and a wick's hiss. */
  puff() {
    const { data, rate, random } = this;
    const pole = this.pole(260);
    let low = 0, low2 = 0;
    for (let i = 0; i < Math.min(data.length, rate * .3); i++) {
      const t = i / rate, white = random() * 2 - 1;
      low += (white - low) * pole; low2 += (low - low2) * pole;
      data[i]! += low2 * 9 * Math.min(1, t / .012) * Math.exp(-t / .045);
    }
    this.hiss(.004, .09, .5, .01);
    this.hiss(.06, .17, .18, .04);
  }

  /** One bell strike made of a warm pair of modes, with a quiet inharmonic shimmer. */
  bell(at: number, f: number, decay: number, gain: number) {
    const { data, rate } = this;
    const start = Math.floor(at * rate);
    for (let i = 0; start + i < data.length; i++) {
      const t = i / rate, attack = Math.min(1, t / .003);
      data[start + i]! += gain * attack * (Math.sin(2 * Math.PI * f * t) * Math.exp(-t / decay)
        + Math.sin(2 * Math.PI * f * 2.0 * t) * .3 * Math.exp(-t / (decay * .55))
        + Math.sin(2 * Math.PI * f * 2.76 * t) * .08 * Math.exp(-t / (decay * .25)));
    }
  }

  /** Someone is sent from the fire: a low, soft-edged thud on the earth. */
  thud(f0: number) {
    this.knock(0, f0, .07, 1, [1, 1.6, 2.3], [1, .35, .15]);
    this.knock(.002, f0 * 2.26, .03, .3, WOODS[2]!);
    const { data, rate, random } = this;
    const pole = this.pole(400);
    let low = 0;
    for (let i = 0; i < Math.min(data.length, rate * .2); i++) {
      low += ((random() * 2 - 1) - low) * pole;
      data[i]! += low * 2.2 * Math.exp(-i / rate / .025);
    }
  }

  /** The circle wins: a warm strummed triad with its octave. */
  chord(notes: readonly number[]) {
    const { data, rate } = this;
    notes.forEach((f, n) => {
      const start = Math.floor(n * .045 * rate), gain = n === notes.length - 1 ? .4 : .7;
      for (let i = 0; start + i < data.length; i++) {
        const t = i / rate, env = Math.min(1, t / .025) * Math.exp(-t / .95);
        data[start + i]! += gain * env * (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 2 * t) * .22 * Math.exp(-t / .5)
          + Math.sin(2 * Math.PI * f * 3 * t) * .07 * Math.exp(-t / .3));
      }
    });
  }

  /** The Wolves win: a soft low tone sinking a little as it fades. */
  fall(f: number, at: number, decay: number) {
    const { data, rate } = this;
    const start = Math.floor(at * rate);
    let phase = 0;
    for (let i = 0; start + i < data.length; i++) {
      const t = i / rate, hz = f * (1 - .035 * Math.min(1, t / (decay * 2)));
      phase += 2 * Math.PI * hz / rate;
      const env = Math.min(1, t / .04) * Math.exp(-t / decay);
      data[start + i]! += env * (Math.sin(phase) + Math.sin(phase * 2) * .3 + Math.sin(phase * 3) * .12);
    }
  }
}

function normalise(data: Float32Array, target: { peak?: number; rms?: number }) {
  let peak = 0, squares = 0;
  for (const sample of data) { peak = Math.max(peak, Math.abs(sample)); squares += sample * sample; }
  if (!(peak > 0)) return;
  let scale = target.rms ? target.rms / Math.sqrt(squares / data.length) : target.peak! / peak;
  if (target.peak && peak * scale > target.peak) scale = target.peak / peak;
  for (let i = 0; i < data.length; i++) data[i]! *= scale;
}

function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
