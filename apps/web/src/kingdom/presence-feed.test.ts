import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, KingdomPresenceFrameSchema, PRESENCE_LEASE_MS, type KingdomPresenceFrame } from '@chatdom/shared';
import { PRESENCE_FIXTURES, WORLD_FIXTURE_KINGDOM, WORLD_FIXTURE_TIME } from '@chatdom/shared/world-fixtures';
import { generateKingdom } from '@chatdom/world';
import { createHeraldPresence, createSimulatedPresence } from './presence-feed';

describe('SIMULATED presence scenario', () => {
  const layout = generateKingdom({ seed: 'lanternmere', tier: 'town', firstYear: 2022, year: 2026 });

  it('starts dark, names the first arrival at one second and ripples through actual home slots', () => {
    const simulation = createSimulatedPresence(layout);
    const frames: KingdomPresenceFrame[] = [];
    const unavailable = vi.fn();
    const unsubscribe = simulation.feed.subscribe(frame => frames.push(frame), unavailable);
    expect(simulation.feed.label).toBe('SIMULATED');
    expect(simulation.firstSlot).toBe(layout.homes.find(home => home.quarterYear === 2026 && home.position[0] > 0)!.slot);
    expect(frames.at(-1)!.windows.every(window => !window.present)).toBe(true);
    simulation.advance(0.999);
    expect(frames).toHaveLength(1);
    simulation.advance(1);
    expect(frames.at(-1)!.windows.filter(window => window.present)).toEqual([
      { slot: simulation.firstSlot, present: true, publicName: 'Juniper', since: WORLD_FIXTURE_TIME + 1000 },
    ]);
    simulation.advance(4);
    expect(frames.at(-1)!.windows.filter(window => window.present)).toHaveLength(1);
    expect(simulation.completeAt).toBeLessThanOrEqual(20);
    simulation.advance(simulation.completeAt);
    const complete = frames.at(-1)!;
    expect(complete.windows.every(window => window.present)).toBe(true);
    expect(complete.windows).toHaveLength(layout.homes.length);
    expect(complete.windows.some(window => window.publicName === null)).toBe(true);
    expect(complete.epoch).toMatch(/^simulation:/);
    expect(KingdomPresenceFrameSchema.safeParse(complete).success).toBe(true);
    expect(JSON.stringify(complete)).not.toContain('personId');
    expect(unavailable).not.toHaveBeenCalled();
    unsubscribe();
    const length = frames.length;
    simulation.reset();
    expect(frames).toHaveLength(length);
  });

  it('samples presentation time without inventing a later arrival or private evidence', () => {
    const simulation = createSimulatedPresence(layout);
    const frames:KingdomPresenceFrame[]=[];
    simulation.feed.subscribe(frame=>frames.push(frame),vi.fn());
    simulation.advance(1,true);
    const arrival=frames.at(-1)!;
    simulation.advance(1.175,true);
    const sample=frames.at(-1)!;
    expect(sample.asOf).toBe(WORLD_FIXTURE_TIME+1175);
    expect(sample.windows).toEqual(arrival.windows);
    expect(sample.windows.find(window=>window.present)!.since).toBe(WORLD_FIXTURE_TIME+1000);
    expect(sample.sequence).toBeGreaterThan(arrival.sequence);
    expect(KingdomPresenceFrameSchema.safeParse(sample).success).toBe(true);
  });

  it('uses sixty-second reducer heartbeats to keep a complete roster fresh beyond both leases', () => {
    const simulation = createSimulatedPresence(layout);
    const frames: KingdomPresenceFrame[] = [];
    simulation.feed.subscribe(frame => frames.push(frame), vi.fn());
    simulation.advance(20);
    const arrived = frames.at(-1)!;
    simulation.advance(600);
    const sustained = frames.at(-1)!;
    expect(sustained).toMatchObject({ streamLive: true, connection: 'fresh', origin: 'simulated', asOf: WORLD_FIXTURE_TIME + 600_000 });
    expect(sustained.windows).toEqual(arrived.windows);
    expect(sustained.sequence).toBeGreaterThan(arrived.sequence);
  });

  it('replays backward seeks deterministically while preserving transport sequence order', () => {
    const simulation = createSimulatedPresence(layout);
    const frames: KingdomPresenceFrame[] = [];
    simulation.feed.subscribe(frame => frames.push(frame), vi.fn());
    simulation.advance(1);
    const first = frames.at(-1)!;
    simulation.advance(120);
    simulation.advance(1);
    expect(frames.at(-1)!.windows).toEqual(first.windows);
    expect(frames.at(-1)!.asOf).toBe(first.asOf);
    expect(frames.at(-1)!.sequence).toBeGreaterThan(first.sequence);
    simulation.reset();
    expect(frames.at(-1)!.windows.every(window => !window.present)).toBe(true);
    for (let i = 1; i < frames.length; i++) expect(frames[i]!.sequence).toBeGreaterThan(frames[i - 1]!.sequence);
  });

  it('produces the same presence for stepped playback and a direct seek', () => {
    const jumped = createSimulatedPresence(layout), stepped = createSimulatedPresence(layout);
    let jumpFrame: KingdomPresenceFrame, stepFrame: KingdomPresenceFrame;
    jumped.feed.subscribe(frame => { jumpFrame = frame; }, vi.fn());
    stepped.feed.subscribe(frame => { stepFrame = frame; }, vi.fn());
    jumped.advance(180);
    for (let seconds = 0; seconds <= 180; seconds += 0.5) stepped.advance(seconds);
    expect(jumpFrame!.windows).toEqual(stepFrame!.windows);
    expect(jumpFrame!.asOf).toBe(stepFrame!.asOf);
  });

  it('rejects invalid or unbounded seeks before changing the published scenario', () => {
    const simulation = createSimulatedPresence(layout);
    const receive = vi.fn();
    simulation.feed.subscribe(receive, vi.fn());
    simulation.advance(1);
    const count = receive.mock.calls.length;
    for (const at of [-1, Infinity, Number.NaN, 1_000_000_000]) expect(() => simulation.advance(at)).toThrow();
    expect(receive).toHaveBeenCalledTimes(count);
    expect(() => createSimulatedPresence({ ...layout, homes: [] })).toThrow();
  });
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent<string>) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  close = vi.fn();
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  open() { this.onopen?.(new Event('open')); }
  send(value: unknown) { this.raw(JSON.stringify(value)); }
  raw(data: string) { this.onmessage?.({ data } as MessageEvent<string>); }
  error() { this.onerror?.(new Event('error')); }
}

