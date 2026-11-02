import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  applyGrade, createGrandClouds, createGrandDepthMaterial, createGrandPost, createGrandSky, createGrandTerrainMaterial, createGrandUniforms,
  createLandMist, createQuadGeometry, grandGrade, grandPaletteTexture, GrandSea, GrandShadow, seaFloorTexture, type GrandClouds, type GrandPost, type GrandUniforms,
} from '../../../../packages/render/src/grand';
import { GRAND_REVEAL_STAGES, grandRevealField, grandRevealMask, grandRevealOpening, grandRevealStage, type GrandRevealField, type GrandRevealOpening } from '../../../../packages/world/src/grand/reveal';
import { paletteTable } from '../../../../packages/world/src/grand/palette';
import { landMaterials } from '../../../../packages/world/src/grand/kits';
import { skyOcclusionMap } from '../../../../packages/world/src/grand/sky-map';
import { GRAND_LEVELS, GRAND_REGION, GRAND_VOXEL_METRES, STRUCTURE_STRIDE, type GrandLand, type GrandLandSeed } from '../../../../packages/world/src/grand/types';
import { balanceLevels, chooseLevel, type LodState } from './lod';
import type { GrandWorkerReply, GrandWorkerRequest } from './worker';

export type GrandTier = 'ultra' | 'high' | 'medium' | 'low' | 'software';

export interface GrandTierSettings {
  /** Terrain screen-error target, px per cell (spec 56: 1 high, 1.5 laptop, 2 phone/software). */
  readonly target: number;
  /** Internal pixel budget. */
  readonly pixels: number;
  readonly ratio: number;
  readonly shadow: number;
  readonly reflection: boolean;
  /** Longest side of the reflection target and its refresh rate (0 = every rendered frame). */
  readonly reflectionSize: number;
  readonly reflectionHz: number;
  readonly samples: number;
  readonly bloom: boolean;
  /** Continuous animation; software renders on demand. */
  readonly continuous: boolean;
  /** Mesh installation per frame: bytes and CPU milliseconds, first limit wins. */
  readonly installBytes: number;
  readonly installMillis: number;
  /** Resident terrain geometry budget (bytes). */
  readonly residentBytes: number;
  /** Main-view triangle budget the quality governor holds (spec 56 budgets table). */
  readonly mainTriangles: number;
}

const MiB = 1024 * 1024;
export const GRAND_TIERS: Record<GrandTier, GrandTierSettings> = {
  ultra: { target: 1.0, pixels: 2.1e6, ratio: 2, shadow: 4096, reflection: true, reflectionSize: 640, reflectionHz: 30, samples: 4, bloom: true, continuous: true, installBytes: 2 * MiB, installMillis: 1, residentBytes: 320 * MiB, mainTriangles: 3e6 },
  high: { target: 1.0, pixels: 2.1e6, ratio: 1.5, shadow: 4096, reflection: true, reflectionSize: 512, reflectionHz: 15, samples: 4, bloom: true, continuous: true, installBytes: 2 * MiB, installMillis: 1, residentBytes: 256 * MiB, mainTriangles: 3e6 },
  medium: { target: 1.5, pixels: 1.45e6, ratio: 1.25, shadow: 2048, reflection: true, reflectionSize: 384, reflectionHz: 10, samples: 0, bloom: true, continuous: true, installBytes: 1 * MiB, installMillis: 0.75, residentBytes: 128 * MiB, mainTriangles: 1.5e6 },
  low: { target: 2.0, pixels: 0.85e6, ratio: 1, shadow: 0, reflection: false, reflectionSize: 0, reflectionHz: 0, samples: 0, bloom: false, continuous: true, installBytes: 0.5 * MiB, installMillis: 0.75, residentBytes: 64 * MiB, mainTriangles: 6e5 },
  software: { target: 2.0, pixels: 0.5e6, ratio: 1, shadow: 2048, reflection: true, reflectionSize: 384, reflectionHz: 0, samples: 0, bloom: true, continuous: false, installBytes: 0.25 * MiB, installMillis: 0.5, residentBytes: 64 * MiB, mainTriangles: 2.5e5 },
};

/**
 * Evidence stills on a software renderer: full internal resolution, the high shadow and reflection, and no
 * install limit, because nobody interacts with a still. It is never an fps claim (spec 56 "Budgets").
 */
export const GRAND_CAPTURE: Partial<GrandTierSettings> = { pixels: 4.2e6, ratio: 1, shadow: 4096, reflectionSize: 640, installBytes: 1e12, installMillis: 1e6, residentBytes: 1024 * MiB, target: 2, mainTriangles: Infinity };

export type GrandView = 'orbit' | 'high' | 'castle' | 'harbour' | 'summit' | 'fields' | 'mere';
export const GRAND_VIEWS: readonly GrandView[] = ['orbit', 'high', 'castle', 'harbour', 'summit', 'fields', 'mere'];

