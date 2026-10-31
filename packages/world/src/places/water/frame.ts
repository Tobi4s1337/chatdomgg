import type { Vec3 } from '@chatdom/shared';
import { transformCardinalPoint } from '../../settlement/geometry';
import type { BoundsXZ, CardinalTurn, XZ } from '../../settlement/types';

/** The build lattice every water-place piece is authored on, in metres. */
export const CELL = 0.125;

/**
 * A static placement frame: a blueprint's (0,0,0) corner in world metres, turned by whole quarter turns about it.
 * Structural yaw is only `turn * PI/2` (three.js `rotation.y`), the same transform as the land's footprints and the
 * cardinal collision/occlusion compiler. Moving parts (the wheel, boats, fingerpost arms) never use a frame's turn
 * for their motion; they name a pivot and axis of their own.
 */
export interface CardinalFrame { readonly origin: Vec3; readonly turn: CardinalTurn }

export const yawOf = (turn: CardinalTurn): number => turn * Math.PI / 2;

/** Local metres to world metres. */
export function toWorld(frame: CardinalFrame, local: Vec3): Vec3 {
  return transformCardinalPoint(frame.origin, frame.turn, local);
}

/** Local build cells to world metres. */
export function cellToWorld(frame: CardinalFrame, cell: Vec3): Vec3 {
  return toWorld(frame, [cell[0] * CELL, cell[1] * CELL, cell[2] * CELL]);
}

/** A local direction (no translation) in world space. */
export function directionToWorld(turn: CardinalTurn, local: Vec3): Vec3 {
  const d = transformCardinalPoint([0, 0, 0], turn, local);
  return [d[0] + 0, d[1] + 0, d[2] + 0];
}

/** World metres back into a frame's local metres: the exact inverse of `toWorld`. */
export function toLocal(frame: CardinalFrame, world: Vec3): Vec3 {
  const dx = world[0] - frame.origin[0], dy = world[1] - frame.origin[1], dz = world[2] - frame.origin[2];
  const [x, z] = frame.turn === 0 ? [dx, dz] : frame.turn === 1 ? [-dz, dx] : frame.turn === 2 ? [-dx, -dz] : [dz, -dx];
  return [x + 0, dy, z + 0];
}

/** Bearing (atan2(dx, dz), 0 faces +Z) of a world direction. */
export const bearingOf = (direction: Vec3 | XZ): number =>
  direction.length === 3 ? Math.atan2(direction[0], direction[2]) : Math.atan2(direction[0], direction[1]);

/** A local axis-aligned rectangle in metres, as a counter-clockwise world polygon. */
export function rectangleToWorld(frame: CardinalFrame, min: XZ, max: XZ): XZ[] {
  const corners = ([[min[0], min[1]], [min[0], max[1]], [max[0], max[1]], [max[0], min[1]]] as const)
    .map(([x, z]) => { const p = toWorld(frame, [x, 0, z]); return [p[0], p[2]] as XZ; });
  return area(corners) > 0 ? corners : corners.reverse();
}

/** A polygon's bounds in a frame's local metres. */
export function localBounds(frame: CardinalFrame, polygon: readonly XZ[]): BoundsXZ {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of polygon) {
    const p = toLocal(frame, [x, 0, z]);
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
  }
  return { minX, maxX, minZ, maxZ };
}

function area(polygon: readonly XZ[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) { const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!; sum += a[0] * b[1] - b[0] * a[1]; }
  return sum / 2;
}

/** Evenly spaced sample points over a local rectangle (metres), corners included, in world XZ. */
export function rectangleSamples(frame: CardinalFrame, min: XZ, max: XZ, step: number): XZ[] {
  const nx = Math.max(1, Math.ceil((max[0] - min[0]) / step)), nz = Math.max(1, Math.ceil((max[1] - min[1]) / step));
  const out: XZ[] = [];
  for (let k = 0; k <= nz; k++) for (let i = 0; i <= nx; i++) {
    const p = toWorld(frame, [min[0] + (max[0] - min[0]) * i / nx, 0, min[1] + (max[1] - min[1]) * k / nz]);
    out.push([p[0], p[2]]);
  }
  return out;
}
