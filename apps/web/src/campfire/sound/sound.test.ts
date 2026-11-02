import { describe, expect, it } from 'vitest';
import type { CampfireFrame, DuskCourtPlayerView, DuskCourtView } from '@chatdom/shared';
import { campfireDarkness, campfireReach, createCampfireSound, createCampfireSoundGraph, CAMPFIRE_SOUND_LIMITS, type CampfireSoundHost } from './index';
import { CampfireObserver } from './observer';
import { campfireMaterial, CAMPFIRE_CUES, type CampfireCue } from './materials';

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
  sampleRate = 8000;
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
  get loops() { return [...this.sources].filter(source => source.loop && source.end > this.currentTime).length; }
  setState(state: AudioContextState) { this.state = state; for (const listener of [...this.listeners]) listener(); }
}

const place = { fire: [0, 0, 0] as const };
const near = { feet: [0, 0, 2.5] as const, forward: [0, 0, -1] as const };
const NIGHT = 22, NOON = 12;

/** A player whose role cannot be read: any cue that depends on a card throws. */
function player(seat: number, patch: Partial<Omit<DuskCourtPlayerView, 'role'>> = {}): DuskCourtPlayerView {
  const view = { seat, name: `Player${seat}`, lantern: 'lit', away: false, gone: false, embers: 0, voted: false, ...patch } as Omit<DuskCourtPlayerView, 'role'>;
  return Object.defineProperty(view, 'role', { enumerable: true, get() { throw new Error('a role was read'); } }) as DuskCourtPlayerView;
}
function court(patch: Partial<DuskCourtView> = {}): DuskCourtView {
  return { match: 'round-1', revision: 0, phase: 'call', night: 1, startedAt: 1000, deadline: 11_000, waiting: false, wolves: 1,
    players: [1, 2, 3, 4, 5].map(seat => player(seat)), dawn: null, verdict: null, result: null, ...patch };
}
function frame(at: number, view: DuskCourtView | null): CampfireFrame {
  return { at, site: 'clearing', live: true, magistrate: null, seated: [1, 2, 3, 4, 5].map(seat => ({ seat, name: `Player${seat}` })), court: view };
}

/** One whole round as public frames, one revision apart, with the cue each should sound. */
function round(match = 'round-1'): { frame: CampfireFrame; cues: CampfireCue[] }[] {
  let revision = 0, at = 1000;
  const step = (patch: Partial<DuskCourtView>, cues: CampfireCue[]) => ({ frame: frame(at += 500, court({ match, revision: revision++, ...patch })), cues });
  const snuffed = [player(1), player(2, { lantern: 'snuffed' }), player(3), player(4), player(5)];
  const embers = (seat: number, value: 1 | 2 | 3) => snuffed.map(p => p.seat === seat ? player(seat, { embers: value, lantern: p.lantern }) : p);
  const dawn1 = { night: 1, seat: 2 }, verdict1 = { night: 1, seat: 4, tie: false, votes: 4 };
  const sent = snuffed.map(p => p.seat === 4 ? player(4, { lantern: 'sent' }) : p);
  return [
    step({ phase: 'call' }, ['ask']),
    step({ phase: 'call', players: [1, 2, 3, 4, 5, 6].map(seat => player(seat)) }, []),
    step({ phase: 'deal' }, ['deal']),
    step({ phase: 'night' }, ['night']),
    step({ phase: 'dawn', players: snuffed, dawn: dawn1 }, ['snuff']),
    step({ phase: 'dawn', players: embers(3, 3), dawn: dawn1 }, ['ember']),
    step({ phase: 'talk', players: embers(3, 3), dawn: dawn1 }, []),
    step({ phase: 'ballot', players: embers(3, 3), dawn: dawn1 }, ['ballot']),
    step({ phase: 'ballot', players: embers(3, 3).map(p => p.seat === 1 ? player(1, { voted: true }) : p), dawn: dawn1 }, []),
    step({ phase: 'verdict', players: sent, dawn: dawn1, verdict: verdict1 }, ['sent']),
    step({ phase: 'night', night: 2, players: sent, dawn: dawn1, verdict: verdict1 }, ['night']),
    step({ phase: 'dawn', night: 2, players: sent, dawn: { night: 2, seat: null }, verdict: verdict1 }, ['dawn']),
    step({ phase: 'talk', night: 2, players: sent, dawn: { night: 2, seat: null }, verdict: verdict1 }, []),
    step({ phase: 'ballot', night: 2, players: sent, dawn: { night: 2, seat: null }, verdict: verdict1 }, ['ballot']),
    step({ phase: 'verdict', night: 2, players: sent, dawn: { night: 2, seat: null }, verdict: { night: 2, seat: null, tie: true, votes: 4 } }, ['spared']),
    step({ phase: 'ended', night: 2, players: sent, dawn: { night: 2, seat: null }, verdict: { night: 2, seat: null, tie: true, votes: 4 },
      result: { winner: 'town', reason: 'caught' } }, ['town']),
  ];
}

