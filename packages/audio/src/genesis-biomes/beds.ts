import type { BedTargets, Placed } from './mixplan';
import { mix, range, unit, valueNoise } from './rng';
import type { TextureKey } from './textures';
import type { LandKit } from './voice';

/**
 * The continuous layers of a land: wind with gusts and the pass's whistle, the sea breaking on two stretches of
 * shore, the harbour lapping, the river, rain, leaves or grass, insects and a low floor. Each bed is made when its
 * target first rises above silence and retired a while after it falls back, so a dry calm day runs a handful of
 * sources, a storm by the river a few dozen at most (`BED_SOURCE_LIMIT`).
 */

/** Hard upper bound on bed source nodes running at once, all beds made (checked in the tests). */
export const BED_SOURCE_LIMIT = 34;
/** Seconds of near-silence before a bed is retired. */
const RETIRE_AFTER = 6;
const SILENT = 1e-4;

/** Holds an automated parameter where it is, so the next ramp starts there: no steps, no clicks. */
export function hold(param: AudioParam, at: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(at);
  else { const value = param.value; param.cancelScheduledValues(at); param.setValueAtTime(value, at); }
}

function ease(param: AudioParam, value: number, at: number, tau: number): void {
  hold(param, at);
  param.setTargetAtTime(value, at, tau);
}

interface Source { node: AudioScheduledSourceNode; stop: number; nodes: AudioNode[] }

/** Owns started sources and the nodes made for them, releasing each when it ends. */
class Sources {
  readonly live = new Set<Source>();
  /** Runs once when the last source has ended (a retired bed then lets go of its nodes). */
  onEmpty: (() => void) | null = null;
  add(node: AudioScheduledSourceNode, start: number, stop: number, nodes: AudioNode[], offset?: number): void {
    const item: Source = { node, stop, nodes };
    node.onended = () => {
      this.live.delete(item); for (const n of nodes) n.disconnect();
      if (this.live.size === 0 && this.onEmpty) { const done = this.onEmpty; this.onEmpty = null; done(); }
    };
    if (offset !== undefined) (node as AudioBufferSourceNode).start(start, offset); else node.start(start);
    if (Number.isFinite(stop)) node.stop(stop);
    this.live.add(item);
  }
  count(at: number): number { let n = 0; for (const item of this.live) if (item.stop > at) n++; return n; }
  stop(at: number): void {
    for (const item of this.live) {
      if (item.stop <= at) continue;
      item.stop = at;
      try { item.node.stop(at); } catch { /* already stopped */ }
    }
  }
  release(): void {
    for (const item of this.live) { item.node.onended = null; for (const n of item.nodes) n.disconnect(); }
    this.live.clear();
  }
}

/**
 * Plays a synthesised texture as an endless stream of overlapping grains: each from a fresh offset at least a
 * quarter of the texture away from the last, at a slightly different rate, panned to alternate sides, joined by
 * equal-power cross-fades. Two grains overlap at most.
 */
class GrainPlayer {
  readonly out: GainNode;
  private next: { at: number; fade: number } | null = null;
  private index = 0;
  private lastOffset = -1;

  constructor(private readonly context: BaseAudioContext, private readonly buffer: AudioBuffer, private readonly sources: Sources,
    private readonly seed: number, private readonly options: { hold: readonly [number, number]; fade: readonly [number, number]; rate: readonly [number, number]; spread: number }) {
    this.out = context.createGain();
  }

  schedule(until: number): void {
    const now = this.context.currentTime;
    this.next ??= { at: now + 0.02, fade: this.fadeFor(0) };
    if (this.next.at < now) this.next = { at: now + 0.02, fade: this.next.fade };
    while (this.next.at < until) {
      const i = this.index++, start: number = this.next.at, fade: number = this.next.fade;
      const holdFor = range(unit(this.seed, i, 1), this.options.hold[0], this.options.hold[1]);
      const nextFade: number = this.fadeFor(i + 1), nextAt: number = start + fade + holdFor, length = nextAt + nextFade - start;
      const rate = range(unit(this.seed, i, 2), this.options.rate[0], this.options.rate[1]);
      const room = Math.max(0, this.buffer.duration - length * rate - 0.01);
      let offset = unit(this.seed, i, 3) * room;
      if (this.lastOffset >= 0 && Math.abs(offset - this.lastOffset) < this.buffer.duration * 0.25) {
        offset = (offset + this.buffer.duration * 0.5) % Math.max(0.001, room);
      }
      this.lastOffset = offset;
      const source = this.context.createBufferSource(), gain = this.context.createGain(), pan = this.context.createStereoPanner();
      source.buffer = this.buffer; source.playbackRate.value = rate;
      pan.pan.value = (i % 2 ? 1 : -1) * this.options.spread * range(unit(this.seed, i, 4), 0.5, 1);
      gain.gain.value = 0;
      gain.gain.setValueCurveAtTime(QUARTER_SINE_UP, start, fade);
      gain.gain.setValueCurveAtTime(QUARTER_SINE_DOWN, nextAt, nextFade);
      source.connect(gain); gain.connect(pan); pan.connect(this.out);
      this.sources.add(source, start, start + length + 0.01, [source, gain, pan], offset);
      this.next = { at: nextAt, fade: nextFade };
    }
  }

