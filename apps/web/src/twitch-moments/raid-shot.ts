import * as THREE from 'three';
import type { Path } from './gift-view';

/**
 * How the gate shot is chosen. The column comes through the gate towards the town, so a camera standing in the
 * street is passed by every wagon. Standing close beside the road (the earlier shot) meant each wagon and pony pair
 * swept past under the lens, cut by the frame's corner at half the picture's height. The shot is now chosen by
 * sweeping the column's actual envelope along the actual road through each candidate view: a view is kept only if
 * every unit stays a readable size while any of it is on screen, the gate and its braziers stay in the picture, and
 * the eye never stands inside the column's path. Units still leave the picture, as a procession does, but through
 * its edge at a moderate size, never as a giant cropped corner.
 */

/** One unit of the column (a wagon with its pony and standard, or a pair of banner ponies), in metres about its road point. */
export const RAID_UNIT_ENVELOPE = { halfLength: 2.7, halfWidth: 1.5, height: 5.6 } as const;

/** A unit on screen may be at most this share of the picture's height (and the eye this far clear of its path). */
export const RAID_SHOT_FIT = { maxShare: 0.45, eyeClear: 3.2, sweepTo: 90, step: 1 } as const;

export interface RaidShotGate {
  readonly position: THREE.Vector3;
  /** Along the road into the town. */
  readonly facing: THREE.Vector3;
  /** Across the road, `cross(up, facing)`. */
  readonly side: THREE.Vector3;
}

export type RaidShotCandidate = readonly [eye: THREE.Vector3, target: THREE.Vector3, fov: number];

/**
 * An optional standing check from the adopted world: whether an eye may stand there and see its aim. With a `frame`,
 * the check also refuses a view whose near foreground (a roof beside the eye) covers more than a small part of the
 * picture; without one it judges standing and the line to the aim only.
 */
export type RaidShotClear = (eye: THREE.Vector3, target: THREE.Vector3, frame?: RaidShotFrame) => boolean;
/** The picture a view is judged for; `maxBlocked` loosens the world's own foreground limit for a fallback tier. */
export interface RaidShotFrame { readonly fov: number; readonly aspect: number; readonly maxBlocked?: number }
/** Foreground tiers tried in turn before a view is kept on standing alone: the world's own limit, then looser ones. */
export const RAID_SHOT_FOREGROUND_TIERS = [undefined, 0.2, 0.35] as const;

const UP = new THREE.Vector3(0, 1, 0);
const camera = new THREE.PerspectiveCamera();
const corner = new THREE.Vector3(), across = new THREE.Vector3();

function aim(eye: THREE.Vector3, target: THREE.Vector3, fov: number, aspect: number): THREE.PerspectiveCamera {
  camera.fov = fov; camera.aspect = aspect; camera.near = 0.1; camera.far = 600;
  camera.position.copy(eye); camera.up.copy(UP); camera.lookAt(target);
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  return camera;
}

/**
 * The largest share of the picture's height that any unit of the column covers on screen, swept along the road from
 * just outside the gate. A unit passing out through the picture's edge counts only for the part still showing;
 * a corner already behind the lens is taken to reach the nearest edge, so a unit sliding under the camera counts
 * as covering everything from its top down to the frame. Infinity when the eye stands inside the column's path.
 * With a `limit`, the sweep stops at the first unit past it and returns that (a lower bound).
 */
