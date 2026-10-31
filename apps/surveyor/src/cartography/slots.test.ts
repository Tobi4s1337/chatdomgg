import { describe, expect, it } from 'vitest';
import {
  LATTICE, LandIndex, Occupancy, landIndexOfWorld, latticePoint, nearestFreeSlot, parseSlotHoldingId, realmCapacity, slotFits, slotHoldingId,
  type LandRing, type LatticePoint, type RealmCircle,
} from './slots';

// Hand-built land in world units. Rings are closed polylines (first point not repeated), wound either way.
const ring = (region: number, ...points: [number, number][]): LandRing => ({ region, points: points.flat() });
const square = (region: number, x0: number, y0: number, x1: number, y1: number) => ring(region, [x0, y0], [x1, y0], [x1, y1], [x0, y1]);
const clockwise = (region: number, x0: number, y0: number, x1: number, y1: number) => ring(region, [x0, y0], [x0, y1], [x1, y1], [x1, y0]);

const HAMLET = 0.5;
const GAP = 0.6;

/** Every lattice point in a box, by row then column. */
function latticeIn(minX: number, minY: number, maxX: number, maxY: number): LatticePoint[] {
  const points: LatticePoint[] = [];
  const j0 = Math.floor((minY * LATTICE.scale) / LATTICE.rowY) - 1;
  const j1 = Math.ceil((maxY * LATTICE.scale) / LATTICE.rowY) + 1;
  const i0 = Math.floor((minX * LATTICE.scale) / LATTICE.pitchX) - 1;
  const i1 = Math.ceil((maxX * LATTICE.scale) / LATTICE.pitchX) + 1;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) points.push(latticePoint(i, j));
  return points;
}

/** The documented answer by brute force: the fitting lattice point nearest the target, ties by row then column. */
function bruteNearest(land: LandIndex, occupancy: Occupancy, realm: RealmCircle, target: { x: number; y: number }, r: number, box: [number, number, number, number]): LatticePoint | null {
  let best: { p: LatticePoint; d: number } | null = null;
  for (const p of latticeIn(...box)) {
    if (!slotFits(land, occupancy, realm, p, r)) continue;
    const d = Math.hypot(p.x - target.x, p.y - target.y);
    if (!best || d < best.d || (d === best.d && (p.j < best.p.j || (p.j === best.p.j && p.i < best.p.i)))) best = { p, d };
  }
  return best?.p ?? null;
}

describe('the hamlet lattice hex-1', () => {
  it('puts every slot on an exact multiple of 1/20 unit, rows 1.4 apart, odd rows offset by half a pitch', () => {
    expect(LATTICE).toMatchObject({ id: 'hex-1', pitchX: 32, rowY: 28, scale: 20 });
    for (let j = -60; j <= 60; j += 7) {
      for (let i = -90; i <= 90; i += 11) {
        const p = latticePoint(i, j);
        expect(Number.isInteger(p.x * 20)).toBe(true);
        expect(Number.isInteger(p.y * 20)).toBe(true);
        expect(p.x * 20).toBe(i * 32 + (j & 1) * 16);
        expect(p.y * 20).toBe(j * 28);
      }
    }
    expect(latticePoint(3, 2)).toEqual({ i: 3, j: 2, x: 4.8, y: 2.8 });
    expect(latticePoint(3, 1)).toEqual({ i: 3, j: 1, x: 5.6, y: 1.4 });
  });

  it('keeps neighbouring hamlets exactly one gap apart, so every slot can hold one', () => {
    const occupancy = new Occupancy(GAP);
    const p = latticePoint(10, 10);
    occupancy.add(p.x, p.y, HAMLET);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [-1, 1], [0, -1], [-1, -1]] as const) {
      const q = latticePoint(10 + di, 10 + dj);
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeGreaterThanOrEqual(2 * HAMLET + GAP - 1e-9);
      expect(occupancy.fits(q.x, q.y, HAMLET)).toBe(true);
    }
    expect(occupancy.fits(p.x, p.y, HAMLET)).toBe(false);
  });

  it('names a slot s:<i>:<j> and reads the name back', () => {
    for (const [i, j] of [[0, 0], [12, 7], [-3, 15], [4, -9], [-1_234_567, 9_999_999]] as const) {
      const id = slotHoldingId(i, j);
      expect(id).toBe(`s:${i}:${j}`);
      expect(parseSlotHoldingId(id)).toEqual({ i, j });
    }
    for (const bad of ['f:3', 's:1', 's:1:2:3', 's:1.5:2', 's:a:2', 's: 1:2', 's:12345678:1', 'S:1:2', '', 's:01:2', 's:1:-07', 's:-0:2', 's:00:0']) expect(parseSlotHoldingId(bad)).toBeNull();
  });
});

