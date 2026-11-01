import { CATHEDRAL_SITE_AXIS, CROWN_TOWER_AXIS, proposeGenesisLandmarks, type LandmarkPiece } from '@chatdom/content/genesis-landmarks';
import { VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { terrainHeight, transformCardinalPoint, type CardinalTurn, type XZ } from '@chatdom/world';
import type { ChannelKingdomRecipe, DeepReadonly, GenesisLandscape } from '@chatdom/world/genesis';
import { composeGenesisHeraldry, GENESIS_CREST, GENESIS_STANDARD } from '../../../../../../packages/content/src/genesis-heraldry';
import { createKeeperLampPost, KEEPER_PROP_ANCHORS } from '../../../../../../packages/content/src/genesis-keepers/props';
import { createCastleContent, createCastleCourtContent } from '../../../kingdom/castle-content';
import type { Dressing } from '../../../kingdom/settlement-content';
import type { GenesisSeatContent } from '../../seat-content';
import type { MashaCityLayout } from './city';
import { mashaFrame } from './land';

const CELL = VOXEL_METRES.build;
/** Quarter turns from the frame's own south, for a piece whose front (+Z) faces each local direction. */
const TOWARD = { south: 0, east: 1, north: 2, west: 3 } as const;
type Toward = keyof typeof TOWARD;

/** What the seat raises beyond the keep, for the hero view and the tests. */
export interface MashaSeat extends GenesisSeatContent {
  readonly crownTower: { readonly origin: Vec3; readonly turn: CardinalTurn; readonly piece: LandmarkPiece; readonly watchFire: Vec3 };
  readonly cathedralSite: { readonly origin: Vec3; readonly turn: CardinalTurn; readonly piece: LandmarkPiece };
}

/**
 * The seat of MashaD4's kingdom: the keep on Crown Hill, and what the city keeps beyond its homes.
 *
 * - The crown tower stands on the levelled terrace in the pass, its door and chess-board terrace turned down to the
 *   city, at the end of the Pass Road. Its watch fire is the kingdom's beacon: the one fire seen in the notch between
 *   the horns at dusk.
 * - The cathedral site fronts Bell Court from the west: the land held and set out for the cathedral the city's
 *   people may raise, never a building.
 * - The channel's arms are proposed, never approved branding: two standards at the foot of the Crown Stair and the
 *   crest monument beside it, all in the colours the profile snapped to (`composeGenesisHeraldry`).
 * - Pip the lamplighter's lamp posts stand at every landing of the Crown Stair. They are unlit: a lamp burns only when
 *   a keeper lights it, and potential land has no keepers walking yet.
 *
 * The landmark and heraldry composers read the seeded candidate (`selected`), never the composed land, so the pieces
 * are exactly the ones the recipe proposes; only their sites are this composition's.
 */
export function createMashaSeat(recipe: DeepReadonly<ChannelKingdomRecipe>, selected: DeepReadonly<GenesisLandscape>, city: MashaCityLayout): MashaSeat {
  const { plan } = city, style = recipe.identity.styleFamily, frame = mashaFrame(selected.coast.oceanToward);
  const turnOf = (toward: Toward) => ((frame.turn + TOWARD[toward]) % 4) as CardinalTurn;
  const ground = (x: number, z: number) => terrainHeight(plan, x, z);
  /** The origin and turn that put a piece's `anchor` cell (x, z) on `at` (world metres) with its front `toward`. */
  const site = (anchor: { readonly x: number; readonly z: number }, at: XZ, y: number, toward: Toward) => {
    const turn = turnOf(toward), offset = transformCardinalPoint([0, 0, 0], turn, [anchor.x * CELL, 0, anchor.z * CELL]);
    const origin: Vec3 = [at[0] - offset[0], y, at[1] - offset[2]];
    return { origin, turn, world: (cell: Vec3): Vec3 => transformCardinalPoint(origin, turn, [cell[0] * CELL, cell[1] * CELL, cell[2] * CELL]) };
  };
  /** A landmark stands on the lowest graded ground under its footings; each footing may sink into higher ground. */
  const seatOn = (piece: LandmarkPiece, anchor: { readonly x: number; readonly z: number }, at: XZ, toward: Toward) => {
    const level = site(anchor, at, 0, toward);
    let lowest = Infinity;
    for (const footing of piece.footings) {
      for (let x = footing.box.from[0]; x <= footing.box.to[0]; x += 2) for (let z = footing.box.from[2]; z <= footing.box.to[2]; z += 2) {
        const p = level.world([x, 0, z]);
        lowest = Math.min(lowest, ground(p[0], p[2]));
      }
    }
    return site(anchor, at, Math.floor(lowest * 1000) / 1000, toward);
  };
  const dress = (blueprint: VoxelBlueprint, placed: { origin: Vec3; turn: CardinalTurn }): Dressing => ({ blueprint, position: placed.origin, yaw: placed.turn * Math.PI / 2 });
  /** A small fixture stands on the lowest graded ground under its footprint, so no corner floats. */
  const footing = (at: XZ, half: number) => Math.min(...[[-half, -half], [half, -half], [-half, half], [half, half], [0, 0]].map(([dx, dz]) => ground(at[0] + dx!, at[1] + dz!)));

  const castle = createCastleContent(plan.castle, style);
  const court = createCastleCourtContent(plan.castle, style);
  const props: Dressing[] = [...court.props];
  const braziers = [...court.braziers];

  const proposals = proposeGenesisLandmarks(recipe, selected);
  const tower = proposals.find(item => item.showcase === 'crown-tower');
  const cathedral = proposals.find(item => item.showcase === 'cathedral-site');
  if (!tower || !cathedral) throw new Error('MashaD4\'s recipe proposes a crown tower and a cathedral site.');

  // The crown tower: its axis eight metres behind the terrace's middle, so the board and its steps face the road's end.
  const [tx, tz] = frame.local(city.passTerrace.centre[0], city.passTerrace.centre[2]);
  const towerSite = seatOn(tower.piece, CROWN_TOWER_AXIS, frame.world(tx, tz - 10), 'south');
  props.push(dress(tower.piece.blueprint, towerSite), ...tower.piece.parts.map(part => ({ blueprint: part.blueprint, position: towerSite.world(part.offset), yaw: towerSite.turn * Math.PI / 2 })));
  const fire = tower.piece.emitters.find(emitter => emitter.kind === 'beacon');
  if (!fire) throw new Error('The crown tower keeps a watch fire.');
  const watchFire = towerSite.world(fire.position);
  braziers.push({ position: watchFire, normal: [0, 1, 0] });

  // The cathedral site: its west front on Bell Court. The reserve lies west of the court, so its front faces local east.
  const reserve = city.cathedral;
  const cathedralSite = seatOn(cathedral.piece, CATHEDRAL_SITE_AXIS, [reserve.centre[0], reserve.centre[2]], 'east');
  props.push(dress(cathedral.piece.blueprint, cathedralSite), ...cathedral.piece.parts.map(part => ({ blueprint: part.blueprint, position: cathedralSite.world(part.offset), yaw: cathedralSite.turn * Math.PI / 2 })));

  // The arms at the foot of the stair: two standards either side of it and the crest monument to its west, facing
  // the square and the road in.
  const heraldry = composeGenesisHeraldry(recipe, selected);
  const marketNode = plan.nodes.find(node => node.id === plan.market.nodeId)!;
  const [mx, mz] = frame.local(marketNode.position[0], marketNode.position[2]);
  for (const side of [-1, 1]) {
    const at = frame.world(mx + side * 4.5, mz - 10.5);
    props.push(dress(heraldry.standard.blueprint, site({ x: (GENESIS_STANDARD.pole.from[0] + GENESIS_STANDARD.pole.to[0]) / 2, z: (GENESIS_STANDARD.pole.from[2] + GENESIS_STANDARD.pole.to[2]) / 2 }, at, footing(at, 2), 'south')));
  }
  {
    const at = frame.world(mx - 11, mz - 9.5);
    props.push(dress(heraldry.crest.blueprint, site({ x: GENESIS_CREST.size[0] / 2, z: GENESIS_CREST.size[2] / 2 }, at, footing(at, 3), 'south')));
  }

  // Pip's lamps: a pair at every landing of the Crown Stair, on the green's downhill corners, facing down the stair.
  const lamp = createKeeperLampPost(style), lampAnchor = { x: KEEPER_PROP_ANCHORS.lamp.origin[0], z: KEEPER_PROP_ANCHORS.lamp.origin[2] };
  for (const terrace of city.terraces) {
    const landing = plan.nodes.find(node => node.id === `masha:stair:${terrace.ring}`);
    if (!landing) continue;
    const [lx, lz] = frame.local(landing.position[0], landing.position[2]);
    for (const side of [-1, 1]) {
      const at = frame.world(lx + side * 3.6, lz + 3.4);
      props.push(dress(lamp, site(lampAnchor, at, footing(at, .6), 'south')));
    }
  }

  return {
    buildings: castle.buildings, props, braziers, beaconPosition: watchFire,
    crownTower: { origin: towerSite.origin, turn: towerSite.turn, piece: tower.piece, watchFire },
    cathedralSite: { origin: cathedralSite.origin, turn: cathedralSite.turn, piece: cathedral.piece },
  };
}
