import type { Vec3 } from '@chatdom/shared';
import type { SettlementPlan, StreetEdge } from '@chatdom/world';

type StreetNode = SettlementPlan['nodes'][number];

export interface KingdomLightView { eye: Vec3; target: Vec3; fov: number }

const flat = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** The same neighbourly arrival home the kingdom scene picks for its simulated first window. */
function arrivalHome(layout: Pick<SettlementPlan, 'homes'>) {
  const houses = layout.homes.filter(home => home.tier === 'house');
  const neighbours = (home: (typeof houses)[number]) => layout.homes.filter(h => flat(h.position, home.position) < 35).length;
  return [...houses].sort((a, b) => neighbours(b) - neighbours(a)
    || Math.hypot(a.position[0], a.position[2]) - Math.hypot(b.position[0], b.position[2]))[0];
}

/** Point a short way along an edge, starting from the given end. */
function along(edge: StreetEdge, fromStart: boolean, distance: number): Vec3 {
  const points = fromStart ? edge.points : [...edge.points].reverse();
  let left = distance;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (length >= left && length > 0) {
      const t = left / length;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
    left -= length;
  }
  return [...points.at(-1)!];
}

/**
 * Evidence poses for kingdom light, deterministic for each layout and consumed only through the
 * debug `pose` seam. `street` stands at eye height on the busiest junction near the arrival home,
 * looking down its main street towards the castle. `castle` stands about 60 m out from the gatehouse
 * on the market side, with the castle in the upper third of the frame.
 */
export function kingdomLightViews(layout: SettlementPlan): Record<'street' | 'castle', KingdomLightView> {
  const active = new Set(layout.activeStreetIds);
  const streets = layout.streets.filter(street => active.has(street.id));
  const nodes = new Map(layout.nodes.map(node => [node.id, node]));
  const home = arrivalHome(layout);
  if (!home) throw new Error('Kingdom light views need at least one house');
  const castleCentre = layout.castle.centre;

  // Busy means streets meeting there and homes along them, not merely the nearest crossing.
  const busy = (node: StreetNode) => streets.filter(s => s.from === node.id || s.to === node.id).length * 6
    + layout.homes.filter(h => flat(h.position, node.position) < 30).length;
  const junctions = layout.nodes.filter(node => (node.kind === 'junction' || node.kind === 'market')
    && streets.some(s => (s.from === node.id || s.to === node.id) && s.kind === 'main'));
  if (!junctions.length) throw new Error('Kingdom light views need a junction on a main street');
  const near = junctions.filter(node => flat(node.position, home.position) < 70);
  const junction = (near.length ? near : junctions).sort((a, b) => busy(b) - busy(a)
    || flat(a.position, home.position) - flat(b.position, home.position) || a.id.localeCompare(b.id))[0]!;

  // Of the main streets leaving the junction, look down the one heading most towards the castle.
  const heading = (edge: StreetEdge) => {
    const ahead = along(edge, edge.from === junction.id, 12);
    const dx = ahead[0] - junction.position[0], dz = ahead[2] - junction.position[2], length = Math.hypot(dx, dz) || 1;
    const cx = castleCentre[0] - junction.position[0], cz = castleCentre[2] - junction.position[2], cl = Math.hypot(cx, cz) || 1;
    return (dx * cx + dz * cz) / (length * cl);
  };
  const leaving = streets.filter(s => (s.from === junction.id || s.to === junction.id) && s.kind === 'main')
    .sort((a, b) => heading(b) - heading(a) || a.id.localeCompare(b.id));
  const street = leaving[0]!;
  const ahead = along(street, street.from === junction.id, 26);
  const j = junction.position;
  const dx = ahead[0] - j[0], dz = ahead[2] - j[2], length = Math.hypot(dx, dz) || 1;
  // Step back a little so the junction itself, where people cross, is in the frame.
  const streetEye: Vec3 = [j[0] - dx / length * 3, j[1] + 1.7, j[2] - dz / length * 3];
  const streetTarget: Vec3 = [ahead[0], ahead[1] + 2.4, ahead[2]];

  const gatehouse = layout.castle.modules.find(module => module.kind === 'gatehouse');
  const gateNode = nodes.get(layout.castle.gateNodeId);
  const gate: Vec3 = gatehouse
    ? [gatehouse.position[0] + gatehouse.size[0] / 2, gatehouse.position[1], gatehouse.position[2] + gatehouse.size[2] / 2]
    : gateNode?.position ?? castleCentre;
  const market = nodes.get(layout.market.nodeId)?.position ?? j;
  const ox = market[0] - gate[0], oz = market[2] - gate[2], out = Math.hypot(ox, oz) || 1;
  const castleEye: Vec3 = [gate[0] + ox / out * 60, Math.max(market[1], gate[1] - 6) + 7, gate[2] + oz / out * 60];
  // Aim below the walls so the castle and its keep sit in the upper third.
  const castleTarget: Vec3 = [gate[0], gate[1] + 4, gate[2]];

  return {
    street: { eye: streetEye, target: streetTarget, fov: 58 },
    castle: { eye: castleEye, target: castleTarget, fov: 46 },
  };
}
