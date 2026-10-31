import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { geometryFromChunks, type VoxelRenderState } from '@chatdom/render';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { bandAttribute, createDressingMaterial } from './material';
import { pieceRole, planViews, type GroundBlocker, type GroundDressingInput, type GroundDressingPlan, type GroundPiece, type GroundViews } from './plan';

type Level = 1 | 2 | 4;
/** [level, near, far] in metres, landscape then portrait (R4 bands; the last level of each family is its far cut). */
type Bands = readonly (readonly [Level, number, number, number, number])[];
const BANDS: Record<'tufts' | 'clover' | 'flowers' | 'solid', Bands> = {
  // Tufts are full detail to the street's end, then a coarse level carries them to where they vanish in grass.
  tufts: [[1, 0, 30, 0, 21], [2, 30, 58, 21, 38]],
  clover: [[1, 0, 30, 0, 21]],
  // Flower drifts keep the town reading flowered from the castle.
  flowers: [[1, 0, 30, 0, 21], [2, 30, 90, 21, 60], [4, 90, 180, 60, 110]],
  solid: [[1, 0, 32, 0, 22], [2, 32, 95, 22, 55], [4, 95, 180, 55, 110]],
};
const TILE = 32;

export interface GroundDressingHost extends GroundDressingInput {
  plan: GroundDressingPlan;
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; pool: VoxelWorkerPool; clay: VoxelRenderState;
  registerShadow(mesh: THREE.Mesh): () => void; signal: AbortSignal;
}
export interface GroundDressingStats {
  drawCalls: number; shadowDrawCalls: number; instances: number; triangles: number; geometryBytes: number;
  /** CPU-side prebuilt tile blocks (instance transforms per level), separate from the GPU bytes above. */
  cpuBytes: number;
}
export interface GroundDressing {
  ready: Promise<void>;
  blockers: readonly GroundBlocker[];
  collisionPieces: readonly GroundBlocker[];
  update(frame: { time: number; walkers: readonly Vec3[] }): void;
  hideLot(slot: number | null): void;
  views(): GroundViews;
  stats(): GroundDressingStats;
  dispose(): void;
}

interface Tile { min: THREE.Vector3; max: THREE.Vector3; visible: boolean; near: number; far: number }
interface Block { tile: number; pieces: readonly GroundPiece[]; slots: Int32Array; matrices: Map<Level, Float32Array>; hasSlot: Set<number> }
interface LevelMesh { level: Level; bands: readonly [number, number, number, number]; mesh?: THREE.InstancedMesh; geometry?: THREE.BufferGeometry; members: Uint8Array; installed: boolean }
interface Batch { blueprint: VoxelBlueprint; family: keyof typeof BANDS; blocks: Block[]; levels: LevelMesh[]; count: number; shadow?: { mesh: THREE.InstancedMesh; geometry: THREE.BufferGeometry; release: () => void } }

function familyOf(blueprint: VoxelBlueprint): keyof typeof BANDS {
  const role = pieceRole(blueprint);
  if (!role.cover) return 'solid';
  return role.form.startsWith('wildflowers-') ? 'flowers' : role.form === 'clover-pebbles' ? 'clover' : 'tufts';
}

/** Instance transform: translate · shear onto the fitted ground plane · yaw · level scale. */
export function pieceMatrix(piece: GroundPiece, level: Level, out = new THREE.Matrix4()): THREE.Matrix4 {
  out.makeRotationY(piece.yaw).scale(new THREE.Vector3(level, level, level));
  if (piece.slope) out.premultiply(new THREE.Matrix4().set(1, 0, 0, 0, piece.slope[0], 1, piece.slope[1], 0, 0, 0, 1, 0, 0, 0, 0, 1));
  return out.setPosition(piece.position[0], piece.position[1], piece.position[2]);
}

/**
 * Mounts an already computed plan (never replans): instanced batches per form and detail level, indexed in 32 m tiles.
 * Camera or lot-visibility changes reinstall only the prebuilt tile blocks of the levels whose membership changed;
 * distance fades run in the shader, so a still camera rewrites nothing. Solid pieces cast through `registerShadow`
 * at their nearest level; cover casts no sun shadow.
 */
