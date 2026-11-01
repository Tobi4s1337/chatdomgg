import type { Vec3 } from '@chatdom/shared';
import type { SettlementPlan, StreetEdge } from '@chatdom/world';
import { sampleGenesisSurface } from '@chatdom/world/genesis';

type Node = SettlementPlan['nodes'][number];

/** Where the harbour precinct sits, derived from the proposed settlement and the sampled coast. */
export interface HarbourSite {
  /** The market's node: Harbour Lane leaves its seaward edge. */
  readonly market: Vec3;
  /** World z of the first ocean sample straight down the lane. The sea lies towards -z (south). */
  readonly shoreZ: number;
  /** The quay's paved centreline, its level and half-depth. */
  readonly quay: { readonly z: number; readonly level: number; readonly halfDepth: number; readonly minX: number; readonly maxX: number };
  /** The inn's level pad on the quay's landward edge, west of the lane. */
  readonly innPad: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number; readonly level: number };
}

const QUAY_INLAND = 15.5, QUAY_HALF_DEPTH = 4.5, QUAY_WEST = 21, QUAY_EAST = 23;
const INN = { width: 14.5, depth: 11.5, west: 5.75 };

/** The coast is south of this hamlet: walk down from the market until the ocean sampler says sea. */
export function findHarbourSite(plan: SettlementPlan): HarbourSite {
  const land = plan.genesisSurface;
  if (!land || land.character !== 'coastal-harbour' || land.coast.oceanToward !== 2) throw new Error('The harbour composition needs the south-facing coastal harbour land.');
  const node = plan.nodes.find(item => item.id === plan.market.nodeId);
  if (!node) throw new Error('The proposed settlement has no market node.');
  const market = node.position;
  let shoreZ = NaN;
  for (let z = market[2]; z > market[2] - 120; z -= .25) if (sampleGenesisSurface(land, market[0], z).water === 'ocean') { shoreZ = z; break; }
  if (!Number.isFinite(shoreZ)) throw new Error('No shore within reach of the market.');
  const z = shoreZ + QUAY_INLAND;
  const level = Math.round(sampleGenesisSurface(land, market[0], z).ground * 4) / 4;
  const quay = { z, level, halfDepth: QUAY_HALF_DEPTH, minX: market[0] - QUAY_WEST, maxX: market[0] + QUAY_EAST };
  const innPad = { maxX: market[0] - INN.west, minX: market[0] - INN.west - INN.width, minZ: z + QUAY_HALF_DEPTH, maxZ: z + QUAY_HALF_DEPTH + INN.depth, level };
  return { market, shoreZ, quay, innPad };
}

const line = (from: Vec3, to: Vec3, step = 1): Vec3[] => {
  const length = Math.hypot(to[0] - from[0], to[2] - from[2]), count = Math.max(1, Math.ceil(length / step));
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count, ease = t * t * (3 - 2 * t);
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * ease, from[2] + (to[2] - from[2]) * t] as Vec3;
  });
};

/**
 * The proposed settlement plus the harbour precinct this hamlet is named for: Harbour Lane from the market's
 * seaward edge down to a paved quay along the shore, the quay itself, and the inn's level pad. These are public
 * ground only (streets graded by the shared settlement sampler), never homes, plots or people; every existing id,
 * home and street is kept exactly as proposed.
 */
export function withHarbourPrecinct(plan: SettlementPlan, site: HarbourSite = findHarbourSite(plan)): SettlementPlan {
  const { market, quay, innPad } = site;
  const marketEdge = Math.min(...plan.market.boundary.map(point => point[1]));
  const head: Vec3 = [market[0], plan.market.elevation, marketEdge];
  const foot: Vec3 = [market[0], quay.level, quay.z + quay.halfDepth];
  const nodes: Node[] = [
    { id: 'aggman:harbour-lane:foot', kind: 'junction', position: [market[0], quay.level, quay.z] },
    { id: 'aggman:quay:west', kind: 'frontier', position: [quay.minX, quay.level, quay.z] },
    { id: 'aggman:quay:east', kind: 'frontier', position: [quay.maxX, quay.level, quay.z] },
    { id: 'aggman:inn:door', kind: 'frontage', position: [(innPad.minX + innPad.maxX) / 2, quay.level, innPad.minZ] },
  ];
  const street = (id: string, kind: StreetEdge['kind'], name: string, from: string, to: string, points: Vec3[], width: number, verge: number): StreetEdge =>
    ({ id, kind, name, from, to, points, width, verge });
  const streets: StreetEdge[] = [
    street('aggman:harbour-lane', 'lane', 'Harbour Lane', plan.market.nodeId, 'aggman:harbour-lane:foot',
      [[market[0], plan.market.elevation, market[2]], ...line(head, foot), [market[0], quay.level, quay.z]], 4, .5),
    street('aggman:quay', 'main', 'The Quay', 'aggman:quay:west', 'aggman:quay:east',
      line([quay.minX, quay.level, quay.z], [quay.maxX, quay.level, quay.z]), quay.halfDepth * 2, 0),
    // The inn stands on its own level pad; the paving under it is covered by the building.
    street('aggman:inn:pad', 'approach', 'The Quay', 'aggman:inn:door', 'aggman:harbour-lane:foot',
      line([(innPad.minX + innPad.maxX) / 2, quay.level, innPad.minZ], [(innPad.minX + innPad.maxX) / 2, quay.level, innPad.maxZ + 3]), innPad.maxX - innPad.minX + 3, 0),
  ];
  return {
    ...plan,
    revision: `${plan.revision}+aggman-harbour-1`,
    nodes: [...plan.nodes, ...nodes],
    streets: [...plan.streets, ...streets],
    activeStreetIds: [...plan.activeStreetIds, ...streets.map(item => item.id)],
  };
}