function liveFrame(sequence = 1, epoch = 'herald:one', override: Partial<KingdomPresenceFrame> = {}): KingdomPresenceFrame {
  const asOf = override.asOf ?? Date.now();
  return {
    ...PRESENCE_FIXTURES.public, origin: 'live', sequence, epoch, asOf,
    windows: [{ ...PRESENCE_FIXTURES.public.windows[0]!, since: asOf }], ...override,
  };
}

describe('Herald public SSE adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(WORLD_FIXTURE_TIME);
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('delivers only strict live frames for the expected kingdom and invokes unavailable on invalid ingress', () => {
    const receive = vi.fn(), unavailable = vi.fn();
    const feed = createHeraldPresence('/presence-data/stream', WORLD_FIXTURE_KINGDOM);
    const unsubscribe = feed.subscribe(receive, unavailable);
    const source = FakeEventSource.instances[0]!;
    expect(feed.label).toBe('LIVE');
    expect(source.url).toBe('/presence-data/stream');
    source.open();
    expect(receive).not.toHaveBeenCalled();
    source.send({ ...liveFrame(), origin: 'simulated' });
    source.send({ ...liveFrame(), kingdomId: KingdomIdSchema.parse('12') });
    source.send({ ...liveFrame(), privateId: 'not-public' });
    source.raw('{broken');
    expect(receive).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledTimes(1);
    source.send(liveFrame());
    expect(receive).toHaveBeenCalledWith(liveFrame());
    unsubscribe();
    expect(source.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('locks an unspecified kingdom after the first valid frame and never changes epochs inside a connection', () => {
    const receive = vi.fn(), unavailable = vi.fn();
    const unsubscribe = createHeraldPresence().subscribe(receive, unavailable);
    const source = FakeEventSource.instances[0]!;
    source.open();
    source.send(liveFrame());
    source.send(liveFrame(2, 'herald:one', { kingdomId: KingdomIdSchema.parse('12') }));
    source.send(liveFrame(1, 'herald:two'));
    expect(receive).toHaveBeenCalledTimes(1);
    expect(unavailable).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('accepts explicitly configured SIMULATED Herald frames without weakening origin or replay guards', () => {
    const receive = vi.fn(), unavailable = vi.fn();
    const feed = createHeraldPresence('/presence-data/stream', WORLD_FIXTURE_KINGDOM, 'simulated');
    expect(feed.label).toBe('SIMULATED');
    const stop = feed.subscribe(receive, unavailable);
    const source = FakeEventSource.instances[0]!; source.open();
    source.send(liveFrame(1));
    expect(receive).not.toHaveBeenCalled();
    source.send(liveFrame(1, 'herald:replay', { origin: 'simulated' }));
    source.send(liveFrame(1, 'herald:replay', { origin: 'simulated' }));
    source.send(liveFrame(2, 'herald:replay', { origin: 'simulated', kingdomId: KingdomIdSchema.parse('12') }));
    expect(receive).toHaveBeenCalledOnce();
    expect(receive.mock.lastCall![0].origin).toBe('simulated');
    source.send(liveFrame(2, 'herald:replay', { origin: 'simulated' }));
    vi.advanceTimersByTime(PRESENCE_LEASE_MS);
    expect(unavailable).toHaveBeenCalledTimes(3);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not renew freshness on duplicate or reordered frames and expires at exactly ninety seconds', () => {
    const receive = vi.fn(), unavailable = vi.fn();
    const unsubscribe = createHeraldPresence().subscribe(receive, unavailable);
    const source = FakeEventSource.instances[0]!;
    source.open();
    source.send(liveFrame(10));
    vi.advanceTimersByTime(80_000);
    source.send(liveFrame(10));
    source.send(liveFrame(9));
    expect(receive).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(9_999);
    expect(unavailable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(unavailable).toHaveBeenCalledOnce();
    source.send(liveFrame(11));
    expect(receive).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('rejects already stale frames and gives future timestamps at most a local ninety-second lease', () => {
    const receive = vi.fn(), unavailable = vi.fn();
    const unsubscribe = createHeraldPresence().subscribe(receive, unavailable);
    const source = FakeEventSource.instances[0]!;
    source.open();
    source.send(liveFrame(1, 'herald:one', { asOf: WORLD_FIXTURE_TIME - PRESENCE_LEASE_MS }));
    expect(receive).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledOnce();
    source.send(liveFrame(2, 'herald:one', { asOf: WORLD_FIXTURE_TIME + 1_000_000 }));
    expect(receive).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(PRESENCE_LEASE_MS);
    expect(unavailable).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('preserves explicit offline/stale status until transport silence expires', () => {
    const receive = vi.fn(), unavailable = vi.fn();
    const unsubscribe = createHeraldPresence().subscribe(receive, unavailable);
    const source = FakeEventSource.instances[0]!;
    source.open();
    source.send(liveFrame(1, 'herald:one', { streamLive: false, connection: 'offline', windows: [{ slot: 0, present: false, publicName: null, since: WORLD_FIXTURE_TIME }] }));
    expect(receive).toHaveBeenCalledOnce();
    expect(unavailable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PRESENCE_LEASE_MS);
    expect(unavailable).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('accepts a new producer epoch after reconnect, preserving same-epoch watermarks and closing old streams', () => {
    const receive = vi.fn(), unavailable = vi.fn();
    const unsubscribe = createHeraldPresence().subscribe(receive, unavailable);
    const first = FakeEventSource.instances[0]!;
    first.open();
    first.send(liveFrame(50, 'herald:one'));
    first.error();
    expect(first.close).toHaveBeenCalledOnce();
    expect(unavailable).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    const second = FakeEventSource.instances[1]!;
    second.open();
    first.send(liveFrame(100, 'herald:one'));
    second.send(liveFrame(50, 'herald:one'));
    expect(receive).toHaveBeenCalledTimes(1);
    second.send(liveFrame(51, 'herald:one'));
    expect(receive).toHaveBeenCalledTimes(2);
    second.error();
    vi.advanceTimersByTime(1000);
    const third = FakeEventSource.instances[2]!;
    third.open();
    second.send(liveFrame(100, 'herald:one'));
    third.send(liveFrame(0, 'herald:two'));
    expect(receive).toHaveBeenCalledTimes(3);
    expect(receive.mock.lastCall![0]).toMatchObject({ epoch: 'herald:two', sequence: 0 });
    unsubscribe();
    expect(third.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    third.send(liveFrame(1, 'herald:two'));
    expect(receive).toHaveBeenCalledTimes(3);
  });

  it('never revives a retired producer epoch or its withdrawn public name', () => {
    const receive = vi.fn(), unavailable = vi.fn();
    const stop = createHeraldPresence().subscribe(receive, unavailable);
    const first = FakeEventSource.instances[0]!; first.open(); first.send(liveFrame(1, 'old'));
    first.error(); vi.advanceTimersByTime(1000);
    const second = FakeEventSource.instances[1]!; second.open();
    second.send(liveFrame(0, 'new', { windows: [{ slot: 0, present: true, publicName: null, since: WORLD_FIXTURE_TIME }] }));
    second.error(); vi.advanceTimersByTime(1000);
    const third = FakeEventSource.instances[2]!; third.open(); third.send(liveFrame(2, 'old'));
    expect(receive).toHaveBeenCalledTimes(2);
    expect(receive.mock.lastCall![0].windows[0].publicName).toBeNull();
    stop();
  });

  it('cancels reconnect and watchdog work on unsubscribe, including unsubscribe inside a callback', () => {
    const unavailable = vi.fn();
    let unsubscribe = () => {};
    unsubscribe = createHeraldPresence().subscribe(() => unsubscribe(), unavailable);
    const first = FakeEventSource.instances[0]!;
    first.open(); first.send(liveFrame());
    expect(vi.getTimerCount()).toBe(0);
    const stop = createHeraldPresence().subscribe(vi.fn(), unavailable);
    FakeEventSource.instances[1]!.error();
    stop();
    vi.advanceTimersByTime(100_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