  private fadeFor(i: number): number { return range(unit(this.seed, i, 5), this.options.fade[0], this.options.fade[1]); }
}

const QUARTER_SINE_UP = Float32Array.from({ length: 33 }, (_, i) => Math.sin((Math.PI / 2) * (i / 32)));
const QUARTER_SINE_DOWN = Float32Array.from({ length: 33 }, (_, i) => Math.cos((Math.PI / 2) * (i / 32)));

/** The level, air and pan stage every placed bed ends in. */
class Placement {
  readonly level: GainNode;
  readonly air: BiquadFilterNode;
  readonly pan: StereoPannerNode;
  constructor(context: BaseAudioContext, out: AudioNode) {
    this.level = context.createGain(); this.level.gain.value = 0;
    this.air = context.createBiquadFilter(); this.air.type = 'lowpass'; this.air.frequency.value = 18000; this.air.Q.value = 0.5;
    this.pan = context.createStereoPanner();
    this.level.connect(this.air); this.air.connect(this.pan); this.pan.connect(out);
  }
  steer(target: Placed, at: number, tau = 1.2): void {
    ease(this.level.gain, target.level, at, tau);
    ease(this.air.frequency, target.air, at, 0.6);
    ease(this.pan.pan, target.pan, at, 0.35);
  }
  get nodes(): AudioNode[] { return [this.level, this.air, this.pan]; }
}

interface Bed {
  /** When its target fell to silence (Infinity while it sounds), to decide when to retire it. */
  quietSince: number;
  nodes: AudioNode[];
  sources: Sources;
  grains: GrainPlayer[];
  /** Looping noise sources: their rates drift on a seeded curve so no loop ever recurs at a fixed period. */
  noises: { node: AudioBufferSourceNode; salt: number }[];
}

type BedName = 'wind' | 'seaLeft' | 'seaRight' | 'lap' | 'river' | 'rush' | 'rain' | 'foliage' | 'crickets' | 'grasshoppers' | 'floor';

export interface WaveTiming { /** realm seconds → context seconds */ toContext(realm: number): number }

export class LandBeds {
  readonly output: GainNode;
  private readonly beds = new Map<BedName, Bed & Record<string, unknown>>();
  private stopped = false;

  constructor(private readonly context: BaseAudioContext, private readonly kit: LandKit, destination: AudioNode, private readonly seed: number,
    private readonly waveSlots: readonly [number, number]) {
    this.output = context.createGain();
    this.output.connect(destination);
  }

  /** Bed source nodes running at `at`. */
  sources(at: number): number {
    let total = 0;
    for (const bed of this.beds.values()) total += bed.sources.count(at);
    return total;
  }

  get made(): readonly string[] { return [...this.beds.keys()]; }

  /** Moves every bed towards the targets; makes beds that are needed and retires those long silent. */
  steer(targets: BedTargets, realm: number, at: number): void {
    if (this.stopped) return;
    const levels: Record<BedName, number> = {
      wind: targets.wind.level + targets.wind.whistle, seaLeft: targets.sea.left.level, seaRight: targets.sea.right.level,
      lap: targets.lap.level, river: targets.river.level, rush: targets.river.rush.level, rain: targets.rain.level,
      foliage: targets.foliage.level, crickets: targets.crickets, grasshoppers: targets.grasshoppers, floor: targets.floor,
    };
    for (const [name, level] of Object.entries(levels) as [BedName, number][]) {
      let bed = this.beds.get(name);
      if (!bed && level > SILENT * 4) bed = this.make(name);
      if (!bed) continue;
      if (level > SILENT) bed.quietSince = Infinity;
      else if (bed.quietSince === Infinity) bed.quietSince = at;
      else if (at - bed.quietSince > RETIRE_AFTER) { this.retire(name, at); continue; }
      this.drive(name, bed, targets, realm, at);
      for (const { node, salt } of bed.noises) ease(node.playbackRate, 0.94 + 0.12 * valueNoise(mix(this.seed, salt, 0xd1f7), realm, 11), at, 1);
    }
  }

