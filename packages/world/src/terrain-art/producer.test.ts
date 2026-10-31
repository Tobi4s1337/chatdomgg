import { describe, expect, it } from 'vitest';
import { compileChannelGenesis } from '../genesis/index';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from '../genesis/observed-fixtures';
import { compileGenesisSettlement } from '../genesis/settlement';
import { sampleGenesisSurface } from '../genesis/surface';
import { generateSettlementPlan } from '../settlement/generator';
import { transformCardinalPoint } from '../settlement/geometry';
import { samplePublicGround, settlementTerrainHeight } from '../settlement/terrain';
import type { BoundsXZ, SettlementPlan } from '../settlement/types';
import { createTerrainArtCandidate, TERRAIN_ART_LIMITS, TERRAIN_ART_MATERIALS, TERRAIN_ART_PRODUCER, terrainArtBackdrop, type TerrainArtCandidate } from './index';

const BOUNDS: BoundsXZ = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };
const founded = generateSettlementPlan({ seed: 'simulated-founded-town', tier: 'town', firstYear: 2022, year: 2026 });
const make = (plan: SettlementPlan, bounds: BoundsXZ = BOUNDS): TerrainArtCandidate => createTerrainArtCandidate({ plan, bounds,
  ground: (x, z) => settlementTerrainHeight(plan, x, z), publicGround: (x, z) => samplePublicGround(plan, x, z) });
const { clearance, maxCut, maxLift } = TERRAIN_ART_LIMITS;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Asserts every guarded corner near (x, z) is the caller's ground, bit for bit. A point guarded by the plan
 * must itself be protected, so the test can't pass by finding nothing to check.
 */
function preserved(candidate: TerrainArtCandidate, plan: SettlementPlan, x: number, z: number): number {
  let checked = 0;
  expect(candidate.protection(x, z).distance).toBeLessThanOrEqual(clearance);
  for (const cx of [Math.floor(x), Math.ceil(x)]) for (const cz of [Math.floor(z), Math.ceil(z)]) {
    if (candidate.protection(cx, cz).distance > clearance) continue;
    expect(candidate.corner(cx, cz)).toBe(Math.fround(settlementTerrainHeight(plan, cx, cz)));
    checked++;
  }
  return checked;
}

const coastal = (() => {
  const index = OBSERVED_GENESIS_SHOWCASE_CHOICES.findIndex(choice => choice.character === 'coastal-harbour');
  const recipe = compileChannelGenesis(OBSERVED_GENESIS_FIXTURES[index]!);
  const landscape = recipe.landscapes.find(item => item.character === 'coastal-harbour')!;
  return compileGenesisSettlement(recipe, landscape.id);
})();

