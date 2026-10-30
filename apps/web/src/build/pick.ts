import * as THREE from 'three';
import { VOXEL_METRES, type BuildDraftPolicy, type Vec3 } from '@chatdom/shared';
import type { BuildDraft } from '@chatdom/world';

export interface BuildPick { cell: [number, number, number]; normal: [number, number, number]; floor: boolean }

/** Ray/box clipping followed by Amanatides–Woo traversal in authored build cells. */
export function pickBuildCell(ray: THREE.Ray, draft: BuildDraft, worldMatrix: THREE.Matrix4): BuildPick | null {
  const inverse = worldMatrix.clone().invert(), local = ray.clone().applyMatrix4(inverse);
  local.origin.multiplyScalar(1 / VOXEL_METRES.build);
  const { size, editableFrom, editableTo } = draft.policy;
  let enter = 0, leave = Infinity, entryAxis = 1, entrySign = 1;
  for (let axis = 0; axis < 3; axis++) {
    const o = local.origin.getComponent(axis), d = local.direction.getComponent(axis);
    if (Math.abs(d) < 1e-10) { if (o < 0 || o >= size[axis]!) return null; continue; }
    const a = -o / d, b = (size[axis]! - o) / d, near = Math.min(a, b), far = Math.max(a, b);
    if (near > enter) { enter = near; entryAxis = axis; entrySign = d > 0 ? -1 : 1; }
    leave = Math.min(leave, far);
  }
  if (leave < enter) return null;
  const p = local.at(enter + 1e-6, new THREE.Vector3());
  const cell: [number, number, number] = [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
  const normal: [number, number, number] = [0, 0, 0]; normal[entryAxis] = entrySign;
  const next: number[] = [], delta: number[] = [], step: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const d = local.direction.getComponent(axis), o = local.origin.getComponent(axis);
    step[axis] = Math.sign(d); delta[axis] = d === 0 ? Infinity : Math.abs(1 / d);
    next[axis] = d === 0 ? Infinity : (cell[axis]! + (d > 0 ? 1 : 0) - o) / d;
  }
  for (let traversed = 0; traversed < size[0] + size[1] + size[2] + 3; traversed++) {
    if (cell.some((n, axis) => n < 0 || n >= size[axis]!)) break;
    if (draft.get(cell)) return { cell: [...cell], normal: [...normal], floor: false };
    const axis = next[0]! <= next[1]! && next[0]! <= next[2]! ? 0 : next[1]! <= next[2]! ? 1 : 2;
    if (next[axis]! > leave) break;
    cell[axis] += step[axis]!; next[axis]! += delta[axis]!;
    normal.fill(0); normal[axis] = -step[axis]!;
  }
  if (local.direction.y >= -1e-8) return null;
  const floor = local.at(-local.origin.y / local.direction.y, new THREE.Vector3());
  if (floor.x < editableFrom[0] || floor.x >= editableTo[0] || floor.z < editableFrom[2] || floor.z >= editableTo[2]) return null;
  return { cell: [Math.floor(floor.x), -1, Math.floor(floor.z)], normal: [0, 1, 0], floor: true };
}

export function brushBox(pick: BuildPick, brush: 1 | 2 | 4, place: boolean, policy: BuildDraftPolicy): { from: [number, number, number]; to: [number, number, number] } | null {
  const target = pick.cell.map((n, axis) => n + (place ? pick.normal[axis]! : 0)) as [number, number, number];
  if (pick.floor && !place) return null;
  const from: [number, number, number] = target.map((n, axis) => {
    const base = policy.editableFrom[axis]!;
    return base + Math.floor((n - base) / brush) * brush;
  }) as [number, number, number];
  const to = from.map(n => n + brush) as [number, number, number];
  if (from.some((n, axis) => n < policy.editableFrom[axis]!) || to.some((n, axis) => n > policy.editableTo[axis]!)) return null;
  return { from, to };
}

export function localBuildPoint(point: Vec3, position: Vec3, yaw: number): THREE.Vector3 {
  return new THREE.Vector3(...point).multiplyScalar(VOXEL_METRES.build).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(...position));
}
