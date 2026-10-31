import { describe, expect, it } from 'vitest';
import { generateSettlementPlan, samplePublicGround, terrainHeight, type SettlementPlan } from '@chatdom/world';
import { createLandCandidate, LAND_MATERIALS, PROTECTION_CLEARANCE, type BoundsXZ } from './stand-in';

const BOUNDS: BoundsXZ = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };
const plan = generateSettlementPlan({ seed: 'simulated-founded-town', tier: 'town', firstYear: 2022, year: 2026 });
const make = (input: SettlementPlan = plan) => createLandCandidate({ plan: input, bounds: BOUNDS,
  ground: (x, z) => terrainHeight(input, x, z), publicGround: (x, z) => samplePublicGround(input, x, z) });

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Each case samples thousands of real settlement-ground corners; allow for a loaded host.
describe('picture-land candidate stand-in', { timeout: 30_000 }, () => {
  it('is the pinned founded geography', () => {
    expect(plan.revision).toBe('settlement:2:23b3c1b5');
    expect(plan.homes).toHaveLength(240);
    expect(plan.landform.version).toBe(1);
  });

  it('samples deterministically and finitely across the town and its horizon', () => {
    const a = make(), b = make();
    for (let z = -990; z <= 990; z += 37.5) for (let x = -990; x <= 990; x += 41.25) {
      const h = a.height(x, z);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBe(b.height(x, z));
      expect(a.material(x, z)).toBe(b.material(x, z));
      expect(LAND_MATERIALS).toContain(a.material(x, z));
    }
  });

  it('keeps every protected corner exactly on the accepted ground', () => {
    const candidate = make();
    let checked = 0;
    const exact = (x: number, z: number): void => {
      for (const [cx, cz] of [[Math.floor(x), Math.floor(z)], [Math.ceil(x), Math.ceil(z)]] as const) {
        if (candidate.protection(cx, cz) > PROTECTION_CLEARANCE) continue;
        expect(candidate.corner(cx, cz)).toBe(Math.fround(terrainHeight(plan, cx, cz)));
        checked++;
      }
    };
    // Every home foundation, every active street vertex, the castle court, the market and the lake shore.
    for (const home of plan.homes) {
      const { lot } = home;
      for (let t = 0; t <= 1; t += 0.25) for (let u = 0; u <= 1; u += 0.25) exact(lot.minX + (lot.maxX - lot.minX) * t, lot.minZ + (lot.maxZ - lot.minZ) * u);
    }
    const active = new Set(plan.activeStreetIds);
    for (const street of plan.streets) if (active.has(street.id)) for (const point of street.points) exact(point[0], point[2]);
    for (const [x, z] of [...plan.castle.court.boundary, ...plan.market.boundary]) exact(x, z);
    const { lake } = plan;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) exact(lake.x + Math.cos(a) * lake.radiusX * 1.2, lake.z + Math.sin(a) * lake.radiusZ * 1.2);
    expect(checked).toBeGreaterThan(5000);
  });

  it('protects every home footprint and street centre, and the contact surface over them is the accepted one', () => {
    const candidate = make();
    for (const home of plan.homes.slice(0, 60)) {
      const x = (home.lot.minX + home.lot.maxX) / 2, z = (home.lot.minZ + home.lot.maxZ) / 2;
      expect(candidate.protection(x, z)).toBeLessThanOrEqual(0);
      // Triangle contact inside a protected footprint equals the accepted ground's own contact.
      expect(candidate.height(x + 0.3, z + 0.7)).toBeCloseTo(terrainHeight(plan, x + 0.3, z + 0.7), 5);
      expect(candidate.height(home.position[0], home.position[2])).toBeCloseTo(terrainHeight(plan, home.position[0], home.position[2]), 5);
    }
    const crown = plan.streets.find(street => street.id === 'road:castle')!;
    for (const point of crown.points) expect(candidate.protection(point[0], point[2])).toBeLessThanOrEqual(0);
  });

  it('actually sculpts land beyond the protected town: ridges, ledges and rock', () => {
    const candidate = make();
    let lifted = 0, rock = 0, ledges = 0;
    for (let z = -330; z <= -150; z += 1) for (let x = -260; x <= 260; x += 3) {
      if (candidate.height(x, z) - terrainHeight(plan, x, z) > 6) lifted++;
      const material = candidate.material(x, z);
      if (material === 'rock') rock++;
      if (material === 'ledge') ledges++;
    }
    expect(lifted).toBeGreaterThan(3000);
    expect(rock).toBeGreaterThan(300);
    expect(ledges).toBeGreaterThan(50);
  });

  it('derives material from the same corners as height', () => {
    const candidate = make();
    for (let z = -300; z <= -120; z += 7) for (let x = -240; x <= 240; x += 5) {
      const ix = Math.floor(x), iz = Math.floor(z);
      const corners = [candidate.height(ix, iz), candidate.height(ix + 1, iz), candidate.height(ix, iz + 1), candidate.height(ix + 1, iz + 1)];
      const rise = Math.max(...corners) - Math.min(...corners);
      const material = candidate.material(x, z);
      if (rise >= 1.05) expect(['rock', 'paving', 'trail', 'waterbed']).toContain(material);
      if (material === 'rock') expect(rise).toBeGreaterThanOrEqual(0.5);
      if (material === 'grass' || material === 'heath' || material === 'ledge') expect(rise).toBeLessThan(0.5);
    }
  });

  it('interpolates the accepted 00→11 triangles between its own corners', () => {
    const candidate = make();
    for (const [x, z] of [[-150.25, -210.75], [37.6, -260.1], [-300.5, 40.5], [610.2, -700.9]] as const) {
      const ix = Math.floor(x), iz = Math.floor(z), u = x - ix, v = z - iz;
      const h00 = candidate.corner(ix, iz), h01 = candidate.corner(ix, iz + 1), h10 = candidate.corner(ix + 1, iz), h11 = candidate.corner(ix + 1, iz + 1);
      const expected = u <= v ? h00 + u * (h11 - h01) + v * (h01 - h00) : h00 + u * (h10 - h00) + v * (h11 - h10);
      expect(candidate.height(x, z)).toBeCloseTo(expected, 6);
      expect(candidate.height(ix, iz)).toBe(h00);
    }
  });

  it('never mutates the plan, works on a frozen plan and refuses unbounded queries', () => {
    const snapshot = JSON.stringify(plan);
    const frozen = deepFreeze(structuredClone(plan));
    const candidate = make(frozen);
    for (let i = 0; i < 400; i++) { candidate.height(-200 + i, -250 + i * 0.7); candidate.material(-200 + i, -250 + i * 0.7); }
    expect(JSON.stringify(plan)).toBe(snapshot);
    expect(JSON.stringify(frozen)).toBe(snapshot);
    expect(() => candidate.height(1000.5, 0)).toThrow(RangeError);
    expect(() => candidate.height(Number.NaN, 0)).toThrow(RangeError);
    expect(() => createLandCandidate({ plan, bounds: { minX: -2000, maxX: 0, minZ: 0, maxZ: 10 }, ground: () => 0, publicGround: () => undefined })).toThrow(RangeError);
    expect(Object.isFrozen(candidate.bounds)).toBe(true);
  });
});
