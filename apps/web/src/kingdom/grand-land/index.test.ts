import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettlementPlan } from '@chatdom/world';
import { RealmFoundedManifestSchema } from '@chatdom/shared/realm';
import type { GrandLandRecipe } from '../../../../../packages/world/src/grand/recipe';
import { BAKED_COMPILERS, BAKED_REGION_QUAD_BYTES, type BakedMetadata, type BakedRegionMesh, type BakedRegionRef } from '../../../../../packages/world/src/grand/baked/types';
import { canonicalSceneJson, sha256Hex, utf8 } from '../../../../../packages/world/src/founded-world/codec';
import { openBakedLand, type BakedLandSource } from './baked-client';
import { prepareHostedGrandLand, type HostedGrandLand } from './index';
import { groundSample } from '../../places/water/surface/coverage';
import { rasterLevel } from '../../places/water/surface/raster';

vi.mock('./baked-client', () => ({ openBakedLand: vi.fn() }));
const owners: HostedGrandLand[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.resetAllMocks(); });
const hash = 'a'.repeat(64);
const receipt = RealmFoundedManifestSchema.parse({ version: 1, kingdomId: '129634568', origin: 'live', layoutRevision: 'test-plan', collisionRevision: 7, sceneHash: hash });
// Only canonical identity is consumed here; settlement geometry belongs to the scene host's tests.
const plan = { revision: 'test-plan' } as SettlementPlan;
const recipe: GrandLandRecipe = { version: 1, generator: 'grand-land-1', kit: 'grand-artisans-1',
  grader: 'gk11-grade-3', mesher: 'hosted-grand-land-2', seed: { kingdomId: receipt.kingdomId,
    seedKey: `kingdom:${receipt.kingdomId}`, name: 'Renderer fixture', biome: 'meadow', tier: 'hamlet', character: 'coastal-harbour' },
  frame: { envelope: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 }, centre: [8, 8], waterLevel: 0,
    seaward: null, castle: { centre: [8, 0, 8], bounds: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 } } } };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function fixture(exacts: readonly number[] = [1, 3], side = 2, quadCount = 65536) {
  const ref = { hash, gzipHash: hash, rawBytes: 64 + quadCount * 8, gzipBytes: 64, minY: 0, maxY: 32, quadCount };
  const regions = Array.from({ length: side * side }, (_, i) => {
    const rx = i % side, rz = Math.floor(i / side), exact = exacts.includes(i);
    return { rx, rz, exact, bounds: { min: [rx * 128 - 16, -5, rz * 128 - 32] as const,
      max: [(rx + 1) * 128 - 16, 11, (rz + 1) * 128 - 32] as const },
    meshes: Array.from({ length: exact ? 1 : 4 }, (_, level) => ({ ...ref, level, rx, rz })) };
  });
  const metadata: BakedMetadata = { version: 1, kingdomId: receipt.kingdomId, recipeHash: hash,
    sourcePlanHash: hash, sourcePlanRevision: plan.revision, compilers: BAKED_COMPILERS,
    size: side * 256, height: 32, seaLevel: 10, seat: { offset: [16, 5, 32], columns: { x0: 32, z0: 64, x1: 64, z1: 96 }, band: 96 },
    physicalRegion: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 }, bounds: { min: [-16, -5, -32], max: [240, 11, 224] },
    palette: [{ id: 1, colour: '#7eaa55', kind: 0 }], surface: ref, regions };
  const pending: { ref: BakedRegionRef; signal: AbortSignal | undefined; result: ReturnType<typeof deferred<BakedRegionMesh>> }[] = [];
  const source: BakedLandSource = { metadata,
    surface: { size: side * 256, height: 32, seaLevel: 10, ground: new Uint16Array((side * 256) ** 2).fill(8), water: new Uint16Array((side * 256) ** 2).fill(10) },
    stats: { phase: 'ready', networkBytes: 64, cacheBytes: 0, verifiedRawBytes: 72, completedBlobs: 1,
      cacheHits: 0, cacheCorruptions: 0, activeRequests: 0, queuedRequests: 0, pendingCompressedBytes: 0 },
    mesh: vi.fn((ref: BakedRegionRef, signal?: AbortSignal) => {
      const result = deferred<BakedRegionMesh>(); pending.push({ ref, signal, result }); return result.promise;
    }), dispose: vi.fn() };
  vi.mocked(openBakedLand).mockResolvedValue(source);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, 1.6, .1, 10000);
  camera.position.set(112, 150, 400); camera.lookAt(112, 0, 90); camera.updateMatrixWorld();
  const material = new THREE.ShaderMaterial(), cleanup = vi.fn(), register = vi.fn(() => cleanup);
  const options = { scene, camera, renderer: { getDrawingBufferSize: (size: THREE.Vector2) => size.set(1440, 900) } as THREE.WebGLRenderer,
    plan, recipe, receipt, kingdomId: receipt.kingdomId, materialFactory: vi.fn(() => ({ material, bindFade: vi.fn(), setTownUse: vi.fn(), dispose: vi.fn(() => material.dispose()) })),
    register, onProgress: vi.fn(), onError: vi.fn() };
  async function prepare(extra: Partial<typeof options> & { signal?: AbortSignal } = {}) {
    const owner = await prepareHostedGrandLand({ ...options, ...extra }); owners.push(owner); return owner;
  }
  async function start(extra: Parameters<typeof prepare>[0] = {}) {
    const owner = await prepare(extra); owner.update(performance.now()); return owner;
  }
  return { source, pending, scene, camera, options, prepare, start, register, cleanup };
}
function mesh(ref: BakedRegionRef, bytes = 8): BakedRegionMesh {
  const count = bytes / 8;
  return { level: ref.level, rx: ref.rx, rz: ref.rz, minY: 0, maxY: 32,
    quads: new Uint32Array(count * 2), offsets: new Int32Array([0, count, count, count, count, count, count]) };
}

