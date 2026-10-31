import { describe, expect, it } from 'vitest';
import { BEAT_SPACING, CAMPFIRE_ENVELOPE, CROWN_ROAD, DRESSING_FOOTPRINT, foundKingdomRoutes, OAK_ROOT_CLEARANCE, TRAIL_WIDTH,
  transformCardinalPoint, waterKeepOut, type KingdomRoutes, type StreetEdge } from '@chatdom/world';
import { polygonDistance, rectangleDistance } from '../../../../packages/world/src/settlement/geometry';
import { placeLandContent } from './dressing';
import { geographyFixture } from './geography-fixture';

type XZ = [number, number];
const half = TRAIL_WIDTH / 2;
/** Every metre along an edge's centreline. */
const metres = (edge: StreetEdge): XZ[] => edge.points.slice(1).flatMap((b, i) => {
  const a = edge.points[i]!, n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2])));
  return Array.from({ length: n + (i === edge.points.length - 2 ? 1 : 0) }, (_, k) => [a[0] + (b[0] - a[0]) * k / n, a[2] + (b[2] - a[2]) * k / n] as XZ);
});
const footprint = (item: KingdomRoutes['dressings'][number]): XZ[] => {
  if (item.form !== 'bench' && item.form !== 'direction-sign') return [];
  const [w, d] = DRESSING_FOOTPRINT[item.form];
  return ([[0, 0], [w, 0], [w, d], [0, d]] as const).map(([x, z]) => { const p = transformCardinalPoint(item.position, item.turn, [x, 0, z]); return [p[0], p[2]]; });
};