describe('LandIndex', () => {
  // Island A (region 0) with a lake (tagged 7) holding an islet (tagged 9); island B (region 1); island C (region 5,
  // no realms). Realm 3 is tagged region 1 but lies on island A's ground, to prove realms are looked up by region.
  const land = new LandIndex([
    square(0, 0, 0, 40, 40),
    clockwise(7, 15, 15, 25, 25),
    square(9, 18, 18, 22, 22),
    clockwise(1, 60, 0, 80, 20),
    square(5, 60, 30, 70, 40),
  ], [
    { index: 0, region: 0, x: 8, y: 8, r: 2 },
    { index: 1, region: 0, x: 30, y: 30, r: 20 },
    { index: 2, region: 1, x: 70, y: 10, r: 8 },
    { index: 3, region: 1, x: 12, y: 32, r: 6 },
  ]);

  it('decides land by even-odd: a lake is sea, the land around it and an islet in it are land of the outer ring', () => {
    expect(land.regionAt(5.3, 20.1)).toBe(0);
    expect(land.regionAt(30.3, 20.1)).toBe(0);
    expect(land.regionAt(17.1, 20.1)).toBe(-1);
    expect(land.regionAt(20.1, 16.1)).toBe(-1);
    expect(land.regionAt(20.1, 20.1)).toBe(0);
    expect(land.regionAt(70.3, 10.1)).toBe(1);
    expect(land.regionAt(65.1, 35.1)).toBe(5);
    expect(land.regionAt(50.1, 10.1)).toBe(-1);
    expect(land.regionAt(-3, 5)).toBe(-1);
    expect(land.regionAt(20, 45)).toBe(-1);
  });

  it('counts a vertex on the scan line once (half-open crossings)', () => {
    // y = 15 and y = 25 run through the lake's corners and edges.
    expect(land.regionAt(10.1, 15)).toBe(0);
    expect(land.regionAt(30.1, 15)).toBe(0);
    expect(land.regionAt(20.1, 15)).toBe(-1);
    expect(land.crossings(15).length % 2).toBe(0);
    expect(land.crossings(25).length % 2).toBe(0);
  });

  it('measures the distance to the nearest coast, including a lake shore, capped at the limit', () => {
    expect(land.distanceToCoast(5, 20.5, 10)).toBeCloseTo(5, 12);
    expect(land.distanceToCoast(12, 20.5, 10)).toBeCloseTo(3, 12);
    expect(land.distanceToCoast(20.5, 20.5, 10)).toBeCloseTo(1.5, 12);
    expect(land.distanceToCoast(20.5, 20.5, 1)).toBe(1);
    expect(land.distanceToCoast(50, 10, 20)).toBeCloseTo(10, 12);
    // Corner: the nearest point of the coast is the vertex.
    expect(land.distanceToCoast(-3, -4, 10)).toBeCloseTo(5, 12);
    expect(land.distanceToCoast(5, 20.5, 2)).toBe(2);
  });

  it('assigns a point to the realm of its own region with the smallest power distance |p − c| − r', () => {
    // Euclidean-nearest centre is realm 0 (8.2 vs 24.4), but realm 1's edge is closer (4.4 vs 6.2).
    expect(land.realmAt(16, 10)).toBe(1);
    expect(land.realmAt(9, 9)).toBe(0);
    // Realm 3 (tagged region 1) would win here by power distance, but the point is region 0's land.
    expect(land.realmAt(10, 30)).toBe(1);
    expect(land.realmAt(70.3, 10.1)).toBe(2);
    expect(land.realmAt(65.1, 35.1)).toBe(-1);
    expect(land.realmAt(17.1, 20.1)).toBe(-1);
    expect(land.realmAt(50, 10)).toBe(-1);
    // An explicit region skips the land test.
    expect(land.realmAt(10, 30, 1)).toBe(3);
  });

  it('rebuilds the same land from a stored world: delta-encoded fixed-point coasts and integer realm circles', () => {
    const encode = (points: [number, number][]) => {
      const out: number[] = [];
      let px = 0;
      let py = 0;
      for (const [x, y] of points) {
        out.push(Math.round(x * 20) - px, Math.round(y * 20) - py);
        px = Math.round(x * 20);
        py = Math.round(y * 20);
      }
      return out;
    };
    const stored = landIndexOfWorld({
      coordScale: 20,
      coasts: [
        { region: 0, points: encode([[0, 0], [40, 0], [40, 40], [0, 40]]) },
        { region: 7, points: encode([[15, 15], [15, 25], [25, 25], [25, 15]]) },
        { region: 1, points: encode([[60.05, 0], [80, 0], [80, 20], [60.05, 20]]) },
      ],
      realms: [{ index: 0, region: 0, x: 160, y: 160, r: 40 }, { index: 1, region: 0, x: 600, y: 600, r: 400 }, { index: 2, region: 1, x: 1400, y: 200, r: 160 }],
    });
    expect(stored.realms[1]).toEqual({ index: 1, region: 0, x: 30, y: 30, r: 20 });
    expect(stored.regionAt(5.3, 20.1)).toBe(0);
    expect(stored.regionAt(17.1, 20.1)).toBe(-1);
    expect(stored.regionAt(60.1, 10.1)).toBe(1);
    expect(stored.regionAt(60.01, 10.1)).toBe(-1);
    expect(stored.realmAt(16, 10)).toBe(1);
    expect(stored.realmAt(9, 9)).toBe(0);
    expect(stored.distanceToCoast(12, 20.5, 10)).toBeCloseTo(3, 12);
  });
});

