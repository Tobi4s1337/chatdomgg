import { readFileSync } from 'node:fs';
import { VoxelBlueprintSchema } from '@chatdom/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAT } from '../../../../../content/src/materials';
import { waterSurfaceAt } from '../../../kingdom-land/surface';
import { terrainHeight } from '../../../layout';
import { polygonDistance, segmentProjection, transformCardinalPoint } from '../../../settlement/geometry';
import { generateSettlementPlan } from '../../../settlement/generator';
import type { BoundsXZ, SettlementPlan, StreetEdge, XZ } from '../../../settlement/types';
import { pointInPolygon } from './grid';
import { planTownWalls, WALL_MATERIAL, type TownWallOptions, type TownWalls, type WallStyle } from './index';

const CELL = 0.125;
/** Planning a whole circuit and voxelising it takes a while on a busy machine. */
const SLOW = 600_000;

const fixturePlan = (): SettlementPlan =>
  (JSON.parse(readFileSync(new URL('../../../../../../apps/realm/src/founded/artifacts/simulated-town.scene.json', import.meta.url), 'utf8')) as { plan: SettlementPlan }).plan;

const alignOut = (b: BoundsXZ): BoundsXZ =>
  ({ minX: Math.floor(b.minX / 16) * 16, maxX: Math.ceil(b.maxX / 16) * 16, minZ: Math.floor(b.minZ / 16) * 16, maxZ: Math.ceil(b.maxZ / 16) * 16 });

const optionsFor = (plan: SettlementPlan, style: WallStyle, seedKey: string): TownWallOptions => ({
  seedKey, style, region: alignOut(plan.bounds),
  ground: (x, z) => terrainHeight(plan, x, z),
  water: (x, z) => waterSurfaceAt(plan.landform, x, z),
});

interface WorldBox { pieceId: string; kind: string; minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

/** Every box of every piece in settlement metres, placed through the piece's cardinal turn. */
function worldBoxes(walls: TownWalls): WorldBox[] {
  const out: WorldBox[] = [];
  for (const piece of walls.pieces) for (const box of piece.blueprint.boxes) {
    const a = transformCardinalPoint(piece.position, piece.rotation, [box.from[0] * CELL, box.from[1] * CELL, box.from[2] * CELL]);
    const b = transformCardinalPoint(piece.position, piece.rotation, [box.to[0] * CELL, box.to[1] * CELL, box.to[2] * CELL]);
    out.push({ pieceId: piece.id, kind: piece.kind, minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]), minZ: Math.min(a[2], b[2]), maxZ: Math.max(a[2], b[2]) });
  }
  return out;
}

/** Boxes bucketed on a 16 m grid, so lot and corridor checks only visit their neighbourhood. */
class BoxGrid {
  private readonly cells = new Map<string, WorldBox[]>();
  constructor(boxes: readonly WorldBox[]) {
    for (const box of boxes) this.visit(box, key => { let list = this.cells.get(key); if (!list) this.cells.set(key, list = []); list.push(box); });
  }
  near(area: BoundsXZ): WorldBox[] {
    const found = new Set<WorldBox>();
    this.visit(area, key => { for (const box of this.cells.get(key) ?? []) found.add(box); });
    return [...found];
  }
  private visit(area: BoundsXZ, fn: (key: string) => void): void {
    for (let i = Math.floor(area.minX / 16); i <= Math.floor(area.maxX / 16); i++) for (let j = Math.floor(area.minZ / 16); j <= Math.floor(area.maxZ / 16); j++) fn(`${i},${j}`);
  }
}

const EPS = 1e-6;
const overlaps = (a: BoundsXZ, b: BoundsXZ) => a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;

