import { TavernPortalSchema, type KingdomId, type TavernAnchor, type TavernPortal, type TavernThreshold, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import { TAVERN_DOOR, TAVERN_FLOOR, TAVERN_ROOM_BOUNDS } from './index';

/** The installed exterior tavern. Its id and form come from founded civic growth; nothing here changes them. */
export const TAVERN_EXTERIOR_PLACEMENT = 'civic:growth:v1:tavern';
const CELL = .125;
type Turn = 0 | 1 | 2 | 3;
interface Placement { readonly id: string; readonly assetHash: string; readonly position: Vec3; readonly rotation: Turn }
interface Asset { readonly assetHash: string; readonly blueprint: VoxelBlueprint }

const turnPoint = (origin: Vec3, turn: Turn, [x, y, z]: Vec3): Vec3 => {
  const [rx, rz] = turn === 0 ? [x, z] : turn === 1 ? [z, -x] : turn === 2 ? [-x, -z] : [-z, x];
  return [origin[0] + rx, origin[1] + y, origin[2] + rz];
};
const round = (v: number) => Math.round(v * 1e6) / 1e6;
/** The walker's yaw byte facing a horizontal direction (zero faces +Z, 64 faces +X). */
export const yawByteFacing = (x: number, z: number) => ((Math.round(Math.atan2(x, z) / (Math.PI * 2) * 256) % 256) + 256) % 256;

/** Inside, you appear a step in from the doorway facing the room; the doorway behind you is the way out. */
export const TAVERN_INTERIOR_ENTRY: TavernAnchor = { feet: [TAVERN_DOOR.centre[0], TAVERN_FLOOR, 8.6], yaw: 128 };
const half = TAVERN_DOOR.width / 2;
export const TAVERN_INTERIOR_EXIT: TavernThreshold = {
  // The jambs stop a body .28 m short of their faces; the deepest reachable feet are .28 m short of the outer wall.
  min: [TAVERN_DOOR.centre[0] - half, TAVERN_FLOOR - .5, 9.3],
  max: [TAVERN_DOOR.centre[0] + half, TAVERN_FLOOR + 1, TAVERN_ROOM_BOUNDS[1]],
  through: [0, 1],
};

export interface TavernDoorway {
  /** Local metres in the placement's frame. */
  readonly centre: Vec3;
  readonly threshold: TavernThreshold;
  /** Candidate standing feet just outside, nearest first, in world metres. */
  readonly outside: readonly Vec3[];
  readonly yaw: number;
}

/**
 * The doorway is the body-height carve through the public face (+Z), found from the blueprint itself, the way
 * home doors are, never a guessed centre of the building. Every growth level keeps the same carve.
 */
export function exteriorTavernDoorway(placement: Pick<Placement, 'position' | 'rotation'>, blueprint: VoxelBlueprint): TavernDoorway | null {
  const depth = Math.max(...blueprint.boxes.map(box => box.to[2]));
  const carve = blueprint.boxes.filter(b => b.material === 0 && b.from[1] <= 4 && b.to[1] - b.from[1] >= 12
    && b.to[0] - b.from[0] >= 6 && b.to[0] - b.from[0] <= 18 && b.to[2] - b.from[2] <= 8 && b.to[2] > depth * .5)
    .sort((a, b) => b.to[2] - a.to[2])[0];
  if (!carve) return null;
  const x0 = carve.from[0] * CELL, x1 = carve.to[0] * CELL, sill = carve.from[1] * CELL, face = carve.to[2] * CELL;
  const at = (local: Vec3) => turnPoint(placement.position, placement.rotation, local);
  // From just inside the leaf plane to the outer face: a body in the doorway has its feet here.
  const corners = [at([x0, sill - .5, face - .75]), at([x1, sill + 1, face + .05])];
  const outward = turnPoint([0, 0, 0], placement.rotation, [0, 0, 1]);
  const axis = (pick: (a: number, b: number) => number) => [0, 1, 2].map(i => round(pick(corners[0]![i]!, corners[1]![i]!))) as [number, number, number];
  const threshold: TavernThreshold = {
    min: axis(Math.min), max: axis(Math.max),
    through: [round(-outward[0]) || 0, round(-outward[2]) || 0],
  };
  const cx = (x0 + x1) / 2;
  return { centre: [cx, sill, face], threshold, yaw: yawByteFacing(outward[0], outward[2]),
    outside: [5, 8, 11].map(cells => at([cx, sill, face + cells * CELL])) };
}

/** Supported clear feet near a point, at its height or a nearby step, as the founded registry finds thresholds. */
export function standingNearPoint(world: CollisionWorld, point: Vec3, standingClear: (world: CollisionWorld, feet: Vec3) => boolean): Vec3 | null {
  const heights = new Set([point[1]]);
  for (const box of world.query({ min: [point[0] - .28, point[1] - .75, point[2] - .28], max: [point[0] + .28, point[1] + .5, point[2] + .28] }))
    if (box.max[1] >= point[1] - .75 && box.max[1] <= point[1] + .5) heights.add(box.max[1]);
  for (const y of [...heights].sort((a, b) => Math.abs(a - point[1]) - Math.abs(b - point[1]))) {
    const feet: Vec3 = [point[0], y, point[2]];
    if (standingClear(world, feet)) return feet;
  }
  return null;
}

export interface FoundedTavernPortalInput {
  readonly kingdomId: KingdomId;
  readonly scene: { readonly collisionRevision: number; readonly placements: readonly Placement[]; readonly assets: readonly Asset[] };
  readonly world: CollisionWorld;
  /** The installed movement rule (`standingClear` from the world's interactions); injected to keep content pure. */
  readonly standingClear: (world: CollisionWorld, feet: Vec3) => boolean;
}

/**
 * The tavern door's portal, derived from the exact installed scene and collision the kingdom walks on. An absent
 * tavern, an unrecognised form or a blocked forecourt yields null: no door is offered rather than a guessed one.
 */
export function foundedTavernPortal({ kingdomId, scene, world, standingClear }: FoundedTavernPortalInput): TavernPortal | null {
  if (scene.collisionRevision !== world.revision) throw new Error('The tavern door needs the installed collision revision.');
  const placement = scene.placements.find(piece => piece.id === TAVERN_EXTERIOR_PLACEMENT);
  const blueprint = placement && scene.assets.find(asset => asset.assetHash === placement.assetHash)?.blueprint;
  if (!placement || !blueprint) return null;
  const doorway = exteriorTavernDoorway(placement, blueprint);
  if (!doorway) return null;
  let feet: Vec3 | null = null;
  for (const candidate of doorway.outside) if ((feet = standingNearPoint(world, candidate, standingClear))) break;
  if (!feet) return null;
  return TavernPortalSchema.parse({ version: 1, id: `tavern:${kingdomId}:door`, kingdomId,
    sourceRoom: 'kingdom', destinationRoom: 'tavern',
    source: { placement: placement.id, collisionRevision: world.revision },
    door: doorway.threshold, returnAnchor: { feet: feet.map(round) as [number, number, number], yaw: doorway.yaw },
    entry: TAVERN_INTERIOR_ENTRY, exit: TAVERN_INTERIOR_EXIT });
}
