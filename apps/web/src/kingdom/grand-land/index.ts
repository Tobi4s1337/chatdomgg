import * as THREE from 'three';
import type { SettlementPlan } from '@chatdom/world';
import type { RealmFoundedManifest } from '@chatdom/shared/realm';
import { createQuadGeometry } from '../../../../../packages/render/src/grand/quad-geometry';
import type { GrandMaterial } from '../../../../../packages/world/src/grand/palette';
import { GRAND_LEVELS, GRAND_REGION, type GrandLandSeed } from '../../../../../packages/world/src/grand/types';
import { balanceLevels, chooseLevel, type LodState } from '../../grand/lod';
import { HOSTED_GRAND_COMPILER, BAKED_REGION_QUAD_BYTES, type BakedMetadata, type BakedRegionRef, type BakedRegionMesh } from '../../../../../packages/world/src/grand/baked/types';
import { bakedNativeWater, bakedVisualHeight } from '../../../../../packages/world/src/grand/baked/surface';
import { openBakedLand, type BakedLandSource } from './baked-client';
import type { HostedGrandMaterial } from './material';
import type { GrandLandRecipe } from '../../../../../packages/world/src/grand/recipe';
import { canonicalSceneJson, sha256Hex, utf8 } from '../../../../../packages/world/src/founded-world/codec';
export { createHostedGrandMaterial, hostedPalette } from './material';

const MiB = 1024 * 1024;
const INSTALL_BYTES = 256 * 1024;
const RESIDENT_BYTES = 128 * MiB;

export interface HostedGrandIdentity {
  readonly compiler: typeof HOSTED_GRAND_COMPILER;
  readonly parameterHash: string;
  readonly recipeHash: string;
  readonly seed: GrandLandSeed;
  readonly planRevision: string;
  readonly region: BakedMetadata['physicalRegion'];
  readonly seat: BakedMetadata['seat']['offset'];
  readonly provenance: 'pinned-adoption-recipe';
}
export interface HostedGrandStats {
  phase: 'meshing' | 'ready' | 'failed' | 'disposed';
  regions: number; covered: number; exactRegions: number; residentBytes: number;
  queued: number; busy: number; resultBytes: number; installs: number; revision: number;
  readonly generatedColumns: 0; readonly workers: 0;
  surfaceBytes: number; waterRasterExtraBytes: number;
  networkBytes: number; cacheBytes: number; verifiedRawBytes: number; completedBlobs: number;
  cacheHits: number; cacheCorruptions: number; activeRequests: number; queuedRequests: number; pendingCompressedBytes: number;
}
export interface HostedGrandLand {
  /** All installed physical ground and first visible background coverage has actually installed. */
  readonly ready: Promise<void>;
  readonly identity: HostedGrandIdentity;
  readonly bounds: THREE.Box3;
  readonly stats: HostedGrandStats;
  readonly revision: number;
  /** Visual only. Collision and interaction authority remain the installed scene's bounded compilation. */
  height(x: number, z: number): number | null;
  readonly water: ReturnType<typeof bakedNativeWater>;
  update(now: number): void;
  dispose(): void;
}
export interface HostedGrandOptions {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly plan: SettlementPlan;
  readonly kingdomId: string;
  readonly recipe: GrandLandRecipe;
  readonly receipt: RealmFoundedManifest;
  readonly signal?: AbortSignal;
  readonly materialFactory: (palette: readonly GrandMaterial[]) => HostedGrandMaterial;
  readonly register?: (mesh: THREE.Mesh) => (() => void) | void;
  readonly onProgress?: (fraction: number) => void;
  readonly onError?: (error: Error) => void;
}

interface RegionMesh { readonly group: THREE.Group; readonly level: number; readonly bytes: number;
  readonly cleanups: (() => void)[]; lastUsed: number }
