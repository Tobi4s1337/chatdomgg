import * as THREE from 'three';
import { MAT, MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, geometryFromChunks, getEnvironment, type VoxelRenderState } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { VOXEL_METRES, cellIndex, type BuildDraftPolicy, type Vec3, type VoxelAsset } from '@chatdom/shared';
import type { BenchAngle } from './selection';

const CELL = VOXEL_METRES.build;
/** Bench ground reaches this many cells beyond the reserve on each side and towards the street. */
const MARGIN = 10;
/** The review cutaway lifts everything from this many cells above the floor: a plan section at about 1.5 m. */
export const CUT_ABOVE_FEET = 12;

export interface MeshedDraft { readonly triangles: number; readonly chunks: number }

/**
 * Bench furniture on the build lattice: unlocked land is lawn, the locked rear of a smaller tier is moss, and a
 * paved street runs along the +Z front with a limestone kerb. It is never part of a template or the draft.
 */
export function lotAsset(policy: BuildDraftPolicy): VoxelAsset {
  const [sx, , sz] = policy.size, rear = policy.editableFrom[2];
  const size: Vec3 = [sx + MARGIN * 2, 2, sz + MARGIN * 2];
  const voxels = new Uint16Array(size[0] * size[1] * size[2]);
  for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
    const lx = x - MARGIN, lz = z - MARGIN;
    const street = lz >= sz + 2, kerb = lz >= sz && lz < sz + 2;
    const onLot = lx >= 0 && lx < sx && lz >= 0 && lz < sz;
    const top = street ? MAT.paving : kerb ? MAT.limestone : onLot && lz < rear ? MAT.moss : MAT.grass;
    voxels[cellIndex(x, 0, z, size[0], size[1])] = street || kerb ? MAT.stone : MAT.earth;
    voxels[cellIndex(x, 1, z, size[0], size[1])] = top;
  }
  return { id: 'bench.template-lot', revision: 1, lattice: 'build', size, voxels };
}

/** A copy of the compiled cells with everything above the section height lifted away, for the review cutaway. */
export function cutaway(asset: VoxelAsset, feet: number): VoxelAsset {
  const voxels = asset.voxels.slice(), [sx, sy, sz] = asset.size, cut = feet + CUT_ABOVE_FEET;
  for (let z = 0; z < sz; z++) for (let y = cut; y < sy; y++) voxels.fill(0, cellIndex(0, y, z, sx, sy), cellIndex(0, y, z, sx, sy) + sx);
  return { ...asset, id: `${asset.id}:cutaway`, voxels };
}

/**
 * Review cameras. The authored sun always comes from the north-west, so the street face is in shade at every hour;
 * front and side therefore look from the west, where the light models the walls, and back turns to the east.
 */
const DIRECTIONS: Record<BenchAngle, THREE.Vector3> = {
  front: new THREE.Vector3(-.62, .58, 1).normalize(),
  side: new THREE.Vector3(-1, .52, .18).normalize(),
  back: new THREE.Vector3(.62, .6, -1).normalize(),
  cutaway: new THREE.Vector3(-.45, 1.35, 1).normalize(),
};

export interface TemplateStage {
  readonly renderer: THREE.WebGLRenderer;
  /**
   * Meshes and shows the draft's compiled cells; resolves once the worker has returned production geometry, or
   * with null when a newer request superseded this one. `frame` holds the cells the camera frames, so undoing to an
   * empty plot keeps the same view of the land the shape stood on.
   */
  show(asset: VoxelAsset, frame: Uint16Array, feet: number, angle: BenchAngle): Promise<MeshedDraft | null>;
  setHour(hour: number): void;
  setAngle(angle: BenchAngle): void;
  /** Marks one draft cell with a brass outline, or clears the mark. */
  mark(cell: Vec3 | null): void;
  /** Renders, compiles shaders on first use and finishes the GPU frame. Returns the model's own draw calls. */
  settle(): Promise<number>;
  pick(clientX: number, clientY: number): THREE.Raycaster;
  readonly modelMatrix: THREE.Matrix4;
  resize(): void;
  dispose(): void;
}

