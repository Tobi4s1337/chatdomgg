import type { MomentCue } from './controller';
import type { MomentSoundPort } from './view';

/**
 * Original procedural cues behind the local sound port: no samples, recordings or downloaded audio. Main can map
 * the sound lane's mixer to the same port at integration. Times are kingdom milliseconds; `now()` maps them to
 * the audio clock. Cancelling stops every node of the cue, tails included.
 */
export interface ProceduralSoundOptions {
  readonly context: () => { context: AudioContext; destination: AudioNode } | null;
  /** Current kingdom time in ms. */
  readonly now: () => number;
  /** Mode-aware gain from the broadcast mix policy (0 when muted or hidden). */
  readonly gain: () => number;
}

/** Length of each cue including its tail, in ms. */
export const CUE_LENGTH_MS: Record<MomentCue, number> = {
  horn: 1700, 'cloth-unfurl': 2300, 'gift-bell': 2200, 'cart-roll': 3600, 'parcel-land': 900,
  'spark-rise': 2100, 'firework-launch': 1400, 'firework-bloom': 2500, 'firework-crackle': 2400, 'beast-call': 2500, 'beast-wings': 1100,
  'aurora-swell': 6000, 'kite-wind': 4000, 'confetti-pop': 1600, 'balloon-rise': 2000,
  'train-whistle': 2000, 'train-steam': 3500, 'carriage-couple': 900, 'festival-drum': 2400,
  'dragon-roar': 3600, 'dragon-wings': 1200, 'dragon-breath': 2700, 'dragon-hit': 800, 'dragon-fall': 4000, 'dragon-snore': 3000,
  'wyrm-bell': 4000, 'victory-fanfare': 3200,
};

/** Where the ground takes the dragon's weight inside 'dragon-fall', so the cue can be placed on the landing. */
export const DRAGON_FALL_IMPACT_MS = 2500;

type Nodes = AudioScheduledSourceNode[];
type Point = readonly [at: number, value: number];

function gainNode(context: BaseAudioContext, value = 0): GainNode { const node = context.createGain(); node.gain.value = value; return node; }

function filterNode(context: BaseAudioContext, type: BiquadFilterType, hz: number, q = 0.7): BiquadFilterNode {
  const node = context.createBiquadFilter(); node.type = type; node.frequency.value = hz; node.Q.value = q; return node;
}

/** Connects the nodes in order and returns the first. */
function chain(first: AudioNode, ...rest: AudioNode[]): AudioNode {
  let at = first;
  for (const next of rest) { at.connect(next); at = next; }
  return first;
}

/** Silent until `at`, up to `peak` in `attack`, then an exponential fall over `decay`. */
function strike(param: AudioParam, at: number, peak: number, attack: number, decay: number): void {
  param.setValueAtTime(0, at); param.linearRampToValueAtTime(peak, at + attack); param.exponentialRampToValueAtTime(0.0008, at + attack + decay);
}

/** A contour of points (seconds after `t`): exponential for pitch and filters, linear for envelopes that touch zero. */
function glide(param: AudioParam, t: number, points: readonly Point[], curve: 'exp' | 'linear' = 'exp'): void {
  points.forEach(([at, value], i) => {
    if (i === 0) param.setValueAtTime(value, t + at);
    else if (curve === 'exp') param.exponentialRampToValueAtTime(value, t + at);
    else param.linearRampToValueAtTime(value, t + at);
  });
}

/** Deterministic scatter for crackles, debris and paper (the same LCG as the noise), values in [0, 1). */
function scatter(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}

/** Soft saturation (normalised tanh) for growl and grit. */
function shaper(context: BaseAudioContext, drive: number): WaveShaperNode {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * drive) / Math.tanh(drive);
  const node = context.createWaveShaper(); node.curve = curve; node.oversample = '2x';
  return node;
}

