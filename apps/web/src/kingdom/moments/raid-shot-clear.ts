import * as THREE from 'three';
import type { SettlementPlan } from '@chatdom/world';
import type { RaidShotClear, RaidShotFrame } from '../../twitch-moments/raid-shot';

/**
 * The gate shot's standing check from the adopted plan: the eye stays clear of the ground and of every built home's
 * lot and the castle's bounds, and the line to its aim is unbroken by them. Lots are treated as solid up to a
 * conservative height rather than read voxel by voxel, so a refused view is sometimes one that would have been
 * clear; a kept view is never inside a house. Trees are the scene's own and are not known here (SEAMS §11).
 */
export const RAID_SHOT_SOLIDS = { home: 14, castle: 40, pad: 1.2, ground: 2, step: 0.75 } as const;

/**
 * The foreground check: rays through a grid over the picture, each marched until its depth along the view passes
 * `depthShare` of the way to the aim (never past `depth` metres), so a big roof to one side counts however far along
 * its slanted ray it lies. Homes count to a roof height (`roof`, lower than the standing check's conservative block,
 * since this judges what fills the picture, not where an eye may stand). A view is refused when more than
 * `maxBlocked` of the rays (or the frame's own looser limit, for a fallback tier) meet a home or the castle there.
 */
export const RAID_SHOT_FOREGROUND = { columns: 9, rows: 6, depth: 40, depthShare: 0.8, roof: 10, maxBlocked: 0.08, step: 0.6 } as const;

export function raidShotClearOf(plan: SettlementPlan, ground: (x: number, z: number) => number): RaidShotClear {
  const S = RAID_SHOT_SOLIDS;
  const boxes = [
    ...plan.homes.map(home => ({ ...home.lot, top: S.home })),
    { ...plan.castle.bounds, top: S.castle },
  ];
  const height = (x: number, z: number): number | null => {
    try { const y = ground(x, z); return Number.isFinite(y) ? y : null; } catch { return null; }
  };
  const solid = (point: THREE.Vector3, pad: number, floor: number, roof = Infinity): boolean =>
    boxes.some(box => point.x >= box.minX - pad && point.x <= box.maxX + pad && point.z >= box.minZ - pad && point.z <= box.maxZ + pad
      && point.y < floor + Math.min(box.top, box.top === S.home ? roof : Infinity));
  const camera = new THREE.PerspectiveCamera(), ray = new THREE.Vector3(), at = new THREE.Vector3(), forward = new THREE.Vector3();
  const foregroundOpen = (eye: THREE.Vector3, target: THREE.Vector3, frame: RaidShotFrame): boolean => {
    const F = RAID_SHOT_FOREGROUND, depth = Math.min(F.depth, eye.distanceTo(target) * F.depthShare);
    forward.copy(target).sub(eye).normalize();
    camera.fov = frame.fov; camera.aspect = frame.aspect; camera.near = 0.1; camera.far = 600;
    camera.position.copy(eye); camera.up.set(0, 1, 0); camera.lookAt(target); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    let blocked = 0;
    const total = F.columns * F.rows, limit = Math.floor(total * Math.max(F.maxBlocked, frame.maxBlocked ?? 0));
    for (let c = 0; c < F.columns; c++) for (let r = 0; r < F.rows; r++) {
      ray.set(-1 + (2 * c + 1) / F.columns, -1 + (2 * r + 1) / F.rows, 0.5).unproject(camera).sub(eye).normalize();
      const reach = depth / Math.max(ray.dot(forward), 0.2);
      for (let d = F.step; d <= reach; d += F.step) {
        at.copy(eye).addScaledVector(ray, d);
        const floor = height(at.x, at.z);
        if (floor === null) break;
        if (solid(at, 0, floor, F.roof)) { if (++blocked > limit) return false; break; }
      }
    }
    return true;
  };
  return (eye, target, frame) => {
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
    return !frame || foregroundOpen(eye, target, frame);
  };
}
