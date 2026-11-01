import type { Vec3 } from '@chatdom/shared';
import { terrainHeight, transformCardinalPoint, type CardinalTurn, type SettlementPlan } from '@chatdom/world';
import { sampleGenesisSurface, type ChannelKingdomRecipe, type DeepReadonly, type GenesisLandscape } from '@chatdom/world/genesis';
import type { RoyalBrazier } from '../../../kingdom/royal-life';
import type { Dressing } from '../../../kingdom/settlement-content';
import { createGenesisSeatContent, type GenesisSeatContent } from '../../seat-content';
import {
  AGGMAN_LIVERY, HARBOUR_INN_FRONT, composeGenesisEmoteArt, composeGenesisHeraldry, createBuntingRun, createDrawnUpBoat, createFishCrates,
  createFishStall, createGaggle, createGoose, createGooseFamily, createHarbourCoble, createHarbourInn, createHarbourLantern, createHarbourPennant,
  createLastLantern, createMooringBollard, createNetRack, createPotStack, createQuayBanner, createQuaySegment, createRowingBoat, createShingleStrand, createSlipwayCapstan,
  keeperRole, planKeeperRound, proposeGenesisKeepers,
  type AggmanPiece, type GenesisEmoteArt, type GenesisHeraldry, type KeeperFixture, type KeeperPlaceSite, type KeeperProposal, type KeeperRound,
} from './content';
import { findHarbourSite, withHarbourPrecinct, type HarbourSite } from './harbour-plan';
import { CELL, place, type Placeable, type Placed } from './place';

/** The realm hour the hamlet opens at: the sun low over the sea to the south-west, the lamps just lit. */
export const AGGMAN_HOUR = 19.6;
/** The channel's own line, from its public description. */
export const AGGMAN_LORE = 'At the harbour’s last lantern, there is always room for one more wanderer.';

/** A keeper of the recipe at the place the hamlet built for them, with their round at the opening hour. */
export interface PlacedKeeper {
  readonly proposal: KeeperProposal;
  readonly site: KeeperPlaceSite;
  readonly round: KeeperRound;
}

/** The_AGGman as composed: the town, the seat and harbour, how it is first seen and what main's mounts read. */
export interface AggmanKingdom {
  readonly plan: SettlementPlan;
  readonly seat: GenesisSeatContent;
  readonly camera: { readonly eye: Vec3; readonly target: Vec3; readonly fov: number };
  readonly hour: number;
  readonly lore: string;
  readonly keepers: readonly PlacedKeeper[];
  /** For the kingdom's audio host (`createGenesisSoundscape(host, sound)`): the coastal soundscape of this land. */
  readonly sound: { readonly recipe: DeepReadonly<ChannelKingdomRecipe>; readonly landscapeId: string };
  readonly emoteArt: GenesisEmoteArt;
  readonly heraldry: GenesisHeraldry;
  readonly site: HarbourSite;
}

/** Everything the harbour adds to the seat, and the fixtures its keepers work at. */
interface Precinct {
  props: Dressing[];
  braziers: RoyalBrazier[];
  lamps: KeeperFixture[];
  door?: KeeperFixture;
}

/** The sea lies south: a piece's front (+Z) turned two quarter turns looks out to sea. */
const SEA: CardinalTurn = 2, LAND: CardinalTurn = 0, EAST: CardinalTurn = 1, WEST: CardinalTurn = 3;
const facingOf = (turn: CardinalTurn) => turn * Math.PI / 2;

const placeable = (piece: AggmanPiece): Placeable => ({ blueprint: piece.blueprint, lanterns: piece.lanterns, footprint: piece.footprint, ...(piece.draft !== undefined ? { draft: piece.draft } : {}) });

function add(out: Precinct, placed: Placed, lamp?: { id: string; turn: CardinalTurn; level: number }): void {
  out.props.push(placed.dressing);
  out.braziers.push(...placed.braziers);
  if (lamp) placed.braziers.forEach((brazier, i) => out.lamps.push({ id: `${lamp.id}${placed.braziers.length > 1 ? `:${i}` : ''}`, kind: 'lamp',
    position: [brazier.position[0], lamp.level, brazier.position[2]], facing: facingOf(lamp.turn) }));
}