export interface GrandPassCost { calls: number; triangles: number }
export interface GrandStats {
  phase: 'raising' | 'meshing' | 'ready';
  progress: number;
  tier: GrandTier;
  capture: boolean;
  regions: number;
  /** Regions shown at each level. */
  levels: number[];
  /** Solid terrain cells represented and tree voxels stamped so far. */
  terrainVoxels: number;
  treeVoxels: number;
  trees: number;
  quadsResident: number;
  residentBytes: number;
  targetBytes: number;
  main: GrandPassCost;
  reflection: GrandPassCost;
  shadow: GrandPassCost;
  frame: GrandPassCost;
  workers: number;
  busyWorkers: number;
  queued: number;
  queuedResultBytes: number;
  installedBytes: number;
  installsPending: number;
  evictions: number;
  staleResults: number;
  generateMillis: number;
  /** The land came from this browser's cache of earlier visits. */
  landCached: boolean;
  meshMillis: number;
  workerP95: number;
  pixels: number;
  /** The quality governor's factor on the LOD target (1 = the tier's own target). */
  governor: number;
  fps: number;
  hour: number;
  view: GrandView;
}

interface RegionMesh { level: number; group: THREE.Group; faces: (THREE.Mesh | null)[]; quads: number; bytes: number; box: THREE.Box3; lastUsed: number }
interface Region {
  rx: number; rz: number; box: THREE.Box3; centre: THREE.Vector3; neighbours: number[]; lod: LodState;
  shown: RegionMesh | null; meshes: Map<number, RegionMesh>;
  /** Level → the job id whose result is the only one accepted for it. */
  pending: Map<number, number>;
  desired: number;
}
interface Job { id: number; level: number; region: Region }
type MeshReply = Extract<GrandWorkerReply, { type: 'mesh' }>;
interface Install { region: Region; reply: MeshReply; next: number; mesh: RegionMesh }

const M = GRAND_VOXEL_METRES;
const QUEUE_LIMIT = 64;
const RESULT_BYTES_LIMIT = 16 * MiB;
const RETAIN_MS = 2000;

