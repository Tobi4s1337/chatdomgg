import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createSunShadows, createVoxelMaterial, geometryFromChunks, getEnvironment, type Environment, type VoxelRenderState } from '@chatdom/render';
import { VOXEL_METRES, type Vec3, type VoxelAsset, type VoxelLattice } from '@chatdom/shared';
import { VoxelWorkerPool, type AssetChunkMesh, type LightVolume } from '@chatdom/voxel';
import { createKeepsakeShelf, createShelfAlcove, SHELF_MAX_BAYS, type KeepsakeShelf } from '../../../../../packages/content/src/keepsakes';
import '../providers';
import { itemModels } from '../catalogue';
import { itemDefinition } from '../definitions';
import { frameView, handTurn, pageSpan, shelfPages, type Frame, type Insets, type Placement, type ShelfPage } from './layout';

/*
 * The alcove at home, drawn for real: the carved shelf and the room's corner as voxel meshes, every keepsake its own
 * registered voxel model, lit by the hour's key light through the room with sun shadows, and warmed by the candles
 * through the voxel material's own light field. It draws on demand: a frame when something moves, nothing at rest.
 */

export const SHELF_HOUR = 18.2;
const CELL = VOXEL_METRES.avatar;
/** Where the shelf's board lips and lace hang, in shelf cells from its back: tags hang here, places face here. */
const LIP_Z = 26, LACE_Z = 27;
const FOV = 30, ELEVATION = .1, MARGIN = .035;
const LIFT = new THREE.Vector3(0, .32, 1.7);
const CANDLE_REACH = 3.4;
const MAX_PIXEL_RATIO = 2;

const WORDS = {
  noWebgl: 'The shelf needs WebGL to be drawn, and this browser has it turned off.',
  lost: 'The picture of the shelf was lost. Close it and open it again.',
  failed: 'The shelf could not be drawn just now. Close it and open it again.',
} as const;
export const SCENE_WORDS = WORDS;

/** Meshed room pieces, kept as worker output so reopening the shelf does not carve it again. GPU copies are per view. */
const roomCache = new Map<string, Promise<readonly AssetChunkMesh[]>>();
const ROOM_CACHE = 4;

export interface ScreenPlace {
  readonly slot: number;
  /** The place's open front, in CSS pixels on the canvas. */
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  /** Where a number tag hangs on the board's edge below it. */
  readonly tag: { readonly x: number; readonly y: number };
  /** Its point in the shelf's own cells, for walking focus by the shelf's layout. */
  readonly cell: { readonly x: number; readonly y: number };
  readonly onPage: boolean;
}
export interface ScreenFlame { readonly x: number; readonly y: number; readonly size: number }

export interface ShelfSceneOptions {
  readonly compact: boolean;
  readonly hour?: number;
}

export interface ShelfScene {
  /** Builds (or rebuilds) the shelf for this many bays. Resolves once the room is drawn. */
  setBays(bays: number): Promise<void>;
  /** The keepsakes standing on the shelf; moved ones glide to their new places. Resolves once all are drawn. */
  setKeepsakes(list: readonly Placement[], animate: boolean): Promise<void>;
  /** The canvas size and the room the controls take; `animate` glides the camera to the new framing. */
  setSize(width: number, height: number, insets: Insets, animate?: boolean): void;
  /** Draws a frame now (if anything is built) and resolves once it is on screen. */
  draw(): Promise<void>;
  setCompact(compact: boolean): void;
  pages(): readonly ShelfPage[];
  page(): number;
  setPage(page: number, animate: boolean): void;
  places(): readonly ScreenPlace[];
  flames(): readonly ScreenFlame[];
  /** Whether a keepsake's model could be drawn; false leaves an honest gap with its words in the overlay. */
  drawn(id: string): boolean;
  /** Lifts a keepsake forward out of its place (null sets everything down). */
  lift(id: string | null): void;
  /** Holds a lifted keepsake under the pointer, in canvas CSS pixels. */
  hold(id: string, x: number, y: number): void;
  /** Called after a frame whose camera or keepsakes moved, so the overlay can follow. */
  onLayout(listener: () => void): () => void;
  /** True once the browser has taken the drawing context away. */
  lost(): boolean;
  dispose(): void;
}

