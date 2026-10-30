/** Test-only SIMULATED town. This is not the immutable founded-world producer or house collision. */
import { createHash } from 'node:crypto';
import { MATERIALS } from '../../content/src/index';
import type { Vec3, VoxelBlueprint } from '../../shared/src/index';
import type { CollisionWorld, RealmFoundedManifest, SolidBox } from '../../shared/src/realm/index';
import { generateSettlementPlan, terrainHeight, type RealmFoundedScene, type RealmFoundedPlacement } from '../../world/src/index';
import { placeSettlementContent, placeMarketContent } from '../../../apps/web/src/kingdom/settlement-content';
import { createCastleContent } from '../../../apps/web/src/kingdom/castle-content';

const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
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

export function createSimulatedKingdomWalkFixture() {
  const plan = generateSettlementPlan({ seed: 'willowmere', tier: 'town', firstYear: 2022, year: 2026 });
  const { houses, props } = placeSettlementContent(plan.homes, (x, z) => terrainHeight(plan, x, z));
  props.push(...placeMarketContent(plan.market));
  const castles = createCastleContent(plan.castle).buildings;
  const assets = new Map<string, { assetHash: string; blueprint: VoxelBlueprint }>();
  const placements: RealmFoundedPlacement[] = [];
  const add = (id: string, content: { blueprint: VoxelBlueprint; position: Vec3; yaw: number }, plotId?: string) => {
    const assetHash = digest(JSON.stringify(content.blueprint));
    assets.set(assetHash, { assetHash, blueprint: content.blueprint });
    const turn = content.yaw / (Math.PI / 2);
    if (Math.abs(turn - Math.round(turn)) > 1e-9) throw new Error('Fixture requires exact native cardinal transforms');
    const rotation = ((Math.round(turn) % 4 + 4) % 4) as 0 | 1 | 2 | 3;
    placements.push({ id, assetHash, position: content.position, rotation, ...(plotId ? { plotId } : {}) });
  };
  for (const house of houses) {
    const plot = plan.homes.find(home => home.slot === house.slot);
    if (!plot) throw new Error('Native home lacks its adopted plot');
    add(`simulated:home:${plot.id}`, house, plot.id);
  }
  props.forEach((prop, index) => add(`simulated:prop:${index}`, prop));
  castles.forEach(castle => add(`simulated:castle:${castle.id}`, castle));
  const scene: RealmFoundedScene = { version: 1, kingdomId: '999000001' as RealmFoundedScene['kingdomId'], origin: 'simulated',
    layoutRevision: plan.revision, collisionRevision: 1, plan, materials: MATERIALS, assets: [...assets.values()], placements };
  const sceneBytes = JSON.stringify(scene);
  const manifest: RealmFoundedManifest = { version: scene.version, kingdomId: scene.kingdomId, origin: scene.origin,
    layoutRevision: scene.layoutRevision, collisionRevision: scene.collisionRevision, sceneHash: digest(sceneBytes) };

  // This open central rectangle excludes the existing well and stalls. It is deliberately smaller than the
  // market. Only its current sampled terrain is known; houses, stairs and the rest of town are NOT compiled.
  const bounds = [-5, 5, 1, 20] as const;
  const blocks: SolidBox[] = [];
  for (let z = bounds[2]; z < bounds[3]; z += .5) for (let x = bounds[0]; x < bounds[1]; x += .5) {
    const height = terrainHeight(plan, x + .25, z + .25);
    if (Math.abs(height - plan.market.elevation) > 1e-6) throw new Error('The SIMULATED limited market floor is no longer flat');
    // Same centre sample and round-to-half-metre top convention as prepareTerrainField.
    blocks.push({ min: [x, -32, z], max: [x + .5, Math.round(height / .5) * .5, z + .5] });
  }
  const floor: LimitedMarketFloor = { revision: scene.collisionRevision, bounds, blocks };
  const world: CollisionWorld = { revision: floor.revision, query: area => queryLimitedMarketFloor(floor, area) };
  const spawns: readonly Vec3[] = [[-1, plan.market.elevation, 10], [0, plan.market.elevation, 14], [1, plan.market.elevation, 18]];
  return { scene, sceneBytes, manifest, floor, world, spawns,
    limitation: 'SIMULATED temporary market floor only; solid outside the known rectangle. Immutable producer, house collision, stairs and tour acceptance remain pending.' };
}