// SIMULATED: today's installed town re-seated on the founded land stands in for LD01's streets (geography-fixture.ts).
describe('kingdom walks', () => {
  for (const seed of ['chatdom', 'river']) it(`walks every destination on ${seed} along open, dry, gentle public ground`, () => {
    const { plan, land } = geographyFixture(seed);
    const routes = foundKingdomRoutes(land, plan);
    expect(foundKingdomRoutes(land, plan)).toEqual(routes);
    const { landform, sites, places } = land;

    // One graph: every edge joins known nodes, and every walk chains edge to edge from its start to its end.
    const known = new Set([...plan.nodes, ...routes.nodes].map(node => node.id));
    const edges = new Map([...plan.streets, ...routes.streets].map(edge => [edge.id, edge]));
    for (const edge of routes.streets) expect(known.has(edge.from) && known.has(edge.to), edge.id).toBe(true);
    const ends: Record<string, string> = { 'walk:court': land.castle.gateNodeId, 'walk:pier': 'land:pier:head', 'walk:lookout': 'land:lookout:summit',
      'walk:clearing': 'land:clearing:entry', 'walk:homeward': plan.market.nodeId };
    for (const [id, to] of Object.entries(ends)) expect(routes.paths.find(path => path.id === id)?.to, id).toBe(to);
    for (const path of routes.paths) {
      let at = path.from;
      for (const edgeId of path.edgeIds) {
        const edge = edges.get(edgeId)!;
        expect([edge.from, edge.to], `${path.id} at ${edgeId}`).toContain(at);
        at = edge.from === at ? edge.to : edge.from;
      }
      expect(at, path.id).toBe(path.to);
    }

    // Each destination reveals itself, and its next marker, where the walk says it does.
    const reveals = (id: string) => routes.paths.find(path => path.id === id)!.beats.flatMap(beat => beat.reveal ? [beat.reveal] : []);
    expect(reveals('walk:pier')).toEqual(expect.arrayContaining(['lake-reveal', 'bridge', 'pier-end']));
    expect(reveals('walk:lookout')).toContain('lookout');
    expect(reveals('walk:court')).toContain('court-wall-walk');
    expect(reveals('walk:clearing')).toEqual(expect.arrayContaining(['forest-approach', 'clearing-gap']));

    // Trails stay dry (only the bridge and pier decks cross water), off every lot and site they do not end at,
    // around the oak's roots, outside the campfire's envelope and off the lookout's plateau.
    const oak = places.forest.oak, fire = places.forest.clearing.centre, hill = landform.hills.find(item => item.id === 'lookout')!;
    for (const edge of routes.streets) {
      const decks = edge.id === 'land:bridge' || edge.id === 'land:pier';
      for (const [x, z] of metres(edge)) {
        if (!decks) expect(waterKeepOut(landform, x, z, 0), `${edge.id} wet at ${x},${z}`).toBe(false);
        for (const plot of plan.reservations) expect(rectangleDistance(plot.lot, x, z), `${edge.id} on ${plot.id}`).toBeGreaterThanOrEqual(half);
        for (const item of sites) {
          const ending = (item.id === 'water:bridge' && /bridge|millstream|shore/.test(edge.id)) || (item.id === 'water:pier' && edge.id === 'land:pier');
          if (!ending) expect(polygonDistance(item.footprint, x, z), `${edge.id} on ${item.id}`).toBeGreaterThanOrEqual(half);
        }
        expect(Math.hypot(x - oak[0], z - oak[2])).toBeGreaterThanOrEqual(OAK_ROOT_CLEARANCE + half);
        expect(Math.hypot(x - fire[0], z - fire[2])).toBeGreaterThanOrEqual(CAMPFIRE_ENVELOPE + half);
        expect(Math.hypot(x - hill.centre[0], z - hill.centre[1])).toBeGreaterThanOrEqual(hill.plateau - .5);
      }
      // One in four on earth, Crown Road's own grade on the road; rounding allows 1/32 m (1/8 m on the road).
      const grade = edge.id === 'land:crown-road' ? CROWN_ROAD.grade : .25, step = edge.id === 'land:crown-road' ? 1 / 8 : 1 / 32;
      if (!decks) for (let k = 1; k < edge.points.length; k++) {
        const a = edge.points[k - 1]!, b = edge.points[k]!, run = Math.hypot(b[0] - a[0], b[2] - a[2]);
        if (run > .5) expect(Math.abs(b[1] - a[1]) / run, `${edge.id} at ${k}`).toBeLessThanOrEqual(grade + step / run + 1e-6);
      }
    }

    // Furniture stands on dry ground off the ways and lots, never in another's footprint; the bridge is the site's.
    const seats = routes.dressings.filter(item => item.form === 'bench' || item.form === 'direction-sign');
    expect(routes.dressings.filter(item => item.form === 'footbridge')).toEqual([expect.objectContaining({ siteId: 'water:bridge' })]);
    expect(seats.filter(item => item.form === 'direction-sign').length).toBeGreaterThanOrEqual(3);
    for (const item of seats) for (const [x, z] of footprint(item)) {
      expect(waterKeepOut(landform, x, z, 1)).toBe(false);
      for (const plot of plan.reservations) expect(rectangleDistance(plot.lot, x, z)).toBeGreaterThan(0);
      for (const site of sites) expect(polygonDistance(site.footprint, x, z)).toBeGreaterThan(0);
      for (const other of seats) if (other !== item) expect(polygonDistance(footprint(other), x, z)).toBeGreaterThan(1);
    }
    for (const edge of routes.streets.filter(street => !street.id.startsWith('land:bench:')))
      for (const item of seats) for (const [x, z] of metres(edge))
        expect(polygonDistance(footprint(item), x, z), `${item.form} on ${edge.id}`).toBeGreaterThan(half);

    // Something worth meeting at least every 20 s on the land's own trails.
    if (seed === 'chatdom') for (const path of routes.paths) {
      const marks = [0, ...path.beats.map(beat => beat.at), path.length];
      expect(Math.max(...marks.slice(1).map((at, k) => at - marks[k]!)), path.id).toBeLessThanOrEqual(BEAT_SPACING);
    }

    // The adapter mounts what has a model and holds the rest: the footbridge now, bench and fingerposts pending.
    const content = placeLandContent(routes.dressings);
    expect(content.placed.map(item => item.blueprint.id)).toEqual(['civic-hearth-footbridge']);
    expect(content.placed[0]!.yaw).toBeCloseTo(routes.dressings[0]!.turn * Math.PI / 2);
    expect(content.pending).toEqual(seats);
  });
});
