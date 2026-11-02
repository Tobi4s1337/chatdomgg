import { createTavernKit, TAVERN_FLOOR, TAVERN_ROOM_BOUNDS } from '../../../../packages/content/src/tavern';
import { TAVERN_INTERIOR_ENTRY, TAVERN_INTERIOR_EXIT } from '../../../../packages/content/src/tavern/portal';
import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';
import { createInteractionRegistry, standingClear } from '@chatdom/world/interactions';
import { tavernPlacement } from '../../../../packages/world/src/interactions/places';

export const TAVERN_ENTRY = TAVERN_INTERIOR_ENTRY;
/** Crossing this doorway from inside asks the portal owner to return the walker to the kingdom. */
export const TAVERN_EXIT = TAVERN_INTERIOR_EXIT;
/** 2: the hearth bench moved to the hearthstone's lip so every chair has a full aisle (2026-11-02). */
export const TAVERN_COLLISION_REVISION = 2;
/**
 * Where a new arrival appears: the entry, or the nearest clear spot inside the doorway when someone already stands
 * there (a person who just came in, or one inside their reconnect grace). Two bodies never share a spot, so nobody
 * arrives looking out through someone else's head. Every spot is a step in from the threshold and faces the room.
 * When the doorway's eleven spots are all taken (a full room on a stream night), the arrival walks the floor out
 * from the entry and takes the first reachable spot that is still free; only a floor with no free spot at all
 * falls back to the reachable spot farthest from everyone.
 */
const ARRIVAL_OFFSETS = [[0, 0], [-.75, 0], [.75, 0], [0, -.75], [-.75, -.75], [.75, -.75], [-1.5, 0], [1.5, 0], [-1.5, -.75], [1.5, -.75], [0, -1.5]] as const;
export const ARRIVAL_SPACING = .7;
const ARRIVAL_CELL = .25;
const arrivalFloors = new WeakMap<CollisionWorld, readonly (readonly [number, number, number])[]>();
/** Every standing spot reachable from the entry, nearest first by walking distance, never between the entry and the door. */
function arrivalFloor(world: CollisionWorld) {
  const known = arrivalFloors.get(world); if (known) return known;
  const [x0, y, z0] = TAVERN_ENTRY.feet, [width, depth] = TAVERN_ROOM_BOUNDS;
  const columns = Math.floor(width / ARRIVAL_CELL), rows = Math.floor(depth / ARRIVAL_CELL);
  const start = [Math.round(x0 / ARRIVAL_CELL), Math.round(z0 / ARRIVAL_CELL)] as const;
  const seen = new Set([`${start[0]},${start[1]}`]), queue: (readonly [number, number])[] = [start], cells: [number, number, number][] = [];
  for (let head = 0; head < queue.length; head++) {
    const [cx, cz] = queue[head]!, feet: [number, number, number] = [cx * ARRIVAL_CELL, y, cz * ARRIVAL_CELL];
    if (feet[2] <= z0) cells.push(feet);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, nz = cz + dz, id = `${nx},${nz}`;
      if (nx < 0 || nx > columns || nz < 0 || nz > rows || seen.has(id)) continue;
      seen.add(id);
      if (standingClear(world, [nx * ARRIVAL_CELL, y, nz * ARRIVAL_CELL])) queue.push([nx, nz]);
    }
  }
  arrivalFloors.set(world, cells);
  return cells;
}
export function tavernArrival(world: CollisionWorld, standing: Iterable<{ readonly x: number; readonly z: number }>): [number, number, number] {
  const others = [...standing];
  const gap = (feet: readonly [number, number, number]) => others.reduce((least, o) => Math.min(least, Math.hypot(o.x - feet[0], o.z - feet[2])), Infinity);
  const [x, y, z] = TAVERN_ENTRY.feet;
  for (const [dx, dz] of ARRIVAL_OFFSETS) {
    const feet: [number, number, number] = [x + dx, y, z + dz];
    if (gap(feet) >= ARRIVAL_SPACING && standingClear(world, feet)) return feet;
  }
  let roomiest: readonly [number, number, number] = TAVERN_ENTRY.feet, widest = -1;
  for (const feet of arrivalFloor(world)) {
    const free = gap(feet);
    if (free >= ARRIVAL_SPACING) return [...feet];
    if (free > widest) { widest = free; roomiest = feet; }
  }
  return [...roomiest];
}
/** No kingdom placement changes: these solids and targets belong only to the portal destination. */
export function createTavernInterior() {
  const kit = createTavernKit('hearth');
  const [width, depth] = TAVERN_ROOM_BOUNDS;
  const boxes: SolidBox[] = [
    { min: [0, -2, 0], max: [width, TAVERN_FLOOR, depth] }, ...kit.solids,
    { min: [-1000, -1000, -1000], max: [0, 1000, 1000] },
    { min: [width, -1000, -1000], max: [1000, 1000, 1000] },
    { min: [0, -1000, -1000], max: [width, 1000, 0] },
    { min: [0, -1000, depth], max: [width, 1000, 1000] },
  ];
  const world: CollisionWorld = { revision: TAVERN_COLLISION_REVISION,
    query: bounds => boxes.filter(box => box.min.every((v, a) => v <= bounds.max[a]!) && box.max.every((v, a) => v >= bounds.min[a]!)) };
  const registry = createInteractionRegistry({ layoutRevision: 'tavern-interior-v2', world,
    placements: [tavernPlacement({ tavern: 'main', origin: [0, 0, 0], turn: 0,
      seats: kit.tables.flatMap(table => table.seats), source: 'tavern:interior-v1' })] });
  return { kit, boxes, world, registry };
}
