import { createTavernKit, TAVERN_FLOOR, TAVERN_ROOM_BOUNDS } from '../../../../packages/content/src/tavern';
import { TAVERN_INTERIOR_ENTRY, TAVERN_INTERIOR_EXIT } from '../../../../packages/content/src/tavern/portal';
import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';
import { createInteractionRegistry } from '@chatdom/world/interactions';
import { tavernPlacement } from '../../../../packages/world/src/interactions/places';

export const TAVERN_ENTRY = TAVERN_INTERIOR_ENTRY;
/** Crossing this doorway from inside asks the portal owner to return the walker to the kingdom. */
export const TAVERN_EXIT = TAVERN_INTERIOR_EXIT;
/** 2: the hearth bench moved to the hearthstone's lip so every chair has a full aisle (2026-11-02). */
export const TAVERN_COLLISION_REVISION = 2;
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
