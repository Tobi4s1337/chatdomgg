/** Browser-safe bounded SIMULATED floor, not the founded-world compiler. */
import type { Vec3 } from '../../shared/src/index';
import type { SolidBox } from '../../shared/src/realm/index';

export interface LimitedMarketFloor { readonly revision: number; readonly bounds: readonly [number, number, number, number]; readonly blocks: readonly SolidBox[] }

/** The queried portion outside the known market rectangle is always solid, including beyond the fixture. */
export function queryLimitedMarketFloor(floor: LimitedMarketFloor, bounds: SolidBox): SolidBox[] {
  const [left, right, back, front] = floor.bounds;
  const boxes = floor.blocks.filter(box => box.min.every((n, axis) => n <= bounds.max[axis]! && box.max[axis]! >= bounds.min[axis]!));
  const add = (min: Vec3, max: Vec3) => { if (min.every((n, axis) => n < max[axis]!)) boxes.push({ min, max }); };
  add(bounds.min, [Math.min(left, bounds.max[0]), bounds.max[1], bounds.max[2]]);
  add([Math.max(right, bounds.min[0]), bounds.min[1], bounds.min[2]], bounds.max);
  add(bounds.min, [bounds.max[0], bounds.max[1], Math.min(back, bounds.max[2])]);
  add([bounds.min[0], bounds.min[1], Math.max(front, bounds.min[2])], bounds.max);
  return boxes;
}

