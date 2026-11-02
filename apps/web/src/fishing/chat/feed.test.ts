import { describe, expect, it } from 'vitest';
import type { PierFeedEvent, PierFeedLine } from '@chatdom/shared';
import { createPierFeedState, parsePierFeedEvent, pierRetryDelay, pierWatchUrl, watchPierFeed, PIER_FULL_GAP_MS, type PierEventSourceLike } from './feed';

const who = { name: 'Juniper', slot: 4, colour: '#ffb347' };
const line = (id: string, phase: PierFeedLine['phase'] = 'float', extra: Partial<PierFeedLine> = {}): PierFeedLine =>
  ({ id, who, via: 'chat', phase, float: [10, 2, 30], at: 1000, ...extra });
const caught = (id: string, at = 2000): PierFeedEvent => ({ kind: 'caught', at, id, who, via: 'chat',
  fish: { speciesId: 'fish:copper-perch', lengthMm: 340, weightG: 812 }, kingdomFirst: true, keepsake: 1, float: [10, 2, 30] });

describe('pier feed payloads', () => {
  it('accepts every kind the realm sends, rebuilt without stray fields', () => {
    const events: PierFeedEvent[] = [
      { kind: 'lines', at: 1, lines: [line('a')], cap: 8 },
      { kind: 'line', at: 1, line: line('a', 'bite') },
      caught('a'),
      { kind: 'caught', at: 1, id: 'w', who: { name: null, slot: null, colour: null }, via: 'pier', fish: { speciesId: 'fish:bell-minnow', lengthMm: 90, weightG: 12 }, kingdomFirst: false, keepsake: null, float: null },
      { kind: 'broken', at: 1, id: 'b', who, speciesId: 'fish:goldscale-emperor', float: [0, 0, 0] },
      { kind: 'gone', at: 1, id: 'g', reason: 'escaped' },
      { kind: 'full', at: 1, who, cap: 8 },
    ];
    for (const event of events) expect(parsePierFeedEvent(JSON.parse(JSON.stringify(event)))).toEqual(event);
    expect(parsePierFeedEvent({ ...events[5], personId: '1001' })).not.toHaveProperty('personId');
    expect(parsePierFeedEvent({ kind: 'line', at: 1, line: { ...line('a'), personId: '7' } })).toEqual({ kind: 'line', at: 1, line: line('a') });
  });

  it('drops anything malformed, whole', () => {
    const bad: unknown[] = [
      null, 'lines', [], { kind: 'nope', at: 1 }, { kind: 'gone', at: -1, id: 'a', reason: 'escaped' },
      { kind: 'gone', at: 1, id: '', reason: 'escaped' }, { kind: 'gone', at: 1, id: 'a', reason: 'eaten' },
      { kind: 'line', at: 1, line: line('a', 'float', { float: [1, Number.NaN, 2] as never }) },
      { kind: 'line', at: 1, line: line('a', 'float', { float: [1, 2] as never }) },
      { kind: 'line', at: 1, line: { ...line('a'), phase: 'leaping' } },
      { kind: 'line', at: 1, line: { ...line('a'), who: { ...who, colour: 'red' } } },
      { kind: 'line', at: 1, line: { ...line('a'), who: { ...who, slot: 1.5 } } },
      { kind: 'line', at: 1, line: { ...line('a'), who: { ...who, name: 'x'.repeat(65) } } },
      { kind: 'lines', at: 1, cap: 8, lines: [line('a'), { ...line('b'), via: 'web' }] },
      { kind: 'lines', at: 1, cap: 0, lines: [] },
      { ...caught('a'), keepsake: 0 }, { ...caught('a'), fish: { speciesId: 'fish:x', lengthMm: 0, weightG: 3 } },
      { ...caught('a'), kingdomFirst: 'yes' }, { ...caught('a'), float: [1, 2, 'x'] },
      { kind: 'broken', at: 1, id: 'b', who, speciesId: 'fish:goldscale-emperor', float: null },
      { kind: 'full', at: 1, who, cap: 1.5 },
    ];
    for (const value of bad) expect(parsePierFeedEvent(value), JSON.stringify(value)).toBeNull();
  });

  it('keeps a hidden name hidden and never lets control characters through', () => {
    const parsed = (name: string | null) => (parsePierFeedEvent({ kind: 'full', at: 1, who: { ...who, name }, cap: 8 }) as Extract<PierFeedEvent, { kind: 'full' }>).who.name;
    expect(parsed(null)).toBeNull();
    expect(parsed('   ')).toBeNull();
    expect(parsed('Ju‮niper\u0007 ')).toBe('Juniper');
    expect(parsePierFeedEvent({ kind: 'full', at: 1, who: { ...who, colour: '#FFB347' }, cap: 8 })).toMatchObject({ who: { colour: '#ffb347' } });
  });
});

