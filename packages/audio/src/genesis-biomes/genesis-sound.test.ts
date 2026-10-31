import { describe, expect, it } from 'vitest';
import { compileChannelGenesis } from '../../../world/src/genesis';
import { OBSERVED_GENESIS_FIXTURES } from '../../../world/src/genesis/observed-fixtures';
import { BED_SOURCE_LIMIT } from './beds';
import { CALLS } from './calls';
import { createGenesisSoundscape } from './index';
import { bedTargets } from './mixplan';
import { freshTake } from './rng';
import { describeGenesisSoundscape } from './scene';
import { CALL_LIMITS, inspectGenesisSoundscape, type GenesisSoundscape } from './soundscape';
import { sampleSpace, resolveListener } from './space';
import { synthTexture, TEXTURE_RMS, TEXTURES, type TextureKey } from './textures';
import type { GenesisSoundFrame, GenesisWeather, LandscapeCharacter } from './types';
import { dayParts, genesisWeatherAt, weatherKind } from './weather';

/**
 * The landscape layer against a counting fake context: it keeps time, records automation and counts the source
 * nodes that are started and not yet ended (what Web Audio would actually be running), so bounds, silence and
 * disposal are checked on the graph, not on the layer's own bookkeeping.
 */
class Param {
  value: number;
  events: [string, number, number][] = [];
  constructor(value = 0) { this.value = value; }
  private log(kind: string, value: number, at: number) { if (!Number.isFinite(value) || !Number.isFinite(at)) throw new RangeError(`${kind} ${value} @ ${at}`); this.events.push([kind, value, at]); return this; }
  setValueAtTime(value: number, at: number) { this.value = value; return this.log('set', value, at); }
  linearRampToValueAtTime(value: number, at: number) { return this.log('linear', value, at); }
  setTargetAtTime(value: number, at: number, tau: number) { if (!(tau > 0)) throw new RangeError('tau'); return this.log('target', value, at); }
  setValueCurveAtTime(curve: Float32Array, at: number, duration: number) {
    if (!(duration > 0) || curve.length < 2 || curve.some(v => !Number.isFinite(v))) throw new RangeError('curve');
    return this.log('curve', curve[curve.length - 1]!, at);
  }
  cancelScheduledValues(at: number) { return this.log('cancel', 0, at); }
  cancelAndHoldAtTime(at: number) { return this.log('hold', 0, at); }
  /** The last value this parameter was sent towards. */
  get target() { const e = [...this.events].reverse().find(([kind]) => kind === 'target' || kind === 'set'); return e ? e[1] : this.value; }
}

class Node {
  connections = new Set<Node>();
  disconnected = 0;
  constructor(readonly context: FakeContext) { context.nodes.push(this); }
  connect(target: Node) { this.connections.add(target); return target; }
  disconnect() { this.connections.clear(); this.disconnected++; }
}
class GainNode extends Node { gain = new Param(1); }
class FilterNode extends Node { type = 'lowpass'; frequency = new Param(350); Q = new Param(1); gain = new Param(0); }
class PannerNode extends Node { pan = new Param(0); }
class ConvolverNode extends Node { buffer: unknown = null; normalize = true; }
class ShaperNode extends Node { curve: unknown = null; oversample = 'none'; }
class Source extends Node {
  onended: (() => void) | null = null;
  frequency = new Param(440); playbackRate = new Param(1); offset = new Param(1);
  buffer: unknown = null; loop = false; type = 'sine';
  startAt = -1; stopAt = Infinity; ended = false;
  start(at = 0) { if (this.startAt >= 0) throw new Error('started twice'); this.startAt = at; this.context.started.add(this); this.context.everStarted++; }
  stop(at = 0) { if (this.startAt < 0) throw new Error('stopped before start'); if (!this.ended) this.stopAt = Math.min(this.stopAt, at); }
}
class FakeBuffer {
  private readonly data: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(channel: number) { return this.data[channel]!; }
}

