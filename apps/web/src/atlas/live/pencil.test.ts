import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  HAMLET_RADIUS, HOLDING_GAP, LandIndex, LATTICE, latticePoint, nearestFreeSlot, Occupancy, pencilTarget, type RealmCircle,
} from './pencil';

const hashOf = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 16);
const square = (region: number, minX: number, minY: number, maxX: number, maxY: number) =>
  ({ region, points: Float64Array.from([minX, minY, maxX, minY, maxX, maxY, minX, maxY]) });
const CLEARANCE = HAMLET_RADIUS + LATTICE.shore;

// Region 0: one square island 40 × 40 around the origin with two realms side by side.
// Region 1: a square islet too small for a hamlet to keep the shore. Region 2: no land at all.
const REALMS: RealmCircle[] = [
  { index: 0, region: 0, x: -10, y: 0, r: 9 },
  { index: 1, region: 0, x: 10, y: 0, r: 9 },
  { index: 2, region: 1, x: 100, y: 0, r: 2 },
  { index: 3, region: 2, x: 0, y: 200, r: 10 },
];
const RINGS = [square(0, -20, -20, 20, 20), square(1, 99, -1, 101, 1)];
const land = () => new LandIndex(RINGS, REALMS);

describe('latticePoint', () => {
  it('lays rows 1.4 apart, slots 1.6 along a row, odd rows offset by 0.8', () => {
    expect(latticePoint(0, 0)).toEqual({ i: 0, j: 0, x: 0, y: 0 });
    expect(latticePoint(1, 0)).toEqual({ i: 1, j: 0, x: 1.6, y: 0 });
    expect(latticePoint(0, 1)).toEqual({ i: 0, j: 1, x: 0.8, y: 1.4 });
    expect(latticePoint(2, 3)).toEqual({ i: 2, j: 3, x: 4, y: 4.2 });
  });

  it('offsets negative odd rows the same way', () => {
    const p = latticePoint(-1, -1);
    expect(p.x).toBeCloseTo(-0.8, 12);
    expect(p.y).toBeCloseTo(-1.4, 12);
    expect(latticePoint(0, -2).x).toBe(0);
  });

  it('keeps neighbours on a row and across rows at least one pitch apart', () => {
    const a = latticePoint(5, 4);
    for (const [i, j] of [[6, 4], [5, 5], [4, 5], [5, 3], [4, 3]] as const) {
      const b = latticePoint(i, j);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(1.6 - 1e-9);
    }
  });
});

describe('pencilTarget', () => {
  const realm: RealmCircle = { index: 7, region: 0, x: 30, y: -12, r: 20 };

  it('stays within 85 % of the realm radius from its centre', () => {
    for (let n = 0; n < 500; n++) {
      const t = pencilTarget(hashOf(String(1_000_000 + n)), realm);
      expect(Math.hypot(t.x - realm.x, t.y - realm.y)).toBeLessThanOrEqual(realm.r * 0.85 + 1e-9);
    }
  });

  it('reaches the edges of that disc exactly as the hash bytes say', () => {
    expect(pencilTarget('0000000000000000', realm)).toEqual({ x: realm.x, y: realm.y });
    const rim = pencilTarget('00000000ffffffff', realm);
    expect(rim.y).toBeCloseTo(realm.y, 9);
    expect(rim.x - realm.x).toBeCloseTo(realm.r * 0.85, 4);
    const quarter = pencilTarget('40000000ffffffff', realm); // a quarter turn
    expect(quarter.x).toBeCloseTo(realm.x, 4);
    expect(quarter.y - realm.y).toBeCloseTo(realm.r * 0.85, 4);
  });

  it('is deterministic, and different hashes land in different places', () => {
    const a = hashOf('41245072');
    const b = hashOf('71092938');
    expect(pencilTarget(a, realm)).toEqual(pencilTarget(a, { ...realm }));
    expect(pencilTarget(a, realm)).not.toEqual(pencilTarget(b, realm));
  });
});

describe('LandIndex', () => {
  it('tells land from sea and the realm by power distance within the land’s region', () => {
    const index = land();
    expect(index.regionAt(0, 0)).toBe(0);
    expect(index.regionAt(30, 0)).toBe(-1);
    expect(index.realmAt(-12, 3)).toBe(0);
    expect(index.realmAt(12, -3)).toBe(1);
    expect(index.realmAt(100, 0)).toBe(2);
    expect(index.realmAt(0, 200)).toBe(-1); // region 2 has no coast: all sea
    expect(index.distanceToCoast(0, 0, 50)).toBeCloseTo(20, 9);
    expect(index.distanceToCoast(19, 0, 5)).toBeCloseTo(1, 9);
  });
});

