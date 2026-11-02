/**
 * The two lands a walker can stand in, founded exactly as the realm provider founds them, and the solids of the
 * fixtures drawn in them. For `solids.test.ts`: every box here comes from a real blueprint or the drawn anvil sculpt.
 */
import { KingdomIdSchema, VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { WALK_BODY, WALK_BUTTON, WALK_HZ, type CollisionWorld, type PlayerState, type SolidBox, type WalkInput } from '@chatdom/shared/realm';
import { generateSettlementPlan, type RealmFoundedPlacement, type RealmFoundedScene, type SettlementPlan } from '@chatdom/world';
import { compileFoundedScene, sampleFoundedTerrain } from '@chatdom/world/founded-collision';
import { grandKingdomLand } from '../../../../packages/world/src/grand/kingdom';
import { foundedAnvilPosition } from '@chatdom/world/interactions';
import { embeddedSolids, stepPlayer, supported } from '@chatdom/world/movement';
import { createRealmState } from '@chatdom/world/realm';
import { assembleFoundedScene } from '../../../realm/src/founded/scene';
import { createNativeTown } from '../../../realm/src/founded/native';
import { enrichNativeMarket } from '../../../realm/src/founded/market-furnishings';
import { enrichNativeMarketSeats } from '../../../realm/src/founded/market-seats';
import { enrichNativeForgeHearth, enrichNativeForgeWorkshop } from '../../../realm/src/founded/forge-hearth-furnishings';
import { enrichNativePictureGroves } from '../../../realm/src/founded/picture-groves';
import oldTown from '../../../realm/src/founded/artifacts/simulated-town.scene.json';
import { GRID_MIN, H, sculptAnvilStage, Y_OFFSET } from '../forge/anvil-hero/sculpt';

export interface Land {
  readonly name: string;
  readonly scene: RealmFoundedScene;
  readonly world: CollisionWorld;
  readonly floorY: number;
  readonly ceilingY: number;
}

/** The realm provider's founding pipeline for `plan` with no citizens: a bench founding, never shown to anyone. */
async function found(kingdomId: string, plan: SettlementPlan): Promise<RealmFoundedScene> {
  const id = KingdomIdSchema.parse(kingdomId);
  const native = createNativeTown(plan);
  const furnished = enrichNativeForgeWorkshop(plan, enrichNativeForgeHearth(plan, enrichNativeMarketSeats(plan, enrichNativeMarket(plan, native))));
  const build = await assembleFoundedScene({ kingdomId: id, plan, state: createRealmState(id, 'simulated'),
    native: enrichNativePictureGroves(plan, furnished), collisionRevision: 1 });
  return build.scene;
}

function land(name: string, scene: RealmFoundedScene, world: CollisionWorld): Land {
  const terrain = sampleFoundedTerrain(scene.plan);
  return { name, scene, world, floorY: terrain.origin[1], ceilingY: terrain.ceilingY };
}

/** The old land: the simulated founded town's adopted plan, its collision compiled by the realm's own compiler. */
export async function oldLand(): Promise<Land> {
  const scene = await found('999000001', (oldTown as unknown as { plan: SettlementPlan }).plan);
  return land('the old land', scene, compileFoundedScene(scene));
}

/**
 * The grand land: Willowmere's founding (tobi4s_, town, 2019; the generator refuses eight quarters today, so it falls
 * back to first year 2022 as the grand kingdom view does), its collision through the grand land seam.
 */
export async function grandLand(): Promise<Land> {
  const config = { seed: 'tobi4s_', tier: 'town', firstYear: 2019, year: 2026 } as const;
  let plan: SettlementPlan;
  try { plan = generateSettlementPlan(config); } catch { plan = generateSettlementPlan({ ...config, firstYear: 2022 }); }
  const scene = await found('129634568', plan);
  const collision = grandKingdomLand(scene, compileFoundedScene(scene)).collision;
  if (!collision) throw new Error('The grand land seam carried no collision.');
  return land('the grand land', scene, collision);
}

/** Coalesced solid cells of a blueprint, in its local metres, resolving its ordered writes as the compiler does. */
function blueprintSolids(blueprint: VoxelBlueprint, solid: ReadonlySet<number>): SolidBox[] {
  const [sx, sy, sz] = blueprint.size, unit = VOXEL_METRES[blueprint.lattice];
  const cells = new Uint16Array(sx * sy * sz);
  for (const b of blueprint.boxes) for (let z = b.from[2]; z < b.to[2]; z++) for (let y = b.from[1]; y < b.to[1]; y++) {
    cells.fill(b.material, b.from[0] + sx * (y + sy * z), b.to[0] + sx * (y + sy * z));
  }
  return coalesce(cells, [sx, sy, sz], unit, material => solid.has(material), [0, 0, 0]);
}

function coalesce(cells: ArrayLike<number>, [sx, sy, sz]: readonly [number, number, number], unit: number, isSolid: (m: number) => boolean,
  offset: Vec3): SolidBox[] {
  const open = new Uint8Array(sx * sy * sz);
  for (let i = 0; i < open.length; i++) open[i] = isSolid(cells[i]!) ? 1 : 0;
  const at = (x: number, y: number, z: number) => x + sx * (y + sy * z);
  const boxes: SolidBox[] = [];
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    if (!open[at(x, y, z)]) continue;
    let ex = x + 1, ey = y + 1, ez = z + 1;
    while (ex < sx && open[at(ex, y, z)]) ex++;
    const row = (yy: number, zz: number) => { for (let xx = x; xx < ex; xx++) if (!open[at(xx, yy, zz)]) return false; return true; };
    while (ey < sy && row(ey, z)) ey++;
    const slab = (zz: number) => { for (let yy = y; yy < ey; yy++) if (!row(yy, zz)) return false; return true; };
    while (ez < sz && slab(ez)) ez++;
    for (let zz = z; zz < ez; zz++) for (let yy = y; yy < ey; yy++) open.fill(0, at(x, yy, zz), at(ex, yy, zz));
    boxes.push({ min: [offset[0] + x * unit, offset[1] + y * unit, offset[2] + z * unit], max: [offset[0] + ex * unit, offset[1] + ey * unit, offset[2] + ez * unit] });
  }
  return boxes;
}

