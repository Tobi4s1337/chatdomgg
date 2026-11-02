import { noiseBuffer, roomImpulse, seeded } from './rng';

/**
 * A wood fire, authored for the teaser (packages/audio has no continuous fire bed). Original synthesis:
 *
 * - the roar: low-passed noise whose level wanders on a slow random walk, two decorrelated takes left and right;
 * - the flames licking: band-passed noise with a faster flutter;
 * - the crackle: a seeded, clustered stream of short noise ticks with a power-law spread of loudness, each placed
 *   in the stereo field, plus a few bigger pops (a damped ring inside the burst) and short sap hisses;
 * - a small warm room around all of it.
 *
 * `distance` (0 near, 1 across a street) softens the top and the crackle; `size` 0..1 is a hearth (small) or a
 * brazier (large, more roar).
 */
export interface FireOptions {
  seconds: number;
  seed: number;
  sampleRate?: number;
  /** 0..1: hearth to brazier. */
  size?: number;
  /** 0..1: right beside it to across the street. */
  distance?: number;
  /** Where it sits, -1..1. */
  pan?: number;
}

export async function renderFire(options: FireOptions): Promise<AudioBuffer> {
  const rate = options.sampleRate ?? 48000, seconds = options.seconds, size = options.size ?? 0.4, distance = options.distance ?? 0.3;
  const pan = options.pan ?? 0;
  const context = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  const random = seeded(options.seed);

  // Everything meets here, then the distance filter and the room.
  const bus = context.createGain();
  const air = context.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 14000 / (1 + distance * 2.2); air.Q.value = 0.5;
  const guard = context.createBiquadFilter(); guard.type = 'highpass'; guard.frequency.value = 75; guard.Q.value = 0.7;
  const guard2 = context.createBiquadFilter(); guard2.type = 'highpass'; guard2.frequency.value = 75; guard2.Q.value = 0.7;
  const dry = context.createGain(); dry.gain.value = 1 - distance * 0.35;
  const send = context.createGain(); send.gain.value = 0.12 + distance * 0.25;
  const room = context.createConvolver(); room.buffer = roomImpulse(context, 0.7 + distance * 0.6, options.seed ^ 0x51f1);
  const roomTone = context.createBiquadFilter(); roomTone.type = 'lowpass'; roomTone.frequency.value = 3200;
  bus.connect(guard).connect(guard2).connect(air);
  air.connect(dry).connect(context.destination);
  air.connect(send).connect(room).connect(roomTone).connect(context.destination);

  const noise = noiseBuffer(context, 7.3, options.seed ^ 0x9e37, 2);

  /** A looping noise layer, filtered, whose level follows a seeded random walk every `step` seconds. */
  const wander = (filters: BiquadFilterNode[], level: number, depth: number, step: number, tau: number, side: number, offset: number) => {
    const source = context.createBufferSource(); source.buffer = noise; source.loop = true;
    source.playbackRate.value = 0.93 + random() * 0.14;
    const amp = context.createGain(), place = context.createStereoPanner();
    place.pan.value = Math.max(-1, Math.min(1, pan + side));
    let node: AudioNode = source;
    for (const filter of filters) { node.connect(filter); node = filter; }
    node.connect(amp).connect(place).connect(bus);
    amp.gain.setValueAtTime(level, 0);
    let walk = 1;
    for (let t = 0; t < seconds; t += step * (0.7 + random() * 0.6)) {
      walk = Math.max(0.35, Math.min(1.7, walk + (random() * 2 - 1) * depth));
      amp.gain.setTargetAtTime(level * walk, t, tau);
    }
    source.start(0, offset); source.stop(seconds);
  };
  const filter = (type: BiquadFilterType, hz: number, q: number) => {
    const node = context.createBiquadFilter(); node.type = type; node.frequency.value = hz; node.Q.value = q; return node;
  };

  // The roar: a soft low body, more of it for a brazier.
  const roar = 0.045 + size * 0.11;
  wander([filter('bandpass', 190 + size * 90, 0.7), filter('lowpass', 520, 0.5)], roar, 0.3, 0.22, 0.14, -0.25, 0.3);
  wander([filter('bandpass', 170 + size * 100, 0.7), filter('lowpass', 500, 0.5)], roar, 0.3, 0.25, 0.16, 0.25, 3.1);
  // The flames licking: a breathy mid flutter.
  wander([filter('bandpass', 520 + size * 200, 0.9)], 0.03 + size * 0.03, 0.55, 0.07, 0.035, -0.1, 1.7);
  wander([filter('bandpass', 1300, 1.2)], 0.012 + size * 0.01, 0.6, 0.06, 0.03, 0.15, 5.2);

  // The crackle, written sample by sample.
  const crackle = context.createBuffer(2, Math.ceil(seconds * rate), rate);
  const left = crackle.getChannelData(0), right = crackle.getChannelData(1);
  const place = (at: number, signal: (i: number) => number, length: number, spread: number) => {
    const p = Math.max(-1, Math.min(1, pan + (random() * 2 - 1) * spread)), angle = (p + 1) * Math.PI / 4;
    const gl = Math.cos(angle), gr = Math.sin(angle), start = Math.floor(at * rate);
    for (let i = 0; i < length && start + i < left.length; i++) { const v = signal(i); left[start + i]! += v * gl; right[start + i]! += v * gr; }
  };
  const tick = (at: number, level: number) => {
    const length = Math.floor(rate * (0.0004 + random() * 0.0035)), decay = length / 4;
    place(at, i => (random() * 2 - 1) * level * Math.exp(-i / decay), length, 0.35);
  };
  const pop = (at: number, level: number) => {
    // A knot bursting: a noisy crack with a short wooden ring inside it.
    const length = Math.floor(rate * (0.012 + random() * 0.02)), hz = 1100 + random() * 1600, decay = rate * (0.002 + random() * 0.003);
    const ring = rate * 0.006;
    place(at, i => level * (Math.exp(-i / decay) * (random() * 2 - 1) + 0.5 * Math.exp(-i / ring) * Math.sin(2 * Math.PI * hz * i / rate)), length, 0.25);
    // A few smaller ticks scattered after it, as embers jump.
    const after = 2 + Math.floor(random() * 5);
    for (let k = 0; k < after; k++) tick(at + 0.01 + random() * 0.12, level * (0.15 + random() * 0.3));
  };
  const hiss = (at: number, level: number) => {
    // Sap boiling out of a log end: a thin high hiss that swells and goes.
    const length = Math.floor(rate * (0.25 + random() * 0.6));
    let a = 0, b = 0;
    place(at, i => {
      const x = i / length, env = Math.sin(Math.PI * x) ** 2;
      const white = random() * 2 - 1; a = 0.55 * a + white; b = a - b * 0.2; // crude high-mid emphasis
      return level * env * (white - 0.6 * b) * 0.35;
    }, length, 0.15);
  };
  const crackleDensity = 5 + size * 7;
  let burst = 1;
  for (let t = 0.05; t < seconds - 0.2;) {
    // Clustered: a slow random walk of how lively the fire is.
    burst = Math.max(0.25, Math.min(2.4, burst + (random() * 2 - 1) * 0.35));
    t += -Math.log(1 - random()) / (crackleDensity * burst);
    const u = random(), level = Math.min(0.24, 0.045 * Math.pow(1 - u, -0.5));
    if (random() < 0.07) pop(t, Math.min(0.3, level * 2)); else tick(t, level);
  }
  for (let t = 1 + random() * 4; t < seconds - 1; t += 4 + random() * 9) hiss(t, 0.05 + random() * 0.05);
  // A soft knee on the crackle, as a close microphone and a limiter would leave it: the loudest snaps keep their
  // bite but stop towering 30 dB over the fire.
  const knee = 0.2;
  for (const data of [left, right]) for (let i = 0; i < data.length; i++) data[i] = knee * Math.tanh(data[i]! / knee);
  const crackleSource = context.createBufferSource(); crackleSource.buffer = crackle;
  const crackleHigh = filter('highpass', 900, 0.6), crackleTop = filter('lowpass', 9000 / (1 + distance * 1.5), 0.5);
  const crackleLevel = context.createGain(); crackleLevel.gain.value = 1.5 * (1 - distance * 0.4);
  crackleSource.connect(crackleHigh).connect(crackleTop).connect(crackleLevel).connect(bus);
  crackleSource.start(0);

  return context.startRendering();
}