describe('the pier feed reducer', () => {
  it('replaces lines from a snapshot, quietly', () => {
    const state = createPierFeedState();
    state.apply({ kind: 'lines', at: 1, lines: [line('a'), line('b')], cap: 8 });
    expect([...state.lines().keys()]).toEqual(['a', 'b']);
    expect(state.cap()).toBe(8);
    expect(state.drain().map(beat => [beat.kind, beat.kind === 'line' && beat.quiet])).toEqual([['line', true], ['line', true]]);
    state.apply({ kind: 'lines', at: 2, lines: [line('b', 'bite'), line('c')], cap: 8 });
    expect([...state.lines().keys()]).toEqual(['b', 'c']);
    const beats = state.drain();
    expect(beats[0]).toMatchObject({ kind: 'gone', id: 'a', reason: 'cleared', quiet: true });
    expect(beats[1]).toMatchObject({ kind: 'line', line: { id: 'b', phase: 'bite' }, previous: { phase: 'float' }, quiet: true });
    expect(beats[2]).toMatchObject({ kind: 'line', line: { id: 'c' }, previous: null });
    expect(state.drain()).toEqual([]);
  });

  it('upserts lines, ignores repeats and walker lines', () => {
    const state = createPierFeedState();
    expect(state.apply({ kind: 'line', at: 1, line: line('a') })).toBe(true);
    expect(state.apply({ kind: 'line', at: 2, line: line('a') })).toBe(false);
    expect(state.apply({ kind: 'line', at: 3, line: line('a', 'fight') })).toBe(true);
    expect(state.apply({ kind: 'line', at: 3, line: line('a', 'fight', { who: { ...who, name: null } }) })).toBe(true);
    expect(state.apply({ kind: 'line', at: 3, line: line('w', 'float', { via: 'pier' }) })).toBe(false);
    expect(state.lines().get('a')?.who.name).toBeNull();
    expect(state.lines().has('w')).toBe(false);
    expect(state.drain().map(beat => beat.kind === 'line' ? [beat.previous?.phase ?? null, beat.line.phase] : null)).toEqual([[null, 'float'], ['float', 'fight'], ['fight', 'fight']]);
  });

  it('removes a line when it is caught, broken or gone, once', () => {
    const state = createPierFeedState();
    for (const id of ['a', 'b', 'c']) state.apply({ kind: 'line', at: 1, line: line(id) });
    state.drain();
    expect(state.apply(caught('a'))).toBe(true);
    expect(state.apply(caught('a'))).toBe(false);
    expect(state.apply({ kind: 'broken', at: 3, id: 'b', who, speciesId: 'fish:goldscale-emperor', float: [1, 2, 3] })).toBe(true);
    expect(state.apply({ kind: 'gone', at: 3, id: 'c', reason: 'snapped' })).toBe(true);
    expect(state.apply({ kind: 'gone', at: 4, id: 'c', reason: 'cleared' })).toBe(false);
    expect(state.apply({ kind: 'line', at: 5, line: line('a') })).toBe(false);
    expect(state.lines().size).toBe(0);
    const beats = state.drain();
    expect(beats.map(beat => beat.kind)).toEqual(['caught', 'broken', 'gone']);
    expect(beats[0]).toMatchObject({ line: { id: 'a' } });
    expect(beats[2]).toMatchObject({ reason: 'snapped', quiet: false, line: { id: 'c' } });
  });

  it('passes a walker catch through with no line', () => {
    const state = createPierFeedState();
    state.apply({ ...caught('w'), via: 'pier', float: null } as PierFeedEvent);
    expect(state.drain()).toMatchObject([{ kind: 'caught', line: null, event: { via: 'pier' } }]);
  });

  it('shows the pier-full beat at most once per twenty seconds', () => {
    const state = createPierFeedState();
    const full = (at: number): PierFeedEvent => ({ kind: 'full', at, who, cap: 8 });
    expect(state.apply(full(10_000))).toBe(true);
    expect(state.apply(full(15_000))).toBe(false);
    expect(state.apply(full(10_000 + PIER_FULL_GAP_MS - 1))).toBe(false);
    expect(state.apply(full(10_000 + PIER_FULL_GAP_MS))).toBe(true);
    expect(state.drain().filter(beat => beat.kind === 'full')).toHaveLength(2);
  });
});