/** A piece's local cell (x, y, z) in the world, for a piece already placed with its origin and turn. */
const at = (placed: Placed, turn: CardinalTurn, cell: readonly [number, number, number]): Vec3 =>
  transformCardinalPoint(placed.dressing.position, turn, [cell[0] * CELL, cell[1] * CELL, cell[2] * CELL]);

/**
 * The stone quay along the shore, in three segments (one blueprint is at most 32 m): its top is flush with the
 * graded quay and its face stands down to the shingle and the bed the land sampler reports. Stairs cut down to the
 * pier deck on the lane's axis; a slip at the east end ramps into the water for the boats.
 */
function layQuay(plan: SettlementPlan, site: HarbourSite, out: Precinct): void {
  const { quay, market } = site;
  const edge = quay.z - quay.halfDepth, depth = 68, top = Math.round(quay.level / CELL);
  const segments: { east: number; west: number; stair?: [number, number]; slip?: [number, number] }[] = [
    { east: quay.maxX, west: market[0] + 7, slip: [quay.maxX - 8, quay.maxX - 4] },
    { east: market[0] + 7, west: market[0] - 9, stair: [market[0] + 1.5, market[0] - 1.5] },
    { east: market[0] - 9, west: quay.minX },
  ];
  for (const [index, segment] of segments.entries()) {
    const length = Math.round((segment.east - segment.west) / CELL);
    const local = (x: number) => Math.round((segment.east - x) / CELL);
    const piece = createQuaySegment({
      id: `${index}`, length, depth, top, water: 0,
      ground: (x, z) => terrainHeight(plan, segment.east - x * CELL, edge - z * CELL) / CELL,
      ...(segment.stair ? { stair: { from: local(segment.stair[0]), to: local(segment.stair[1]), landing: Math.round(.7 / CELL) } } : {}),
      ...(segment.slip ? { slip: { from: local(segment.slip[0]), to: local(segment.slip[1]) } } : {}),
    });
    out.props.push({ blueprint: piece.blueprint, position: [segment.east, piece.base * CELL, edge], yaw: facingOf(SEA) });
  }
}

/** World z of the waterline at world x: the first ocean sample walking seaward from above the harbour's shore. */
function waterlineAt(plan: SettlementPlan, site: HarbourSite, x: number): number {
  for (let z = site.shoreZ + 20; z > site.shoreZ - 20; z -= .25) if (sampleGenesisSurface(plan.genesisSurface!, x, z).water === 'ocean') return z;
  throw new Error(`No waterline at x ${x} within reach of the harbour.`);
}

/** The shingle runs along the waterline from here to here (world x), in pieces of at most 32 m. */
const STRAND = { west: 14, east: 112, piece: 24.5, reach: 7 } as const;

/**
 * The beach the harbour works from: a strand of pale shingle along the waterline either side of the quay and at
 * its foot, so the boats are drawn up on stones and the turf meets the sea through a beach, not at a seam. The
 * quay's paving, its slip and the Last Lantern's base stay bare.
 */
function layShingle(plan: SettlementPlan, site: HarbourSite, light: readonly Vec3[], out: Precinct): void {
  const land = plan.genesisSurface!;
  const coping = site.quay.z - site.quay.halfDepth - 68 * CELL;
  const slip = { minX: site.quay.maxX - 8.5, maxX: site.quay.maxX - 3.5 };
  const lightBox = { minX: Math.min(...light.map(c => c[0])) - .4, maxX: Math.max(...light.map(c => c[0])) + .4, minZ: Math.min(...light.map(c => c[2])) - .4, maxZ: Math.max(...light.map(c => c[2])) + .4 };
  const bare = (x: number, z: number) => (x >= site.quay.minX - .2 && x <= site.quay.maxX + .2 && z >= coping - .3)
    || (x >= slip.minX && x <= slip.maxX && z >= coping - 6)
    || (x >= lightBox.minX && x <= lightBox.maxX && z >= lightBox.minZ && z <= lightBox.maxZ);
  for (let west = STRAND.west, i = 0; west < STRAND.east; west += STRAND.piece, i++) {
    const east = Math.min(STRAND.east, west + STRAND.piece);
    // The waterline wanders: span the strand from the furthest water to the highest reach along this piece.
    let wet = Infinity, dry = -Infinity;
    for (let x = west; x <= east; x += 1) {
      const z = waterlineAt(plan, site, x);
      wet = Math.min(wet, z - 3.2); dry = Math.max(dry, z + STRAND.reach * 1.3);
    }
    const length = Math.round((east - west) / CELL), depth = Math.min(256, Math.ceil((dry - wet) / CELL));
    const world = (x: number, z: number): readonly [number, number] => [west + x * CELL, wet + z * CELL];
    const strand = createShingleStrand({
      id: `${i}`, length, depth, water: 0, reach: STRAND.reach / CELL,
      ground: (x, z) => { const [wx, wz] = world(x, z); return terrainHeight(plan, wx, wz) / CELL; },
      shore: (x, z) => { const [wx, wz] = world(x, z); return sampleGenesisSurface(land, wx, wz).shoreDistance / CELL; },
      clear: (x, z) => { const [wx, wz] = world(x, z); return bare(wx, wz); },
    });
    out.props.push({ blueprint: strand.blueprint, position: [west, strand.base * CELL, wet], yaw: 0 });
  }
}