describe('nearestFreeSlot', () => {
  const realm = REALMS[0]!;
  const target = { x: -10.3, y: 0.6 };

  it('takes the lattice slot nearest the target when it is free land of the realm', () => {
    const slot = nearestFreeSlot(land(), new Occupancy(), new Set(), realm, target)!;
    expect(slot).not.toBeNull();
    expect(slot).toEqual(latticePoint(slot.i, slot.j));
    // No lattice point near the target is closer than the one chosen.
    const d = Math.hypot(slot.x - target.x, slot.y - target.y);
    for (let j = -3; j <= 3; j++) {
      for (let i = -9; i <= -4; i++) {
        const p = latticePoint(i, j);
        expect(Math.hypot(p.x - target.x, p.y - target.y)).toBeGreaterThanOrEqual(d - 1e-12);
      }
    }
  });

  it('skips taken slots, one after another, never handing out the same slot twice', () => {
    const index = land();
    const taken = new Set<string>();
    let lastDistance = 0;
    for (let n = 0; n < 12; n++) {
      const slot = nearestFreeSlot(index, new Occupancy(), taken, realm, target)!;
      const key = `${slot.i}:${slot.j}`;
      expect(taken.has(key)).toBe(false);
      const d = Math.hypot(slot.x - target.x, slot.y - target.y);
      expect(d).toBeGreaterThanOrEqual(lastDistance - 1e-12);
      lastDistance = d;
      taken.add(key);
    }
  });

  it('refuses the sea and keeps a hamlet’s disc clear of the shore', () => {
    const index = land();
    // Aim just inside the west coast: the slots there are too close to the water.
    const coastal = { x: -19.7, y: 0 };
    const slot = nearestFreeSlot(index, new Occupancy(), new Set(), realm, coastal)!;
    expect(index.realmAt(slot.x, slot.y)).toBe(realm.index);
    expect(index.distanceToCoast(slot.x, slot.y, CLEARANCE)).toBeGreaterThanOrEqual(CLEARANCE);
    expect(slot.x).toBeGreaterThanOrEqual(-20 + CLEARANCE);
    // Aim out at sea: the answer is still on the realm's land.
    const offshore = nearestFreeSlot(index, new Occupancy(), new Set(), realm, { x: -26, y: 0 })!;
    expect(index.regionAt(offshore.x, offshore.y)).toBe(0);
    expect(index.realmAt(offshore.x, offshore.y)).toBe(realm.index);
  });

  it('never crosses into a neighbouring realm, however close the target', () => {
    const index = land();
    const slot = nearestFreeSlot(index, new Occupancy(), new Set(), realm, { x: 0.5, y: 0 })!;
    expect(index.realmAt(slot.x, slot.y)).toBe(0);
    // x = 0 is equally far from both rims; the tie goes to the realm listed first, which is this one.
    expect(slot.x).toBeLessThanOrEqual(0);
    expect(index.realmAt(1.6, 0)).toBe(1);
  });

  it('keeps the gap from every holding', () => {
    const occupancy = new Occupancy();
    occupancy.add(-10, 0, 3.4);
    const slot = nearestFreeSlot(land(), occupancy, new Set(), realm, { x: -10, y: 0 })!;
    expect(Math.hypot(slot.x + 10, slot.y)).toBeGreaterThanOrEqual(3.4 + HAMLET_RADIUS + HOLDING_GAP - 1e-9);
    // Without the holding the very same target takes the slot under it.
    const bare = nearestFreeSlot(land(), new Occupancy(), new Set(), realm, { x: -10, y: 0 })!;
    expect(Math.hypot(bare.x + 10, bare.y)).toBeLessThan(1);
  });

  it('returns null when the realm has no free land', () => {
    const index = land();
    // No coast at all in the realm's region.
    expect(nearestFreeSlot(index, new Occupancy(), new Set(), REALMS[3]!, { x: 0, y: 200 })).toBeNull();
    // An islet narrower than a hamlet and its shore.
    expect(nearestFreeSlot(index, new Occupancy(), new Set(), REALMS[2]!, { x: 100, y: 0 })).toBeNull();
    // A realm whose land is entirely covered by one great holding.
    const covered = new Occupancy();
    covered.add(0, 0, 60);
    expect(nearestFreeSlot(index, covered, new Set(), realm, { x: -10, y: 0 })).toBeNull();
  });

  it('returns null once every slot of a small realm has been taken', () => {
    const tiny: RealmCircle[] = [{ index: 0, region: 0, x: 0, y: 0, r: 3 }];
    const index = new LandIndex([square(0, -4, -4, 4, 4)], tiny);
    const taken = new Set<string>();
    let slot = nearestFreeSlot(index, new Occupancy(), taken, tiny[0]!, { x: 0, y: 0 });
    let count = 0;
    while (slot && count < 200) {
      taken.add(`${slot.i}:${slot.j}`);
      count++;
      slot = nearestFreeSlot(index, new Occupancy(), taken, tiny[0]!, { x: 0, y: 0 });
    }
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(200);
    expect(slot).toBeNull();
  });

  it('is deterministic', () => {
    const a = nearestFreeSlot(land(), new Occupancy(), new Set(['-6:0']), realm, target);
    const b = nearestFreeSlot(land(), new Occupancy(), new Set(['-6:0']), realm, target);
    expect(a).toEqual(b);
  });
});
