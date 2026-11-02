import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { VOXEL_METRES, type KingdomId, type Vec3 } from '@chatdom/shared';
import { transformCardinalPoint, type RealmFoundedScene } from '@chatdom/world';
import { PIER_REVIEW_SITE } from '../../../../packages/content/src/places/water/pier';
import { createFishingPier } from '../../../../packages/content/src/pier/layout';
import { claimPierScene, registerPierKingdomLayer, type PierKingdomHost } from './kingdom-layer';
import type { PierLayer, PierLayerHost } from './layer';

const CELL = VOXEL_METRES.build;
type Founded = Pick<RealmFoundedScene, 'assets' | 'placements'>;
const content = createFishingPier('tide', PIER_REVIEW_SITE);
const place = (at: Vec3) => transformCardinalPoint([40, 1, 12], 1, [(at[0] - 10) * CELL, at[1] * CELL, at[2] * CELL]);
const founded: Founded = {
  assets: content.modules.map(module => ({ assetHash: module.id, blueprint: module.blueprint })) as Founded['assets'],
  placements: content.modules.map(module => ({ id: `pier:lake:${module.id}`, assetHash: module.id, position: place(module.offset), rotation: 1 })) as Founded['placements'],
};
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function fakeHost(options: { mode?: PierKingdomHost['mode']; water?: () => number | null; founded?: Founded } = {}) {
  const ticks = new Set<(dt: number, now: number) => void>(), abort = new AbortController();
  const host: PierKingdomHost = {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), mode: options.mode ?? 'stream', kingdomId: '129634568' as KingdomId,
    founded: options.founded ?? founded, hour: () => 18.6, waterHeight: options.water ?? (() => .25),
    onTick(listener) { ticks.add(listener); return () => { ticks.delete(listener); }; }, signal: abort.signal,
  };
  let now = 0;
  const tick = (ms = 16) => { now += ms; for (const listener of [...ticks]) listener(ms / 1000, now); };
  return { host, tick, abort, ticks };
}
function fakeLayer() {
  const mounted: { options: PierLayerHost; layer: PierLayer & { updates: number; disposed: boolean } }[] = [];
  const layer = vi.fn(async (options: PierLayerHost) => {
    const entry = { updates: 0, disposed: false, update() { entry.updates++; }, stats: () => ({ draws: 1, triangles: 8, fishers: 0, phase: null }), dispose() { entry.disposed = true; } };
    mounted.push({ options, layer: entry });
    return entry;
  });
  return { layer, mounted };
}
function mountWith(host: PierKingdomHost, layer: ReturnType<typeof fakeLayer>['layer']) {
  let unmount: () => void = () => {};
  const unregister = registerPierKingdomLayer((id, mount) => { expect(id).toBe('pier'); unmount = mount(host); return () => unmount(); }, layer);
  return { unregister, unmount: () => unmount() };
}

describe("the pier's lanterns in a watched kingdom", () => {
  it('draws the installed lanterns and mood on stream, with no fisher, input, sound or interface', async () => {
    const { host, tick } = fakeHost(), { layer, mounted } = fakeLayer();
    mountWith(host, layer);
    tick(); await settle(); tick();
    expect(mounted).toHaveLength(1);
    const { options } = mounted[0]!;
    expect(options.controller).toBeNull(); expect(options.sound).toBeNull(); expect(options.ui).toBeNull(); expect(options.rack).toBeNull();
    expect(options.walkers()).toEqual([]);
    expect(options.lights).toHaveLength(content.lights.length);
    expect(options.site).toMatchObject({ turn: 1, waterY: .25, walk: PIER_REVIEW_SITE.walk * CELL });
    expect(['clear', 'breeze', 'mist', 'rain']).toContain(options.mood());
    expect(mounted[0]!.layer.updates).toBeGreaterThan(0);
  });

  it('waits for the drawn water under the head, asking again about once a second', async () => {
    let water: number | null = null;
    const ask = vi.fn(() => water);
    const { host, tick } = fakeHost({ water: ask }), { layer, mounted } = fakeLayer();
    mountWith(host, layer);
    for (let i = 0; i < 30; i++) tick(16);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(mounted).toHaveLength(0);
    water = -.5; tick(1000); await settle();
    expect(mounted).toHaveLength(1);
    expect(mounted[0]!.options.site.waterY).toBe(-.5);
  });

  it('mounts nothing for a kingdom without an installed pier', async () => {
    const { host, tick } = fakeHost({ founded: { assets: [], placements: [] } }), { layer } = fakeLayer();
    mountWith(host, layer);
    tick(); await settle();
    expect(layer).not.toHaveBeenCalled();
  });

  it('stands aside while a walk with a room draws the pier, and returns when it leaves', async () => {
    const { host, tick } = fakeHost({ mode: 'walking' }), { layer, mounted } = fakeLayer();
    mountWith(host, layer);
    tick(); await settle();
    expect(mounted).toHaveLength(1);
    const release = claimPierScene(host.scene);
    expect(mounted[0]!.layer.disposed).toBe(true);
    tick(2000); await settle();
    expect(mounted).toHaveLength(1);
    release(); release();
    tick(); await settle();
    expect(mounted).toHaveLength(2);
    expect(mounted[1]!.layer.disposed).toBe(false);
  });

  it('a walk that claims the scene while the lanterns are still meshing wins', async () => {
    const { host, tick } = fakeHost(), { layer, mounted } = fakeLayer();
    mountWith(host, layer);
    tick();
    const release = claimPierScene(host.scene);
    await settle();
    expect(mounted[0]!.layer.disposed).toBe(true);
    release();
  });

  it('releases everything on unmount and on abort', async () => {
    const first = fakeHost(), second = fakeHost(), { layer, mounted } = fakeLayer();
    const a = mountWith(first.host, layer);
    first.tick(); await settle();
    a.unmount();
    expect(mounted[0]!.layer.disposed).toBe(true);
    expect(first.ticks.size).toBe(0);
    mountWith(second.host, layer);
    second.tick(); await settle();
    second.abort.abort();
    expect(mounted[1]!.layer.disposed).toBe(true);
    expect(second.ticks.size).toBe(0);
  });
});