interface Region { readonly rx: number; readonly rz: number; readonly box: THREE.Box3; readonly exact: boolean;
  readonly refs: ReadonlyMap<number, BakedRegionRef>; readonly neighbours: number[]; readonly meshes: Map<number, RegionMesh>; readonly pending: Map<number, number>;
  readonly lod: LodState; desired: number; shown: RegionMesh | null; visible: boolean; required: boolean }
interface Job { readonly region: Region; readonly level: number; readonly id: number }
interface Install { readonly reply: BakedRegionMesh; readonly region: Region; readonly mesh: RegionMesh; face: number; from: number }

/**
 * Host the baked grand meshes inside the native kingdom's renderer. This owner has no camera, lighting,
 * town, post stack or animation loop. The scene calls update from its one existing RAF, including loading.
 */
export async function prepareHostedGrandLand(options: HostedGrandOptions): Promise<HostedGrandLand> {
  const { plan, camera, renderer } = options;
  if (options.signal?.aborted) throw new DOMException('The kingdom closed', 'AbortError');
  const recipe = options.recipe, seed = recipe.seed;
  if (seed.kingdomId !== options.kingdomId) throw new Error('The land recipe belongs to another kingdom');
  if (options.receipt.kingdomId !== options.kingdomId) throw new Error('The founded receipt belongs to another kingdom');
  const [recipeHash, sourcePlanHash] = await Promise.all([
    sha256Hex(utf8(canonicalSceneJson(recipe))), sha256Hex(utf8(canonicalSceneJson(plan))),
  ]);
  if (options.signal?.aborted) throw new DOMException('The kingdom closed', 'AbortError');
  const controller = new AbortController();
  const busy = new Map<number, Job>();
  let source: BakedLandSource | undefined;
  let stopped = false, failed: Error | undefined;
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // A scene may abort between opening the source and receiving its owner. Attach immediately to avoid
  // an unhandled rejected promise while keeping the original promise rejected for its actual consumer.
  void ready.catch(() => undefined);
  const regions: Region[] = [], installs: Install[] = [];
  let sequence = 1, lastSelection = -Infinity, lastProgress = -1, firstSelection = true;
  let material: HostedGrandMaterial | undefined;
  const root = new THREE.Group(); root.name = 'installed-grand-land';
  const stats: HostedGrandStats = { phase: 'meshing', regions: 0, covered: 0, exactRegions: 0,
    residentBytes: 0, queued: 0, busy: 0, resultBytes: 0, installs: 0, revision: 0, generatedColumns: 0, workers: 0,
    surfaceBytes: 0, waterRasterExtraBytes: 0,
    networkBytes: 0, cacheBytes: 0, verifiedRawBytes: 0, completedBlobs: 0, cacheHits: 0, cacheCorruptions: 0,
    activeRequests: 0, queuedRequests: 0, pendingCompressedBytes: 0 };
  function free(mesh: RegionMesh) {
    for (const cleanup of mesh.cleanups) cleanup();
    mesh.group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    mesh.group.removeFromParent();
  }
  function dispose() {
    if (stopped) return;
    stopped = true;
    options.signal?.removeEventListener('abort', abort);
    controller.abort(); source?.dispose();
    for (const item of installs) free(item.mesh);
    for (const region of regions) {
      for (const mesh of region.meshes.values()) free(mesh);
      region.meshes.clear(); region.pending.clear(); region.shown = null;
    }
    installs.length = 0; busy.clear();
    stats.busy = 0; stats.resultBytes = 0; stats.queued = 0; stats.covered = 0; stats.residentBytes = 0;
    stats.activeRequests = 0; stats.queuedRequests = 0; stats.pendingCompressedBytes = 0;
    material?.dispose(); root.removeFromParent();
    stats.phase = failed ? 'failed' : 'disposed';
    const error = failed ?? new DOMException('The kingdom closed', 'AbortError');
    readyReject(error);
  }
  function fail(error: Error) {
    if (stopped) return;
    failed = error; dispose();
    try { options.onError?.(error); } catch { /* The owner is already fully torn down. */ }
  }
  function abort() { dispose(); }
  options.signal?.addEventListener('abort', abort, { once: true });
  function receive(job: Job, reply: BakedRegionMesh) {
    if (stopped || busy.get(job.id) !== job) return;
    busy.delete(job.id);
    if (job.region.pending.get(job.level) !== job.id) return;
    const region = job.region;
    region.pending.delete(job.level);
    if (reply.level !== job.level || reply.rx !== region.rx || reply.rz !== region.rz)
      throw new Error('Baked terrain returned a different region');
    if (reply.quads.byteLength > BAKED_REGION_QUAD_BYTES) throw new Error('Grand terrain exceeded its mesh result budget');
    // An old visible patch remains until every face of its replacement has installed.
    const group = new THREE.Group();
    group.position.set(reply.rx * GRAND_REGION * .5, 0, reply.rz * GRAND_REGION * .5);
    group.scale.setScalar((1 << reply.level) * .5);
    const mesh: RegionMesh = { group, level: reply.level, bytes: reply.quads.byteLength, cleanups: [], lastUsed: performance.now() };
    installs.push({ reply, region, mesh, face: 0, from: reply.offsets[0]! });
  }
  try {
    source = await openBakedLand({ expected: { kingdomId: options.kingdomId,
      sceneHash: options.receipt.sceneHash, layoutRevision: options.receipt.layoutRevision,
      collisionRevision: options.receipt.collisionRevision, sourcePlanHash, recipeHash }, signal: controller.signal });
    if (stopped) { source.dispose(); throw failed ?? new DOMException('The kingdom closed', 'AbortError'); }
    const { metadata, surface } = source;
    // Recipe identity survives growth; installed geometry still has its own revision-bound digest.
    const parameterHash = await sha256Hex(utf8(canonicalSceneJson({ recipeHash, plan })));
    if (stopped) throw failed ?? new DOMException('The kingdom closed', 'AbortError');
    const identity: HostedGrandIdentity = { compiler: HOSTED_GRAND_COMPILER, parameterHash, recipeHash, seed,
      planRevision: plan.revision, region: metadata.physicalRegion, seat: metadata.seat.offset,
      provenance: 'pinned-adoption-recipe' };
    material = options.materialFactory(metadata.palette);
    root.position.set(...metadata.seat.offset).multiplyScalar(-1);
    options.scene.add(root);
    const bounds = new THREE.Box3(new THREE.Vector3(...metadata.bounds.min), new THREE.Vector3(...metadata.bounds.max));
    const per = metadata.size / GRAND_REGION;
    for (const baked of metadata.regions) {
      const { rx, rz, exact } = baked;
      const box = new THREE.Box3(new THREE.Vector3(...baked.bounds.min), new THREE.Vector3(...baked.bounds.max));
      regions.push({ rx, rz, box, exact, refs: new Map(baked.meshes.map(ref => [ref.level, ref])),
        neighbours: [], meshes: new Map(), pending: new Map(),
        lod: { shown: null, ideal: exact ? 0 : 3, desired: exact ? 0 : 3, coarsenSince: 0 }, desired: exact ? 0 : 3,
        shown: null, visible: false, required: exact });
    }
    const regionIndices = new Map(regions.map((region, index) => [region.rx + region.rz * per, index]));
    for (const region of regions) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = region.rx + dx, z = region.rz + dz;
      if ((dx || dz) && x >= 0 && z >= 0 && x < per && z < per) region.neighbours.push(regionIndices.get(x + z * per)!);
    }
    stats.regions = regions.length; stats.exactRegions = regions.filter(r => r.exact).length;
    const projectionView = new THREE.Matrix4(), frustum = new THREE.Frustum(), nearest = new THREE.Vector3(), size = new THREE.Vector2();
    function show(region: Region, mesh: RegionMesh, now: number) {
      mesh.lastUsed = now;
      if (region.shown === mesh) return;
      if (region.shown) {
        region.shown.group.removeFromParent();
        for (const cleanup of region.shown.cleanups) cleanup();
        region.shown.cleanups.length = 0;
        for (const child of region.shown.group.children) child.userData.hostedShadow = false;
      }
      root.add(mesh.group); root.updateMatrixWorld(true);
      region.shown = mesh; stats.revision++;
      for (const child of mesh.group.children) if (child instanceof THREE.Mesh && !child.userData.hostedShadow) {
        const cleanup = options.register?.(child); if (cleanup) mesh.cleanups.push(cleanup);
        child.userData.hostedShadow = true;
      }
    }
    function install(now: number) {
      const started = performance.now(); let bytes = 0;
      while (installs.length) {
        const item = installs[0]!, { reply, mesh } = item;
        if (item.face >= 6) {
          installs.shift();
          const old = item.region.meshes.get(mesh.level); if (old) free(old);
          item.region.meshes.set(mesh.level, mesh);
          if (!item.region.shown || item.region.desired === mesh.level) show(item.region, mesh, now);
          continue;
        }
        const end = reply.offsets[item.face + 1]!;
        const to = Math.min(end, item.from + INSTALL_BYTES / 8);
        if (to > item.from) {
          const span = GRAND_REGION / (1 << reply.level);
          const box = new THREE.Box3(new THREE.Vector3(0, reply.minY, 0), new THREE.Vector3(span, Math.max(reply.minY + 1, reply.maxY), span));
          const geometry = createQuadGeometry(reply.quads.subarray(item.from * 2, to * 2), box);
          const face = new THREE.Mesh(geometry, material!.material);
          face.matrixAutoUpdate = false; mesh.group.add(face); bytes += (to - item.from) * 8; stats.installs++;
        }
        item.from = to;
        if (to >= end) { item.face++; item.from = reply.offsets[item.face]!; }
        if (bytes >= INSTALL_BYTES || performance.now() - started >= .75) break;
      }
    }
    function select(now: number) {
      camera.updateMatrixWorld();
      projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projectionView);
      renderer.getDrawingBufferSize(size);
      const projection = Math.max(1, size.y) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      const target = size.x < 650 ? 2 : 1.5;
      for (const region of regions) {
        region.visible = frustum.intersectsBox(region.box);
        if (firstSelection && region.visible) region.required = true;
        region.lod.shown = region.shown?.level ?? null;
        if (region.exact) region.lod.ideal = 0;
        else {
          region.box.clampPoint(camera.position, nearest);
          const depth = Math.max(.5, nearest.distanceTo(camera.position));
          chooseLevel(region.lod, level => (1 << level) * .5 * projection / depth, target, GRAND_LEVELS, now);
        }
      }
      firstSelection = false;
      balanceLevels(regions.map(r => r.lod), regions.map(r => r.neighbours), GRAND_LEVELS);
      for (const region of regions) {
        region.desired = region.exact ? 0 : region.lod.desired;
        const desired = region.meshes.get(region.desired);
        if (desired) show(region, desired, now);
        for (const [level, mesh] of region.meshes) if (mesh !== region.shown && level !== region.desired && now - mesh.lastUsed > 2000) {
          free(mesh); region.meshes.delete(level);
        }
      }
    }
    function dispatch() {
      // Rebuild at most 64 requests from the current camera. There is no unbounded waiting queue.
      const candidates = regions.filter(r => (r.required || r.visible) && !r.meshes.has(r.desired)
        && !r.pending.has(r.desired) && !installs.some(item => item.region === r && item.mesh.level === r.desired));
      candidates.sort((a, b) => Number(!a.exact) - Number(!b.exact)
        || Number(!!a.shown) - Number(!!b.shown) || a.box.distanceToPoint(camera.position) - b.box.distanceToPoint(camera.position));
      stats.queued = Math.min(64, candidates.length);
      // Every unresolved request reserves the largest legal decoded result. Together with
      // pending GPU installs this bounds decoded results to 16 MiB, even if replies land together.
      let reserved = busy.size * BAKED_REGION_QUAD_BYTES + installs.reduce((sum, item) => sum + item.reply.quads.byteLength, 0);
      for (const region of candidates.slice(0, 64)) {
        if (busy.size >= 2 || reserved + BAKED_REGION_QUAD_BYTES > 16 * MiB) break;
        const ref = region.refs.get(region.desired);
        if (!ref) throw new Error('Baked terrain is missing a required resolution');
        const job: Job = { region, level: region.desired, id: sequence++ };
        region.pending.set(job.level, job.id); busy.set(job.id, job); reserved += BAKED_REGION_QUAD_BYTES;
        void source!.mesh(ref, controller.signal).then(reply => receive(job, reply)).catch(error => {
          if (!stopped) fail(error instanceof Error ? error : new Error(String(error)));
        });
      }
      stats.busy = busy.size;
      stats.resultBytes = installs.reduce((sum, item) => sum + item.reply.quads.byteLength, 0);
    }
    function update(now: number) {
      if (stopped) return;
      try {
        const download = source!.stats;
        stats.networkBytes = download.networkBytes; stats.cacheBytes = download.cacheBytes;
        stats.verifiedRawBytes = download.verifiedRawBytes; stats.completedBlobs = download.completedBlobs;
        stats.cacheHits = download.cacheHits; stats.cacheCorruptions = download.cacheCorruptions;
        stats.activeRequests = download.activeRequests; stats.queuedRequests = download.queuedRequests;
        stats.pendingCompressedBytes = download.pendingCompressedBytes;
        install(now);
        if (now - lastSelection > 160) { select(now); lastSelection = now; }
        dispatch();
        stats.covered = regions.filter(r => r.shown).length;
        stats.residentBytes = regions.reduce((sum, region) => sum + [...region.meshes.values()].reduce((n, mesh) => n + mesh.bytes, 0), 0);
        if (stats.residentBytes > RESIDENT_BYTES) {
          // Last coverage stays installed; only cold alternative resolutions may be evicted.
          for (const region of regions) for (const [level, mesh] of region.meshes) if (mesh !== region.shown && level !== region.desired) {
            free(mesh); region.meshes.delete(level); stats.residentBytes -= mesh.bytes;
          }
        }
        const required = regions.filter(r => r.required), complete = required.filter(r => r.exact ? r.shown?.level === 0 : !!r.shown).length;
        const progress = required.length ? complete / required.length : 1;
        if (progress !== lastProgress) { lastProgress = progress; options.onProgress?.(progress); }
        if (stats.phase === 'meshing' && complete === required.length) { stats.phase = 'ready'; readyResolve(); }
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    }
    const nativeWater = bakedNativeWater(surface, metadata.seat);
    const surfaceBuffers = new Set([surface.ground.buffer, surface.water.buffer]);
    stats.surfaceBytes = [...surfaceBuffers].reduce((bytes, buffer) => bytes + buffer.byteLength, 0);
    const waterBuffers = new Set([nativeWater.ground.data.buffer, nativeWater.raster.levels.buffer, nativeWater.raster.dryGround.buffer]);
    stats.waterRasterExtraBytes = [...waterBuffers].filter(buffer => !surfaceBuffers.has(buffer)).reduce((bytes, buffer) => bytes + buffer.byteLength, 0);
    const owner: HostedGrandLand = { ready, identity, bounds, stats,
      get revision() { return stats.revision; },
      height: (x, z) => bakedVisualHeight(surface, metadata.seat, x, z),
      water: nativeWater,
      update, dispose,
    };
    return owner;
  } catch (error) { dispose(); throw error; }
}
