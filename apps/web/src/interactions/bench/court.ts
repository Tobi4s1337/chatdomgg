import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';
import { interactionTargetId, type InteractionPlacement } from '../../../../../packages/world/src/interactions';

/**
 * SIMULATED bench court. Not a place: the real campfire (spec 21) and hero anvil (spec 25) replace it in the
 * kingdom. Its solids are both what the bench draws and what the real authority collides against, so the prompt,
 * the reach test and the room agree about the same boxes.
 */
const box = (min: Vec3, max: Vec3): SolidBox => ({ min, max });
export const LOGS = {
  north: box([-.85, 0, 1.3], [.85, .42, 1.7]),
  south: box([-.85, 0, -1.7], [.85, .42, -1.3]),
  east: box([1.3, 0, -.85], [1.7, .42, .85]),
  west: box([-1.7, 0, -.85], [-1.3, .42, .85]),
} as const;
export const FIRE_STONES = box([-.55, 0, -.55], [.55, .32, .55]);
export const ANVIL_STUMP = box([2.65, 0, 2.65], [3.35, .45, 3.15]);
export const ANVIL_IRON = box([2.62, .45, 2.76], [3.38, .85, 3.04]);
export const SOLIDS: readonly SolidBox[] = [box([-30, -1, -30], [30, 0, 30]), FIRE_STONES, ...Object.values(LOGS), ANVIL_STUMP, ANVIL_IRON];

export function benchWorld(revision = 1): CollisionWorld {
  return { revision, query: q => SOLIDS.filter(b => b.min[0] < q.max[0] && b.max[0] > q.min[0] && b.min[1] < q.max[1] && b.max[1] > q.min[1] && b.min[2] < q.max[2] && b.max[2] > q.min[2]) };
}

export const SEAT = {
  north: interactionTargetId.campfireSeat('bench', 'north'), south: interactionTargetId.campfireSeat('bench', 'south'),
  east: interactionTargetId.campfireSeat('bench', 'east'), west: interactionTargetId.campfireSeat('bench', 'west'),
} as const;
export const ANVIL = interactionTargetId.anvil('bench');

/** Authored once in local metres at the court's origin; the registry places them like any producer's anchors. */
export const COURT_PLACEMENT: InteractionPlacement = {
  source: 'bench:simulated-court', origin: [0, 0, 0], turn: 0, cell: 1,
  anchors: [
    { id: SEAT.north, kind: 'campfire-seat', zone: 'street', position: [0, .42, 1.5], approach: [0, 0, 2.2], rest: [0, .42, 1.5], facing: Math.PI, reach: 1.8 },
    { id: SEAT.south, kind: 'campfire-seat', zone: 'street', position: [0, .42, -1.5], approach: [0, 0, -2.2], rest: [0, .42, -1.5], facing: 0, reach: 1.8 },
    { id: SEAT.east, kind: 'campfire-seat', zone: 'street', position: [1.5, .42, 0], approach: [2.2, 0, 0], rest: [1.5, .42, 0], facing: -Math.PI / 2, reach: 1.8 },
    { id: SEAT.west, kind: 'campfire-seat', zone: 'street', position: [-1.5, .42, 0], approach: [-2.2, 0, 0], rest: [-1.5, .42, 0], facing: Math.PI / 2, reach: 1.8 },
    { id: ANVIL, kind: 'anvil', zone: 'street', position: [3, .85, 2.9], approach: [3, 0, 3.75], reach: 1.8 },
  ],
};

/** Where the bench's SIMULATED people stand when it opens. You reach the north log and the anvil, not the east log. */
export const SPOT = { you: [1.25, 0, 2.55] as Vec3, wren: [-2.7, 0, 1.4] as Vec3 };
