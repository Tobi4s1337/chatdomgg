import { describe, expect, it, vi } from 'vitest';
import { Group, Matrix4 } from 'three';
import type { GrowthCivicPlace, GrowthSceneFeed, GrowthSceneFrame } from '@chatdom/shared';
import { createGrowthCivicAdapter, type GrowthCivicAdapterOptions, type ManagedGrowthObject } from './adapter';

const places = ['tavern', 'forge', 'market', 'bridge', 'castle-court'] as const;
const frame = (overrides: Partial<GrowthSceneFrame> = {}): GrowthSceneFrame => ({
  version: 1, kingdomId: '129634568', origin: 'simulated', sequence: 40, asOf: 1_793_530_000_000,
  homes: [], civic: { tavern: 1, forge: 2, market: 3, bridge: 4, 'castle-court': 3 }, beats: [],
  ...overrides,
} as GrowthSceneFrame);
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function harness(label: GrowthSceneFeed['label'] = 'SIMULATED', waiting = vi.fn()) {
  let receive!: (value: GrowthSceneFrame) => void;
  let unavailable!: () => void;
  const unsubscribe = vi.fn();
  const feed: GrowthSceneFeed = { label, subscribe: (r, u) => { receive = r; unavailable = u; return unsubscribe; } };
  const anchors = Object.fromEntries(places.map((place, index) => [place, new Matrix4().makeTranslation(index * 10, 2, 3)])) as Record<GrowthCivicPlace, Matrix4>;
  const made: ManagedGrowthObject[] = [];
  const resource = () => { const result = { object: new Group(), dispose: vi.fn() }; made.push(result); return result; };
  const buildMesh = vi.fn<GrowthCivicAdapterOptions['buildMesh']>(async () => resource());
  const createLight = vi.fn<GrowthCivicAdapterOptions['createLight']>(() => resource());
  const createWater = vi.fn(() => resource());
  const onUnavailable = vi.fn();
  const onReady = vi.fn();
  const bridgeSite = { water: 2, bank: 3 };
  const adapter = createGrowthCivicAdapter({ feed, anchors, style: 'hearth', bridgeSite, buildMesh, createLight, createWater, onUnavailable, onReady, onWaiting: waiting });
  return { adapter, anchors, bridgeSite, buildMesh, createLight, createWater, made, onUnavailable, onReady, onWaiting: waiting, unsubscribe,
    send: (value: GrowthSceneFrame) => receive(value), unavailable: () => unavailable() };
}

