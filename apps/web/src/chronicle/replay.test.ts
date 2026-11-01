import { describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, type GrowthSceneFrame } from '@chatdom/shared';
import { createReplay, validateHistory, type HistoricalSnapshot } from './replay';

const snapshot = (sequence: number, revision: string): HistoricalSnapshot => ({
  frame: { version: 1, kingdomId: KingdomIdSchema.parse('123'), origin: 'simulated', sequence, asOf: sequence * 1000,
    homes: [{ plotId: 'plot', stage: 'hut', qualifiedDays: 3, qualifiedMinutes: 30, currentStreak: 3, bestStreak: 3, nextGoal: null }],
    civic: { tavern: 1, forge: 1, market: 1, bridge: 1, 'castle-court': 1 }, beats: [] } satisfies GrowthSceneFrame,
  homes: [{ plotId: 'plot', assetRevision: revision }], worldRevision: `world-${revision}`, caption: `Night ${sequence}`,
});
const setup = () => { const binding = { replace: vi.fn(), clear: vi.fn(), dispose: vi.fn() }; return { binding, replay: createReplay(binding) }; };

describe('Chronicle replay', () => {
  it('replaces the complete scene deterministically in either direction without treating entitlement as a built home', () => {
    const { replay, binding } = setup(), first = snapshot(1, 'tent'), last = snapshot(2, 'hut');
    replay.load({ label: 'SIMULATED', snapshots: [first, last] });
    replay.seek(1); replay.seek(0); replay.seek(1);
    expect(binding.replace.mock.calls.map(([s]) => s.homes[0].assetRevision)).toEqual(['tent', 'hut', 'tent', 'hut']);
    expect(replay.state()).toMatchObject({ status: 'ready', label: 'SIMULATED', index: 1, snapshot: { caption: 'Night 2' } });
  });
  it('validates a large recorded settlement even when home revisions arrive in a different order', () => {
    const recorded = snapshot(1, 'hut');
    const home = recorded.frame.homes[0]!;
    recorded.frame.homes = Array.from({ length: 20000 }, (_, index) => ({ ...home, plotId: `plot:${index}` }));
    const homes = recorded.frame.homes.map(view => ({ plotId: view.plotId, assetRevision: 'hut' })).reverse();
    const validated = validateHistory({ label: 'SIMULATED', snapshots: [{ ...recorded, homes }] });
    expect(validated.snapshots[0]!.homes).toHaveLength(20000);
    homes[0] = { plotId: 'not-in-frame', assetRevision: 'hut' };
    expect(() => validateHistory({ label: 'SIMULATED', snapshots: [{ ...recorded, homes }] })).toThrow(/complete scene/);
  });
  it('strips the recent presentation tail before applying historical snapshots', () => {
    const { replay, binding } = setup(), recorded = snapshot(1, 'hut');
    recorded.frame.beats.push({ kind: 'home-grown', sourceSeq: 1, at: 1000, plotId: 'plot', from: 'tent', to: 'hut', qualifiedDays: 3 });
    replay.load({ label: 'SIMULATED', snapshots: [recorded] });
    expect(binding.replace.mock.calls[0]![0].frame.beats).toEqual([]);
    expect(recorded.frame.beats).toHaveLength(1);
  });
  it('owns immutable historical snapshots after loading', () => {
    const { replay, binding } = setup(), first = snapshot(1, 'tent');
    replay.load({ label: 'SIMULATED', snapshots: [first, snapshot(2, 'hut')] });
    first.frame.homes[0]!.qualifiedDays = 99;
    const displayed = replay.state();
    expect(displayed.status).toBe('ready');
    if (displayed.status !== 'ready') throw new Error('Expected a recorded night');
    expect(displayed.snapshot.frame.homes[0]!.qualifiedDays).toBe(3);
    expect(Object.isFrozen(displayed.snapshot.frame.homes[0])).toBe(true);
    expect(() => { displayed.snapshot.frame.civic.market = 9; }).toThrow();
    replay.seek(1); replay.seek(0);
    expect(binding.replace.mock.calls.at(-1)![0].frame.civic.market).toBe(1);
  });
  it('preserves a selected scene focus while validating history', () => {
    const market = { ...snapshot(1, 'a'), focus: 'market' as const };
    expect(validateHistory({ label: 'SIMULATED', snapshots: [market] }).snapshots[0]?.focus).toBe('market');
  });
  it('pauses and disposes without leaving replay state in the host', () => {
    const { replay, binding } = setup(); replay.load({ label: 'SIMULATED', snapshots: [snapshot(1, 'a'), snapshot(2, 'b')] });
    replay.play(); replay.pause(); replay.step(); expect(binding.replace).toHaveBeenCalledTimes(1);
    replay.play(); replay.step(); expect(replay.state()).toMatchObject({ index: 1, playing: false });
    replay.dispose(); replay.dispose(); expect(binding.clear).toHaveBeenCalledTimes(1); expect(binding.dispose).toHaveBeenCalledTimes(1);
  });
  it('stops at the final night when seeking during playback', () => {
    const { replay, binding } = setup();
    replay.load({ label: 'SIMULATED', snapshots: [snapshot(1, 'a'), snapshot(2, 'b')] });
    replay.play(); replay.seek(1);
    expect(replay.state()).toMatchObject({ index: 1, playing: false });
    replay.step();
    expect(binding.replace).toHaveBeenCalledTimes(2);
  });
  it('always disposes the host when clearing on close fails', () => {
    const { replay, binding } = setup();
    replay.load({ label: 'SIMULATED', snapshots: [snapshot(1, 'a')] });
    binding.clear.mockImplementationOnce(() => { throw new Error('clear failed'); });
    expect(() => replay.dispose()).toThrow('clear failed');
    expect(binding.dispose).toHaveBeenCalledTimes(1);
    replay.dispose(); expect(binding.dispose).toHaveBeenCalledTimes(1);
  });
  it('reports unavailable and clears the scene if the engine cannot apply a revision', () => {
    const { replay, binding } = setup(); replay.load({ label: 'SIMULATED', snapshots: [snapshot(1, 'a'), snapshot(2, 'b')] });
    binding.replace.mockImplementationOnce(() => { throw new Error('missing revision'); });
    expect(() => replay.seek(1)).toThrow('missing revision');
    expect(replay.state()).toEqual({ status: 'unavailable', playing: false });
    expect(binding.clear).toHaveBeenCalledTimes(1);
  });
  it('announces unavailable even if clearing the host presentation also fails', () => {
    const binding = { replace: vi.fn(), clear: vi.fn(), dispose: vi.fn() };
    const changes = vi.fn(), replay = createReplay(binding, changes);
    replay.load({ label: 'SIMULATED', snapshots: [snapshot(1, 'a'), snapshot(2, 'b')] });
    binding.replace.mockImplementationOnce(() => { throw new Error('revision missing'); });
    binding.clear.mockImplementationOnce(() => { throw new Error('host could not clear'); });
    try { replay.seek(1); throw new Error('Expected seek to fail'); } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors.map((item: Error) => item.message)).toEqual(['revision missing', 'host could not clear']);
    }
    expect(changes).toHaveBeenLastCalledWith({ status: 'unavailable', playing: false });
    expect(replay.state()).toEqual({ status: 'unavailable', playing: false });
    binding.clear.mockImplementationOnce(() => { throw new Error('host could not clear'); });
    expect(() => replay.load({ label: 'SIMULATED', snapshots: [] })).toThrow();
    expect(changes).toHaveBeenLastCalledWith({ status: 'unavailable', playing: false });
  });
  it('preserves invalid-history and cleanup errors together', () => {
    const { replay, binding } = setup();
    replay.load({ label: 'SIMULATED', snapshots: [snapshot(1, 'a')] });
    binding.clear.mockImplementationOnce(() => { throw new Error('clear failed'); });
    try {
      replay.load({ label: 'LIVE', snapshots: [snapshot(1, 'a')] });
      throw new Error('Expected invalid history to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      const errors = (error as AggregateError).errors as Error[];
      expect(errors[0]?.message).toMatch(/provenance/);
      expect(errors[1]?.message).toBe('clear failed');
    }
    expect(replay.state()).toEqual({ status: 'unavailable', playing: false });
  });
  it('clears unavailable, empty, invalid or mismatched histories rather than retaining a stale view', () => {
    const { replay, binding } = setup(); replay.load({ label: 'SIMULATED', snapshots: [snapshot(1, 'a')] });
    expect(() => replay.load({ label: 'LIVE', snapshots: [snapshot(1, 'a')] })).toThrow(/provenance/);
    expect(replay.state()).toEqual({ status: 'unavailable', playing: false });
    expect(() => replay.load({ label: 'SIMULATED', snapshots: [snapshot(2, 'b'), snapshot(1, 'a')] })).toThrow(/ordered/);
    replay.load({ label: 'SIMULATED', snapshots: [] }); expect(replay.state()).toEqual({ status: 'empty', label: 'SIMULATED', playing: false });
    replay.load({ label: 'LIVE', snapshots: [] }); expect(replay.state()).toEqual({ status: 'empty', label: 'LIVE', playing: false });
    replay.load(null); expect(replay.state().status).toBe('unavailable'); expect(binding.clear).toHaveBeenCalledTimes(5);
  });
});

