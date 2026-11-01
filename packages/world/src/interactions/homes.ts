import { VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { WALK_BODY, type CollisionWorld, type RealmInteractionState, type SolidBox } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '../founded-world/types';
import { transformCardinalPoint } from '../settlement/geometry';
import type { CardinalTurn } from '../settlement/types';
import { finiteVec3, standingClear } from './geometry';
import { interactionTargetId } from './ids';
import { MAX_REACH, STREET_ZONE, homeZone, type InteractionPlacement, type InteractionRegistry } from './registry';

/**
 * A home's threshold, derived once from the installed deed's actual shell and the collision at one revision
 * (spec 37 R7/R8). The doorway is the shell's own authored façade carve, never a mesh bound. Both sides of it are
 * authored points along the home's own route, settled onto their floor and proved supported and full-body clear;
 * nothing here scans for air or moves a body.
 */

/** What the installed deed puts on a plot: the home revision the room holds and its actual furnished shell. */
export interface InstalledHome {
  readonly plotId: string;
  /** `RealmOwnedHome.revision`: the shell and furnishing this door belongs to. An older revision cannot be entered. */
  readonly revision: string;
  readonly blueprint: Pick<VoxelBlueprint, 'size' | 'boxes'>;
  /** The founded placement: minimum corner in world metres and cardinal turn. */
  readonly position: Vec3; readonly rotation: CardinalTurn;
}
/**
 * Why a home cannot be entered at this revision. `inside-blocked`/`passage-blocked` keep the door and say so to its
 * owner; `no-doorway`/`street-blocked` leave nothing to stand at, so no door is registered at all.
 */
export type HomeBlock = 'no-doorway' | 'street-blocked' | 'inside-blocked' | 'passage-blocked';
export interface HomeThreshold {
  readonly plotId: string; readonly revision: string;
  /** Door and exit anchors in world metres (cell 1, no further transform), or null when there is no door to use. */
  readonly placement: InteractionPlacement | null;
  /** Street-side points on this home's route, nearest the door first, each supported and full-body clear now. */
  readonly route: readonly Vec3[];
  /** The shell's authored inside, in world metres: where `home:<plot>` holds for a body that entered. */
  readonly interior: SolidBox | null;
  readonly blocked: HomeBlock | null;
}

/** Inside threshold candidates, in build voxels behind the doorway's inner face. */
const INSIDE_STEPS = [5, 8] as const;
/** Street route candidates, in build voxels in front of the doorway's outer face. */
const STREET_STEPS = [5, 8, 11, 14] as const;
/** The doorway's look point sits this many voxels above its sill: about chest height in the opening. */
const DOOR_POINT = 9;
/** Shell walls are at least this thick; the inside zone starts behind them. */
const WALL = 2;

/**
 * The street doorway of a native or approved home shell: a cut of air through the front wall, from the floor, at
 * least body height, a door's width and a wall's depth. The outermost one wins (a porch before an inner door).
 */
export function homeDoorway(blueprint: Pick<VoxelBlueprint, 'size' | 'boxes'>): { readonly from: Vec3; readonly to: Vec3 } | null {
  const portals = blueprint.boxes.filter(b => b.material === 0 && b.from[1] <= 4
    && b.to[1] - b.from[1] >= 15 && b.to[0] - b.from[0] >= 6 && b.to[0] - b.from[0] <= 18
    && b.to[2] - b.from[2] <= 8 && b.to[2] > blueprint.size[2] * .5)
    .sort((a, b) => b.to[2] - a.to[2] || a.from[0] - b.from[0]);
  const portal = portals[0];
  return portal ? { from: portal.from, to: portal.to } : null;
}

/**
 * Put an authored point onto the floor it stands over: the nearest solid top within a step below or half a step
 * above, where the body is supported and clear. Null when that floor is taken or missing.
 */
export function settleOnFloor(world: CollisionWorld, point: Vec3): Vec3 | null {
  if (!finiteVec3(point)) return null;
  const heights = new Set([point[1]]);
  const r = WALK_BODY.radius;
  for (const box of world.query({ min: [point[0] - r, point[1] - .75, point[2] - r], max: [point[0] + r, point[1] + .5, point[2] + r] })) {
    if (box.max[1] >= point[1] - .75 && box.max[1] <= point[1] + .5) heights.add(box.max[1]);
  }
  for (const y of [...heights].sort((a, b) => Math.abs(a - point[1]) - Math.abs(b - point[1]) || a - b)) {
    const feet: Vec3 = [point[0], y, point[2]];
    if (standingClear(world, feet)) return feet;
  }
  return null;
}

/**
 * True when a standing body can pass in a straight line from `outside` to `inside`: the step between the floors is
 * one the body climbs, and nothing solid stands in the swept body above the higher floor. The sill and the step
 * below it are the floors themselves, not obstacles.
 */
export function passageClear(world: CollisionWorld, outside: Vec3, inside: Vec3): boolean {
  if (!finiteVec3(outside) || !finiteVec3(inside)) return false;
  if (Math.abs(outside[1] - inside[1]) > WALK_BODY.stepHeight) return false;
  const floor = Math.max(outside[1], inside[1]), r = WALK_BODY.radius;
  const length = Math.hypot(inside[0] - outside[0], inside[2] - outside[2]);
  const steps = Math.max(1, Math.ceil(length / (r / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, x = outside[0] + (inside[0] - outside[0]) * t, z = outside[2] + (inside[2] - outside[2]) * t;
    const probe: SolidBox = { min: [x - r, floor + 1e-3, z - r], max: [x + r, floor + WALK_BODY.height, z + r] };
    if (world.query(probe).some(box => box.min[0] < probe.max[0] - 1e-6 && box.max[0] > probe.min[0] + 1e-6
      && box.min[1] < probe.max[1] - 1e-6 && box.max[1] > probe.min[1] + 1e-6
      && box.min[2] < probe.max[2] - 1e-6 && box.max[2] > probe.min[2] + 1e-6)) return false;
  }
  return true;
}

/** True when feet stand within a home's authored inside (horizontally, and on its floors rather than its roof). */
export function insideHome(interior: SolidBox | null, feet: Vec3): boolean {
  return !!interior && finiteVec3(feet) && feet[0] >= interior.min[0] && feet[0] <= interior.max[0]
    && feet[2] >= interior.min[2] && feet[2] <= interior.max[2] && feet[1] >= interior.min[1] && feet[1] <= interior.max[1];
}

/**
 * The zone a body is in, read the same way on both ends: at home while the room says so and the feet are still inside
 * that home's shell; anywhere else, the zone the place flow gives (the street unless a tavern says otherwise). A body
 * that walked back out through its open doorway is in the street again before the room next says so.
 */
export function interactionZone(state: RealmInteractionState, feet: Vec3, registry: Pick<InteractionRegistry, 'home'> | null, otherwise: string = STREET_ZONE): string {
  if (state.mode !== 'interior' || !state.plotId) return otherwise;
  const home = registry?.home(state.plotId);
  return !home?.interior || insideHome(home.interior, feet) ? homeZone(state.plotId) : otherwise;
}

/**
 * Derive the door (`home:<plot>:door`, from the street) and the exit (`home:<plot>:exit`, from inside) of one installed
 * home at this collision revision. The door's rest is the inside threshold; the exit's rest is the first clear point of
 * the street route, so stepping out always lands on this home's own path. An edited room that leaves no clear place
 * just inside, or no clear way through the doorway, keeps its door with an honest block and registers no exit.
 */
export function homeThreshold(home: InstalledHome, world: CollisionWorld): HomeThreshold {
  const { plotId, revision, blueprint } = home;
  const unit = VOXEL_METRES.build;
  const at = (local: Vec3): Vec3 => transformCardinalPoint(home.position, home.rotation, [local[0] * unit, local[1] * unit, local[2] * unit]);
  const corners = [at([WALL, 0, WALL]), at([blueprint.size[0] - WALL, blueprint.size[1], blueprint.size[2] - WALL])];
  const interior: SolidBox | null = blueprint.size.every(n => n > WALL * 2) ? {
    min: [Math.min(corners[0]![0], corners[1]![0]), corners[0]![1] - WALK_BODY.stepHeight, Math.min(corners[0]![2], corners[1]![2])],
    max: [Math.max(corners[0]![0], corners[1]![0]), corners[1]![1], Math.max(corners[0]![2], corners[1]![2])],
  } : null;
  const none = (blocked: HomeBlock, route: readonly Vec3[] = []): HomeThreshold => ({ plotId, revision, placement: null, route, interior, blocked });
  const doorway = homeDoorway(blueprint);
  if (!doorway) return none('no-doorway');
  const x = (doorway.from[0] + doorway.to[0]) / 2, sill = doorway.from[1];
  const route = STREET_STEPS.map(step => settleOnFloor(world, at([x, sill, doorway.to[2] + step]))).filter((p): p is Vec3 => p !== null);
  const street = route[0];
  if (!street) return none('street-blocked');
  const position = at([x, sill + DOOR_POINT, doorway.to[2]]);
  const source = `home:${plotId}@${revision}`;
  const inside = INSIDE_STEPS.map(step => settleOnFloor(world, at([x, sill, doorway.from[2] - step]))).find((p): p is Vec3 => p !== null) ?? null;
  const blocked: HomeBlock | null = !inside ? 'inside-blocked' : !passageClear(world, street, inside) ? 'passage-blocked' : null;
  const door = { id: interactionTargetId.homeDoor(plotId), kind: 'home-door' as const, zone: STREET_ZONE, plotId, revision, position, approach: street, reach: MAX_REACH };
  const placement: InteractionPlacement = {
    source, origin: [0, 0, 0], turn: 0, cell: 1,
    anchors: blocked || !inside ? [{ ...door, blocked: blocked ?? 'inside-blocked' }] : [
      { ...door, rest: inside },
      { id: interactionTargetId.homeExit(plotId), kind: 'home-exit', zone: homeZone(plotId), plotId, revision, position, approach: inside, rest: street, reach: MAX_REACH },
    ],
  };
  return { plotId, revision, placement, route, interior, blocked };
}

/**
 * The owned homes installed in a founded scene, as `homeThreshold` reads them: each plot's own home piece
 * (`kind: 'home'`, so a Forge part attached to the same plot never stands in for it) at the plot's origin and turn,
 * with the committed revision the scene was assembled from. Both ends pass the same public revisions: the room from
 * `assembleFoundedScene`'s home bindings, the browser from the bootstrap checkpoint's `home` views. A plot without a
 * revision is a native home with no deed and gets no door; an owned plot with no single home piece is `missing`.
 */
export function foundedInstalledHomes(scene: Pick<RealmFoundedScene, 'assets' | 'placements'>, revisions: ReadonlyMap<string, string>): {
  readonly homes: readonly InstalledHome[]; readonly missing: readonly string[];
} {
  const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const homes: InstalledHome[] = [], missing: string[] = [];
  for (const [plotId, revision] of [...revisions].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const pieces = scene.placements.filter(p => p.plotId === plotId && assets.get(p.assetHash)?.kind === 'home');
    if (pieces.length !== 1 || !revision) { missing.push(plotId); continue; }
    const piece = pieces[0]!;
    homes.push({ plotId, revision, blueprint: assets.get(piece.assetHash)!, position: piece.position, rotation: piece.rotation });
  }
  return { homes, missing };
}