describe('growth civic scene adapter', () => {
  it('maps all five snapshot levels to their anchored scene objects', async () => {
    const h = harness();
    h.send(frame()); await flush();
    expect(h.buildMesh).toHaveBeenCalledTimes(5);
    for (const place of places) {
      const level = frame().civic[place];
      expect(h.buildMesh.mock.calls).toContainEqual([expect.objectContaining({ id: `growth-hearth-${place}-${level}` }), place]);
      const root = h.adapter.group.getObjectByName(`growth-${place}`)!;
      expect(root.matrix.equals(h.anchors[place])).toBe(true);
      expect(root.children.length).toBeGreaterThan(0);
    }
    expect(h.createLight).toHaveBeenCalled();
    expect(h.createWater).toHaveBeenCalled();
  });

  it('validates the whole schema and rejects a mismatched origin, realm and regressions', async () => {
    const h = harness();
    h.send({ ...frame(), homes: [{ plotId: 'home:x', stage: 'tent', qualifiedDays: 1, qualifiedMinutes: 999, currentStreak: 0, bestStreak: 0, nextGoal: null }] } as GrowthSceneFrame);
    h.send(frame({ origin: 'live' }));
    expect(h.onUnavailable.mock.calls.map(x => x[0])).toEqual(['invalid-frame', 'origin-mismatch']);
    expect(h.buildMesh).not.toHaveBeenCalled();
    h.send(frame()); await flush();
    h.send(frame({ kingdomId: '999999' as GrowthSceneFrame['kingdomId'], sequence: 41 }));
    h.send(frame({ sequence: 39 }));
    h.send(frame({ sequence: 41, civic: { ...frame().civic, market: 2 } }));
    h.send(frame({ civic: { ...frame().civic, market: 4 } }));
    expect(h.onUnavailable.mock.calls.slice(2).map(x => x[0])).toEqual(['realm-change', 'regression', 'regression', 'regression']);
    expect(h.buildMesh).toHaveBeenCalledTimes(5);
    h.unavailable(); expect(h.onUnavailable).toHaveBeenLastCalledWith('feed');
    const live = harness('LIVE'); live.send(frame({ origin: 'live' })); await flush();
    expect(live.buildMesh).toHaveBeenCalledTimes(5);
  });

  it('ignores repeated snapshots and fresh beats, then replaces only an advanced place', async () => {
    const h = harness(); h.send(frame()); await flush();
    const old = h.adapter.group.getObjectByName('growth-market')!.children[0]!;
    h.send(frame());
    h.send(frame({ beats: [{ kind: 'civic-levelled', place: 'market', from: 3, to: 4, sourceSeq: 40, at: frame().asOf }] }));
    await flush(); expect(h.buildMesh).toHaveBeenCalledTimes(5);
    h.send(frame({ sequence: 41, civic: { ...frame().civic, market: 4 } })); await flush();
    expect(h.buildMesh).toHaveBeenCalledTimes(6);
    expect(old.parent).toBeNull();
    expect(h.adapter.group.getObjectByName('growth-market')!.children).not.toContain(old);
  });

  it('reattaches without duplication, resets for seeking or realm changes and disposes only owned resources', async () => {
    const h = harness(); const first = new Group(), second = new Group(), host = new Group(); first.add(host);
    h.adapter.attach(first); h.adapter.attach(first); expect(first.children.filter(x => x === h.adapter.group)).toHaveLength(1);
    h.send(frame()); await flush(); const old = [...h.made];
    h.adapter.attach(second); expect(h.adapter.group.parent).toBe(second); expect(host.parent).toBe(first);
    h.adapter.reset(); expect(old.every(x => vi.mocked(x.dispose).mock.calls.length === 1)).toBe(true);
    h.send(frame({ kingdomId: '999999' as GrowthSceneFrame['kingdomId'], sequence: 1 })); await flush();
    expect(h.buildMesh).toHaveBeenCalledTimes(10);
    h.adapter.dispose(); h.adapter.dispose();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.made.every(x => vi.mocked(x.dispose).mock.calls.length === 1)).toBe(true);
    expect(h.adapter.group.parent).toBeNull(); expect(host.parent).toBe(first);
    h.send(frame()); await flush(); expect(h.buildMesh).toHaveBeenCalledTimes(10);
  });

  it('discards out-of-order asynchronous builds and disposes builds completed after disposal', async () => {
    const h = harness();
    const pending: { resolve: (r: ManagedGrowthObject) => void; place: GrowthCivicPlace }[] = [];
    h.buildMesh.mockImplementation((_blueprint, place) => new Promise(resolve => pending.push({ resolve, place })));
    h.send(frame());
    h.send(frame({ sequence: 41, civic: { ...frame().civic, market: 4 } }));
    const make = () => ({ object: new Group(), dispose: vi.fn() });
    const newer = make(), older = make();
    pending.filter(p => p.place === 'market')[1]!.resolve(newer); await flush();
    pending.filter(p => p.place === 'market')[0]!.resolve(older); await flush();
    expect(newer.object.parent?.name).toBe('growth-market'); expect(older.dispose).toHaveBeenCalledOnce();
    h.adapter.dispose(); expect(newer.dispose).toHaveBeenCalledOnce();
    const late = make(); pending.find(p => p.place === 'tavern')!.resolve(late); await flush();
    expect(late.dispose).toHaveBeenCalledOnce(); expect(late.object.parent).toBeNull();
  });

  it('cleans up factory failures and retries the latest snapshot', async () => {
    const h = harness(); h.createLight.mockImplementationOnce(() => { throw new Error('light unavailable'); });
    h.send(frame()); await flush();
    expect(h.onUnavailable).toHaveBeenCalledWith('build-failed');
    expect(h.made.some(x => vi.mocked(x.dispose).mock.calls.length === 1)).toBe(true);
    const before = h.buildMesh.mock.calls.length;
    h.send(frame()); await flush();
    expect(h.buildMesh.mock.calls.length).toBeGreaterThan(before);
  });

  it('leaves a host-owned object alone when a factory incorrectly returns it', async () => {
    const h = harness(); const host = new Group(), object = new Group(), dispose = vi.fn(); host.add(object);
    h.buildMesh.mockResolvedValueOnce({ object, dispose });
    h.send(frame()); await flush();
    expect(h.onUnavailable).toHaveBeenCalledWith('build-failed');
    expect(object.parent).toBe(host); expect(dispose).not.toHaveBeenCalled();
  });

  it('cleans every owned object even when one disposer throws', async () => {
    const h = harness(); h.send(frame()); await flush();
    const victims = [...h.made];
    vi.mocked(victims[0]!.dispose).mockImplementation(() => { throw new Error('dispose failed'); });
    h.adapter.reset();
    expect(victims.every(x => vi.mocked(x.dispose).mock.calls.length === 1)).toBe(true);
    expect(victims.every(x => x.object.parent === null)).toBe(true);
    expect(h.onUnavailable).toHaveBeenCalledWith('build-failed');
  });

  it('does not attach a build when a light callback resets the adapter', async () => {
    const h = harness();
    const light = { object: new Group(), dispose: vi.fn() };
    h.createLight.mockImplementationOnce(() => { h.adapter.reset(); return light; });
    h.send(frame()); await flush();
    expect(light.object.parent).toBeNull(); expect(light.dispose).toHaveBeenCalledOnce();
    expect(h.adapter.group.children.every(root => root.children.length === 0)).toBe(true);
  });


  it.each(['reset', 'dispose'] as const)('cleans a build when its added event calls %s', async action => {
    const h = harness();
    const object = new Group(), dispose = vi.fn();
    object.addEventListener('added', () => h.adapter[action]());
    h.buildMesh.mockResolvedValueOnce({ object, dispose });
    h.send(frame()); await flush();
    expect(object.parent).toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
    expect(h.adapter.group.children.every(root => root.children.length === 0)).toBe(true);
  });

  it('does not report a disposer failure after disposal', async () => {
    const h = harness(); h.send(frame()); await flush();
    vi.mocked(h.made[0]!.dispose).mockImplementation(() => { throw new Error('dispose failed'); });
    h.onUnavailable.mockClear();
    h.adapter.dispose();
    expect(h.onUnavailable).not.toHaveBeenCalled();
  });


  it('reports readiness only after all five builds mount and does not repeat it for a duplicate frame', async () => {
    const h = harness();
    const pending: ((resource: ManagedGrowthObject) => void)[] = [];
    h.buildMesh.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const snapshot = frame({ beats: [{ kind: 'civic-levelled', place: 'market', from: 2, to: 3, sourceSeq: 40, at: frame().asOf }] }); h.send(snapshot);
    for (const resolve of pending.slice(0, 4)) resolve({ object: new Group(), dispose: vi.fn() });
    await flush(); expect(h.onReady).not.toHaveBeenCalled();
    pending[4]!({ object: new Group(), dispose: vi.fn() }); await flush();
    expect(h.onReady).toHaveBeenCalledTimes(1);
    expect(h.onReady).toHaveBeenCalledWith({ ...snapshot, beats: [] });
    h.send(snapshot); await flush(); expect(h.onReady).toHaveBeenCalledTimes(1);
  });

  it('recovers readiness only after a failed build is retried by the latest snapshot', async () => {
    const h = harness(); h.buildMesh.mockRejectedValueOnce(new Error('failed'));
    const snapshot = frame(); h.send(snapshot); await flush();
    expect(h.onUnavailable).toHaveBeenCalledWith('build-failed');
    expect(h.onReady).not.toHaveBeenCalled();
    h.send(snapshot); await flush();
    expect(h.onReady).toHaveBeenCalledTimes(1);
    expect(h.onReady).toHaveBeenCalledWith(snapshot);
  });

  it('restores readiness after feed loss only when a valid frame arrives again', async () => {
    const h = harness(); const snapshot = frame({ beats: [{ kind: 'civic-levelled', place: 'market', from: 2, to: 3, sourceSeq: 40, at: frame().asOf }] }); h.send(snapshot); await flush();
    expect(h.onReady).toHaveBeenCalledTimes(1);
    h.unavailable(); expect(h.onUnavailable).toHaveBeenCalledWith('feed');
    expect(h.onReady).toHaveBeenCalledTimes(1);
    h.send(snapshot); await flush(); expect(h.onReady).toHaveBeenCalledTimes(2);
    expect(h.onReady).toHaveBeenLastCalledWith({ ...snapshot, beats: [] });
    h.send(snapshot); await flush(); expect(h.onReady).toHaveBeenCalledTimes(2);
  });


  it('keeps mounted resources when the readiness callback throws and retries the callback', async () => {
    const h = harness();
    h.onReady.mockImplementationOnce(() => { throw new Error('host callback failed'); });
    const snapshot = frame(); h.send(snapshot); await flush();
    expect(h.onUnavailable).toHaveBeenCalledWith('callback-failed');
    const mounted = [...h.made];
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.every(resource => resource.object.parent !== null)).toBe(true);
    expect(mounted.every(resource => vi.mocked(resource.dispose).mock.calls.length === 0)).toBe(true);
    h.send(snapshot); await flush();
    expect(h.onReady).toHaveBeenCalledTimes(2);
    expect(h.buildMesh).toHaveBeenCalledTimes(5);
    h.adapter.dispose();
    expect(mounted.every(resource => vi.mocked(resource.dispose).mock.calls.length === 1)).toBe(true);
  });


  it('continues reset cleanup when an object removed listener throws', async () => {
    const h = harness(); h.send(frame()); await flush();
    const owned = [...h.made];
    owned[0]!.object.addEventListener('removed', () => { throw new Error('host listener failed'); });
    h.adapter.reset();
    expect(owned.every(resource => resource.object.parent === null)).toBe(true);
    expect(owned.every(resource => vi.mocked(resource.dispose).mock.calls.length === 1)).toBe(true);
    expect(h.onUnavailable).toHaveBeenCalledWith('build-failed');
  });


  it('finishes disposal when feed unsubscribe throws', async () => {
    const h = harness(); const host = new Group(); h.adapter.attach(host);
    h.send(frame()); await flush();
    const owned = [...h.made]; h.onUnavailable.mockClear(); h.onReady.mockClear();
    h.unsubscribe.mockImplementation(() => { throw new Error('unsubscribe failed'); });
    expect(() => h.adapter.dispose()).not.toThrow();
    expect(h.adapter.group.parent).toBeNull();
    expect(owned.every(resource => resource.object.parent === null)).toBe(true);
    expect(owned.every(resource => vi.mocked(resource.dispose).mock.calls.length === 1)).toBe(true);
    h.adapter.dispose(); h.unavailable(); h.send(frame()); await flush();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(owned.every(resource => vi.mocked(resource.dispose).mock.calls.length === 1)).toBe(true);
    expect(h.onUnavailable).not.toHaveBeenCalled(); expect(h.onReady).not.toHaveBeenCalled();
  });


  it('does not let readiness payload mutations corrupt the accepted snapshot', async () => {
    const h = harness();
    const snapshot = frame({ homes: [{ plotId: 'home:juniper', stage: 'tent', qualifiedDays: 0,
      qualifiedMinutes: 0, currentStreak: 0, bestStreak: 0,
      nextGoal: { stage: 'hut', requiredDays: 3, remainingDays: 3 } }] });
    h.onReady.mockImplementationOnce((ready: GrowthSceneFrame) => {
      ready.civic.market = 1;
      ready.homes[0]!.nextGoal!.remainingDays = 0;
      ready.homes.length = 0;
    });
    h.send(snapshot); await flush();
    expect(snapshot.civic.market).toBe(3);
    expect(snapshot.homes[0]!.nextGoal!.remainingDays).toBe(3);
    h.send(frame({ sequence: 41, civic: { ...snapshot.civic, market: 2 } }));
    expect(h.onUnavailable).toHaveBeenCalledWith('regression');
    expect(h.buildMesh).toHaveBeenCalledTimes(5);
  });


  it('copies bridge site heights for both geometry and lights across an asynchronous build', async () => {
    const baseline = harness(); baseline.send(frame()); await flush();
    const expectedBlueprint = baseline.buildMesh.mock.calls.find(([, place]) => place === 'bridge')![0];
    const expectedLights = baseline.createLight.mock.calls.filter(([, place]) => place === 'bridge');
    const h = harness();
    let finishBridge!: (resource: ManagedGrowthObject) => void;
    h.buildMesh.mockImplementation((blueprint, place) => place === 'bridge'
      ? new Promise(resolve => { finishBridge = resolve; })
      : Promise.resolve({ object: new Group(), dispose: vi.fn() }));
    h.send(frame());
    h.bridgeSite.water = 8; h.bridgeSite.bank = 10;
    finishBridge({ object: new Group(), dispose: vi.fn() }); await flush();
    expect(h.buildMesh.mock.calls.find(([, place]) => place === 'bridge')![0]).toEqual(expectedBlueprint);
    expect(h.createLight.mock.calls.filter(([, place]) => place === 'bridge')).toEqual(expectedLights);
  });


  it('cleans late builds when a feed delivers synchronously then subscribe throws', async () => {
    const pending: ((resource: ManagedGrowthObject) => void)[] = [];
    const onReady = vi.fn(), onUnavailable = vi.fn();
    const feed: GrowthSceneFeed = { label: 'SIMULATED', subscribe(receive) {
      receive(frame()); throw new Error('subscribe failed');
    } };
    const anchors = Object.fromEntries(places.map(place => [place, new Matrix4()])) as Record<GrowthCivicPlace, Matrix4>;
    expect(() => createGrowthCivicAdapter({ feed, anchors, style: 'hearth', bridgeSite: { water: 2, bank: 3 },
      buildMesh: () => new Promise(resolve => pending.push(resolve)),
      createLight: () => ({ object: new Group(), dispose: vi.fn() }),
      createWater: () => ({ object: new Group(), dispose: vi.fn() }), onReady, onUnavailable, onWaiting: vi.fn(),
    })).toThrow('subscribe failed');
    expect(pending).toHaveLength(5);
    const resources = pending.map(resolve => {
      const resource = { object: new Group(), dispose: vi.fn() }; resolve(resource); return resource;
    });
    await flush();
    expect(resources.every(resource => resource.object.parent === null)).toBe(true);
    expect(resources.every(resource => resource.dispose.mock.calls.length === 1)).toBe(true);
    expect(onReady).not.toHaveBeenCalled(); expect(onUnavailable).not.toHaveBeenCalled();
  });


  it('processes a frame delivered reentrantly during reset after old resources are cleared', async () => {
    const h = harness(); h.send(frame()); await flush();
    const old = [...h.made]; h.onReady.mockClear();
    const next = frame({ kingdomId: '999999' as GrowthSceneFrame['kingdomId'], sequence: 1,
      civic: { tavern: 2, forge: 2, market: 2, bridge: 2, 'castle-court': 2 } });
    vi.mocked(old[0]!.dispose).mockImplementationOnce(() => h.send(next));
    h.adapter.reset(); await flush();
    expect(old.every(resource => resource.object.parent === null)).toBe(true);
    expect(old.every(resource => vi.mocked(resource.dispose).mock.calls.length === 1)).toBe(true);
    expect(h.buildMesh).toHaveBeenCalledTimes(10);
    for (const place of places) expect(h.adapter.group.getObjectByName(`growth-${place}`)!.children.length).toBeGreaterThan(0);
    expect(h.onReady).toHaveBeenCalledTimes(1);
    expect(h.onReady).toHaveBeenCalledWith(next);
  });


  it('captures a reentrant frame before its sender mutates it', async () => {
    const h = harness(); h.send(frame()); await flush();
    const next = frame({ kingdomId: '999999' as GrowthSceneFrame['kingdomId'], sequence: 1,
      civic: { tavern: 2, forge: 2, market: 3, bridge: 2, 'castle-court': 2 },
      homes: [{ plotId: 'home:juniper', stage: 'tent', qualifiedDays: 0, qualifiedMinutes: 0,
        currentStreak: 0, bestStreak: 0, nextGoal: { stage: 'hut', requiredDays: 3, remainingDays: 3 } }] });
    h.onReady.mockClear();
    vi.mocked(h.made[0]!.dispose).mockImplementationOnce(() => {
      h.send(next);
      next.civic.market = 1;
      next.homes[0]!.nextGoal!.remainingDays = 0;
    });
    h.adapter.reset(); await flush();
    expect(h.onReady).toHaveBeenCalledTimes(1);
    expect(h.onReady.mock.calls[0]![0]).toMatchObject({ civic: { market: 3 }, homes: [{ nextGoal: { remainingDays: 3 } }] });
    h.send(frame({ kingdomId: '999999' as GrowthSceneFrame['kingdomId'], sequence: 2,
      civic: { tavern: 2, forge: 2, market: 2, bridge: 2, 'castle-court': 2 } }));
    expect(h.onUnavailable).toHaveBeenCalledWith('regression');
  });


  it('announces waiting on construction and reset before reentrant frame readiness, never after disposal', async () => {
    const order: string[] = [];
    const h = harness('SIMULATED', vi.fn(() => { order.push('waiting'); }));
    expect(order).toEqual(['waiting']);
    h.onReady.mockImplementation(() => { order.push('ready'); });
    h.send(frame()); await flush();
    const next = frame({ kingdomId: '999999' as GrowthSceneFrame['kingdomId'], sequence: 1 });
    vi.mocked(h.made[0]!.dispose).mockImplementationOnce(() => h.send(next));
    h.adapter.reset(); await flush();
    expect(order).toEqual(['waiting', 'ready', 'waiting', 'ready']);
    h.adapter.dispose(); h.adapter.reset(); h.send(next); await flush();
    expect(order).toEqual(['waiting', 'ready', 'waiting', 'ready']);
  });

  it('reports a waiting callback failure without losing future readiness', async () => {
    const waiting = vi.fn().mockImplementationOnce(() => { throw new Error('waiting callback failed'); });
    const h = harness('SIMULATED', waiting);
    expect(h.onUnavailable).toHaveBeenCalledWith('callback-failed');
    h.send(frame()); await flush();
    expect(h.onReady).toHaveBeenCalledTimes(1);
  });


  it('keeps reset cleanup failure as the last status instead of announcing waiting', async () => {
    const statuses: string[] = [];
    const h = harness('SIMULATED', vi.fn(() => { statuses.push('waiting'); }));
    h.onUnavailable.mockImplementation(reason => { statuses.push(reason); });
    h.send(frame()); await flush();
    const owned = [...h.made];
    vi.mocked(owned[0]!.dispose).mockImplementation(() => { throw new Error('dispose failed'); });
    h.adapter.reset();
    expect(owned.every(resource => resource.object.parent === null)).toBe(true);
    expect(owned.every(resource => vi.mocked(resource.dispose).mock.calls.length === 1)).toBe(true);
    expect(statuses.at(-1)).toBe('build-failed');
  });


  it('announces waiting once for a pending level advance and ready when it mounts', async () => {
    const h = harness(); h.send(frame()); await flush();
    h.onWaiting.mockClear(); h.onReady.mockClear();
    h.send(frame({ sequence: 41 })); await flush();
    expect(h.onWaiting).not.toHaveBeenCalled();
    h.onReady.mockClear();
    let finish!: (resource: ManagedGrowthObject) => void;
    h.buildMesh.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const advance = frame({ sequence: 42, civic: { ...frame().civic, market: 4 } });
    h.send(advance); h.send(advance); await flush();
    expect(h.onWaiting).toHaveBeenCalledTimes(1);
    expect(h.onReady).not.toHaveBeenCalled();
    finish({ object: new Group(), dispose: vi.fn() }); await flush();
    expect(h.onReady).toHaveBeenCalledTimes(1);
    expect(h.onReady).toHaveBeenCalledWith(advance);
    expect(h.onWaiting).toHaveBeenCalledTimes(1);
  });

});
