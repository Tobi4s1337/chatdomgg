/**
 * The Almanac's paper and leather, synthesised: no recordings. A page turn is a dry rustle of filtered noise that
 * lifts, sweeps across and settles with a soft flap; opening is the boards parting with a low thump and a breath of
 * paper; closing is a heavier, shorter clap. Each cue varies a little every time, so turning ten pages never sounds
 * like one sound ten times.
 */
export interface AlmanacSound {
  turn(): void;
  open(): void;
  close(): void;
}

export interface AlmanacSoundHost {
  readonly context: BaseAudioContext;
  readonly destination: AudioNode;
}

/** A small sequence of its own, so variety does not depend on Math.random being seeded anywhere. */
function wobble(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}

const noises = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseFor(context: BaseAudioContext): AudioBuffer {
  let buffer = noises.get(context);
  if (!buffer) {
    const rate = context.sampleRate, length = Math.round(rate * 1.5);
    buffer = context.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0), random = wobble(0xa1a7ac);
    // Paper is not white: a little brown under the hiss, and sparse crackles where the fibres catch.
    let brown = 0;
    for (let i = 0; i < length; i++) {
      const white = random() * 2 - 1;
      brown = (brown + white * 0.04) * 0.985;
      const crackle = random() < 0.0016 ? (random() * 2 - 1) * 0.9 : 0;
      data[i] = white * 0.7 + brown * 1.8 + crackle;
    }
    noises.set(context, buffer);
  }
  return buffer;
}

/** One burst of shaped noise: a filter, an envelope of [time, level] points, into `out`. */
function burst(context: BaseAudioContext, out: AudioNode, at: number, length: number, filter: BiquadFilterType, hz: number, q: number,
  envelope: readonly (readonly [number, number])[], sweepTo?: number, offset = 0): void {
  const source = context.createBufferSource();
  source.buffer = noiseFor(context);
  const band = context.createBiquadFilter();
  band.type = filter;
  band.frequency.setValueAtTime(hz, at);
  if (sweepTo) band.frequency.exponentialRampToValueAtTime(sweepTo, at + length);
  band.Q.value = q;
  const amp = context.createGain();
  amp.gain.setValueAtTime(0, at);
  for (const [time, level] of envelope) amp.gain.linearRampToValueAtTime(Math.max(0, level), at + time);
  amp.gain.linearRampToValueAtTime(0, at + length);
  source.connect(band).connect(amp).connect(out);
  source.start(at, offset, length + 0.05);
  source.stop(at + length + 0.06);
}

/** A soft low knock: a falling sine under a lowpassed puff. */
function thump(context: BaseAudioContext, out: AudioNode, at: number, hz: number, level: number, decay: number): void {
  const osc = context.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(hz * 1.5, at);
  osc.frequency.exponentialRampToValueAtTime(hz, at + 0.04);
  const amp = context.createGain();
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(level, at + 0.006);
  amp.gain.setTargetAtTime(0, at + 0.012, decay);
  osc.connect(amp).connect(out);
  osc.start(at);
  osc.stop(at + decay * 8 + 0.05);
  burst(context, out, at, 0.09, 'lowpass', 420, 0.7, [[0.004, level * 0.9], [0.03, level * 0.25]]);
}