// Each case samples thousands of real settlement-ground corners; allow for a loaded host.
describe('picture-land producer on the pinned founded town', { timeout: 60_000 }, () => {
  it('is the pinned founded geography, with the ridges behind the keep', () => {
    expect(founded.revision).toBe('settlement:2:23b3c1b5');
    expect(founded.homes).toHaveLength(240);
    expect(founded.landform.version).toBe(1);
    const candidate = make(founded);
    expect(candidate.backdrop).toBe('north');
    expect(candidate.producer).toBe(TERRAIN_ART_PRODUCER);
    expect(candidate.planRevision).toBe(founded.revision);
    expect(candidate.candidateRevision).toBe(`${founded.revision}+${TERRAIN_ART_PRODUCER}`);
  });

  it('samples deterministically and finitely, whatever order it is asked in', () => {
    const forward = make(founded), backward = make(founded), points: [number, number][] = [];
    for (let z = -990; z <= 990; z += 37.5) for (let x = -990; x <= 990; x += 41.25) points.push([x, z]);
    for (let x = -120.5; x <= 140; x += 3.7) points.push([x, -60.25 + x * 0.3]);
    const heights = points.map(([x, z]) => forward.height(x, z)), materials = points.map(([x, z]) => forward.material(x, z));
    for (let i = points.length - 1; i >= 0; i--) {
      const [x, z] = points[i]!;
      expect(Number.isFinite(heights[i])).toBe(true);
      expect(backward.height(x, z)).toBe(heights[i]);
      expect(backward.material(x, z)).toBe(materials[i]);
      expect(TERRAIN_ART_MATERIALS).toContain(materials[i]);
    }
  });

  it('keeps every home, reservation, street (built or future), square and castle footing on the accepted ground', () => {
    const candidate = make(founded);
    let checked = 0;
    for (const { lot } of [...founded.homes, ...founded.reservations]) {
      for (let t = 0; t <= 1; t += 0.25) for (let u = 0; u <= 1; u += 0.25) checked += preserved(candidate, founded, lot.minX + (lot.maxX - lot.minX) * t, lot.minZ + (lot.maxZ - lot.minZ) * u);
    }
    // Every planned street, including the routes not yet opened.
    expect(founded.streets.length).toBeGreaterThan(founded.activeStreetIds.length);
    for (const street of founded.streets) for (const point of street.points) checked += preserved(candidate, founded, point[0], point[2]);
    for (const square of [founded.market, founded.castle.court, ...founded.courts]) for (const [x, z] of square.boundary) checked += preserved(candidate, founded, x, z);
    for (const module of founded.castle.modules) for (const lx of [0, module.size[0]]) for (const lz of [0, module.size[2]]) {
      const p = transformCardinalPoint(module.position, module.rotation, [lx, 0, lz]);
      checked += preserved(candidate, founded, p[0], p[2]);
    }
    expect(checked).toBeGreaterThan(8000);
  });

  it('names the guard, and keeps the lake and its dry bank exact', () => {
    const candidate = make(founded), { lake } = founded;
    const home = founded.homes[17]!;
    expect(candidate.protection((home.lot.minX + home.lot.maxX) / 2, (home.lot.minZ + home.lot.maxZ) / 2).guard).toBe('home');
    expect(candidate.protection(founded.castle.centre[0], founded.castle.centre[2]).distance).toBeLessThan(0);
    expect(candidate.protection(lake.x, lake.z).guard).toBe('water');
    expect(candidate.protection(-900, -900).guard).toBe('none');
    let checked = 0;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) for (const scale of [0.5, 1, 1.2, 1.3]) {
      checked += preserved(candidate, founded, lake.x + Math.cos(a) * lake.radiusX * scale, lake.z + Math.sin(a) * lake.radiusZ * scale);
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('collides on the accepted surface wherever the plan stands', () => {
    const candidate = make(founded);
    for (const home of founded.homes.slice(0, 80)) {
      const x = (home.lot.minX + home.lot.maxX) / 2, z = (home.lot.minZ + home.lot.maxZ) / 2;
      expect(candidate.height(x + 0.3, z + 0.7)).toBe(settlementTerrainHeight(founded, x + 0.3, z + 0.7));
      expect(candidate.height(home.position[0], home.position[2])).toBe(settlementTerrainHeight(founded, home.position[0], home.position[2]));
    }
    const crown = founded.streets.find(street => street.id === 'road:castle')!;
    for (const point of crown.points) expect(candidate.height(point[0], point[2])).toBe(settlementTerrainHeight(founded, point[0], point[2]));
  });

  it('stays within its cut and lift limits of the accepted ground', () => {
    const candidate = make(founded);
    let cut = 0, lift = 0;
    for (let z = -998; z <= 998; z += 13) for (let x = -998; x <= 998; x += 11) {
      const delta = candidate.corner(x, z) - Math.fround(settlementTerrainHeight(founded, x, z));
      cut = Math.min(cut, delta); lift = Math.max(lift, delta);
    }
    expect(cut).toBeGreaterThanOrEqual(-maxCut - 1e-3);
    expect(lift).toBeLessThanOrEqual(maxLift + 1e-3);
    // It really is a landscape, not a light dusting.
    expect(lift).toBeGreaterThan(150);
  });

  it('sculpts the land behind the town into ridges, ledges and rock', () => {
    const candidate = make(founded);
    let lifted = 0, rock = 0, ledges = 0;
    for (let z = -330; z <= -150; z += 1) for (let x = -260; x <= 260; x += 3) {
      if (candidate.height(x, z) - settlementTerrainHeight(founded, x, z) > 6) lifted++;
      const material = candidate.material(x, z);
      if (material === 'rock') rock++;
      if (material === 'ledge') ledges++;
    }
    expect(lifted).toBeGreaterThan(3000);
    expect(rock).toBeGreaterThan(300);
    expect(ledges).toBeGreaterThan(50);
  });

  it('derives material from the same corners as height', () => {
    const candidate = make(founded);
    for (let z = -300; z <= 60; z += 7) for (let x = -240; x <= 240; x += 5) {
      const ix = Math.floor(x), iz = Math.floor(z);
      const corners = [candidate.height(ix, iz), candidate.height(ix + 1, iz), candidate.height(ix, iz + 1), candidate.height(ix + 1, iz + 1)];
      const rise = Math.max(...corners) - Math.min(...corners);
      const material = candidate.material(x, z);
      // Any spot in the patch names the patch.
      expect(candidate.material(ix + 0.9, iz + 0.1)).toBe(material);
      if (rise >= 1.05) expect(['rock', 'paving', 'trail', 'waterbed']).toContain(material);
      if (material === 'rock') expect(rise).toBeGreaterThanOrEqual(0.5);
      if (material === 'grass' || material === 'heath' || material === 'ledge') expect(rise).toBeLessThan(0.5);
    }
  });

  it('interpolates the accepted 00→11 triangles between its own corners', () => {
    const candidate = make(founded);
    for (const [x, z] of [[-150.25, -210.75], [37.6, -260.1], [-300.5, 40.5], [610.2, -700.9], [12.5, 30.25]] as const) {
      const ix = Math.floor(x), iz = Math.floor(z), u = x - ix, v = z - iz;
      const h00 = candidate.corner(ix, iz), h01 = candidate.corner(ix, iz + 1), h10 = candidate.corner(ix + 1, iz), h11 = candidate.corner(ix + 1, iz + 1);
      const expected = u <= v ? h00 + u * (h11 - h01) + v * (h01 - h00) : h00 + u * (h10 - h00) + v * (h11 - h10);
      expect(candidate.height(x, z)).toBeCloseTo(expected, 6);
      expect(candidate.height(ix, iz)).toBe(h00);
    }
  });

  it('never mutates the plan, works on a frozen plan, and refuses unbounded queries', () => {
    const snapshot = JSON.stringify(founded);
    const frozen = deepFreeze(structuredClone(founded));
    const bounds = { ...BOUNDS };
    const candidate = make(frozen, bounds);
    bounds.maxX = 9999;
    for (let i = 0; i < 400; i++) { candidate.height(-200 + i, -250 + i * 0.7); candidate.material(-200 + i, -250 + i * 0.7); candidate.protection(-200 + i, 0); }
    expect(JSON.stringify(founded)).toBe(snapshot);
    expect(JSON.stringify(frozen)).toBe(snapshot);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.bounds)).toBe(true);
    expect(candidate.bounds.maxX).toBe(1000);
    expect(() => candidate.height(1000.5, 0)).toThrow(RangeError);
    expect(() => candidate.height(Number.NaN, 0)).toThrow(RangeError);
    expect(() => candidate.corner(0.5, 0)).toThrow(RangeError);
    for (const bad of [{ minX: -2000, maxX: 0, minZ: 0, maxZ: 10 }, { minX: 0, maxX: 0, minZ: 0, maxZ: 10 }, { minX: 0, maxX: Infinity, minZ: 0, maxZ: 10 }]) {
      expect(() => createTerrainArtCandidate({ plan: founded, bounds: bad, ground: () => 0, publicGround: () => undefined })).toThrow(RangeError);
    }
    const broken = createTerrainArtCandidate({ plan: founded, bounds: BOUNDS, ground: () => Number.NaN, publicGround: () => undefined });
    expect(() => broken.height(0, 0)).toThrow();
  });

  it('returns the same values for any bounds that contain the query', () => {
    const wide = make(founded), narrow = make(founded, { minX: -300, maxX: 300, minZ: -400, maxZ: 120 });
    for (let z = -390; z <= 110; z += 23.5) for (let x = -290; x <= 290; x += 19.25) expect(narrow.height(x, z)).toBe(wide.height(x, z));
  });
});

