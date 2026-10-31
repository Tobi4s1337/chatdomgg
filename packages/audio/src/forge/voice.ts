/**
 * One Forge sound's private node graph. Layers are authored first and started only once the shared budget admits
 * the voice, so a rejected sound never plays and every source node is counted.
 */

/** A seeded white-noise buffer and a short authored room, made once per context and shared by every voice. */
export interface ForgeKit { noise: AudioBuffer; room: AudioBuffer; next(): number }

const kits = new WeakMap<BaseAudioContext, ForgeKit>();

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The room is a small timber-and-stone workshop: a few early reflections, then a dark, quick tail (~0.9 s to −60 dB)
 * that loses its highs as it decays. Made from a fixed seed so every render of the ceremony is identical.
 */
export function forgeKit(context: BaseAudioContext): ForgeKit {
  const cached = kits.get(context);
  if (cached) return cached;
  const rate = context.sampleRate, random = mulberry(0x5eed);
  const noise = context.createBuffer(1, Math.round(rate * 2), rate);
  const white = noise.getChannelData(0);
  for (let i = 0; i < white.length; i++) white[i] = random() * 2 - 1;
  const length = Math.round(rate * .95), room = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = room.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate, decay = Math.exp(-t / .14);
      const darken = Math.min(.92, .25 + t * 1.6); // one-pole smoothing grows with time: the tail is warm
      low = low * darken + (random() * 2 - 1) * (1 - darken);
      data[i] = low * decay * (t < .004 ? t / .004 : 1);
    }
    for (const [at, gain] of [[.011, .05], [.019, -.034], [.027, .026], [.041, -.018]] as const) {
      const index = Math.round((at + channel * .0023) * rate);
      if (index < length) data[index]! += gain;
    }
    // Unit energy: the room returns a sustained sound at the level it was sent, so a send level means what it says.
    let energy = 0;
    for (const v of data) energy += v * v;
    const scale = 1 / Math.sqrt(energy || 1);
    for (let i = 0; i < length; i++) data[i]! *= scale;
  }
  let counter = 0;
  const kit = { noise, room, next: () => { counter = (counter + 1) % 977; return (counter * 0.61803398875) % 1; } };
  kits.set(context, kit);
  return kit;
}

interface Scheduled { node: AudioScheduledSourceNode; start: number; stop: number; offset?: number }

export class ForgeVoice {
  readonly nodes: AudioNode[] = [];
  readonly scheduled: Scheduled[] = [];
  /** This voice's own fader, panned, then split into the dry path and the room send. */
  readonly out: GainNode;
  readonly panner: StereoPannerNode;
  readonly send: GainNode;

  constructor(readonly context: BaseAudioContext, readonly t: number, private readonly kit: ForgeKit) {
    this.out = this.gain(1);
    this.panner = this.context.createStereoPanner();
    this.track(this.panner);
    this.send = this.gain(0);
    this.out.connect(this.panner);
    this.panner.connect(this.send);
  }

  set room(level: number) { this.send.gain.value = level; }
  set pan(value: number) { this.panner.pan.value = Math.max(-1, Math.min(1, value)); }

  get end(): number { return this.scheduled.reduce((end, item) => Math.max(end, item.stop), this.t); }

  /** Sources not yet stopped at `now`: what this voice still costs the layer. */
  sourcesAt(now: number): number { let n = 0; for (const item of this.scheduled) if (item.stop > now) n++; return n; }

  gain(value = 1): GainNode {
    const node = this.context.createGain();
    node.gain.value = value;
    return this.track(node);
  }

  filter(type: BiquadFilterType, frequency: number, q = .707): BiquadFilterNode {
    const node = this.context.createBiquadFilter();
    node.type = type; node.frequency.value = frequency; node.Q.value = q;
    return this.track(node);
  }