/** The cues on one context, into `destination` (the kingdom's audio host, or a page's own output). */
export function createAlmanacSound(context: BaseAudioContext, destination: AudioNode): AlmanacSound {
  const random = wobble(Math.floor(performance.now() * 1000) ^ 0x51ab);
  const bus = context.createGain();
  bus.gain.value = 0.9;
  bus.connect(destination);
  const live = () => (context.state as string) === 'running';
  const vary = (spread: number) => 1 + (random() * 2 - 1) * spread;
  const offset = () => random() * 1.2;

  return {
    turn() {
      if (!live()) return;
      const t = context.currentTime + 0.01, s = vary(0.12), level = 0.16 * vary(0.15);
      const pan = 'createStereoPanner' in context ? context.createStereoPanner() : null;
      const out: AudioNode = pan ?? bus;
      if (pan) {
        // The leaf travels across the spine: the rustle follows it from right to left.
        pan.pan.setValueAtTime(0.35, t);
        pan.pan.linearRampToValueAtTime(-0.35, t + 0.42);
        pan.connect(bus);
      }
      // The corner lifting off the page: a thin dry tick and a high whisper.
      burst(context, out, t, 0.05, 'highpass', 3800 * s, 0.6, [[0.003, level * 0.55], [0.02, level * 0.12]], undefined, offset());
      // The sweep: a bandpassed rustle that rises then falls as the leaf crosses the spine.
      burst(context, out, t + 0.03, 0.36, 'bandpass', 1900 * s, 0.9, [[0.08, level * 0.5], [0.17, level * 0.85], [0.28, level * 0.35]], 3300 * s, offset());
      burst(context, out, t + 0.06, 0.3, 'highpass', 5200 * s, 0.7, [[0.1, level * 0.22], [0.2, level * 0.14]], undefined, offset());
      // The air the leaf moves, low and soft.
      burst(context, out, t + 0.05, 0.34, 'lowpass', 520, 0.6, [[0.12, level * 0.5], [0.24, level * 0.2]], 300, offset());
      // Settling: the leaf flaps down against the page.
      burst(context, out, t + 0.38, 0.09, 'bandpass', 900 * s, 1.1, [[0.006, level * 0.7], [0.03, level * 0.2]], 500, offset());
    },
    open() {
      if (!live()) return;
      const t = context.currentTime + 0.01, level = 0.2 * vary(0.1);
      // The board lifting off the leaves: a soft leather creak, then the cover laid down and a breath of pages.
      burst(context, bus, t, 0.22, 'bandpass', 700 * vary(0.1), 4, [[0.05, level * 0.18], [0.16, level * 0.1]], 980, offset());
      burst(context, bus, t + 0.08, 0.32, 'bandpass', 2400, 0.8, [[0.1, level * 0.42], [0.22, level * 0.16]], 3600, offset());
      thump(context, bus, t + 0.3, 92 * vary(0.06), level * 1.1, 0.05);
    },
    close() {
      if (!live()) return;
      const t = context.currentTime + 0.01, level = 0.22 * vary(0.1);
      burst(context, bus, t, 0.16, 'bandpass', 2600, 0.8, [[0.06, level * 0.32], [0.12, level * 0.1]], 1500, offset());
      // The boards meet: a pressed clap of air and a low knock.
      burst(context, bus, t + 0.14, 0.06, 'lowpass', 1600, 0.7, [[0.003, level * 0.9], [0.02, level * 0.2]], undefined, offset());
      thump(context, bus, t + 0.14, 78 * vary(0.06), level * 1.3, 0.045);
    },
  };
}

/**
 * The cues through a host that may come and go (the kingdom's audio host answers null while sound is locked or
 * muted). Each call asks the host; a new context gets its own cues.
 */
export function almanacSoundFrom(host: () => AlmanacSoundHost | null): AlmanacSound {
  let built: { context: BaseAudioContext; destination: AudioNode; sound: AlmanacSound } | null = null;
  const current = (): AlmanacSound | null => {
    let found: AlmanacSoundHost | null;
    try { found = host(); } catch { found = null; }
    if (!found) return null;
    if (!built || built.context !== found.context || built.destination !== found.destination) {
      built = { context: found.context, destination: found.destination, sound: createAlmanacSound(found.context, found.destination) };
    }
    return built.sound;
  };
  return { turn: () => current()?.turn(), open: () => current()?.open(), close: () => current()?.close() };
}

/**
 * For a page of its own (the public Almanac): an audio context made only after the reader's first touch, click or
 * key, as browsers require. Cues before then are silent. `dispose` closes the context.
 */
export function createGestureAlmanacSound(target: EventTarget = window): AlmanacSound & { dispose(): void } {
  let context: AudioContext | null = null, sound: AlmanacSound | null = null, disposed = false;
  const events = ['pointerdown', 'keydown', 'touchstart'] as const;
  const wake = () => {
    if (disposed) return;
    try {
      if (!context) {
        const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) return;
        context = new Context({ latencyHint: 'interactive' });
        sound = createAlmanacSound(context, context.destination);
      }
      if (context.state === 'suspended') void context.resume();
    } catch { context = null; sound = null; }
  };
  for (const name of events) target.addEventListener(name, wake, { capture: true, passive: true });
  return {
    turn: () => sound?.turn(), open: () => sound?.open(), close: () => sound?.close(),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const name of events) target.removeEventListener(name, wake, { capture: true });
      void context?.close().catch(() => undefined);
      context = null; sound = null;
    },
  };
}