  /** Schedules grains up to `until` (context seconds). */
  feed(until: number): void {
    if (this.stopped) return;
    for (const bed of this.beds.values()) for (const player of bed.grains) player.schedule(until);
  }

  /**
   * Schedules every breaker whose start falls in [from, to) realm seconds on both stretches of shore. Each side has
   * its own fixed slot (8–11 s), one wave per slot at a seeded point in it; a slow seeded swell makes sets of
   * bigger waves. A wave is the swell's rumble, the break, the wash running up and the hiss of the backwash.
   */
  scheduleWaves(from: number, to: number, swell: number, timing: WaveTiming): void {
    if (this.stopped) return;
    (['seaLeft', 'seaRight'] as const).forEach((name, side) => {
      const bed = this.beds.get(name);
      if (!bed) return;
      const slot = this.waveSlots[side]!, period = slot * 0.7;
      for (let k = Math.floor(from / slot) - 1; k * slot < to; k++) {
        const start = k * slot + unit(this.seed, side, k, 41) * slot * 0.3;
        if (start < from || start >= to) continue;
        const set = 0.7 + 0.6 * valueNoise(mix(this.seed, side, 7), start, 75);
        const h = Math.min(1, swell * range(unit(this.seed, side, k, 43), 0.5, 1) * set);
        this.wave(bed as unknown as SeaBed, timing.toContext(start), h, period);
      }
    });
  }

  /** Forgets automation scheduled after `at` (a seek): pending waves and grains are dropped, nothing sounded is cut. */
  cancelFuture(at: number): void {
    for (const bed of this.beds.values()) {
      for (const node of bed.nodes) for (const param of paramsOf(node)) hold(param, at);
    }
  }

  /** Fades every bed out over `seconds` and stops all sources just after. */
  fadeOut(at: number, seconds: number): void {
    if (this.stopped) return;
    ease(this.output.gain, 0, at, seconds / 4);
    for (const bed of this.beds.values()) bed.sources.stop(at + seconds + 0.05);
    this.stopped = true;
  }

  /** Stops every source at `at` (interruption, disposal). */
  stop(at: number): void {
    for (const bed of this.beds.values()) bed.sources.stop(at);
    this.stopped = true;
  }

  release(): void {
    for (const bed of this.beds.values()) { bed.sources.release(); for (const node of bed.nodes) node.disconnect(); }
    this.beds.clear();
    this.output.disconnect();
  }

  // -------------------------------------------------------------------------------------------------------------

  private noise(bed: Bed, colour: 'white' | 'pink' | 'brown', salt: number): AudioBufferSourceNode {
    const node = this.context.createBufferSource(), buffer = this.kit[colour];
    node.buffer = buffer; node.loop = true;
    bed.sources.add(node, this.context.currentTime + 0.01, Infinity, [node], unit(this.seed, salt, 3) * buffer.duration);
    bed.noises.push({ node, salt });
    return node;
  }

  private grains(bed: Bed, key: TextureKey, salt: number, options: ConstructorParameters<typeof GrainPlayer>[4]): GrainPlayer {
    const player = new GrainPlayer(this.context, this.kit.texture(key), bed.sources, mix(this.seed, salt), options);
    bed.grains.push(player); bed.nodes.push(player.out);
    return player;
  }

  private filter(bed: Bed, type: BiquadFilterType, frequency: number, q: number): BiquadFilterNode {
    const node = this.context.createBiquadFilter();
    node.type = type; node.frequency.value = frequency; node.Q.value = q;
    bed.nodes.push(node);
    return node;
  }

  private gain(bed: Bed, value = 0): GainNode {
    const node = this.context.createGain();
    node.gain.value = value;
    bed.nodes.push(node);
    return node;
  }

  private placement(bed: Bed): Placement {
    const placement = new Placement(this.context, this.output);
    bed.nodes.push(...placement.nodes);
    return placement;
  }