export function createProceduralMomentSound(options: ProceduralSoundOptions): MomentSoundPort & { readonly active: number } {
  const live = new Set<() => void>();
  let noise: AudioBuffer | null = null;
  const NOISE_SECONDS = 6;
  const rooms = new Map<string, AudioBuffer>();

  function noiseBuffer(context: AudioContext): AudioBuffer {
    if (noise && noise.sampleRate === context.sampleRate) return noise;
    // Deterministic noise (LCG), so a cue sounds the same every time it plays.
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * NOISE_SECONDS), context.sampleRate), data = buffer.getChannelData(0);
    let seed = 0x2f6b1a3d;
    for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = seed / 2 ** 31 - 1; }
    noise = buffer;
    return buffer;
  }

  /** Looping shared noise over [start, stop], read from `offset` s in so layers never sound alike. */
  function noiseAt(context: AudioContext, nodes: Nodes, start: number, stop: number, offset = 0): AudioBufferSourceNode {
    const source = context.createBufferSource(); source.buffer = noiseBuffer(context); source.loop = true;
    source.start(start, offset % NOISE_SECONDS); source.stop(stop); nodes.push(source);
    return source;
  }

  function toneAt(context: AudioContext, nodes: Nodes, type: OscillatorType, hz: number, start: number, stop: number): OscillatorNode {
    const osc = context.createOscillator(); osc.type = type; osc.frequency.value = hz;
    osc.start(start); osc.stop(stop); nodes.push(osc);
    return osc;
  }

  /** A low-frequency modulator of `depth` into `param` (vibrato, rattle, flutter); tracked like every source. */
  function lfo(context: AudioContext, nodes: Nodes, type: OscillatorType, hz: number, depth: number, param: AudioParam, start: number, stop: number): OscillatorNode {
    const osc = toneAt(context, nodes, type, hz, start, stop);
    osc.connect(gainNode(context, depth)).connect(param);
    return osc;
  }

  /**
   * A small dark room: a convolver on a deterministic, exponentially decaying stereo noise impulse (-60 dB at its
   * end), low-passed so the tail stays warm. Returns the send; whatever feeds it lands in `out` `seconds` later.
   */
  function room(context: AudioContext, out: AudioNode, seconds: number, wet: number, damp: number): GainNode {
    const key = `${context.sampleRate}:${seconds}`;
    let impulse = rooms.get(key);
    if (!impulse) {
      impulse = context.createBuffer(2, Math.floor(context.sampleRate * seconds), context.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        let seed = channel ? 0x6c8e9cf5 : 0x1b873593;
        for (let i = 0; i < data.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const x = i / data.length;
          data[i] = (seed / 2 ** 31 - 1) * Math.exp(-6.9 * x) * (1 - x);
        }
      }
      rooms.set(key, impulse);
    }
    const send = gainNode(context, wet), convolver = context.createConvolver();
    convolver.buffer = impulse;
    chain(send, convolver, filterNode(context, 'lowpass', damp), out);
    return send;
  }

  /** One short noise grain (a crackle, a paper fleck, a pebble), band-limited and placed in the stereo field. */
  function grain(context: AudioContext, nodes: Nodes, out: AudioNode, at: number, length: number, hz: number, q: number, level: number, pan: number, offset: number): void {
    const source = noiseAt(context, nodes, at, at + length + 0.03, offset), amp = gainNode(context), panner = context.createStereoPanner();
    strike(amp.gain, at, level, 0.0008, length); panner.pan.value = pan;
    chain(source, filterNode(context, 'bandpass', hz, q), amp, panner, out);
  }

  function horn(context: AudioContext, out: GainNode, t: number, nodes: AudioScheduledSourceNode[]): void {
    // A short brass call, a rising fourth: two voices (saw + square) through a filter that opens like a lip buzz.
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 2.2; filter.connect(out);
    const amp = context.createGain(); amp.gain.value = 0; amp.connect(filter);
    const notes: [number, number, number][] = [[293.66, 0, 0.3], [392, 0.32, 1.05]];
    filter.frequency.setValueAtTime(420, t);
    for (const [hz, at, length] of notes) {
      const start = t + at;
      amp.gain.setTargetAtTime(0.5, start, 0.03);
      filter.frequency.setTargetAtTime(hz * 6.5, start, 0.06);
      filter.frequency.setTargetAtTime(hz * 3.2, start + 0.12, 0.2);
      amp.gain.setTargetAtTime(at === 0 ? 0.18 : 0, start + length - (at === 0 ? 0.04 : 0.25), at === 0 ? 0.015 : 0.16);
      for (const [type, detune, level] of [['sawtooth', -4, 0.55], ['square', 5, 0.25], ['triangle', 0, 0.4]] as const) {
        const osc = context.createOscillator(), voice = context.createGain();
        osc.type = type; osc.frequency.value = type === 'triangle' ? hz / 2 : hz; osc.detune.value = detune; voice.gain.value = level;
        // A slow, slight vibrato on the held note only.
        if (at > 0) {
          const lfo = context.createOscillator(), depth = context.createGain();
          lfo.frequency.value = 5.2; depth.gain.setValueAtTime(0, start); depth.gain.linearRampToValueAtTime(6, start + 0.5);
          lfo.connect(depth); depth.connect(osc.detune); lfo.start(start); lfo.stop(start + length + 0.4); nodes.push(lfo);
        }
        osc.connect(voice); voice.connect(amp); osc.start(start); osc.stop(start + length + 0.5); nodes.push(osc);
      }
    }
  }

  function cloth(context: AudioContext, out: GainNode, t: number, nodes: AudioScheduledSourceNode[]): void {
    // Heavy cloth unrolling: band-limited noise that flutters fast then slows, and a soft knock as the roll lands.
    const source = context.createBufferSource(); source.buffer = noiseBuffer(context);
    const band = context.createBiquadFilter(); band.type = 'bandpass'; band.Q.value = 0.9;
    band.frequency.setValueAtTime(2400, t); band.frequency.exponentialRampToValueAtTime(700, t + 1.9);
    const amp = context.createGain(); amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(0.42, t + 0.08);
    amp.gain.setTargetAtTime(0.22, t + 0.5, 0.4); amp.gain.setTargetAtTime(0, t + 1.7, 0.12);
    const flutter = context.createOscillator(), depth = context.createGain(), wobble = context.createGain();
    flutter.frequency.setValueAtTime(15, t); flutter.frequency.exponentialRampToValueAtTime(4.5, t + 1.9);
    depth.gain.value = 0.5; wobble.gain.value = 0.55;
    flutter.connect(depth); depth.connect(wobble.gain);
    source.connect(band); band.connect(wobble); wobble.connect(amp); amp.connect(out);
    source.start(t); source.stop(t + 2.2); flutter.start(t); flutter.stop(t + 2.2); nodes.push(source, flutter);
    const knock = context.createOscillator(), knockAmp = context.createGain();
    knock.type = 'triangle'; knock.frequency.setValueAtTime(130, t + 1.86); knock.frequency.exponentialRampToValueAtTime(70, t + 2);
    knockAmp.gain.setValueAtTime(0, t + 1.86); knockAmp.gain.linearRampToValueAtTime(0.35, t + 1.875); knockAmp.gain.exponentialRampToValueAtTime(0.001, t + 2.1);
    knock.connect(knockAmp); knockAmp.connect(out); knock.start(t + 1.86); knock.stop(t + 2.2); nodes.push(knock);
  }

  function bell(context: AudioContext, out: GainNode, t: number, nodes: AudioScheduledSourceNode[]): void {
    // A small brass hand bell rung twice: inharmonic partials (a struck bell's 1 : 2.76 : 5.4 ratios) with long,
    // partial-by-partial decays, the second stroke softer.
    for (const [at, level] of [[0, 0.32], [0.24, 0.2]] as const) {
      for (const [ratio, part, decay] of [[1, 1, 1.3], [2.76, 0.42, 0.7], [5.4, 0.2, 0.35], [8.9, 0.08, 0.18]] as const) {
        const osc = context.createOscillator(), amp = context.createGain();
        osc.type = 'sine'; osc.frequency.value = 1046.5 * ratio;
        amp.gain.setValueAtTime(0, t + at); amp.gain.linearRampToValueAtTime(level * part, t + at + 0.004);
        amp.gain.exponentialRampToValueAtTime(0.0008, t + at + decay * 1.4);
        osc.connect(amp); amp.connect(out); osc.start(t + at); osc.stop(t + at + decay * 1.4 + 0.05); nodes.push(osc);
      }
    }
  }

  function roll(context: AudioContext, out: GainNode, t: number, nodes: AudioScheduledSourceNode[]): void {
    // Wooden wheels on packed earth: low rumble that swells and fades, with the pony's soft hoof clops on top.
    const source = context.createBufferSource(); source.buffer = noiseBuffer(context);
    const low = context.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 260; low.Q.value = 0.7;
    const amp = context.createGain(); amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(0.34, t + 0.6);
    amp.gain.setTargetAtTime(0.22, t + 1.4, 0.5); amp.gain.setTargetAtTime(0, t + 2.7, 0.25);
    source.connect(low); low.connect(amp); amp.connect(out); source.start(t); source.stop(t + 3.4); nodes.push(source);
    for (let i = 0; i < 10; i++) {
      // Two pairs per stride, each pair a hair apart, slowing as the pony reins in.
      const at = t + 0.15 + i * (0.27 + i * 0.012) + (i % 2) * 0.05;
      const clop = context.createOscillator(), click = context.createGain();
      clop.type = 'triangle'; clop.frequency.setValueAtTime(i % 2 ? 360 : 300, at); clop.frequency.exponentialRampToValueAtTime(150, at + 0.06);
      click.gain.setValueAtTime(0, at); click.gain.linearRampToValueAtTime(0.16 * (1 - i / 14), at + 0.004); click.gain.exponentialRampToValueAtTime(0.001, at + 0.09);
      clop.connect(click); click.connect(out); clop.start(at); clop.stop(at + 0.12); nodes.push(clop);
    }
  }

  function land(context: AudioContext, out: GainNode, t: number, nodes: AudioScheduledSourceNode[]): void {
    // A parcel's weight on the doorstep: a hollow cardboard knock, then a short paper rustle as the canopy sags.
    const knock = context.createOscillator(), body = context.createGain();
    knock.type = 'sine'; knock.frequency.setValueAtTime(190, t); knock.frequency.exponentialRampToValueAtTime(92, t + 0.09);
    body.gain.setValueAtTime(0, t); body.gain.linearRampToValueAtTime(0.42, t + 0.003); body.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    knock.connect(body); body.connect(out); knock.start(t); knock.stop(t + 0.25); nodes.push(knock);
    const paper = context.createBufferSource(); paper.buffer = noiseBuffer(context);
    const high = context.createBiquadFilter(); high.type = 'bandpass'; high.frequency.value = 3600; high.Q.value = 0.6;
    const rustle = context.createGain(); rustle.gain.setValueAtTime(0, t + 0.12); rustle.gain.linearRampToValueAtTime(0.14, t + 0.2);
    rustle.gain.setTargetAtTime(0.05, t + 0.3, 0.1); rustle.gain.setTargetAtTime(0, t + 0.55, 0.08);
    paper.connect(high); high.connect(rustle); rustle.connect(out); paper.start(t + 0.12, 0.7); paper.stop(t + 0.8); nodes.push(paper);
  }

  // ---------------------------------------------------------------- the sky

  function sparkRise(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // One mote climbing: a soft sine whistle gliding up with a breath of hiss under it, then a glassy twinkle at
    // the top, two tiny glass strikes, the second higher and softer.
    const whistle = toneAt(context, nodes, 'sine', 820, t, t + 1.7), body = gainNode(context);
    glide(whistle.frequency, t, [[0, 820], [1.35, 2350], [1.6, 2480]]);
    lfo(context, nodes, 'sine', 6.5, 16, whistle.detune, t, t + 1.7);
    glide(body.gain, t, [[0, 0], [0.35, 0.05], [1.25, 0.038], [1.58, 0]], 'linear');
    chain(whistle, body, out);
    const air = filterNode(context, 'bandpass', 1600, 3), hiss = gainNode(context);
    glide(air.frequency, t, [[0, 1600], [1.4, 5000]]);
    glide(hiss.gain, t, [[0, 0], [0.4, 0.07], [1.3, 0.05], [1.6, 0]], 'linear');
    chain(noiseAt(context, nodes, t, t + 1.7, 1.3), air, hiss, out);
    for (const [at, hz, level] of [[1.5, 3136, 0.07], [1.66, 4186, 0.04]] as const) {
      for (const [ratio, part, decay] of [[1, 1, 0.38], [2.32, 0.35, 0.2], [4.1, 0.12, 0.1]] as const) {
        const amp = gainNode(context);
        strike(amp.gain, t + at, level * part, 0.003, decay);
        chain(toneAt(context, nodes, 'sine', hz * ratio, t + at, t + at + decay + 0.05), amp, out);
      }
    }
  }

  function fireworkLaunch(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // The mortar's thump and its puff of smoke, then the shell's whistle climbing with the fizz of its fuse; both
    // gone by the burst (the street fuse is 1.25 s).
    const thump = toneAt(context, nodes, 'sine', 130, t, t + 0.4), thumpAmp = gainNode(context);
    glide(thump.frequency, t, [[0, 130], [0.14, 46]]); strike(thumpAmp.gain, t, 0.48, 0.004, 0.3);
    chain(thump, thumpAmp, out);
    const puff = gainNode(context); strike(puff.gain, t, 0.5, 0.003, 0.16);
    chain(noiseAt(context, nodes, t, t + 0.3, 0.4), filterNode(context, 'lowpass', 900), puff, out);
    const whistle = toneAt(context, nodes, 'sine', 640, t + 0.06, t + 1.35), whistleAmp = gainNode(context);
    glide(whistle.frequency, t, [[0.06, 640], [1.2, 2100]]);
    lfo(context, nodes, 'sine', 9, 28, whistle.detune, t + 0.06, t + 1.35);
    glide(whistleAmp.gain, t, [[0.06, 0], [0.3, 0.05], [1.05, 0.036], [1.26, 0]], 'linear');
    chain(whistle, whistleAmp, out);
    const fizz = gainNode(context); glide(fizz.gain, t, [[0.05, 0], [0.2, 0.09], [1.0, 0.04], [1.28, 0]], 'linear');
    chain(noiseAt(context, nodes, t + 0.05, t + 1.35, 2.1), filterNode(context, 'bandpass', 3200, 1.4), fizz, out);
  }

  function fireworkBloom(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // The bloom: a deep, round boom felt more than heard. Two falling sines, a low-passed noise body that darkens
    // as it fades, a softened first crack so it has an edge without a snap, and a little room behind it all.
    const tail = room(context, out, 0.9, 0.3, 1400);
    for (const [from, to, level, decay] of [[78, 32, 0.5, 1.3], [124, 52, 0.2, 0.7]] as const) {
      const osc = toneAt(context, nodes, 'sine', from, t, t + decay + 0.1), amp = gainNode(context);
      glide(osc.frequency, t, [[0, from], [0.5, to]]); strike(amp.gain, t, level, 0.008, decay);
      chain(osc, amp, out); amp.connect(tail);
    }
    const low = filterNode(context, 'lowpass', 700, 0.5), body = gainNode(context);
    glide(low.frequency, t, [[0, 700], [0.9, 140]]); strike(body.gain, t, 0.85, 0.006, 1.05);
    chain(noiseAt(context, nodes, t, t + 1.3, 0.9), low, body, out); body.connect(tail);
    const crack = gainNode(context); strike(crack.gain, t, 0.12, 0.002, 0.05);
    chain(noiseAt(context, nodes, t, t + 0.1, 0.2), filterNode(context, 'bandpass', 1800, 0.8), crack, out); crack.connect(tail);
  }

  function fireworkCrackle(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // The bloom's glittering tail: a sparse field of tiny crackles across the sky, densest first, thinning and
    // fading, over the faintest sizzle. The scatter is seeded, so the same shell crackles the same way.
    const next = scatter(0x5eed1e55);
    for (let i = 0; i < 44; i++) {
      const at = t + 0.04 + 2.1 * next() ** 1.7, fade = 1 - (at - t) / 2.35;
      grain(context, nodes, out, at, 0.006 + next() * 0.016, 2200 + next() * 4200, 2.5, (0.12 + next() * 0.3) * fade, next() * 1.4 - 0.7, next() * 5);
    }
    const sizzle = gainNode(context); glide(sizzle.gain, t, [[0, 0], [0.1, 0.03], [2.2, 0]], 'linear');
    chain(noiseAt(context, nodes, t, t + 2.25, 4.4), filterNode(context, 'highpass', 5200), sizzle, out);
  }

  function beastCall(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // The Hearthbeast's call: a great warm voice, a lion's soft roar more than a growl. A sawtooth throat with a
    // sub octave and a breath of noise, a slow soft rattle, a touch of grit, and three formants that open towards
    // "ah" as the pitch rises and close to "oh" as it settles. A little room carries it over the roofs.
    const end = t + 2.0, tail = room(context, out, 0.5, 0.26, 1800);
    const contour = [[0, 92], [0.45, 128], [1.1, 118], [1.8, 84]] as const;
    const throat = toneAt(context, nodes, 'sawtooth', 92, t, end), sub = toneAt(context, nodes, 'triangle', 46, t, end);
    glide(throat.frequency, t, contour); glide(sub.frequency, t, contour.map(([at, hz]) => [at, hz / 2] as const));
    const mix = gainNode(context, 0.75);
    lfo(context, nodes, 'sine', 19, 0.22, mix.gain, t, end);
    throat.connect(mix);
    chain(noiseAt(context, nodes, t, end, 3.3), filterNode(context, 'bandpass', 900, 0.6), gainNode(context, 0.7), mix);
    const grit = shaper(context, 1.6), voice = gainNode(context);
    mix.connect(grit);
    for (const [points, q, level] of [
      [[[0, 620], [0.5, 760], [1.8, 420]], 5, 1.4], [[[0, 1050], [0.5, 1220], [1.8, 760]], 7, 0.8], [[[0, 2450], [1.8, 2300]], 9, 0.3],
    ] as const) {
      const formant = filterNode(context, 'bandpass', 600, q);
      glide(formant.frequency, t, points);
      chain(grit, formant, gainNode(context, level), voice);
    }
    chain(grit, filterNode(context, 'lowpass', 380), gainNode(context, 0.6), voice);
    chain(sub, gainNode(context, 0.5), voice);
    const level = gainNode(context);
    glide(level.gain, t, [[0, 0], [0.28, 0.34], [1.1, 0.3], [1.75, 0.07], [1.96, 0]], 'linear');
    chain(voice, level, out); level.connect(tail);
  }

  function beastWings(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // One great feathered downstroke: a broad whoosh that swells and sweeps, the fine flutter of feathers riding on
    // it, and a soft push of air beneath.
    const sweep = filterNode(context, 'bandpass', 420, 0.9), feathers = gainNode(context, 0.7), whoosh = gainNode(context);
    glide(sweep.frequency, t, [[0, 420], [0.38, 1300], [0.95, 480]]);
    lfo(context, nodes, 'sine', 26, 0.3, feathers.gain, t, t + 1.05);
    glide(whoosh.gain, t, [[0, 0], [0.32, 0.5], [0.5, 0.36], [0.98, 0]], 'linear');
    chain(noiseAt(context, nodes, t, t + 1.05, 4.1), sweep, feathers, whoosh, out);
    const fine = gainNode(context); glide(fine.gain, t, [[0, 0], [0.34, 0.05], [0.8, 0]], 'linear');
    chain(noiseAt(context, nodes, t, t + 0.85, 2.7), filterNode(context, 'highpass', 4200), fine, out);
    const push = toneAt(context, nodes, 'sine', 72, t + 0.22, t + 0.85), pushAmp = gainNode(context);
    glide(push.frequency, t, [[0.22, 72], [0.6, 40]]); strike(pushAmp.gain, t + 0.24, 0.22, 0.1, 0.42);
    chain(push, pushAmp, out);
  }

  function auroraSwell(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // The aurora's swell: a slow, airy pad like a far choir. Detuned triangle and sine pairs on an open D chord,
    // through a soft filter that opens with the light and closes as it settles and an "ah" lift in the middle; a
    // slow vibrato, a breath of air on top and a room around it.
    const end = t + 5.0, tail = room(context, out, 1.0, 0.36, 2200);
    const soft = filterNode(context, 'lowpass', 520, 0.9), vowel = filterNode(context, 'peaking', 850, 1.2), pad = gainNode(context);
    vowel.gain.value = 7;
    glide(soft.frequency, t, [[0, 520], [2.6, 2100], [4.9, 700]]);
    glide(pad.gain, t, [[0, 0], [2.4, 0.12], [3.4, 0.1], [4.9, 0]], 'linear');
    chain(soft, vowel, pad, out); pad.connect(tail);
    const vibrato = gainNode(context, 5), chorus = gainNode(context, 7);
    toneAt(context, nodes, 'sine', 4.6, t, end).connect(vibrato);
    toneAt(context, nodes, 'sine', 0.23, t, end).connect(chorus);
    for (const [hz, level] of [[146.83, 0.3], [220, 0.26], [293.66, 0.24], [369.99, 0.18], [440, 0.15], [659.25, 0.07]] as const) {
      for (const [type, detune] of [['triangle', -7], ['sine', 6]] as const) {
        const osc = toneAt(context, nodes, type, hz, t, end); osc.detune.value = detune;
        vibrato.connect(osc.detune); if (type === 'sine') chorus.connect(osc.detune);
        chain(osc, gainNode(context, level * 0.5), soft);
      }
    }
    const breath = gainNode(context); glide(breath.gain, t, [[0, 0], [2.4, 0.045], [4.9, 0]], 'linear');
    chain(noiseAt(context, nodes, t, end, 5.1), filterNode(context, 'bandpass', 3200, 0.8), breath, out); breath.connect(tail);
  }

  function kiteWind(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // Kites on the wind: a soft gust that rises, leans and sighs away, a low body under it, cloth flutter in the
    // middle of it, and the faint hum of a taut string.
    const end = t + 3.9, gust = filterNode(context, 'bandpass', 700, 1.1), wind = gainNode(context);
    lfo(context, nodes, 'sine', 0.42, 260, gust.frequency, t, end);
    glide(wind.gain, t, [[0, 0], [1.1, 0.24], [1.9, 0.32], [2.8, 0.17], [3.8, 0]], 'linear');
    chain(noiseAt(context, nodes, t, end, 0.6), gust, wind, out);
    const body = gainNode(context); glide(body.gain, t, [[0, 0], [1.6, 0.4], [3.7, 0]], 'linear');
    chain(noiseAt(context, nodes, t, end, 2.2), filterNode(context, 'lowpass', 320), body, out);
    const flap = gainNode(context, 0.5), cloth = gainNode(context);
    const flutter = lfo(context, nodes, 'square', 10, 0.5, flap.gain, t + 0.7, t + 3.4);
    glide(flutter.frequency, t, [[0.7, 10], [1.8, 17], [3.3, 11]]);
    glide(cloth.gain, t, [[0.7, 0], [1.4, 0.13], [2.6, 0.11], [3.3, 0]], 'linear');
    chain(noiseAt(context, nodes, t + 0.7, t + 3.4, 3.9), filterNode(context, 'bandpass', 1900, 1.4), flap, cloth, out);
    const string = toneAt(context, nodes, 'triangle', 523.25, t + 0.9, t + 3.5), hum = gainNode(context);
    lfo(context, nodes, 'sine', 5.5, 8, string.detune, t + 0.9, t + 3.5);
    glide(hum.gain, t, [[0.9, 0], [1.8, 0.014], [3.4, 0]], 'linear');
    chain(string, filterNode(context, 'lowpass', 1500), hum, out);
  }

  function confettiPop(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // A party popper: a bright paper pop with a little round body, two cheerful glints, then a flurry of paper
    // flecks drifting down over a soft rustle.
    const pop = gainNode(context); strike(pop.gain, t, 0.5, 0.001, 0.07);
    chain(noiseAt(context, nodes, t, t + 0.15, 1.9), filterNode(context, 'bandpass', 1700, 0.7), pop, out);
    const body = toneAt(context, nodes, 'sine', 480, t, t + 0.14), bodyAmp = gainNode(context);
    glide(body.frequency, t, [[0, 480], [0.06, 170]]); strike(bodyAmp.gain, t, 0.26, 0.002, 0.08);
    chain(body, bodyAmp, out);
    for (const [at, hz, level] of [[0.07, 1567.98, 0.045], [0.13, 2093, 0.035]] as const) {
      const amp = gainNode(context); strike(amp.gain, t + at, level, 0.003, 0.22);
      chain(toneAt(context, nodes, 'sine', hz, t + at, t + at + 0.28), amp, out);
    }
    const next = scatter(0xc0ffee11);
    for (let i = 0; i < 30; i++) {
      const at = t + 0.08 + 1.3 * next() ** 1.4, fade = 1 - (at - t) / 1.55;
      grain(context, nodes, out, at, 0.012 + next() * 0.03, 3500 + next() * 3500, 1.8, (0.1 + next() * 0.16) * fade, next() * 1.6 - 0.8, next() * 5);
    }
    const rustle = gainNode(context); glide(rustle.gain, t, [[0.05, 0], [0.15, 0.08], [1.35, 0]], 'linear');
    chain(noiseAt(context, nodes, t + 0.05, t + 1.4, 3.4), filterNode(context, 'bandpass', 6000, 0.7), rustle, out);
  }

  function balloonRise(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // A balloon lifting away: a gentle rising tone, round and soft, a fifth over its climb; its mooring rope
    // creaking three times as it pulls free; a soft breath of air.
    const end = t + 1.9, tone = gainNode(context);
    glide(tone.gain, t, [[0, 0], [0.4, 1], [1.3, 0.8], [1.85, 0]], 'linear');
    tone.connect(out);
    for (const [type, octave, level] of [['sine', 1, 0.06], ['triangle', 2, 0.018]] as const) {
      const osc = toneAt(context, nodes, type, 330 * octave, t, end);
      glide(osc.frequency, t, [[0, 330 * octave], [1.6, 495 * octave]]);
      lfo(context, nodes, 'sine', 4.8, 9, osc.detune, t, end);
      chain(osc, gainNode(context, level), tone);
    }
    for (const [at, rate, level] of [[0.12, 38, 1.6], [0.55, 52, 1.3], [0.95, 30, 1.0]] as const) {
      // A creak is a slow buzz of tiny slips: a low sawtooth through a narrow wooden resonance.
      const saw = toneAt(context, nodes, 'sawtooth', rate, t + at, t + at + 0.27), creak = gainNode(context);
      glide(saw.frequency, t, [[at, rate], [at + 0.22, rate * 1.35]]);
      glide(creak.gain, t, [[at, 0], [at + 0.04, level], [at + 0.18, level * 0.6], [at + 0.25, 0]], 'linear');
      chain(saw, filterNode(context, 'bandpass', 1100, 7), creak, out);
    }
    const air = gainNode(context); glide(air.gain, t, [[0, 0], [0.5, 0.2], [1.8, 0]], 'linear');
    chain(noiseAt(context, nodes, t, end, 4.7), filterNode(context, 'lowpass', 500), air, out);
  }

  // ---------------------------------------------------------------- the Hype Train

  function trainWhistle(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // A steam whistle in two tones: a short toot, then the long call. Each is two chime pipes a third apart
    // sounding together, scooping up into pitch as the steam catches, with the steam's breath around each pipe
    // and a hiss over all.
    const end = t + 1.88, voice = gainNode(context);
    glide(voice.gain, t, [[0, 0], [0.05, 0.2], [0.28, 0.18], [0.34, 0], [0.44, 0], [0.52, 0.24], [1.55, 0.2], [1.82, 0]], 'linear');
    chain(voice, filterNode(context, 'lowpass', 3600), out);
    for (const hz of [554.37, 698.46]) {
      const pipe = toneAt(context, nodes, 'sine', hz, t, end), edge = toneAt(context, nodes, 'triangle', hz, t, end);
      for (const osc of [pipe, edge]) glide(osc.frequency, t, [[0, hz * 0.95], [0.07, hz], [0.36, hz], [0.44, hz * 0.95], [0.52, hz], [1.6, hz], [1.82, hz * 0.97]]);
      chain(pipe, gainNode(context, 0.36), voice);
      chain(edge, gainNode(context, 0.12), voice);
      chain(noiseAt(context, nodes, t, end, hz / 400), filterNode(context, 'bandpass', hz, 14), gainNode(context, 2.2), voice);
    }
    chain(noiseAt(context, nodes, t, end, 0.3), filterNode(context, 'highpass', 2500), gainNode(context, 0.08), voice);
  }

  function trainSteam(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // The engine pulling away: nine chuffs, slow and heavy at first, quickening to a steady running beat. Each is a
    // burst of steam with a hiss on top and a low chug inside; the first of each pair leans a little harder.
    const gaps = [0.52, 0.45, 0.4, 0.36, 0.33, 0.31, 0.3, 0.3];
    let at = t + 0.02;
    for (let i = 0; i < 9; i++) {
      const accent = (i % 2 ? 0.75 : 1) * (i < 6 ? 1 : 1 - (i - 5) * 0.12);
      const steam = noiseAt(context, nodes, at, at + 0.34, (i * 0.37) % 5), puff = gainNode(context), hiss = gainNode(context);
      strike(puff.gain, at, 0.62 * accent, 0.012, 0.22); strike(hiss.gain, at, 0.08 * accent, 0.008, 0.15);
      chain(steam, filterNode(context, 'bandpass', 650 + i * 30, 0.9), puff, out);
      chain(steam, filterNode(context, 'highpass', 3000), hiss, out);
      const chug = toneAt(context, nodes, 'sine', 75, at, at + 0.22), chugAmp = gainNode(context);
      glide(chug.frequency, at, [[0, 75], [0.12, 48]]); strike(chugAmp.gain, at, 0.18 * accent, 0.006, 0.14);
      chain(chug, chugAmp, out);
      at += gaps[i] ?? 0;
    }
  }

  function carriageCouple(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // A carriage coupling on: the buffers bump, the iron hook drops into its link with a ringing clunk, and the
    // chain gives one small rattle after.
    const bump = toneAt(context, nodes, 'sine', 96, t, t + 0.3), bumpAmp = gainNode(context);
    glide(bump.frequency, t, [[0, 96], [0.16, 52]]); strike(bumpAmp.gain, t, 0.42, 0.004, 0.2);
    chain(bump, bumpAmp, out);
    const thud = gainNode(context); strike(thud.gain, t, 0.6, 0.003, 0.09);
    chain(noiseAt(context, nodes, t, t + 0.15, 1.6), filterNode(context, 'lowpass', 500), thud, out);
    for (const [at, partials] of [
      [0.14, [[340, 0.12, 0.32], [912, 0.08, 0.22], [1530, 0.05, 0.14], [2470, 0.03, 0.08]]], [0.31, [[1180, 0.03, 0.1], [1860, 0.02, 0.07]]],
    ] as const) {
      for (const [hz, level, decay] of partials) {
        const amp = gainNode(context); strike(amp.gain, t + at, level, 0.002, decay);
        chain(toneAt(context, nodes, 'sine', hz, t + at, t + at + decay + 0.05), amp, out);
      }
      const click = gainNode(context); strike(click.gain, t + at, at < 0.2 ? 0.22 : 0.08, 0.001, 0.025);
      chain(noiseAt(context, nodes, t + at, t + at + 0.06, 2.9 + at), filterNode(context, 'bandpass', 2600, 1.2), click, out);
    }
  }

  function festivalDrum(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // A festive frame-drum figure with a tambourine: low open strokes, quick high slaps, jingles on the offbeats,
    // and a shaken roll into the last big stroke.
    const strokes = [[0, 'low', 1], [0.3, 'high', 0.6], [0.45, 'high', 0.5], [0.6, 'low', 0.9], [0.9, 'high', 0.6], [1.2, 'low', 0.9],
      [1.35, 'high', 0.5], [1.5, 'high', 0.6], [1.8, 'low', 1.1]] as const;
    for (const [at, kind, level] of strokes) {
      const hz = kind === 'low' ? 92 : 190, decay = kind === 'low' ? 0.42 : 0.16;
      const skin = toneAt(context, nodes, 'sine', hz * 1.5, t + at, t + at + decay + 0.05), amp = gainNode(context), slap = gainNode(context);
      glide(skin.frequency, t, [[at, hz * 1.5], [at + 0.03, hz], [at + decay, hz * 0.85]]);
      strike(amp.gain, t + at, 0.34 * level, 0.002, decay); strike(slap.gain, t + at, 0.4 * level, 0.001, kind === 'low' ? 0.06 : 0.04);
      chain(skin, amp, out);
      chain(noiseAt(context, nodes, t + at, t + at + 0.1, at * 2.3), filterNode(context, 'lowpass', kind === 'low' ? 450 : 1400), slap, out);
    }
    const jingle = (at: number, level: number, decay: number): void => {
      const shake = gainNode(context); strike(shake.gain, t + at, 0.3 * level, 0.002, decay);
      chain(noiseAt(context, nodes, t + at, t + at + decay + 0.03, 1 + at), filterNode(context, 'bandpass', 7500, 1.5), shake, out);
      for (const hz of [5200, 6900, 8100]) {
        const ring = gainNode(context); strike(ring.gain, t + at, 0.014 * level, 0.002, decay + 0.03);
        chain(toneAt(context, nodes, 'sine', hz, t + at, t + at + decay + 0.08), ring, out);
      }
    };
    for (const [at, level] of [[0.15, 0.7], [0.75, 0.8], [1.05, 0.7], [1.65, 0.6]] as const) jingle(at, level, 0.09);
    // The roll: the tambourine shaken fast (a pulsing tremolo) into the final stroke, which jingles long.
    const roll = gainNode(context, 0.5), rollAmp = gainNode(context);
    lfo(context, nodes, 'square', 22, 0.5, roll.gain, t + 1.52, t + 1.82);
    glide(rollAmp.gain, t, [[1.52, 0], [1.78, 0.12], [1.8, 0]], 'linear');
    chain(noiseAt(context, nodes, t + 1.52, t + 1.82, 3.1), filterNode(context, 'bandpass', 7000, 1.2), roll, rollAmp, out);
    jingle(1.8, 1, 0.3);
  }

  // ---------------------------------------------------------------- the dragon

  /**
   * A dragon's throat, shared by the roar and the fall: detuned saws (and a square) along a pitch contour, the
   * throat shaken by a rattle at a drifting rate with a slower jitter so it never sounds like a motor, breath
   * noise through the same rattle, gentle grit, then moving formants and a chest path. Returns the voice bus.
   */
  function throat(context: AudioContext, nodes: Nodes, t: number, end: number, spec: {
    contour: readonly Point[]; rattle: readonly Point[]; depth: number; drive: number; breath: readonly Point[];
    formants: readonly (readonly [points: readonly Point[], q: number, level: number])[]; chest: number;
  }): GainNode {
    const rattled = gainNode(context, 0.6), voice = gainNode(context, 1);
    for (const [type, detune, level] of [['sawtooth', -9, 0.6], ['sawtooth', 11, 0.5], ['square', 0, 0.22]] as const) {
      const osc = toneAt(context, nodes, type, spec.contour[0]?.[1] ?? 60, t, end); osc.detune.value = detune;
      glide(osc.frequency, t, spec.contour);
      chain(osc, gainNode(context, level), rattled);
    }
    glide(lfo(context, nodes, 'sine', 30, spec.depth, rattled.gain, t, end).frequency, t, spec.rattle);
    lfo(context, nodes, 'triangle', 7.3, spec.depth * 0.33, rattled.gain, t, end);
    const breath = filterNode(context, 'bandpass', 900, 0.5);
    glide(breath.frequency, t, spec.breath);
    chain(noiseAt(context, nodes, t, end, 0.15), breath, gainNode(context, 0.8), rattled);
    const grit = shaper(context, spec.drive);
    rattled.connect(grit);
    for (const [points, q, level] of spec.formants) {
      const formant = filterNode(context, 'bandpass', 600, q);
      glide(formant.frequency, t, points);
      chain(grit, formant, gainNode(context, level), voice);
    }
    chain(grit, filterNode(context, 'lowpass', spec.chest), gainNode(context, 0.65), voice);
    return voice;
  }

  function dragonRoar(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // The roar, a sound you feel. Four layers: a sub rumble in the chest (36-72 Hz, swelling with the call); the
    // throat rising from a growl to a full cry and falling away, formants opening "ah" at the height; a low noise
    // rumble like the ground answering; and a long dark room the whole town sits inside.
    const end = t + 2.45, tail = room(context, out, 1.1, 0.42, 1500);
    const voice = throat(context, nodes, t, end, {
      contour: [[0, 62], [0.35, 96], [0.9, 128], [1.5, 104], [2.1, 66], [2.4, 52]],
      rattle: [[0, 24], [0.9, 34], [2.4, 18]], depth: 0.45, drive: 2.6,
      breath: [[0, 700], [0.9, 1500], [2.4, 600]],
      formants: [
        [[[0, 380], [0.9, 700], [2.4, 320]], 4, 1.5], [[[0, 820], [0.9, 1150], [2.4, 700]], 5, 0.8], [[[0, 2100], [0.9, 2500], [2.4, 1900]], 6, 0.3],
      ],
      chest: 260,
    });
    const level = gainNode(context);
    glide(level.gain, t, [[0, 0], [0.18, 0.16], [0.6, 0.34], [1.4, 0.31], [2.0, 0.12], [2.42, 0]], 'linear');
    chain(voice, level, out); level.connect(tail);
    const sub = gainNode(context);
    glide(sub.gain, t, [[0, 0], [0.4, 0.3], [1.5, 0.27], [2.6, 0]], 'linear');
    sub.connect(out);
    for (const [from, peak, last, part] of [[36, 50, 32, 1], [54, 72, 44, 0.45]] as const) {
      const osc = toneAt(context, nodes, 'sine', from, t, t + 2.65);
      glide(osc.frequency, t, [[0, from], [0.9, peak], [2.6, last]]);
      chain(osc, gainNode(context, part), sub);
    }
    const rumble = gainNode(context); glide(rumble.gain, t, [[0, 0], [0.5, 0.7], [1.6, 0.6], [2.7, 0]], 'linear');
    chain(noiseAt(context, nodes, t, t + 2.75, 3.7), filterNode(context, 'lowpass', 110, 0.8), rumble, out);
  }

  function dragonWings(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // One heavy leathery wingbeat: the upstroke's soft draw, the downstroke's whump of air, and the membrane
    // snapping taut at the bottom of it.
    const low = filterNode(context, 'lowpass', 260, 0.9), air = gainNode(context);
    glide(low.frequency, t, [[0, 260], [0.36, 950], [0.9, 220]]);
    glide(air.gain, t, [[0, 0], [0.18, 0.12], [0.34, 0.75], [0.55, 0.45], [1.05, 0]], 'linear');
    chain(noiseAt(context, nodes, t, t + 1.1, 4.6), low, air, out);
    const whump = toneAt(context, nodes, 'sine', 64, t + 0.3, t + 0.85), whumpAmp = gainNode(context);
    glide(whump.frequency, t, [[0.3, 64], [0.6, 34]]); strike(whumpAmp.gain, t + 0.3, 0.42, 0.03, 0.45);
    chain(whump, whumpAmp, out);
    for (const [hz, q, level, decay] of [[620, 2.2, 0.5, 0.09], [1500, 1.5, 0.18, 0.05]] as const) {
      const snap = gainNode(context); strike(snap.gain, t + 0.4, level, 0.003, decay);
      chain(noiseAt(context, nodes, t + 0.4, t + 0.4 + decay + 0.05, hz / 300), filterNode(context, 'bandpass', hz, q), snap, out);
    }
  }

  function dragonBreath(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // Fire breath: a roaring rush that swells, burns and fades, flickering as it goes, a furnace rumble under it,
    // the crackle of flame through it, and a little room so it fills the sky.
    const end = t + 2.3, tail = room(context, out, 0.4, 0.24, 1800);
    const roar = filterNode(context, 'lowpass', 500, 0.8), flicker = gainNode(context, 0.8), rush = gainNode(context);
    glide(roar.frequency, t, [[0, 500], [0.5, 2600], [1.4, 1800], [2.2, 500]]);
    glide(lfo(context, nodes, 'triangle', 14, 0.2, flicker.gain, t, end).frequency, t, [[0, 14], [2.2, 7]]);
    glide(rush.gain, t, [[0, 0], [0.45, 0.4], [1.4, 0.34], [2.25, 0]], 'linear');
    chain(noiseAt(context, nodes, t, end, 1.1), roar, flicker, rush, out); rush.connect(tail);
    const furnace = gainNode(context); glide(furnace.gain, t, [[0, 0], [0.5, 0.65], [1.5, 0.5], [2.3, 0]], 'linear');
    chain(noiseAt(context, nodes, t, end, 2.6), filterNode(context, 'lowpass', 140), furnace, out);
    const next = scatter(0xf1a3e5);
    for (let i = 0; i < 26; i++) {
      const at = t + 0.25 + next() * 1.75, fade = 1 - (at - t) / 2.3;
      grain(context, nodes, out, at, 0.004 + next() * 0.016, 2000 + next() * 3000, 2, (0.12 + next() * 0.26) * fade, next() * 1.2 - 0.6, next() * 5);
    }
  }

  function dragonHit(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // A strike landing: a solid thunk into a great body, the crack of the blow, and a short ring off the scales
    // like struck plate, its lowest pair a hair apart so the ring shimmers.
    const thunk = toneAt(context, nodes, 'sine', 150, t, t + 0.3), thunkAmp = gainNode(context);
    glide(thunk.frequency, t, [[0, 150], [0.12, 58]]); strike(thunkAmp.gain, t, 0.5, 0.003, 0.2);
    chain(thunk, thunkAmp, out);
    for (const [kind, hz, q, level, decay] of [['lowpass', 700, 0.7, 0.75, 0.08], ['bandpass', 2200, 1, 0.16, 0.025]] as const) {
      const body = gainNode(context); strike(body.gain, t, level, 0.0015, decay);
      chain(noiseAt(context, nodes, t, t + decay + 0.05, hz / 500), filterNode(context, kind, hz, q), body, out);
    }
    for (const [hz, level, decay] of [[612, 0.06, 0.5], [614.5, 0.03, 0.46], [1003, 0.045, 0.38], [1597, 0.03, 0.26], [2281, 0.02, 0.17], [3170, 0.01, 0.1]] as const) {
      const amp = gainNode(context); strike(amp.gain, t + 0.005, level, 0.002, decay);
      chain(toneAt(context, nodes, 'sine', hz, t + 0.005, t + decay + 0.06), amp, out);
    }
  }

  function dragonFall(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // The fall: a long groan sinking from a weary cry to a moan, the rush of air as it spirals down, the ground
    // taking its weight at DRAGON_FALL_IMPACT_MS, then the debris settling: a rumble and a patter of stones.
    const impact = DRAGON_FALL_IMPACT_MS / 1000, tail = room(context, out, 0.9, 0.3, 1300);
    const voice = throat(context, nodes, t, t + 2.55, {
      contour: [[0, 190], [0.4, 205], [2.2, 62], [2.5, 55]],
      rattle: [[0, 17], [2.5, 11]], depth: 0.35, drive: 1.8,
      breath: [[0, 1100], [2.5, 500]],
      formants: [[[[0, 560], [2.4, 300]], 4, 1.3], [[[0, 1100], [2.4, 650]], 5, 0.6]],
      chest: 300,
    });
    const groan = gainNode(context);
    glide(groan.gain, t, [[0, 0], [0.25, 0.24], [1.2, 0.22], [2.1, 0.12], [impact, 0]], 'linear');
    chain(voice, groan, out); groan.connect(tail);
    const spiral = filterNode(context, 'bandpass', 350, 0.8), rush = gainNode(context);
    glide(spiral.frequency, t, [[0.6, 350], [2.4, 1500]]);
    glide(rush.gain, t, [[0.6, 0], [2.2, 0.26], [impact, 0]], 'linear');
    chain(noiseAt(context, nodes, t + 0.6, t + impact + 0.05, 1.7), spiral, rush, out);
    const at = t + impact;
    for (const [from, to, level, decay] of [[60, 28, 0.6, 0.9], [95, 45, 0.25, 0.4]] as const) {
      const osc = toneAt(context, nodes, 'sine', from, at, at + decay + 0.1), amp = gainNode(context);
      glide(osc.frequency, at, [[0, from], [0.6, to]]); strike(amp.gain, at, level, 0.006, decay);
      chain(osc, amp, out);
    }
    const dust = gainNode(context); strike(dust.gain, at, 0.9, 0.004, 0.5);
    chain(noiseAt(context, nodes, at, at + 0.6, 4.2), filterNode(context, 'lowpass', 450), dust, out); dust.connect(tail);
    const settle = filterNode(context, 'lowpass', 260), rumble = gainNode(context);
    glide(settle.frequency, at, [[0, 260], [1.4, 120]]);
    glide(rumble.gain, at, [[0, 0], [0.1, 0.6], [1.4, 0]], 'linear');
    chain(noiseAt(context, nodes, at, at + 1.45, 5.3), settle, rumble, out);
    const next = scatter(0xdeb415);
    for (let i = 0; i < 18; i++) {
      const when = at + 0.1 + 1.1 * next() ** 1.3, fade = 1 - (when - at) / 1.3;
      grain(context, nodes, out, when, 0.01 + next() * 0.025, 1200 + next() * 2200, 1.6, (0.1 + next() * 0.2) * fade, next() * 1.2 - 0.6, next() * 5);
    }
  }

  function dragonSnore(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // The dragon asleep in the hills: one slow breath. A rattling snore on the in-breath, a long smoky sigh out
    // with a soft flutter of the lips, and a deep chest rumble under both.
    const snore = toneAt(context, nodes, 'sawtooth', 40, t, t + 1.35), snoreAmp = gainNode(context);
    glide(snore.frequency, t, [[0, 40], [1.2, 48]]);
    glide(snoreAmp.gain, t, [[0, 0], [0.5, 0.12], [1.1, 0.2], [1.32, 0]], 'linear');
    chain(snore, filterNode(context, 'lowpass', 380, 2), snoreAmp, out);
    const draw = filterNode(context, 'bandpass', 450, 1.2), inhale = gainNode(context);
    glide(draw.frequency, t, [[0, 450], [1.2, 800]]);
    glide(inhale.gain, t, [[0, 0], [0.5, 0.1], [1.1, 0.16], [1.32, 0]], 'linear');
    chain(noiseAt(context, nodes, t, t + 1.35, 0.8), draw, inhale, out);
    const sigh = filterNode(context, 'lowpass', 900), lips = gainNode(context, 0.75), exhale = gainNode(context);
    glide(sigh.frequency, t, [[1.45, 900], [2.8, 300]]);
    lfo(context, nodes, 'sine', 9, 0.25, lips.gain, t + 1.4, t + 2.95);
    glide(exhale.gain, t, [[1.4, 0], [1.6, 0.4], [2.2, 0.22], [2.9, 0]], 'linear');
    chain(noiseAt(context, nodes, t + 1.4, t + 2.95, 3.6), sigh, lips, exhale, out);
    const chest = gainNode(context); glide(chest.gain, t, [[0, 0], [1.0, 0.16], [1.5, 0.2], [2.9, 0]], 'linear');
    chain(toneAt(context, nodes, 'sine', 38, t, t + 2.95), chest, out);
  }

  function wyrmBell(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // One stroke of the Wyrm Bell, a great bronze tower bell far below the hand bell: a tuned bell's partial family
    // on a 220 Hz nominal (hum, prime, minor-third tierce, quint, nominal, the high partials), the hum and prime
    // each split a hair so they beat slowly, each with its own decay, the hum blooming a moment after the strike;
    // the clapper's thud under it and a room for the upper partials.
    const bell = gainNode(context, 0.4), tail = room(context, out, 0.8, 0.22, 2400);
    bell.connect(out);
    const prime = 110;
    for (const [ratio, level, decay, attack] of [
      [0.5, 0.26, 3.8, 0.06], [0.5022, 0.12, 3.6, 0.06], [1, 0.22, 3.0, 0.01], [1.0037, 0.1, 2.8, 0.01], [1.183, 0.15, 2.3, 0.004],
      [1.506, 0.06, 1.6, 0.004], [2, 0.13, 1.9, 0.004], [2.52, 0.05, 1.2, 0.003], [3.01, 0.04, 1.0, 0.003], [4.07, 0.025, 0.7, 0.002],
      [5.36, 0.014, 0.45, 0.002],
    ] as const) {
      const amp = gainNode(context); strike(amp.gain, t, level, attack, decay);
      chain(toneAt(context, nodes, 'sine', prime * ratio, t, t + attack + decay + 0.05), amp, bell);
      if (decay <= 2.3) amp.connect(tail);
    }
    const clapper = toneAt(context, nodes, 'sine', 82, t, t + 0.25), thud = gainNode(context);
    glide(clapper.frequency, t, [[0, 82], [0.12, 60]]); strike(thud.gain, t, 0.16, 0.002, 0.14);
    chain(clapper, thud, out);
    const clang = gainNode(context); strike(clang.gain, t, 0.14, 0.001, 0.04);
    chain(noiseAt(context, nodes, t, t + 0.08, 2.4), filterNode(context, 'bandpass', 1800, 0.9), clang, out); clang.connect(tail);
  }

  /** One brass voice in the horn's manner: saw, square and a soft triangle an octave down, through a lip filter. */
  function brass(context: AudioContext, nodes: Nodes, out: AudioNode, hz: number, start: number, length: number, level: number): void {
    const held = length > 0.4, filter = filterNode(context, 'lowpass', hz * 1.4, 2.2), amp = gainNode(context);
    filter.frequency.setValueAtTime(hz * 1.4, start);
    filter.frequency.setTargetAtTime(hz * 6.5, start, 0.05); filter.frequency.setTargetAtTime(hz * 3.2, start + 0.12, 0.2);
    amp.gain.setValueAtTime(0, start); amp.gain.setTargetAtTime(level, start, 0.025);
    amp.gain.setTargetAtTime(0, start + length, held ? 0.16 : 0.03);
    chain(amp, filter, out);
    const stop = start + length + (held ? 0.8 : 0.2);
    for (const [type, detune, part] of [['sawtooth', -4, 0.55], ['square', 5, 0.25], ['triangle', 0, 0.4]] as const) {
      const osc = toneAt(context, nodes, type, type === 'triangle' ? hz / 2 : hz, start, stop); osc.detune.value = detune;
      if (held) {
        const depth = gainNode(context); depth.gain.setValueAtTime(0, start); depth.gain.linearRampToValueAtTime(6, start + 0.5);
        toneAt(context, nodes, 'sine', 5.2, start, stop).connect(depth).connect(osc.detune);
      }
      chain(osc, gainNode(context, part), amp);
    }
  }

  function victoryFanfare(context: AudioContext, out: GainNode, t: number, nodes: Nodes): void {
    // The crowd's victory: a rising brass call in G (D, G, B, then a held high D), the section answering under it
    // with a held G chord, timpani on the pickup and the entry, and a little hall.
    const section = gainNode(context, 1), tail = room(context, out, 0.7, 0.22, 2400);
    section.connect(out); section.connect(tail);
    for (const [hz, at, length] of [[293.66, 0, 0.15], [392, 0.17, 0.15], [493.88, 0.34, 0.15], [587.33, 0.51, 1.69]] as const) {
      brass(context, nodes, section, hz, t + at, length, 0.24);
    }
    for (const [hz, level] of [[196, 0.11], [293.66, 0.09], [392, 0.085], [493.88, 0.075]] as const) brass(context, nodes, section, hz, t + 0.98, 1.22, level);
    for (const [at, hz, level, decay] of [[0.51, 73.42, 0.18, 0.5], [0.98, 98, 0.3, 1.1]] as const) {
      const drum = toneAt(context, nodes, 'sine', hz * 1.06, t + at, t + at + decay + 0.05), amp = gainNode(context), skin = gainNode(context);
      glide(drum.frequency, t, [[at, hz * 1.06], [at + 0.12, hz]]); strike(amp.gain, t + at, level, 0.004, decay);
      strike(skin.gain, t + at, level, 0.002, 0.08);
      chain(drum, amp, out);
      chain(noiseAt(context, nodes, t + at, t + at + 0.12, 3.3 + at), filterNode(context, 'lowpass', 300), skin, out);
    }
  }

  const VOICES: Record<MomentCue, (context: AudioContext, out: GainNode, t: number, nodes: AudioScheduledSourceNode[]) => void> = {
    horn, 'cloth-unfurl': cloth, 'gift-bell': bell, 'cart-roll': roll, 'parcel-land': land,
    'spark-rise': sparkRise, 'firework-launch': fireworkLaunch, 'firework-bloom': fireworkBloom, 'firework-crackle': fireworkCrackle,
    'beast-call': beastCall, 'beast-wings': beastWings, 'aurora-swell': auroraSwell, 'kite-wind': kiteWind, 'confetti-pop': confettiPop,
    'balloon-rise': balloonRise, 'train-whistle': trainWhistle, 'train-steam': trainSteam, 'carriage-couple': carriageCouple,
    'festival-drum': festivalDrum, 'dragon-roar': dragonRoar, 'dragon-wings': dragonWings, 'dragon-breath': dragonBreath, 'dragon-hit': dragonHit,
    'dragon-fall': dragonFall, 'dragon-snore': dragonSnore, 'wyrm-bell': wyrmBell, 'victory-fanfare': victoryFanfare,
  };

  return {
    play(cue, atMs, gain) {
      const audio = options.context(), level = Math.max(0, Math.min(1, gain * options.gain()));
      if (!audio || level === 0) return () => {};
      const { context, destination } = audio;
      const t = context.currentTime + Math.max(0, (atMs - options.now()) / 1000);
      const out = context.createGain(); out.gain.value = level; out.connect(destination);
      const nodes: AudioScheduledSourceNode[] = [];
      VOICES[cue](context, out, t, nodes);
      let done = false;
      const finish = () => { if (done) return; done = true; live.delete(cancel); out.disconnect(); };
      const timer = setTimeout(finish, Math.max(0, (t - context.currentTime) * 1000) + CUE_LENGTH_MS[cue] + 200);
      function cancel(): void {
        if (done) return;
        clearTimeout(timer);
        const now = context.currentTime;
        out.gain.cancelScheduledValues(now); out.gain.setTargetAtTime(0, now, 0.012);
        for (const node of nodes) { try { node.stop(now + 0.05); } catch { /* already stopped */ } }
        setTimeout(finish, 80);
      }
      live.add(cancel);
      return cancel;
    },
    get active() { return live.size; },
  };
}