function segmentsCross(a: XZ, b: XZ, c: XZ, d: XZ): boolean {
  const side = (p: XZ, q: XZ, r: XZ) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = side(c, d, a), d2 = side(c, d, b), d3 = side(a, b, c), d4 = side(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

const corners = (r: BoundsXZ): XZ[] => [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]];

/** Whether an axis-aligned rectangle and a simple polygon share any area. */
function rectangleMeetsPolygon(r: BoundsXZ, polygon: readonly XZ[]): boolean {
  const inner: BoundsXZ = { minX: r.minX + EPS, maxX: r.maxX - EPS, minZ: r.minZ + EPS, maxZ: r.maxZ - EPS };
  if (corners(inner).some(([x, z]) => pointInPolygon(polygon, x, z))) return true;
  if (polygon.some(([x, z]) => x > inner.minX && x < inner.maxX && z > inner.minZ && z < inner.maxZ)) return true;
  const sides = corners(inner);
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    for (let k = 0; k < 4; k++) if (segmentsCross(polygon[j]!, polygon[i]!, sides[k]!, sides[(k + 1) % 4]!)) return true;
  }
  return false;
}

/** Shortest distance between a segment and an axis-aligned rectangle (0 when they touch). */
function segmentRectangleDistance(a: XZ, b: XZ, r: BoundsXZ): number {
  const inside = (p: XZ) => p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minZ && p[1] <= r.maxZ;
  if (inside(a) || inside(b)) return 0;
  const sides = corners(r);
  for (let k = 0; k < 4; k++) if (segmentsCross(a, b, sides[k]!, sides[(k + 1) % 4]!)) return 0;
  const toRect = (p: XZ) => Math.hypot(Math.max(r.minX - p[0], 0, p[0] - r.maxX), Math.max(r.minZ - p[1], 0, p[1] - r.maxZ));
  return Math.min(toRect(a), toRect(b), ...sides.map(([x, z]) => segmentProjection(a, b, x, z).distance));
}

function castleModules(plan: SettlementPlan): BoundsXZ[] {
  return plan.castle.modules.map(module => {
    const xs: number[] = [], zs: number[] = [];
    for (const x of [0, module.size[0]]) for (const z of [0, module.size[2]]) {
      const p = transformCardinalPoint(module.position, module.rotation, [x, 0, z]);
      xs.push(p[0]); zs.push(p[2]);
    }
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  });
}

const polylineDistance = (line: readonly XZ[], x: number, z: number) => {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, segmentProjection(line[i - 1]!, line[i]!, x, z).distance);
  return best;
};

const ringLength = (ring: readonly XZ[]) => {
  let length = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; length += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return length;
};

/** Every place a street's centre line crosses a built wall span. */
function streetCrossings(walls: TownWalls, streets: readonly StreetEdge[]): { street: StreetEdge; at: XZ }[] {
  const found: { street: StreetEdge; at: XZ }[] = [];
  for (const span of walls.spans) {
    if (span.kind !== 'wall') continue;
    for (const street of streets) for (let i = 1; i < street.points.length; i++) {
      const a: XZ = [street.points[i - 1]![0], street.points[i - 1]![2]], b: XZ = [street.points[i]![0], street.points[i]![2]];
      for (let k = 1; k < span.points.length; k++) {
        const c = span.points[k - 1]!, d = span.points[k]!;
        if (!segmentsCross(a, b, c, d)) continue;
        const ax = b[0] - a[0], az = b[1] - a[1], cx = d[0] - c[0], cz = d[1] - c[1], den = ax * cz - az * cx;
        const t = ((c[0] - a[0]) * cz - (c[1] - a[1]) * cx) / den;
        found.push({ street, at: [a[0] + ax * t, a[1] + az * t] });
      }
    }
  }
  return found;
}

