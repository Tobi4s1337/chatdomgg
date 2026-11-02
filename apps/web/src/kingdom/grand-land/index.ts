import * as THREE from 'three';
import type { SettlementPlan } from '@chatdom/world';
import type { RealmFoundedManifest } from '@chatdom/shared/realm';
import { CHUNK_QUADS, createTerrainChunk, runOrdered, visibleRuns, type RunOrder, type TerrainChunk } from './terrain-runs';
import type { RunOrderedRegionMesh } from './baked-client-decode';
import type { GrandMaterial } from '../../../../../packages/world/src/grand/palette';
import { GRAND_LEVELS, GRAND_REGION, type GrandLandSeed } from '../../../../../packages/world/src/grand/types';
import { balanceLevels, chooseLevel, fitLodBudget, type BudgetRegion, type LodBudget, type LodState } from '../../grand/lod';
import { HOSTED_GRAND_COMPILER, BAKED_REGION_QUAD_BYTES, type BakedMetadata, type BakedRegionRef, type BakedRegionMesh } from '../../../../../packages/world/src/grand/baked/types';
import { bakedNativeWater, bakedVisualHeight } from '../../../../../packages/world/src/grand/baked/surface';
import { openBakedLand, type BakedLandSource, type BakedLandStats } from './baked-client';
import type { HostedGrandMaterial } from './material';
import type { GrandLandRecipe } from '../../../../../packages/world/src/grand/recipe';
import { canonicalSceneJson, sha256Hex, utf8 } from '../../../../../packages/world/src/founded-world/codec';
import { planStartupCoverage, stepBalancedLevels, STARTUP_BUDGET_BYTES, type StartupCoverage } from './startup-selection';
export { createHostedGrandMaterial, hostedPalette } from './material';

const MiB = 1024 * 1024;
/** GPU installation per frame: at most 1 MiB of quads (one chunk), and .75 ms of main-thread work. */
const INSTALL_BYTES = MiB;
const OPENING_INSTALL_BYTES = 4 * MiB, OPENING_INSTALL_MS = 6;
const RESIDENT_BYTES = 128 * MiB;
const FADE_MS = 400;
/**
 * The share of a region's quads one view submits: per-pass selection draws only faces that can face the eye (all
 * tops from above, one of each side pair), measured at 42 to 47% over the six budget poses on Willowmere.
 */
const FACING_SHARE = .47;
/**
 * The water reflection is drawn at half resolution through moving water, so outside the installed town (exact
 * regions keep their only level, L0) it draws the land no finer than level 2: one 1 m cell is under a pixel of the
 * reflection target beyond about 400 m, and the reflected land is rarely nearer. Level 2 of every outer region is
 * kept resident for it (about 1.2 MB compressed and 3.2 MB on the GPU for Willowmere), loaded once the view settles.
 */
export const REFLECTION_LEVEL = 2;

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
  startupPhase: 'selecting' | 'loading' | 'awaiting-presentation' | 'refining' | 'settled';
  initialRequiredRegions: number; initialCoveredRegions: number; initialCoverageReady: boolean;
  initialPlannedBytes: number; initialActualBytes: number; initialNetworkBytes: number;
  initialBudgetBytes: number; initialBudgetExceeded: boolean; fadingRegions: number;
  /** Regions displayed in the main view by level, and quads submitted by the last main and reflection passes. */
  displayedLevels: number[]; mainQuads: number; reflectionQuads: number; reflectionMeshes: number;
  /** The main-view budget's estimate after the last selection, and how many level steps it took to fit. */
  budgetQuads: number; budgetCoarsened: number; budgetFits: boolean;
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
  /** Recheck the final camera before drawing. Hidden lens changes expand the complete startup barrier. */
  canPresent(): boolean;
  /** Call only after the native host actually draws this complete view; refinement starts next update. */
  markPresented(): void;
  /**
   * How fine distant land is drawn, in pixels of error per voxel step (spec 56: 1.5 on desktop, 2 under 650 px).
   * The quality governor raises it on weaker devices: only far regions coarsen; exact regions and near land, whose
   * finest level is already many pixels wide, never change. `null` restores the width-based default.
   */
  setDetail(pixels: number | null): void;
  /**
   * Spec 56's main-view triangle budget for the land, as quads (`null`: none). Over it, the farthest visible land
   * coarsens first, never past `maxPixels` per cell; the installed town never coarsens.
   */
  setBudget(budget: LodBudget | null): void;
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
  /** The published receipt binding, already read by `probePublishedLand`; verified again by the baked source. */
  readonly binding?: Uint8Array;
  readonly signal?: AbortSignal;
  /** `town` is the installed physical region in world metres (the native settlement frame). */
  readonly materialFactory: (palette: readonly GrandMaterial[], town: BakedMetadata['physicalRegion']) => HostedGrandMaterial;
  readonly register?: (mesh: THREE.Mesh) => (() => void) | void;
  readonly onProgress?: (fraction: number) => void;
  readonly onError?: (error: Error) => void;
  /** A source the host began opening before its own setup (`openHostedGrandLand`); this owner takes it over. */
  readonly opening?: HostedGrandOpening;
  /** A region's first complete mesh was put into the scene (its first visible coverage). */
  readonly onRegionShown?: (region: { readonly rx: number; readonly rz: number; readonly level: number; readonly exact: boolean;
    readonly bounds: BakedMetadata['regions'][number]['bounds'] }) => void;
}