class FakeContext {
  currentTime = 0;
  readonly sampleRate = 48000;
  state: AudioContextState = 'running';
  readonly destination: Node;
  readonly nodes: Node[] = [];
  readonly started = new Set<Source>();
  everStarted = 0;
  peakLive = 0;
  resumed = 0; closed = 0;
  private listeners = new Set<() => void>();
  constructor() { this.destination = new Node(this); }
  createGain() { return new GainNode(this); }
  createBiquadFilter() { return new FilterNode(this); }
  createStereoPanner() { return new PannerNode(this); }
  createConvolver() { return new ConvolverNode(this); }
  createWaveShaper() { return new ShaperNode(this); }
  createOscillator() { return new Source(this); }
  createBufferSource() { return new Source(this); }
  /** The layer's release markers: silent by construction (they feed a zero gain), so not counted as sounding. */
  createConstantSource() { const marker = new Source(this); this.markers.add(marker); return marker; }
  readonly markers = new Set<Source>();
  createBuffer(channels: number, length: number, rate: number) { return new FakeBuffer(channels, length, rate); }
  addEventListener(_: string, listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_: string, listener: () => void) { this.listeners.delete(listener); }
  get listenerCount() { return this.listeners.size; }
  resume() { this.resumed++; return Promise.resolve(); }
  close() { this.closed++; return Promise.resolve(); }
  setState(state: AudioContextState) { this.state = state; for (const listener of [...this.listeners]) listener(); }
  /** Live sources: started, not yet past their stop. */
  live(at = this.currentTime) { let n = 0; for (const s of this.started) if (!s.ended && !this.markers.has(s) && s.startAt <= at + 2 && s.stopAt > at) n++; return n; }
  advance(seconds: number) {
    this.currentTime += seconds;
    for (const source of [...this.started]) {
      if (!source.ended && source.stopAt <= this.currentTime) { source.ended = true; this.started.delete(source); source.onended?.(); }
    }
    this.peakLive = Math.max(this.peakLive, this.live());
  }
}

const recipes = OBSERVED_GENESIS_FIXTURES.map(facts => compileChannelGenesis(facts));
const COAST = recipes.find(recipe => String(recipe.kingdomId) === '63920635')!;
const RIVER = recipes.find(recipe => String(recipe.kingdomId) === '4363967')!;
const MOUNTAIN = recipes.find(recipe => String(recipe.kingdomId) === '154972160')!;
const land = (recipe: typeof COAST, character: LandscapeCharacter) => recipe.landscapes.find(candidate => candidate.character === character)!.id;
const BASE = 1_793_377_944_392;

function setup(recipe = COAST, character: LandscapeCharacter = 'coastal-harbour') {
  const context = new FakeContext();
  const destination = context.createGain();
  const soundscape = createGenesisSoundscape({ context: context as unknown as AudioContext, destination: destination as unknown as AudioNode },
    { recipe, landscapeId: land(recipe, character) });
  return { context, destination, soundscape };
}

/** Drives the layer like a host render loop: `fps` frames a second for `seconds`, realm time in step with audio time. */
function run(context: FakeContext, soundscape: GenesisSoundscape, seconds: number, frame: (t: number) => Partial<GenesisSoundFrame> = () => ({}), fps = 20, realmAt = (t: number) => BASE + t * 1000) {
  const start = context.currentTime;
  for (let i = 0; i < seconds * fps; i++) {
    const t = context.currentTime - start;
    soundscape.update({ realmMs: realmAt(t), hour: 11, ...frame(t) });
    context.advance(1 / fps);
  }
}

const STORM: GenesisWeather = { wind: 0.95, rain: 1, snow: 0, storm: 1, fog: 0, wet: 1 };