/**
 * The Wren and Willow on its level pad west of the lane foot, its front on the quay and its back kitchen cut into
 * the slope. Its door is Rowan's fixture; its lanterns burn as the house's own fire, never as people.
 */
function raiseInn(site: HarbourSite, out: Precinct): void {
  const inn = createHarbourInn(AGGMAN_LIVERY);
  const { innPad } = site;
  // Turned to the sea, local x runs west from the pad's east edge and local z south from its back edge.
  const origin: Vec3 = [innPad.maxX, innPad.level, innPad.maxZ];
  const world = (cell: readonly [number, number, number]) => transformCardinalPoint(origin, SEA, [(cell[0] + .5) * CELL, (cell[1] + .5) * CELL, (cell[2] + .5) * CELL]);
  out.props.push({ blueprint: inn.blueprint, position: origin, yaw: facingOf(SEA) });
  for (const lantern of inn.lanterns) out.braziers.push({ position: world(lantern), normal: [0, 1, 0] });
  const door = world(HARBOUR_INN_FRONT.door.approach);
  out.door = { id: 'wren-and-willow:door', kind: 'door', position: [door[0], innPad.level, door[2]], facing: facingOf(SEA) };
}

/**
 * The Last Lantern at the quay's west end, its lancet turned to the sea and lit from within; the channel's window
 * fills the lancet and its vane turns on the finial. Lamps: the lantern room and the brazier behind the glass.
 */
function raiseLight(plan: SettlementPlan, site: HarbourSite, art: GenesisEmoteArt, out: Precinct): readonly Vec3[] {
  const light = createLastLantern(art.glass);
  const apron = site.quay.z - site.quay.halfDepth - 68 * CELL;
  const [w, , d] = light.blueprint.size;
  const placed = place(plan, placeable(light), site.quay.minX + w * CELL / 2 + .75, apron + d * CELL / 2 + .35, SEA, { level: site.quay.level });
  add(out, placed);
  out.props.push({ blueprint: art.glass.blueprint, position: at(placed, SEA, light.glassAt), yaw: facingOf(SEA) });
  const vane = art.vane;
  if (vane) {
    const mount = at(placed, SEA, light.vaneAt);
    const mast = [mount[0] - vane.mount[0] * CELL, mount[1] - vane.mount[1] * CELL, mount[2] - vane.mount[2] * CELL] as Vec3;
    out.props.push({ blueprint: vane.mast, position: mast, yaw: 0 });
    const pivot: Vec3 = [mast[0] + vane.mastPivot[0] * CELL, mast[1] + vane.mastPivot[1] * CELL, mast[2] + vane.mastPivot[2] * CELL];
    // The rotor rests turned a quarter: the sea wind off the water shows the goose broadside to the harbour.
    const rest = transformCardinalPoint([0, 0, 0], EAST, [vane.rotorPivot[0] * CELL, vane.rotorPivot[1] * CELL, vane.rotorPivot[2] * CELL]);
    out.props.push({ blueprint: vane.rotor, position: [pivot[0] - rest[0], pivot[1] - rest[1], pivot[2] - rest[2]], yaw: facingOf(EAST) });
  }
  return placed.corners;
}

/**
 * The working quay: bollards along the coping, lanterns at the stair head, the fish stall and the catch by the lane
 * mouth, nets and pots drying on the apron, the capstan at the slip head. The lamps are Brindle's round.
 */
