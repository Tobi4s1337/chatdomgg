import * as THREE from 'three';
import type { SettlementPlan } from '@chatdom/world';
import { createQuadGeometry } from '../../../../../packages/render/src/grand/quad-geometry';
import { landMaterials } from '../../../../../packages/world/src/grand/kits';
import type { GrandMaterial } from '../../../../../packages/world/src/grand/palette';
import { GRAND_LEVELS, GRAND_REGION, type GrandLand, type GrandLandSeed } from '../../../../../packages/world/src/grand/types';
import type { SeatedKingdom } from '../../../../../packages/world/src/grand/kingdom';
import { balanceLevels, chooseLevel, type LodState } from '../../grand/lod';
import { HOSTED_GRAND_COMPILER, installedVisualHeight, regionTouchesPhysical, seedForInstalledPlan } from './prepare';
import { HOSTED_RESULT_BYTES, type HostedMesh, type HostedReply, type HostedRequest } from './protocol';
import type { HostedGrandMaterial } from './material';
export { createHostedGrandMaterial, hostedPalette } from './material';

const MiB = 1024 * 1024;
const INSTALL_BYTES = 256 * 1024;
const RESIDENT_BYTES = 128 * MiB;

export interface HostedGrandIdentity {
  readonly compiler: typeof HOSTED_GRAND_COMPILER;
  readonly parameterHash: string;
  readonly seed: GrandLandSeed;
  readonly planRevision: string;
  readonly region: SeatedKingdom['identity']['region'];
  readonly seat: SeatedKingdom['seat']['offset'];
  readonly provenance: 'installed-plan-and-home-style';
}
export interface HostedGrandStats {
  phase: 'meshing' | 'ready' | 'failed' | 'disposed';
  regions: number; covered: number; exactRegions: number; residentBytes: number;
  queued: number; busy: number; resultBytes: number; installs: number; revision: number;
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
  readonly water: { readonly ground: { readonly data: Float32Array; readonly width: number; readonly height: number;
    readonly origin: [number, number]; readonly step: number }; readonly levels: Float32Array; readonly seaLevel: number };
  update(now: number): void;
  dispose(): void;
}
export interface HostedGrandOptions {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly plan: SettlementPlan;
  readonly kingdomId?: string;
  /** Optional exact recipe projection; it never replaces or regenerates plan. */
  readonly seed?: GrandLandSeed;
  readonly signal?: AbortSignal;
  readonly materialFactory: (palette: readonly GrandMaterial[]) => HostedGrandMaterial;
  readonly register?: (mesh: THREE.Mesh) => (() => void) | void;
  readonly onProgress?: (fraction: number) => void;
  readonly onError?: (error: Error) => void;
}

interface RegionMesh { readonly group: THREE.Group; readonly level: number; readonly bytes: number;
  readonly cleanups: (() => void)[]; lastUsed: number }
interface Region { readonly rx: number; readonly rz: number; readonly box: THREE.Box3; readonly exact: boolean;
  readonly neighbours: number[]; readonly meshes: Map<number, RegionMesh>; readonly pending: Map<number, number>;
  readonly lod: LodState; desired: number; shown: RegionMesh | null; visible: boolean; required: boolean }
interface Job { readonly region: Region; readonly level: number; readonly id: number }
interface Install { readonly reply: HostedMesh; readonly region: Region; readonly mesh: RegionMesh; face: number; from: number }

/**
 * Host the grand source/mesher inside the native kingdom's renderer. This owner has no camera, lighting,
 * town, post stack or animation loop. The scene calls update from its one existing RAF, including loading.
 */