describe('the land, read from the recipe', () => {
  it('uses the explicitly selected landscape and the soundscape biome as two separate inputs', () => {
    for (const recipe of recipes) {
      for (const candidate of recipe.landscapes) {
        const scene = describeGenesisSoundscape(recipe, candidate.id);
        expect(scene.landscapeId).toBe(candidate.id);
        expect(scene.character).toBe(candidate.character);
        expect(scene.biome).toBe(recipe.soul.soundscape);
      }
      expect(() => describeGenesisSoundscape(recipe, `${recipe.recommendedLandscapeId}-not`)).toThrow(RangeError);
    }
    const harbour = describeGenesisSoundscape(COAST, land(COAST, 'coastal-harbour'));
    const valley = describeGenesisSoundscape(RIVER, land(RIVER, 'river-valley'));
    const pass = describeGenesisSoundscape(MOUNTAIN, land(MOUNTAIN, 'mountain-pass'));
    const keys = (scene: typeof harbour) => scene.pools.map(pool => pool.key);
    // The physical land brings its own places; the biome brings its chorus.
    expect(keys(harbour)).toEqual(expect.arrayContaining(['rigging', 'hull', 'mooring', 'slap', 'buoy', 'oystercatcher', 'curlew']));
    expect(keys(valley)).toEqual(expect.arrayContaining(['frog', 'plop', 'blackbird', 'skylark', 'owl']));
    expect(keys(valley)).not.toContain('rigging');
    expect(keys(pass)).toEqual(expect.arrayContaining(['scree', 'stones', 'buzzard', 'raven', 'curlew']));
    expect(pass.emphasis.echo).toBeGreaterThan(harbour.emphasis.echo);
    // Every call a land can make has a finished design.
    for (const scene of [harbour, valley, pass]) for (const pool of scene.pools) expect(CALLS[pool.key]).toBeDefined();
  });

  it('is pure: the same recipe and landscape describe the same land', () => {
    const id = land(MOUNTAIN, 'mountain-pass');
    const a = describeGenesisSoundscape(MOUNTAIN, id), b = describeGenesisSoundscape(MOUNTAIN, id);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.seed).not.toBe(describeGenesisSoundscape(MOUNTAIN, land(MOUNTAIN, 'river-valley')).seed);
  });
});

describe('weather and time', () => {
  it('is seeded, continuous and mostly fair over a realm year', () => {
    const key = COAST.soul.weatherSeedKey;
    expect(genesisWeatherAt(key, 'coastal-harbour', BASE)).toEqual(genesisWeatherAt(key, 'coastal-harbour', BASE));
    const kinds: Record<string, number> = {};
    let jump = 0;
    for (const recipe of recipes) {
      for (const character of ['coastal-harbour', 'river-valley', 'mountain-pass'] as const) {
        let previous = genesisWeatherAt(recipe.soul.weatherSeedKey, character, BASE);
        for (let i = 1; i < 2000; i++) {
          const t = BASE + i * 263_000, weather = genesisWeatherAt(recipe.soul.weatherSeedKey, character, t);
          kinds[weatherKind(weather)] = (kinds[weatherKind(weather)] ?? 0) + 1;
          if (character !== 'mountain-pass') expect(weather.snow).toBe(0);
          for (const value of Object.values(weather)) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1); }
          previous = weather;
        }
        // One realm second never moves any field by more than a hair: fronts arrive over minutes.
        for (let i = 0; i < 300; i++) {
          const t = BASE + i * 977_000;
          const a = genesisWeatherAt(recipe.soul.weatherSeedKey, character, t), b = genesisWeatherAt(recipe.soul.weatherSeedKey, character, t + 1000);
          for (const field of Object.keys(a) as (keyof GenesisWeather)[]) jump = Math.max(jump, Math.abs(a[field] - b[field]));
        }
        void previous;
      }
    }
    const total = Object.values(kinds).reduce((sum, n) => sum + n, 0), share = (...names: string[]) => names.reduce((sum, name) => sum + (kinds[name] ?? 0), 0) / total;
    expect(share('clear', 'breezy', 'windy', 'mist')).toBeGreaterThan(0.6);
    expect(share('drizzle', 'rain', 'storm', 'snow')).toBeGreaterThan(0.08);
    expect(share('storm')).toBeLessThan(0.07);
    expect(share('storm')).toBeGreaterThan(0);
    expect(jump).toBeLessThan(0.02);
  });

  it('follows the picture: night by 20:30, day by 07:00, choruses at dawn and dusk', () => {
    expect(dayParts(0).night).toBe(1);
    expect(dayParts(12)).toMatchObject({ night: 0, day: 1, dawn: 0, dusk: 0 });
    expect(dayParts(21).night).toBe(1);
    expect(dayParts(6.1).dawn).toBeCloseTo(1);
    expect(dayParts(19.4).dusk).toBeCloseTo(1);
    expect(dayParts(-2)).toEqual(dayParts(22));
    expect(() => dayParts(Number.NaN)).toThrow(RangeError);
  });
});

