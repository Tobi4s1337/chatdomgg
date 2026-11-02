import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettlementPlan } from '@chatdom/world';
import { RealmFoundedManifestSchema } from '@chatdom/shared/realm';
import type { GrandLandRecipe } from '../../../../../packages/world/src/grand/recipe';
import { BAKED_COMPILERS, BAKED_REGION_QUAD_BYTES, type BakedMetadata, type BakedRegionMesh, type BakedRegionRef } from '../../../../../packages/world/src/grand/baked/types';
import { canonicalSceneJson, sha256Hex, utf8 } from '../../../../../packages/world/src/founded-world/codec';
import { openBakedLand, type BakedLandSource } from './baked-client';
import { prepareHostedGrandLand, type HostedGrandLand } from './index';

vi.mock('./baked-client', () => ({ openBakedLand: vi.fn() }));
const owners: HostedGrandLand[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.resetAllMocks(); });
const hash = 'a'.repeat(64);
const receipt = RealmFoundedManifestSchema.parse({ version: 1, kingdomId: '129634568', origin: 'live', layoutRevision: 'test-plan', collisionRevision: 7, sceneHash: hash });
// Only canonical identity is consumed here; settlement geometry belongs to the scene host's tests.
const plan = { revision: 'test-plan' } as SettlementPlan;
const recipe: GrandLandRecipe = { version: 1, generator: 'grand-land-1', kit: 'grand-artisans-1',
  grader: 'gk11-grade-2', mesher: 'hosted-grand-land-2', seed: { kingdomId: receipt.kingdomId,
    seedKey: `kingdom:${receipt.kingdomId}`, name: 'Renderer fixture', biome: 'meadow', tier: 'hamlet', character: 'coastal-harbour' },
  frame: { envelope: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 }, centre: [8, 8], waterLevel: 0,
    seaward: null, castle: { centre: [8, 0, 8], bounds: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 } } } };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function fixture(exacts: readonly number[] = [1, 3]) {
  const ref = { hash, gzipHash: hash, rawBytes: 72, gzipBytes: 64, minY: 0, maxY: 32, quadCount: 1 };
  const regions = Array.from({ length: 4 }, (_, i) => {
    const rx = i % 2, rz = Math.floor(i / 2), exact = exacts.includes(i);
    return { rx, rz, exact, bounds: { min: [rx * 128 - 16, -5, rz * 128 - 32] as const,
      max: [(rx + 1) * 128 - 16, 11, (rz + 1) * 128 - 32] as const },
    meshes: Array.from({ length: exact ? 1 : 4 }, (_, level) => ({ ...ref, level, rx, rz })) };
  });
  const metadata: BakedMetadata = { version: 1, kingdomId: receipt.kingdomId, recipeHash: hash,
    sourcePlanHash: hash, sourcePlanRevision: plan.revision, compilers: BAKED_COMPILERS,
    size: 512, height: 32, seaLevel: 10, seat: { offset: [16, 5, 32], columns: { x0: 32, z0: 64, x1: 64, z1: 96 }, band: 96 },
    physicalRegion: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 }, bounds: { min: [-16, -5, -32], max: [240, 11, 224] },
    palette: [{ id: 1, colour: '#7eaa55', kind: 0 }], surface: ref, regions };
  const pending: { ref: BakedRegionRef; signal: AbortSignal | undefined; result: ReturnType<typeof deferred<BakedRegionMesh>> }[] = [];
  const source: BakedLandSource = { metadata,
    surface: { size: 512, height: 32, seaLevel: 10, ground: new Uint16Array(512 ** 2).fill(8), water: new Uint16Array(512 ** 2).fill(10) },
    stats: { phase: 'ready', networkBytes: 64, cacheBytes: 0, verifiedRawBytes: 72, completedBlobs: 1,
      cacheHits: 0, cacheCorruptions: 0, activeRequests: 0, queuedRequests: 0, pendingCompressedBytes: 0 },
    mesh: vi.fn((ref: BakedRegionRef, signal?: AbortSignal) => {
      const result = deferred<BakedRegionMesh>(); pending.push({ ref, signal, result }); return result.promise;
    }), dispose: vi.fn() };
  vi.mocked(openBakedLand).mockResolvedValue(source);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, 1.6, .1, 10000);
  camera.position.set(112, 150, 400); camera.lookAt(112, 0, 90); camera.updateMatrixWorld();
  const material = new THREE.ShaderMaterial();
  const options = { scene, camera, renderer: { getDrawingBufferSize: (size: THREE.Vector2) => size.set(1440, 900) } as THREE.WebGLRenderer,
    plan, recipe, receipt, kingdomId: receipt.kingdomId, materialFactory: vi.fn(() => ({ material, dispose: vi.fn(() => material.dispose()) })),
    onProgress: vi.fn(), onError: vi.fn() };
  async function prepare(extra: Partial<typeof options> & { signal?: AbortSignal } = {}) {
    const owner = await prepareHostedGrandLand({ ...options, ...extra }); owners.push(owner); return owner;
  }
  async function start(extra: Parameters<typeof prepare>[0] = {}) {
    const owner = await prepare(extra); owner.update(performance.now()); return owner;
  }
  return { source, pending, scene, camera, options, prepare, start };
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
    expect(f.options.materialFactory).toHaveBeenCalledWith(f.source.metadata.palette);
    expect(owner.bounds.min.toArray()).toEqual([-16, -5, -32]);
    expect(owner.height(0, 0)).toBe(-1); expect(owner.height(-17, 0)).toBeNull();
    expect(owner.water.ground.origin).toEqual([-16, -32]); expect(owner.water.ground.data[0]).toBe(-1);
    expect(owner.water.levels[0]).toBe(0); expect(owner.water.seaLevel).toBe(0);
    expect(owner.stats).toMatchObject({ generatedColumns: 0, workers: 0, networkBytes: 64 });
    expect(f.scene.children[0]!.position.toArray()).toEqual([-16, -5, -32]);
  });

  it('prioritizes every physical L0 region and reserves decoded space until installation finishes', async () => {
    const f = fixture(), owner = await f.start();
    expect(f.pending).toHaveLength(2);
    expect(f.pending.map(p => [p.ref.rx, p.ref.rz, p.ref.level])).toEqual([[1, 1, 0], [1, 0, 0]]);
    for (const p of f.pending) p.result.resolve(mesh(p.ref, BAKED_REGION_QUAD_BYTES));
    await flush();
    let now = performance.now();
    owner.update(now += 10);
    expect(f.pending).toHaveLength(2); expect(owner.stats.covered).toBe(0);
    expect(owner.stats.resultBytes).toBe(16 * 1024 * 1024);
    for (let i = 0; i < 100 && f.pending.length === 2; i++) owner.update(now += 10);
    expect(f.pending.length).toBeGreaterThan(2);
    expect(owner.stats.covered).toBeGreaterThan(0);
    const root = f.scene.children[0]!;
    expect(root.children[0]!.scale.toArray()).toEqual([.5, .5, .5]);
    expect(root.children[0]!.position.x).toBe(128);
    expect(owner.stats.resultBytes + owner.stats.busy * BAKED_REGION_QUAD_BYTES).toBeLessThanOrEqual(16 * 1024 * 1024);
  });

  it('uses the first update camera for required coverage and never coarsens off-camera physical floor', async () => {
    const f = fixture(), owner = await f.prepare();
    expect(f.pending).toHaveLength(0);
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

  it('keeps old coverage on screen until every replacement face has installed', async () => {
    const f = fixture(), owner = await f.start();
    let now = performance.now(), answered = 0;
    for (let i = 0; i < 12 && owner.stats.phase !== 'ready'; i++) {
      while (answered < f.pending.length) { const p = f.pending[answered++]!; p.result.resolve(mesh(p.ref)); }
      await flush(); owner.update(now += 50);
    }
    await owner.ready;
    const root = f.scene.children[0]!, before = new Set(root.children);
    f.camera.position.set(112, 1500, 4000); f.camera.lookAt(112, 0, 90);
    owner.update(now += 200); owner.update(now += 600);
    const replacement = f.pending[answered]!;
    expect(replacement.ref.level).toBe(1);
    const old = root.children.find(group => group.position.x === replacement.ref.rx * 128 && group.position.z === replacement.ref.rz * 128)!;
    replacement.result.resolve(mesh(replacement.ref, 512 * 1024)); await flush();
    owner.update(now += 10);
    expect(root.children).toContain(old); expect(new Set(root.children)).toEqual(before);
    for (let i = 0; i < 12 && root.children.includes(old); i++) owner.update(now += 10);
    expect(root.children).not.toContain(old); expect(root.children).toHaveLength(4);
    expect(root.children.some(group => group.position.equals(old.position) && group.scale.x === 1)).toBe(true);
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
