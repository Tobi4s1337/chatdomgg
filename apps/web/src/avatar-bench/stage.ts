import * as THREE from 'three';
import { MAT, MATERIALS } from '@chatdom/content';
import { geometryFromChunks, type Environment, type VoxelRenderState } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { AVATAR_LOOK_LIMITS, AvatarAttachmentIdSchema, VOXEL_METRES, type AvatarAttachmentId, type AvatarCapeBlueprint, type AvatarPartBlueprint, type VoxelAsset } from '@chatdom/shared';
import { attachmentBind, attachmentLocalMatrix, compileAvatarPart, occupiedCells, partMatrix, partPivotMatrix, poseAttachments, restPosition, type AvatarPose } from '@chatdom/content/avatars';

export type BenchAngle = 'front' | 'side' | 'back';
export const BENCH_ANGLES: readonly BenchAngle[] = ['front', 'side', 'back'];

export interface CitizenStats {
  readonly parts: number;
  readonly boxes: number;
  readonly occupiedCells: number;
  readonly triangles: number;
}

export interface Citizen {
  readonly root: THREE.Group;
  /** One group per bone and socket; the cape renderer reads the posed `back` group. */
  readonly attachments: ReadonlyMap<AvatarAttachmentId, THREE.Group>;
  readonly stats: CitizenStats;
  readonly bounds: THREE.Box3;
  dispose(): void;
}

/** How far the citizen turns from the camera for each review angle (radians, about +Y). */
const TURN: Record<BenchAngle, number> = { front: .42, side: Math.PI / 2, back: Math.PI - .42 };

/**
 * A photographer's turntable: camera and key light stay put, the citizen turns. The camera sits a
 * little to one side of the hour's sun so the reviewed side is always modelled by real light.
 */
export function benchOrientation(environment: Environment, angle: BenchAngle): { yaw: number; camera: THREE.Vector3 } {
  const [x, , z] = environment.sunDirection;
  const cameraAzimuth = Math.atan2(x, z) - .6;
  return { yaw: cameraAzimuth - TURN[angle], camera: new THREE.Vector3(Math.sin(cameraAzimuth), .42, Math.cos(cameraAzimuth)).normalize() };
}

/**
 * Builds the frozen rig as nested THREE groups (one per bone and socket), each holding the pose's
 * parent-local matrix from the content rig, then hangs each part's mesh under its attachment.
 */
export function buildRig(pose: AvatarPose): Map<AvatarAttachmentId, THREE.Group> {
  const groups = new Map<AvatarAttachmentId, THREE.Group>();
  for (const id of AvatarAttachmentIdSchema.options) {
    const group = new THREE.Group();
    group.name = id;
    group.matrixAutoUpdate = false;
    group.matrix.fromArray(attachmentLocalMatrix(id, pose) as number[]);
    groups.set(id, group);
  }
  const root = groups.get('root')!;
  for (const [id, group] of groups) if (id !== 'root') {
    const { parent } = attachmentBind(id);
    groups.get(parent!)!.add(group);
  }
  root.updateMatrixWorld(true);
  // The scene graph must agree with the content rig exactly; a mismatch means the bench lies.
  const expected = poseAttachments(pose);
  const rootInverse = root.matrixWorld.clone().invert();
  for (const [id, group] of groups) {
    const local = rootInverse.clone().multiply(group.matrixWorld).elements;
    const want = expected.get(id)!;
    if (local.some((v, i) => Math.abs(v - (want[i] ?? 0)) > 1e-6)) throw new Error(`Rig group ${id} disagrees with the content rig.`);
  }
  return groups;
}

export async function createCitizen(pool: VoxelWorkerPool, material: VoxelRenderState, parts: readonly AvatarPartBlueprint[], pose: AvatarPose, revision: number): Promise<Citizen> {
  if (parts.length > AVATAR_LOOK_LIMITS.maxParts) throw new Error(`The look has ${parts.length} parts; the limit is ${AVATAR_LOOK_LIMITS.maxParts}.`);
  const groups = buildRig(pose);
  const root = groups.get('root')!;
  const geometries: THREE.BufferGeometry[] = [];
  let triangles = 0, cells = 0, boxes = 0;
  const assets: VoxelAsset[] = parts.map(part => compileAvatarPart(part, revision));
  const results = await Promise.all(assets.map(asset => {
    cells += occupiedCells(asset);
    return pool.submit({ kind: 'asset', asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
  }));
  for (const [i, part] of parts.entries()) {
    const result = results[i];
    if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`The voxel worker returned no geometry for ${part.id}.`);
    const geometry = geometryFromChunks(result.chunks, 'avatar');
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material.material);
    mesh.name = part.id;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.fromArray(partPivotMatrix(part) as number[]);
    groups.get(part.attachment)!.add(mesh);
    triangles += result.chunks.reduce((n, chunk) => n + chunk.mesh.indices.length / 3, 0);
    boxes += part.boxes.length;
  }
  if (cells > AVATAR_LOOK_LIMITS.maxOccupiedCells) throw new Error(`The look has ${cells} occupied cells; the limit is ${AVATAR_LOOK_LIMITS.maxOccupiedCells}.`);
  if (triangles > AVATAR_LOOK_LIMITS.maxTriangles) throw new Error(`The look meshes to ${triangles} triangles; the limit is ${AVATAR_LOOK_LIMITS.maxTriangles}.`);
  root.updateMatrixWorld(true);
  return { root, attachments: groups, bounds: restBounds(parts), stats: { parts: parts.length, boxes, occupiedCells: cells, triangles }, dispose: () => geometries.forEach(g => g.dispose()) };
}