describe('variation', () => {
  it('never repeats a take twice in a row, and reaches every take', () => {
    for (const count of [2, 3, 5]) {
      let previous: number | undefined;
      const seen = new Set<number>();
      for (let i = 0; i < 400; i++) {
        const take = freshTake(0xabc, i, count, previous);
        expect(take).not.toBe(previous);
        seen.add(take); previous = take;
      }
      expect(seen.size).toBe(count);
    }
  });

  it('synthesises the same textures from the same seed, normalised and bounded', () => {
    for (const key of Object.keys(TEXTURES) as TextureKey[]) {
      const a = synthTexture(key, 1234), b = synthTexture(key, 1234), c = synthTexture(key, 99);
      expect(a.length).toBe(Math.round(TEXTURES[key].seconds * TEXTURES[key].rate));
      expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
      expect(Buffer.from(a.buffer).equals(Buffer.from(c.buffer))).toBe(false);
      let energy = 0, peak = 0;
      for (const v of a) { expect(Number.isFinite(v)).toBe(true); energy += v * v; peak = Math.max(peak, Math.abs(v)); }
      expect(peak).toBeLessThanOrEqual(0.9 + 1e-6);
      expect(Math.sqrt(energy / a.length)).toBeLessThanOrEqual(TEXTURE_RMS + 1e-6);
      expect(Math.sqrt(energy / a.length)).toBeGreaterThan(TEXTURE_RMS * 0.3);
    }
    // Seven textures × three seeds: about 50 s of audio synthesised sample by sample.
  }, 60_000);
});