export class GrandEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly landScene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 1, 14000);
  readonly controls: OrbitControls;
  readonly uniforms: GrandUniforms = createGrandUniforms();
  /** The sea mist over the land the kingdom has not opened yet (GW13); off while the citizen count is unknown. */
  readonly mist = createLandMist();
  readonly stats: GrandStats;
  /** What the last milestone opened, for the bench's caption. */
  opening: GrandRevealOpening | null = null;
  private reveal: GrandRevealField | null = null;
  private revealStage = -1;
  private citizens: number | null;
  readonly settings: GrandTierSettings;
  land: GrandLand | null = null;
  onChange: (() => void) | null = null;
  onReady: (() => void) | null = null;
  private failure: ((message: string) => void) | null = null;
  private landResolve: (() => void) | null = null;
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly busy = new Map<Worker, Job>();
  private queue: Job[] = [];
  private installs: Install[] = [];
  private jobId = 1;
  private regions: Region[] = [];
  private terrainMaterials: THREE.RawShaderMaterial[] = [];
  private depthMaterials: THREE.RawShaderMaterial[] = [];
  private shadow: GrandShadow | null = null;
  private sea: GrandSea | null = null;
  private clouds: GrandClouds | null = null;
  private cloudHeight = 235;
  private post: GrandPost | null = null;
  private shadowDirty = true;
  private shadowAt = 0;
  private reflectionAt = -1e9;
  private dirty = true;
  private raf = 0;
  private lastFrame = 0;
  private frames: number[] = [];
  private workerMillis: number[] = [];
  private averageBytes = [2.4 * MiB, 0.7 * MiB, 0.2 * MiB, 0.06 * MiB];
  private sunAzimuth = 0;
  private hour: number;
  private time: number;
  private readonly frozen: boolean;
  private readyFired = false;
  private meshStart = 0;
  private disposed = false;
  private pendingView: GrandView;
  private readonly landBox = new THREE.Box3();
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly scratch = new THREE.Vector3();
  private governor = 1;
  private governedAt = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly seed: GrandLandSeed, options: { tier: GrandTier; capture: boolean; hour: number; view: GrandView; time: number | null; citizens?: number | null }) {
    this.citizens = options.citizens ?? null;
    this.settings = options.capture && options.tier === 'software' ? { ...GRAND_TIERS[options.tier], ...GRAND_CAPTURE } : GRAND_TIERS[options.tier];
    this.hour = options.hour;
    this.time = options.time ?? 0;
    this.frozen = options.time !== null || !this.settings.continuous;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: options.capture });
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 30;
    this.controls.maxDistance = 2600;
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.scene.add(this.landScene);
    const pass = () => ({ calls: 0, triangles: 0 });
    this.stats = {
      phase: 'raising', progress: 0, tier: options.tier, capture: options.capture, regions: 0, levels: [0, 0, 0, 0], terrainVoxels: 0, treeVoxels: 0, trees: 0,
      quadsResident: 0, residentBytes: 0, targetBytes: 0, main: pass(), reflection: pass(), shadow: pass(), frame: pass(), workers: 0, busyWorkers: 0,
      queued: 0, queuedResultBytes: 0, installedBytes: 0, installsPending: 0, evictions: 0, staleResults: 0, generateMillis: 0, landCached: false, meshMillis: 0, workerP95: 0,
      pixels: 0, governor: 1, fps: 0, hour: options.hour, view: options.view,
    };
    this.pendingView = options.view;
  }

  set onFailure(handler: (message: string) => void) { this.failure = handler; }

  async start(): Promise<void> {
    // Spec 56: the pool starts at min(4, max(1, cores − 2)); the land itself is raised by the first worker.
    const count = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 2));
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: `grand-land-${i}` });
      worker.onmessage = (event: MessageEvent<GrandWorkerReply>) => this.receive(worker, event.data);
      worker.onerror = event => this.failure?.(event.message || 'A land worker stopped.');
      this.workers.push(worker);
    }
    this.stats.workers = count;
    const started = performance.now();
    this.workers[0]!.postMessage({ type: 'generate', seed: this.seed } satisfies GrandWorkerRequest);
    await new Promise<void>(resolve => { this.landResolve = resolve; });
    this.stats.generateMillis = performance.now() - started;
    this.raf = requestAnimationFrame(this.frame);
  }

  private receive(worker: Worker, reply: GrandWorkerReply): void {
    if (this.disposed) return;
    if (reply.type === 'error') { this.failure?.(reply.message); return; }
    if (reply.type === 'land') {
      this.stats.landCached = reply.cached;
      this.adopt(reply.land);
      this.idle.push(worker);
      for (const other of this.workers.slice(1)) other.postMessage({ type: 'land', land: reply.land } satisfies GrandWorkerRequest);
      this.landResolve?.();
      return;
    }
    if (reply.type === 'ready') { this.idle.push(worker); return; }
    this.busy.delete(worker);
    this.idle.push(worker);
    this.workerMillis.push(reply.millis);
    if (this.workerMillis.length > 200) this.workerMillis.shift();
    const bytes = reply.quads.byteLength;
    this.averageBytes[reply.level] = this.averageBytes[reply.level]! * 0.8 + bytes * 0.2;
    const region = this.regions.find(r => r.rx === reply.rx && r.rz === reply.rz);
    // Only the job currently expected for this level installs; superseded and evicted requests are dropped.
    if (!region || region.pending.get(reply.level) !== reply.id || !this.wanted(region, reply.level)) {
      if (region && region.pending.get(reply.level) === reply.id) region.pending.delete(reply.level);
      this.stats.staleResults++;
      return;
    }
    region.pending.delete(reply.level);
    if (reply.level === 0) this.stats.treeVoxels += reply.treeVoxels;
    const s = 1 << reply.level, span = GRAND_REGION / s;
    const group = new THREE.Group();
    group.position.set(reply.rx * GRAND_REGION * M, 0, reply.rz * GRAND_REGION * M);
    group.scale.setScalar(s * M);
    group.updateMatrixWorld(true);
    const local = new THREE.Box3(new THREE.Vector3(0, reply.minY, 0), new THREE.Vector3(span, Math.max(reply.minY + 1, reply.maxY), span));
    const mesh: RegionMesh = { level: reply.level, group, faces: [], quads: 0, bytes, box: local.clone().applyMatrix4(group.matrixWorld), lastUsed: performance.now() };
    this.installs.push({ region, reply, next: 0, mesh });
    this.dirty = true;
  }

  /** A level is wanted when it is the target, or while nothing covers the region, any coarser cover. */
  private wanted(region: Region, level: number): boolean {
    return level === region.desired || (!region.shown && level >= region.desired);
  }

  private adopt(land: GrandLand): void {
    this.land = land;
    const metres = land.size * M;
    this.landBox.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(metres, land.height * M, metres));
    this.stats.terrainVoxels = land.stats.solidVoxels;
    this.stats.trees = land.treeCount;
    const palette = grandPaletteTexture(paletteTable(landMaterials(land)));
    for (let level = 0; level < GRAND_LEVELS; level++) {
      const material = createGrandTerrainMaterial(this.uniforms, palette, this.mist.uniforms);
      material.uniforms.uLodScale!.value = 1 << level;
      this.terrainMaterials.push(material);
      const depth = createGrandDepthMaterial();
      depth.uniforms.uLodScale!.value = 1 << level;
      this.depthMaterials.push(depth);
    }
    const sky = skyOcclusionMap(land);
    const half = new Uint16Array(sky.data.length);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(sky.data[i]!);
    const skyTexture = new THREE.DataTexture(half, sky.size, sky.size, THREE.RGFormat, THREE.HalfFloatType);
    skyTexture.magFilter = skyTexture.minFilter = THREE.LinearFilter;
    skyTexture.needsUpdate = true;
    this.uniforms.uSkyAo.value = skyTexture;
    this.uniforms.uLandMetres.value = metres;
    this.uniforms.uSeaLevel.value = land.seaLevel * M;
    this.uniforms.uFogBase.value = land.seaLevel * M;
    this.uniforms.uVoxel.value = M;
    this.scene.add(createGrandSky(this.uniforms));
    this.sea = new GrandSea(this.uniforms, {
      seaY: land.seaLevel * M, floor: seaFloorTexture(land.ground, land.coast, land.size, M), landMetres: metres,
      reflection: this.settings.reflection, reflectionMax: this.settings.reflectionSize, mist: this.mist.uniforms,
    });
    this.scene.add(this.sea.mesh);
    const peak = land.sites.summit.y * M;
    this.cloudHeight = Math.max(235, peak + 55);
    this.clouds = createGrandClouds(this.uniforms, { seed: land.size ^ land.treeCount, height: this.cloudHeight, cover: 0.3 });
    // The mist deck lies three fifths of the way up from the sea to the summit: the valleys sink into it, the crowns stand out.
    this.mist.setDeck(land.seaLevel * M + (peak - land.seaLevel * M) * 0.6);
    if (this.citizens !== null) this.setCitizens(this.citizens, 0);
    this.scene.add(this.clouds.mesh);
    this.uniforms.uShadowOn.value = 0;
    this.shadow = this.settings.shadow > 0 ? new GrandShadow(this.settings.shadow) : null;
    this.post = createGrandPost(this.renderer, this.scene, this.camera, { samples: this.settings.samples, bloom: this.settings.bloom });
    // The sun sets off to one side of the harbour view, ahead of the camera's shoulder: faces toward the
    // camera are lit and raked, shadows run long across the frame and the sky glows at one edge. Which side is the channel's (a stable bit of its seed).
    const c = metres / 2;
    const front = Math.atan2(land.sites.harbour.z * M - c, land.sites.harbour.x * M - c);
    this.sunAzimuth = front + Math.PI * (land.seed.seedKey.length % 2 ? 0.36 : -0.36);
    this.applyHour();
    const per = land.size / GRAND_REGION;
    for (let rz = 0; rz < per; rz++) for (let rx = 0; rx < per; rx++) {
      let lo = 1e9, hi = 0, built = 0;
      for (let z = rz * GRAND_REGION; z < (rz + 1) * GRAND_REGION; z += 2) for (let x = rx * GRAND_REGION; x < (rx + 1) * GRAND_REGION; x += 2) {
        const i = x + z * land.size;
        lo = Math.min(lo, land.ground[i]!); hi = Math.max(hi, land.ground[i]!, land.water[i]!);
      }
      for (let b = 0; b < land.structureCount; b++) {
        const o = b * STRUCTURE_STRIDE, st = land.structures;
        if (st[o + 3]! > rx * GRAND_REGION && st[o]! < (rx + 1) * GRAND_REGION && st[o + 5]! > rz * GRAND_REGION && st[o + 2]! < (rz + 1) * GRAND_REGION) built = Math.max(built, st[o + 4]!);
      }
      // Bounds include the tallest trees and decoration above the ground, and any placed piece.
      const box = new THREE.Box3(new THREE.Vector3(rx * GRAND_REGION * M, Math.max(lo, land.seaLevel - 2) * M, rz * GRAND_REGION * M),
        new THREE.Vector3((rx + 1) * GRAND_REGION * M, Math.max(hi + 64, built + 4) * M, (rz + 1) * GRAND_REGION * M));
      const lod: LodState = { shown: null, ideal: GRAND_LEVELS - 1, desired: GRAND_LEVELS - 1, coarsenSince: 0 };
      this.regions.push({ rx, rz, box, centre: box.getCenter(new THREE.Vector3()), neighbours: [], lod, shown: null, meshes: new Map(), pending: new Map(), desired: GRAND_LEVELS - 1 });
    }
    for (const region of this.regions) {
      region.neighbours = this.regions.flatMap((o, i) => o !== region && Math.abs(o.rx - region.rx) <= 1 && Math.abs(o.rz - region.rz) <= 1 ? [i] : []);
    }
    this.stats.regions = this.regions.length;
    this.stats.phase = 'meshing';
    this.meshStart = performance.now();
    this.resize();
    this.setView(this.pendingView);
  }

  /** Build staged geometry one face bucket at a time inside the tier's per-frame byte and time limits. */
  private install(now: number): void {
    const started = performance.now();
    let bytes = 0;
    while (this.installs.length) {
      const item = this.installs[0]!;
      if (!this.wanted(item.region, item.mesh.level)) { this.installs.shift(); this.free(item.mesh); this.stats.staleResults++; continue; }
      const f = item.next, from = item.reply.offsets[f]!, to = item.reply.offsets[f + 1]!;
      if (to > from) {
        const s = 1 << item.mesh.level, span = GRAND_REGION / s;
        const local = new THREE.Box3(new THREE.Vector3(0, item.reply.minY, 0), new THREE.Vector3(span, Math.max(item.reply.minY + 1, item.reply.maxY), span));
        const mesh = new THREE.Mesh(createQuadGeometry(item.reply.quads.subarray(from * 2, to * 2), local), this.terrainMaterials[item.mesh.level]!);
        mesh.matrixAutoUpdate = false;
        item.mesh.group.add(mesh);
        item.mesh.faces.push(mesh);
        item.mesh.quads += to - from;
        bytes += (to - from) * 8;
      } else item.mesh.faces.push(null);
      item.next++;
      if (item.next === 6) {
        this.installs.shift();
        item.mesh.group.updateMatrixWorld(true);
        item.mesh.lastUsed = now;
        const old = item.region.meshes.get(item.mesh.level);
        if (old) this.evict(item.region, old);
        item.region.meshes.set(item.mesh.level, item.mesh);
        this.stats.installedBytes += item.mesh.bytes;
        this.consider(item.region, now);
        this.shadowDirty = true;
      }
      if (bytes >= this.settings.installBytes || performance.now() - started >= this.settings.installMillis) break;
    }
  }

  /** Show the desired level when ready; otherwise keep the current cover, or take the nearest ready one. */
  private consider(region: Region, now: number): void {
    const ready = region.meshes.get(region.desired);
    if (ready) { this.show(region, ready, now); return; }
    if (region.shown) return;
    let best: RegionMesh | null = null;
    for (const mesh of region.meshes.values()) if (!best || Math.abs(mesh.level - region.desired) < Math.abs(best.level - region.desired)) best = mesh;
    if (best) this.show(region, best, now);
  }

  private show(region: Region, mesh: RegionMesh, now: number): void {
    mesh.lastUsed = now;
    if (region.shown === mesh) return;
    if (region.shown) { region.shown.lastUsed = now; this.landScene.remove(region.shown.group); }
    region.shown = mesh;
    this.landScene.add(mesh.group);
    this.shadowDirty = true;
    this.dirty = true;
  }

  private evict(region: Region, mesh: RegionMesh): void {
    if (region.shown === mesh) { this.landScene.remove(mesh.group); region.shown = null; }
    region.meshes.delete(mesh.level);
    this.free(mesh);
    this.stats.evictions++;
  }

  private free(mesh: RegionMesh): void { for (const face of mesh.faces) face?.geometry.dispose(); }

  /** Projected cell size in pixels of a level at the region's nearest point. */
  private cellPixels(region: Region, level: number, projection: number): number {
    region.box.clampPoint(this.camera.position, this.scratch);
    const depth = Math.max(0.5, this.scratch.distanceTo(this.camera.position));
    return (1 << level) * M * projection / depth;
  }

  /**
   * Screen-error LOD (spec 56): refine above 1.2× target, coarsen only below 0.8× for half a second, then
   * balance neighbours to at most one level apart. Queue what is missing, visible and near first.
   */
  private select(now: number): void {
    const height = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y || 1;
    const projection = height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    const target = this.settings.target * this.governor;
    for (const region of this.regions) {
      region.lod.shown = region.shown?.level ?? null;
      chooseLevel(region.lod, level => this.cellPixels(region, level, projection), target, GRAND_LEVELS, now);
    }
    balanceLevels(this.regions.map(r => r.lod), this.regions.map(r => r.neighbours), GRAND_LEVELS);
    for (const region of this.regions) region.desired = region.lod.desired;
    this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    for (const region of this.regions) {
      this.consider(region, now);
      if (!region.meshes.has(region.desired) && !region.pending.has(region.desired)) this.enqueue(region, region.desired);
      // A region with nothing to show first gets its coarsest cover, so the whole island appears at once.
      if (!region.shown && region.desired < GRAND_LEVELS - 1 && this.settings.continuous && !region.meshes.has(GRAND_LEVELS - 1) && !region.pending.has(GRAND_LEVELS - 1)) {
        this.enqueue(region, GRAND_LEVELS - 1);
      }
    }
    // Release what is neither shown nor wanted once it has been cold for two seconds, then by age past the budget.
    let resident = 0;
    const cold: [Region, RegionMesh][] = [];
    for (const region of this.regions) for (const mesh of [...region.meshes.values()]) {
      if (mesh === region.shown || mesh.level === region.desired) { mesh.lastUsed = now; resident += mesh.bytes; continue; }
      if (now - mesh.lastUsed > RETAIN_MS) { this.evict(region, mesh); continue; }
      resident += mesh.bytes;
      cold.push([region, mesh]);
    }
    cold.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (resident > this.settings.residentBytes && cold.length) { const [region, mesh] = cold.shift()!; resident -= mesh.bytes; this.evict(region, mesh); }
  }

  private enqueue(region: Region, level: number): void {
    const job: Job = { id: this.jobId++, level, region };
    region.pending.set(level, job.id);
    this.queue.push(job);
  }

  private priority(job: Job): number {
    const region = job.region;
    const cover = region.shown ? 0 : -1e7;
    const visible = this.frustum.intersectsBox(region.box) ? 0 : 1e6;
    return cover + visible + region.centre.distanceTo(this.camera.position) + job.level * 40;
  }

  private dispatch(): void {
    this.queue = this.queue.filter(job => {
      const keep = job.region.pending.get(job.level) === job.id && this.wanted(job.region, job.level) && !job.region.meshes.has(job.level);
      if (!keep && job.region.pending.get(job.level) === job.id) job.region.pending.delete(job.level);
      return keep;
    });
    this.queue.sort((a, b) => this.priority(a) - this.priority(b));
    // A bounded queue: the furthest wishes wait to be asked again rather than piling up.
    for (const dropped of this.queue.splice(QUEUE_LIMIT)) dropped.region.pending.delete(dropped.level);
    let committed = this.installs.reduce((sum, item) => sum + item.mesh.bytes, 0);
    for (const job of this.busy.values()) committed += this.averageBytes[job.level]!;
    while (this.idle.length && this.queue.length) {
      const next = this.queue[0]!;
      if (committed + this.averageBytes[next.level]! > RESULT_BYTES_LIMIT && committed > 0) break;
      this.queue.shift();
      const worker = this.idle.pop()!;
      this.busy.set(worker, next);
      committed += this.averageBytes[next.level]!;
      worker.postMessage({ type: 'mesh', id: next.id, level: next.level, rx: next.region.rx, rz: next.region.rz } satisfies GrandWorkerRequest);
    }
    this.stats.queued = this.queue.length;
    this.stats.busyWorkers = this.busy.size;
    this.stats.queuedResultBytes = committed;
    this.stats.installsPending = this.installs.length;
  }

  /** Show only face directions that can face this eye. */
  private cullFaces(eye: THREE.Vector3): void {
    for (const region of this.regions) {
      const mesh = region.shown;
      if (!mesh) continue;
      const { min, max } = mesh.box;
      mesh.faces.forEach((face, f) => {
        if (!face) return;
        const axis = f >> 1, positive = (f & 1) === 0;
        const e = axis === 0 ? eye.x : axis === 1 ? eye.y : eye.z;
        face.visible = positive ? e > (axis === 0 ? min.x : axis === 1 ? min.y : min.z) : e < (axis === 0 ? max.x : axis === 1 ? max.y : max.z);
      });
    }
  }

  private renderShadow(): void {
    if (!this.shadow || !this.land) return;
    const sun = this.uniforms.uSunDir.value;
    if (sun.y < 0.02) { this.uniforms.uShadowOn.value = 0; this.shadowDirty = false; return; }
    this.shadow.fit(this.landBox, sun);
    this.shadow.render(this.renderer, this.landScene, on => {
      for (const region of this.regions) {
        const mesh = region.shown;
        if (!mesh) continue;
        mesh.faces.forEach((face, f) => {
          if (!face) return;
          face.material = on ? this.depthMaterials[mesh.level]! : this.terrainMaterials[mesh.level]!;
          if (on) {
            const axis = f >> 1, sign = (f & 1) === 0 ? 1 : -1;
            face.visible = sign * (axis === 0 ? sun.x : axis === 1 ? sun.y : sun.z) > 0;
          }
        });
      }
    }, this.uniforms);
    this.shadowDirty = false;
  }

  private passCost(): GrandPassCost {
    const info = this.renderer.info.render;
    return { calls: info.calls, triangles: info.triangles };
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (!this.land || !this.post) return;
    if (this.controls.update()) this.dirty = true;
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    if (!this.frozen) { this.time += dt; this.dirty = true; }
    if (this.mist.lifting) this.dirty = true;
    this.mist.update(this.mist.lifting ? Math.max(dt, this.frozen ? 1 / 30 : 0) : 0, { fog: this.uniforms.uFogColor.value, sun: this.uniforms.uSunColor.value, night: this.uniforms.uNight.value });
    this.mist.uniforms.uMistTime.value = this.time;
    this.camera.updateMatrixWorld();
    this.select(now);
    this.dispatch();
    this.install(now);
    const settled = this.queue.length === 0 && this.busy.size === 0 && this.installs.length === 0;
    if (!this.dirty && settled && !this.shadowDirty) return;
    // A software renderer spends seconds on a frame: it draws once the land has settled, so the workers keep
    // the processor while it streams. The loading plaque is plain DOM and keeps reporting progress.
    if (!this.settings.continuous && !settled) {
      this.stats.progress = this.regions.length ? this.regions.filter(r => r.shown && r.shown.level === r.desired).length / this.regions.length : 0;
      this.stats.meshMillis = performance.now() - this.meshStart;
      this.dispatch();
      this.onChange?.();
      return;
    }
    this.renderer.info.reset();
    // Shadows refresh when the cover or the sun changes; while streaming at most four times a second.
    if (this.shadowDirty && (settled || now - this.shadowAt > 250)) { this.renderShadow(); this.shadowAt = now; }
    const afterShadow = this.passCost();
    this.uniforms.uTime.value = this.time;
    this.clouds?.update(this.time, this.camera.position);
    const hz = this.settings.reflectionHz;
    if (this.sea?.target && (hz === 0 || now - this.reflectionAt >= 1000 / hz)) {
      this.reflectionAt = now;
      const mirrored = this.camera.position.clone();
      mirrored.y = 2 * this.uniforms.uSeaLevel.value - mirrored.y;
      this.cullFaces(mirrored);
      this.sea.renderReflection(this.renderer, this.scene, this.camera, this.uniforms);
    }
    const afterReflection = this.passCost();
    this.cullFaces(this.camera.position);
    this.post.render();
    const total = this.passCost();
    this.stats.shadow = afterShadow;
    this.stats.reflection = { calls: afterReflection.calls - afterShadow.calls, triangles: afterReflection.triangles - afterShadow.triangles };
    this.stats.main = { calls: total.calls - afterReflection.calls, triangles: total.triangles - afterReflection.triangles };
    this.stats.frame = total;
    this.govern(now);
    this.dirty = false;
    this.measure(now);
    const ready = settled && this.regions.every(r => r.shown && r.shown.level === r.desired) && !this.shadowDirty;
    this.stats.phase = ready ? 'ready' : 'meshing';
    this.stats.progress = this.regions.length ? this.regions.filter(r => r.shown && r.shown.level === r.desired).length / this.regions.length : 0;
    if (!ready) this.stats.meshMillis = performance.now() - this.meshStart;
    this.onChange?.();
    if (ready && !this.readyFired) {
      this.readyFired = true;
      requestAnimationFrame(() => requestAnimationFrame(() => this.onReady?.()));
    }
    if (!ready) { this.readyFired = false; if (!this.settings.continuous) this.dirty = true; }
  };

  /**
   * Hold the main view inside its triangle budget by coarsening the LOD target when over, and relaxing it
   * when well under; twice a second at most, so the LOD hysteresis settles between steps.
   */
  private govern(now: number): void {
    if (now - this.governedAt < 500 || !Number.isFinite(this.settings.mainTriangles)) return;
    this.governedAt = now;
    const load = this.stats.main.triangles / this.settings.mainTriangles;
    if (load > 1.05) this.governor = Math.min(4, this.governor * 1.2);
    else if (load < 0.6 && this.governor > 1) this.governor = Math.max(1, this.governor / 1.1);
    this.stats.governor = this.governor;
  }

  private measure(now: number): void {
    this.frames.push(now);
    while (this.frames.length > 30) this.frames.shift();
    if (this.frames.length > 1) this.stats.fps = (this.frames.length - 1) * 1000 / (this.frames[this.frames.length - 1]! - this.frames[0]!);
    let resident = 0, bytes = 0;
    const levels = [0, 0, 0, 0];
    for (const region of this.regions) {
      for (const mesh of region.meshes.values()) { resident += mesh.quads; bytes += mesh.bytes; }
      if (region.shown) levels[region.shown.level]!++;
    }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const targets = size.x * size.y * (8 + 4) * (this.settings.samples > 1 ? 2 : 1) + (this.shadow ? this.settings.shadow ** 2 * 4 : 0)
      + (this.sea?.target ? this.sea.target.width * this.sea.target.height * 12 : 0);
    this.stats.quadsResident = resident;
    this.stats.residentBytes = bytes;
    this.stats.targetBytes = targets;
    this.stats.levels = levels;
    this.stats.pixels = size.x * size.y;
    const sorted = [...this.workerMillis].sort((a, b) => a - b);
    this.stats.workerP95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)]! : 0;
  }

  private applyHour(): void {
    const grade = grandGrade(this.hour, this.sunAzimuth);
    applyGrade(this.uniforms, grade);
    this.renderer.toneMappingExposure = grade.exposure;
    this.stats.hour = this.hour;
    this.shadowDirty = true;
    this.dirty = true;
  }

  /**
   * Lay the mist for a citizen count: the land opens stage by stage as the count crosses each milestone, a pure
   * function of the land and the count. With `lift` seconds the newly opened land rolls clear instead of appearing.
   */
  setCitizens(citizens: number, lift = 6): void {
    this.citizens = citizens;
    const land = this.land;
    if (!land) return;
    const t = land.sites.town;
    // The founded town is the land the kingdom already lives on: its flat, with a margin, is clear from the first day.
    this.reveal ??= grandRevealField(land, {
      x0: Math.max(0, Math.floor(t.x - t.rx * 1.25)), z0: Math.max(0, Math.floor(t.z - t.rz * 1.25)),
      x1: Math.min(land.size, Math.ceil(t.x + t.rx * 1.25)), z1: Math.min(land.size, Math.ceil(t.z + t.rz * 1.25)),
    });
    const stage = grandRevealStage(citizens);
    if (stage === this.revealStage) return;
    const whole = stage === GRAND_REVEAL_STAGES - 1;
    const metres = land.size * M;
    this.mist.set(grandRevealMask(this.reveal, stage), this.reveal.cells, [0, 0, metres, metres], whole ? 1 : 0, stage > this.revealStage && this.revealStage >= 0 ? lift : undefined);
    this.opening = grandRevealOpening(this.reveal, stage);
    this.revealStage = stage;
    this.dirty = true;
    this.readyFired = false;
  }

  setHour(hour: number): void { this.hour = hour; this.applyHour(); this.readyFired = false; }

  setView(view: GrandView): void {
    this.stats.view = view;
    const land = this.land;
    if (!land) { this.pendingView = view; return; }
    const c = land.size * M / 2, s = land.sites;
    const front = Math.atan2(s.harbour.z * M - c, s.harbour.x * M - c);
    // 16:10 is the composed frame. Narrow (portrait) frames first widen the lens, up to 62°, then pull back
    // so the land still fits across; the camera always stays under the cloud deck, lowering its pitch if it
    // would rise into it, so a phone looks across the land rather than down through the clouds.
    const aspect = this.camera.aspect, narrow = Math.min(1, Math.max(0, (1.6 - aspect) / 1.1));
    this.camera.fov = 38 + 24 * narrow;
    this.camera.updateProjectionMatrix();
    const across = Math.tan(THREE.MathUtils.degToRad(19)) * 1.6 / (Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * aspect);
    const fit = Math.min(2.6, Math.max(1, Math.pow(across, 0.75)));
    const ceiling = this.cloudHeight - 30;
    const place = (tx: number, ty: number, tz: number, bearing: number, reach: number, steep: number) => {
      const distance = reach * fit;
      // Views composed above the deck (high) keep their 16:10 height; only the portrait pull-back is capped.
      const limit = Math.max(ceiling, ty + Math.sin(steep) * reach);
      const pitch = ty + Math.sin(steep) * distance > limit ? Math.asin(Math.max(0.05, (limit - ty) / distance)) : steep;
      this.controls.target.set(tx, ty, tz);
      this.camera.position.set(tx + Math.cos(bearing) * Math.cos(pitch) * distance, ty + Math.sin(pitch) * distance, tz + Math.sin(bearing) * Math.cos(pitch) * distance);
      this.camera.lookAt(this.controls.target);
      this.controls.update();
    };
    const deg = THREE.MathUtils.degToRad;
    const toward = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.atan2(b.z - a.z, b.x - a.x);
    switch (view) {
      case 'orbit': place(c, 30, c, front, land.size * M * 0.95, deg(15)); break;
      case 'high': place(c, 20, c, front + 0.35, land.size * M * 1.02, deg(44)); break;
      case 'castle': place(s.castle.x * M, s.castle.top * M, s.castle.z * M, toward(s.castle, s.town) + 0.3, 230, deg(20)); break;
      case 'harbour': place(s.harbour.x * M, land.seaLevel * M + 4, s.harbour.z * M, s.harbour.facing + 0.35, 260, deg(17)); break;
      case 'summit': place(s.summit.x * M, s.summit.y * M * 0.8, s.summit.z * M, toward(s.summit, s.castle) + 0.4, 360, deg(18)); break;
      case 'fields': place(s.fields.x * M, land.seaLevel * M + 6, s.fields.z * M, front + 0.5, 240, deg(26)); break;
      case 'mere': {
        const m = s.mere ?? { x: s.fields.x, z: s.fields.z, level: land.seaLevel };
        place(m.x * M, m.level * M, m.z * M, front + 0.2, 220, deg(20));
        break;
      }
    }
    this.dirty = true;
    this.readyFired = false;
  }

  orbit(yaw: number | null, pitch: number | null, distance: number | null): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    if (yaw !== null) spherical.theta = THREE.MathUtils.degToRad(yaw);
    if (pitch !== null) spherical.phi = THREE.MathUtils.degToRad(90 - pitch);
    if (distance !== null) spherical.radius = distance;
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.dirty = true;
    this.readyFired = false;
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth, height = this.canvas.clientHeight || window.innerHeight;
    // The internal pixel budget wins over the device ratio (spec 56: ≤2.1 M high, ≤1.45 M laptop …).
    const ratio = Math.min(window.devicePixelRatio || 1, this.settings.ratio, Math.sqrt(this.settings.pixels / (width * height)));
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.post?.setSize(width, height, ratio);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const worker of this.workers) worker.terminate();
    for (const region of this.regions) for (const mesh of [...region.meshes.values()]) this.evict(region, mesh);
    for (const item of this.installs) this.free(item.mesh);
    this.terrainMaterials.forEach(m => m.dispose());
    this.depthMaterials.forEach(m => m.dispose());
    this.shadow?.dispose(); this.sea?.dispose(); this.clouds?.dispose(); this.post?.dispose(); this.mist.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
