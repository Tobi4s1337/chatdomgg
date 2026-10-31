import { createCastleModule, createMarketStall, createMarketWell, createStreetProp, createTree, type StreetPropForm } from '@chatdom/content';
import { createNativeForgeHost } from '@chatdom/forge';
import { VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { randomUnit, samplePublicGround, seedHash, terrainHeight, transformCardinalPoint, type CardinalTurn, type SettlementHome, type SettlementPlan } from '@chatdom/world';

/** One static solid in native content, before hashing. Positions are world metres at the blueprint's local origin. */
export interface NativePiece {
  readonly id: string;
  readonly blueprint: VoxelBlueprint;
  readonly position: Vec3;
  readonly rotation: CardinalTurn;
}
export interface NativeHome extends NativePiece { readonly plot: SettlementHome }

/**
 * Accepted native content for one exact adopted plan: the street homes, their small front-garden edges, the market's
 * well and stalls, the castle modules and the groves. Pure and deterministic in the plan alone, so it can be built
 * and cached outside an opening's critical window. Committed owned homes replace `homes` entries in scene assembly.
 *
 * This follows the current dusk town's recipes (`apps/web/src/kingdom/settlement-content.ts`, `castle-content.ts`
 * and the grove planting in `scene.ts`) so the founded scene is the same town, now as explicit placements.
 */
export interface NativeTown {
  readonly revision: string;
  readonly homes: ReadonlyMap<string, NativeHome>;
  /** Everything static that is not a citizen home: garden edges, market, castle, trees. Stable order. */
  readonly fixtures: readonly NativePiece[];
}

/** Grove density follows the town's tier, as the presentation always has. */
const TREE_COUNT = { hamlet: 115, town: 260 } as const;
const CASTLE_STYLE = 'tide';

export class FoundedContentError extends Error {
  readonly code = 'realm.founded-content';
  constructor(detail: string) { super(detail); this.name = 'FoundedContentError'; }
}

export function createNativeTown(plan: SettlementPlan): NativeTown {
  supportedLandform(plan);
  const ground = (x: number, z: number) => terrainHeight(plan, x, z);
  // One blueprint object per factory input: distinct plots of one family share the same reviewed bytes.
  const memo = new Map<string, VoxelBlueprint>();
  const once = (key: string, make: () => VoxelBlueprint) => { let b = memo.get(key); if (!b) memo.set(key, b = make()); return b; };

  const homes = new Map<string, NativeHome>(), fixtures: NativePiece[] = [];
  for (const plot of plan.homes) {
    if (homes.has(plot.id)) throw new FoundedContentError(`plot ${plot.id} appears twice in revision ${plan.revision}`);
    const host = createNativeForgeHost(plot);
    const blueprint = once(`home:${plot.style}:${plot.tier}:${plot.variant}`, () => host.blueprint);
    homes.set(plot.id, { id: `home:${plot.id}`, plot, blueprint, position: host.position, rotation: plot.rotation });
    if (plot.style === 'grove') continue;
    // Small public front-garden edges outside the reserved home; the entrance band stays clear for the doors.
    const depth = blueprint.size[2] * VOXEL_METRES.build;
    let n = 0;
    const add = (form: StreetPropForm, x: number, z: number) => {
      const b = once(`street:${form}:${plot.style}`, () => createStreetProp(form, plot.style as 'hearth' | 'tide'));
      const origin = transformCardinalPoint(host.position, plot.rotation, [x, 0, depth + z]);
      const centre = transformCardinalPoint(origin, plot.rotation, [b.size[0] / 16, 0, b.size[2] / 16]);
      fixtures.push({ id: `garden:${plot.id}:${n++}`, blueprint: b, position: [origin[0], ground(centre[0], centre[2]), origin[2]], rotation: plot.rotation });
    };
    add('flower-pot', 0, .125);
    add(plot.ordinal % 5 === 0 ? 'leafy-shrub' : plot.ordinal % 3 ? 'flower-trough' : 'rock-cluster', 6, .125);
    if (plot.ordinal % 4 === 0) {
      const kind = plot.ordinal % 8 === 0 ? 'wall' : 'fence';
      add(`${kind}-straight`, 5.625, 1.75);
      add(`${kind}-end`, 7.5, 1.75);
    }
  }

  // The meeting of the roads stays open: well and two stalls along its edges.
  const market = plan.market.elevation;
  fixtures.push(
    { id: 'market:well', blueprint: once('market:well', createMarketWell), position: [8, market, 16], rotation: 0 },
    { id: 'market:stall:0', blueprint: once('market:stall:0', () => createMarketStall(0)), position: [-14, market, 0], rotation: 0 },
    { id: 'market:stall:1', blueprint: once('market:stall:1', () => createMarketStall(1)), position: [-14, market, 17], rotation: 0 },
  );

  for (const module of plan.castle.modules) {
    if (module.position.some(v => !Number.isFinite(v))) throw new FoundedContentError(`castle module ${module.id} is not finite`);
    const blueprint = once(`castle:${module.kind}:${module.size.join('x')}`, () => createCastleModule(module.kind, module.size, CASTLE_STYLE));
    if (blueprint.size.some((cells, axis) => cells * VOXEL_METRES.build !== module.size[axis])) throw new FoundedContentError(`castle module ${module.id} disagrees with its size`);
    fixtures.push({ id: `castle:${module.id}`, blueprint, position: module.position, rotation: module.rotation });
  }
  const beacon = plan.castle.modules.find(module => module.id === plan.castle.beaconModuleId);
  if (!beacon || beacon.kind !== 'keep') throw new FoundedContentError('the castle beacon must resolve to its keep');

  const trees = [0, 1, 2].map(v => once(`tree:${v}`, () => createTree(v)));
  for (const [i, tree] of plantGroves(plan, ground).entries()) {
    fixtures.push({ id: `tree:${i}`, blueprint: trees[tree.variant]!, position: tree.position, rotation: 0 });
  }
  return { revision: plan.revision, homes, fixtures };
}

/** Only the installed landform sampler is supported; a newer landform is unavailable rather than flattened. */
export function supportedLandform(plan: SettlementPlan): void {
  if (plan.version !== 2) throw new FoundedContentError(`settlement plan version ${String(plan.version)} is not supported`);
  if (plan.landform.version !== 1) throw new FoundedContentError(`landform version ${String(plan.landform.version)} has no installed sampler`);
}

/**
 * Groves around every inhabited court, then seeded woodland around the town, never inside a reserved lot (so a
 * growing home never needs a tree removed), the castle, the lake or public ground. Roots sit on the lowest corner of
 * the trunk's footprint on the plan's own terrain surface.
 */
function plantGroves(plan: SettlementPlan, ground: (x: number, z: number) => number): { position: Vec3; variant: number }[] {
  const crown = 4.25, indexStep = 16, planted: [number, number][] = [], result: { position: Vec3; variant: number }[] = [];
  const rootHeight = (x: number, z: number) => {
    let height = Infinity;
    for (const dx of [-1.25, 0, 1.25]) for (const dz of [-1.25, 0, 1.25]) height = Math.min(height, ground(x + dx, z + dz));
    return height;
  };
  const cells = new Map<string, SettlementPlan['reservations'][number][]>();
  for (const reservation of plan.reservations) {
    const lot = reservation.lot;
    for (let z = Math.floor((lot.minZ - crown) / indexStep); z <= Math.floor((lot.maxZ + crown) / indexStep); z++)
      for (let x = Math.floor((lot.minX - crown) / indexStep); x <= Math.floor((lot.maxX + crown) / indexStep); x++) {
        const key = `${x},${z}`, entries = cells.get(key) ?? []; entries.push(reservation); cells.set(key, entries);
      }
  }
  const castle = plan.castle.bounds, lake = plan.lake;
  const plant = (x: number, z: number, variant: number) => {
    const nearby = cells.get(`${Math.floor(x / indexStep)},${Math.floor(z / indexStep)}`) ?? [];
    if (nearby.some(({ lot }) => x > lot.minX - crown && x < lot.maxX + crown && z > lot.minZ - crown && z < lot.maxZ + crown)) return;
    if ((samplePublicGround(plan, x, z)?.reservedDistance ?? Infinity) < crown) return;
    if (x > castle.minX - crown && x < castle.maxX + crown && z > castle.minZ - crown && z < castle.maxZ + crown) return;
    if (Math.hypot((x - lake.x) / lake.radiusX, (z - lake.z) / lake.radiusZ) < 1.19) return;
    if (planted.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 8)) return;
    planted.push([x, z]);
    result.push({ position: [x - 4, rootHeight(x, z), z - 4], variant });
  };
  const inhabited = new Set(plan.homes.map(home => home.courtId));
  for (const [i, court] of plan.courts.entries()) {
    if (!inhabited.has(court.id)) continue;
    const anchor = plan.nodes.find(node => node.id === court.nodeId);
    if (!anchor) throw new FoundedContentError(`court ${court.id} has no node`);
    const radius = Math.max(...court.boundary.map(([x, z]) => Math.hypot(x - anchor.position[0], z - anchor.position[2]))) + 7;
    for (let side = 0; side < 8; side++) {
      const angle = side * Math.PI / 4;
      plant(anchor.position[0] + Math.cos(angle) * radius, anchor.position[2] + Math.sin(angle) * radius, (i + side) % 3);
    }
  }
  const count = TREE_COUNT[plan.config.tier], b = plan.bounds;
  for (let i = 0; i < count * 12 && planted.length < count; i++) {
    const group = Math.floor(i / 7), rand = (part: string) => randomUnit(seedHash(`${plan.config.seed}:grove:${part}`));
    const cx = b.minX - 35 + rand(`${group}:x`) * (b.maxX - b.minX + 70);
    const cz = b.minZ - 65 + rand(`${group}:z`) * (b.maxZ - b.minZ + 45);
    const angle = rand(`${i}:angle`) * Math.PI * 2, radius = Math.sqrt(rand(`${i}:radius`)) * 10;
    plant(cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius, group % 3);
  }
  return result;
}