describe.each([
  { name: 'the simulated founded town', plan: fixturePlan, style: 'hearth' as const },
  { name: 'a generated hamlet', plan: () => generateSettlementPlan({ seed: 'walls-hamlet', tier: 'hamlet', firstYear: 2025, year: 2026 }), style: 'tide' as const },
])('town walls around $name', ({ plan: makePlan, style }) => {
  let plan: SettlementPlan, walls: TownWalls, again: TownWalls, boxes: WorldBox[], grid: BoxGrid, region: BoundsXZ;

  beforeAll(() => {
    plan = makePlan();
    const options = optionsFor(plan, style, 'walls-test');
    region = options.region;
    walls = planTownWalls(plan, options);
    again = planTownWalls(plan, optionsFor(plan, style, 'walls-test'));
    boxes = worldBoxes(walls);
    grid = new BoxGrid(boxes);
  }, SLOW);

  it('is deterministic for the same plan and seed key', () => {
    // Serialised: a structural diff over a quarter of a million boxes is far slower than the plan itself.
    expect(JSON.stringify(again) === JSON.stringify(walls)).toBe(true);
  }, SLOW);

  it('closes a counter-clockwise circuit with towers and gates', () => {
    let area = 0;
    for (let i = 0, j = walls.ring.length - 1; i < walls.ring.length; j = i++) area += walls.ring[j]![0] * walls.ring[i]![1] - walls.ring[i]![0] * walls.ring[j]![1];
    expect(area).toBeGreaterThan(0);
    expect(walls.spans.some(span => span.kind === 'wall')).toBe(true);
    expect(walls.towers.length).toBeGreaterThan(6);
    expect(walls.gates.length).toBeGreaterThan(0);
    expect(ringLength(walls.ring)).toBeGreaterThan(200);
  }, SLOW);

  it('encloses every home, every reservation it can, the market and every court', () => {
    const beyond = new Set(walls.beyond), homes = new Set(plan.homes.map(home => home.id));
    for (const id of beyond) expect(homes.has(id)).toBe(false);
    for (const plot of [...plan.homes, ...plan.reservations]) {
      if (beyond.has(plot.id)) continue;
      for (const [x, z] of corners(plot.lot)) expect(pointInPolygon(walls.ring, x, z), `${plot.id} corner ${x},${z}`).toBe(true);
    }
    // A reservation is only left outside when its margin would leave the region, or when it is packed (closer than a
    // lot's depth) against one that is, so no wall can pass between them: a chain back to the region edge.
    const edge = (lot: BoundsXZ) => Math.min(lot.minX - region.minX, region.maxX - lot.maxX, lot.minZ - region.minZ, region.maxZ - lot.maxZ);
    const gap = (a: BoundsXZ, b: BoundsXZ) => Math.hypot(Math.max(a.minX - b.maxX, b.minX - a.maxX, 0), Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ, 0));
    const lotOf = (id: string) => plan.reservations.find(plot => plot.id === id)!.lot;
    const crowded = new Set([...beyond].filter(id => edge(lotOf(id)) < 9));
    for (let grew = true; grew;) {
      grew = false;
      for (const id of beyond) if (!crowded.has(id) && [...crowded].some(other => gap(lotOf(id), lotOf(other)) < 16)) { crowded.add(id); grew = true; }
    }
    for (const id of beyond) expect(crowded.has(id), `${id} left outside`).toBe(true);
    for (const square of [plan.market, ...plan.courts]) {
      for (const [x, z] of square.boundary) expect(pointInPolygon(walls.ring, x, z), `${square.id} at ${x},${z}`).toBe(true);
    }
  }, SLOW);

  it('keeps every built wall at least 4 m from the lots and squares it encloses', () => {
    const beyond = new Set(walls.beyond);
    const lots = [...plan.homes, ...plan.reservations].filter(plot => !beyond.has(plot.id)).map(plot => plot.lot);
    const squares = [plan.market, ...plan.courts];
    for (const span of walls.spans) {
      if (span.kind !== 'wall') continue;
      for (const [x, z] of span.points) {
        for (const lot of lots) {
          const dx = Math.max(lot.minX - x, 0, x - lot.maxX), dz = Math.max(lot.minZ - z, 0, z - lot.maxZ);
          expect(Math.hypot(dx, dz), `wall at ${x.toFixed(1)},${z.toFixed(1)}`).toBeGreaterThanOrEqual(4);
        }
        for (const square of squares) expect(polygonDistance(square.boundary, x, z), `${square.id} by ${x.toFixed(1)},${z.toFixed(1)}`).toBeGreaterThanOrEqual(4);
      }
    }
  }, SLOW);

  it('builds nothing on a lot, a square, a castle module, water or the region edge', () => {
    const lots = [...plan.homes, ...plan.reservations].map(plot => plot.lot);
    const squares = [plan.market, ...plan.courts, plan.castle.court];
    const modules = castleModules(plan);
    const inner = { minX: region.minX + 2, maxX: region.maxX - 2, minZ: region.minZ + 2, maxZ: region.maxZ - 2 };
    const name = (box: WorldBox) => `${box.pieceId} box ${box.minX},${box.minZ}..${box.maxX},${box.maxZ}`;
    for (const box of boxes) {
      expect(box.minX >= inner.minX - EPS && box.maxX <= inner.maxX + EPS && box.minZ >= inner.minZ - EPS && box.maxZ <= inner.maxZ + EPS, name(box)).toBe(true);
      for (const [x, z] of [[box.minX + 0.125, box.minZ + 0.125], [box.maxX - 0.125, box.maxZ - 0.125], [(box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2]] as const) {
        expect(waterSurfaceAt(plan.landform, x, z), `${name(box)} over water`).toBeNull();
      }
    }
    for (const lot of lots) for (const box of grid.near(lot)) expect(overlaps(box, lot), `${name(box)} on a lot`).toBe(false);
    for (const module of modules) for (const box of grid.near(module)) expect(overlaps(box, module), `${name(box)} on a castle module`).toBe(false);
    for (const square of squares) {
      const xs = square.boundary.map(p => p[0]), zs = square.boundary.map(p => p[1]);
      const area = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
      for (const box of grid.near(area)) if (overlaps(box, area)) expect(rectangleMeetsPolygon(box, square.boundary), `${name(box)} on ${square.id}`).toBe(false);
    }
  }, SLOW);

  it('keeps every street corridor clear: walls and towers stay out, gate lintels stand above 4 m', () => {
    for (const street of plan.streets) {
      const half = street.width / 2 + street.verge;
      for (let i = 1; i < street.points.length; i++) {
        const a3 = street.points[i - 1]!, b3 = street.points[i]!, a: XZ = [a3[0], a3[2]], b: XZ = [b3[0], b3[2]];
        const reach = { minX: Math.min(a[0], b[0]) - half, maxX: Math.max(a[0], b[0]) + half, minZ: Math.min(a[1], b[1]) - half, maxZ: Math.max(a[1], b[1]) + half };
        for (const box of grid.near(reach)) {
          if (!overlaps(box, reach) || segmentRectangleDistance(a, b, box) >= half - EPS) continue;
          const where = `${box.pieceId} box ${box.minX},${box.minY},${box.minZ} in ${street.id}`;
          expect(box.kind, where).toBe('gatehouse');
          // The street surface under the box: its highest over the box's corners (the street is linear along a segment).
          const surface = Math.max(...corners(box).map(([x, z]) => a3[1] + (b3[1] - a3[1]) * segmentProjection(a, b, x, z).t));
          expect(box.minY, where).toBeGreaterThanOrEqual(surface + 4 - EPS);
        }
      }
    }
  }, SLOW);

  it('gates every street that crosses the wall, wide and tall enough for it', () => {
    const crossings = streetCrossings(walls, plan.streets);
    for (const { street, at } of crossings) {
      const gate = walls.gates.find(g => g.streetIds.includes(street.id) && Math.hypot(g.position[0] - at[0], g.position[2] - at[1]) <= g.width / 2 + 2);
      expect(gate, `${street.id} crosses at ${at[0].toFixed(1)},${at[1].toFixed(1)}`).toBeDefined();
      expect(gate!.width).toBeGreaterThanOrEqual(street.width + 2);
    }
    for (const gate of walls.gates) {
      for (const id of gate.streetIds) expect(gate.width).toBeGreaterThanOrEqual(plan.streets.find(s => s.id === id)!.width + 2);
      if (gate.kind === 'arch') expect(gate.headroom).toBeGreaterThanOrEqual(4);
      // An arch is a gatehouse between two drums; a wide open crossing keeps whichever flank towers have room.
      const flanking = walls.towers.filter(tower => tower.gateId === gate.id).length;
      if (gate.kind === 'arch') expect(flanking, `${gate.id} flanking towers`).toBe(2); else expect(flanking).toBeLessThanOrEqual(2);
      expect(gate.width).toBeGreaterThanOrEqual(6);
    }
  }, SLOW);

  it('leaves a way out for every future quarter inside the walls', () => {
    const growth = new Set([...plan.quarters.flatMap(q => q.growthNodeIds), ...plan.nodes.filter(n => n.kind === 'frontier').map(n => n.id)]);
    const gated = new Set(walls.gates.flatMap(gate => gate.growthNodeIds));
    for (const id of growth) {
      const node = plan.nodes.find(n => n.id === id);
      if (!node || !pointInPolygon(walls.ring, node.position[0], node.position[2])) continue;
      // A gate kept for it (its own, or the street gate its future street will share), or a stretch left open nearby.
      const served = gated.has(id) || walls.spans.some(span => span.kind === 'open' && polylineDistance(span.points, node.position[0], node.position[2]) < 80);
      expect(served, id).toBe(true);
    }
    for (const gate of walls.gates) for (const id of gate.growthNodeIds) expect(growth.has(id), `${gate.id} keeps ${id}`).toBe(true);
  }, SLOW);

  it('stands at curtain and tower heights, towers spaced along the circuit', () => {
    for (const segment of walls.segments) {
      const ground = terrainHeight(plan, (segment.from[0] + segment.to[0]) / 2, (segment.from[2] + segment.to[2]) / 2);
      // Merlon tops stand about 7–9 m over the ground; steps on a slope add a little at their low end.
      const top = segment.from[1] + segment.height;
      expect(top - ground).toBeGreaterThan(7);
      expect(top - ground).toBeLessThan(10);
    }
    for (const tower of walls.towers) {
      expect(tower.apex - tower.position[1]).toBeGreaterThan(12);
      expect(tower.apex - tower.position[1]).toBeLessThan(24);
      expect(tower.height).toBeGreaterThan(tower.gateId ? 10 : 10.5);
    }
    // Towers every ~35–60 m: no point of built wall is far from one (where the curtain meets the castle, its towers count).
    const towers = walls.towers.map(t => [t.position[0], t.position[2]] as XZ), modules = castleModules(plan);
    for (const span of walls.spans) if (span.kind === 'wall') for (const [x, z] of span.points) {
      const tower = Math.min(...towers.map(([tx, tz]) => Math.hypot(tx - x, tz - z)));
      const castle = Math.min(...modules.map(m => Math.hypot(Math.max(m.minX - x, 0, x - m.maxX), Math.max(m.minZ - z, 0, z - m.maxZ))));
      expect(Math.min(tower, castle), `wall at ${x.toFixed(1)},${z.toFixed(1)}`).toBeLessThan(36);
    }
  }, SLOW);

  it('emits valid build-lattice blueprints within the size and box budgets', () => {
    const ids = new Set<string>();
    for (const piece of walls.pieces) {
      expect(ids.has(piece.id)).toBe(false); ids.add(piece.id);
      const blueprint = VoxelBlueprintSchema.parse(piece.blueprint);
      expect(blueprint.lattice).toBe('build');
      for (const n of blueprint.size) expect(n).toBeLessThanOrEqual(256);
      expect(blueprint.boxes.length).toBeGreaterThan(0);
      expect(blueprint.boxes.length).toBeLessThan(20_000);
      expect([0, 1, 2, 3]).toContain(piece.rotation);
    }
    const used = new Set(walls.pieces.flatMap(piece => piece.blueprint.boxes.map(box => box.material)));
    const known = new Set<number>(Object.values(WALL_MATERIAL));
    for (const id of used) expect(known.has(id), `material ${id}`).toBe(true);
  }, SLOW);

  it('hangs banners on every tower and arch gate, facing out of town', () => {
    for (const tower of walls.towers) expect(walls.bannerAnchors.some(anchor => anchor.id === tower.id)).toBe(true);
    for (const anchor of walls.bannerAnchors) {
      const out: XZ = [Math.sin(anchor.facing), Math.cos(anchor.facing)];
      const ahead = pointInPolygon(walls.ring, anchor.position[0] + out[0] * 12, anchor.position[2] + out[1] * 12);
      const behind = pointInPolygon(walls.ring, anchor.position[0] - out[0] * 12, anchor.position[2] - out[1] * 12);
      expect(ahead && !behind, anchor.id).toBe(false);
    }
  }, SLOW);
});

describe('wall materials', () => {
  it('mirror the content palette by name', () => {
    for (const [name, id] of Object.entries(WALL_MATERIAL)) expect(MAT[name as keyof typeof MAT], name).toBe(id);
  });
});
