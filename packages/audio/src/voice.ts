import type { SampleBank, SampleId } from './samples';

/** Shared, per-context material: a white-noise buffer every noise layer reads from at a random offset. */
export interface Kit {
  noise: AudioBuffer;
  samples: SampleBank;
  random: () => number;
}

interface Scheduled { node: AudioScheduledSourceNode; start: number; stop: number }

/**
 * One cue's private node graph. Layers are built first and only started once the engine admits the voice into the
 * mix budget, so a rejected voice never makes a sound and every source is counted.
 */
export class VoiceGraph {
  readonly nodes: AudioNode[] = [];
  readonly scheduled: Scheduled[] = [];
  /** Level sent to the shared room. Dry contact sounds stay close; light breathes a little more. */
  room = 0;

  constructor(readonly context: BaseAudioContext, readonly out: AudioNode, readonly t: number, readonly kit: Kit) {}

  get end(): number { return this.scheduled.reduce((end, item) => Math.max(end, item.stop), this.t); }

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

  /** Connects nodes in order and returns the first, so a layer can be written as one line. */
  chain(...nodes: AudioNode[]): AudioNode {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i]!.connect(nodes[i + 1]!);
    return nodes[0]!;
  }

  osc(type: OscillatorType, frequency: number, start: number, stop: number): OscillatorNode {
    const node = this.context.createOscillator();
    node.type = type; node.frequency.value = frequency;
    return this.schedule(node, start, stop);
  }

  sample(id: SampleId, start: number, rate = 1, offset = 0, duration?: number): AudioBufferSourceNode {
    const buffer = this.kit.samples.get(id);
    if (!buffer) throw new Error(`kingdom audio: sample ${id} is not loaded`);
    const node = this.context.createBufferSource();
    node.buffer = buffer; node.playbackRate.value = rate;
    const length = Math.min(duration ?? Infinity, (buffer.duration - offset) / rate);
    return this.schedule(node, start, start + length, offset);
  }

  noise(start: number, stop: number): AudioBufferSourceNode {
    const node = this.context.createBufferSource();
    node.buffer = this.kit.noise; node.loop = true;
    const offset = this.kit.random() * (this.kit.noise.duration - 0.5);
    return this.schedule(node, start, stop, offset);
  }

  /** Attack to `peak`, then an exponential fall with time constant `tau`. Attack never shorter than 1 ms. */
  envelope(param: AudioParam, start: number, attack: number, peak: number, tau: number): void {
    param.setValueAtTime(0, start);
    param.linearRampToValueAtTime(peak, start + Math.max(attack, 0.001));
    param.setTargetAtTime(0, start + Math.max(attack, 0.001), tau);
  }

  /** A decaying partial of a struck or glowing body: one oscillator through its own envelope, stopped ~70 dB down. */
  partial(target: AudioNode, type: OscillatorType, frequency: number, start: number, attack: number, peak: number, tau: number): void {
    const amp = this.gain(0);
    this.envelope(amp.gain, start, attack, peak, tau);
    this.chain(this.osc(type, frequency, start, start + attack + tau * 8), amp, target);
  }

  /**
   * A swell rather than a strike: a raised-cosine rise to `peak` over `rise` seconds (no corner at either end),
   * then an exponential fall with time constant `tau`.
   */
  bloom(param: AudioParam, start: number, rise: number, peak: number, tau: number): void {
    const curve = new Float32Array(33);
    for (let i = 0; i < curve.length; i++) curve[i] = peak * (0.5 - 0.5 * Math.cos((Math.PI * i) / (curve.length - 1)));
    param.setValueAtTime(0, start);
    param.setValueCurveAtTime(curve, start, rise);
    param.setTargetAtTime(0, start + rise, tau);
  }

  /** A stereo position inside the voice, for cues that move (a street of windows lighting along). */
  pan(value: number): StereoPannerNode {
    const node = this.context.createStereoPanner();
    node.pan.value = value;
    return this.track(node);
  }

  private offsets = new Map<AudioScheduledSourceNode, number>();

  private schedule<T extends AudioScheduledSourceNode>(node: T, start: number, stop: number, offset = 0): T {
    this.scheduled.push({ node, start, stop });
    if (offset) this.offsets.set(node, offset);
    return this.track(node);
  }

  /** Starts every layer. Called once, after the engine has admitted the voice. */
  start(): void {
    for (const { node, start, stop } of this.scheduled) {
      const offset = this.offsets.get(node);
      if (offset !== undefined) (node as AudioBufferSourceNode).start(start, offset);
      else node.start(start);
      node.stop(stop);
    }
  }

  private track<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
}