export function createGroundDressing(host: GroundDressingHost): GroundDressing {
  const { plan, scene, camera, pool, clay, signal } = host;
  const derived = createDressingMaterial(clay.material);
  const views = planViews(host.land, host.ground);
  let disposed = false, hidden: number | null = null, dirty = true, portrait = camera.aspect < 1, cpuBytes = 0;

  // Tiles hold every placement by its origin, the same point the shader measures fades from.
  const tiles: Tile[] = [], tileIndex = new Map<string, number>();
  const tileOf = (p: GroundPiece) => {
    const key = `${Math.floor(p.position[0] / TILE)},${Math.floor(p.position[2] / TILE)}`;
    let index = tileIndex.get(key);
    if (index === undefined) {
      index = tiles.length; tileIndex.set(key, index);
      tiles.push({ min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity), visible: false, near: 0, far: 0 });
    }
    return index;
  };
  const batches: Batch[] = [];
  const corner = new THREE.Vector3(), scratch = new THREE.Matrix4();
  for (const [, pieces] of [...plan.pieces].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const blueprint = pieces[0]!.blueprint, family = familyOf(blueprint), byTile = new Map<number, GroundPiece[]>();
    for (const piece of pieces) {
      const t = tileOf(piece), list = byTile.get(t);
      if (list) list.push(piece); else byTile.set(t, [piece]);
      // Grow the tile by the piece's transformed box.
      const m = pieceMatrix(piece, 1, scratch);
      for (const x of [0, blueprint.size[0] * 0.125]) for (const y of [0, blueprint.size[1] * 0.125]) for (const z of [0, blueprint.size[2] * 0.125]) {
        corner.set(x / 0.125, y / 0.125, z / 0.125).multiplyScalar(0.125).applyMatrix4(m);
        tiles[t]!.min.min(corner); tiles[t]!.max.max(corner);
      }
    }
    const levels = BANDS[family].map(([level]) => ({ level, bands: [0, 0, 0, 0] as [number, number, number, number], members: new Uint8Array(0), installed: false }));
    const blocks: Block[] = [...byTile].sort(([a], [b]) => a - b).map(([tile, list]) => {
      const matrices = new Map<Level, Float32Array>();
      for (const { level } of levels) {
        const array = new Float32Array(list.length * 16);
        list.forEach((piece, i) => pieceMatrix(piece, level, scratch).toArray(array, i * 16));
        matrices.set(level, array); cpuBytes += array.byteLength;
      }
      const slots = Int32Array.from(list, piece => piece.lotSlot ?? -1);
      return { tile, pieces: list, slots, matrices, hasSlot: new Set(list.flatMap(piece => piece.lotSlot === undefined ? [] : [piece.lotSlot])) };
    });
    batches.push({ blueprint, family, blocks, levels, count: pieces.length });
  }
  for (const batch of batches) for (const level of batch.levels) level.members = new Uint8Array(tiles.length);

  function bandsFor(batch: Batch, index: number): [number, number, number, number] {
    const row = BANDS[batch.family][index]!, near = portrait ? row[3] : row[1], far = portrait ? row[4] : row[2];
    return [near, far, portrait ? 2.5 : 3, index === BANDS[batch.family].length - 1 ? 1 : 0];
  }
  function applyBands(): void {
    for (const batch of batches) batch.levels.forEach((level, i) => {
      level.bands = bandsFor(batch, i);
      const attribute = level.geometry?.getAttribute('aBand') as THREE.InstancedBufferAttribute | undefined;
      if (attribute) { attribute.array.set(level.bands); attribute.needsUpdate = true; }
    });
  }
  applyBands();

  /** Installs one level: the member tiles' prebuilt blocks, skipping a hidden lot's placements. */
  function install(batch: Batch, level: LevelMesh): void {
    const mesh = level.mesh;
    if (!mesh) return;
    const target = mesh.instanceMatrix.array as Float32Array;
    let count = 0;
    for (const block of batch.blocks) {
      if (!level.members[block.tile]) continue;
      const source = block.matrices.get(level.level)!;
      if (hidden === null || !block.hasSlot.has(hidden)) { target.set(source, count * 16); count += block.pieces.length; continue; }
      for (let i = 0; i < block.pieces.length; i++) if (block.slots[i] !== hidden) target.set(source.subarray(i * 16, i * 16 + 16), (count++) * 16);
    }
    mesh.count = count; mesh.visible = count > 0;
    if (count) { mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, count * 16); mesh.instanceMatrix.needsUpdate = true; }
    level.installed = true;
  }

  function registerShadows(batch: Batch): void {
    const nearest = batch.levels[0];
    if (!nearest?.geometry || pieceRole(batch.blueprint).cover || disposed) return;
    batch.shadow?.release(); batch.shadow?.mesh.dispose(); batch.shadow?.geometry.dispose();
    // The caster shares the nearest level's buffers but never fades: the sun sees every solid, wherever the camera is.
    const geometry = new THREE.BufferGeometry();
    for (const name of ['aPacked', 'aMaterial'] as const) geometry.setAttribute(name, nearest.geometry.getAttribute(name));
    geometry.setIndex(nearest.geometry.getIndex()); geometry.setAttribute('aBand', bandAttribute(0, 1e9, 1, false));
    geometry.boundingBox = nearest.geometry.boundingBox!.clone(); geometry.boundingSphere = nearest.geometry.boundingSphere!.clone();
    const mesh = new THREE.InstancedMesh(geometry, derived.material, batch.count);
    let count = 0;
    for (const block of batch.blocks) {
      const source = block.matrices.get(nearest.level)!;
      for (let i = 0; i < block.pieces.length; i++) if (hidden === null || block.slots[i] !== hidden) (mesh.instanceMatrix.array as Float32Array).set(source.subarray(i * 16, i * 16 + 16), (count++) * 16);
    }
    mesh.count = count; mesh.name = `${batch.blueprint.id}:shadow-source`; mesh.computeBoundingSphere();
    batch.shadow = { mesh, geometry, release: count ? host.registerShadow(mesh) : () => {} };
  }

  const ready = (async () => {
    const jobs = batches.flatMap(batch => batch.levels.map(async (level, index) => {
      const result = await pool.submit({ kind: 'blueprint', blueprint: batch.blueprint, revision: 1, materials: MATERIALS.materials,
        materialRevision: MATERIALS.revision, ...(level.level === 1 ? {} : { lodFactor: level.level as 2 | 4 }) });
      if (disposed || signal.aborted) return;
      if (result?.kind !== 'asset') throw new Error(`Ground dressing could not mesh ${batch.blueprint.id}`);
      const geometry = geometryFromChunks(result.chunks, 'build');
      level.bands = bandsFor(batch, index);
      geometry.setAttribute('aBand', bandAttribute(...level.bands.slice(0, 3) as [number, number, number], level.bands[3] === 1));
      const mesh = new THREE.InstancedMesh(geometry, derived.material, batch.count);
      mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false; mesh.name = `${batch.blueprint.id}:lod${level.level}`;
      // Sun shadows are cast by dedicated sources; a camera-culled level must not double them.
      mesh.castShadow = false; mesh.receiveShadow = false;
      level.geometry = geometry; level.mesh = mesh; scene.add(mesh); dirty = true;
    }));
    await Promise.all(jobs);
    if (disposed || signal.aborted) throw new Error('Ground dressing closed while meshing');
    for (const batch of batches) registerShadows(batch);
  })();
  const abort = () => dispose();
  signal.addEventListener('abort', abort, { once: true });

  const lastCamera = new Float64Array(33).fill(NaN), frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4(), box = new THREE.Box3();
  const eye = new THREE.Vector3(), pendingLot = new Set<Batch>();
  function cameraChanged(): boolean {
    const world = camera.matrixWorld.elements, projection = camera.projectionMatrix.elements;
    let changed = false;
    for (let i = 0; i < 16; i++) {
      if (lastCamera[i] !== world[i]) { lastCamera[i] = world[i]!; changed = true; }
      if (lastCamera[16 + i] !== projection[i]) { lastCamera[16 + i] = projection[i]!; changed = true; }
    }
    if (lastCamera[32] !== camera.aspect) { lastCamera[32] = camera.aspect; changed = true; }
    return changed;
  }

  function update(): void {
    if (disposed) return;
    derived.sync();
    if (!cameraChanged() && !dirty) return;
    dirty = false;
    const nextPortrait = camera.aspect < 1;
    if (nextPortrait !== portrait) { portrait = nextPortrait; applyBands(); }
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(viewProjection);
    eye.setFromMatrixPosition(camera.matrixWorld);
    for (const tile of tiles) {
      box.min.copy(tile.min); box.max.copy(tile.max);
      tile.visible = frustum.intersectsBox(box);
      tile.near = box.distanceToPoint(eye);
      const dx = Math.max(Math.abs(eye.x - tile.min.x), Math.abs(eye.x - tile.max.x)), dy = Math.max(Math.abs(eye.y - tile.min.y), Math.abs(eye.y - tile.max.y)), dz = Math.max(Math.abs(eye.z - tile.min.z), Math.abs(eye.z - tile.max.z));
      tile.far = Math.hypot(dx, dy, dz);
    }
    for (const batch of batches) for (const level of batch.levels) {
      const [near, far, width] = level.bands;
      let changed = !level.installed;
      for (const block of batch.blocks) {
        const tile = tiles[block.tile]!, member = tile.visible && tile.near <= far + width && tile.far >= near - width ? 1 : 0;
        if (level.members[block.tile] !== member) { level.members[block.tile] = member; changed = true; }
      }
      if (changed || pendingLot.has(batch)) install(batch, level);
    }
    pendingLot.clear();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true; signal.removeEventListener('abort', abort);
    for (const batch of batches) {
      if (batch.shadow) { batch.shadow.release(); batch.shadow.mesh.dispose(); batch.shadow.geometry.dispose(); delete batch.shadow; }
      for (const level of batch.levels) {
        if (level.mesh) { scene.remove(level.mesh); level.mesh.dispose(); }
        level.geometry?.dispose(); delete level.mesh; delete level.geometry;
      }
    }
    derived.dispose();
  }

  return {
    ready,
    blockers: plan.blockers, collisionPieces: plan.collisionPieces,
    update,
    hideLot(slot) {
      if (slot === hidden) return;
      const previous = hidden; hidden = slot;
      for (const batch of batches) {
        if (!batch.blocks.some(block => (previous !== null && block.hasSlot.has(previous)) || (slot !== null && block.hasSlot.has(slot)))) continue;
        pendingLot.add(batch); dirty = true;
        if (batch.shadow) registerShadows(batch);
      }
    },
    views: () => views,
    stats() {
      let drawCalls = 0, instances = 0, triangles = 0, geometryBytes = 0, shadowDrawCalls = 0;
      for (const batch of batches) {
        for (const level of batch.levels) {
          if (!level.mesh || !level.geometry) continue;
          if (level.mesh.visible && level.mesh.count > 0) { drawCalls++; instances += level.mesh.count; triangles += (level.geometry.index?.count ?? 0) / 3 * level.mesh.count; }
          for (const attribute of Object.values(level.geometry.attributes)) geometryBytes += (attribute as THREE.BufferAttribute).array.byteLength;
          geometryBytes += (level.geometry.index?.array.byteLength ?? 0) + level.mesh.instanceMatrix.array.byteLength;
        }
        if (batch.shadow && batch.shadow.mesh.count) { shadowDrawCalls++; geometryBytes += batch.shadow.mesh.instanceMatrix.array.byteLength; }
      }
      return { drawCalls, shadowDrawCalls, instances, triangles, geometryBytes, cpuBytes };
    },
    dispose,
  };
}
