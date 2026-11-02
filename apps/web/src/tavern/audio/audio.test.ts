import { describe, expect, it } from 'vitest';
import type { DiceView, GatherFrame, GatherTableView, PongView, StonesView } from '@chatdom/shared';
import { createTavernSound, createTavernSoundGraph, TAVERN_SOUND_LIMITS, type TavernSoundHost } from './index';
import { TavernObserver, type TavernCue } from './observer';
import { tavernMaterial } from './materials';

class Param {
  value = 0;
  events: { value: number; at: number }[] = [];
  setTargetAtTime(value: number, at: number) { this.events.push({ value, at }); }
  setValueAtTime(value: number, at: number) { this.value = value; this.events.push({ value, at }); }
  cancelScheduledValues(at: number) { this.events = this.events.filter(event => event.at < at); }
  cancelAndHoldAtTime(at: number) { this.cancelScheduledValues(at); }
}
class Node {
  connections = new Set<Node>();
  disconnected = 0;
  constructor(readonly context: Context) { context.nodes.push(this); }
  connect(target: Node) { this.connections.add(target); return target; }
  disconnect() { this.connections.clear(); this.disconnected++; }
}
class Source extends Node {
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  end = Infinity;
  startAt = -1;
  started = false;
  start(at: number) { if (this.started) throw new Error('double start'); this.startAt = at; this.started = true; this.context.sources.add(this); }
  stop(at: number) { if (!this.started) throw new Error('stop before start'); this.end = at; }
}
class Context {
  currentTime = 0;
  sampleRate = 48000;
  state: AudioContextState = 'running';
  nodes: Node[] = [];
  sources = new Set<Source>();
  listeners = new Set<() => void>();
  peak = 0;
  destination = new Node(this);
  createGain() { return Object.assign(new Node(this), { gain: new Param() }); }
  createStereoPanner() { return Object.assign(new Node(this), { pan: new Param() }); }
  createBufferSource() { return new Source(this); }
  createBuffer(channels: number, length: number, rate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / rate, sampleRate: rate, length, numberOfChannels: channels, getChannelData: (channel: number) => data[channel]! };
  }
  addEventListener(_name: string, callback: () => void) { this.listeners.add(callback); }
  removeEventListener(_name: string, callback: () => void) { this.listeners.delete(callback); }
  advance(delta: number) {
    this.peak = Math.max(this.peak, this.active);
    this.currentTime += delta;
    for (const source of [...this.sources]) if (source.end <= this.currentTime) { this.sources.delete(source); source.onended?.(); }
  }
  get active() { return [...this.sources].filter(source => source.end > this.currentTime).length; }
  setState(state: AudioContextState) { this.state = state; for (const listener of [...this.listeners]) listener(); }
}
const places = { hearth: [0, 0, -4] as const, tables: [{ id: 'middle', centre: [0, 1, 0] as const }] };
const listener = { feet: [0, 0, 2] as const, forward: [0, 0, -1] as const };
const table = (patch: Partial<GatherTableView> = {}): GatherTableView => ({ table: 'middle', revision: 0, seats: ['A', 'B'], pong: null, ...patch });
const frame = (at: number, patch: Partial<GatherTableView> = {}): GatherFrame => ({ at, tables: [table(patch)] });
const pong = (patch: Partial<PongView> = {}): PongView => ({ match: 'pong-1', phase: 'rally', tick: 1, at: 1000 + ((patch.tick ?? 1) - 1) * 33, serveAt: 0,
  ball: { x: 0, y: 0, vx: 0, vy: 0 }, paddles: [0, 0], acknowledged: [0, 0], score: [0, 0], winner: null, reason: null, ...patch });
const stone = (patch: Partial<StonesView> = {}): StonesView => ({ match: 'stone-1', phase: 'playing', revision: 0,
  board: Array<number>(42).fill(0), turn: 0, deadline: 30000, winner: null, reason: null, last: null, winning: [], ...patch });