function workQuay(plan: SettlementPlan, site: HarbourSite, out: Precinct): void {
  const level = site.quay.level, x = site.market[0];
  const edge = site.quay.z - site.quay.halfDepth, coping = edge - 68 * CELL;
  const on = (piece: AggmanPiece, px: number, pz: number, turn: CardinalTurn) => place(plan, placeable(piece), px, pz, turn, { level });
  // Bollards a stride in from the coping, clear of the stair, the statue and the slip.
  add(out, on(createMooringBollard(0), x - 10.5, coping + 1.2, SEA));
  add(out, on(createMooringBollard(1), x - 6, coping + 1.2, SEA));
  add(out, on(createMooringBollard(0), site.quay.maxX - 2, coping + 1.4, SEA));
  // Two lanterns at the stair head, the first lamps a boat sees.
  add(out, on(createHarbourLantern(AGGMAN_LIVERY), x - 3.4, coping + .9, SEA), { id: 'quay:stair-lantern:west', turn: SEA, level });
  add(out, on(createHarbourLantern(AGGMAN_LIVERY), x + 3.4, coping + .9, SEA), { id: 'quay:stair-lantern:east', turn: SEA, level });
  // The apron's gear: a pot stack by the west bollards, nets on their rack near the light.
  add(out, on(createPotStack(AGGMAN_LIVERY, 1), x - 8.5, edge - 2.2, SEA));
  add(out, on(createNetRack(AGGMAN_LIVERY), site.quay.minX + 3.6, edge + 2.4, SEA));
  // By the lane mouth: the fish stall and its crates under the bunting, the capstan at the slip head.
  add(out, on(createFishStall(AGGMAN_LIVERY), x + 9.5, site.quay.z + 2.2, SEA), { id: 'quay:fish-stall', turn: SEA, level });
  add(out, on(createFishCrates(AGGMAN_LIVERY), x + 14.6, site.quay.z + 2.6, SEA));
  add(out, on(createPotStack(AGGMAN_LIVERY, 0), x + 21.2, site.quay.z - .6, SEA));
  add(out, on(createSlipwayCapstan(), site.quay.maxX - 6, edge + 2.1, SEA));
}

/**
 * The kingdom's colours, red, gold and cream under its blue roofs: the founding standard and the carved crest at
 * the head of Harbour Lane, bunting across the lane and along the quay, banners at the lane mouth and the harbour
 * pennants streaming in the sea wind.
 */
function raiseColours(plan: SettlementPlan, site: HarbourSite, heraldry: GenesisHeraldry, out: Precinct): void {
  const arms = heraldry.standard.arms, level = site.quay.level, x = site.market[0];
  const marketEdge = Math.min(...plan.market.boundary.map(p => p[1]));
  const standard: Placeable = { blueprint: heraldry.standard.blueprint, lanterns: heraldry.standard.lanterns.map(l => l.position), footprint: { from: [0, 0], to: [heraldry.standard.blueprint.size[0], heraldry.standard.blueprint.size[2]] } };
  const crest: Placeable = { blueprint: heraldry.crest.blueprint, lanterns: heraldry.crest.lanterns.map(l => l.position), footprint: { from: [0, 0], to: [heraldry.crest.blueprint.size[0], heraldry.crest.blueprint.size[2]] } };
  add(out, place(plan, standard, x - 8, marketEdge + 2.5, SEA));
  add(out, place(plan, crest, x + 8, marketEdge + 2.2, SEA));
  // Bunting across Harbour Lane halfway down, and along the quay's landward edge east of the lane.
  add(out, place(plan, placeable(createBuntingRun(AGGMAN_LIVERY, 72, 10)), x, (marketEdge + site.quay.z + site.quay.halfDepth) / 2, SEA));
  add(out, place(plan, placeable(createBuntingRun(AGGMAN_LIVERY, 128, 12)), x + 13.5, site.quay.z + site.quay.halfDepth - .5, SEA, { level }));
  // Banners either side of the lane mouth, each lit from both sides.
  add(out, place(plan, placeable(createQuayBanner(AGGMAN_LIVERY, arms)), x - 3.6, site.quay.z + 3.3, SEA, { level }), { id: 'quay:banner:west', turn: SEA, level });
  add(out, place(plan, placeable(createQuayBanner(AGGMAN_LIVERY, arms)), x + 3.6, site.quay.z + 3.3, SEA, { level }), { id: 'quay:banner:east', turn: SEA, level });
  // Pennants at both ends of the quay, streaming west on the same wind.
  add(out, place(plan, placeable(createHarbourPennant(AGGMAN_LIVERY, arms, 0)), site.quay.maxX - .9, site.quay.z - 2.2, SEA, { level }), { id: 'quay:pennant:east', turn: SEA, level });
  add(out, place(plan, placeable(createHarbourPennant(AGGMAN_LIVERY, arms, 0)), site.innPad.minX - 2.6, site.innPad.minZ - .4, SEA), { id: 'quay:pennant:west', turn: SEA, level });
}