export function raidColumnShare(line: Path, eye: THREE.Vector3, target: THREE.Vector3, fov: number, aspect: number, limit = Infinity): number {
  const view = aim(eye, target, fov, aspect), E = RAID_UNIT_ENVELOPE, F = RAID_SHOT_FIT;
  const end = Math.min(line.length, F.sweepTo), local = new THREE.Vector3();
  let worst = 0;
  for (let d = -4; d <= end; d += F.step) {
    const spot = line.at(d);
    across.crossVectors(UP, spot.tangent).normalize();
    // The eye is never inside or just over the column's path.
    const off = Math.hypot(eye.x - spot.position.x, eye.z - spot.position.z);
    if (off < E.halfWidth + F.eyeClear && eye.y < spot.position.y + E.height + F.eyeClear) return Infinity;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, behind = false, ahead = false;
    for (const l of [-E.halfLength, E.halfLength]) for (const w of [-E.halfWidth, E.halfWidth]) for (const h of [0, E.height]) {
      corner.copy(spot.position).addScaledVector(spot.tangent, l).addScaledVector(across, w);
      corner.y += h;
      // In camera space the lens looks down -z; anything at or behind the near plane cannot be framed.
      if (-local.copy(corner).applyMatrix4(view.matrixWorldInverse).z <= 0.5) { behind = true; continue; }
      ahead = true;
      corner.project(view);
      minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x); minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
    }
    if (!ahead) continue;
    if (behind) { minY = -1; minX = Math.min(minX, -1); maxX = Math.max(maxX, 1); }
    if (!(maxX > -1 && minX < 1 && maxY > -1 && minY < 1)) continue;
    worst = Math.max(worst, (Math.min(1, maxY) - Math.max(-1, minY)) / 2);
    // Past the limit the view is refused; its exact worst no longer matters.
    if (worst > limit) return worst;
  }
  return worst;
}

/** Whether a world point sits inside the picture with a margin, in front of the lens. */
export function raidShotSees(point: THREE.Vector3, eye: THREE.Vector3, target: THREE.Vector3, fov: number, aspect: number, margin = 0.08): boolean {
  const view = aim(eye, target, fov, aspect);
  const depth = -point.clone().applyMatrix4(view.matrixWorldInverse).z;
  if (depth <= 0.5) return false;
  const p = point.clone().project(view);
  return Math.abs(p.x) <= 1 - margin && Math.abs(p.y) <= 1 - margin;
}

/** What must be in the picture: the standard's pole from foot to crossbar, both braziers and the caption over it. */
function gateMarks(gate: RaidShotGate): THREE.Vector3[] {
  const pole = gate.position.clone().addScaledVector(gate.side, 2.4);
  return [
    pole.clone(), pole.clone().add(new THREE.Vector3(0, 7.4, 0)),
    gate.position.clone().addScaledVector(gate.side, 2).addScaledVector(gate.facing, 1.2).add(new THREE.Vector3(0, 1.4, 0)),
    gate.position.clone().addScaledVector(gate.side, -2).addScaledVector(gate.facing, 1.2).add(new THREE.Vector3(0, 1.4, 0)),
  ];
}

/**
 * The town-side views: from over the street's edge well inside the gate, crane-high so the column comes up the
 * street between its torches and leaves the picture through its foot while still small, aimed over the street just
 * inside the gate so the standard rides in the upper picture with the land and its sky beyond.
 */
export function* raidTownShots(line: Path | null, gate: RaidShotGate, aspect: number): Generator<RaidShotCandidate> {
  const portrait = aspect < 1, fov = portrait ? 60 : 50;
  const ahead = [24, 28, 32, 36, 40, 44];
  const asides = [2.2, -2.2, 0];
  const rises = portrait ? [10, 11.5, 13, 15, 17] : [9.5, 10.5, 12, 14, 16];
  // How high the aim rides over the street just inside the gate: higher brings the land beyond and its sky in.
  const aims = portrait ? [3.6, 5.5, 7.5] : [3.2, 5, 6.5];
  for (const along of ahead) for (const rise of rises) for (const lift of aims) for (const aside of asides) {
    const spot = line && line.length > along * 0.6 ? line.at(along) : { position: gate.position.clone().addScaledVector(gate.facing, along), tangent: gate.facing };
    const side = new THREE.Vector3().crossVectors(UP, spot.tangent).normalize();
    const eye = spot.position.clone().addScaledVector(side, aside).add(new THREE.Vector3(0, rise, 0));
    const into = line ? line.at(Math.min(5, along * 0.2)).position : gate.position.clone().addScaledVector(gate.facing, 5);
    yield [eye, into.add(new THREE.Vector3(0, lift, 0)), fov] as const;
  }
}

