import { describe, expect, it } from 'vitest';
import type { ForgePhase, ForgeRitualFrame } from '../../../shared/src/forge';
import { inspectForgeAudio } from './audio';
import { FORGE_AUDIO_LIMITS } from './budget';
import { FORGE_ATTACKS, FORGE_SPANS } from './conductor';
import { createForgeAudio } from './index';

/**
 * The Forge layer over time, against the real conductor, cues, budget and graph code. The fake context below only
 * keeps time, records automation and counts the source nodes that are started and not yet stopped — what Web Audio
 * would actually be running — so bounds are checked on the graph, not on the adapter's own bookkeeping.
 */
class Param {
  value: number;
  events: [string, number, number][] = [];
  constructor(value = 0) { this.value = value; }
  private log(kind: string, value: number, at: number) { this.events.push([kind, value, at]); return this; }
  setValueAtTime(value: number, at: number) { this.value = value; return this.log('set', value, at); }
  linearRampToValueAtTime(value: number, at: number) { return this.log('linear', value, at); }
  exponentialRampToValueAtTime(value: number, at: number) { if (!(value > 0)) throw new RangeError('exponential ramp to 0'); return this.log('exp', value, at); }
  setTargetAtTime(value: number, at: number, tau: number) { if (!(tau > 0)) throw new RangeError('tau'); return this.log('target', value, at); }
  setValueCurveAtTime(curve: Float32Array, at: number) { return this.log('curve', curve[curve.length - 1]!, at); }
  cancelScheduledValues(at: number) { return this.log('cancel', 0, at); }
  cancelAndHoldAtTime(at: number) { return this.log('hold', 0, at); }
  /** The last target this parameter was sent towards. */
  get target() { const e = [...this.events].reverse().find(([kind]) => kind === 'target' || kind === 'set'); return e ? e[1] : this.value; }
}

class Node {
  connections = new Set<Node>();
  disconnected = 0;
  constructor(readonly context: FakeContext) { context.nodes.push(this); }
  connect(target: Node) { this.connections.add(target); return target; }
  disconnect() { this.connections.clear(); this.disconnected++; }
}

class Source extends Node {
  onended: (() => void) | null = null;
  frequency = new Param(440);
  playbackRate = new Param(1);
  buffer: unknown = null;
  loop = false;
  type = 'sine';
  startAt = -1;
  stopAt = Infinity;
  ended = false;
  start(at = 0) {
    if (this.startAt >= 0) throw new Error('started twice');
    this.startAt = at; this.context.started.add(this);
  }
  stop(at = 0) {
    if (this.startAt < 0) throw new Error('stopped before start');
    if (this.ended) return;
    this.stopAt = at;
  }
}

class FakeContext {
  currentTime = 0;
  readonly sampleRate = 48000;
  state: AudioContextState = 'running';
  readonly nodes: Node[] = [];
  readonly started = new Set<Source>();
  readonly destination: Node;
  private listeners = new Set<() => void>();
  peakSources = 0;
  constructor() { this.destination = new Node(this); }

  /** Moves time on and ends every source whose stop time has passed, as the audio thread would. */
  advance(seconds: number) {
    if (this.state === 'running') this.currentTime += seconds;
    for (const source of [...this.started]) {
      if (source.stopAt <= this.currentTime && !source.ended) { source.ended = true; this.started.delete(source); source.onended?.(); }
    }
  }
  /** Sources that would be sounding (or waiting to) right now. */
  get live() { let n = 0; for (const s of this.started) if (!s.ended && s.stopAt > this.currentTime) n++; return n; }
  observe() { this.peakSources = Math.max(this.peakSources, this.live); }
  setState(state: AudioContextState) { this.state = state; for (const listener of this.listeners) listener(); }