/**
 * The channel's approved statue on the quay apron east of the stair head, facing the sea it greets. With no
 * approved derivative the site stays open paving: no generic statue ever stands in for a channel emote.
 */
function raiseMonument(plan: SettlementPlan, site: HarbourSite, art: GenesisEmoteArt, out: Precinct): void {
  const monument = art.monument;
  if (!monument) return;
  const piece: Placeable = { blueprint: monument.frames[0]!.blueprint, lanterns: monument.lanterns.map(l => l.position), footprint: { from: [0, 0], to: monument.footprint } };
  const apron = site.quay.z - site.quay.halfDepth;
  add(out, place(plan, piece, site.market[0] + 8.6, apron - monument.footprint[1] * CELL / 2 - .9, SEA, { level: site.quay.level }), { id: 'quay:statue', turn: SEA, level: site.quay.level });
}

/** Boats: one coble running in under sail, one lying furled beside the pier, rowing boats at the pier root, and three drawn up on the shingle. */
function harbourBoats(plan: SettlementPlan, site: HarbourSite, out: Precinct): void {
  const x = site.market[0];
  const rowing = (variant: 0 | 1 | 2): Placeable => {
    const piece = createRowingBoat('tide', variant);
    return { blueprint: piece.blueprint, lanterns: [], footprint: { from: [0, 0], to: [piece.blueprint.size[0], piece.blueprint.size[2]] }, draft: 2 };
  };
  add(out, place(plan, placeable(createHarbourCoble(AGGMAN_LIVERY, 1)), x - 3.7, site.shoreZ - 11.5, SEA));
  add(out, place(plan, placeable(createHarbourCoble(AGGMAN_LIVERY, 0)), x + 12, site.shoreZ - 19, LAND));
  add(out, place(plan, rowing(0), x - 3.4, site.shoreZ - 4.6, SEA));
  add(out, place(plan, rowing(2), x + 3.6, site.shoreZ - 8, LAND));
  // Drawn up on the shingle above the wrack line, four to six metres up from the water where each one lies: two on
  // the west strand, one on the east.
  const hauled = (x: number, above: number) => waterlineAt(plan, site, x) + above;
  add(out, place(plan, placeable(createDrawnUpBoat(AGGMAN_LIVERY, 0)), site.quay.minX - 7.5, hauled(site.quay.minX - 7.5, 4.4), SEA));
  add(out, place(plan, placeable(createDrawnUpBoat(AGGMAN_LIVERY, 1)), site.quay.minX - 12.2, hauled(site.quay.minX - 12.2, 5.8), SEA));
  add(out, place(plan, placeable(createDrawnUpBoat(AGGMAN_LIVERY, 2)), site.quay.maxX + 5.5, Math.min(site.quay.z - 5.6, hauled(site.quay.maxX + 5.5, 4.6)), WEST));
}

/** The hamlet's geese: a gaggle on the green by the inn, one on the shingle, a family down the lane, three swimming by the pier and one honking at the stair. */
function setGeese(plan: SettlementPlan, site: HarbourSite, out: Precinct): void {
  const x = site.market[0], level = site.quay.level;
  add(out, place(plan, placeable(createGaggle('green')), site.innPad.minX - 6.5, site.innPad.minZ + 7, EAST));
  add(out, place(plan, placeable(createGaggle('shingle')), site.quay.minX - 2.5, site.shoreZ - .2, SEA));
  add(out, place(plan, placeable(createGooseFamily(1)), x + 1.2, site.innPad.maxZ + 11, SEA));
  add(out, place(plan, placeable(createGoose('honking', 1)), x - 2.6, site.quay.z - site.quay.halfDepth - 1.6, EAST, { level }));
  for (const [i, [dx, dz]] of ([[7.2, -5.5], [8.6, -6.8], [6.1, -7.6]] as const).entries())
    add(out, place(plan, placeable(createGoose('swimming', (i % 3) as 0 | 1 | 2)), x + dx, site.shoreZ + dz, WEST));
}

