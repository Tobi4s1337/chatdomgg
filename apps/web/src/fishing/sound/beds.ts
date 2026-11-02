import type { PierKit } from './kit';
import { BED_REST_SECONDS, RestClock, type AmbienceShape, type ReelShape, type TensionShape } from './law';

/**
 * The pier's continuous sounds. Each bed is built the first frame it is wanted, then only its AudioParams move:
 * every frame sets targets, nothing is allocated. Once a bed has been asked for silence for two seconds its
 * sources stop and its nodes are let go, so a resting pier costs no audio work; it is built again when wanted.
 */

/** Sets a param's target only when it moves, so a steady frame adds nothing to the param's timeline. */
class Glide {
  private last = Number.NaN;

  constructor(private readonly tau: number, private readonly epsilon: number) {}

  to(param: AudioParam, value: number, now: number): void {
    // Small moves are skipped, but silence is always reached exactly.
    if (value === this.last || (value !== 0 && Math.abs(value - this.last) <= this.epsilon)) return;
    this.last = value;
    param.setTargetAtTime(value, now, this.tau);
  }

  reset(): void { this.last = Number.NaN; }
}

abstract class Bed {
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private readonly clock: RestClock;
  private readonly allGlides: Glide[] = [];
  live = false;

  /**
   * `fall` is the time constant the bed's level falls with: it rests for at least five of them, so its level is
   * under 1% when it stops and the last fade is never heard.
   */
  constructor(protected readonly kit: PierKit, protected readonly out: AudioNode, fall: number) {
    this.clock = new RestClock(Math.max(BED_REST_SECONDS, fall * 5));
  }

  protected get context(): BaseAudioContext { return this.kit.context; }

  /** Makes the graph; called once each time the bed comes back. */
  protected abstract build(now: number): void;

  /** One frame. Answers whether the bed is running afterwards. */
  drive(wanted: boolean, now: number): boolean {
    if (wanted && !this.live) {
      this.live = true;
      this.clock.reset();
      for (const glide of this.allGlides) glide.reset();
      this.build(now);
    }
    if (this.live && this.clock.update(wanted, now)) this.stop(now, 0.05);
    return this.live;
  }

  /** Fades the bed out over `fade` seconds, stops it and lets its nodes go. */
  stop(now: number, fade: number): void {
    if (!this.live) return;
    this.live = false;
    const nodes = this.nodes, sources = this.sources;
    this.nodes = []; this.sources = [];
    const level = this.level;
    try {
      level?.gain.cancelScheduledValues(now);
      level?.gain.setValueAtTime(level.gain.value, now);
      level?.gain.linearRampToValueAtTime(0, now + fade);
    } catch { /* a closed context */ }
    const first = sources[0];
    const release = () => { for (const node of nodes) node.disconnect(); };
    if (first) first.onended = release;
    for (const source of sources) {
      try { source.stop(now + fade + 0.01); } catch { /* not started */ }
    }
    if (!first) release();
  }

  /** The bed's outer level, faded on stop. */
  protected abstract get level(): GainNode | undefined;

  protected glide(tau: number, epsilon: number): Glide {
    const made = new Glide(tau, epsilon);
    this.allGlides.push(made);
    return made;
  }

  protected gain(value = 1): GainNode {
    const node = this.context.createGain();
    node.gain.value = value;
    return this.track(node);
  }

  protected filter(type: BiquadFilterType, frequency: number, q = 0.707): BiquadFilterNode {
    const node = this.context.createBiquadFilter();
    node.type = type; node.frequency.value = frequency; node.Q.value = q;
    return this.track(node);
  }

  protected pan(value: number): StereoPannerNode {
    const node = this.context.createStereoPanner();
    node.pan.value = value;
    return this.track(node);
  }

  protected osc(type: OscillatorType, frequency: number, now: number): OscillatorNode {
    const node = this.context.createOscillator();
    node.type = type; node.frequency.value = frequency;
    node.start(now);
    this.sources.push(node);
    return this.track(node);
  }