/** Decoded results requested ahead of the owner, all counted against the same 16 MiB bound. */
const DECODED_BYTES = 16 * MiB;
/** Mesh requests in flight. The transport separately allows four network requests and two decode workers. */
const MESH_REQUESTS = 6;
export interface HostedGrandOpening {
  /** The verified binding, metadata and surface; rejects exactly as `openBakedLand` does. */
  readonly opened: Promise<{ readonly source: BakedLandSource; readonly recipeHash: string; readonly sourcePlanHash: string }>;
  /** A started request for this exact reference, handed over once. */
  take(ref: BakedRegionRef): Promise<BakedRegionMesh> | undefined;
  /** Decoded bytes reserved by requests not yet taken. */
  readonly reservedBytes: number;
  dispose(): void;
}
export interface HostedGrandOpenOptions {
  readonly plan: SettlementPlan;
  readonly kingdomId: string;
  readonly recipe: GrandLandRecipe;
  readonly receipt: RealmFoundedManifest;
  readonly binding?: Uint8Array;
  readonly signal?: AbortSignal;
  readonly onProgress?: (stats: Readonly<BakedLandStats>) => void;
}

/**
 * Start reading the receipt's baked land at once: binding, metadata, surface, then the installed physical
 * regions' exact meshes (the viewer's own streets) nearest the town centre first. Nothing here depends on the
 * camera; the owner later plans the rest of the first view. Never generates land.
 */
export function openHostedGrandLand(options: HostedGrandOpenOptions): HostedGrandOpening {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const early = new Map<BakedRegionRef, { readonly promise: Promise<BakedRegionMesh>; readonly bytes: number }>();
  let reserved = 0, disposed = false, source: BakedLandSource | undefined;
  const opened = (async () => {
    const { recipe, receipt, plan } = options;
    if (recipe.seed.kingdomId !== options.kingdomId) throw new Error('The land recipe belongs to another kingdom');
    if (receipt.kingdomId !== options.kingdomId) throw new Error('The founded receipt belongs to another kingdom');
    const [recipeHash, sourcePlanHash] = await Promise.all([
      sha256Hex(utf8(canonicalSceneJson(recipe))), sha256Hex(utf8(canonicalSceneJson(plan))),
    ]);
    if (controller.signal.aborted) throw new DOMException('The kingdom closed', 'AbortError');
    source = await openBakedLand({ expected: { kingdomId: options.kingdomId,
      sceneHash: receipt.sceneHash, layoutRevision: receipt.layoutRevision,
      collisionRevision: receipt.collisionRevision, sourcePlanHash, recipeHash }, signal: controller.signal,
      ...(options.binding ? { binding: options.binding } : {}), ...(options.onProgress ? { onProgress: options.onProgress } : {}) });
    if (disposed) { source.dispose(); throw new DOMException('The kingdom closed', 'AbortError'); }
    const { metadata } = source, town = metadata.physicalRegion;
    // Region bounds and the physical region share the native settlement frame.
    const cx = (town.minX + town.maxX) / 2, cz = (town.minZ + town.maxZ) / 2;
    const distance = (region: BakedMetadata['regions'][number]) => Math.hypot(
      (region.bounds.min[0] + region.bounds.max[0]) / 2 - cx, (region.bounds.min[2] + region.bounds.max[2]) / 2 - cz);
    for (const region of metadata.regions.filter(region => region.exact).sort((a, b) => distance(a) - distance(b))) {
      const ref = region.meshes.find(mesh => mesh.level === 0);
      if (!ref || reserved + ref.quadCount * 8 > DECODED_BYTES) break;
      const promise = source.mesh(ref, controller.signal);
      // The owner observes failures when it takes the request; an untaken one is only released.
      promise.catch(() => undefined);
      early.set(ref, { promise, bytes: ref.quadCount * 8 }); reserved += ref.quadCount * 8;
    }
    return { source, recipeHash, sourcePlanHash };
  })();
  opened.catch(() => undefined);
  return {
    opened,
    take(ref) {
      const item = early.get(ref);
      if (!item) return undefined;
      early.delete(ref); reserved -= item.bytes;
      return item.promise;
    },
    get reservedBytes() { return reserved; },
    dispose() {
      if (disposed) return;
      disposed = true; options.signal?.removeEventListener('abort', abort);
      early.clear(); reserved = 0; controller.abort(); source?.dispose();
    },
  };
}