  addEventListener(_: string, listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_: string, listener: () => void) { this.listeners.delete(listener); }
  get listening() { return this.listeners.size; }
  createGain() { return Object.assign(new Node(this), { gain: new Param(1) }); }
  createBiquadFilter() { return Object.assign(new Node(this), { type: 'lowpass', frequency: new Param(), Q: new Param(), gain: new Param() }); }
  createStereoPanner() { return Object.assign(new Node(this), { pan: new Param() }); }
  createDynamicsCompressor() {
    return Object.assign(new Node(this), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
  }
  createWaveShaper() { return Object.assign(new Node(this), { curve: null, oversample: 'none' }); }
  createConvolver() { return Object.assign(new Node(this), { buffer: null, normalize: true }); }
  createOscillator() { return new Source(this); }
  createBufferSource() { return new Source(this); }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c: number) => data[c]! };
  }
}

const SPANS = Object.entries(FORGE_SPANS) as [ForgePhase, readonly [number, number]][];
/** Main's local schedule, as `forgeRitualFrame` reports it; `gate` freezes the reported phase while time runs on. */
function frame(t: number, ritualId = 'test-ritual', gate: number | null = null): ForgeRitualFrame {
  const at = gate === null ? t : Math.min(t, gate);
  const [phase, [from, to]] = SPANS.find(([, [a, b]]) => at >= a && at < b) ?? SPANS[SPANS.length - 1]!;
  const progress = Math.min(1, (at - from) / (to - from));
  return { ritualId, phase, elapsed: t, phaseProgress: gate !== null && t >= gate && progress === 0 ? 1 : progress, duration: 21, source: 'simulated' };
}
/** A host loop: one update per rendered frame, `fps` frames a second, with the audio clock running alongside. */
function run(context: FakeContext, adapters: { update(frame: ForgeRitualFrame | null): void }[], from: number, to: number, fps: number, at: (t: number, i: number) => ForgeRitualFrame | null) {
  for (let t = from; t < to; t += 1 / fps) {
    adapters.forEach((adapter, i) => adapter.update(at(t, i)));
    context.observe();
    context.advance(1 / fps);
  }
}
function setup() {
  const context = new FakeContext(), destination = context.createGain();
  const audio = createForgeAudio({ context: context as unknown as AudioContext, destination: destination as unknown as AudioNode });
  audio.setMix({ muted: false, volume: .65 });
  return { context, destination, audio, inspect: () => inspectForgeAudio(audio) };
}
const playedOf = (inspection: ReturnType<typeof inspectForgeAudio>, cue: string) => inspection.played[cue] ?? 0;
const expected = (cue: string) => FORGE_ATTACKS.filter(a => a.cue === cue).length;