  /** A looping buffer from a random point, so two beds on the same air never line up. */
  protected loop(buffer: AudioBuffer, now: number, rate = 1): AudioBufferSourceNode {
    const node = this.context.createBufferSource();
    node.buffer = buffer; node.loop = true; node.playbackRate.value = rate;
    node.start(now, Math.random() * buffer.duration);
    this.sources.push(node);
    return this.track(node);
  }

  /** A slow wobble of `depth` into `param`, around whatever value the param holds. */
  protected lfo(param: AudioParam, hz: number, depth: number, now: number): void {
    const amount = this.gain(depth);
    this.osc('sine', hz, now).connect(amount);
    amount.connect(param);
  }

  protected chain(...nodes: AudioNode[]): void {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i]!.connect(nodes[i + 1]!);
  }

  protected track<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
}

/** Half-wave, eased: below a small threshold the creak is closed; above it, it opens smoothly. */
const BOUTS = (() => {
  const curve = new Float32Array(257);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.max(0, (x - 0.1) / 0.9) ** 1.6;
  }
  return curve;
})();

/**
 * The reel's check while winding: the pawl clicking over the gear (a band-limited sawtooth's one step per period,
 * high-passed to a click and rung through the pawl and the spool), and the spool turning with the line laying on.
 */
export class ReelBed extends Bed {
  constructor(kit: PierKit, out: AudioNode) { super(kit, out, 0.06); }

  private click?: OscillatorNode; private pawl?: BiquadFilterNode; private clickLevel?: GainNode;
  private whirrBand?: BiquadFilterNode; private whirrLevel?: GainNode; private output?: GainNode;
  private readonly glides = {
    click: this.glide(0.04, 1e-4), clickHz: this.glide(0.08, 0.05), pawl: this.glide(0.1, 2), whirr: this.glide(0.06, 1e-4), whirrHz: this.glide(0.1, 2),
  };

  protected get level() { return this.output; }

  protected build(now: number): void {
    this.output = this.gain(1);
    this.output.connect(this.out);
    this.click = this.osc('sawtooth', 6, now);
    // A hand never winds quite evenly.
    this.lfo(this.click.frequency, 4.7, 1.2, now);
    const step = this.filter('highpass', 1500, 0.7), sum = this.gain(2.4);
    this.pawl = this.filter('bandpass', 2200, 4.5);
    const body = this.filter('bandpass', 880, 2.5);
    this.chain(this.click, step);
    step.connect(this.pawl); step.connect(body); this.pawl.connect(sum); body.connect(sum);
    this.clickLevel = this.gain(0);
    this.chain(sum, this.clickLevel, this.output);

    this.whirrBand = this.filter('bandpass', 280, 2.2);
    this.whirrLevel = this.gain(0);
    this.chain(this.loop(this.kit.air, now), this.whirrBand, this.filter('lowpass', 1800, 0.6), this.whirrLevel, this.output);
  }

  set(shape: Readonly<ReelShape>, now: number): void {
    if (!this.live) return;
    const g = this.glides;
    g.click.to(this.clickLevel!.gain, shape.click, now);
    g.clickHz.to(this.click!.frequency, shape.clickHz, now);
    g.pawl.to(this.pawl!.frequency, shape.pawlHz, now);
    g.whirr.to(this.whirrLevel!.gain, shape.whirr, now);
    g.whirrHz.to(this.whirrBand!.frequency, shape.whirrHz, now);
  }
}

/**
 * The line under load: the willow creaking (a wandering stick-slip through the rod's resonances, swelling and
 * easing) and the line itself singing, narrow and rising, trembling just before it gives.
 */
export class TensionBed extends Bed {
  constructor(kit: PierKit, out: AudioNode) { super(kit, out, 0.08); }

  private creak?: OscillatorNode; private creakLevel?: GainNode;
  private strainBand?: BiquadFilterNode; private strainLevel?: GainNode; private trembleDepth?: GainNode; private output?: GainNode;
  private readonly glides = {
    creak: this.glide(0.08, 1e-4), creakHz: this.glide(0.12, 0.1), strain: this.glide(0.06, 1e-4), strainHz: this.glide(0.08, 3), tremble: this.glide(0.1, 0.005),
  };