describe('picture-land producer on a coastal Genesis plan', { timeout: 60_000 }, () => {
  const surface = coastal.genesisSurface!;
  const oceanSide = (['south', 'east', 'north', 'west'] as const)[surface.coast.oceanToward];

  it('reads a v2 landform with a Genesis surface and never raises its ridges from the sea', () => {
    expect(coastal.landform.version).toBe(2);
    const candidate = make(coastal);
    expect(candidate.backdrop).not.toBe(oceanSide);
    expect(terrainArtBackdrop(coastal)).toBe(candidate.backdrop);
    let wet = 0;
    for (let z = -900; z <= 900; z += 9) for (let x = -900; x <= 900; x += 9) {
      const h = candidate.height(x, z);
      expect(Number.isFinite(h)).toBe(true);
      if (sampleGenesisSurface(surface, x, z).shoreDistance < 6 + clearance) {
        expect(candidate.corner(x, z)).toBe(Math.fround(settlementTerrainHeight(coastal, x, z)));
        wet++;
      }
    }
    expect(wet).toBeGreaterThan(500);
  });

  it('keeps every Genesis home, reservation and street on its ground', () => {
    const candidate = make(coastal);
    let checked = 0;
    for (const { lot } of [...coastal.homes, ...coastal.reservations]) for (const [x, z] of [[lot.minX, lot.minZ], [lot.maxX, lot.maxZ], [(lot.minX + lot.maxX) / 2, (lot.minZ + lot.maxZ) / 2]] as const) {
      checked += preserved(candidate, coastal, x, z);
    }
    for (const street of coastal.streets) for (const point of street.points) checked += preserved(candidate, coastal, point[0], point[2]);
    expect(checked).toBeGreaterThan(500);
  });
});