describe('Forge ritual sound', () => {
  it('hears every stage once at the observed moments, at 60 fps and on a slow 12 fps host', () => {
    for (const fps of [60, 12]) {
      const s = setup();
      run(s.context, [s.audio], 0, 22, fps, t => frame(t));
      const seen = s.inspect();
      for (const cue of ['gather', 'lock', 'stamp', 'swing', 'strike', 'quench', 'launch', 'land', 'creak']) expect(playedOf(seen, cue), `${cue} at ${fps} fps`).toBe(1);
      // Two contraction ticks closer than 50 ms are heard as one; nothing else is merged or lost at 60 fps.
      const merged = (cue: string) => seen.events.filter(e => e.cue === cue && e.outcome === 'coalesced').length;
      if (fps === 60) for (const cue of ['glint', 'bubble', 'tick', 'clank']) expect(playedOf(seen, cue) + merged(cue), cue).toBe(expected(cue));
      expect(merged('tick')).toBeLessThanOrEqual(1);
      expect(seen.events.filter(e => e.outcome === 'budget' || e.outcome === 'seek')).toEqual([]);
      // Landed and finished: no bed is kept alive on silence.
      expect(seen.bed).toBe(false);
      expect(seen.peakSources).toBeLessThanOrEqual(FORGE_AUDIO_LIMITS.sources);
      expect(s.context.peakSources).toBeLessThanOrEqual(FORGE_AUDIO_LIMITS.sources);
    }
  });

  it('a pending gate holds for thirty seconds: no strike, no repeated stamp, a bed that stays soft', () => {
    for (const gate of [5, 12.2, 9]) {
      const s = setup();
      run(s.context, [s.audio], 0, gate + 30, 30, t => frame(t, 'gated', gate));
      const seen = s.inspect();
      expect(playedOf(seen, 'strike')).toBe(0);
      expect(playedOf(seen, 'land')).toBe(0);
      expect(playedOf(seen, 'stamp')).toBe(gate >= 12.2 ? 1 : 0);
      expect(playedOf(seen, 'lock')).toBe(1);
      expect(seen.held).toBe(true);
      expect(seen.bed).toBe(true);
      // Only the soft held bed is left sounding: no stings pile up while the gate waits.
      const sounding = [...s.context.started].filter(source => !source.ended);
      expect(sounding.length).toBeLessThanOrEqual(2);
    }
  });

  it('a duplicate observation never strikes twice, and a seek skips the backlog instead of playing it', () => {
    const s = setup();
    run(s.context, [s.audio], 12, 12.4, 60, t => frame(t));
    for (let i = 0; i < 120; i++) { s.audio.update(frame(12.4)); s.context.advance(1 / 60); }
    expect(playedOf(s.inspect(), 'strike')).toBe(1);
    // Scrub forward over the cooling ticks, the flight and the arrival: nothing from the jump is heard.
    const before = s.inspect();
    s.audio.update(frame(19.6)); s.context.advance(1 / 60);
    const after = s.inspect();
    for (const cue of ['tick', 'quench', 'launch', 'land']) expect(playedOf(after, cue), cue).toBe(playedOf(before, cue));
    expect(after.events.filter(e => e.outcome === 'seek').map(e => e.cue)).toContain('land');
    // Scrubbing back re-arms what lies ahead: playing on from 11.9 strikes again, exactly once.
    s.audio.update(frame(11.9)); s.context.advance(1 / 60);
    run(s.context, [s.audio], 11.9 + 1 / 60, 13, 60, t => frame(t));
    expect(playedOf(s.inspect(), 'strike')).toBe(2);
  });

  it('mute and zero volume fall silent at once, stop owned sources, and never replay what was missed', () => {
    const s = setup();
    run(s.context, [s.audio], 11.8, 12.5, 60, t => frame(t));
    expect(s.context.live).toBeGreaterThan(0);
    const master = s.context.nodes.find(node => node.connections.has(s.context.nodes.find(n => 'curve' in n)!)) as unknown as { gain: Param };
    s.audio.setMix({ muted: true, volume: .65 });
    expect(master.gain.target).toBe(0);
    s.context.advance(.031);
    expect(s.context.live).toBe(0);
    // The landing happens while muted; unmuting afterwards never brings it back.
    run(s.context, [s.audio], 12.5, 19.2, 60, t => frame(t));
    expect(playedOf(s.inspect(), 'land')).toBe(0);
    expect(s.inspect().events.some(e => e.cue === 'land' && e.outcome === 'silent')).toBe(true);
    s.audio.setMix({ muted: false, volume: .65 });
    run(s.context, [s.audio], 19.2, 21, 60, t => frame(t));
    expect(playedOf(s.inspect(), 'land')).toBe(0);
    expect(master.gain.target).toBeCloseTo(.65 * .65, 5);
    // Zero and non-finite volumes are silence too.
    for (const volume of [0, Number.NaN, Infinity]) {
      s.audio.setMix({ muted: false, volume });
      expect(master.gain.target).toBe(0);
      expect(s.inspect().audible).toBe(false);
    }
    s.audio.setMix({ muted: false, volume: 3 });
    expect(master.gain.target).toBe(1);
  });

  it('a suspended context stops everything at once, queues nothing and renews the room', () => {
    const s = setup();
    run(s.context, [s.audio], 11.9, 12.45, 60, t => frame(t));
    const room = s.context.nodes.find(node => 'normalize' in node)!;
    s.context.setState('suspended');
    for (const source of s.context.started) expect(source.stopAt).toBeLessThanOrEqual(s.context.currentTime);
    expect(room.disconnected).toBeGreaterThan(0);
    // Frames keep arriving while suspended (the picture runs on): the cooling ticks and arrival are consumed silently.
    for (let t = 12.45; t < 19.5; t += 1 / 30) s.audio.update(frame(t));
    s.context.setState('running');
    run(s.context, [s.audio], 19.5, 21, 60, t => frame(t));
    const seen = s.inspect();
    expect(playedOf(seen, 'land')).toBe(0);
    expect(playedOf(seen, 'tick')).toBe(0);
    expect(seen.events.filter(e => e.outcome === 'silent').length).toBeGreaterThan(5);
    // Resumed on the landed stage: nothing is left sounding, not even an empty bed.
    expect(seen.voices).toBe(0);
  });

  it('two anvils share one bounded layer: a strike from each within 50 ms is heard once, and floods keep the strike', () => {
    const context = new FakeContext(), destination = context.createGain();
    const make = () => createForgeAudio({ context: context as unknown as AudioContext, destination: destination as unknown as AudioNode });
    const a = make(), b = make();
    run(context, [a, b], 0, 22, 60, (t, i) => frame(t - i * .02, `anvil-${i}`));
    const [ia, ib] = [inspectForgeAudio(a), inspectForgeAudio(b)];
    // Two whole ceremonies together lose nothing to the budget: only same-moment duplicates merge.
    expect([...ia.events, ...ib.events].filter(e => e.outcome === 'budget')).toEqual([]);
    expect(playedOf(ia, 'strike') + playedOf(ib, 'strike')).toBe(1);
    expect(ib.events.some(e => e.cue === 'strike' && e.outcome === 'coalesced')).toBe(true);
    expect(context.peakSources).toBeLessThanOrEqual(FORGE_AUDIO_LIMITS.sources);
    expect(ia.peakVoices).toBeLessThanOrEqual(FORGE_AUDIO_LIMITS.voices);
    // A flood of refusals and a third anvil's ticks against a strike in flight: the strike keeps sounding.
    const c = make();
    a.update(frame(12.3, 'flood-a')); context.advance(1 / 60);
    a.update(frame(12.38, 'flood-a'));
    const strikeSources = [...context.started].filter(source => !source.ended).length;
    for (let i = 0; i < 40; i++) { b.refusal({ kind: 'refusal', variant: (i % 3) as 0 | 1 | 2 }); c.update(frame(12.7 + i * .07, 'flood-c')); context.observe(); context.advance(.004); }
    expect(context.peakSources).toBeLessThanOrEqual(FORGE_AUDIO_LIMITS.sources);
    expect(inspectForgeAudio(a).layerVoices).toBeLessThanOrEqual(FORGE_AUDIO_LIMITS.voices);
    expect(inspectForgeAudio(a).voices).toBeGreaterThanOrEqual(1);
    expect(strikeSources).toBeGreaterThan(0);
    for (const adapter of [a, b, c]) adapter.dispose();
  });

  it('dispose stops and disconnects only owned nodes, detaches its listener and ignores later calls', () => {
    const s = setup();
    const hostOutput = s.destination as unknown as Node;
    run(s.context, [s.audio], 12, 12.6, 60, t => frame(t));
    expect(s.context.listening).toBe(1);
    s.audio.dispose();
    expect(s.context.listening).toBe(0);
    expect(hostOutput.disconnected).toBe(0);
    expect(s.context.destination.disconnected).toBe(0);
    s.context.advance(.001);
    expect(s.context.live).toBe(0);
    for (const node of s.context.nodes) if (node !== hostOutput && node !== s.context.destination) expect(node.connections.size, 'owned node left connected').toBe(0);
    s.audio.update(frame(19.4)); s.audio.refusal({ kind: 'refusal', variant: 0 }); s.audio.setMix({ muted: false, volume: 1 });
    expect(s.context.started.size).toBe(0);
    expect(() => createForgeAudio({ context: s.context as unknown as AudioContext, destination: new FakeContext().createGain() as unknown as AudioNode })).toThrow(/same context/);
  });
});