describe('the mix plan', () => {
  it('keeps every bed bounded in any weather, hour, place and profile', () => {
    for (const [recipe, character] of [[COAST, 'coastal-harbour'], [RIVER, 'river-valley'], [MOUNTAIN, 'mountain-pass']] as const) {
      const scene = describeGenesisSoundscape(recipe, land(recipe, character));
      const ears = [scene.defaultEar, [scene.harbour[0], 2, scene.harbour[1]], [scene.weir[0], 3, scene.weir[1]], scene.saddle, [scene.clearing[0], 2, scene.clearing[1]]] as const;
      for (const ear of ears) for (const hour of [3, 6, 12, 19.4]) for (const weather of [STORM, { wind: 0, rain: 0, snow: 0, storm: 0, fog: 0, wet: 0 }, { wind: 0.6, rain: 0, snow: 1, storm: 0, fog: 1, wet: 0.2 }]) {
        for (const profile of ['kingdom', 'stream'] as const) {
          const space = sampleSpace(scene, resolveListener(scene, { position: ear, right: [1, 0, 0] }));
          const t = bedTargets(scene, weather, dayParts(hour), space, profile);
          const levels = [t.wind.level, t.wind.whistle, t.sea.left.level, t.sea.right.level, t.lap.level, t.river.level, t.river.rush.level, t.rain.level, t.foliage.level, t.crickets, t.grasshoppers, t.floor];
          for (const level of levels) { expect(Number.isFinite(level)).toBe(true); expect(level).toBeGreaterThanOrEqual(0); expect(level).toBeLessThan(1); }
          // Nothing can stack to a shout: the authored bed gains sum well under unity even in a storm on the beach.
          expect(levels.reduce((sum, level) => sum + level, 0)).toBeLessThan(2.2);
          expect(t.muffle).toBeGreaterThanOrEqual(3800);
          for (const pan of [t.sea.left.pan, t.sea.right.pan, t.lap.pan, t.river.pan, t.foliage.pan, t.wind.whistlePan]) expect(Math.abs(pan)).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('the layer on the host graph', () => {
  it('never makes, resumes or closes a context, and never touches context.destination', () => {
    const { context, soundscape } = setup();
    run(context, soundscape, 5);
    expect(context.resumed).toBe(0);
    expect(context.closed).toBe(0);
    expect(context.nodes.some(node => node.connections.has(context.destination))).toBe(false);
    expect(() => createGenesisSoundscape({ context: context as unknown as AudioContext, destination: new FakeContext().createGain() as unknown as AudioNode }, { recipe: COAST, landscapeId: land(COAST, 'coastal-harbour') })).toThrow(TypeError);
  });

  it('stays inside its source bounds through a long storm at the harbour', () => {
    const { context, soundscape } = setup();
    const harbour = describeGenesisSoundscape(COAST, land(COAST, 'coastal-harbour')).harbour;
    run(context, soundscape, 240, () => ({ weather: STORM, listener: { position: [harbour[0], 2, harbour[1]], right: [1, 0, 0] } }));
    const inspection = inspectGenesisSoundscape(soundscape);
    expect(inspection.peakBedSources).toBeLessThanOrEqual(BED_SOURCE_LIMIT);
    expect(inspection.peakCallSources).toBeLessThanOrEqual(CALL_LIMITS.sources);
    expect(context.peakLive).toBeLessThanOrEqual(BED_SOURCE_LIMIT + CALL_LIMITS.sources + 2);
    expect(inspection.played.thunder ?? 0).toBeGreaterThan(0);
    expect(inspection.beds).toEqual(expect.arrayContaining(['wind', 'seaLeft', 'seaRight', 'rain', 'lap']));
  });

  it('never plays the same take of a call twice in a row', () => {
    const { context, soundscape } = setup(RIVER, 'river-valley');
    run(context, soundscape, 300, t => ({ hour: 5 + (t / 300) * 18 }));
    const last = new Map<string, number>();
    const events = inspectGenesisSoundscape(soundscape).events.filter(event => event.outcome === 'played');
    expect(events.length).toBeGreaterThan(20);
    for (const event of events) {
      if (CALLS[event.call as keyof typeof CALLS].takes > 1) expect(event.take).not.toBe(last.get(event.call));
      last.set(event.call, event.take!);
    }
  });

  it('is deterministic: the same frames give the same calls at the same moments', () => {
    const a = setup(MOUNTAIN, 'mountain-pass'), b = setup(MOUNTAIN, 'mountain-pass');
    run(a.context, a.soundscape, 120, t => ({ hour: 6 + t / 30 }));
    run(b.context, b.soundscape, 120, t => ({ hour: 6 + t / 30 }));
    const events = (s: GenesisSoundscape) => inspectGenesisSoundscape(s).events;
    expect(events(a.soundscape).length).toBeGreaterThan(5);
    expect(events(a.soundscape)).toEqual(events(b.soundscape));
  });

  it('goes silent on mute, schedules nothing while muted and never replays muted time', () => {
    const { context, soundscape } = setup();
    run(context, soundscape, 20);
    soundscape.setMix({ muted: true });
    context.advance(0.05);
    expect(context.live()).toBe(0);
    const before = context.everStarted;
    const mutedFrom = context.currentTime;
    run(context, soundscape, 30);
    expect(context.everStarted).toBe(before);
    soundscape.setMix({ muted: false });
    const unmutedAt = context.currentTime;
    run(context, soundscape, 10, undefined, 20, t => BASE + (unmutedAt + t) * 1000);
    expect(context.live()).toBeGreaterThan(0);
    const replayed = inspectGenesisSoundscape(soundscape).events.filter(event => event.outcome === 'played' && event.at > mutedFrom + 0.5 && event.at < unmutedAt - 0.5);
    expect(replayed).toEqual([]);
  });

  it('stops everything at once when the browser suspends, and starts clean after', () => {
    const { context, soundscape } = setup(MOUNTAIN, 'mountain-pass');
    run(context, soundscape, 10, () => ({ weather: STORM }));
    expect(context.live()).toBeGreaterThan(0);
    context.setState('suspended');
    context.advance(0.001);
    expect(context.live()).toBe(0);
    const before = context.everStarted;
    run(context, soundscape, 5);
    expect(context.everStarted).toBe(before);
    context.setState('running');
    run(context, soundscape, 5);
    expect(context.live()).toBeGreaterThan(0);
  });

  it('does not repeat calls when the realm clock stands still or seeks back', () => {
    const { context, soundscape } = setup(RIVER, 'river-valley');
    run(context, soundscape, 30, () => ({ hour: 19.5 }), 20, () => BASE);
    const frozen = inspectGenesisSoundscape(soundscape).events.filter(event => event.outcome === 'played');
    // A frozen realm schedules at most its one lookahead window.
    expect(frozen.every(event => event.at <= BASE / 1000 + 1.3)).toBe(true);
    const counts = new Map<string, number>();
    for (const event of frozen) counts.set(`${event.call}@${event.at}`, (counts.get(`${event.call}@${event.at}`) ?? 0) + 1);
    expect([...counts.values()].every(n => n === 1)).toBe(true);
    const seek = setup(RIVER, 'river-valley');
    run(seek.context, seek.soundscape, 60, () => ({ hour: 19.5 }));
    run(seek.context, seek.soundscape, 30, () => ({ hour: 19.5 }), 20, t => BASE + 10_000 + t * 1000);
    expect(seek.context.peakLive).toBeLessThanOrEqual(BED_SOURCE_LIMIT + CALL_LIMITS.sources + 2);
  });

  it('cross-fades to another landscape when the ceremony redraws', () => {
    const { context, destination, soundscape } = setup();
    run(context, soundscape, 10);
    expect(inspectGenesisSoundscape(soundscape).character).toBe('coastal-harbour');
    expect(() => soundscape.select('elsewhere')).toThrow(RangeError);
    const coast = [...context.started];
    soundscape.select(land(COAST, 'mountain-pass'));
    // A second into the redraw the coast is still heard, fading through its own space beside the mountain's.
    run(context, soundscape, 1);
    const reaches = (node: Node, seen = new Set<Node>()): boolean => node === destination
      || [...node.connections].some(next => !seen.has(next) && (seen.add(next), reaches(next, seen)));
    expect(coast.some(source => !source.ended && reaches(source))).toBe(true);
    run(context, soundscape, 5);
    const inspection = inspectGenesisSoundscape(soundscape);
    expect(inspection.character).toBe('mountain-pass');
    expect(inspection.beds).not.toContain('lap');
    run(context, soundscape, 2);
    // The old land's sources have all stopped once its fade is over.
    expect(context.live()).toBeLessThanOrEqual(inspectGenesisSoundscape(soundscape).bedSources + inspectGenesisSoundscape(soundscape).callSources + 1);
  });

  it('ducks and returns, and the stream profile sits lower with a deeper speech pocket', () => {
    const { context, soundscape } = setup();
    run(context, soundscape, 2);
    soundscape.duck({ depthDb: 12, seconds: 1 });
    const ducks = context.nodes.filter((node): node is GainNode => node instanceof GainNode && node.gain.events.some(([kind, value]) => kind === 'target' && Math.abs(value - 10 ** (-12 / 20)) < 1e-9));
    expect(ducks.length).toBe(1);
    expect(ducks[0]!.gain.target).toBe(1);
    soundscape.setMix({ profile: 'stream' });
    const peaking = context.nodes.find((node): node is FilterNode => node instanceof FilterNode && node.type === 'peaking')!;
    expect(peaking.gain.target).toBe(-5);
    // The layer master now heads for volume² × the stream trim (−5 dB).
    expect(context.nodes.some(node => node instanceof GainNode && Math.abs(node.gain.target - 10 ** (-5 / 20)) < 1e-6)).toBe(true);
  });

  it('lets go of everything it made on dispose, and only that', () => {
    const { context, destination, soundscape } = setup();
    run(context, soundscape, 15, () => ({ weather: STORM }));
    soundscape.dispose();
    context.advance(0.01);
    expect(context.live()).toBe(0);
    expect(context.listenerCount).toBe(0);
    expect(destination.disconnected).toBe(0);
    const owned = context.nodes.filter(node => node !== destination && node !== context.destination);
    expect(owned.every(node => node.connections.size === 0)).toBe(true);
    const before = context.everStarted;
    soundscape.update({ realmMs: BASE + 99_000, hour: 12 });
    soundscape.setMix({ muted: false });
    soundscape.duck();
    expect(context.everStarted).toBe(before);
  });
});