/** A placement's local box in world metres: turn 1 maps local [x, y, z] to [z, y, -x] (`transformCardinalPoint`). */
function place(b: SolidBox, p: Vec3, turn: number): SolidBox {
  const [x, y, z] = b.min, [X, Y, Z] = b.max;
  const h = turn === 0 ? [x, z, X, Z] : turn === 1 ? [z, -X, Z, -x] : turn === 2 ? [-X, -Z, -x, -z] : [-Z, x, -z, X];
  return { min: [p[0] + h[0]!, p[1] + y, p[2] + h[1]!], max: [p[0] + h[2]!, p[1] + Y, p[2] + h[3]!] };
}

export interface Fixture {
  readonly id: string;
  /** The solids a person sees drawn there, world metres. */
  readonly solids: readonly SolidBox[];
}

/** The solid voxels of one placed fixture, from its reviewed blueprint. */
export function placedFixture(scene: RealmFoundedScene, placement: RealmFoundedPlacement): Fixture {
  const asset = scene.assets.find(item => item.assetHash === placement.assetHash);
  if (!asset) throw new Error(`${placement.id} has no blueprint in the scene.`);
  const solid = new Set(scene.materials.materials.filter(m => m.solid).map(m => m.id));
  return { id: placement.id, solids: blueprintSolids(asset.blueprint, solid).map(b => place(b, placement.position, placement.rotation)) };
}

/** The Forge anvil exactly as the ritual hero draws it: its sculpt, unrotated, at `foundedAnvilPosition`. */
export function anvilFixture(scene: RealmFoundedScene): Fixture {
  const sculpt = sculptAnvilStage(), at = foundedAnvilPosition(scene);
  const offset: Vec3 = [at[0] + GRID_MIN[0] * H, at[1] + GRID_MIN[1] * H + Y_OFFSET, at[2] + GRID_MIN[2] * H];
  return { id: 'forge:anvil', solids: coalesce(sculpt.voxels, sculpt.size, H, m => m !== 0, offset) };
}

export function bounds(boxes: readonly SolidBox[]): SolidBox {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, b.min[i]!); max[i] = Math.max(max[i]!, b.max[i]!); }
  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}

/** The walking body's box with its feet at (x, y, z), grown by `grow` metres on every side. */
export function body(s: Pick<PlayerState, 'x' | 'y' | 'z'>, grow = 0): SolidBox {
  const r = WALK_BODY.radius + grow;
  return { min: [s.x - r, s.y - grow, s.z - r], max: [s.x + r, s.y + WALK_BODY.height + grow, s.z + r] };
}
export const overlaps = (a: SolidBox, b: SolidBox, tolerance = 1e-6) =>
  a.min.every((v, i) => v < b.max[i]! - tolerance && a.max[i]! > b.min[i]! + tolerance);