  chain(...nodes: AudioNode[]): AudioNode {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i]!.connect(nodes[i + 1]!);
    return nodes[0]!;
  }

  osc(type: OscillatorType, frequency: number, start: number, stop: number): OscillatorNode {
    const node = this.context.createOscillator();
    node.type = type; node.frequency.value = frequency;
    return this.schedule(node, start, stop);
  }

  /** One looping read of the shared noise, from a fresh offset so two layers never correlate. */
  noise(start: number, stop: number): AudioBufferSourceNode {
    const node = this.context.createBufferSource();
    node.buffer = this.kit.noise; node.loop = true;
    return this.schedule(node, start, stop, this.kit.next() * (this.kit.noise.duration - .5));
  }

  /** Attack to `peak`, then an exponential fall with time constant `tau`. */
  envelope(param: AudioParam, start: number, attack: number, peak: number, tau: number): void {
    const top = start + Math.max(attack, .0008);
    param.setValueAtTime(0, start);
    param.linearRampToValueAtTime(peak, top);
    param.setTargetAtTime(0, top, tau);
  }

  /** A raised-cosine swell to `peak` over `rise`, then a fall with time constant `tau`; no corner at either end. */
  bloom(param: AudioParam, start: number, rise: number, peak: number, tau: number): void {
    const curve = new Float32Array(17);
    for (let i = 0; i < curve.length; i++) curve[i] = peak * (.5 - .5 * Math.cos(Math.PI * i / (curve.length - 1)));
    param.setValueAtTime(0, start);
    param.setValueCurveAtTime(curve, start, rise);
    param.setTargetAtTime(0, start + rise, tau);
  }

  /** A struck or ringing body's mode: one oscillator through its own envelope, stopped about 52 dB below its peak. */
  mode(target: AudioNode, frequency: number, start: number, attack: number, peak: number, tau: number, type: OscillatorType = 'sine'): OscillatorNode {
    const amp = this.gain(0), osc = this.osc(type, frequency, start, start + attack + tau * 6);
    this.envelope(amp.gain, start, attack, peak, tau);
    this.chain(osc, amp, target);
    return osc;
  }

  /** A run of tiny contacts on one gain (grit, crackle, a creak): many sounds from a single source. */
  spikes(param: AudioParam, times: readonly number[], peaks: readonly number[], tau: number): void {
    param.setValueAtTime(0, this.t);
    times.forEach((at, i) => {
      param.setValueAtTime(0, at);
      param.linearRampToValueAtTime(peaks[i % peaks.length]!, at + .0007);
      param.setTargetAtTime(0, at + .0007, tau);
    });
  }

  /** Pitch that falls or rises exponentially, as a struck body's or a bubble's does. */
  glide(param: AudioParam, start: number, from: number, to: number, time: number): void {
    param.setValueAtTime(from, start);
    param.exponentialRampToValueAtTime(to, start + time);
  }

  private schedule<T extends AudioScheduledSourceNode>(node: T, start: number, stop: number, offset?: number): T {
    this.scheduled.push(offset === undefined ? { node, start, stop } : { node, start, stop, offset });
    return this.track(node);
  }

  /** Starts every layer once admitted; the last source to stop reports the end. */
  start(onEnded: () => void): void {
    let last: Scheduled | undefined;
    for (const item of this.scheduled) {
      if (item.offset !== undefined) (item.node as AudioBufferSourceNode).start(item.start, item.offset);
      else item.node.start(item.start);
      item.node.stop(item.stop);
      if (!last || item.stop >= last.stop) last = item;
    }
    if (last) last.node.onended = onEnded;
  }

  /** Stops every layer by `at` (already-started sources only) and leaves disconnection to `release`. */
  stop(at: number): void {
    for (const item of this.scheduled) {
      if (item.stop <= at) continue;
      item.stop = Math.max(at, item.start);
      try { item.node.stop(item.stop); } catch { /* never started */ }
    }
  }

  release(): void {
    for (const item of this.scheduled) item.node.onended = null;
    for (const node of this.nodes) node.disconnect();
  }

  private track<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
}