interface Model { readonly geometry: THREE.BufferGeometry; readonly lattice: VoxelLattice; readonly min: THREE.Vector3; readonly max: THREE.Vector3 }
interface Pose { readonly position: THREE.Vector3; rotX: number; rotY: number }
interface Standing {
  readonly id: string;
  defId: string;
  slot: number;
  readonly holder: THREE.Group;
  mesh: THREE.Mesh | null;
  model: Model | null;
  scale: number;
  lifted: boolean;
  held: boolean;
  tween: { from: Pose; to: Pose; start: number; duration: number; arc: number } | null;
  detach: (() => void) | null;
  missing: boolean;
  /** Just set out from the bag: it is lowered into its place once its model is ready. */
  arrive: boolean;
}

function occupiedBounds(asset: VoxelAsset): { min: THREE.Vector3; max: THREE.Vector3 } | null {
  const [sx, sy, sz] = asset.size;
  let x0 = sx, y0 = sy, z0 = sz, x1 = -1, y1 = -1, z1 = -1;
  for (let z = 0, i = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++, i++) {
    if (!asset.voxels[i]) continue;
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
    if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
  }
  if (x1 < 0) return null;
  const s = VOXEL_METRES[asset.lattice];
  return { min: new THREE.Vector3(x0 * s, y0 * s, z0 * s), max: new THREE.Vector3((x1 + 1) * s, (y1 + 1) * s, (z1 + 1) * s) };
}

/** The room's grade: the hour's light, turned to come in from the upper left like a window's, candles always lit. */
export function shelfGrade(hour: number): Environment {
  const env = getEnvironment(hour);
  const key = new THREE.Vector3(-.58, .64, .5).normalize();
  return {
    ...env, sunDirection: [key.x, key.y, key.z], fogDensity: 0,
    sunIntensity: THREE.MathUtils.clamp(env.sunIntensity, .42, 1.05),
    ambientIntensity: env.ambientIntensity * 1.12,
    night: Math.max(env.night, .22),
  };
}

/**
 * The candles' warmth as the voxel material's light field: a soft pool round each flame, summed and quantised to the
 * field's sixteen levels, sampled with linear filtering so the pools have no steps.
 */
export function candleField(lights: readonly Vec3[], min: Vec3, max: Vec3): LightVolume {
  const margin = 4.6;
  const origin: Vec3 = [min[0] - margin, min[1] - margin, min[2] - margin];
  const extent = [max[0] - min[0] + 2 * margin, max[1] - min[1] + 2 * margin, max[2] - min[2] + 2 * margin];
  let cell = .25;
  while (extent.reduce((n, e) => n * Math.ceil(e / cell), 1) > 720_000) cell *= 1.12;
  const size = extent.map(e => Math.ceil(e / cell)) as [number, number, number];
  const sum = new Float32Array(size[0] * size[1] * size[2]);
  for (const [lx, ly, lz] of lights) {
    const from = [lx, ly, lz].map((v, a) => Math.max(0, Math.floor((v - CANDLE_REACH - origin[a]!) / cell)));
    const to = [lx, ly, lz].map((v, a) => Math.min(size[a]! - 1, Math.ceil((v + CANDLE_REACH - origin[a]!) / cell)));
    for (let z = from[2]!; z <= to[2]!; z++) for (let y = from[1]!; y <= to[1]!; y++) for (let x = from[0]!; x <= to[0]!; x++) {
      const d = Math.hypot(origin[0] + (x + .5) * cell - lx, origin[1] + (y + .5) * cell - ly, origin[2] + (z + .5) * cell - lz);
      if (d < CANDLE_REACH) sum[x + size[0] * (y + size[1] * z)]! += (1 - d / CANDLE_REACH) ** 1.5;
    }
  }
  const light = new Uint8Array(sum.length);
  for (let i = 0; i < sum.length; i++) light[i] = Math.min(15, Math.round(15 * sum[i]! * .92));
  return { revision: 1, origin, size, cellSize: cell, light, visited: 0, estimatedPeakBytes: light.byteLength };
}