class FakeSource implements PierEventSourceLike {
  readyState = 0;
  closed = false;
  listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: { data?: unknown }) => void) { (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(listener); }
  removeEventListener(type: string, listener: (event: { data?: unknown }) => void) { this.listeners.get(type)?.delete(listener); }
  close() { this.closed = true; }
  emit(type: string, data?: unknown) { for (const listener of [...this.listeners.get(type) ?? []]) listener({ data }); }
}

function harness() {
  const sources: FakeSource[] = [], timers = new Map<number, { run: () => void; ms: number }>(), events: PierFeedEvent[] = [];
  let next = 1;
  const watch = watchPierFeed('123', event => events.push(event), {
    eventSource: url => { const source = new FakeSource(url); sources.push(source); return source; },
    random: () => .5,
    setTimer: (run, ms) => { const id = next++; timers.set(id, { run, ms }); return id; },
    clearTimer: id => { timers.delete(id as number); },
  });
  const fire = () => { const [id, timer] = [...timers][0]!; timers.delete(id); timer.run(); return timer.ms; };
  return { sources, timers, events, watch, fire };
}

describe('watching the pier', () => {
  it('opens the public route and hands on well-formed events only', () => {
    const { sources, events } = harness();
    expect(sources).toHaveLength(1);
    expect(sources[0]!.url).toBe('/api/realm/pier/watch/123');
    sources[0]!.emit('pier', JSON.stringify({ kind: 'line', at: 1, line: line('a') }));
    expect(events).toHaveLength(0);
    sources[0]!.emit('pier', JSON.stringify({ kind: 'lines', at: 1, lines: [], cap: 8 }));
    sources[0]!.emit('pier', '{not json');
    sources[0]!.emit('pier', JSON.stringify({ kind: 'line', at: 1, line: { ...line('a'), float: 'out there' } }));
    sources[0]!.emit('pier', JSON.stringify({ kind: 'line', at: 1, line: line('a') }));
    sources[0]!.emit('pier', 42);
    expect(events.map(event => event.kind)).toEqual(['lines', 'line']);
  });

  it('reconnects with a doubling, capped wait that resets once events flow', () => {
    const { sources, timers, fire } = harness();
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      sources.at(-1)!.emit('error');
      expect(sources.at(-1)!.closed).toBe(true);
      expect(timers.size).toBe(1);
      waits.push(fire());
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(sources).toHaveLength(9);
    sources.at(-1)!.emit('pier', JSON.stringify({ kind: 'lines', at: 1, lines: [], cap: 8 }));
    sources.at(-1)!.emit('error');
    expect(fire()).toBe(1000);
  });

  it('stops for good on dispose', () => {
    const { sources, timers, watch, events } = harness();
    sources[0]!.emit('error');
    expect(timers.size).toBe(1);
    watch.dispose();
    expect(timers.size).toBe(0);
    expect(sources[0]!.closed).toBe(true);
    const second = harness();
    second.watch.dispose();
    expect(second.sources[0]!.closed).toBe(true);
    expect(second.sources[0]!.listeners.get('pier')?.size ?? 0).toBe(0);
    second.sources[0]!.emit('pier', JSON.stringify({ kind: 'lines', at: 1, lines: [], cap: 8 }));
    expect(events).toHaveLength(0);
  });

  it('jitters within a quarter and refuses a bad kingdom', () => {
    for (let attempt = 0; attempt < 12; attempt++) for (const r of [0, .3, 1]) {
      const wait = pierRetryDelay(attempt, r);
      expect(wait).toBeGreaterThanOrEqual(750); expect(wait).toBeLessThanOrEqual(30_000);
    }
    expect(pierRetryDelay(0, 0)).toBe(750); expect(pierRetryDelay(0, 1)).toBe(1250); expect(pierRetryDelay(9, 1)).toBe(30_000);
    expect(pierWatchUrl('42', 'https://chatdom.gg/')).toBe('https://chatdom.gg/api/realm/pier/watch/42');
    expect(() => pierWatchUrl('../admin')).toThrow();
    expect(() => watchPierFeed('0', () => {})).toThrow();
  });
});