/** True where the compiled world has a placement solid (not a terrain column) covering the point. */
export function solidAt(land: Land, point: Vec3): boolean {
  const e = 1e-4;
  return land.world.query({ min: [point[0] - e, point[1] - e, point[2] - e], max: [point[0] + e, point[1] + e, point[2] + e] })
    .some(b => b.min.every((v, i) => v <= point[i]! && b.max[i]! >= point[i]!)
      && !(b.min[1] <= land.floorY + 1e-9 && b.max[1] - b.min[1] > 0 && b.max[0] - b.min[0] === .5 && b.max[2] - b.min[2] === .5));
}

/** Somewhere a body stands clear and supported at (x, z): the lowest such floor, or null. */
export function standAt(land: Land, x: number, z: number): PlayerState | null {
  const r = WALK_BODY.radius;
  const tops = [...new Set(land.world.query({ min: [x - r, land.floorY, z - r], max: [x + r, land.ceilingY, z + r] }).map(b => b.max[1]))]
    .filter(y => y < land.ceilingY).sort((a, b) => a - b);
  for (const y of tops) {
    const s: PlayerState = { x, y, z, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: land.world.revision };
    if (!embeddedSolids(s, land.world).length && supported(s, land.world)) return s;
  }
  return null;
}

export interface Approach {
  readonly from: readonly [number, number];
  readonly sprint: boolean;
  /** The worst overlap of the body with the fixture's solids, metres along the shallowest axis (0: never inside). */
  readonly deepest: number;
  /**
   * The body came within 5 cm of the fixture's solids, or walked into its footprint between them (a bridge, an
   * arcade): it really reached the fixture, it was not stopped by something else first.
   */
  readonly reached: boolean;
}

/** Penetration of two boxes along the shallowest axis, or 0 when they do not overlap. */
function depth(a: SolidBox, b: SolidBox): number {
  let d = Infinity;
  for (let i = 0; i < 3; i++) d = Math.min(d, Math.min(a.max[i]!, b.max[i]!) - Math.max(a.min[i]!, b.min[i]!));
  return Math.max(0, d);
}

/**
 * Walk a body at the shared movement law's rate from `start` straight at the fixture's centre for `seconds`, and
 * measure how deep it ever got into the fixture's solids.
 */
export function walkInto(land: Land, fixture: Fixture, start: PlayerState, sprint: boolean, seconds = 4): Approach {
  const box = bounds(fixture.solids), cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2;
  const s = { ...start }, from = [start.x, start.z] as const;
  let deepest = 0, reached = false;
  for (let tick = 0; tick < seconds * WALK_HZ; tick++) {
    const dx = cx - s.x, dz = cz - s.z, length = Math.hypot(dx, dz) || 1;
    const input: WalkInput = { moveX: Math.round(dx / length * 127), moveZ: Math.round(dz / length * 127),
      buttons: sprint ? WALK_BUTTON.sprint : 0, yaw: 0, collisionRevision: land.world.revision };
    stepPlayer(s, input, 1 / WALK_HZ, land.world);
    const at = body(s), near = body(s, .05);
    if (s.x > box.min[0] && s.x < box.max[0] && s.z > box.min[2] && s.z < box.max[2]) reached = true;
    for (const solid of fixture.solids) {
      if (!reached && overlaps(near, solid, 0)) reached = true;
      if (overlaps(at, solid)) deepest = Math.max(deepest, depth(at, solid));
    }
  }
  return { from, sprint, deepest, reached };
}

/** Clear, supported starts around the fixture, one per compass direction where the ground allows one. */
export function startsAround(land: Land, fixture: Fixture, directions = 8): PlayerState[] {
  const box = bounds(fixture.solids), cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2;
  const reach = Math.hypot(box.max[0] - box.min[0], box.max[2] - box.min[2]) / 2 + WALK_BODY.radius;
  const starts: PlayerState[] = [];
  for (let n = 0; n < directions; n++) {
    const a = n / directions * Math.PI * 2, ux = Math.sin(a), uz = Math.cos(a);
    for (let d = reach + 1.5; d <= reach + 6; d += .25) {
      const s = standAt(land, cx + ux * d, cz + uz * d);
      if (s && !fixture.solids.some(b => overlaps(body(s), b))) { starts.push(s); break; }
    }
  }
  return starts;
}
