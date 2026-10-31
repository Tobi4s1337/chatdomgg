import * as THREE from 'three';
import { AvatarAttachmentIdSchema, type AvatarAttachmentId, type AvatarPartBlueprint } from '@chatdom/shared';
import { MATERIALS } from '@chatdom/content/materials';
import { attachmentBind, attachmentLocalMatrix, compileAvatarPart, partPivotMatrix, type AvatarPose } from '@chatdom/content/avatars';
import { geometryFromChunks, type VoxelRenderState } from '@chatdom/render';
import type { VoxelWorkerPool } from '@chatdom/voxel';

/*
 * Seated people on the common rig: one nested group per bone and socket, the authored parts hung
 * on their attachments and meshed by the production voxel worker. Meshes are shared between seats
 * wearing the same part. This is the campfire's local pose adapter; it never patches the shared
 * walking renderer.
 */

export interface SeatedFigure {
  readonly root: THREE.Group;
  pose(pose: AvatarPose): void;
  dispose(): void;
}

export class PartMeshes {
  private readonly geometries = new Map<string, Promise<THREE.BufferGeometry>>();
  constructor(private readonly pool: VoxelWorkerPool) {}

  get(part: AvatarPartBlueprint): Promise<THREE.BufferGeometry> {
    // Part IDs name the family, swatches and fit, so equal IDs are equal geometry.
    const known = this.geometries.get(part.id);
    if (known) return known;
    const made = this.pool.submit({ kind: 'asset', asset: compileAvatarPart(part, MATERIALS.revision), materials: MATERIALS.materials, materialRevision: MATERIALS.revision }).then(result => {
      if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`The voxel worker returned no geometry for ${part.id}.`);
      return geometryFromChunks(result.chunks, 'avatar');
    });
    this.geometries.set(part.id, made);
    return made;
  }

  async dispose(): Promise<void> {
    const all = [...this.geometries.values()];
    this.geometries.clear();
    for (const geometry of await Promise.allSettled(all)) if (geometry.status === 'fulfilled') geometry.value.dispose();
  }
}

export async function createSeatedFigure(parts: readonly AvatarPartBlueprint[], meshes: PartMeshes, material: VoxelRenderState): Promise<SeatedFigure> {
  const groups = new Map<AvatarAttachmentId, THREE.Group>();
  for (const id of AvatarAttachmentIdSchema.options) {
    const group = new THREE.Group();
    group.name = id;
    group.matrixAutoUpdate = false;
    groups.set(id, group);
  }
  for (const [id, group] of groups) if (id !== 'root') groups.get(attachmentBind(id).parent!)!.add(group);
  const root = groups.get('root')!;
  const geometries = await Promise.all(parts.map(part => meshes.get(part)));
  for (const [i, part] of parts.entries()) {
    const mesh = new THREE.Mesh(geometries[i]!, material.material);
    mesh.name = part.id;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.fromArray(partPivotMatrix(part) as number[]);
    groups.get(part.attachment)!.add(mesh);
  }
  const holder = new THREE.Group();
  holder.add(root);
  return {
    root: holder,
    pose(pose) {
      for (const [id, group] of groups) group.matrix.fromArray(attachmentLocalMatrix(id, pose) as number[]);
      holder.updateMatrixWorld(true);
    },
    // Geometry belongs to the shared cache; only the scene graph is released here.
    dispose() { holder.removeFromParent(); },
  };
}
