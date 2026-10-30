import { AVATAR_LOOK_LIMITS, AVATAR_PART_LIMITS, AvatarPartBlueprintSchema, type AvatarPartBlueprint, type VoxelAsset } from '@chatdom/shared';
import { AVATAR_MATERIALS } from './palette';

/**
 * Executes a part's ordered boxes into an avatar-lattice asset (x contiguous; material zero carves).
 * Pure: no renderer, clock, account or entitlement input. Throws on any invalid source.
 */
export function compileAvatarPart(part: AvatarPartBlueprint, revision: number): VoxelAsset {
  const source = AvatarPartBlueprintSchema.parse(part);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error(`${part.id}: invalid revision.`);
  const [sx, sy, sz] = source.size;
  const voxels = new Uint16Array(sx * sy * sz);
  for (const box of source.boxes) {
    if (box.material !== 0 && !AVATAR_MATERIALS.has(box.material)) throw new Error(`${source.id}: material ${box.material} is outside the avatar palette.`);
    for (let z = box.from[2]; z < box.to[2]; z++) for (let y = box.from[1]; y < box.to[1]; y++) {
      const start = box.from[0] + sx * (y + sy * z);
      voxels.fill(box.material, start, start + box.to[0] - box.from[0]);
    }
  }
  let occupied = 0;
  for (const v of voxels) if (v !== 0) occupied++;
  if (occupied === 0) throw new Error(`${source.id}: the part has no occupied cells.`);
  if (occupied > AVATAR_PART_LIMITS.maxOccupiedCells) throw new Error(`${source.id}: ${occupied} occupied cells exceed ${AVATAR_PART_LIMITS.maxOccupiedCells}.`);
  return { id: source.id, revision, lattice: 'avatar', size: source.size, voxels };
}

export function occupiedCells(asset: VoxelAsset): number {
  let n = 0;
  for (const v of asset.voxels) if (v !== 0) n++;
  return n;
}

export interface LookReport {
  readonly parts: number;
  readonly boxes: number;
  readonly occupiedCells: number;
  readonly materials: readonly number[];
}

/**
 * Validates an assembled look's parts: unique IDs, compiled limits, and the look's part/cell budget.
 * Triangle budgets are checked after the production mesher by the bench, which owns the worker.
 */
export function validateLook(parts: readonly AvatarPartBlueprint[]): LookReport {
  if (parts.length > AVATAR_LOOK_LIMITS.maxParts) throw new Error(`A look has ${parts.length} parts; the limit is ${AVATAR_LOOK_LIMITS.maxParts}.`);
  if (new Set(parts.map(p => p.id)).size !== parts.length) throw new Error('A look repeats a part ID.');
  let occupied = 0, boxes = 0;
  const materials = new Set<number>();
  for (const part of parts) {
    const asset = compileAvatarPart(part, 0);
    occupied += occupiedCells(asset);
    boxes += part.boxes.length;
    for (const v of asset.voxels) if (v) materials.add(v);
  }
  if (occupied > AVATAR_LOOK_LIMITS.maxOccupiedCells) throw new Error(`A look has ${occupied} occupied cells; the limit is ${AVATAR_LOOK_LIMITS.maxOccupiedCells}.`);
  return { parts: parts.length, boxes, occupiedCells: occupied, materials: [...materials].sort((a, b) => a - b) };
}
