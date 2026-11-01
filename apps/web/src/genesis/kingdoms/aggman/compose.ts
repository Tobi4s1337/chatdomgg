import type { Vec3 } from '@chatdom/shared';
import { terrainHeight, transformCardinalPoint, type CardinalTurn, type SettlementPlan } from '@chatdom/world';
import type { RoyalBrazier } from '../../../kingdom/royal-life';
import type { Dressing } from '../../../kingdom/settlement-content';
import type { GenesisKingdomComposition, GenesisKingdomInput } from '../../kingdom-composer';
import { createGenesisSeatContent, type GenesisSeatContent } from '../../seat-content';
import { composeGenesisEmoteArt, composeGenesisHeraldry, createQuaySegment, createRowingBoat, type GenesisEmoteArt, type GenesisHeraldry } from './content';
import { findHarbourSite, withHarbourPrecinct, type HarbourSite } from './harbour-plan';
import { CELL, place, type Placeable, type Placed } from './place';

/** Everything the harbour adds to the seat: dressing, the lamps it lights and the pieces it keeps for others to read. */
interface Precinct { props: Dressing[]; braziers: RoyalBrazier[] }

const SEA_TURN: CardinalTurn = 2;

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
    out.props.push({ blueprint: piece.blueprint, position: [segment.east, piece.base * CELL, edge], yaw: SEA_TURN * Math.PI / 2 });
  }
}

const add = (out: Precinct, placed: Placed) => { out.props.push(placed.dressing); out.braziers.push(...placed.braziers); };

/** The kingdom's colours: the heraldic standard at the market's seaward edge and the carved crest over the quay. */
function raiseColours(plan: SettlementPlan, site: HarbourSite, heraldry: GenesisHeraldry, out: Precinct): void {
  const standard: Placeable = { blueprint: heraldry.standard.blueprint, lanterns: heraldry.standard.lanterns.map(l => l.position), footprint: { from: [0, 0], to: [heraldry.standard.blueprint.size[0], heraldry.standard.blueprint.size[2]] } };
  const crest: Placeable = { blueprint: heraldry.crest.blueprint, lanterns: heraldry.crest.lanterns.map(l => l.position), footprint: { from: [0, 0], to: [heraldry.crest.blueprint.size[0], heraldry.crest.blueprint.size[2]] } };
  add(out, place(plan, standard, site.market[0] - 8, Math.min(...plan.market.boundary.map(p => p[1])) + 2.5, SEA_TURN));
  add(out, place(plan, crest, site.market[0] + 11, site.quay.z + site.quay.halfDepth - 2, SEA_TURN, { level: site.quay.level }));
}

/** Boats on the water: tied along the pier and riding in the lee of the quay. */
function moorBoats(plan: SettlementPlan, site: HarbourSite, out: Precinct): void {
  const rowing = (variant: 0 | 1 | 2): Placeable => {
    const piece = createRowingBoat('tide', variant);
    return { blueprint: piece.blueprint, lanterns: [], footprint: { from: [0, 0], to: [piece.blueprint.size[0], piece.blueprint.size[2]] }, draft: 2 };
  };
  const x = site.market[0];
  add(out, place(plan, rowing(0), x - 3.2, site.shoreZ - 6, 2));
  add(out, place(plan, rowing(2), x + 3.4, site.shoreZ - 10, 0));
}

/**
 * The channel's approved statue, when one exists, stands on the quay east of the stair head, facing the town. With no
 * approved derivative the site stays open paving: no generic statue ever stands in for a channel emote.
 */
function raiseMonument(plan: SettlementPlan, site: HarbourSite, art: GenesisEmoteArt, out: Precinct): void {
  const monument = art.monument;
  if (!monument) return;
  const piece: Placeable = { blueprint: monument.frames[0]!.blueprint, lanterns: monument.lanterns.map(l => l.position), footprint: { from: [0, 0], to: monument.footprint } };
  add(out, place(plan, piece, site.market[0] + 6, site.quay.z - 1, 0, { level: site.quay.level }));
}

export function composeAggman({ recipe, landscape, plan: proposed, emoteDerivatives = [] }: GenesisKingdomInput): GenesisKingdomComposition {
  const site = findHarbourSite(proposed);
  const plan = withHarbourPrecinct(proposed, site);
  const seat = createGenesisSeatContent(recipe, landscape, plan);
  if (!seat) throw new Error('The_AGGman\'s watchtower keep could not stand on its accepted parcel.');
  const heraldry = composeGenesisHeraldry(recipe, landscape);
  const out: Precinct = { props: [], braziers: [] };
  layQuay(plan, site, out);
  raiseColours(plan, site, heraldry, out);
  moorBoats(plan, site, out);
  raiseMonument(plan, site, composeGenesisEmoteArt(recipe, landscape, emoteDerivatives), out);
  const composed: GenesisSeatContent = {
    buildings: seat.buildings,
    props: [...seat.props, ...out.props],
    braziers: [...seat.braziers, ...out.braziers],
    beaconPosition: seat.beaconPosition,
  };
  return { plan, seat: composed, camera: heroCamera(site) };
}

/**
 * From the water east of the harbour, looking north-west across the quay: boats and the inn in front, the
 * hamlet climbing its slope, and the watchtower keep on the rise against the dusk sky.
 */
function heroCamera(site: HarbourSite): { eye: Vec3; target: Vec3; fov: number } {
  const [x] = site.market;
  const eye = transformCardinalPoint([x, 0, site.shoreZ], 0, [44, 19, -28]);
  const target: Vec3 = [x - 6, site.quay.level + 7, site.quay.z + 34];
  return { eye, target, fov: 46 };
}