const ease = (t: number) => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const settle = (t: number) => 1 - (1 - t) ** 3;

export function createShelfScene(canvas: HTMLCanvasElement, options: ShelfSceneOptions): ShelfScene {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch { throw new Error(WORDS.noWebgl); }
  renderer.setPixelRatio(Math.min(MAX_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1)));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const grade = shelfGrade(options.hour ?? SHELF_HOUR);
  renderer.toneMappingExposure = grade.exposure;
  // Beyond the window: the hour's sky, a little darker than its horizon.
  renderer.setClearColor(new THREE.Color(grade.horizon).lerp(new THREE.Color(grade.zenith), .45).multiplyScalar(.8), 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, .1, 400);
  const pool = new VoxelWorkerPool({ size: 2, maxQueue: 96 });
  const materials = new Map<VoxelLattice, VoxelRenderState>();
  const models = new Map<string, Promise<Model | null>>();
  const standing = new Map<string, Standing>();
  const listeners = new Set<() => void>();
  const room = new THREE.Group();
  scene.add(room);
  let shadows: ReturnType<typeof createSunShadows> | null = null;
  let shelf: KeepsakeShelf | null = null, shelfAt = new THREE.Vector3();
  let roomMeshes: THREE.Mesh[] = [], roomDetach: (() => void)[] = [];
  let field: LightVolume | null = null;
  let bays = 0, building: Promise<void> | null = null, generation = 0;
  let compact = options.compact, width = 1, height = 1, insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  let pageList: ShelfPage[] = [], current = 0;
  let view: { from: Frame; to: Frame; start: number; duration: number } | null = null;
  let frame: number | null = null, disposed = false, lost = false, moved = true;
  const sun = new THREE.Vector3(...grade.sunDirection);

  const onLost = (event: Event) => { event.preventDefault(); lost = true; for (const listener of listeners) listener(); };
  canvas.addEventListener('webglcontextlost', onLost);

  function materialFor(lattice: VoxelLattice): VoxelRenderState {
    let state = materials.get(lattice);
    if (!state) {
      state = createVoxelMaterial(MATERIALS, lattice);
      state.setEnvironment(grade);
      if (field) applyField(state, field);
      shadows?.bindReceiver(state.material);
      materials.set(lattice, state);
    }
    return state;
  }

  function applyField(state: VoxelRenderState, volume: LightVolume): void {
    state.setLight(volume);
    const texture = state.material.uniforms.uLight!.value as THREE.Data3DTexture;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
  }

  async function mesh(asset: VoxelAsset): Promise<readonly AssetChunkMesh[]> {
    const result = await pool.submit({ kind: 'asset', asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (!result || result.kind !== 'asset' || !result.chunks.length) throw new Error(WORDS.failed);
    return result.chunks;
  }
  function roomPiece(key: string, create: () => VoxelAsset): Promise<readonly AssetChunkMesh[]> {
    let job = roomCache.get(key);
    if (job) { roomCache.delete(key); roomCache.set(key, job); return job; }
    job = mesh(create());
    roomCache.set(key, job);
    job.catch(() => { if (roomCache.get(key) === job) roomCache.delete(key); });
    while (roomCache.size > ROOM_CACHE) roomCache.delete(roomCache.keys().next().value!);
    return job;
  }

  function modelFor(defId: string): Promise<Model | null> {
    const modelId = itemDefinition(defId)?.model ?? defId;
    let job = models.get(modelId);
    if (!job) {
      job = (async () => {
        let asset: VoxelAsset | undefined;
        try { asset = itemModels.create(modelId); } catch { return null; }
        const bounds = asset ? occupiedBounds(asset) : null;
        if (!asset || !bounds) return null;
        const chunks = await mesh(asset).catch(() => null);
        if (!chunks || disposed) return null;
        return { geometry: geometryFromChunks(chunks, asset.lattice), lattice: asset.lattice, ...bounds };
      })();
      models.set(modelId, job);
    }
    return job;
  }

  /** Where a keepsake rests in a place: centred, on its board, its back a hair from the back panel, turned by hand. */
  function restPose(entry: Standing): Pose {
    const slot = shelf?.slots[entry.slot];
    const position = new THREE.Vector3();
    let rotY = handTurn(entry.id);
    if (!slot) return { position, rotX: 0, rotY };
    const width = entry.model ? (entry.model.max.x - entry.model.min.x) * entry.scale : 1;
    position.set(slot.at[0] * CELL, slot.at[1] * CELL, (slot.back + .6) * CELL + Math.abs(Math.sin(rotY)) * width / 2).add(shelfAt);
    if (!entry.model) rotY = 0;
    return { position, rotX: 0, rotY };
  }
  function liftPose(entry: Standing): Pose {
    const rest = restPose(entry);
    return { position: rest.position.clone().add(LIFT), rotX: -.06, rotY: 0 };
  }
  function apply(entry: Standing, pose: Pose): void {
    entry.holder.position.copy(pose.position);
    entry.holder.rotation.set(pose.rotX, pose.rotY, 0, 'YXZ');
  }
  function poseOf(entry: Standing): Pose {
    return { position: entry.holder.position.clone(), rotX: entry.holder.rotation.x, rotY: entry.holder.rotation.y };
  }
  function glide(entry: Standing, to: Pose, duration: number, arc: number): void {
    entry.tween = { from: poseOf(entry), to, start: performance.now(), duration, arc };
    shadowOff(entry);
    invalidate();
  }
  function shadowOn(entry: Standing): void {
    if (!shadows || !entry.mesh || entry.detach) return;
    entry.holder.updateMatrixWorld(true);
    entry.detach = shadows.register(entry.mesh);
  }
  function shadowOff(entry: Standing): void {
    if (!entry.detach) return;
    entry.detach(); entry.detach = null;
  }

  function fitScale(model: Model, slot: number): number {
    const place = shelf?.slots[slot];
    if (!place) return 1;
    const w = model.max.x - model.min.x, h = model.max.y - model.min.y, d = model.max.z - model.min.z;
    return Math.min(1, place.width * CELL / w, place.height * CELL / h, (place.depth - 1) * CELL / d);
  }

  async function dress(entry: Standing): Promise<void> {
    const defId = entry.defId;
    const model = await modelFor(defId);
    if (disposed || standing.get(entry.id) !== entry || entry.defId !== defId) return;
    if (entry.mesh) { shadowOff(entry); entry.holder.remove(entry.mesh); entry.mesh = null; }
    entry.model = model;
    entry.missing = !model;
    if (!model) { invalidate(); return; }
    const material = materialFor(model.lattice);
    const object = new THREE.Mesh(model.geometry, material.material);
    object.name = `keepsake-${entry.id}`;
    entry.mesh = object;
    entry.holder.add(object);
    place(entry);
    if (entry.arrive && !entry.lifted) {
      entry.arrive = false;
      apply(entry, liftPose(entry));
      glide(entry, restPose(entry), 520, .1);
    } else if (!entry.lifted && !entry.tween) { apply(entry, restPose(entry)); shadowOn(entry); }
    moved = true; invalidate();
  }
  /** Sizes and centres the model in its holder for the place it stands in. */
  function place(entry: Standing): void {
    if (!entry.mesh || !entry.model) return;
    const { min, max } = entry.model;
    entry.scale = fitScale(entry.model, entry.slot);
    entry.mesh.scale.setScalar(entry.scale);
    entry.mesh.position.set(-(min.x + max.x) / 2 * entry.scale, -min.y * entry.scale, -min.z * entry.scale);
  }

  async function setBays(next: number): Promise<void> {
    if (next === bays && building) return building;
    bays = next;
    const ticket = ++generation;
    building = (async () => {
      const nextShelf = createKeepsakeShelf(next), nextAlcove = createShelfAlcove(nextShelf);
      const [shelfChunks, alcoveChunks] = await Promise.all([
        roomPiece(`shelf.${next}`, () => nextShelf.asset), roomPiece(`alcove.${next}`, () => nextAlcove.asset)]);
      if (disposed || ticket !== generation) return;
      for (const detach of roomDetach) detach();
      roomDetach = [];
      for (const old of roomMeshes) { room.remove(old); old.geometry.dispose(); }
      shelf = nextShelf;
      shelfAt = new THREE.Vector3(...nextAlcove.shelfAt);
      const alcoveMesh = new THREE.Mesh(geometryFromChunks(alcoveChunks, 'build'), materialFor('build').material);
      const shelfMesh = new THREE.Mesh(geometryFromChunks(shelfChunks, 'avatar'), materialFor('avatar').material);
      alcoveMesh.name = 'shelf-alcove'; shelfMesh.name = 'keepsake-shelf';
      shelfMesh.position.copy(shelfAt);
      room.add(alcoveMesh, shelfMesh);
      roomMeshes = [alcoveMesh, shelfMesh];
      room.updateMatrixWorld(true);
      // Shadows and the candles' field cover the whole alcove.
      const [ax, ay, az] = nextAlcove.asset.size.map(n => n * VOXEL_METRES.build) as [number, number, number];
      // One shadow map for the life of the view, sized for the longest shelf this alcove can grow to: a material is
      // bound to its map once, so the map is never replaced.
      if (!shadows) {
        const longest = ax + (SHELF_MAX_BAYS - next) * (nextShelf.bayX[0]![1] - nextShelf.bayX[0]![0]) * CELL;
        shadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(longest, ay, az)), resolution: 2048 });
        for (const state of materials.values()) shadows.bindReceiver(state.material);
      }
      roomDetach.push(shadows.register(shelfMesh));
      const lights = nextShelf.lights.map(([x, y, z]): Vec3 => [shelfAt.x + x * CELL, shelfAt.y + y * CELL, shelfAt.z + z * CELL]);
      field = candleField(lights, [0, 0, 0], [ax, ay, az]);
      for (const state of materials.values()) applyField(state, field);
      pageList = shelfPages(next, compact);
      current = Math.min(current, pageList.length - 1);
      view = null;
      for (const entry of standing.values()) { place(entry); apply(entry, entry.lifted ? liftPose(entry) : restPose(entry)); if (!entry.lifted) shadowOn(entry); }
      moved = true;
      await drawNow();
    })();
    return building;
  }

  async function setKeepsakes(list: readonly Placement[], animate: boolean): Promise<void> {
    if (building) await building;
    if (disposed) return;
    const keep = new Set(list.map(item => item.id));
    for (const [id, entry] of standing) {
      if (keep.has(id)) continue;
      shadowOff(entry);
      room.remove(entry.holder);
      standing.delete(id);
    }
    const jobs: Promise<void>[] = [];
    for (const item of list) {
      let entry = standing.get(item.id);
      if (!entry) {
        entry = { id: item.id, defId: item.defId, slot: item.slot, holder: new THREE.Group(), mesh: null, model: null, scale: 1,
          lifted: false, held: false, tween: null, detach: null, missing: false, arrive: animate };
        entry.holder.name = `keepsake-holder-${item.id}`;
        standing.set(item.id, entry);
        room.add(entry.holder);
        apply(entry, restPose(entry));
        jobs.push(dress(entry));
        continue;
      }
      const changedKind = entry.defId !== item.defId;
      const changedSlot = entry.slot !== item.slot;
      entry.defId = item.defId;
      if (changedKind) { entry.slot = item.slot; jobs.push(dress(entry)); continue; }
      if (!changedSlot) continue;
      const from = poseOf(entry);
      entry.slot = item.slot;
      place(entry);
      const was = entry.lifted || entry.held;
      entry.lifted = false; entry.held = false;
      if (animate) {
        entry.holder.position.copy(from.position);
        glide(entry, restPose(entry), was ? 420 : 560, was ? .25 : .7);
      } else { shadowOff(entry); apply(entry, restPose(entry)); shadowOn(entry); }
    }
    moved = true;
    invalidate();
    await Promise.all(jobs);
  }

  function frameFor(index: number): Frame | null {
    const page = pageList[index];
    if (!shelf || !page) return null;
    const [x0, x1] = pageSpan(page, shelf.bayX);
    const [, sy, sz] = shelf.asset.size;
    return frameView({
      width, height, insets, fov: FOV, elevation: ELEVATION, margin: compact ? .02 : MARGIN,
      min: [shelfAt.x + x0 * CELL, shelfAt.y, shelfAt.z], max: [shelfAt.x + x1 * CELL, shelfAt.y + sy * CELL, shelfAt.z + Math.min(sz, LIP_Z) * CELL],
    });
  }
  let lastFrame: Frame | null = null;
  function applyFrame(f: Frame): void {
    lastFrame = f;
    camera.fov = f.fov;
    camera.aspect = f.full[0] / f.full[1];
    camera.setViewOffset(f.full[0], f.full[1], f.offset[0], f.offset[1], width, height);
    camera.position.set(...f.position);
    camera.lookAt(...f.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  function invalidate(): void {
    if (frame !== null || disposed) return;
    frame = requestAnimationFrame(step);
  }
  let drawWaiters: (() => void)[] = [];
  function drawNow(): Promise<void> {
    return new Promise(resolve => { drawWaiters.push(resolve); invalidate(); });
  }

  function step(now: number): void {
    frame = null;
    if (disposed) return;
    let animating = false;
    if (view) {
      const t = Math.min(1, (now - view.start) / view.duration), k = ease(t);
      const { from, to } = view;
      const mix = <T extends number[]>(a: T, b: T) => a.map((v, i) => v + (b[i]! - v) * k) as T;
      applyFrame({ position: mix(from.position, to.position), target: mix(from.target, to.target), fov: from.fov + (to.fov - from.fov) * k,
        full: mix(from.full, to.full), offset: mix(from.offset, to.offset), scale: from.scale + (to.scale - from.scale) * k });
      if (t >= 1) view = null; else animating = true;
      moved = true;
    } else {
      const f = frameFor(current);
      if (f) applyFrame(f);
    }
    for (const entry of standing.values()) {
      if (!entry.tween) continue;
      const { from, to, start, duration, arc } = entry.tween;
      const t = Math.min(1, (now - start) / duration), k = settle(t);
      const position = from.position.clone().lerp(to.position, k);
      position.z += Math.sin(Math.PI * t) * arc;
      position.y += Math.sin(Math.PI * t) * arc * .25;
      apply(entry, { position, rotX: from.rotX + (to.rotX - from.rotX) * k, rotY: from.rotY + (to.rotY - from.rotY) * k });
      moved = true;
      if (t >= 1) { entry.tween = null; if (!entry.lifted && !entry.held) shadowOn(entry); } else animating = true;
    }
    if (!lost && shelf) {
      scene.updateMatrixWorld(true);
      shadows?.updateSunDirection(sun);
      renderer.render(scene, camera);
    }
    if (moved) { moved = false; for (const listener of listeners) listener(); }
    if (animating) invalidate();
    const waiters = drawWaiters; drawWaiters = [];
    for (const resolve of waiters) resolve();
  }

  const project = new THREE.Vector3();
  function toScreen(x: number, y: number, z: number): { x: number; y: number; z: number } {
    project.set(x, y, z).project(camera);
    return { x: (project.x + 1) / 2 * width, y: (1 - project.y) / 2 * height, z: project.z };
  }

  return {
    setBays,
    setKeepsakes,
    setSize(w, h, nextInsets, animate = false) {
      const resized = Math.round(w) !== width || Math.round(h) !== height;
      const changed = resized || JSON.stringify(nextInsets) !== JSON.stringify(insets);
      width = Math.max(1, Math.round(w)); height = Math.max(1, Math.round(h)); insets = nextInsets;
      if (!changed) return;
      if (resized) renderer.setSize(width, height, false);
      const to = frameFor(current);
      view = animate && !resized && lastFrame && to && !matchMedia('(prefers-reduced-motion: reduce)').matches
        ? { from: lastFrame, to, start: performance.now(), duration: 420 } : null;
      moved = true; invalidate();
    },
    draw: () => drawNow(),
    setCompact(next) {
      if (next === compact) return;
      compact = next;
      pageList = shelf ? shelfPages(shelf.bays, compact) : [];
      current = Math.min(current, Math.max(0, pageList.length - 1));
      view = null; moved = true; invalidate();
    },
    pages: () => pageList,
    page: () => current,
    setPage(index, animate) {
      const next = Math.max(0, Math.min(pageList.length - 1, index));
      if (next === current && !view) return;
      const from = frameFor(current), to = frameFor(next);
      current = next;
      const start = view && lastFrame ? lastFrame : from;
      view = animate && start && to && !matchMedia('(prefers-reduced-motion: reduce)').matches
        ? { from: start, to, start: performance.now(), duration: 520 } : null;
      moved = true; invalidate();
    },
    places() {
      if (!shelf) return [];
      const page = pageList[current];
      const [left, right] = page ? pageSpan(page, shelf.bayX) : [0, 0];
      return shelf.slots.map((slot, n): ScreenPlace => {
        const [cx, cy] = slot.at;
        const x0 = shelfAt.x + (cx - slot.width / 2) * CELL, x1 = shelfAt.x + (cx + slot.width / 2) * CELL;
        const y0 = shelfAt.y + cy * CELL, y1 = shelfAt.y + (cy + slot.height) * CELL, z = shelfAt.z + LIP_Z * CELL;
        const a = toScreen(x0, y1, z), b = toScreen(x1, y0, z);
        const tag = toScreen(shelfAt.x + cx * CELL, shelfAt.y + (cy - (slot.tier === 1 ? 2.6 : 1.6)) * CELL, shelfAt.z + (slot.tier === 1 ? LACE_Z : LIP_Z) * CELL);
        return { slot: n, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), tag,
          cell: { x: cx, y: cy }, onPage: cx > left && cx < right };
      });
    },
    flames() {
      if (!shelf) return [];
      const f = frameFor(current);
      const scale = f?.scale ?? 40;
      return shelf.lights.map(([x, y, z]) => {
        const p = toScreen(shelfAt.x + x * CELL, shelfAt.y + y * CELL, shelfAt.z + z * CELL);
        return { x: p.x, y: p.y, size: scale * 1.1 };
      }).filter(p => p.x > -80 && p.y > -80 && p.x < width + 80 && p.y < height + 80);
    },
    drawn: id => { const entry = standing.get(id); return !!entry && !entry.missing; },
    lift(id) {
      for (const entry of standing.values()) {
        const want = entry.id === id;
        if (want === entry.lifted && !entry.held) continue;
        entry.lifted = want; entry.held = false;
        glide(entry, want ? liftPose(entry) : restPose(entry), want ? 300 : 380, want ? 0 : .15);
      }
    },
    hold(id, x, y) {
      const entry = standing.get(id);
      if (!entry || !shelf) return;
      entry.lifted = true; entry.held = true; entry.tween = null;
      shadowOff(entry);
      const ndc = new THREE.Vector2(x / width * 2 - 1, -(y / height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(shelfAt.z + (LIP_Z + 8) * CELL));
      const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) return;
      const h = entry.model ? (entry.model.max.y - entry.model.min.y) * entry.scale : 1;
      apply(entry, { position: hit.sub(new THREE.Vector3(0, h / 2, 0)), rotX: -.06, rotY: 0 });
      moved = true; invalidate();
    },
    onLayout(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    lost: () => lost,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      canvas.removeEventListener('webglcontextlost', onLost);
      for (const resolve of drawWaiters) resolve();
      drawWaiters = [];
      for (const entry of standing.values()) shadowOff(entry);
      for (const detach of roomDetach) detach();
      shadows?.dispose();
      for (const old of roomMeshes) old.geometry.dispose();
      for (const job of models.values()) void job.then(model => model?.geometry.dispose(), () => undefined);
      models.clear(); standing.clear(); listeners.clear();
      for (const state of materials.values()) state.dispose();
      materials.clear();
      pool.dispose();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