describe('public Dusk Court observations', () => {
  it('sounds each witnessed transition exactly once, never replays a duplicate, and never reads a role', () => {
    const observer = new CampfireObserver();
    expect(observer.step(frame(1000, null), 0)).toEqual([]);
    let now = 0;
    for (const { frame: next, cues } of round()) {
      expect(observer.step(next, now += 100)).toEqual(cues);
      expect(observer.step(next, now += 100)).toEqual([]);
      expect(observer.step({ ...next, at: next.at + 1 }, now += 100)).toEqual([]);
    }
  });
  it('hears the Wolves win and the circle leaving as the public result says', () => {
    const observer = new CampfireObserver();
    observer.step(frame(1000, court({ phase: 'talk', revision: 8 })), 0);
    expect(observer.step(frame(1100, court({ phase: 'ended', revision: 9, result: { winner: 'wolves', reason: 'outnumbered' } })), 50)).toEqual(['wolves']);
    const left = new CampfireObserver();
    left.step(frame(1000, court({ phase: 'night', revision: 4 })), 0);
    expect(left.step(frame(1100, court({ phase: 'ended', revision: 5, result: { winner: null, reason: 'left' } })), 50)).toEqual([]);
    // A dawn that ends the round sounds both its snuff and the end.
    const last = new CampfireObserver();
    last.step(frame(1000, court({ phase: 'night', revision: 4 })), 0);
    expect(last.step(frame(1100, court({ phase: 'ended', revision: 5, dawn: { night: 1, seat: 3 }, result: { winner: 'wolves', reason: 'outnumbered' } })), 50)).toEqual(['snuff', 'wolves']);
  });
  it('first observations, revision gaps and new matches met late are silent baselines', () => {
    const steps = round(), observer = new CampfireObserver();
    // Joining while a call is already on: no ask.
    expect(observer.step(steps[0]!.frame, 0)).toEqual([]);
    expect(observer.step(steps[2]!.frame, 10)).toEqual([]);
    expect(observer.step(steps[3]!.frame, 20)).toEqual(['night']);
    // Revision 3 to 5 skips 4: the snuff and the ember are history.
    expect(observer.step(steps[5]!.frame, 30)).toEqual([]);
    expect(observer.step(steps[6]!.frame, 40)).toEqual([]);
    expect(observer.step(steps[7]!.frame, 50)).toEqual(['ballot']);
    // A different match first seen at night is a baseline; one first seen in its call is a real ask.
    expect(observer.step(frame(20_000, court({ match: 'round-2', phase: 'night', revision: 3 })), 60)).toEqual([]);
    expect(observer.step(frame(21_000, null), 70)).toEqual([]);
    expect(observer.step(frame(22_000, court({ match: 'round-3', phase: 'call', revision: 0 })), 80)).toEqual(['ask']);
    const watching = new CampfireObserver();
    expect(watching.step(frame(20_000, null), 0)).toEqual([]);
    expect(watching.step(frame(21_000, court({ match: 'round-3', phase: 'call', revision: 2 })), 50)).toEqual(['ask']);
    expect(watching.step(frame(30_000, court({ match: 'round-3', phase: 'ended', revision: 30, result: { winner: 'town', reason: 'caught' } })), 100)).toEqual([]);
    expect(watching.step(frame(31_000, court({ match: 'round-4', phase: 'call', revision: 0 })), 150)).toEqual(['ask']);
  });
  it('ignores older deliveries without moving its watermark, and treats a local gap as an interruption', () => {
    const steps = round(), observer = new CampfireObserver();
    observer.step(frame(1000, null), 0);
    expect(observer.step(steps[0]!.frame, 10)).toEqual(['ask']);
    expect(observer.step(steps[1]!.frame, 20)).toEqual([]);
    expect(observer.step(steps[2]!.frame, 30)).toEqual(['deal']);
    expect(observer.step(steps[1]!.frame, 40)).toEqual([]);
    expect(observer.step(steps[0]!.frame, 50)).toEqual([]);
    expect(observer.step(steps[2]!.frame, 60)).toEqual([]);
    expect(observer.step(steps[3]!.frame, 70)).toEqual(['night']);
    // The page was hidden for two seconds: the dawn that arrives with the return is not announced.
    expect(observer.step(steps[4]!.frame, 2100)).toEqual([]);
    expect(observer.step(steps[5]!.frame, 2200)).toEqual(['ember']);
    // A null frame (disconnected) forgets everything; the reconnect frame is a baseline.
    expect(observer.step(null, 2300)).toEqual([]);
    expect(observer.step(steps[7]!.frame, 2400)).toEqual([]);
    expect(observer.step(steps[9]!.frame, 2500)).toEqual([]);
    expect(observer.step(steps[10]!.frame, 2600)).toEqual(['night']);
  });
  it('rate-limits the Gallery ember tick and drops the excess instead of queueing it', () => {
    const observer = new CampfireObserver();
    let revision = 10, at = 5000, now = 0;
    const talk = (embers: Record<number, 0 | 1 | 2 | 3>) => frame(at += 10, court({ phase: 'talk', revision: revision++,
      players: [1, 2, 3, 4, 5].map(seat => player(seat, { embers: embers[seat] ?? 0 })) }));
    observer.step(talk({}), now);
    expect(observer.step(talk({ 2: 3 }), now += 100)).toEqual(['ember']);
    expect(observer.step(talk({ 2: 3, 4: 1 }), now += 100)).toEqual([]);
    expect(observer.step(talk({ 2: 3, 4: 2 }), now += 100)).toEqual([]);
    expect(observer.step(talk({ 2: 3, 4: 2 }), now += 100)).toEqual([]);
    expect(observer.step(talk({ 2: 2, 4: 3 }), now += 200)).toEqual(['ember']);
    expect(observer.step(talk({ 2: 1, 4: 3 }), now + 600)).toEqual([]);
  });
});