const dice = (patch: Partial<DiceView> = {}): DiceView => ({ match: 'dice-1', phase: 'playing', revision: 0,
  scores: [0, 0], active: [true, true], turn: 0, pot: 0, die: null, deadline: 30000, winner: null, reason: null, last: null, ...patch });
const cues = (observer: TavernObserver, observation: GatherFrame, now = observation.at, seated: string | null = null) => observer.step(observation, now, seated).attacks.map(attack => attack.cue);

describe('public tavern sound observations', () => {
  it('baselines first snapshots, deduplicates actual contacts, and never infers a bounce', () => {
    const observer = new TavernObserver();
    const contact = { sequence: 1, tick: 1, at: 1000, kind: 'paddle' as const, x: .4, y: 1.35 };
    expect(cues(observer, frame(1000, { pong: pong({ contacts: [contact] }) }))).toEqual([]);
    const next = frame(1033, { pong: pong({ tick: 2, contacts: [contact, { ...contact, sequence: 2, tick: 2, at: 1030, kind: 'rail' }] }) });
    const observed = observer.step(next, next.at, null);
    expect(observed.attacks.map(attack => attack.cue)).toEqual(['rail']);
    expect(observed.attacks[0]!.at).toBe(1030);
    expect(cues(observer, next)).toEqual([]);
    expect(cues(observer, frame(1066, { pong: pong({ tick: 3, ball: { x: 1, y: -1, vx: -4, vy: 4 } }) }))).toEqual([]);
    expect(cues(observer, frame(1100, { pong: pong({ tick: 4, contacts: [{ ...contact, sequence: 3, tick: 4, at: 400 }] }) }))).toEqual([]);
  });
  it('ages contacts on the fixed-step Pong clock when its epoch trails the room heartbeat', () => {
    const observer = new TavernObserver();
    observer.step(frame(10_000, { pong: pong({ at: 1000, tick: 1 }) }), 0, null);
    const next = frame(10_033, { pong: pong({ at: 1033, tick: 2,
      contacts: [{ sequence: 1, tick: 2, at: 1030, kind: 'paddle', x: 0, y: 1.35 }] }) });
    expect(cues(observer, next, 33)).toEqual(['paddle']);
  });
  it('skips frame gaps, stale observations, backwards clocks and reconnect history', () => {
    const observer = new TavernObserver();
    cues(observer, frame(1000, { pong: pong() }));
    expect(cues(observer, frame(3000, { pong: pong({ tick: 31, score: [1, 0] }) }))).toEqual([]);
    observer.reset();
    expect(cues(observer, frame(2033, { pong: pong({ tick: 32, score: [2, 0] }) }))).toEqual([]);
    for (let now = 2066; now < 4000; now += 33) cues(observer, frame(2033, { pong: pong() }), now);
    expect(cues(observer, frame(2066, { pong: pong({ tick: 33, score: [3, 0] }) }), 4000)).toEqual([]);
    expect(cues(observer, frame(2050, { pong: pong({ tick: 34, score: [4, 0] }) }), 3990)).toEqual([]);
  });
  it('ignores backwards deliveries without rebasing contact or freshness watermarks', () => {
    const observer = new TavernObserver();
    const contact = (sequence: number) => ({ sequence, tick: sequence, at: 1000 + (sequence - 1) * 33,
      kind: 'paddle' as const, x: 0, y: 1.35 });
    const observation = (sequence: number) => frame(contact(sequence).at, { pong: pong({ tick: sequence,
      contacts: Array.from({ length: sequence }, (_, index) => contact(index + 1)) }) });
    const first = observation(1), second = observation(2), third = observation(3);
    expect(cues(observer, first, 0)).toEqual([]);
    expect(cues(observer, second, 33)).toEqual(['paddle']);
    expect(cues(observer, first, 66)).toEqual([]);
    // Re-delivery of the accepted frame must not replay contact 2, or overwrite the local seated baseline.
    expect(cues(observer, second, 99)).toEqual([]);
    expect(cues(observer, third, 132)).toEqual(['paddle']);
    for (const now of [165, 330, 495, 630, 795, 960, 1125, 1290, 1455, 1620]) {
      const rejected = observer.step(first, now, 'middle');
      expect(rejected.attacks).toEqual([]);
      expect(rejected.fresh).toBe(true);
    }
    const stale = observer.step(first, 1633, 'middle');
    expect(stale.attacks).toEqual([]); expect(stale.fresh).toBe(false);
    // A fresh frame after that expired observation establishes a silent baseline, including its seat.
    expect(cues(observer, observation(4), 1666, 'middle')).toEqual([]);
    expect(cues(observer, observation(5), 1699, 'middle')).toEqual(['paddle']);
  });
  it('hears same-millisecond authoritative advances once and ignores older same-at revisions', () => {
    const observer = new TavernObserver(), at = 1000;
    const first = frame(at, { revision: 1, dice: dice() });
    const next = frame(at, { revision: 2, dice: dice({ revision: 1, last: 'roll', die: 4, pot: 4 }) });
    expect(cues(observer, first, 0)).toEqual([]);
    expect(cues(observer, next, 10)).toEqual(['dice']);
    expect(cues(observer, first, 20)).toEqual([]);
    expect(cues(observer, next, 30)).toEqual([]);
    expect(cues(observer, frame(at, { revision: 3, dice: dice({ revision: 2, last: 'hold', scores: [4, 0] }) }), 40)).toEqual(['bank']);
    const pongObserver = new TavernObserver();
    cues(pongObserver, frame(at, { pong: pong() }), 0);
    const contact = { sequence: 1, tick: 2, at, kind: 'rail' as const, x: 1, y: 0 };
    const tick = frame(at, { pong: pong({ tick: 2, contacts: [contact] }) });
    expect(cues(pongObserver, tick, 10)).toEqual(['rail']);
    expect(cues(pongObserver, tick, 20)).toEqual([]);
  });
  it('only clacks one legal stone at exactly the next revision', () => {
    const observer = new TavernObserver(), board = Array<number>(42).fill(0);
    cues(observer, frame(1000, { stones: stone() }));
    board[0] = 1;
    const move = stone({ revision: 1, board, last: { column: 0, row: 0, seat: 0 }, turn: 1 });
    expect(cues(observer, frame(1033, { stones: move }))).toEqual(['stone']);
    // The host may mutate its original buffer; the observer retained the witnessed board.
    board[1] = 2;
    expect(cues(observer, frame(1066, { stones: stone({ ...move, revision: 2, last: { column: 1, row: 0, seat: 1 }, turn: 0 }) }))).toEqual(['stone']);
    const illegal = [...board]; illegal[14] = 1;
    expect(cues(observer, frame(1100, { stones: stone({ revision: 3, board: illegal, last: { column: 0, row: 2, seat: 0 } }) }))).toEqual([]);
    expect(cues(observer, frame(1133, { stones: stone({ revision: 5, board: illegal }) }))).toEqual([]);
  });
  it('sounds explicit roll/bust/hold, never timeout, repeated revision or skipped turns', () => {
    const observer = new TavernObserver();
    cues(observer, frame(1000, { dice: dice() }));
    expect(cues(observer, frame(1033, { dice: dice({ revision: 1, last: 'roll', die: 4, pot: 4 }) }))).toEqual(['dice']);
    expect(cues(observer, frame(1066, { dice: dice({ revision: 2, last: 'bust', die: 1, turn: 1 }) }))).toEqual(['dice']);
    expect(cues(observer, frame(1100, { dice: dice({ revision: 3, last: 'hold', scores: [0, 8] }) }))).toEqual(['bank']);
    expect(cues(observer, frame(1133, { dice: dice({ revision: 4, last: 'timeout' }) }))).toEqual([]);
    expect(cues(observer, frame(1166, { dice: dice({ revision: 4, last: 'roll', die: 6 }) }))).toEqual([]);
    expect(cues(observer, frame(1200, { dice: dice({ revision: 7, last: 'roll', die: 6 }) }))).toEqual([]);
  });
  it('distinguishes actually observed starts, single points, finishes and seat transitions', () => {
    const observer = new TavernObserver();
    cues(observer, frame(1000));
    expect(cues(observer, frame(1033, { pong: pong({ phase: 'serve' }) }), 1033, 'middle')).toEqual(['sit', 'start']);
    expect(cues(observer, frame(1066, { pong: pong({ tick: 2, score: [1, 0] }) }), 1066, 'middle')).toEqual(['point']);
    expect(cues(observer, frame(1100, { pong: pong({ tick: 3, score: [3, 0] }) }), 1100, 'middle')).toEqual([]);
    expect(cues(observer, frame(1133, { pong: pong({ tick: 4, score: [3, 0], phase: 'finished', winner: 0, reason: 'conceded' }) }))).toEqual(['stand', 'finish']);
  });
  it('sounds a witnessed concession without a physics tick, once even within one millisecond', () => {
    for (const at of [1000, 1033]) {
      const observer = new TavernObserver();
      cues(observer, frame(1000, { pong: pong({ tick: 12 }) }), 0);
      const conceded = frame(at, { pong: pong({ tick: 12, phase: 'finished', winner: 1, reason: 'conceded' }) });
      expect(cues(observer, conceded, 33)).toEqual(['finish']);
      expect(cues(observer, conceded, 66)).toEqual([]);
    }
  });
});