interface RegionMesh { readonly group: THREE.Group; readonly level: number; readonly bytes: number;
  readonly cleanups: (() => void)[]; lastUsed: number;
  readonly cells: { readonly span: number; readonly minY: number; readonly maxY: number };
  readonly chunks: TerrainChunk[]; displayed: boolean;
  /** The run order's face planes, kept for per-pass selection once installed (its quads live in the chunks). */
  order: Pick<RunOrder, 'starts' | 'planes' | 'ends'> | null }
interface Region { readonly rx: number; readonly rz: number; readonly box: THREE.Box3; readonly exact: boolean;
  readonly bounds: BakedMetadata['regions'][number]['bounds'];
  readonly refs: ReadonlyMap<number, BakedRegionRef>; readonly neighbours: number[]; readonly meshes: Map<number, RegionMesh>; readonly pending: Map<number, number>;
  readonly lod: LodState; desired: number; shown: RegionMesh | null; visible: boolean; required: boolean }
interface Job { readonly region: Region; readonly level: number; readonly id: number; readonly bytes: number }
interface Install { readonly reply: BakedRegionMesh; readonly region: Region; readonly mesh: RegionMesh;
  ordered?: RunOrder; from: number }
interface Fade { readonly region: Region; readonly from: RegionMesh; readonly to: RegionMesh }
interface RefinementWave {
  readonly levels: readonly number[]; readonly targets: ReadonlyMap<Region, number>;
  readonly baselines: ReadonlyMap<Region, number>;
  readonly fades: Fade[]; startedAt: number | null; progress: number;
}

/**
 * Host the baked grand meshes inside the native kingdom's renderer. This owner has no camera, lighting,
 * town, post stack or animation loop. The scene calls update from its one existing RAF, including loading.
 */
