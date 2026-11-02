import type { PierKit, PierSampleId } from './kit';
import { swellCurve, tailFor } from './law';

interface Layer { node: AudioScheduledSourceNode; start: number; stop: number; offset: number | undefined }

/**
 * One cue's private node graph, and the gestures every pier sound is made of: a strike envelope, a swell, a
 * bubble, a burst of shaped noise, a plucked line, a creak and a ratchet. Layers are laid out first and started
 * together; a silent keeper source runs to the end of the longest tail and tells the owner when the voice is over.
 */
export class Shot {
  readonly nodes: AudioNode[] = [];
  private readonly layers: Layer[] = [];
  /** Level sent to the pier's open air (before the placement's own `wet`). */
  room = 0;
  private finish: number;

  constructor(readonly context: BaseAudioContext, readonly out: AudioNode, readonly t: number, readonly kit: PierKit,
    readonly random: () => number) {
    this.finish = t;
  }

  /** When the last layer, tails included, has died away. */
  get end(): number { return this.finish; }

  /** Keeps the voice alive until `time`, for layers whose ring outlasts their sources (a plucked line). */
  hold(time: number): void { this.finish = Math.max(this.finish, time); }

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
    node.pan.value = value;
    return this.track(node);
  }

  /** Connects nodes in order and returns the first, so a layer reads as one line. */
  chain(...nodes: AudioNode[]): AudioNode {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i]!.connect(nodes[i + 1]!);
    return nodes[0]!;
  }

  osc(type: OscillatorType, frequency: number, start: number, stop: number): OscillatorNode {
    const node = this.context.createOscillator();
    node.type = type; node.frequency.value = frequency;
    return this.schedule(node, start, stop);
  }

  noise(start: number, stop: number): AudioBufferSourceNode {
    const node = this.context.createBufferSource();
    node.buffer = this.kit.noise; node.loop = true;
    return this.schedule(node, start, stop, this.random() * (this.kit.noise.duration - 0.5));
  }

  /** A recording, or null while it is still decoding (the cue then plays without that layer). */
  sample(id: PierSampleId, start: number, rate = 1, gain = 1): AudioNode | null {
    const buffer = this.kit.sample(id);
    if (!buffer) return null;
    const node = this.context.createBufferSource();
    node.buffer = buffer; node.playbackRate.value = rate;
    this.schedule(node, start, start + buffer.duration / rate);
    const level = this.gain(gain);
    node.connect(level);
    return level;
  }

  /** Linear attack to `peak`, then an exponential fall with time constant `tau`. Attack never shorter than 0.5 ms. */
  envelope(param: AudioParam, start: number, attack: number, peak: number, tau: number): void {
    const rise = Math.max(attack, 0.0005);
    param.setValueAtTime(0, start);
    param.linearRampToValueAtTime(peak, start + rise);
    param.setTargetAtTime(0, start + rise, tau);
  }

  /** A raised-cosine swell to `peak` over `rise`, then an exponential fall. No corner at either end. */
  bloom(param: AudioParam, start: number, rise: number, peak: number, tau: number): void {
    // A curve asked to start in the past is moved to now by the browser, and the fall after it would then land
    // inside it; on a busy main thread that can happen, so the curve never starts before now.
    const begin = Math.max(start, this.context.currentTime), length = Math.max(rise, 0.002);
    param.setValueAtTime(0, begin);
    param.setValueCurveAtTime(swellCurve(peak), begin, length);
    param.setTargetAtTime(0, begin + length, tau);
  }

  /** A decaying partial of a struck body: one oscillator through its own envelope. */
  partial(target: AudioNode, type: OscillatorType, frequency: number, at: number, attack: number, peak: number, tau: number): void {
    const amp = this.gain(0);
    this.envelope(amp.gain, at, attack, peak, tau);
    this.chain(this.osc(type, frequency, at, at + attack + tailFor(tau, 60)), amp, target);
  }

  /** A swell of shaped noise: a raised-cosine rise, then a fall. For air, paper and spray. */
  breath(target: AudioNode, at: number, type: BiquadFilterType, frequency: number, q: number, rise: number, peak: number, tau: number,
    sweep?: number, sweepTime = rise + tau): BiquadFilterNode {
    const band = this.filter(type, frequency, q), amp = this.gain(0);
    if (sweep !== undefined) {
      band.frequency.setValueAtTime(frequency, at);
      band.frequency.exponentialRampToValueAtTime(sweep, at + sweepTime);
    }
    this.bloom(amp.gain, at, rise, peak, tau);
    this.chain(this.noise(at, at + rise + tailFor(tau, 60)), band, amp, target);
    return band;
  }

  /**
   * A small air cavity ringing in the water: a sine rising in pitch as the bubble nears the surface, gone in a few
   * tens of milliseconds. Every plop, gurgle and droplet is made of these.
   */
  bubble(target: AudioNode, at: number, f0: number, tau: number, rise: number, peak: number): void {
    const stop = at + 0.0008 + tailFor(tau, 60);
    const osc = this.osc('sine', f0, at, stop), amp = this.gain(0);
    osc.frequency.setValueAtTime(f0, at);
    osc.frequency.exponentialRampToValueAtTime(f0 * (1 + rise), at + tau * 3);
    this.envelope(amp.gain, at, 0.0008, peak, tau);
    this.chain(osc, amp, target);
  }

  /** A burst of noise through one filter, optionally sweeping to `sweep` Hz over `sweepTime`. */
  burst(target: AudioNode, at: number, type: BiquadFilterType, frequency: number, q: number, attack: number, peak: number, tau: number,
    sweep?: number, sweepTime = tau * 3): BiquadFilterNode {
    const band = this.filter(type, frequency, q), amp = this.gain(0);
    if (sweep !== undefined) {
      band.frequency.setValueAtTime(frequency, at);
      band.frequency.exponentialRampToValueAtTime(sweep, at + sweepTime);
    }
    this.envelope(amp.gain, at, attack, peak, tau);
    this.chain(this.noise(at, at + attack + tailFor(tau, 60)), band, amp, target);
    return band;
  }

  /** Droplets falling back onto the water: `count` small bubbles scattered over [from, to], across `targets`. */
  droplets(targets: readonly AudioNode[], from: number, to: number, count: number, low: number, high: number, peak: number): void {
    for (let i = 0; i < count; i++) {
      const at = from + (to - from) * (i + this.random()) / count, depth = this.random();
      this.bubble(targets[i % targets.length]!, at, low + (high - low) * this.random(), 0.005 + 0.01 * depth, 0.3 + 0.5 * this.random(),
        peak * (0.45 + 0.55 * depth));
    }
  }

  /**
   * A line under tension, plucked: a short noise excitation circulating in a tuned delay (Karplus-Strong), whose
   * loop low-pass and feedback set how bright and how long it rings. The pitch settles from slightly sharp as the
   * line takes the load. The fundamental stays under ~370 Hz (a loop in Web Audio is at least one render quantum).
   */
  pluck(target: AudioNode, at: number, hz: number, ring: number, bright: number, peak: number): void {
    const period = 1 / Math.min(hz, 370), loopTone = this.filter('lowpass', bright, 0.5);
    const line = this.track(this.context.createDelay(0.05)), feedback = this.gain(0), input = this.gain(1), output = this.gain(1);
    line.delayTime.setValueAtTime(period / 1.035, at);
    line.delayTime.setTargetAtTime(period, at, 0.025);
    // Loop gain for the asked ring: each pass loses a little; `ring` is the time to −40 dB.
    const passes = ring / period, loss = 10 ** (-40 / 20 / passes);
    feedback.gain.setValueAtTime(Math.min(0.995, loss), at);
    // Then a hand on the line: the ring is damped away rather than cut.
    output.gain.setTargetAtTime(0, at + ring, 0.02);
    feedback.gain.setTargetAtTime(0, at + ring + 0.06, 0.01);
    input.connect(line); line.connect(loopTone); loopTone.connect(feedback); feedback.connect(input);
    const exciteBand = this.filter('bandpass', Math.min(4200, bright * 1.1), 0.7), excite = this.gain(0);
    this.envelope(excite.gain, at, 0.0004, peak, 0.0018);
    this.chain(this.noise(at, at + 0.02), exciteBand, excite, input);
    this.chain(input, output, target);
    this.hold(at + ring + 0.16);
  }

  /**
   * Wood creaking: the stick-slip of fibres under bending is a train of tiny impulses at a wandering rate, coloured
   * by the body's resonances. A band-limited sawtooth gives the impulse train; `rates` is its glide in Hz.
   */
  creak(target: AudioNode, at: number, length: number, rates: readonly [number, number, number], peak: number, formants: readonly number[],
    rise = length * 0.3): void {
    const osc = this.osc('sawtooth', rates[0], at, at + length + 0.2);
    osc.frequency.setValueAtTime(rates[0], at);
    osc.frequency.exponentialRampToValueAtTime(rates[1], at + length * 0.45);
    osc.frequency.exponentialRampToValueAtTime(rates[2], at + length);
    const low = this.filter('highpass', 260, 0.6), amp = this.gain(0), body = this.gain(1);
    this.chain(osc, low);
    formants.forEach((hz, index) => {
      const band = this.filter('bandpass', hz * (0.97 + 0.06 * this.random()), 6 + index * 2);
      low.connect(band); band.connect(body);
    });
    this.bloom(amp.gain, at, rise, peak, (length - rise) * 0.4);
    this.chain(body, amp, target);
  }

  /**
   * A ratchet's clicks: a band-limited sawtooth's single step per period is one click; the highpass leaves only the
   * step, the pawl's ring and the spool's body give it its wood and brass.
   */
  ratchet(target: AudioNode, at: number, length: number, rates: readonly [number, number, number], peak: number, pawl: number): GainNode {
    const osc = this.osc('sawtooth', rates[0], at, at + length + 0.05);
    osc.frequency.setValueAtTime(rates[0], at);
    osc.frequency.exponentialRampToValueAtTime(rates[1], at + Math.min(0.14, length * 0.3));
    osc.frequency.exponentialRampToValueAtTime(rates[2], at + length);
    const step = this.filter('highpass', 1500, 0.7), ring = this.filter('bandpass', pawl, 4), body = this.filter('bandpass', pawl * 0.38, 2.5);
    const amp = this.gain(0), sum = this.gain(1);
    this.chain(osc, step);
    step.connect(ring); step.connect(body); ring.connect(sum); body.connect(sum);
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(peak, at + 0.03);
    amp.gain.setTargetAtTime(0, at + length - 0.12, 0.05);
    this.chain(sum, amp, target);
    return amp;
  }

  /** Starts every layer, with the keeper that ends after the last tail. `onEnd` fires once, when it is over. */
  /** How many sources the cue runs (its keeper included once started). */
  get sourceCount(): number { return this.layers.length; }

  start(onEnd: () => void): void {
    const keeper = this.context.createConstantSource(), mute = this.gain(0);
    keeper.offset.value = 0;
    keeper.connect(mute); mute.connect(this.out);
    this.schedule(keeper, this.t, this.finish + 0.03);
    keeper.onended = onEnd;
    for (const { node, start, stop, offset } of this.layers) {
      if (offset !== undefined) (node as AudioBufferSourceNode).start(start, offset);
      else node.start(start);
      node.stop(stop);
    }
  }

  /** Fades the whole voice out over `seconds` from now and stops every source just after. */
  fade(output: GainNode, seconds: number): void {
    const now = this.context.currentTime, gain = output.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + seconds);
    for (const { node, stop } of this.layers) {
      try { node.stop(Math.min(stop, now + seconds + 0.003)); } catch { /* not started, or already ended */ }
    }
  }

  /** Disconnects everything the voice made. */
  release(): void {
    for (const node of this.nodes) node.disconnect();
  }

  private schedule<T extends AudioScheduledSourceNode>(node: T, start: number, stop: number, offset?: number): T {
    this.layers.push({ node, start, stop, offset });
    this.finish = Math.max(this.finish, stop);
    return this.track(node);
  }

  private track<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
}