  protected get level() { return this.output; }

  protected build(now: number): void {
    this.output = this.gain(1);
    this.output.connect(this.out);
    this.creak = this.osc('sawtooth', 12, now);
    this.lfo(this.creak.frequency, 0.9, 5, now);
    this.lfo(this.creak.frequency, 0.37, 3, now);
    const low = this.filter('highpass', 260, 0.6), body = this.gain(3);
    this.chain(this.creak, low);
    for (const [hz, q] of [[640, 4], [1380, 5], [2520, 6]] as const) {
      const band = this.filter('bandpass', hz, q);
      low.connect(band); band.connect(body);
    }
    // The rod creaks in bouts, not as a steady buzz: two slow, uneven swells, rectified, open and close it.
    const bouts = this.gain(0), rectify = this.context.createWaveShaper();
    rectify.curve = BOUTS;
    this.track(rectify);
    this.osc('sine', 0.53, now).connect(this.gain(0.6)).connect(rectify);
    this.osc('sine', 0.21, now).connect(this.gain(0.4)).connect(rectify);
    rectify.connect(bouts.gain);
    this.creakLevel = this.gain(0);
    this.chain(body, bouts, this.creakLevel, this.output);

    this.strainBand = this.filter('bandpass', 900, 14);
    const tremble = this.gain(1);
    this.trembleDepth = this.gain(0);
    this.osc('sine', 9.5, now).connect(this.trembleDepth);
    this.trembleDepth.connect(tremble.gain);
    this.strainLevel = this.gain(0);
    this.chain(this.loop(this.kit.air, now), this.strainBand, tremble, this.strainLevel, this.output);
  }

  set(shape: Readonly<TensionShape>, now: number): void {
    if (!this.live) return;
    const g = this.glides;
    g.creak.to(this.creakLevel!.gain, shape.creak, now);
    g.creakHz.to(this.creak!.frequency, shape.creakHz, now);
    g.strain.to(this.strainLevel!.gain, shape.strain * 4, now);
    g.strainHz.to(this.strainBand!.frequency, shape.strainHz, now);
    g.tremble.to(this.trembleDepth!.gain, shape.tremble * 0.6, now);
  }
}

/** Water lapping at the piles: two baked loops of different lengths, panned apart, muffled or brightened by mood. */
export class LapBed extends Bed {
  constructor(kit: PierKit, out: AudioNode) { super(kit, out, 0.35); }

  private output?: GainNode; private tone?: BiquadFilterNode; private loops: AudioBufferSourceNode[] = [];
  private started = false;
  private readonly glides = { level: this.glide(0.35, 1e-4), tone: this.glide(1, 5), rateA: this.glide(1, 0.002), rateB: this.glide(1, 0.002) };

  protected get level() { return this.output; }

  protected build(): void {
    this.output = this.gain(0);
    this.tone = this.filter('lowpass', 5200, 0.6);
    this.chain(this.output, this.tone, this.out);
    this.loops = [];
    this.started = false;
  }

  set(shape: Readonly<AmbienceShape>, now: number): void {
    if (!this.live) return;
    if (!this.started) {
      // Each call bakes one more slice until the loops are ready.
      const laps = this.kit.laps();
      if (laps) {
        this.started = true;
        this.loops = laps.map((buffer, index) => {
          const source = this.loop(buffer, now, shape.lapRate);
          this.chain(source, this.pan(index ? 0.55 : -0.55), this.output!);
          return source;
        });
      }
    }
    const g = this.glides;
    g.level.to(this.output!.gain, shape.lap, now);
    g.tone.to(this.tone!.frequency, shape.lapTone, now);
    if (this.loops[0]) g.rateA.to(this.loops[0].playbackRate, shape.lapRate, now);
    if (this.loops[1]) g.rateB.to(this.loops[1].playbackRate, shape.lapRate * 0.985, now);
  }
}

/** Rain on the water and the boards: thousands of baked drops, two loops wide. */
export class RainBed extends Bed {
  constructor(kit: PierKit, out: AudioNode) { super(kit, out, 1.2); }

