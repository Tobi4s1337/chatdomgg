import { CATHEDRAL_SITE_AXIS, CROWN_TOWER_AXIS, proposeGenesisLandmarks, type LandmarkPiece } from '@chatdom/content/genesis-landmarks';
import { MAT } from '@chatdom/content';
import type { Vec3 } from '@chatdom/shared';
import { transformCardinalPoint, type CardinalTurn, type SettlementPlan, type XZ } from '@chatdom/world';
import { compileGenesisSettlement, type ChannelKingdomRecipe, type DeepReadonly, type GenesisLandscape } from '@chatdom/world/genesis';
import { composeGenesisHeraldry, GENESIS_CREST, GENESIS_STANDARD, type GenesisHeraldry } from '../../../../../packages/content/src/genesis-heraldry/index';
import { createKeeperLampPost, KEEPER_PROP_ANCHORS } from '../../../../../packages/content/src/genesis-keepers/props';
import { createCopperKettle } from '../../../../../packages/content/src/genesis-kingdoms/masha/inn/inn';
import { createHarbourInn } from '../../../../../packages/content/src/genesis-kingdoms/aggman/inn/inn';
import { createBuntingRun } from '../../../../../packages/content/src/genesis-kingdoms/aggman/colours/bunting';
import type { Livery } from '../../../../../packages/content/src/genesis-kingdoms/aggman/piece';
import { shieldDesign, TINCTURES } from '../../atlas/heraldry';
import { createCastleContent, createCastleCourtContent } from '../../kingdom/castle-content';
import type { RoyalBrazier } from '../../kingdom/royal-life';
import type { Dressing } from '../../kingdom/settlement-content';
import type { GenesisKingdomComposition } from '../kingdoms';
import { createGenesisSeatContent, type GenesisSeatContent } from '../seat-content';
import { unit } from '../holding-facts';
import { frameCamera } from './camera';
import { generatedLore } from './lore';
import { createBellGarden, createOpenAirStage, createStandingStones, type GeneratedPiece, type PieceOptions } from './pieces';
import { CELL, facing, Ground, stand, type Footprint } from './site';
import { applyKit, chooseKingdomKit, type KitChoice } from './kit-choice';
import { placeSkyline, type SkylinePiece } from './skyline';

/** What the hero view and the tests read back about where the composition put things. */
export interface GeneratedSites {
  readonly market: Vec3;
  readonly castle: Vec3;
  readonly landmark: { readonly kind: string; readonly at: Vec3 } | null;
  /** The realm's landmark, and the way its front (local +Z) faces in world XZ, so the view can meet it. */
  readonly family: { readonly kind: string; readonly at: Vec3; readonly front: readonly [number, number] } | null;
  readonly inn: Vec3 | null;
  readonly cathedral: Vec3 | null;
  /** The tall pieces beyond the keep the town is known by from the road: lighthouse, lookout, mill. */
  readonly skyline: readonly SkylinePiece[];
}

export interface GeneratedKingdom extends GenesisKingdomComposition {
  readonly sites: GeneratedSites;
  readonly heraldry: GenesisHeraldry;
  /** The building kit the town, the keep and the trees are drawn in (the old town's, when it grew in two). */
  readonly style: KitChoice['primary'];
  readonly kit: KitChoice;
}

type PieceFactory = (options: PieceOptions) => GeneratedPiece;
/** The realm's own low landmark, by the recipe's landmark family; the tall ones stand on the skyline (`./skyline`). */
/** The skyline piece that stands for a realm landmark of that family. */
const SKYLINE_OF: Partial<Record<string, SkylinePiece['kind']>> = { lighthouse: 'lighthouse', watchtower: 'watchtower', watermill: 'windmill' };
const FAMILY_PIECES: Partial<Record<string, PieceFactory>> = {
  'open-air-stage': createOpenAirStage, 'stone-circle': createStandingStones, 'bell-garden': createBellGarden,
};

/**
 * The colours a generated kingdom flies are its arms on the Atlas: the same shield the map draws for this channel,
 * derived from the broadcaster ID alone. They are Chatdom's heraldry for the holding, not the channel's branding;
 * the profile colours a founding reads replace them when Genesis runs.
 */