export async function createTemplateStage(host: HTMLElement, policy: BuildDraftPolicy, hour: number, label: string): Promise<TemplateStage> {
  const pool = new VoxelWorkerPool({ size: 2 });
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = () => { throw new Error('The voxel shader did not compile.'); };
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.setAttribute('aria-label', label);
  host.append(renderer.domElement);
  const material: VoxelRenderState = createVoxelMaterial(MATERIALS, 'build');
  material.setEnvironment(getEnvironment(hour));
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 200);
  const home = new THREE.Group(); scene.add(home);
  const model = new THREE.Mesh(new THREE.BufferGeometry(), material.material); model.frustumCulled = false; home.add(model);
  const lot = lotAsset(policy);
  const lotResult = await pool.submit({ kind: 'asset', asset: lot, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
  if (lotResult?.kind !== 'asset') { pool.dispose(); material.dispose(); renderer.dispose(); throw new Error('The review lot did not mesh.'); }
  const ground = new THREE.Mesh(geometryFromChunks(lotResult.chunks, 'build'), material.material);
  ground.position.set(-MARGIN, -2, -MARGIN).multiplyScalar(CELL); home.add(ground);
  // The editor's own dashed boundary at the first buildable row: behind it the land stays locked for this tier.
  const rear = policy.editableFrom[2] * CELL, width = policy.size[0] * CELL, front = policy.size[2] * CELL;
  const border = new THREE.Line(new THREE.BufferGeometry().setFromPoints([[0, rear], [width, rear], [width, front], [0, front], [0, rear]].map(([x, z]) => new THREE.Vector3(x, .012, z))),
    new THREE.LineDashedMaterial({ color: '#d9ba78', dashSize: .35, gapSize: .18, transparent: true, opacity: .75 }));
  border.computeLineDistances(); home.add(border);
  const marker = new THREE.Box3Helper(new THREE.Box3(), '#ffd27a');
  (marker.material as THREE.LineBasicMaterial).depthTest = false; marker.renderOrder = 10; marker.visible = false; home.add(marker);
  let bounds = new THREE.Box3(), angle: BenchAngle = 'front', compiled = false;

  function frame(): void {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    const direction = DIRECTIONS[angle], centre = bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getSize(new THREE.Vector3()).length() + 4;
    camera.position.copy(centre).addScaledVector(direction, radius * 2.5);
    camera.lookAt(centre); camera.updateMatrixWorld(true);
    const projected = new THREE.Box3();
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
    }
    const aspect = w / h, fill = .8;
    const half = Math.max(projected.max.y - projected.min.y, (projected.max.x - projected.min.x) / aspect) / 2 / fill;
    const cx = (projected.max.x + projected.min.x) / 2, cy = (projected.max.y + projected.min.y) / 2;
    camera.left = cx - half * aspect; camera.right = cx + half * aspect; camera.top = cy + half; camera.bottom = cy - half;
    camera.near = .01; camera.far = radius * 6; camera.updateProjectionMatrix();
  }

  return {
    renderer,
    modelMatrix: home.matrixWorld,
    async show(asset, cells, feet, next) {
      const source = next === 'cutaway' ? cutaway(asset, feet) : asset;
      const result = await pool.submit({ kind: 'asset', asset: source, materials: MATERIALS.materials, materialRevision: MATERIALS.revision }, { key: 'template-bench' });
      if (result === null) return null;
      if (result.kind !== 'asset') throw new Error('The voxel worker did not return the home’s geometry.');
      model.geometry.dispose(); model.geometry = geometryFromChunks(result.chunks, 'build');
      angle = next;
      // Frame the home and the ground just in front of its door, never the whole empty reserve.
      const [sx, sy, sz] = asset.size;
      const min = [sx, sy, sz], max = [0, 0, 0];
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) if (cells[cellIndex(x, y, z, sx, sy)]) {
        if (x < min[0]!) min[0] = x; if (y < min[1]!) min[1] = y; if (z < min[2]!) min[2] = z;
        if (x + 1 > max[0]!) max[0] = x + 1; if (y + 1 > max[1]!) max[1] = y + 1; if (z + 1 > max[2]!) max[2] = z + 1;
      }
      if (max[0]! <= min[0]!) { min.splice(0, 3, 0, 0, policy.editableFrom[2]); max.splice(0, 3, sx, 24, sz); }
      if (next === 'cutaway') max[1] = Math.min(max[1]!, feet + CUT_ABOVE_FEET);
      bounds = new THREE.Box3(new THREE.Vector3(min[0]! - 2, 0, min[2]! - 2).multiplyScalar(CELL), new THREE.Vector3(max[0]! + 2, max[1]!, Math.min(sz + 6, max[2]! + 6)).multiplyScalar(CELL));
      frame();
      return { triangles: result.chunks.reduce((n, chunk) => n + chunk.mesh.indices.length / 3, 0), chunks: result.chunks.length };
    },
    setHour(next) { material.setEnvironment(getEnvironment(next)); },
    setAngle(next) { angle = next; frame(); },
    mark(cell) {
      marker.visible = !!cell;
      if (cell) marker.box.set(new THREE.Vector3(...cell).multiplyScalar(CELL).subScalar(.01), new THREE.Vector3(cell[0] + 1, cell[1] + 1, cell[2] + 1).multiplyScalar(CELL).addScalar(.01));
    },
    async settle() {
      frame();
      if (!compiled) { await renderer.compileAsync(scene, camera); compiled = true; }
      ground.visible = false; border.visible = false;
      const wasMarked = marker.visible; marker.visible = false;
      renderer.render(scene, camera);
      const draws = renderer.info.render.calls;
      ground.visible = true; border.visible = true; marker.visible = wasMarked;
      renderer.render(scene, camera);
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      renderer.render(scene, camera);
      renderer.getContext().finish();
      return draws;
    },
    pick(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect(), raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2), camera);
      home.updateMatrixWorld(true);
      return raycaster;
    },
    resize() { frame(); renderer.render(scene, camera); },
    dispose() {
      pool.dispose(); model.geometry.dispose(); ground.geometry.dispose(); border.geometry.dispose(); (border.material as THREE.Material).dispose();
      marker.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