function setup(listener = near) {
  const context = new Context(), destination = context.createGain();
  const host: CampfireSoundHost = { context: context as unknown as BaseAudioContext, destination: destination as unknown as AudioNode };
  let available = true, hour = NIGHT, now = 0;
  const sound = createCampfireSound(() => available ? host : null, place);
  const update = (view: CampfireFrame | null, step = 16) => { sound.update(view, { now: now += step, hour, listener }); context.advance(step / 1000); };
  return { context, destination, sound, update, mute: () => { available = false; }, unmute: () => { available = true; },
    setHour: (value: number) => { hour = value; } };
}

describe('owned campfire audio graph and host lifecycle', () => {
  it('starts the beds only with a host, and stops them on a null host, quiet and the watchdog', () => {
    const s = setup();
    s.mute(); s.update(null);
    expect(s.context.active).toBe(0); expect(s.context.nodes.length).toBe(2);
    s.unmute(); s.update(null);
    expect(s.context.loops).toBe(3);
    // Muting fades the beds out over a few milliseconds instead of cutting them mid-wave (a click).
    s.mute(); s.update(null);
    const fading = s.context.nodes.filter(node => 'gain' in node) as (Node & { gain: Param })[];
    expect(fading.some(node => node.gain.events.at(-1)?.value === 0)).toBe(true);
    expect([...s.context.sources].every(source => source.end > s.context.currentTime && source.end <= s.context.currentTime + CAMPFIRE_SOUND_LIMITS.fade)).toBe(true);
    s.context.advance(CAMPFIRE_SOUND_LIMITS.fade + .001);
    expect(s.context.active).toBe(0);
    s.unmute(); s.update(null); expect(s.context.loops).toBe(3);
    s.sound.quiet(); s.context.advance(CAMPFIRE_SOUND_LIMITS.fade + .001); expect(s.context.active).toBe(0);
    s.update(null); expect(s.context.loops).toBe(3);
    // A stalled host: no further renewals, no timers. The beds fade and stop on their own.
    s.context.advance(CAMPFIRE_SOUND_LIMITS.watchdog + .01);
    expect(s.context.active).toBe(0);
    s.sound.dispose();
  });
  it('the night is silent at noon and present at 22:00; the fire burns either way', () => {
    expect(campfireDarkness(12)).toBe(0); expect(campfireDarkness(9)).toBe(0); expect(campfireDarkness(15.5)).toBe(0);
    expect(campfireDarkness(22)).toBeGreaterThan(.85); expect(campfireDarkness(2)).toBeGreaterThan(.8);
    expect(campfireDarkness(19.5)).toBeGreaterThan(.5); expect(campfireDarkness(NaN)).toBe(0);
    const s = setup();
    s.setHour(NOON); s.update(null);
    expect(s.sound.inspect().beds).toEqual({ fire: 1, night: 0 });
    expect(s.context.loops).toBe(2);
    s.setHour(NIGHT); s.update(null);
    expect(s.sound.inspect().beds.night).toBeGreaterThan(.85);
    expect(s.context.loops).toBe(3);
    s.sound.dispose();
  });
  it('is full within four metres of the fire and gone by twenty-five, panned to the fire', () => {
    expect(campfireReach(0)).toBe(1); expect(campfireReach(4)).toBe(1);
    expect(campfireReach(12)).toBeGreaterThan(campfireReach(18));
    expect(campfireReach(22)).toBeLessThan(.03); expect(campfireReach(25)).toBe(0); expect(campfireReach(NaN)).toBe(0);
    const context = new Context(), destination = context.createGain();
    const graph = createCampfireSoundGraph({ context: context as unknown as BaseAudioContext, destination: destination as unknown as AudioNode }, place);
    graph.update({ feet: [30, 0, 0], forward: [0, 0, -1] }, NIGHT);
    expect(context.active).toBe(0);
    graph.play('town', { feet: [30, 0, 0], forward: [0, 0, -1] });
    expect(graph.inspect().played.town).toBeUndefined();
    // Standing east of the fire facing north, the fire is to the left.
    graph.update({ feet: [10, 0, 0], forward: [0, 0, -1] }, NIGHT);
    const pans = context.nodes.filter(node => 'pan' in node) as (Node & { pan: Param })[];
    expect(pans[0]!.pan.events.at(-1)!.value).toBeLessThan(0);
    expect(graph.inspect().beds.fire).toBeCloseTo(campfireReach(10));
    graph.dispose();
  });
  it('sounds a scripted round once each through the live layer, with duplicates and repeated renders', () => {
    const s = setup();
    s.update(frame(500, null));
    const expected: Record<string, number> = {};
    for (const { frame: next, cues } of round()) {
      for (let i = 0; i < 4; i++) s.update(next);
      for (const cue of cues) expected[cue] = (expected[cue] ?? 0) + 1;
      s.context.advance(4);
      s.update(next);
    }
    expect(s.sound.inspect().played).toEqual(expected);
    expect(Object.keys(expected).sort()).toEqual(['ask', 'ballot', 'dawn', 'deal', 'ember', 'night', 'sent', 'snuff', 'spared', 'town']);
    s.sound.dispose();
  });
  it('the night cue ducks the fire and swells; tap needs an admitted host and stays local', () => {
    const s = setup(), steps = round();
    s.update(frame(500, null));
    for (const index of [0, 1, 2, 3]) s.update(steps[index]!.frame);
    expect(s.sound.inspect().played).toEqual({ ask: 1, deal: 1, night: 1 });
    const gains = s.context.nodes.filter(node => 'gain' in node) as (Node & { gain: Param })[];
    expect(gains.some(node => node.gain.events.some(event => event.value === .62))).toBe(true);
    s.sound.confirm();
    expect(s.sound.inspect().played.tap).toBe(1);
    s.sound.quiet(); s.sound.confirm();
    expect(s.sound.inspect().played.tap).toBe(1);
    s.mute(); s.update(steps[4]!.frame); s.sound.confirm();
    expect(s.sound.inspect().played.tap).toBe(1);
    s.sound.dispose();
  });
  it('never replays history after a muted or reconnected interval', () => {
    const s = setup(), steps = round();
    s.update(frame(500, null)); s.update(steps[0]!.frame);
    expect(s.sound.inspect().played.ask).toBe(1);
    s.mute(); s.update(steps[1]!.frame); s.update(steps[2]!.frame);
    s.unmute(); s.update(steps[2]!.frame); s.update(steps[3]!.frame);
    expect(s.sound.inspect().played.deal).toBeUndefined();
    expect(s.sound.inspect().played.night).toBe(1);
    s.update(null); s.update(steps[5]!.frame);
    expect(s.sound.inspect().played.ember).toBeUndefined();
    s.update(steps[6]!.frame); s.update(steps[7]!.frame);
    expect(s.sound.inspect().played.ballot).toBe(1);
    s.sound.dispose();
  });
  it('bounds cue voices and total sources; overload drops new voices', () => {
    const context = new Context(), destination = context.createGain();
    const graph = createCampfireSoundGraph({ context: context as unknown as BaseAudioContext, destination: destination as unknown as AudioNode }, place);
    graph.update(near, NIGHT);
    for (let i = 0; i < 120; i++) {
      graph.play(CAMPFIRE_CUES[i % CAMPFIRE_CUES.length]!, near); graph.update(near, NIGHT); context.advance(.004);
      expect(context.active).toBeLessThanOrEqual(CAMPFIRE_SOUND_LIMITS.sources);
      expect(graph.inspect().voices).toBeLessThanOrEqual(CAMPFIRE_SOUND_LIMITS.voices);
    }
    const seen = graph.inspect();
    expect(seen.dropped).toBeGreaterThan(0);
    expect(seen.peakVoices).toBe(CAMPFIRE_SOUND_LIMITS.voices);
    expect(context.peak).toBeLessThanOrEqual(CAMPFIRE_SOUND_LIMITS.sources);
    context.advance(5);
    expect(context.active).toBe(0); expect(graph.inspect().sources).toBe(0);
    graph.dispose();
  });
  it('quiet, suspension, host replacement and dispose stop everything, detach listeners and keep the host nodes', () => {
    const s = setup(), steps = round();
    s.update(frame(500, null)); s.update(steps[0]!.frame);
    s.context.setState('suspended');
    expect(s.context.active).toBe(0); expect(s.context.listeners.size).toBe(0);
    s.update(steps[1]!.frame); expect(s.context.active).toBe(0);
    s.context.setState('running'); s.update(steps[1]!.frame); s.update(steps[2]!.frame);
    expect(s.sound.inspect().played.deal).toBe(1);
    s.sound.dispose(); s.sound.dispose();
    s.context.advance(CAMPFIRE_SOUND_LIMITS.fade + .001);
    expect(s.context.active).toBe(0); expect(s.context.listeners.size).toBe(0);
    expect(s.destination.disconnected).toBe(0); expect(s.context.destination.disconnected).toBe(0);
    for (const node of s.context.nodes) if (node !== s.destination && node !== s.context.destination) expect(node.connections.size).toBe(0);
    s.update(steps[3]!.frame); s.sound.confirm();
    expect(s.sound.inspect().disposed).toBe(true); expect(s.context.active).toBe(0);
    expect(s.sound.inspect().played).toEqual({ ask: 1, deal: 1 });

    const first = new Context(), second = new Context();
    const firstOut = first.createGain(), secondOut = second.createGain();
    let host: CampfireSoundHost = { context: first as unknown as BaseAudioContext, destination: firstOut as unknown as AudioNode };
    const sound = createCampfireSound(() => host, place);
    sound.update(null, { now: 0, hour: NIGHT, listener: near });
    expect(first.loops).toBe(3);
    host = { context: second as unknown as BaseAudioContext, destination: secondOut as unknown as AudioNode };
    sound.update(null, { now: 16, hour: NIGHT, listener: near });
    first.advance(CAMPFIRE_SOUND_LIMITS.fade + .001);
    expect(first.active).toBe(0); expect(first.listeners.size).toBe(0); expect(firstOut.disconnected).toBe(0);
    expect(second.loops).toBe(3);
    sound.dispose(); second.advance(CAMPFIRE_SOUND_LIMITS.fade + .001); expect(second.active).toBe(0); expect(second.listeners.size).toBe(0);
  });
  it('materials are finite, bounded and differ between consecutive variants; beds loop without a step', () => {
    const context = new Context();
    for (const cue of CAMPFIRE_CUES) {
      const variants = Array.from({ length: 4 }, (_, variant) => campfireMaterial(context as unknown as BaseAudioContext, cue, variant).getChannelData(0));
      for (let i = 0; i < variants.length; i++) {
        expect(variants[i]).not.toEqual(variants[(i + 1) % 4]);
        expect(variants[i]!.every(value => Number.isFinite(value) && Math.abs(value) <= .9)).toBe(true);
        expect(variants[i]!.some(value => Math.abs(value) > .1)).toBe(true);
      }
    }
    for (const bed of ['flame', 'crackle', 'air'] as const) {
      const data = campfireMaterial(context as unknown as BaseAudioContext, bed, 0).getChannelData(0);
      expect(data.every(value => Number.isFinite(value) && Math.abs(value) <= .9)).toBe(true);
      let step = 0;
      for (let i = 1; i < data.length; i++) step = Math.max(step, Math.abs(data[i]! - data[i - 1]!));
      // The seam is no larger than the bed's own sample-to-sample movement.
      expect(Math.abs(data[0]! - data.at(-1)!)).toBeLessThanOrEqual(step);
    }
  });
});