export async function prepareHostedGrandLand(options: HostedGrandOptions): Promise<HostedGrandLand> {
  const { plan, camera, renderer } = options;
  if (options.signal?.aborted) { options.opening?.dispose(); throw new DOMException('The kingdom closed', 'AbortError'); }
  const recipe = options.recipe, seed = recipe.seed;
  if (seed.kingdomId !== options.kingdomId) { options.opening?.dispose(); throw new Error('The land recipe belongs to another kingdom'); }
  if (options.receipt.kingdomId !== options.kingdomId) { options.opening?.dispose(); throw new Error('The founded receipt belongs to another kingdom'); }
  const opening = options.opening ?? openHostedGrandLand({ plan, kingdomId: options.kingdomId, recipe, receipt: options.receipt,
    ...(options.binding ? { binding: options.binding } : {}) });
  const controller = new AbortController();
  const busy = new Map<number, Job>();
  let source: BakedLandSource | undefined;
  let stopped = false, failed: Error | undefined;
  /** Sends the next requests the moment a reply frees a slot, instead of at the next drawn frame. */
  let refill: (() => void) | undefined;
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // A scene may abort between opening the source and receiving its owner. Attach immediately to avoid
  // an unhandled rejected promise while keeping the original promise rejected for its actual consumer.
  void ready.catch(() => undefined);
  const regions: Region[] = [], installs: Install[] = [];
  let sequence = 1, lastSelection = -Infinity, lastProgress = -1, detail: number | null = null, budget: LodBudget | null = null;
  let startup: StartupCoverage | undefined, bootstrapBytes = 0, presented = false;
  let coverageLevels: readonly number[] = [], wave: RefinementWave | undefined;
  let material: HostedGrandMaterial | undefined;
  let passHook: { readonly previous: THREE.Scene['onBeforeRender'] } | undefined;
  const root = new THREE.Group(); root.name = 'installed-grand-land';
  // Level-2 meshes kept only for the reflection (not displayed in the main view) wait here, hidden from other passes.
  const reflectionRoot = new THREE.Group(); reflectionRoot.name = 'installed-grand-land-reflection';
  const stats: HostedGrandStats = { phase: 'meshing', regions: 0, covered: 0, exactRegions: 0,
    residentBytes: 0, queued: 0, busy: 0, resultBytes: 0, installs: 0, revision: 0, generatedColumns: 0, workers: 0,
    surfaceBytes: 0, waterRasterExtraBytes: 0,
    networkBytes: 0, cacheBytes: 0, verifiedRawBytes: 0, completedBlobs: 0, cacheHits: 0, cacheCorruptions: 0,
    activeRequests: 0, queuedRequests: 0, pendingCompressedBytes: 0,
    startupPhase: 'selecting', initialRequiredRegions: 0, initialCoveredRegions: 0, initialCoverageReady: false,
    initialPlannedBytes: 0, initialActualBytes: 0, initialNetworkBytes: 0,
    initialBudgetBytes: STARTUP_BUDGET_BYTES, initialBudgetExceeded: false, fadingRegions: 0,
    displayedLevels: [0, 0, 0, 0], mainQuads: 0, reflectionQuads: 0, reflectionMeshes: 0,
    budgetQuads: 0, budgetCoarsened: 0, budgetFits: true };
  function free(mesh: RegionMesh) {
    for (const cleanup of mesh.cleanups) cleanup();
    mesh.cleanups.length = 0;
    for (const chunk of mesh.chunks) chunk.dispose();
    mesh.group.removeFromParent(); mesh.displayed = false;
  }
  function dispose() {
    if (stopped) return;
    stopped = true;
    options.signal?.removeEventListener('abort', abort);
    // The opening owns the source it opened (also when this owner never received it).
    controller.abort(); opening.dispose();
    for (const item of installs) free(item.mesh);
    for (const region of regions) {
      for (const mesh of region.meshes.values()) free(mesh);
      region.meshes.clear(); region.pending.clear(); region.shown = null;
    }
    installs.length = 0; busy.clear();
    wave = undefined; stats.fadingRegions = 0; stats.initialCoverageReady = false;
    stats.busy = 0; stats.resultBytes = 0; stats.queued = 0; stats.covered = 0; stats.residentBytes = 0;
    stats.activeRequests = 0; stats.queuedRequests = 0; stats.pendingCompressedBytes = 0;
    material?.dispose(); root.removeFromParent(); reflectionRoot.removeFromParent();
    if (passHook) { options.scene.onBeforeRender = passHook.previous; passHook = undefined; }
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
    if (reply.quads.byteLength > Math.min(job.bytes, BAKED_REGION_QUAD_BYTES)) throw new Error('Grand terrain exceeded its mesh result budget');
    // An old visible patch remains until every face of its replacement has installed.
    const group = new THREE.Group();
    group.position.set(reply.rx * GRAND_REGION * .5, 0, reply.rz * GRAND_REGION * .5);
    group.scale.setScalar((1 << reply.level) * .5);
    group.matrixAutoUpdate = true;
    const mesh: RegionMesh = { group, level: reply.level, bytes: reply.quads.byteLength, cleanups: [], lastUsed: performance.now(),
      cells: { span: GRAND_REGION / (1 << reply.level), minY: reply.minY, maxY: Math.max(reply.minY + 1, reply.maxY) },
      chunks: [], displayed: false, order: null };
    installs.push({ reply, region, mesh, from: 0 });
    refill?.();
  }
  try {
    const { source: opened, recipeHash } = await opening.opened;
    source = opened;
    if (stopped) { source.dispose(); throw failed ?? new DOMException('The kingdom closed', 'AbortError'); }
    const { metadata, surface } = source;
    // Recipe identity survives growth; installed geometry still has its own revision-bound digest.
    const parameterHash = await sha256Hex(utf8(canonicalSceneJson({ recipeHash, plan })));
    if (stopped) throw failed ?? new DOMException('The kingdom closed', 'AbortError');
    const identity: HostedGrandIdentity = { compiler: HOSTED_GRAND_COMPILER, parameterHash, recipeHash, seed,
      planRevision: plan.revision, region: metadata.physicalRegion, seat: metadata.seat.offset,
      provenance: 'pinned-adoption-recipe' };
    material = options.materialFactory(metadata.palette, metadata.physicalRegion);
    root.position.set(...metadata.seat.offset).multiplyScalar(-1);
    options.scene.add(root);
    const bounds = new THREE.Box3(new THREE.Vector3(...metadata.bounds.min), new THREE.Vector3(...metadata.bounds.max));
    const per = metadata.size / GRAND_REGION;
    for (const baked of metadata.regions) {
      const { rx, rz, exact } = baked;
      const box = new THREE.Box3(new THREE.Vector3(...baked.bounds.min), new THREE.Vector3(...baked.bounds.max));
      regions.push({ rx, rz, box, exact, bounds: baked.bounds, refs: new Map(baked.meshes.map(ref => [ref.level, ref])),
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
    function setFade(mesh: RegionMesh, value: number) {
      for (const child of mesh.group.children) child.userData.grandLodFade = value;
    }
    /** A reflection-only mesh: outer level-2 coverage the reflection draws while the main view shows finer land. */
    const reflectionOnly = (region: Region, mesh: RegionMesh) => !region.exact && mesh.level === REFLECTION_LEVEL;
    function park(mesh: RegionMesh) {
      if (!reflectionRoot.parent) options.scene.add(reflectionRoot);
      reflectionRoot.add(mesh.group); mesh.group.updateMatrixWorld(true);
      for (const chunk of mesh.chunks) chunk.hide();
    }
    function detach(mesh: RegionMesh, region?: Region) {
      mesh.displayed = false;
      for (const cleanup of mesh.cleanups) cleanup();
      mesh.cleanups.length = 0;
      if (region && reflectionOnly(region, mesh)) park(mesh); else mesh.group.removeFromParent();
    }
    function attach(mesh: RegionMesh, now: number) {
      mesh.lastUsed = now; mesh.displayed = true;
      root.add(mesh.group); mesh.group.updateMatrixWorld(true);
      // Every chunk shows all its faces until the first pass selects runs for its camera.
      for (const chunk of mesh.chunks) chunk.showAll();
      // The shadow owner copies each chunk's whole mesh; it renders casters from both sides itself.
      if (!mesh.cleanups.length) for (const chunk of mesh.chunks) {
        const cleanup = options.register?.(chunk.whole); if (cleanup) mesh.cleanups.push(cleanup);
      }
    }
    function showInitial(region: Region, mesh: RegionMesh, now: number) {
      if (region.shown === mesh) return;
      const first = !region.shown;
      if (region.shown) detach(region.shown, region);
      setFade(mesh, 1); attach(mesh, now); region.shown = mesh; stats.revision++;
      if (first) options.onRegionShown?.({ rx: region.rx, rz: region.rz, level: mesh.level, exact: region.exact, bounds: region.bounds });
    }
    function install(now: number) {
      const started = performance.now(); let bytes = 0;
      while (installs.length) {
        const item = installs[0]!, { reply, mesh } = item;
        // Faces are copied into run order once; each step then makes one chunk (one GPU buffer of at most 1 MiB).
        if (!item.ordered) {
          // The decode worker delivers the run order; a mesh from anywhere else is ordered here.
          const decoded = reply as Partial<RunOrderedRegionMesh> & BakedRegionMesh;
          item.ordered = decoded.runOrdered === true ? { quads: reply.quads, starts: reply.offsets, planes: decoded.planes!, ends: decoded.ends! }
            : runOrdered(reply.quads, reply.offsets);
          mesh.order = { starts: item.ordered.starts, planes: item.ordered.planes, ends: item.ordered.ends };
        }
        const total = item.ordered.starts[item.ordered.starts.length - 1]!;
        if (item.from >= total) {
          installs.shift();
          const old = item.region.meshes.get(mesh.level); if (old) free(old);
          item.region.meshes.set(mesh.level, mesh);
          if (!presented) showInitial(item.region, mesh, now);
          else if (reflectionOnly(item.region, mesh) && !mesh.displayed) park(mesh);
          continue;
        }
        const to = Math.min(total, item.from + CHUNK_QUADS);
        const { span, minY, maxY } = mesh.cells;
        const box = new THREE.Box3(new THREE.Vector3(0, minY, 0), new THREE.Vector3(span, maxY, span));
        const chunk = createTerrainChunk(item.ordered.quads, item.from, to, box, material!.material,
          run => material!.bindFade?.(run));
        mesh.chunks.push(chunk); mesh.group.add(...chunk.runs, chunk.whole);
        bytes += (to - item.from) * 8; stats.installs++; item.from = to;
        if (presented ? bytes >= INSTALL_BYTES || performance.now() - started >= .75 : bytes >= OPENING_INSTALL_BYTES || performance.now() - started >= OPENING_INSTALL_MS) break;
      }
    }
    /**
     * Per-pass selection (spec 56: main, reflection and shadows are selected separately). Runs from the scene's
     * own onBeforeRender, before three culls, for whichever camera draws the scene: each displayed chunk submits
     * only the faces that can face that camera. A reflection camera (marked by the water's planar pass) draws the
     * outer land at no finer than REFLECTION_LEVEL where that level is resident and the region is not fading.
     */
    const eye = new THREE.Vector3(), local = new THREE.Vector3(), ranges: number[] = [];
    function selectPass(camera: THREE.Camera) {
      const reflection = camera.userData.chatdomReflection === true;
      const orthographic = (camera as THREE.OrthographicCamera).isOrthographicCamera === true;
      camera.getWorldPosition(eye); eye.sub(root.position);
      let quads = 0;
      const draw = (mesh: RegionMesh) => {
        if (orthographic || !mesh.order) { for (const chunk of mesh.chunks) quads += chunk.showAll(); return; }
        local.copy(eye).sub(mesh.group.position).divideScalar(mesh.group.scale.x);
        visibleRuns(mesh.order, local, ranges);
        for (const chunk of mesh.chunks) quads += chunk.show(ranges);
      };
      const fading = new Set<Region>();
      if (wave?.startedAt !== null) for (const fade of wave?.fades ?? []) fading.add(fade.region);
      for (const region of regions) {
        const parked = region.meshes.get(REFLECTION_LEVEL);
        if (parked && !parked.displayed) for (const chunk of parked.chunks) chunk.hide();
        if (!region.shown) continue;
        const shown = region.shown;
        if (reflection && !region.exact && !fading.has(region) && shown.level < REFLECTION_LEVEL && parked && !parked.displayed) {
          for (const chunk of shown.chunks) chunk.hide();
          draw(parked);
          continue;
        }
        draw(shown);
      }
      for (const fade of wave?.fades ?? []) if (fade.to.displayed) draw(fade.to);
      if (reflection) stats.reflectionQuads = quads; else stats.mainQuads = quads;
    }
    const previous = options.scene.onBeforeRender;
    passHook = { previous };
    // three calls a scene's hook with (renderer, scene, camera, target) at the start of every render, before culling.
    options.scene.onBeforeRender = function (...args: Parameters<THREE.Scene['onBeforeRender']>) {
      previous.apply(this, args);
      if (!stopped) selectPass(args[2]);
    };
    function visibility() {
      camera.updateMatrixWorld();
      projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projectionView);
      for (const region of regions) region.visible = frustum.intersectsBox(region.box);
    }
    function initialStatus() {
      const download = source!.stats;
      stats.initialActualBytes = download.networkBytes + download.cacheBytes;
      stats.initialNetworkBytes = download.networkBytes;
      stats.initialRequiredRegions = regions.filter(region => region.required).length;
      stats.initialCoveredRegions = regions.filter((region, index) => region.required && region.shown?.level === startup!.levels[index]).length;
      stats.initialCoverageReady = !!startup && stats.initialRequiredRegions === stats.initialCoveredRegions;
      stats.initialPlannedBytes = startup!.plannedBytes;
      stats.initialBudgetExceeded = startup!.budgetExceeded || stats.initialActualBytes > STARTUP_BUDGET_BYTES;
      stats.startupPhase = stats.initialCoverageReady ? 'awaiting-presentation' : 'loading';
    }
    function initialSelection() {
      visibility();
      let changed = !startup;
      if (!startup) bootstrapBytes = source!.stats.networkBytes + source!.stats.cacheBytes;
      for (const region of regions) if (region.visible && !region.required) { region.required = true; changed = true; }
      if (changed) {
        startup = planStartupCoverage(metadata, regions.map(region => region.required), bootstrapBytes);
        coverageLevels = startup.levels;
        regions.forEach((region, index) => { region.desired = startup!.levels[index]!; });
      }
      initialStatus();
    }
    function select(now: number) {
      visibility();
      renderer.getDrawingBufferSize(size);
      const projection = Math.max(1, size.y) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      const target = Math.max(detail ?? 0, size.x < 650 ? 2 : 1.5);
      const budgeted: BudgetRegion[] = [];
      for (const region of regions) {
        region.lod.shown = region.shown?.level ?? null;
        region.box.clampPoint(camera.position, nearest);
        const depth = Math.max(.5, nearest.distanceTo(camera.position));
        const pixels = (level: number) => (1 << level) * .5 * projection / depth;
        if (region.exact) region.lod.ideal = 0;
        else chooseLevel(region.lod, pixels, target, GRAND_LEVELS, now);
        budgeted.push({ state: region.lod, visible: region.visible, pinned: region.exact, pixels,
          quads: Array.from({ length: GRAND_LEVELS }, (_, level) => (region.refs.get(level)?.quadCount ?? 0) * FACING_SHARE) });
      }
      const neighbours = regions.map(r => r.neighbours);
      balanceLevels(regions.map(r => r.lod), neighbours, GRAND_LEVELS);
      if (budget) {
        const fit = fitLodBudget(budgeted, neighbours, budget, GRAND_LEVELS);
        stats.budgetQuads = Math.round(fit.estimated); stats.budgetCoarsened = fit.coarsened; stats.budgetFits = fit.fits;
      } else { stats.budgetQuads = 0; stats.budgetCoarsened = 0; stats.budgetFits = true; }
      for (const region of regions) {
        region.desired = region.exact ? 0 : region.lod.desired;
        for (const [level, mesh] of region.meshes) if (!mesh.displayed && !reflectionOnly(region, mesh) && level !== region.desired
          && wave?.targets.get(region) !== level && wave?.baselines.get(region) !== level && now - mesh.lastUsed > 2000) {
          free(mesh); region.meshes.delete(level);
        }
      }
    }
    function planWave() {
      const levels = stepBalancedLevels(coverageLevels, regions.map(region => region.desired));
      const targets = new Map<Region, number>(), baselines = new Map<Region, number>();
      regions.forEach((region, index) => {
        if ((region.shown || region.required || region.visible) && region.shown?.level !== levels[index]) {
          targets.set(region, levels[index]!);
          if (!region.shown) baselines.set(region, coverageLevels[index]!);
        }
      });
      if (!targets.size) {
        // Unseen virtual regions can advance without downloads; this retains global adjacency constraints.
        coverageLevels = levels;
        stats.startupPhase = levels.every((level, index) => level === regions[index]!.desired) ? 'settled' : 'refining';
        return;
      }
      wave = { levels, targets, baselines, fades: [], startedAt: null, progress: 0 };
      stats.startupPhase = 'refining';
    }
    function advanceWave(now: number) {
      if (!wave) return;
      if (wave.startedAt === null) {
        // A previously unseen patch first joins the CURRENT balanced coverage. Showing its future
        // endpoint immediately could put incoming L0 beside a still-full outgoing L2 neighbour.
        for (const [region, level] of wave.baselines) {
          const baseline = region.meshes.get(level);
          if (!region.shown && baseline) showInitial(region, baseline, now);
        }
        for (const region of wave.baselines.keys()) if (!region.shown) return;
        for (const [region, level] of wave.targets) if (!region.meshes.has(level)) return;
        // All endpoint meshes are ready before any neighbour begins to change resolution.
        wave.startedAt = now;
        for (const [region, level] of wave.targets) {
          const next = region.meshes.get(level)!;
          if (region.shown === next) continue;
          if (!region.shown) throw new Error('Land refinement is missing its balanced baseline');
          setFade(region.shown, -1); setFade(next, 0); attach(next, now);
          wave.fades.push({ region, from: region.shown, to: next });
        }
        stats.fadingRegions = wave.fades.length; stats.revision++;
      }
      const progress = Math.max(wave.progress, Math.min(1, Math.max(0, now - wave.startedAt) / FADE_MS));
      if (progress !== wave.progress) {
        for (const fade of wave.fades) { setFade(fade.from, -1 - progress); setFade(fade.to, progress); }
        wave.progress = progress; stats.revision++;
      }
      if (progress < 1 && wave.fades.length) return;
      for (const fade of wave.fades) {
        detach(fade.from, fade.region); setFade(fade.to, 1); fade.region.shown = fade.to;
        fade.from.lastUsed = now; fade.to.lastUsed = now;
      }
      coverageLevels = wave.levels; wave = undefined; stats.fadingRegions = 0; lastSelection = -Infinity;
    }
    function dispatch() {
      // Rebuild at most 64 requests from the current camera. There is no unbounded waiting queue.
      const wanted = !presented ? new Map(regions.filter(region => region.required).map(region => [region, region.desired]))
        : wave?.startedAt === null ? new Map([...wave.targets].map(([region, level]) =>
          [region, !region.shown ? wave!.baselines.get(region)! : level]))
        // Once the view has settled, the reflection's outer level fills in behind it, nearest first.
        : !wave && stats.startupPhase === 'settled'
          ? new Map(regions.filter(region => !region.exact && region.refs.has(REFLECTION_LEVEL)).map(region => [region, REFLECTION_LEVEL]))
          : new Map<Region, number>();
      const candidates = [...wanted].filter(([region, level]) => !region.meshes.has(level)
        && !region.pending.has(level) && !installs.some(item => item.region === region && item.mesh.level === level));
      candidates.sort(([a], [b]) => Number(!a.exact) - Number(!b.exact)
        || Number(!!a.shown) - Number(!!b.shown) || a.box.distanceToPoint(camera.position) - b.box.distanceToPoint(camera.position)
        || a.rz - b.rz || a.rx - b.rx);
      stats.queued = Math.min(64, candidates.length);
      // Every unresolved request reserves the largest legal decoded result. Together with
      // pending GPU installs this bounds decoded results to 16 MiB, even if replies land together.
      // Each reference names its exact decoded size (the decoder rejects any other), so a request reserves that.
      let reserved = opening.reservedBytes + [...busy.values()].reduce((sum, job) => sum + job.bytes, 0)
        + installs.reduce((sum, item) => sum + item.reply.quads.byteLength, 0);
      for (const [region, level] of candidates.slice(0, 64)) {
        const ref = region.refs.get(level);
        if (!ref) throw new Error('Baked terrain is missing a required resolution');
        const early = opening.take(ref);
        if (!early && (busy.size >= MESH_REQUESTS || reserved + ref.quadCount * 8 > DECODED_BYTES)) break;
        const job: Job = { region, level, id: sequence++, bytes: ref.quadCount * 8 };
        region.pending.set(job.level, job.id); busy.set(job.id, job); if (!early) reserved += job.bytes;
        void (early ?? source!.mesh(ref, controller.signal)).then(reply => receive(job, reply)).catch(error => {
          if (!stopped) fail(error instanceof Error ? error : new Error(String(error)));
        });
      }
      stats.busy = busy.size;
      stats.resultBytes = installs.reduce((sum, item) => sum + item.reply.quads.byteLength, 0);
    }
    // While the opening waits, frames can be far apart (the main thread is busy raising the town), so a freed
    // request slot is refilled from the reply itself. The same bounds hold: six requests, 16 MiB decoded.
    refill = () => {
      if (stopped || presented) return;
      try { dispatch(); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    };
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
        if (!presented) initialSelection();
        else {
          advanceWave(now);
          if (now - lastSelection > 160) { select(now); lastSelection = now; }
          if (!wave) planWave();
          advanceWave(now);
        }
        dispatch();
        stats.covered = regions.filter(r => r.shown).length;
        stats.displayedLevels = [0, 0, 0, 0];
        for (const region of regions) if (region.shown) stats.displayedLevels[region.shown.level] = (stats.displayedLevels[region.shown.level] ?? 0) + 1;
        stats.reflectionMeshes = regions.filter(region => !region.exact && region.meshes.has(REFLECTION_LEVEL)).length;
        stats.residentBytes = regions.reduce((sum, region) => sum + [...region.meshes.values()].reduce((n, mesh) => n + mesh.bytes, 0), 0);
        if (stats.residentBytes > RESIDENT_BYTES) {
          // Last coverage stays installed; only cold alternative resolutions may be evicted.
          for (const region of regions) for (const [level, mesh] of region.meshes) if (!mesh.displayed && !reflectionOnly(region, mesh)
            && level !== region.desired && wave?.targets.get(region) !== level && wave?.baselines.get(region) !== level) {
            free(mesh); region.meshes.delete(level); stats.residentBytes -= mesh.bytes;
          }
        }
        const progress = stats.initialRequiredRegions ? stats.initialCoveredRegions / stats.initialRequiredRegions : 0;
        if (progress !== lastProgress) { lastProgress = progress; options.onProgress?.(progress); }
        if (stats.phase === 'meshing' && stats.initialCoverageReady) { stats.phase = 'ready'; readyResolve(); }
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
      canPresent() {
        if (stopped) return false;
        if (presented) return true;
        try { initialSelection(); return stats.initialCoverageReady; }
        catch (error) { fail(error instanceof Error ? error : new Error(String(error))); return false; }
      },
      markPresented() {
        if (presented || !owner.canPresent()) return;
        presented = true; lastSelection = -Infinity; stats.startupPhase = 'refining';
      },
      setDetail(pixels) {
        if (pixels !== null && !(pixels >= 1 && pixels <= 8)) throw new Error(`Land detail must be 1 to 8 pixels, not ${pixels}`);
        if (pixels === detail) return;
        detail = pixels; lastSelection = -Infinity;
      },
      setBudget(next) {
        if (next !== null && !(next.quads > 0 && next.maxPixels >= 1)) throw new Error('A land budget needs quads and a pixel cap of at least one');
        if (next?.quads === budget?.quads && next?.maxPixels === budget?.maxPixels) return;
        budget = next ? { quads: next.quads, maxPixels: next.maxPixels } : null; lastSelection = -Infinity;
      },
      update, dispose,
    };
    return owner;
  } catch (error) { dispose(); throw error; }
}