  private output?: GainNode; private started = false;
  private readonly glides = { level: this.glide(1.2, 1e-4) };

  protected get level() { return this.output; }

  protected build(): void {
    this.output = this.gain(0);
    this.chain(this.output, this.filter('lowpass', 9000, 0.5), this.out);
    this.started = false;
  }

  set(shape: Readonly<AmbienceShape>, now: number): void {
    if (!this.live) return;
    if (!this.started) {
      const rains = this.kit.rains();
      if (rains) {
        this.started = true;
        rains.forEach((buffer, index) => this.chain(this.loop(buffer, now), this.pan(index ? 0.65 : -0.65), this.output!));
      }
    }
    this.glides.level.to(this.output!.gain, shape.rain, now);
  }
}

/** Breeze over open water: air through a slowly wandering band, gusting, with a faint note where it finds the rails. */
export class BreezeBed extends Bed {
  constructor(kit: PierKit, out: AudioNode) { super(kit, out, 1.2); }

  private output?: GainNode;
  private readonly glides = { level: this.glide(1.2, 1e-4) };

  protected get level() { return this.output; }

  protected build(now: number): void {
    this.output = this.gain(0);
    this.output.connect(this.out);
    const air = this.loop(this.kit.air, now), band = this.filter('bandpass', 520, 0.7), gust = this.gain(0.62);
    this.lfo(band.frequency, 0.071, 220, now);
    this.lfo(gust.gain, 0.11, 0.24, now);
    this.lfo(gust.gain, 0.043, 0.13, now);
    this.chain(air, band, this.filter('lowpass', 2000, 0.6), gust, this.output);
    const rail = this.filter('bandpass', 1150, 14), whistle = this.gain(0.12);
    this.lfo(whistle.gain, 0.083, 0.12, now);
    this.chain(air, rail, whistle, this.output);
  }

  set(shape: Readonly<AmbienceShape>, now: number): void {
    if (this.live) this.glides.level.to(this.output!.gain, shape.breeze, now);
  }
}

/** Mist's hush: a low, wide softness close around the listener, breathing very slowly. */
export class MistBed extends Bed {
  constructor(kit: PierKit, out: AudioNode) { super(kit, out, 1.5); }

  private output?: GainNode;
  private readonly glides = { level: this.glide(1.5, 1e-4) };

  protected get level() { return this.output; }

  protected build(now: number): void {
    this.output = this.gain(0);
    this.output.connect(this.out);
    for (const side of [-0.6, 0.6]) {
      const swell = this.gain(0.8);
      this.lfo(swell.gain, side < 0 ? 0.05 : 0.067, 0.2, now);
      this.chain(this.loop(this.kit.air, now), this.filter('lowpass', 340, 0.6), this.filter('highpass', 60, 0.6), swell, this.pan(side), this.output);
    }
  }

  set(shape: Readonly<AmbienceShape>, now: number): void {
    if (this.live) this.glides.level.to(this.output!.gain, shape.mist, now);
  }
}

/** The lantern after dusk: the soft purr of its flame, flickering, and the glass chimney's faint warm singing. */
export class LanternBed extends Bed {
  constructor(kit: PierKit, out: AudioNode) { super(kit, out, 0.8); }

  private output?: GainNode;
  private readonly glides = { level: this.glide(0.8, 1e-5) };

  protected get level() { return this.output; }

  protected build(now: number): void {
    this.output = this.gain(0);
    const flicker = this.gain(0.75);
    this.lfo(flicker.gain, 2.3, 0.14, now);
    this.lfo(flicker.gain, 5.7, 0.09, now);
    this.chain(flicker, this.output, this.pan(0.15), this.out);
    this.chain(this.loop(this.kit.air, now), this.filter('bandpass', 150, 1.4), this.filter('lowpass', 420, 0.6), this.gain(2.2), flicker);
    const chimney = this.gain(0.05);
    this.chain(this.osc('triangle', 110, now), this.filter('lowpass', 300, 0.6), chimney, flicker);
  }

  set(shape: Readonly<AmbienceShape>, now: number): void {
    if (this.live) this.glides.level.to(this.output!.gain, shape.lantern, now);
  }
}