function setup() {
  const context = new Context(), destination = context.createGain();
  const host: TavernSoundHost = { context: context as unknown as AudioContext, destination: destination as unknown as AudioNode };
  let available = true;
  const sound = createTavernSound(() => available ? host : null, places);
  const update = (at: number, patch: Partial<GatherTableView> = {}, overrides = {}) => sound.update({
    frame: frame(at, patch), connected: true, visible: true, now: at, walkers: 2, listener, seated: null, ...overrides,
  });
  return { context, destination, host, sound, update, mute: () => { available = false; }, unmute: () => { available = true; } };
}

describe('owned tavern audio graph and host lifecycle', () => {
  it('witnesses consecutive transport revisions even when no scene frame occurs between heartbeats', () => {
    const s = setup();
    s.update(1000, { dice: dice() });
    s.context.advance(1);
    s.update(2000, { dice: dice({ revision: 1, last: 'roll', die: 4, pot: 4 }) });
    expect(s.sound.inspect().played.dice).toBe(1);
    s.context.advance(1);
    s.update(3000, { dice: dice({ revision: 2, last: 'hold', scores: [4, 0] }) });
    expect(s.sound.inspect().played.bank).toBe(1);
    s.sound.dispose();
    expect(s.context.active).toBe(0);
  });
  it('holds the hearth through one-second idle heartbeats and hears a turn after 700ms thinking', () => {
    const s = setup();
    let publicFrame = frame(1000, { dice: dice() });
    for (let now = 0; now <= 2400; now += 10) {
      if (now === 700) publicFrame = frame(1700, { dice: dice({ revision: 1, last: 'roll', die: 4, pot: 4 }) });
      if (now === 1000) publicFrame = frame(2000, { dice: dice({ revision: 1, last: 'roll', die: 4, pot: 4 }) });
      if (now === 1700) publicFrame = frame(2700, { dice: dice({ revision: 2, last: 'hold', scores: [4, 0] }) });
      if (now === 2000) publicFrame = frame(3000, { dice: dice({ revision: 2, last: 'hold', scores: [4, 0] }) });
      s.sound.update({ frame: publicFrame, connected: true, visible: true, now, walkers: 1, listener, seated: null });
      expect(s.sound.inspect().audible).toBe(true);
      expect(s.sound.inspect().played.hearth).toBe(1);
      s.context.advance(.01);
    }
    expect(s.sound.inspect().played.dice).toBe(1); expect(s.sound.inspect().played.bank).toBe(1);
    // Repeated presentation of the last snapshot does not replace a missing heartbeat indefinitely.
    for (let now = 2410; now <= 3510; now += 10) {
      s.sound.update({ frame: publicFrame, connected: true, visible: true, now, walkers: 1, listener, seated: null });
      s.context.advance(.01);
    }
    expect(s.sound.inspect().activeSources).toBe(0);
    s.sound.dispose();
  });
  it('replaces a host with complete teardown and a silent new observation baseline', () => {
    const oldContext = new Context(), nextContext = new Context();
    const oldDestination = oldContext.createGain(), nextDestination = nextContext.createGain();
    let host: TavernSoundHost = { context: oldContext as unknown as AudioContext, destination: oldDestination as unknown as AudioNode };
    const sound = createTavernSound(() => host, places);
    const update = (revision: number) => sound.update({ frame: frame(1000 + revision * 33, { dice: dice({ revision, last: 'roll', die: 4 }) }),
      connected: true, visible: true, now: revision * 33, walkers: 3, listener, seated: null });
    update(0); update(1);
    expect(sound.inspect().played.dice).toBe(1);
    host = { context: nextContext as unknown as AudioContext, destination: nextDestination as unknown as AudioNode };
    update(2);
    expect(oldContext.active).toBe(0); expect(oldContext.listeners.size).toBe(0);
    expect(oldDestination.disconnected).toBe(0);
    expect(sound.inspect().played.dice).toBe(1);
    update(3); expect(sound.inspect().played.dice).toBe(2);
    sound.dispose(); expect(nextContext.active).toBe(0); expect(nextContext.listeners.size).toBe(0);
    expect(nextDestination.disconnected).toBe(0);
  });
  it('cancels pending presentation-aligned contacts as well as sounding tails', () => {
    const s = setup();
    const mappings: { table: string; at: number; now: number }[] = [];
    s.update(1000, { pong: pong() });
    s.update(1033, { pong: pong({ tick: 2, contacts: [{ sequence: 1, tick: 2, at: 1033, kind: 'paddle', x: 0, y: 1.35 }] }) }, {
      pongContactDelay(table: string, at: number, now: number) { mappings.push({ table, at, now }); return .02; },
    });
    expect(s.sound.inspect().played.paddle).toBe(1);
    expect(mappings).toEqual([{ table: 'middle', at: 1033, now: 1033 }]);
    expect([...s.context.sources].some(source => Math.abs(source.startAt - s.context.currentTime - .026) < 1e-8)).toBe(true);
    s.sound.quiet();
    expect(s.context.active).toBe(0);
    s.context.advance(.2);
    expect(s.context.active).toBe(0);
    s.sound.dispose();
  });
  it('never replays game history after locked/muted/hidden/disconnected intervals', () => {
    const s = setup();
    s.update(1000, { dice: dice() });
    s.update(1033, { dice: dice({ revision: 1, last: 'roll', die: 2 }) });
    expect(s.sound.inspect().played.dice).toBe(1);
    s.mute(); s.update(1066, { dice: dice({ revision: 2, last: 'roll', die: 4 }) });
    expect(s.context.active).toBe(0);
    s.unmute(); s.update(1100, { dice: dice({ revision: 3, last: 'roll', die: 5 }) });
    expect(s.sound.inspect().played.dice).toBe(1);
    for (const flag of ['visible', 'connected']) {
      s.update(1133, { dice: dice({ revision: 4, last: 'roll', die: 6 }) }, { [flag]: false });
      expect(s.context.active).toBe(0);
      s.update(1166, { dice: dice({ revision: 5, last: 'roll', die: 6 }) });
      expect(s.sound.inspect().played.dice).toBe(1);
    }
    s.sound.dispose();
  });
  it('bounds real source overlap, ducks ambience, and watchdog-stops every bed without host updates', () => {
    const context = new Context(), destination = context.createGain();
    const graph = createTavernSoundGraph({ context: context as unknown as BaseAudioContext, destination: destination as unknown as AudioNode }, places);
    graph.update(listener, 8);
    for (let i = 0; i < 120; i++) {
      graph.play('dice', places.tables[0]!.centre, listener); graph.update(listener, 8); context.advance(.003);
      expect(context.active).toBeLessThanOrEqual(TAVERN_SOUND_LIMITS.voices);
    }
    const seen = graph.inspect();
    expect(seen.dropped).toBeGreaterThan(0);
    expect(seen.peakSources).toBeLessThanOrEqual(TAVERN_SOUND_LIMITS.sources);
    expect(context.peak).toBeLessThanOrEqual(6);
    expect(context.nodes.some(node => 'gain' in node && (node as Node & { gain: Param }).gain.events.some(event => event.value === .42))).toBe(true);
    context.advance(2);
    expect(context.active).toBe(0);
    expect(graph.inspect().activeVoices).toBe(0);
    graph.dispose();
  });
  it('murmur follows only actual other walkers, sources pan by table and fade by distance', () => {
    const context = new Context(), destination = context.createGain();
    const graph = createTavernSoundGraph({ context: context as unknown as BaseAudioContext, destination: destination as unknown as AudioNode }, places);
    for (const walkers of [0, 1, NaN]) { graph.update(listener, walkers); expect(graph.inspect().murmur).toBe(0); expect(graph.inspect().activeSources).toBe(1); }
    graph.update(listener, 8); expect(graph.inspect().murmur).toBe(1); expect(graph.inspect().activeSources).toBe(2);
    graph.update(listener, 1); expect(graph.inspect().activeSources).toBe(1);
    graph.play('stone', [4, 1, 2], listener);
    const pans = context.nodes.filter(node => 'pan' in node) as (Node & { pan: Param })[];
    expect(pans.at(-1)!.pan.events.at(-1)!.value).toBeGreaterThan(0);
    const gains = context.nodes.filter(node => 'gain' in node) as (Node & { gain: Param })[];
    const rightLevel = gains.at(-1)!.gain.events.at(-1)!.value;
    graph.play('stone', [-10, 1, 2], listener);
    const leftPan = (context.nodes.at(-1)! as Node & { pan: Param }).pan;
    expect(leftPan.events.at(-1)!.value).toBeLessThan(0);
    const allGains = context.nodes.filter(node => 'gain' in node) as (Node & { gain: Param })[];
    expect(allGains.at(-1)!.gain.events.at(-1)!.value).toBeLessThan(rightLevel);
    graph.dispose();
  });
  it('quiet, suspension and disposal stop all tails, preserve host nodes and detach listeners', () => {
    const s = setup();
    s.update(1000); s.sound.affordance('middle');
    expect(s.sound.inspect().played.wood).toBe(1);
    s.context.setState('suspended');
    expect(s.context.active).toBe(0); expect(s.context.listeners.size).toBe(0);
    s.context.setState('running'); s.update(1033); s.sound.affordance('middle');
    expect(s.sound.inspect().played.wood).toBe(2);
    s.sound.quiet(); expect(s.context.active).toBe(0);
    s.update(1066); s.sound.dispose(); s.sound.dispose();
    expect(s.context.active).toBe(0); expect(s.context.listeners.size).toBe(0);
    expect(s.destination.disconnected).toBe(0); expect(s.context.destination.disconnected).toBe(0);
    for (const node of s.context.nodes) if (node !== s.destination && node !== s.context.destination) expect(node.connections.size).toBe(0);
    s.sound.affordance(null); s.update(1100);
    expect(s.sound.inspect().disposed).toBe(true); expect(s.context.active).toBe(0);
  });
  it('materials are finite, conservative and never identical in consecutive variations', () => {
    const context = new Context();
    const materials: TavernCue[] = ['paddle', 'rail', 'stone', 'dice', 'bank', 'start', 'point', 'finish', 'sit', 'stand', 'wood'];
    for (const cue of materials) {
      const variants = Array.from({ length: 4 }, (_, variant) => tavernMaterial(context as unknown as BaseAudioContext, cue, variant).getChannelData(0));
      for (let i = 0; i < variants.length; i++) {
        expect(variants[i]).not.toEqual(variants[(i + 1) % 4]);
        expect(variants[i]!.every(value => Number.isFinite(value) && Math.abs(value) < .9)).toBe(true);
        expect(variants[i]!.some(value => Math.abs(value) > .01)).toBe(true);
      }
    }
  });
});