  private make(name: BedName): Bed & Record<string, unknown> {
    const bed: Bed & Record<string, unknown> = { quietSince: Infinity, nodes: [], sources: new Sources(), grains: [], noises: [] };
    const c = (a: AudioNode, ...rest: AudioNode[]) => { let last = a; for (const n of rest) { last.connect(n); last = n; } };
    switch (name) {
      case 'wind': {
        // Two decorrelated sides of air, each a body (low roar) and an air band (the whoosh), plus the whistle.
        const sides = [-0.6, 0.6].map((panValue, side) => {
          const source = this.noise(bed, 'pink', 10 + side);
          // The body is the low roar of moving air, kept above 110 Hz so it never muddies a voice or a game.
          const lift = this.filter(bed, 'highpass', 110, 0.6);
          const body = this.filter(bed, 'lowpass', 400, 0.5), bodyGain = this.gain(bed);
          const air = this.filter(bed, 'bandpass', 1200, 0.6), airGain = this.gain(bed);
          const pan = this.context.createStereoPanner(); pan.pan.value = panValue; bed.nodes.push(pan);
          c(source, lift, body, bodyGain, pan); c(source, air, airGain, pan); pan.connect(this.output);
          return { body, bodyGain, air, airGain };
        });
        const whistleSource = this.noise(bed, 'white', 12);
        const tones = [this.filter(bed, 'bandpass', 520, 24), this.filter(bed, 'bandpass', 780, 26)];
        const whistleGain = this.gain(bed), whistlePan = this.context.createStereoPanner(); bed.nodes.push(whistlePan);
        for (const tone of tones) c(whistleSource, tone, whistleGain);
        c(whistleGain, whistlePan, this.output);
        Object.assign(bed, { sides, tones, whistleGain, whistlePan });
        break;
      }
      case 'seaLeft': case 'seaRight': {
        const place = this.placement(bed);
        const white = this.noise(bed, 'white', name === 'seaLeft' ? 20 : 21), brown = this.noise(bed, 'brown', name === 'seaLeft' ? 22 : 23);
        const breakFilter = this.filter(bed, 'lowpass', 500, 0.6), breakGain = this.gain(bed);
        const washFilter = this.filter(bed, 'bandpass', 3000, 0.7), washGain = this.gain(bed);
        const bodyFilter = this.filter(bed, 'bandpass', 150, 0.8), bodyGain = this.gain(bed, 0.15);
        c(white, breakFilter, breakGain, place.level); c(white, washFilter, washGain, place.level); c(brown, bodyFilter, bodyGain, place.level);
        Object.assign(bed, { place, breakFilter, breakGain, washFilter, washGain, bodyGain } satisfies Omit<SeaBed, keyof Bed>);
        break;
      }
      case 'lap': {
        const place = this.placement(bed), source = this.noise(bed, 'white', 30);
        const band = this.filter(bed, 'bandpass', 620, 1.1), chop = this.gain(bed, 0.5), low = this.filter(bed, 'lowpass', 1400, 0.5);
        c(source, band, low, chop, place.level);
        Object.assign(bed, { place, band, chop });
        break;
      }
      case 'river': {
        const place = this.placement(bed);
        const babble = this.grains(bed, 'babble', 40, { hold: [1.4, 2.6], fade: [0.9, 1.5], rate: [0.9, 1.1], spread: 0.35 });
        const babbleGain = this.gain(bed, 1);
        const source = this.noise(bed, 'brown', 41), body = this.filter(bed, 'bandpass', 380, 0.6), bodyGain = this.gain(bed, 0.4);
        c(babble.out, babbleGain, place.level); c(source, body, bodyGain, place.level);
        Object.assign(bed, { place, babbleGain, bodyGain });
        break;
      }
      case 'rush': {
        const place = this.placement(bed);
        const rush = this.grains(bed, 'rush', 50, { hold: [1.2, 2.2], fade: [0.8, 1.2], rate: [0.92, 1.08], spread: 0.3 });
        c(rush.out, place.level);
        Object.assign(bed, { place });
        break;
      }
      case 'rain': {
        const level = this.gain(bed);
        const hiss = this.noise(bed, 'white', 60), band = this.filter(bed, 'bandpass', 4800, 0.45), hissGain = this.gain(bed, 0.12);
        c(hiss, band, hissGain, level);
        const surfaces = (['rain-ground', 'rain-leaves', 'rain-water'] as const).map((key, i) => {
          const player = this.grains(bed, key, 61 + i, { hold: [0.6, 1.1], fade: [0.35, 0.6], rate: [0.9, 1.12], spread: 0.6 });
          const gain = this.gain(bed);
          c(player.out, gain, level);
          return gain;
        });
        level.connect(this.output);
        Object.assign(bed, { level, surfaces });
        break;
      }
      case 'foliage': {
        const source = this.noise(bed, 'pink', 70);
        const leaves = this.filter(bed, 'bandpass', 3200, 0.5), grass = this.filter(bed, 'highpass', 4300, 0.5);
        const leafGain = this.gain(bed), grassGain = this.gain(bed), gust = this.gain(bed), pan = this.context.createStereoPanner();
        bed.nodes.push(pan);
        c(source, leaves, leafGain, gust); c(source, grass, grassGain, gust); c(gust, pan, this.output);
        Object.assign(bed, { leafGain, grassGain, gust, pan });
        break;
      }
      case 'crickets': case 'grasshoppers': {
        const level = this.gain(bed);
        const player = this.grains(bed, name, name === 'crickets' ? 80 : 81, { hold: [1.6, 2.8], fade: [0.9, 1.4], rate: [0.97, 1.03], spread: 0.65 });
        c(player.out, level, this.output);
        Object.assign(bed, { level });
        break;
      }
      case 'floor': {
        const level = this.gain(bed), source = this.noise(bed, 'brown', 90), low = this.filter(bed, 'bandpass', 130, 0.7);
        c(source, low, level, this.output);
        Object.assign(bed, { level });
        break;
      }
    }
    this.beds.set(name, bed);
    return bed;
  }