describe('baked terrain renderer scheduling', () => {
  it('binds the exact receipt and previous canonical parameter identity, palette, height and water', async () => {
    const f = fixture(), owner = await f.start();
    const recipeHash = await sha256Hex(utf8(canonicalSceneJson(recipe)));
    expect(openBakedLand).toHaveBeenCalledWith({ expected: { kingdomId: receipt.kingdomId, sceneHash: receipt.sceneHash,
      layoutRevision: receipt.layoutRevision, collisionRevision: receipt.collisionRevision,
      sourcePlanHash: await sha256Hex(utf8(canonicalSceneJson(plan))), recipeHash }, signal: expect.any(AbortSignal) });
    expect(owner.identity.parameterHash).toBe(await sha256Hex(utf8(canonicalSceneJson({ recipeHash, plan }))));
    expect(f.options.materialFactory).toHaveBeenCalledWith(f.source.metadata.palette, f.source.metadata.physicalRegion);
    expect(owner.bounds.min.toArray()).toEqual([-16, -5, -32]);
    expect(owner.height(0, 0)).toBe(-1); expect(owner.height(-17, 0)).toBeNull();
    expect(owner.water.ground.origin).toEqual([-16, -32]); expect(groundSample(owner.water.ground, 0)).toBe(-1);
    expect(rasterLevel(owner.water.raster, 0)).toBe(0); expect(owner.water.raster.seaLevel).toBe(0);
    expect(owner.water.ground.data).toBe(f.source.surface.ground);
    expect(owner.water.raster.levels).toBe(f.source.surface.water);
    expect(owner.stats).toMatchObject({ surfaceBytes: 512 ** 2 * 4, waterRasterExtraBytes: 0 });
    expect(owner.stats).toMatchObject({ generatedColumns: 0, workers: 0, networkBytes: 64 });
    expect(f.scene.children[0]!.position.toArray()).toEqual([-16, -5, -32]);
  });

  it('requests the physical L0 regions at open, before any camera, and reserves their exact decoded size', async () => {
    const f = fixture(), owner = await f.prepare();
    // The installed streets are asked for as soon as the source opens, nearest the town centre first.
    expect(f.pending.map(p => [p.ref.rx, p.ref.rz, p.ref.level])).toEqual([[1, 0, 0], [1, 1, 0]]);
    owner.update(performance.now());
    // The first update takes those two over and asks for the rest of the view, at most six at a time.
    expect(f.pending.length).toBeGreaterThan(2); expect(f.pending.length).toBeLessThanOrEqual(6);
    expect(owner.stats.busy).toBe(f.pending.length);
    for (const p of f.pending) p.result.resolve(mesh(p.ref)); await flush();
    let now = performance.now();
    for (let i = 0; i < 100 && owner.stats.covered < 2; i++) owner.update(now += 10);
    const root = f.scene.children[0]!;
    expect(root.children[0]!.scale.toArray()).toEqual([.5, .5, .5]);
    expect(root.children[0]!.position.x).toBe(128);
  });

  it('never holds more than 16 MiB of decoded results, counting early requests and pending installs', async () => {
    const f = fixture([1, 3], 2, BAKED_REGION_QUAD_BYTES / 8), owner = await f.prepare();
    expect(f.pending).toHaveLength(2);
    owner.update(performance.now());
    expect(f.pending).toHaveLength(2); expect(owner.stats.busy).toBe(2);
    for (const p of f.pending) p.result.resolve(mesh(p.ref, BAKED_REGION_QUAD_BYTES));
    await flush();
    let now = performance.now();
    owner.update(now += 10);
    expect(f.pending).toHaveLength(2); expect(owner.stats.covered).toBe(0);
    expect(owner.stats.resultBytes).toBe(16 * 1024 * 1024);
    for (let i = 0; i < 100 && f.pending.length === 2; i++) owner.update(now += 10);
    expect(f.pending.length).toBeGreaterThan(2);
    expect(owner.stats.covered).toBeGreaterThan(0);
    expect(owner.stats.resultBytes + owner.stats.busy * BAKED_REGION_QUAD_BYTES).toBeLessThanOrEqual(16 * 1024 * 1024);
  });

  it('rejects a decoded region larger than its reference names', async () => {
    const f = fixture([1, 3], 2, 1), owner = await f.prepare(), failure = expect(owner.ready).rejects.toThrow('mesh result budget');
    owner.update(performance.now());
    f.pending[0]!.result.resolve(mesh(f.pending[0]!.ref, 16)); await flush(); await failure;
    expect(f.scene.children).toHaveLength(0);
  });

  it('uses the first update camera for required coverage and never coarsens off-camera physical floor', async () => {
    const f = fixture(), owner = await f.prepare();
    expect(f.pending).toHaveLength(2);
    f.camera.position.set(1000, 100, 1000); f.camera.lookAt(2000, 100, 2000);
    owner.update(performance.now());
    expect(f.pending).toHaveLength(2); expect(f.pending.every(p => p.ref.level === 0 && p.ref.rx === 1)).toBe(true);
    for (const p of f.pending) p.result.resolve(mesh(p.ref)); await flush();
    let now = performance.now();
    for (let i = 0; i < 12 && owner.stats.phase !== 'ready'; i++) owner.update(now += 50);
    await owner.ready; expect(owner.stats.covered).toBe(2);
    owner.update(now + 1000); owner.update(now + 2000);
    expect(f.pending).toHaveLength(2); expect(owner.stats.covered).toBe(2);
  });

  it('opens only after required visible coverage has actually installed', async () => {
    const f = fixture(), owner = await f.start(); let ready = false;
    void owner.ready.then(() => { ready = true; });
    let now = performance.now(), answered = 0;
    expect(ready).toBe(false);
    for (let i = 0; i < 20 && !ready; i++) {
      while (answered < f.pending.length) { const p = f.pending[answered++]!; p.result.resolve(mesh(p.ref)); }
      await flush(); owner.update(now += 50); await flush();
    }
    expect(ready).toBe(true); expect(owner.stats.phase).toBe('ready');
    expect(owner.stats.covered).toBe(4); expect(f.options.onProgress).toHaveBeenLastCalledWith(1);
  });

  it('keeps old coverage until every replacement installs, then fades complementary pairs for 400ms', async () => {
    const f = fixture([]), owner = await f.start();
    let now = performance.now(), answered = 0;
    for (let i = 0; i < 30 && owner.stats.phase !== 'ready'; i++) {
      while (answered < f.pending.length) { const p = f.pending[answered++]!; p.result.resolve(mesh(p.ref)); }
      await flush(); owner.update(now += 50);
    }
    await owner.ready;
    expect(owner.canPresent()).toBe(true);
    const root = f.scene.children[0]!, before = new Set(root.children);
    owner.markPresented(); owner.update(now += 200);
    expect(f.pending.length).toBeGreaterThan(answered);
    expect(f.pending[answered]!.ref.level).toBe(2);
    f.pending[answered]!.result.resolve(mesh(f.pending[answered]!.ref, 512 * 1024)); answered++;
    await flush(); owner.update(now += 10);
    expect(new Set(root.children)).toEqual(before);
    for (let i = 0; i < 40 && owner.stats.fadingRegions === 0; i++) {
      while (answered < f.pending.length) { const p = f.pending[answered++]!; p.result.resolve(mesh(p.ref)); }
      await flush(); owner.update(now += 10);
    }
    expect(owner.stats.fadingRegions).toBeGreaterThan(0);
    expect([...before].every(group => root.children.includes(group))).toBe(true);
    expect(f.register.mock.calls.length).toBeGreaterThan(before.size);
    expect(f.cleanup).not.toHaveBeenCalled();
    owner.update(now += 200);
    const fade = root.children.flatMap(group => group.children.map(child => child.userData.grandLodFade as number));
    expect(fade.some(value => Math.abs(value - 0.5) < 1e-6)).toBe(true);
    expect(fade.some(value => Math.abs(value + 1.5) < 1e-6)).toBe(true);
    owner.update(now + 201);
    expect([...before].every(group => !root.children.includes(group))).toBe(true);
    expect(f.cleanup).toHaveBeenCalled();
    const cleaned = f.cleanup.mock.calls.length;
    owner.dispose();
    expect(f.cleanup.mock.calls.length).toBeGreaterThan(cleaned);
  });

  it('loads a newly visible region at its balanced baseline before refining alongside displayed neighbours', async () => {
    let reveal = false;
    const frustum = vi.spyOn(THREE.Frustum.prototype, 'intersectsBox').mockImplementation(box => {
      const rx = (box.min.x + 16) / 128, rz = (box.min.z + 32) / 128;
      return rx === 2 && rz === 2 || reveal && rx === 1 && rz === 1;
    });
    try {
      const f = fixture([0], 3), owner = await f.start();
      let now = performance.now(), answered = 0;
      for (let i = 0; i < 40 && owner.stats.phase !== 'ready'; i++) {
        while (answered < f.pending.length) { const p = f.pending[answered++]!; p.result.resolve(mesh(p.ref)); }
        await flush(); owner.update(now += 50);
      }
      await owner.ready; expect(owner.canPresent()).toBe(true);
      const b = f.pending.find(p => p.ref.rx === 2 && p.ref.rz === 2);
      expect(b?.ref.level).toBe(2);
      owner.markPresented();
      reveal = true;
      f.camera.position.set(128, 15, 128); f.camera.lookAt(150, 0, 150);
      const displayed = () => f.scene.children[0]!.children.map(group => ({
        rx: group.position.x / 128, rz: group.position.z / 128, level: Math.log2(group.scale.x / .5),
        fade: group.children[0]?.userData.grandLodFade as number,
      }));
      let sawBaseline = false, sawFade = false;
      for (let i = 0; i < 80 && !sawFade; i++) {
        owner.update(now += 25);
        while (answered < f.pending.length) { const p = f.pending[answered++]!; p.result.resolve(mesh(p.ref)); }
        await flush();
        const levels = displayed(), aLevels = levels.filter(item => item.rx === 1 && item.rz === 1);
        const bLevels = levels.filter(item => item.rx === 2 && item.rz === 2);
        if (aLevels.length) {
          if (!sawBaseline) {
            expect(aLevels.some(item => item.level === 1)).toBe(true);
            sawBaseline = true;
          }
          for (const a of aLevels) for (const neighbour of bLevels) {
            if ((a.fade < 0) === (neighbour.fade < 0)) expect(Math.abs(a.level - neighbour.level)).toBeLessThanOrEqual(1);
          }
          if (aLevels.some(item => item.fade < 0)) sawFade = true;
        }
      }
      expect(sawBaseline).toBe(true); expect(sawFade).toBe(true);
      expect(f.pending.some(p => p.ref.rx === 1 && p.ref.rz === 1 && p.ref.level === 1)).toBe(true);
    } finally { frustum.mockRestore(); }
  });

  it('extends startup coverage when the camera moves before presentation and waits for acknowledgement before refining', async () => {
    const f = fixture(), owner = await f.prepare();
    f.camera.position.set(1000, 100, 1000); f.camera.lookAt(2000, 100, 2000);
    let now = performance.now(), answered = 0;
    owner.markPresented();
    owner.update(now += 50);
    for (let i = 0; i < 30 && owner.stats.phase !== 'ready'; i++) {
      while (answered < f.pending.length) { const p = f.pending[answered++]!; p.result.resolve(mesh(p.ref)); }
      await flush(); owner.update(now += 50);
    }
    await owner.ready;
    expect(owner.stats.startupPhase).toBe('awaiting-presentation');
    expect(owner.canPresent()).toBe(true);
    expect(owner.stats.initialRequiredRegions).toBe(2);
    f.camera.position.set(112, 150, 400); f.camera.lookAt(112, 0, 90);
    expect(owner.canPresent()).toBe(false);
    expect(owner.stats.initialRequiredRegions).toBeGreaterThan(2);
    owner.markPresented();
    expect(owner.stats.startupPhase).toBe('loading');
    for (let i = 0; i < 30 && !owner.canPresent(); i++) {
      owner.update(now += 50);
      while (answered < f.pending.length) { const p = f.pending[answered++]!; p.result.resolve(mesh(p.ref)); }
      await flush();
    }
    expect(owner.canPresent()).toBe(true);
    const before = f.pending.length;
    for (let i = 0; i < 5; i++) { owner.update(now += 100); await flush(); }
    expect(f.pending).toHaveLength(before);
    expect(owner.stats.initialCoverageReady).toBe(true);
    Object.assign(f.source.stats, { networkBytes: 99, cacheBytes: 22 });
    expect(owner.canPresent()).toBe(true);
    expect(owner.stats.initialActualBytes).toBe(121);
    owner.markPresented();
    expect(owner.stats.startupPhase).not.toBe('awaiting-presentation');
    Object.assign(f.source.stats, { networkBytes: 500, cacheBytes: 100 });
    owner.update(now + 100);
    expect(owner.stats.initialActualBytes).toBe(121);
    expect(owner.stats.initialNetworkBytes).toBe(99);
  });

  it('disposes a source that finishes opening after the scene was aborted', async () => {
    const f = fixture(), abort = new AbortController(), opening = deferred<BakedLandSource>();
    vi.mocked(openBakedLand).mockReturnValueOnce(opening.promise);
    const preparation = f.start({ signal: abort.signal });
    const failure = expect(preparation).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(openBakedLand).toHaveBeenCalledOnce());
    abort.abort(); opening.resolve(f.source); await failure;
    expect(f.source.dispose).toHaveBeenCalledOnce(); expect(f.scene.children).toHaveLength(0);
  });

  it('aborts requests, rejects readiness and ignores late completion after disposal', async () => {
    const f = fixture(), abort = new AbortController(), owner = await f.start({ signal: abort.signal });
    const failure = expect(owner.ready).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort(); await failure;
    for (const p of f.pending) { expect(p.signal?.aborted).toBe(true); p.result.resolve(mesh(p.ref)); }
    await flush(); owner.update(performance.now());
    expect(f.scene.children).toHaveLength(0); expect(owner.stats.phase).toBe('disposed');
    expect(owner.stats.busy).toBe(0); expect(f.source.dispose).toHaveBeenCalledOnce();
    expect(f.options.onError).not.toHaveBeenCalled();
  });

  it('rejects missing artifacts and mesh failures without any generation fallback', async () => {
    const f = fixture(); vi.mocked(openBakedLand).mockRejectedValueOnce(new Error('Land is not baked'));
    await expect(f.start()).rejects.toThrow('Land is not baked'); expect(f.scene.children).toHaveLength(0);
    const owner = await f.start(), failure = expect(owner.ready).rejects.toThrow('Corrupt region');
    f.pending[0]!.result.reject(new Error('Corrupt region')); await flush(); await failure;
    f.pending[1]!.result.resolve(mesh(f.pending[1]!.ref)); await flush();
    expect(owner.stats.phase).toBe('failed'); expect(f.scene.children).toHaveLength(0);
    expect(f.options.onError).toHaveBeenCalledOnce(); expect(f.source.dispose).toHaveBeenCalledOnce();
  });
});