export function atlasArmsTargets(broadcasterId: string): string[] {
  const design = shieldDesign(broadcasterId);
  const charge = design.charge && design.charge.tincture !== 'counterchanged' ? design.charge.tincture : null;
  return [...new Set([TINCTURES[design.field].pigment, TINCTURES[design.second].pigment, ...(charge ? [TINCTURES[charge].pigment] : [])])];
}

/**
 * Any channel's potential kingdom, composed from its recipe and the land chosen for it: the settlement the recipe
 * reserves, the keep (a watchtower keep on the coast), the land's own landmark, the landmark of its realm, the inn,
 * the arms on standards and a crest, the market's bunting and the lamplighter's lamps, a hero view and a dusk hour.
 * Deterministic; every site is proved free, dry and gentle before anything stands on it, and a piece with no such
 * site is left out rather than floated.
 */
export function composeGeneratedKingdom(source: DeepReadonly<ChannelKingdomRecipe>, landscape: DeepReadonly<GenesisLandscape>, options: { plan?: SettlementPlan } = {}): GeneratedKingdom {
  // The kit the land, the realm and the arms choose builds the town; the recipe itself is not rewritten.
  const arms = atlasArmsTargets(String(source.kingdomId));
  const kit = chooseKingdomKit(source, landscape, arms);
  const recipe = { ...source, identity: { ...source.identity, styleFamily: kit.primary } } as DeepReadonly<ChannelKingdomRecipe>;
  const plan = options.plan ?? applyKit(compileGenesisSettlement(recipe, landscape.id), kit);
  const ground = new Ground(plan, landscape);
  const style = kit.primary;
  const seed = Number.parseInt(recipe.seedKey.replace(/\D/g, '').slice(-9) || '0', 10) >>> 0;
  const roll = (slot: string) => unit(`${recipe.seedKey}/generated/${slot}`);
  const props: Dressing[] = [];
  const braziers: RoyalBrazier[] = [];
  const turnYaw = (turn: CardinalTurn) => turn * Math.PI / 2;

  // The arms: the Atlas shield's tinctures snapped to the heraldic kit, as a proposal.
  const armed = { ...recipe, identity: { ...recipe.identity, profileColourTargets: arms } } as DeepReadonly<ChannelKingdomRecipe>;
  let heraldry: GenesisHeraldry;
  try { heraldry = composeGenesisHeraldry(armed, landscape); } catch { heraldry = composeGenesisHeraldry(recipe, landscape); }
  const colours = heraldry.colours;
  const livery: Livery = { red: colours.field, gold: colours.charge, cream: MAT.cream, blue: colours.border, brass: MAT.brass };

  const marketNode = plan.nodes.find(node => node.id === plan.market.nodeId)!;
  const market: XZ = [marketNode.position[0], marketNode.position[2]];
  const castleXZ: XZ = [plan.castle.centre[0], plan.castle.centre[2]];

  // The keep. On the coast, the recipe's harbour watchtower is the keep when its footings meet the ground.
  let seat: GenesisSeatContent | undefined = landscape.character === 'coastal-harbour' ? createGenesisSeatContent(recipe, landscape, plan) : undefined;
  let landmark: GeneratedSites['landmark'] = null;
  if (seat) {
    props.push(...seat.props);
    braziers.push(...seat.braziers);
    landmark = { kind: 'harbour-watchtower', at: seat.beaconPosition };
  }
  const castle = createCastleContent(plan.castle, style);
  const court = createCastleCourtContent(plan.castle, style);
  props.push(...court.props);
  braziers.push(...court.braziers);
  let beacon = seat?.beaconPosition ?? castle.beaconPosition;
  const buildings = seat ? seat.buildings : castle.buildings;

  const landmarkFor = (piece: LandmarkPiece, axis: { readonly x: number; readonly z: number }, at: Footprint) => {
    const placed = stand(ground, piece.blueprint, [axis.x, axis.z], at.centre, at.turn, {
      footprint: footprintOf(piece), lanterns: piece.emitters.filter(e => e.kind === 'lantern').map(e => e.position), sink: CELL,
    });
    props.push(placed.dressing, ...piece.parts.map(part => ({ blueprint: part.blueprint, position: placed.world(part.offset), yaw: turnYaw(placed.turn) })));
    braziers.push(...placed.braziers);
    ground.claim(at);
    return placed;
  };

  const proposals = proposeGenesisLandmarks(recipe, landscape);
  // In the mountains, the crown tower stands on the castle's shoulder on the side toward the pass.
  if (landscape.character === 'mountain-pass') {
    const tower = proposals.find(item => item.showcase === 'crown-tower');
    if (tower) {
      const saddle: XZ = [landscape.mountainPass.saddle[0], landscape.mountainPass.saddle[2]];
      const toward: XZ = lerp2(castleXZ, saddle, .35);
      const half: [number, number] = [tower.piece.blueprint.size[0] * CELL / 2 + 1, tower.piece.blueprint.size[2] * CELL / 2 + 1];
      const site = ground.find(toward, half, market, { to: 140, rise: 6, step: 4 });
      if (site) {
        const placed = landmarkFor(tower.piece, CROWN_TOWER_AXIS, site);
        const fire = tower.piece.emitters.find(emitter => emitter.kind === 'beacon');
        if (fire) { beacon = placed.world(fire.position); braziers.push({ position: beacon, normal: [0, 1, 0] }); }
        landmark = { kind: 'crown-tower', at: placed.world([CROWN_TOWER_AXIS.x, 0, CROWN_TOWER_AXIS.z]) };
      }
    }
  }

  // A city keeps its cathedral site by the market.
  let cathedral: Vec3 | null = null;
  const reserve = proposals.find(item => item.showcase === 'cathedral-site');
  if (reserve) {
    const half: [number, number] = [reserve.piece.blueprint.size[0] * CELL / 2 + 1, reserve.piece.blueprint.size[2] * CELL / 2 + 1];
    const site = ground.find(market, half, market, { from: 24, to: 160, rise: 3, step: 4 })
      ?? ground.find(market, half, market, { from: 160, to: 320, rise: 4.5, step: 5 });
    if (site) cathedral = landmarkFor(reserve.piece, CATHEDRAL_SITE_AXIS, site).world([CATHEDRAL_SITE_AXIS.x, 0, CATHEDRAL_SITE_AXIS.z]);
  }

  // The realm's own landmark: a stage on the green, standing stones beyond the lanes, or a bell garden.
  let family: GeneratedSites['family'] = null;
  const familyKind = recipe.identity.landmark;
  const factory = FAMILY_PIECES[familyKind];
  if (factory) {
    const piece = factory({ style, colours, seed });
    const [fx0, fz0] = piece.footprint.from, [fx1, fz1] = piece.footprint.to;
    const half: [number, number] = [(fx1 - fx0) * CELL / 2 + .5, (fz1 - fz0) * CELL / 2 + .5];
    // The stage wants the green by the market; the stones the edge of town; the garden a quiet corner near the keep.
    const near: XZ = familyKind === 'stone-circle' ? outward(plan, market, 1.15) : familyKind === 'bell-garden' ? lerp2(market, castleXZ, .45) : market;
    const site = ground.find(near, half, market, { from: familyKind === 'open-air-stage' ? 14 : 0, to: 150, rise: 1.5, step: 3 })
      ?? ground.find(near, half, market, { from: 150, to: 300, rise: 2.5, step: 5 });
    if (site) {
      const placed = placePiece(ground, piece, site);
      props.push(placed.dressing);
      braziers.push(...placed.braziers);
      ground.claim(site);
      const front = transformCardinalPoint([0, 0, 0], site.turn, [0, 0, 1]);
      family = { kind: familyKind, at: [site.centre[0], placed.origin[1], site.centre[1]], front: [front[0], front[2]] };
    }
  }

  // The inn, a short walk from the market with its door toward it.
  let inn: Vec3 | null = null;
  {
    const coastal = landscape.character === 'coastal-harbour';
    const piece: GeneratedPiece | LandmarkPiece = coastal ? createHarbourInn(livery) : createCopperKettle({ style });
    const size = piece.blueprint.size;
    const half: [number, number] = [size[0] * CELL / 2 + .5, size[2] * CELL / 2 + .5];
    const site = ground.find(market, half, market, { from: 16, to: 110, rise: 2.5, step: 3 })
      ?? ground.find(market, half, market, { from: 110, to: 260, rise: 3.5, step: 4 });
    if (site) {
      const lanterns = 'emitters' in piece ? piece.emitters.filter(e => e.kind === 'lantern').map(e => e.position) : piece.lanterns;
      const placed = stand(ground, piece.blueprint, [size[0] / 2, size[2] / 2], site.centre, site.turn,
        { footprint: 'footings' in piece ? footprintOf(piece) : piece.footprint, lanterns, sink: CELL });
      props.push(placed.dressing);
      if ('parts' in piece) props.push(...piece.parts.map(part => ({ blueprint: part.blueprint, position: placed.world(part.offset), yaw: turnYaw(placed.turn) })));
      braziers.push(...placed.braziers);
      ground.claim(site);
      inn = [site.centre[0], placed.origin[1], site.centre[1]];
    }
  }

  // The skyline beyond the keep: the realm's lighthouse, lookout or mill, and often a mill on farmland.
  const skyline = placeSkyline({ ground, plan, landscape, recipe, market, castle: castleXZ, options: { style, colours, seed } });
  props.push(...skyline.props);
  braziers.push(...skyline.braziers);

  // The arms: two standards on the market's castle side, the crest at the head of the Crown Way.
  const towardCastle = facing(market, castleXZ);
  const square = squareFrame(plan, market, towardCastle);
  for (const side of [-1, 1]) {
    const at = square.at(side * 5.5, -square.depth + 1.5);
    const placed = stand(ground, heraldry.standard.blueprint, [(GENESIS_STANDARD.pole.from[0] + GENESIS_STANDARD.pole.to[0]) / 2, (GENESIS_STANDARD.pole.from[2] + GENESIS_STANDARD.pole.to[2]) / 2], at, square.facing, { sink: CELL });
    props.push(placed.dressing);
  }
  {
    const gate = plan.nodes.find(node => node.id === plan.castle.gateNodeId);
    const anchor: XZ = gate ? [gate.position[0], gate.position[2]] : castleXZ;
    const site = ground.find(lerp2(anchor, market, .08), [GENESIS_CREST.size[0] * CELL / 2 + .3, GENESIS_CREST.size[2] * CELL / 2 + .3], market, { from: 4, to: 30, rise: 1, step: 1.5 });
    if (site) {
      props.push(stand(ground, heraldry.crest.blueprint, [GENESIS_CREST.size[0] / 2, GENESIS_CREST.size[2] / 2], site.centre, site.turn, { sink: CELL }).dressing);
      ground.claim(site);
    }
  }

  // Bunting strung across the market in the arms' colours, and the lamplighter's lamps at its corners, lit at dusk.
  const span = Math.max(64, Math.min(200, Math.round((square.width * 2 - 4) / CELL)));
  const bunting = createBuntingRun(livery, span, 6 + Math.floor(roll('bunting-sag') * 8));
  for (const row of [-.35, .3]) {
    const at = square.at(0, square.depth * row * 2);
    props.push(stand(ground, bunting.blueprint, [span / 2, bunting.footprint.to[1] / 2], at, ((square.facing + 1) % 4) as CardinalTurn, { sink: CELL }).dressing);
  }
  const lamp = createKeeperLampPost(style), lampAnchor: readonly [number, number] = [KEEPER_PROP_ANCHORS.lamp.origin[0], KEEPER_PROP_ANCHORS.lamp.origin[2]];
  const glass = KEEPER_PROP_ANCHORS.lamp.points.glass;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const at = square.at(sx * (square.width - .8), sz * (square.depth - .8));
    const turn = facing(at, market);
    const placed = stand(ground, lamp, lampAnchor, at, turn, { sink: CELL });
    props.push(placed.dressing);
    braziers.push({ position: transformCardinalPoint([at[0], placed.origin[1], at[1]], turn, glass), normal: [0, 1, 0] });
  }
  // And one lamp at each ward's green, so the lanes beyond the market have their own pools of light.
  for (const courtyard of plan.courts) {
    const node = plan.nodes.find(item => item.id === courtyard.nodeId);
    if (!node) continue;
    const site = ground.find([node.position[0], node.position[2]], [.8, .8], market, { from: 3, to: 9, rise: .8, step: 1, margin: .2 });
    if (!site) continue;
    const placed = stand(ground, lamp, lampAnchor, site.centre, site.turn, { sink: CELL });
    props.push(placed.dressing);
    braziers.push({ position: transformCardinalPoint([site.centre[0], placed.origin[1], site.centre[1]], site.turn, glass), normal: [0, 1, 0] });
    ground.claim(site);
  }

  const sites: GeneratedSites = {
    market: [market[0], plan.market.elevation, market[1]], castle: plan.castle.centre,
    landmark, family, inn, cathedral, skyline: skyline.pieces,
  };
  const camera = frameCamera(plan, landscape, sites, roll('camera'));
  // Each kingdom opens at its own moment of dusk: some while the last amber is on the horizon, some in the blue hour.
  const hour = Math.round((18.5 + roll('hour') * 1.2) * 20) / 20;
  seat = { buildings, props, braziers, beaconPosition: beacon };
  return { recipe: source, landscape, plan, seat, camera, hour, lore: generatedLore(source, landscape, { landmarkStands: !!family || skyline.pieces.some(piece => piece.kind === SKYLINE_OF[source.identity.landmark])
    || (source.identity.landmark === 'watchtower' && landmark?.kind === 'harbour-watchtower') }), sites, heraldry, style, kit };
}