it('keeps the latest seek when asynchronous scene preparation completes out of order, and cancels on close', async () => {
  const waits: { signal: AbortSignal | undefined; resolve: () => void }[] = [];
  const binding = { replace: vi.fn((_snapshot: HistoricalSnapshot, signal?: AbortSignal) => new Promise<void>(resolve => waits.push({ signal, resolve }))), clear: vi.fn(), dispose: vi.fn() };
  const replay = createReplay(binding);
  const first = replay.load({ label: 'SIMULATED', snapshots: [snapshot(1, 'a'), snapshot(2, 'b')] });
  const second = replay.seek(1);
  expect(waits[0]?.signal?.aborted).toBe(true);
  waits[1]!.resolve(); await second;
  expect(replay.state()).toMatchObject({ index: 1, snapshot: { caption: 'Night 2' } });
  waits[0]!.resolve(); await first;
  expect(replay.state()).toMatchObject({ index: 1 });
  const late = replay.seek(0); replay.dispose();
  expect(waits[2]?.signal?.aborted).toBe(true);
  waits[2]!.resolve(); await late;
  expect(binding.clear).toHaveBeenCalledTimes(1);
});
it('does not advance playback over a pending scene or leak an asynchronous failure', async () => {
  let reject!: (error: Error) => void;
  const binding = { replace: vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; })), clear: vi.fn(), dispose: vi.fn() };
  const replay = createReplay(binding);
  const load = replay.load({ label: 'SIMULATED', snapshots: [snapshot(1, 'a'), snapshot(2, 'b')] });
  replay.play(); replay.step();
  expect(binding.replace).toHaveBeenCalledTimes(1);
  reject(new Error('geometry unavailable'));
  await expect(load).rejects.toThrow('geometry unavailable');
  expect(replay.state()).toEqual({ status: 'unavailable', playing: false });
  expect(binding.clear).toHaveBeenCalledTimes(1);
});
