import { describe, expect, it } from 'vitest';
// The standalone Node audit is intentionally JavaScript and has no declaration file.
// @ts-expect-error standalone mjs module
import { audit, compare, diagnosticSvg } from './settlement-audit.mjs';

/** A deliberately simple, hand-assembled graph, independent of the settlement generator. */
function fixture() {
  const nodes = [{ id: 'market', position: [0, 0, 0], kind: 'market' }, { id: 'gate', position: [-20, 0, 0], kind: 'castle-gate' }];
  const streets = [{ id: 'castle-road', from: 'market', to: 'gate', points: [[0, 0, 0], [-20, 0, 0]], kind: 'main', width: 4, verge: 1, name: 'Castle' }];
  const reservations = Array.from({ length: 48 }, (_, ordinal) => {
    const x = 20 + ordinal % 12 * 20, z = 24 + Math.floor(ordinal / 12) * 40, id = `plot:2022:${ordinal}`;
    return { id, quarterYear: 2022, ordinal, street: 'Lane', streetId: `lane:${ordinal}`, courtId: 'court', approachId: `approach:${ordinal}`, position: [x, 0, z], rotation: 0,
      lot: { minX: x - 4, maxX: x + 4, minZ: z - 8, maxZ: z + 8, height: 20, depth: 16, frontage: 8 } };
  });
  for (const plot of reservations.slice(0, 12)) {
    const x = plot.position[0]!, z = plot.position[2]!, n = plot.ordinal;
    nodes.push({ id: `junction:${n}`, position: [x, 0, 0], kind: 'junction' }, { id: `front:${n}`, position: [x, 0, z + 8], kind: 'frontage' });
    streets.push({ id: `lane:${n}`, from: n === 0 ? 'market' : `junction:${n - 1}`, to: `junction:${n}`, points: [[n === 0 ? 0 : x - 20, 0, 0], [x, 0, 0]], kind: 'lane', width: 4, verge: 1, name: 'Lane' });
    // The approach curves around the side of its own lot before reaching its front.
    streets.push({ id: plot.approachId, from: `junction:${n}`, to: `front:${n}`, points: [[x, 0, 0], [x, 0, 10], [x + 6, 0, 10], [x + 6, 0, z + 10], [x, 0, z + 10], [x, 0, z + 8]], kind: 'approach', width: 2, verge: 0, name: 'Lane' });
  }
  const square = { id: 'market-square', nodeId: 'market', elevation: 0, boundary: [[-4, -4], [4, -4], [4, 4], [-4, 4]] };
  const lake = { x: -200, z: -200, radiusX: 10, radiusZ: 10, level: 0 };
  return { config: { seed: 'test', tier: 'hamlet', firstYear: 2022, year: 2022 }, nodes, streets, reservations,
    homes: reservations.slice(0, 12), activeStreetIds: streets.map(edge => edge.id), market: square, courts: [],
    castle: { gateNodeId: 'gate', bounds: { minX: -40, maxX: -24, minZ: -20, maxZ: -4 }, court: square },
    landform: { lake }, lake, bounds: { minX: -48, maxX: 256, minZ: -32, maxZ: 192 } };
}