describe('nearestFreeSlot', () => {
  const island = new LandIndex([square(0, 0, 0, 20, 20)], [{ index: 0, region: 0, x: 10, y: 10, r: 10 }]);
  const realm = island.realms[0]!;
  const box: [number, number, number, number] = [0, 0, 20, 20];

  it('returns the free lattice point nearest the target, as brute force finds it', () => {
    const occupancy = new Occupancy(GAP);
    for (const target of [{ x: 10.3, y: 10.1 }, { x: 4.4, y: 15.9 }, { x: 10, y: 9.8 }, { x: 13.37, y: 2.71 }]) {
      const slot = nearestFreeSlot(island, occupancy, realm, target, HAMLET);
      expect(slot).not.toBeNull();
      expect(slot).toEqual(bruteNearest(island, occupancy, realm, target, HAMLET, box));
      expect(Math.hypot(slot!.x - target.x, slot!.y - target.y)).toBeLessThan(1.1);
    }
  });

  it('skips occupied points and keeps the gap from every holding already placed', () => {
    const occupancy = new Occupancy(GAP);
    const target = { x: 10.3, y: 10.1 };
    const taken: { p: LatticePoint; r: number }[] = [];
    // A village first, then hamlets one after another around the same target.
    const village = nearestFreeSlot(island, occupancy, realm, target, 1.25)!;
    occupancy.add(village.x, village.y, 1.25);
    taken.push({ p: village, r: 1.25 });
    for (let n = 0; n < 12; n++) {
      const slot = nearestFreeSlot(island, occupancy, realm, target, HAMLET);
      expect(slot).toEqual(bruteNearest(island, occupancy, realm, target, HAMLET, box));
      for (const held of taken) {
        expect(slot).not.toEqual(held.p);
        expect(Math.hypot(slot!.x - held.p.x, slot!.y - held.p.y)).toBeGreaterThanOrEqual(HAMLET + held.r + GAP - 1e-9);
      }
      occupancy.add(slot!.x, slot!.y, HAMLET);
      taken.push({ p: slot!, r: HAMLET });
    }
    expect(occupancy.size).toBe(13);
  });

  it('keeps a shore between the holding and the sea, even when a nearer slot lies on the beach', () => {
    const occupancy = new Occupancy(GAP);
    const target = { x: 0.1, y: 10.1 };
    const slot = nearestFreeSlot(island, occupancy, realm, target, HAMLET)!;
    expect(slot).toEqual(bruteNearest(island, occupancy, realm, target, HAMLET, box));
    expect(island.distanceToCoast(slot.x, slot.y, 5)).toBeGreaterThanOrEqual(HAMLET + LATTICE.shore);
    // Lattice points on dry land nearer the target exist; they are refused for the shore alone.
    const nearer = latticeIn(...box).filter((p) => island.regionAt(p.x, p.y) === 0 && Math.hypot(p.x - target.x, p.y - target.y) < Math.hypot(slot.x - target.x, slot.y - target.y));
    expect(nearer.length).toBeGreaterThan(0);
    for (const p of nearer) expect(island.distanceToCoast(p.x, p.y, 5)).toBeLessThan(HAMLET + LATTICE.shore);
  });

  it('never returns a point of another realm', () => {
    const split = new LandIndex([square(0, 0, 0, 20, 20)], [{ index: 0, region: 0, x: 5, y: 10, r: 5 }, { index: 1, region: 0, x: 15, y: 10, r: 5 }]);
    const occupancy = new Occupancy(GAP);
    const slot = nearestFreeSlot(split, occupancy, split.realms[0]!, { x: 15, y: 10 }, HAMLET)!;
    expect(split.realmAt(slot.x, slot.y)).toBe(0);
    expect(slot).toEqual(bruteNearest(split, occupancy, split.realms[0]!, { x: 15, y: 10 }, HAMLET, box));
  });

  it('fills a small island slot by slot and then returns null', () => {
    const small = new LandIndex([square(0, 100, 100, 108, 108)], [{ index: 0, region: 0, x: 104, y: 104, r: 4 }]);
    const occupancy = new Occupancy(GAP);
    const smallRealm = small.realms[0]!;
    const capacity = latticeIn(100, 100, 108, 108).filter((p) => slotFits(small, occupancy, smallRealm, p, HAMLET)).length;
    expect(capacity).toBeGreaterThan(4);
    expect(realmCapacity(small, occupancy, { minY: 100, maxY: 108 }, HAMLET).get(0)).toBe(capacity);
    const placed = new Set<string>();
    for (;;) {
      const slot = nearestFreeSlot(small, occupancy, smallRealm, { x: 104, y: 104 }, HAMLET);
      if (!slot) break;
      expect(placed.has(slotHoldingId(slot.i, slot.j))).toBe(false);
      placed.add(slotHoldingId(slot.i, slot.j));
      occupancy.add(slot.x, slot.y, HAMLET);
      expect(placed.size).toBeLessThanOrEqual(capacity);
    }
    expect(placed.size).toBe(capacity);
    expect(nearestFreeSlot(small, occupancy, smallRealm, { x: 101, y: 107 }, HAMLET)).toBeNull();
    expect(realmCapacity(small, occupancy, { minY: 100, maxY: 108 }, HAMLET).get(0) ?? 0).toBe(0);
  });
});