/** Root-local box around a look's parts in the rest pose. */
export function restBounds(parts: readonly AvatarPartBlueprint[]): THREE.Box3 {
  const bounds = new THREE.Box3(), matrix = new THREE.Matrix4();
  for (const part of parts) {
    const local = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(...part.size).multiplyScalar(VOXEL_METRES.avatar));
    bounds.union(local.applyMatrix4(matrix.fromArray(partMatrix(part) as number[])));
  }
  return bounds;
}

/**
 * Root-local framing box for a cape: its hanging span plus room behind for the hem to lift in a stride.
 * Framing only; the sheet's shape is the cape renderer's.
 */
export function capeBounds(cape: AvatarCapeBlueprint): THREE.Box3 {
  const [, y, z] = restPosition('back').map(n => n * VOXEL_METRES.avatar) as [number, number, number];
  const top = y + cape.mount.height, back = z - cape.mount.back;
  return new THREE.Box3(new THREE.Vector3(-cape.width / 2, top - cape.length, back - cape.length * .55), new THREE.Vector3(cape.width / 2, top, back));
}

/**
 * A small cobbled plinth on the same avatar lattice, so feet have a ground to stand on and contact
 * can be judged. It is bench furniture, never part of the wardrobe library.
 */
export function plinthAsset(): VoxelAsset {
  const radius = 15, size: [number, number, number] = [radius * 2, 3, radius * 2];
  const voxels = new Uint16Array(size[0] * size[1] * size[2]);
  for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
    const d = Math.hypot(x + .5 - radius, z + .5 - radius);
    if (d > radius) continue;
    for (let y = 0; y < size[1]; y++) {
      const rim = d > radius - 1.6;
      if (y === size[1] - 1 && rim) continue;
      voxels[x + size[0] * (y + size[1] * z)] = y === size[1] - 1 ? MAT.paving : rim ? MAT.limestone : MAT.stone;
    }
  }
  return { id: 'bench.plinth', revision: 1, lattice: 'avatar', size, voxels };
}

export async function createPlinth(pool: VoxelWorkerPool, material: VoxelRenderState): Promise<THREE.Mesh> {
  const asset = plinthAsset();
  const result = await pool.submit({ kind: 'asset', asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
  if (result?.kind !== 'asset') throw new Error('The plinth did not mesh.');
  const mesh = new THREE.Mesh(geometryFromChunks(result.chunks, 'avatar'), material.material);
  mesh.position.set(-asset.size[0] / 2, -asset.size[1], -asset.size[2] / 2).multiplyScalar(VOXEL_METRES.avatar);
  return mesh;
}

/** Orthographic framing of a world-space box seen along `direction`, filling `fill` of the frame height. */
export function frameCamera(camera: THREE.OrthographicCamera, bounds: THREE.Box3, direction: THREE.Vector3, aspect: number, fill: number, lift = 0): void {
  const centre = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getSize(new THREE.Vector3()).length() + 2;
  camera.position.copy(centre).addScaledVector(direction, radius * 3);
  camera.lookAt(centre);
  camera.updateMatrixWorld(true);
  const projected = new THREE.Box3();
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
  const half = Math.max(projected.max.y - projected.min.y, (projected.max.x - projected.min.x) / aspect) / 2 / fill;
  const offsetX = (projected.max.x + projected.min.x) / 2, offsetY = (projected.max.y + projected.min.y) / 2 + lift * half;
  camera.left = -half * aspect + offsetX; camera.right = half * aspect + offsetX; camera.top = half + offsetY; camera.bottom = -half + offsetY;
  camera.near = .01; camera.far = radius * 8;
  camera.updateProjectionMatrix();
}