describe('settlement geometry audit', () => {
  it('accepts a connected, disjoint synthetic plan', () => {
    expect(audit(fixture()).failures).toEqual([]);
  });
  it('detects an inactive connection to an active frontage', () => {
    const plan = fixture();
    plan.activeStreetIds = plan.activeStreetIds.filter(id => id !== 'lane:0');
    expect(audit(plan).failures).toContainEqual(expect.objectContaining({ check: 'active home unreachable', detail: 'plot:2022:0' }));
  });
  it('detects altered older reservations on append', () => {
    const old = fixture(), appended = structuredClone(old);
    appended.reservations[0]!.lot.minX += 1;
    expect(compare(old, appended)).toContainEqual(expect.objectContaining({ check: 'older reservations changed or missing', detail: 'plot:2022:0' }));
  });
  it('detects overlapping full reservations', () => {
    const plan = fixture();
    plan.reservations[1]!.lot = { ...plan.reservations[0]!.lot };
    plan.reservations[1]!.position = [...plan.reservations[0]!.position];
    expect(audit(plan).failures).toContainEqual(expect.objectContaining({ check: 'overlapping reservations', detail: ['plot:2022:1', 'plot:2022:0'] }));
  });
  it('rejects an approach crossing its own full reservation', () => {
    const plan = fixture();
    plan.streets.find(edge => edge.id === 'approach:0')!.points = [[20, 0, 0], [20, 0, 32]];
    expect(audit(plan).failures).toContainEqual(expect.objectContaining({ check: 'street centreline intersects reservation', detail: expect.objectContaining({ plot: 'plot:2022:0', edge: 'approach:0' }) }));
  });
  it('detects a market overlapping a lot along coincident edges, but permits boundary contact', () => {
    const plan = fixture();
    plan.market.boundary = [[16, 24], [24, 24], [24, 32], [16, 32]];
    expect(audit(plan).failures).toContainEqual(expect.objectContaining({ check: 'reservation intersects market', detail: 'plot:2022:0' }));
    plan.market.boundary = [[16, 32], [24, 32], [24, 40], [16, 40]];
    expect(audit(plan).failures).not.toContainEqual(expect.objectContaining({ check: 'reservation intersects market', detail: 'plot:2022:0' }));
  });
  it('rejects pavement that enters a reservation while its centreline remains outside', () => {
    const plan = fixture();
    const road = { id: 'extra', from: 'extra-a', to: 'extra-b', points: [[15, 0, 16], [15, 0, 32]], kind: 'lane', width: 4, verge: 0, name: 'Extra' };
    plan.nodes.push({ id: 'extra-a', position: road.points[0]!, kind: 'junction' }, { id: 'extra-b', position: road.points[1]!, kind: 'junction' });
    plan.streets.push(road);
    expect(audit(plan).failures).toContainEqual(expect.objectContaining({ check: 'paved street intersects reservation', detail: { plot: 'plot:2022:0', edge: 'extra' } }));
    road.width = 2;
    expect(audit(plan).failures).not.toContainEqual(expect.objectContaining({ check: 'paved street intersects reservation', detail: { plot: 'plot:2022:0', edge: 'extra' } }));
  });
  it('does not extend a straight sampled approach beyond its butt-ended frontage', () => {
    const plan = fixture();
    const road = { id: 'sampled', from: 'sampled-a', to: 'sampled-b', points: [[16, 0, 24], [15.025, 0, 24], [14.05, 0, 24]], kind: 'approach', width: 2, verge: 0, name: 'Sampled' };
    plan.nodes.push({ id: road.from, position: road.points[0]!, kind: 'frontage' }, { id: road.to, position: road.points[2]!, kind: 'junction' });
    plan.streets.push(road);
    expect(audit(plan).failures).not.toContainEqual(expect.objectContaining({ check: 'paved street intersects reservation', detail: { plot: 'plot:2022:0', edge: 'sampled' } }));
  });
  it('detects an overlap just inside the true rounded arc', () => {
    const plan = fixture();
    const angle = Math.PI / 128, x = 16 - .99999 * Math.cos(angle), z = 16 - .99999 * Math.sin(angle);
    const road = { id: 'arc-sliver', from: 'arc-a', to: 'arc-b', points: [[x, 0, z - 2], [x, 0, z], [x - 2, 0, z]], kind: 'lane', width: 2, verge: 0, name: 'Arc' };
    plan.nodes.push({ id: road.from, position: road.points[0]!, kind: 'junction' }, { id: road.to, position: road.points[2]!, kind: 'junction' });
    plan.streets.push(road);
    expect(audit(plan).failures).toContainEqual(expect.objectContaining({ check: 'paved street intersects reservation', detail: { plot: 'plot:2022:0', edge: 'arc-sliver' } }));
  });
  it('rejects overlap from a rounded interior bend', () => {
    const plan = fixture();
    const road = { id: 'bend', from: 'bend-a', to: 'bend-b', points: [[13, 0, 14], [15.5, 0, 15.5], [13, 0, 15.5]], kind: 'lane', width: 2, verge: 0, name: 'Bend' };
    plan.nodes.push({ id: 'bend-a', position: road.points[0]!, kind: 'junction' }, { id: 'bend-b', position: road.points[2]!, kind: 'junction' });
    plan.streets.push(road);
    expect(audit(plan).failures).toContainEqual(expect.objectContaining({ check: 'paved street intersects reservation', detail: { plot: 'plot:2022:0', edge: 'bend' } }));
  });
  it('requires a shared node at crossings regardless of elevation', () => {
    const plan = fixture();
    const horizontal = { id: 'cross-a', from: 'cross-a0', to: 'cross-a1', points: [[-100, 0, -100], [-80, 0, -100]], kind: 'lane', width: 4, verge: 1, name: 'A' };
    const vertical = { id: 'cross-b', from: 'cross-b0', to: 'cross-b1', points: [[-90, 0, -110], [-90, 0, -90]], kind: 'lane', width: 4, verge: 1, name: 'B' };
    for (const road of [horizontal, vertical]) {
      plan.nodes.push({ id: road.from, position: road.points[0]!, kind: 'junction' }, { id: road.to, position: road.points[1]!, kind: 'junction' });
      plan.streets.push(road);
    }
    expect(audit(plan).failures).toContainEqual(expect.objectContaining({ check: 'street crossing lacks junction', detail: expect.objectContaining({ edges: ['cross-a', 'cross-b'] }) }));
    vertical.points[0]![1] = .2; vertical.points[1]![1] = .2;
    expect(audit(plan).failures).toContainEqual(expect.objectContaining({ check: 'street crossing lacks junction', detail: expect.objectContaining({ edges: ['cross-a', 'cross-b'], heightDifference: .2 }) }));
  });
  it('requires the same node ID even when two road endpoints coincide', () => {
    const plan = fixture();
    const roads = [
      { id: 'end-a', from: 'end-a0', to: 'end-a1', points: [[-100, 0, -100], [-90, 0, -100]], kind: 'lane', width: 4, verge: 1, name: 'A' },
      { id: 'end-b', from: 'end-b0', to: 'end-b1', points: [[-90, 0, -100], [-90, 0, -90]], kind: 'lane', width: 4, verge: 1, name: 'B' },
    ];
    for (const road of roads) {
      plan.nodes.push({ id: road.from, position: road.points[0]!, kind: 'junction' }, { id: road.to, position: road.points[1]!, kind: 'junction' });
      plan.streets.push(road);
    }
    const crossing = expect.objectContaining({ check: 'street crossing lacks junction', detail: expect.objectContaining({ edges: ['end-a', 'end-b'] }) });
    expect(audit(plan).failures).toContainEqual(crossing);
    roads[1]!.from = 'end-a1';
    expect(audit(plan).failures).not.toContainEqual(crossing);
  });
  it('rejects positive-length collinear overlap but permits a shared endpoint', () => {
    const plan = fixture();
    const first = { id: 'collinear-a', from: 'col-a0', to: 'col-shared', points: [[-120, 0, -120], [-100, 0, -120]], kind: 'lane', width: 4, verge: 1, name: 'A' };
    const second = { id: 'collinear-b', from: 'col-b0', to: 'col-b1', points: [[-110, 2, -120], [-90, 2, -120]], kind: 'lane', width: 4, verge: 1, name: 'B' };
    for (const road of [first, second]) {
      plan.nodes.push({ id: road.from, position: road.points[0]!, kind: 'junction' }, { id: road.to, position: road.points[1]!, kind: 'junction' });
      plan.streets.push(road);
    }
    const overlap = expect.objectContaining({ check: 'collinear street overlap', detail: expect.objectContaining({ edges: ['collinear-a', 'collinear-b'], length: 10 }) });
    expect(audit(plan).failures).toContainEqual(overlap);
    second.from = 'col-shared'; second.points[0] = [-100, 0, -120]; second.points[1] = [-90, 0, -120];
    expect(audit(plan).failures).not.toContainEqual(expect.objectContaining({ check: 'collinear street overlap', detail: expect.objectContaining({ edges: ['collinear-a', 'collinear-b'] }) }));
  });
  it('labels quarter, active and reserved lots, swept approaches, and growth ports in diagnostics', () => {
    const plan = fixture();
    plan.nodes.push({ id: 'growth', position: [3, 0, 4], kind: 'frontier' });
    const svg = diagnosticSvg(plan, 'test');
    expect(svg).toContain('data-plot="plot:2022:0" data-status="active"');
    expect(svg).toContain('data-plot="plot:2022:12" data-status="reserved"');
    expect(svg).toContain('data-edge="approach:0"');
    expect(svg).toContain('stroke-linecap="butt" stroke-linejoin="round"');
    expect(svg).toContain('data-port="growth"');
    expect(svg).toContain('■ 2022');
  });
  it('includes dormant lots, roads, castle and lake outside the render window in the diagnostic', () => {
    const plan = fixture();
    plan.bounds = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    plan.castle.bounds = { minX: -300, maxX: -290, minZ: -5, maxZ: 5 };
    plan.lake = { x: 0, z: -400, radiusX: 10, radiusZ: 10, level: 0 };
    plan.reservations[47]!.lot.maxX = 600;
    plan.streets[0]!.points[0]![2] = 700;
    const svg = diagnosticSvg(plan, 'bounds');
    expect(svg).toContain('viewBox="-316 -426 932 1144"');
  });
  it('detects a steep actual road segment', () => {
    const plan = fixture();
    plan.streets.find(edge => edge.id === 'lane:0')!.points = [[0, 0, 0], [10, 3, 0], [20, 0, 0]];
    expect(audit(plan).failures).toContainEqual(expect.objectContaining({ check: 'edge grade exceeds target', detail: expect.objectContaining({ edge: 'lane:0', grade: .3, limit: .12 }) }));
  });
});