/** Composition: the crossbar low enough for its caption card above it, and the land's horizon with some sky in the picture. */
export const RAID_SHOT_FRAME = { crossbarBelow: 0.45, horizonBelow: 0.72, horizonAbove: -0.2 } as const;

function composed(gate: RaidShotGate, eye: THREE.Vector3, target: THREE.Vector3, fov: number, aspect: number): boolean {
  const view = aim(eye, target, fov, aspect), F = RAID_SHOT_FRAME;
  const bar = gate.position.clone().addScaledVector(gate.side, 2.4).add(new THREE.Vector3(0, 7.4, 0)).project(view);
  // The horizon: a point at eye height far beyond the gate, out along the road.
  const away = gate.position.clone().sub(eye).setY(0).normalize().multiplyScalar(2000).add(eye);
  const horizon = away.project(view).y;
  return bar.y <= F.crossbarBelow && horizon <= F.horizonBelow && horizon >= F.horizonAbove;
}

/** How tall the standard's pole (foot to crossbar) stands in the picture, as a share of its height. */
function gateShare(gate: RaidShotGate, eye: THREE.Vector3, target: THREE.Vector3, fov: number, aspect: number): number {
  const view = aim(eye, target, fov, aspect), pole = gate.position.clone().addScaledVector(gate.side, 2.4);
  const foot = pole.clone().project(view), top = pole.add(new THREE.Vector3(0, 7.4, 0)).project(view);
  return Math.abs(top.y - foot.y) / 2;
}

/**
 * The town-side views the column passes cleanly, the one that shows the gate's standard largest first, then (for a
 * host whose world rejects them all) the least crowded looser views. `clear` is the adopted world's standing check
 * when the host has one; it is asked lazily, in that order.
 */
export function* raidFittedShots(line: Path | null, gate: RaidShotGate, aspect: number, clear?: RaidShotClear, maxShare: number = RAID_SHOT_FIT.maxShare): Generator<RaidShotCandidate> {
  const marks = gateMarks(gate), fitted: { shot: RaidShotCandidate; rank: number }[] = [], loose: { shot: RaidShotCandidate; rank: number }[] = [];
  for (const shot of raidTownShots(line, gate, aspect)) {
    const [eye, target, fov] = shot;
    if (!marks.every(mark => raidShotSees(mark, eye, target, fov, aspect)) || !composed(gate, eye, target, fov, aspect)) continue;
    const share = line ? raidColumnShare(line, eye, target, fov, aspect, maxShare) : 0;
    if (share <= maxShare) fitted.push({ shot, rank: -gateShare(gate, eye, target, fov, aspect) });
    else if (Number.isFinite(share)) loose.push({ shot, rank: share }); // A lower bound: enough to order the fallbacks.
  }
  // A fitted view with an open foreground first (no roof filling the side of the picture), then the fitted views with
  // the least of one (a dense hamlet may have no fully open view); then any fitted view the eye may stand in; and when
  // nothing fits cleanly (a tight bend, a hill), the least-crowded honest view, never one that passes through the lens.
  fitted.sort((a, b) => a.rank - b.rank);
  const given = new Set<RaidShotCandidate>();
  if (clear) for (const maxBlocked of RAID_SHOT_FOREGROUND_TIERS) for (const { shot } of fitted) {
    if (given.has(shot) || !clear(shot[0], shot[1], maxBlocked === undefined ? { fov: shot[2], aspect } : { fov: shot[2], aspect, maxBlocked })) continue;
    given.add(shot); yield shot;
  }
  for (const list of [fitted, loose.sort((a, b) => a.rank - b.rank).slice(0, 6)]) {
    for (const { shot } of list) if (!given.has(shot) && (!clear || clear(shot[0], shot[1]))) yield shot;
  }
}