/** Rowan keeps The Wren and Willow from its door; Brindle's lamp round is the quay's lanterns. */
function placeKeepers(recipe: DeepReadonly<ChannelKingdomRecipe>, landscape: DeepReadonly<GenesisLandscape>, site: HarbourSite, out: Precinct, hour: number): PlacedKeeper[] {
  const placed: PlacedKeeper[] = [];
  for (const proposal of proposeGenesisKeepers(recipe, landscape)) {
    let centre: readonly [number, number], fixtures: readonly KeeperFixture[];
    if (proposal.keeper.role === 'innkeeper' && out.door) { centre = [out.door.position[0], out.door.position[2]]; fixtures = [out.door]; }
    else if (proposal.keeper.role === 'lamplighter') { centre = [site.market[0], site.quay.z - 2]; fixtures = out.lamps; }
    else continue;
    const site_: KeeperPlaceSite = { placeId: proposal.place.id, centre, radius: proposal.routine.radius, fixtures, provenance: 'host' };
    placed.push({ proposal, site: site_, round: planKeeperRound(keeperRole(proposal.keeper.role), site_, hour, proposal.speaker.seedKey) });
  }
  return placed;
}

/**
 * The_AGGman's coastal hamlet on its own land: sixteen homes on the south-facing slope, the watchtower keep on the
 * rise, and the harbour this hamlet is: Harbour Lane down to a stone quay, The Wren and Willow, the Last Lantern
 * with the channel's window, the goose statue, the boats, the gear and the geese, in the channel's red and gold.
 * `recipe` must carry the approved emote works the `derivatives` answer; with none, every emote site stays open.
 */
export function composeAggman(recipe: DeepReadonly<ChannelKingdomRecipe>, landscape: DeepReadonly<GenesisLandscape>, proposed: SettlementPlan, derivatives: readonly unknown[]): AggmanKingdom {
  const site = findHarbourSite(proposed);
  const plan = withHarbourPrecinct(proposed, site);
  const seat = createGenesisSeatContent(recipe, landscape, plan);
  if (!seat) throw new Error('The_AGGman\'s watchtower keep could not stand on its accepted parcel.');
  const heraldry = composeGenesisHeraldry(recipe, landscape);
  const emoteArt = composeGenesisEmoteArt(recipe, landscape, derivatives);
  const out: Precinct = { props: [], braziers: [], lamps: [] };
  layQuay(plan, site, out);
  raiseInn(site, out);
  const light = raiseLight(plan, site, emoteArt, out);
  layShingle(plan, site, light, out);
  workQuay(plan, site, out);
  raiseColours(plan, site, heraldry, out);
  raiseMonument(plan, site, emoteArt, out);
  harbourBoats(plan, site, out);
  setGeese(plan, site, out);
  const keepers = placeKeepers(recipe, landscape, site, out, AGGMAN_HOUR);
  const composed: GenesisSeatContent = {
    buildings: seat.buildings,
    props: [...seat.props, ...out.props],
    braziers: [...seat.braziers, ...out.braziers],
    beaconPosition: seat.beaconPosition,
  };
  return { plan, seat: composed, camera: heroCamera(site), hour: AGGMAN_HOUR, lore: AGGMAN_LORE, keepers,
    sound: { recipe, landscapeId: landscape.id }, emoteArt, heraldry, site };
}

/**
 * From the water south-east of the harbour, on a long lens over the boats: the coble running in and the one moored
 * at the pier, the quay's dressing and the goose statue close enough that each piece reads, the Last Lantern and
 * the inn behind, the hamlet climbing its slope, and the watchtower keep on the rise against the dusk sky.
 */
function heroCamera(site: HarbourSite): { eye: Vec3; target: Vec3; fov: number } {
  const [x] = site.market;
  const eye: Vec3 = [x + 47, 22, site.shoreZ - 47.25];
  const target: Vec3 = [x - 7, site.quay.level + 3, site.quay.z + 13.25];
  return { eye, target, fov: 38 };
}