describe('realmCapacity', () => {
  it('counts the same free slots per realm as a point-by-point enumeration', () => {
    // An irregular island with a lake, two realms, and holdings already standing on it.
    const land = new LandIndex([
      ring(0, [0, 0], [30, -4], [42, 10], [36, 28], [14, 34], [-6, 20]),
      ring(0, [12, 10], [20, 8], [22, 16], [14, 18]),
      ring(1, [50, 2], [58, 0], [61, 9], [52, 12]),
    ], [
      { index: 0, region: 0, x: 8, y: 10, r: 8 },
      { index: 1, region: 0, x: 30, y: 18, r: 10 },
      { index: 2, region: 1, x: 55, y: 6, r: 4 },
    ]);
    const occupancy = new Occupancy(GAP);
    occupancy.add(25, 5, 1.25);
    occupancy.add(8, 24, 1.8);
    occupancy.add(55.2, 5.6, HAMLET);
    const bounds = { minY: -4, maxY: 34 };
    const counts = realmCapacity(land, occupancy, bounds, HAMLET);

    const brute = new Map<number, number>();
    const clearance = HAMLET + LATTICE.shore;
    for (const p of latticeIn(-10, bounds.minY, 70, bounds.maxY)) {
      if (p.y < bounds.minY || p.y > bounds.maxY) continue;
      const region = land.regionAt(p.x, p.y);
      if (region < 0) continue;
      if (land.distanceToCoast(p.x, p.y, clearance) < clearance) continue;
      if (!occupancy.fits(p.x, p.y, HAMLET)) continue;
      const realm = land.realmAt(p.x, p.y, region);
      if (realm >= 0) brute.set(realm, (brute.get(realm) ?? 0) + 1);
    }
    expect([...counts.entries()].sort()).toEqual([...brute.entries()].sort());
    expect(counts.get(0)).toBeGreaterThan(20);
    expect(counts.get(1)).toBeGreaterThan(20);
    expect(counts.get(2)).toBeGreaterThan(0);
    // Every counted slot is one nearestFreeSlot would accept.
    for (const realm of land.realms) {
      const fitting = latticeIn(-10, bounds.minY, 70, bounds.maxY).filter((p) => p.y >= bounds.minY && p.y <= bounds.maxY && slotFits(land, occupancy, realm, p, HAMLET));
      expect(fitting.length).toBe(counts.get(realm.index) ?? 0);
    }
  });

  it('counts nothing below or above the given rows', () => {
    const land = new LandIndex([square(0, 0, 0, 20, 20)], [{ index: 0, region: 0, x: 10, y: 10, r: 10 }]);
    const occupancy = new Occupancy(GAP);
    const all = realmCapacity(land, occupancy, { minY: 0, maxY: 20 }, HAMLET).get(0)!;
    const top = realmCapacity(land, occupancy, { minY: 0, maxY: 10 }, HAMLET).get(0)!;
    const bottom = realmCapacity(land, occupancy, { minY: 10.01, maxY: 20 }, HAMLET).get(0)!;
    expect(top + bottom).toBe(all);
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeGreaterThan(0);
  });
});