const lerp2 = (a: XZ, b: XZ, t: number): XZ => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** The landmark's footings as a cell rectangle on the ground. */
function footprintOf(piece: LandmarkPiece): { from: [number, number]; to: [number, number] } {
  if (!piece.footings.length) return { from: [0, 0], to: [piece.blueprint.size[0], piece.blueprint.size[2]] };
  return {
    from: [Math.min(...piece.footings.map(f => f.box.from[0])), Math.min(...piece.footings.map(f => f.box.from[2]))],
    to: [Math.max(...piece.footings.map(f => f.box.to[0])), Math.max(...piece.footings.map(f => f.box.to[2]))],
  };
}

/** A generated piece centred on its site, its front (+Z) turned as the site says. */
function placePiece(ground: Ground, piece: GeneratedPiece, site: Footprint) {
  const [fx0, fz0] = piece.footprint.from, [fx1, fz1] = piece.footprint.to;
  return stand(ground, piece.blueprint, [(fx0 + fx1) / 2, (fz0 + fz1) / 2], site.centre, site.turn, { footprint: piece.footprint, lanterns: piece.lanterns, sink: CELL });
}

/** A point beyond the settlement's homes, out from the market along the line away from the castle. */
function outward(plan: SettlementPlan, market: XZ, reach: number): XZ {
  const away: XZ = [market[0] - plan.castle.centre[0], market[1] - plan.castle.centre[2]];
  const length = Math.hypot(away[0], away[1]) || 1;
  let far = 0;
  for (const home of plan.homes) far = Math.max(far, ((home.position[0] - market[0]) * away[0] + (home.position[2] - market[1]) * away[1]) / length);
  const d = Math.min(220, Math.max(40, far * reach));
  return [market[0] + away[0] / length * d, market[1] + away[1] / length * d];
}

/** The market square's frame: its half width and depth, and a point in it by (across, along toward the castle). */
function squareFrame(plan: SettlementPlan, market: XZ, toward: CardinalTurn) {
  const xs = plan.market.boundary.map(p => p[0]), zs = plan.market.boundary.map(p => p[1]);
  const hx = (Math.max(...xs) - Math.min(...xs)) / 2, hz = (Math.max(...zs) - Math.min(...zs)) / 2;
  const [width, depth] = toward % 2 ? [hz, hx] : [hx, hz];
  // Local +z points toward the castle; the square's far edge (toward the castle) is at -depth after the flip below.
  const at = (across: number, along: number): XZ => {
    const p = transformCardinalPoint([market[0], 0, market[1]], toward, [across, 0, -along]);
    return [p[0], p[2]];
  };
  return { width, depth, facing: ((toward + 2) % 4) as CardinalTurn, at };
}