  private drive(name: BedName, bed: Bed & Record<string, unknown>, targets: BedTargets, realm: number, at: number): void {
    switch (name) {
      case 'wind': {
        const { sides, tones, whistleGain, whistlePan } = bed as unknown as WindBed;
        sides.forEach((side, i) => {
          // Gusts: seeded value noise of the realm clock, a little ahead to cover the smoothing lag.
          const g = gust(this.seed, i, realm + 0.25), level = targets.wind.level * (0.45 + 0.75 * g);
          ease(side.bodyGain.gain, level, at, 0.18);
          ease(side.airGain.gain, level * (0.25 + 0.9 * g * g) * 0.7, at, 0.18);
          ease(side.body.frequency, 260 + 520 * g, at, 0.25);
          ease(side.air.frequency, 850 + 1300 * g, at, 0.25);
        });
        const g = (gust(this.seed, 0, realm + 0.25) + gust(this.seed, 1, realm + 0.25)) / 2;
        // Two narrow resonances pass ~1/1000 of white noise's power: the gain makes up for it.
        ease(whistleGain.gain, targets.wind.whistle * Math.max(0, g - 0.3) ** 1.5 * 38, at, 0.2);
        tones.forEach((tone, i) => ease(tone.frequency, targets.wind.whistleHz * (i ? 1.5 : 1) * (0.86 + 0.32 * g), at, 0.3));
        ease(whistlePan.pan, targets.wind.whistlePan, at, 0.35);
        break;
      }
      case 'seaLeft': case 'seaRight': {
        (bed as unknown as SeaBed).place.steer(name === 'seaLeft' ? targets.sea.left : targets.sea.right, at);
        break;
      }
      case 'lap': {
        const { place, chop, band } = bed as unknown as { place: Placement; chop: GainNode; band: BiquadFilterNode };
        place.steer(targets.lap, at);
        const c1 = valueNoise(mix(this.seed, 31), realm, 0.55), c2 = valueNoise(mix(this.seed, 32), realm, 1.7);
        ease(chop.gain, 0.15 + 0.85 * (c1 * 0.6 + c2 * 0.4) ** 2, at, 0.07);
        ease(band.frequency, 480 + 380 * c1, at, 0.1);
        break;
      }
      case 'river': {
        const { place, babbleGain, bodyGain } = bed as unknown as { place: Placement; babbleGain: GainNode; bodyGain: GainNode };
        place.steer(targets.river, at);
        ease(babbleGain.gain, 0.7 + targets.river.flow * 0.5, at, 1.5);
        ease(bodyGain.gain, 0.25 + targets.river.flow * 0.45, at, 1.5);
        break;
      }
      case 'rush': (bed as unknown as { place: Placement }).place.steer(targets.river.rush, at); break;
      case 'rain': {
        const { level, surfaces } = bed as unknown as { level: GainNode; surfaces: GainNode[] };
        ease(level.gain, targets.rain.level, at, 2);
        [targets.rain.ground, targets.rain.leaves, targets.rain.water].forEach((value, i) => ease(surfaces[i]!.gain, value, at, 1.5));
        break;
      }
      case 'foliage': {
        const { leafGain, grassGain, gust: gustGain, pan } = bed as unknown as { leafGain: GainNode; grassGain: GainNode; gust: GainNode; pan: StereoPannerNode };
        // Leaves answer the gust a moment after the air does, and more than in proportion.
        const g = gust(this.seed, 0, realm - 0.35);
        ease(gustGain.gain, targets.foliage.level * (0.25 + 1.1 * g * g), at, 0.25);
        ease(leafGain.gain, targets.foliage.grass ? 0.25 : 1, at, 1.5);
        ease(grassGain.gain, targets.foliage.grass ? 1 : 0.2, at, 1.5);
        ease(pan.pan, targets.foliage.pan * 0.7, at, 0.5);
        break;
      }
      case 'crickets': ease((bed as unknown as { level: GainNode }).level.gain, targets.crickets, at, 2.5); break;
      case 'grasshoppers': ease((bed as unknown as { level: GainNode }).level.gain, targets.grasshoppers, at, 2.5); break;
      case 'floor': ease((bed as unknown as { level: GainNode }).level.gain, targets.floor, at, 2); break;
    }
  }

