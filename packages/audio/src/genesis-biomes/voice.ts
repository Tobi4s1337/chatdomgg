import { generator } from './rng';
import { synthTexture, TEXTURES, type TextureKey } from './textures';

/**
 * Per-context material, made on first use and shared by every voice and bed of this layer on that context:
 * three long noise colours of different lengths (so their loops never line up) and the synthesised textures this
 * land actually needs. Lower-band noise is stored at lower rates: the context resamples it on playback.
 */
export interface LandKit {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
  texture(key: TextureKey): AudioBuffer;
  /** Bytes of decoded audio this kit holds now. */
  bytes(): number;
}

const kits = new WeakMap<BaseAudioContext, Map<number, LandKit>>();

export function landKit(context: BaseAudioContext, seed: number): LandKit {
  let perSeed = kits.get(context);
  if (!perSeed) { perSeed = new Map(); kits.set(context, perSeed); }
  const cached = perSeed.get(seed);
  if (cached) return cached;
  const random = generator(seed ^ 0x6e015e);
  const white = context.createBuffer(1, Math.round(context.sampleRate * 3.3), context.sampleRate);
  const w = white.getChannelData(0);
  for (let i = 0; i < w.length; i++) w[i] = random() * 2 - 1;

  // Pink (Paul Kellet's economy filter) at 24 kHz, brown (leaky integrator) at 12 kHz; both unit-ish RMS.
  const pink = context.createBuffer(1, Math.round(24000 * 6.1), 24000), p = pink.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < p.length; i++) {
    const x = random() * 2 - 1;
    b0 = 0.99765 * b0 + x * 0.099046; b1 = 0.963 * b1 + x * 0.2965164; b2 = 0.57 * b2 + x * 1.0526913;
    p[i] = (b0 + b1 + b2 + x * 0.1848) * 0.16;
  }
  const brown = context.createBuffer(1, Math.round(12000 * 9.7), 12000), b = brown.getChannelData(0);
  // Brown above ~60 Hz (−6 dB/oct), flat below it: weight for surf and rumble without a sub-bass drift.
  let last = 0;
  for (let i = 0; i < b.length; i++) { last += 0.03 * (random() * 2 - 1 - last); b[i] = last * 7; }
  smoothSeam(p); smoothSeam(b);

  const textures = new Map<TextureKey, AudioBuffer>();
  const kit: LandKit = {
    white, pink, brown,
    texture(key) {
      let buffer = textures.get(key);
      if (!buffer) {
        const spec = TEXTURES[key], data = synthTexture(key, seed);
        buffer = context.createBuffer(1, data.length, spec.rate);
        buffer.getChannelData(0).set(data);
        textures.set(key, buffer);
      }
      return buffer;
    },
    bytes() {
      let total = (white.length + pink.length + brown.length) * 4;
      for (const buffer of textures.values()) total += buffer.length * 4;
      return total;
    },
  };
  perSeed.set(seed, kit);
  return kit;
}

/** Crossfades the last 50 ms into the first so a looping coloured noise has no step at its seam. */
function smoothSeam(data: Float32Array): void {
  const n = Math.min(1200, Math.floor(data.length / 4));
  for (let i = 0; i < n; i++) {
    const t = i / n, end = data.length - n + i;
    data[end] = data[end]! * (1 - t) + data[i]! * t;
  }
}

interface Scheduled { node: AudioScheduledSourceNode; start: number; stop: number; offset?: number }

/**
 * One call's private graph: layers are authored first and only started once the layer's budget admits the voice,
 * so a call turned away never sounds and every source is counted.
 */
export class CueVoice {
  readonly nodes: AudioNode[] = [];
  readonly scheduled: Scheduled[] = [];
  readonly out: GainNode;
  /** Level sent into the land's space (open air, valley, the mountain's echo). */
  send = 0.15;
  private remaining = 0;
  private released = false;

  constructor(readonly context: BaseAudioContext, readonly t: number, readonly kit: LandKit, private readonly random: () => number) {
    this.out = this.gain(1);
  }

  get end(): number { return this.scheduled.reduce((end, item) => Math.max(end, item.stop), this.t); }

  /** Source nodes still scheduled to sound at `at`. */
  sourcesAt(at: number): number { return this.scheduled.filter(item => item.stop > at).length; }

  gain(value = 1): GainNode {
    const node = this.context.createGain();
    node.gain.value = value;
    return this.track(node);
  }

  filter(type: BiquadFilterType, frequency: number, q = 0.707, gain = 0): BiquadFilterNode {
    const node = this.context.createBiquadFilter();
    node.type = type; node.frequency.value = frequency; node.Q.value = q; node.gain.value = gain;
    return this.track(node);
  }

  pan(value: number): StereoPannerNode {
    const node = this.context.createStereoPanner();
    node.pan.value = Math.max(-1, Math.min(1, value));
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

  noise(start: number, stop: number, colour: 'white' | 'pink' | 'brown' = 'white', rate = 1): AudioBufferSourceNode {
    const node = this.context.createBufferSource(), buffer = this.kit[colour];
    node.buffer = buffer; node.loop = true; node.playbackRate.value = rate;
    // A seeded offset per layer: two calls never read the same stretch of noise, and a render is repeatable.
    return this.schedule(node, start, stop, this.random() * Math.max(0, buffer.duration - 0.5));
  }

  /** Attack to `peak`, then an exponential fall with time constant `tau`. */
  envelope(param: AudioParam, start: number, attack: number, peak: number, tau: number): void {
    param.setValueAtTime(0, start);
    param.linearRampToValueAtTime(peak, start + Math.max(attack, 0.001));
    param.setTargetAtTime(0, start + Math.max(attack, 0.001), tau);
  }

  /** A contour over `seconds`, from values sampled by `shape(0..1)`. The first and last values are where it sits. */
  contour(param: AudioParam, start: number, seconds: number, points: number, shape: (x: number) => number): void {
    const curve = new Float32Array(Math.max(2, points));
    for (let i = 0; i < curve.length; i++) curve[i] = shape(i / (curve.length - 1));
    param.setValueAtTime(curve[0]!, start);
    param.setValueCurveAtTime(curve, start, Math.max(0.005, seconds));
  }

  /** Starts every layer; `ended` runs once the last one has stopped. */
  start(ended: () => void): void {
    this.remaining = this.scheduled.length;
    for (const item of this.scheduled) {
      item.node.onended = () => { if (--this.remaining === 0) ended(); };
      if (item.offset !== undefined) (item.node as AudioBufferSourceNode).start(item.start, item.offset);
      else item.node.start(item.start);
      item.node.stop(item.stop);
    }
    if (this.scheduled.length === 0) ended();
  }

  /** Stops every layer no later than `at`. */
  stop(at: number): void {
    for (const item of this.scheduled) {
      if (item.stop <= at) continue;
      // Stopping before the start time is allowed: a layer not yet begun then never sounds at all.
      item.stop = at;
      try { item.node.stop(at); } catch { /* not started or already ended */ }
    }
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    for (const item of this.scheduled) item.node.onended = null;
    for (const node of this.nodes) node.disconnect();
  }

  private schedule<T extends AudioScheduledSourceNode>(node: T, start: number, stop: number, offset?: number): T {
    const item: Scheduled = { node, start, stop };
    if (offset !== undefined) item.offset = offset;
    this.scheduled.push(item);
    return this.track(node);
  }

  private track<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
}