export async function prepareHostedGrandLand(options: HostedGrandOptions): Promise<HostedGrandLand> {
  const { plan, camera, renderer } = options;
  if (options.signal?.aborted) throw new DOMException('The kingdom closed', 'AbortError');
  const seed = options.seed ?? seedForInstalledPlan(plan, options.kingdomId);
  const workers: Worker[] = [], idle: Worker[] = [];
  const busy = new Map<Worker, Job>();
  let stopped = false, failed: Error | undefined;
  let landResolve!: (value: { land: GrandLand; seated: SeatedKingdom }) => void;
  let landReject!: (error: Error) => void;
  const landReady = new Promise<{ land: GrandLand; seated: SeatedKingdom }>((resolve, reject) => { landResolve = resolve; landReject = reject; });
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // A scene may abort between raising the source and receiving its owner. Attach immediately to avoid
  // an unhandled rejected promise while keeping the original promise rejected for its actual consumer.
  void ready.catch(() => undefined);
  const regions: Region[] = [], installs: Install[] = [];
  let sequence = 1, lastSelection = -Infinity, lastProgress = -1, firstSelection = true;
  let material: HostedGrandMaterial | undefined;
  const root = new THREE.Group(); root.name = 'installed-grand-land';
  const stats: HostedGrandStats = { phase: 'meshing', regions: 0, covered: 0, exactRegions: 0,
    residentBytes: 0, queued: 0, busy: 0, resultBytes: 0, installs: 0, revision: 0 };
  function free(mesh: RegionMesh) {
    for (const cleanup of mesh.cleanups) cleanup();
    mesh.group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    mesh.group.removeFromParent();
  }
  function dispose() {
    if (stopped) return;
    stopped = true;
    options.signal?.removeEventListener('abort', abort);
    for (const worker of workers) worker.terminate();
    for (const item of installs) free(item.mesh);
    for (const region of regions) for (const mesh of region.meshes.values()) free(mesh);
    installs.length = 0; busy.clear(); idle.length = 0;
    material?.dispose(); root.removeFromParent();
    stats.phase = failed ? 'failed' : 'disposed';
    const error = failed ?? new DOMException('The kingdom closed', 'AbortError');
    landReject(error); readyReject(error);
  }
  function fail(error: Error) {
    if (stopped) return;
    failed = error; dispose(); options.onError?.(error);
  }
  function abort() { dispose(); }
  options.signal?.addEventListener('abort', abort, { once: true });
  const count = Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 4) - 2));
  function send(worker: Worker, message: HostedRequest) { worker.postMessage(message); }
  function receive(worker: Worker, reply: HostedReply) {
    if (stopped) return;
    if (reply.type === 'error') { fail(new Error(reply.message)); return; }
    if (reply.type === 'land') { idle.push(worker); landResolve(reply); return; }
    if (reply.type === 'ready') { idle.push(worker); return; }
    const job = busy.get(worker); busy.delete(worker); idle.push(worker);
    if (!job || job.id !== reply.id || job.region.pending.get(reply.level) !== reply.id) return;
    const region = job.region;
    region.pending.delete(reply.level);
    if (reply.quads.byteLength > HOSTED_RESULT_BYTES) { fail(new Error('Grand terrain exceeded its mesh result budget')); return; }
    // An old visible patch remains until every face of its replacement has installed.
    const group = new THREE.Group();
    group.position.set(reply.rx * GRAND_REGION * .5, 0, reply.rz * GRAND_REGION * .5);
    group.scale.setScalar((1 << reply.level) * .5);
    const mesh: RegionMesh = { group, level: reply.level, bytes: reply.quads.byteLength, cleanups: [], lastUsed: performance.now() };
    installs.push({ reply, region, mesh, face: 0, from: reply.offsets[0]! });
  }
  try {
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: `hosted-grand-${i}` });
      worker.onmessage = (event: MessageEvent<HostedReply>) => receive(worker, event.data);
      worker.onerror = event => fail(new Error(event.message || 'A kingdom landscape worker stopped'));
      workers.push(worker);
    }
    send(workers[0]!, { type: 'generate', plan, seed });
    const { land, seated } = await landReady;
    if (stopped) throw failed ?? new DOMException('The kingdom closed', 'AbortError');
    for (const worker of workers.slice(1)) send(worker, { type: 'adopt', land, seated });
    const parameterBytes = new TextEncoder().encode(JSON.stringify({ compiler: HOSTED_GRAND_COMPILER, seed, plan }));
    const digest = await crypto.subtle.digest('SHA-256', parameterBytes);
    const parameterHash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    if (stopped) throw failed ?? new DOMException('The kingdom closed', 'AbortError');
    const identity: HostedGrandIdentity = { compiler: HOSTED_GRAND_COMPILER, parameterHash, seed,
      planRevision: plan.revision, region: seated.identity.region, seat: seated.seat.offset,
      provenance: 'installed-plan-and-home-style' };
    material = options.materialFactory(landMaterials(land));
    root.position.set(...seated.seat.offset).multiplyScalar(-1);
    options.scene.add(root);
    const metres = land.size * .5, [ox, oy, oz] = seated.seat.offset;
    const bounds = new THREE.Box3(new THREE.Vector3(-ox, -oy, -oz), new THREE.Vector3(metres - ox, land.height * .5 - oy, metres - oz));
    const per = land.size / GRAND_REGION;
    for (let rz = 0; rz < per; rz++) for (let rx = 0; rx < per; rx++) {
      let lo = Infinity, hi = 0;
      for (let z = rz * GRAND_REGION; z < (rz + 1) * GRAND_REGION; z += 4) for (let x = rx * GRAND_REGION; x < (rx + 1) * GRAND_REGION; x += 4) {
        const i = x + z * land.size; lo = Math.min(lo, land.ground[i]!); hi = Math.max(hi, land.ground[i]!, land.water[i]!);
      }
      const box = new THREE.Box3(new THREE.Vector3(rx * GRAND_REGION * .5 - ox, Math.min(lo, land.seaLevel) * .5 - oy, rz * GRAND_REGION * .5 - oz),
        new THREE.Vector3((rx + 1) * GRAND_REGION * .5 - ox, Math.min(land.height, hi + 96) * .5 - oy, (rz + 1) * GRAND_REGION * .5 - oz));
      const exact = regionTouchesPhysical(rx, rz, seated);
      regions.push({ rx, rz, box, exact, neighbours: [], meshes: new Map(), pending: new Map(),
        lod: { shown: null, ideal: exact ? 0 : 3, desired: exact ? 0 : 3, coarsenSince: 0 }, desired: exact ? 0 : 3,
        shown: null, visible: false, required: exact });
    }
    for (const region of regions) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = region.rx + dx, z = region.rz + dz;
      if ((dx || dz) && x >= 0 && z >= 0 && x < per && z < per) region.neighbours.push(x + z * per);
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
      let reserved = busy.size * HOSTED_RESULT_BYTES + installs.reduce((sum, item) => sum + item.reply.quads.byteLength, 0);
      for (const region of candidates.slice(0, 64)) {
        if (!idle.length || reserved + HOSTED_RESULT_BYTES > 16 * MiB) break;
        const worker = idle.pop()!, job: Job = { region, level: region.desired, id: sequence++ };
        region.pending.set(job.level, job.id); busy.set(worker, job); reserved += HOSTED_RESULT_BYTES;
        send(worker, { type: 'mesh', id: job.id, level: job.level, rx: region.rx, rz: region.rz });
      }
      stats.busy = busy.size;
      stats.resultBytes = installs.reduce((sum, item) => sum + item.reply.quads.byteLength, 0);
    }
    function update(now: number) {
      if (stopped) return;
      try {
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
    const waterData = new Float32Array(land.ground.length), waterLevels = new Float32Array(land.ground.length);
    for (let i = 0; i < waterData.length; i++) {
      waterData[i] = land.ground[i]! * .5 - oy;
      waterLevels[i] = land.water[i]! > land.ground[i]! ? land.water[i]! * .5 - oy : NaN;
    }
    const owner: HostedGrandLand = { ready, identity, bounds, stats,
      get revision() { return stats.revision; },
      height: (x, z) => installedVisualHeight(land, seated, x, z),
      water: { ground: { data: waterData, width: land.size, height: land.size, origin: [-ox, -oz], step: .5 },
        levels: waterLevels, seaLevel: land.seaLevel * .5 - oy },
      update, dispose,
    };
    update(performance.now());
    return owner;
  } catch (error) { dispose(); throw error; }
}