  private wave(bed: SeaBed, t: number, h: number, period: number): void {
    const breakAt = t + period * 0.35;
    bed.bodyGain.gain.setTargetAtTime(0.25 + h * 0.75, t, period * 0.12);
    bed.bodyGain.gain.setTargetAtTime(0.15 + h * 0.15, breakAt + 0.8, 1.4);
    bed.breakGain.gain.setTargetAtTime(h * 0.12, t, 0.5);
    bed.breakFilter.frequency.setTargetAtTime(500 + h * 300, t, 0.6);
    bed.breakGain.gain.setTargetAtTime(h, breakAt, 0.07);
    bed.breakFilter.frequency.setTargetAtTime(900 + 2600 * h, breakAt, 0.05);
    bed.washFilter.frequency.setTargetAtTime(2100, breakAt + 0.1, 0.1);
    bed.washGain.gain.setTargetAtTime(h * 0.55, breakAt + 0.25, 0.25);
    bed.breakGain.gain.setTargetAtTime(h * 0.04, breakAt + 0.3, 0.6);
    bed.breakFilter.frequency.setTargetAtTime(420, breakAt + 0.35, 0.8);
    bed.washFilter.frequency.setTargetAtTime(5200, breakAt + 0.6, period * 0.3);
    bed.washGain.gain.setTargetAtTime(0, breakAt + 0.25 + period * 0.3, period * 0.2);
  }

  private retire(name: BedName, at: number): void {
    const bed = this.beds.get(name);
    if (!bed) return;
    this.beds.delete(name);
    // Its level has been near silence for seconds; the nodes are let go once the last source has ended.
    bed.sources.onEmpty = () => { for (const node of bed.nodes) node.disconnect(); };
    bed.sources.stop(at + 0.05);
  }
}

interface WindBed {
  sides: { body: BiquadFilterNode; bodyGain: GainNode; air: BiquadFilterNode; airGain: GainNode }[];
  tones: BiquadFilterNode[];
  whistleGain: GainNode;
  whistlePan: StereoPannerNode;
}
interface SeaBed extends Bed {
  place: Placement;
  breakFilter: BiquadFilterNode; breakGain: GainNode;
  washFilter: BiquadFilterNode; washGain: GainNode;
  bodyGain: GainNode;
}

/** Gust strength 0..1 for one side at a realm second: slow surges, quicker flurries, a peaky shape. */
export function gust(seed: number, side: number, realm: number): number {
  const s = mix(seed, 0x6057, side);
  const value = valueNoise(s, realm, 7.5) * 0.55 + valueNoise(s ^ 0x55, realm, 2.4) * 0.3 + valueNoise(s ^ 0xaa, realm, 0.8) * 0.15;
  return Math.max(0, Math.min(1, (value - 0.2) / 0.65)) ** 1.35;
}

function paramsOf(node: AudioNode): AudioParam[] {
  const params: AudioParam[] = [];
  for (const key of ['gain', 'frequency', 'Q', 'pan'] as const) {
    const param = (node as unknown as Record<string, unknown>)[key];
    if (param && typeof (param as AudioParam).setTargetAtTime === 'function') params.push(param as AudioParam);
  }
  return params;
}
