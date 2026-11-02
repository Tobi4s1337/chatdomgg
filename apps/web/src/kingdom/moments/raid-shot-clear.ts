import * as THREE from 'three';
import type { SettlementPlan } from '@chatdom/world';
import type { RaidShotClear } from '../../twitch-moments/raid-shot';

/**
 * The gate shot's standing check from the adopted plan: the eye stays clear of the ground and of every built home's
 * lot and the castle's bounds, and the line to its aim is unbroken by them. Lots are treated as solid up to a
 * conservative height rather than read voxel by voxel, so a refused view is sometimes one that would have been
 * clear; a kept view is never inside a house. Trees are the scene's own and are not known here (SEAMS §11).
 */
export const RAID_SHOT_SOLIDS = { home: 14, castle: 40, pad: 1.2, ground: 2, step: 0.75 } as const;

export function raidShotClearOf(plan: SettlementPlan, ground: (x: number, z: number) => number): RaidShotClear {
  const S = RAID_SHOT_SOLIDS;
  const boxes = [
    ...plan.homes.map(home => ({ ...home.lot, top: S.home })),
    { ...plan.castle.bounds, top: S.castle },
  ];
  const height = (x: number, z: number): number | null => {
    try { const y = ground(x, z); return Number.isFinite(y) ? y : null; } catch { return null; }
  };
  const solid = (point: THREE.Vector3, pad: number, floor: number): boolean =>
    boxes.some(box => point.x >= box.minX - pad && point.x <= box.maxX + pad && point.z >= box.minZ - pad && point.z <= box.maxZ + pad && point.y < floor + box.top);
  return (eye, target) => {
    if (![eye.x, eye.y, eye.z, target.x, target.y, target.z].every(Number.isFinite)) return false;
    const under = height(eye.x, eye.z);
    if (under === null || eye.y < under + S.ground || solid(eye, S.pad, under)) return false;
    const length = eye.distanceTo(target), step = target.clone().sub(eye).normalize(), at = new THREE.Vector3();
    // The last few metres are the subject itself (the gate and its footing), not something in the way.
    for (let d = S.step; d < length - 3; d += S.step) {
      at.copy(eye).addScaledVector(step, d);
      const floor = height(at.x, at.z);
      if (floor === null || at.y < floor || solid(at, 0, floor)) return false;
    }
    return true;
  };
}
