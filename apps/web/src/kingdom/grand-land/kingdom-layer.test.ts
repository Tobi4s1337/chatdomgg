import { afterEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
import { MATERIALS } from '@chatdom/content';
import { KingdomIdSchema } from '@chatdom/shared';
import { generateSettlementPlan, type RealmFoundedScene } from '@chatdom/world';
import { createWaterSurface, type WaterSurface } from '../../places/water/surface';
import { createKingdomLayers, registerKingdomLayer, type KingdomLayerMount, type KingdomLayerMounter } from './kingdom-layer';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const keep = <T extends () => void>(cleanup: T) => { cleanups.push(cleanup); return cleanup; };
const register = (id: string, mount: KingdomLayerMounter) => keep(registerKingdomLayer(id, mount));
const plan = generateSettlementPlan({ seed: 'kingdom-layer-test', tier: 'hamlet', firstYear: 2025, year: 2026 });

function owner(id = '999000001') {
  const scene = new Scene(), camera = new PerspectiveCamera(), abort = new AbortController();
  const founded: RealmFoundedScene = {
    version: 1, kingdomId: KingdomIdSchema.parse(id), origin: 'simulated',
    layoutRevision: 'layer-test:1', collisionRevision: 1, plan, materials: MATERIALS, assets: [], placements: [],
  };
  const state: { hour: number; quality: KingdomLayerMount['quality']; mode: KingdomLayerMount['mode']; active: boolean } = {
    hour: 17.5, quality: 'high', mode: 'watching', active: false,
  };
  let water: Pick<WaterSurface, 'root' | 'waterAt'> = { root: new Group(), waterAt: () => null };
  scene.add(water.root);
  const context = {
    scene, camera, founded, signal: abort.signal,
    get mode() { return state.mode; }, get quality() { return state.quality; },
    hour: () => state.hour, water: () => water, active: () => state.active,
  };
  function mount() { const layers = createKingdomLayers(context); keep(layers.dispose); return layers; }
  return { context, state, abort, mount, replaceWater(next: typeof water) { water.root.removeFromParent(); water = next; scene.add(water.root); } };
}

describe('registered kingdom effects in the shared host', () => {
  it('passes the exact founded scene and live mode, hour, quality and presentation eligibility', () => {
    const source = owner();
    let host: KingdomLayerMount | undefined;
    register('pier', value => { host = value; return () => {}; });
    const layers = source.mount();
    expect(host!.scene).toBe(source.context.scene);
    expect(host!.camera).toBe(source.context.camera);
    expect(host!.founded).toBe(source.context.founded);
    expect(host!.kingdomId).toBe(source.context.founded.kingdomId);
    expect([host!.mode, host!.hour(), host!.quality, host!.active()]).toEqual(['watching', 17.5, 'high', false]);
    Object.assign(source.state, { mode: 'walking', hour: 21, quality: 'low', active: true });
    expect([host!.mode, host!.hour(), host!.quality, host!.active()]).toEqual(['walking', 21, 'low', true]);
    layers.dispose();
    expect(host!.active()).toBe(false);
    expect(host!.signal.aborted).toBe(true);
  });

  it('late-registers in two independent scenes and unregisters both without stale ticks or id reuse hazards', () => {
    const first = owner(), second = owner('999000002');
    first.state.mode = 'stream';
    const a = first.mount(), b = second.mount(), hosts: KingdomLayerMount[] = [], tick = vi.fn(), released = vi.fn();
    const unregister = register('pier', host => { hosts.push(host); host.onTick(tick); return released; });
    expect(hosts.map(host => host.kingdomId)).toEqual([first.context.founded.kingdomId, second.context.founded.kingdomId]);
    expect(hosts.map(host => host.mode)).toEqual(['stream', 'watching']);
    a.tick(.016, 100); b.tick(.032, 200);
    expect(tick.mock.calls).toEqual([[.016, 100], [.032, 200]]);
    first.abort.abort();
    expect(hosts.map(host => host.signal.aborted)).toEqual([true, false]);
    a.tick(.016, 300); b.tick(.016, 300);
    expect(tick).toHaveBeenCalledTimes(3);
    unregister(); unregister();
    const revision = b.revision;
    b.tick(.016, 400);
    expect(b.revision).toBe(revision);
    expect(released).toHaveBeenCalledTimes(2);
    const replacement = vi.fn(() => () => {});
    register('pier', replacement);
    unregister();
    expect(replacement).toHaveBeenCalledOnce();
    expect(hosts.every(host => host.signal.aborted)).toBe(true);
  });

  it('supports callback removal during ticks, ignores callbacks added after unregister and redraws frozen clocks only while animated', () => {
    const source = owner(), layers = source.mount(), tick = vi.fn(), removedTick = vi.fn();
    let host: KingdomLayerMount | undefined, stop = () => {};
    const unregister = register('pier', value => {
      host = value;
      value.onTick(() => { tick(); stop(); });
      stop = value.onTick(removedTick);
      return () => { expect(value.signal.aborted).toBe(true); value.onTick(removedTick); };
    });
    const initial = layers.revision;
    layers.tick(.016, 100);
    expect(layers.revision).toBeGreaterThan(initial);
    expect(tick).toHaveBeenCalledOnce();
    expect(removedTick).not.toHaveBeenCalled();
    unregister();
    host!.onTick(removedTick);
    const final = layers.revision;
    layers.tick(.016, 200);
    expect(layers.revision).toBe(final);
    expect(removedTick).not.toHaveBeenCalled();
  });

  it('unsubscribes each mount even when the same callback belongs to another layer', () => {
    const source = owner(), layers = source.mount(), tick = vi.fn();
    const first = register('pier', host => { host.onTick(tick); return () => {}; });
    register('mist', host => { host.onTick(tick); return () => {}; });
    layers.tick(.016, 100);
    expect(tick).toHaveBeenCalledTimes(2);
    first(); layers.tick(.016, 200);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('rolls back a failed scene initialization, aborts partial ticks and removes newly attached roots', () => {
    const source = owner(), existing = new Group(), root = new Group(), released = vi.fn(), tick = vi.fn();
    source.context.scene.add(existing);
    let partial: KingdomLayerMount | undefined;
    register('mist', () => released);
    const bad = register('pier', host => {
      partial = host; host.scene.add(root); host.onTick(tick);
      throw new Error('pier initialization failed');
    });
    expect(source.mount).toThrow('pier initialization failed');
    expect(released).toHaveBeenCalledOnce();
    expect(root.parent).toBeNull();
    expect(existing.parent).toBe(source.context.scene);
    expect(partial!.signal.aborted).toBe(true);
    bad();
    const next = vi.fn(() => () => {});
    register('next', next);
    expect(next).not.toHaveBeenCalled();
    source.mount();
    expect(next).toHaveBeenCalledOnce();
  });

  it('rolls back late registration across scenes when the second scene rejects it', () => {
    const first = owner(), second = owner('999000002'), a = first.mount(), b = second.mount();
    const tick = vi.fn(), hosts: KingdomLayerMount[] = [], roots: Group[] = [];
    expect(() => register('pier', host => {
      hosts.push(host); const root = new Group(); roots.push(root); host.scene.add(root); host.onTick(tick);
      if (host.kingdomId === second.context.founded.kingdomId) throw new Error('second failed');
      return () => root.removeFromParent();
    })).toThrow('second failed');
    expect(hosts.every(host => host.signal.aborted)).toBe(true);
    expect(roots.every(root => root.parent === null)).toBe(true);
    a.tick(.016, 100); b.tick(.016, 100);
    expect(tick).not.toHaveBeenCalled();
    const retry = vi.fn(() => () => {});
    register('pier', retry);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('does not initialize aborted hosts and releases a disposer returned after an initializer aborts', () => {
    const closed = owner(), init = vi.fn(() => () => {});
    closed.abort.abort(); closed.mount(); register('mist', init);
    expect(init).not.toHaveBeenCalled();
    const source = owner(), released = vi.fn(), tick = vi.fn();
    register('pier', host => { host.onTick(tick); source.abort.abort(); return released; });
    const layers = source.mount();
    layers.tick(.016, 100); layers.dispose();
    expect(released).toHaveBeenCalledOnce();
    expect(tick).not.toHaveBeenCalled();
  });

  it('continues reverse teardown after a disposer fails and never calls any tick while disposing', () => {
    const source = owner(), order: string[] = [], tick = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    keep(() => error.mockRestore());
    register('mist', host => { host.onTick(tick); return () => { order.push('mist'); layers.tick(0, 0); }; });
    register('pier', host => { host.onTick(tick); return () => { order.push('pier'); throw new Error('cleanup failed'); }; });
    const layers = source.mount(); layers.dispose(); layers.dispose();
    expect(order).toEqual(['pier', 'mist']);
    expect(tick).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
  });

  it('queries the actual visible water surface across replacement, wet/dry cells and the unknown boundary without GL', () => {
    const source = owner();
    let host: KingdomLayerMount | undefined;
    register('pier', value => { host = value; return () => {}; });
    const ground = { data: new Float32Array(16).fill(-2), width: 4, height: 4, origin: [-10, -20] as const, step: 2 };
    const legacy = createWaterSurface({ ground, bodies: [{ id: 'lake', x: -8, z: -18, radiusX: 8, radiusZ: 8, level: 0, depth: 2 }], reaches: [], quality: 'reduced' });
    keep(legacy.dispose); source.replaceWater(legacy); source.mount();
    expect(host!.waterHeight(-8, -18)).toBe(0);
    legacy.root.visible = false;
    expect(host!.waterHeight(-8, -18)).toBeNull();
    const replacement = createWaterSurface({ ground, raster: { levels: new Float32Array([
      1, 1, 2, 2, 1, NaN, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2,
    ]), seaLevel: 0 }, bodies: [], reaches: [], quality: 'reduced' });
    keep(replacement.dispose); source.replaceWater(replacement);
    expect(host!.waterHeight(-10, -20)).toBe(1);
    expect(host!.waterHeight(-8, -18)).toBeNull();
    expect(host!.waterHeight(-6, -18)).toBe(2);
    expect(host!.waterHeight(-2.01, -12.01)).toBe(2);
    expect(host!.waterHeight(-2, -12)).toBeNull();
    expect(host!.waterHeight(-10.1, -20)).toBeNull();
    replacement.root.removeFromParent();
    expect(host!.waterHeight(-6, -18)).toBeNull();
  });

  it('rejects empty/duplicate registrations and never mounts a founded scene without an identity', () => {
    expect(() => registerKingdomLayer(' ', () => () => {})).toThrow('needs an id');
    register('pier', () => () => {});
    expect(() => registerKingdomLayer('pier', () => () => {})).toThrow('already registered');
    const source = owner();
    expect(() => createKingdomLayers({ ...source.context, founded: { ...source.context.founded, kingdomId: '' as RealmFoundedScene['kingdomId'] } })).toThrow('founded kingdom identity');
  });
});
