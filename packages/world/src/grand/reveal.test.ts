import { describe, expect, it } from 'vitest';
import { generateGrandLand } from './generate';
import {
  GRAND_REVEAL_MILESTONES, GRAND_REVEAL_STAGES, grandRevealField, grandRevealMask, grandRevealOpening, grandRevealStage,
  type GrandRevealSurface,
} from './reveal';
import { grandWorldTraits } from './world';

/** A small synthetic land: a round island with a ridge across it and a lake, in half-metre cells. */
function island(size = 512): GrandRevealSurface {
  const ground = new Uint16Array(size * size), water = new Uint16Array(size * size), sea = 48;
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const i = x + z * size, d = Math.hypot(x - size / 2, z - size / 2) / (size * 0.42);
    let h = d < 1 ? sea + 4 + 30 * (1 - d) : sea - 20;
    if (d < 1 && Math.abs(z - size * 0.62) < 14) h += 120;
    if (Math.hypot(x - size * 0.3, z - size * 0.4) < 30) { h = sea + 10; water[i] = sea + 14; }
    ground[i] = h;
    if (h < sea) water[i] = sea;
  }
  return { size, seaLevel: sea, ground, water };
}
const home = { x0: 240, z0: 200, x1: 290, z1: 250 };

describe('the land opens as its people arrive', () => {
  it('moves through the milestones and never back', () => {
    let last = 0;
    for (let citizens = 0; citizens <= 6000; citizens += 7) {
      const stage = grandRevealStage(citizens);
      expect(stage).toBeGreaterThanOrEqual(last);
      last = stage;
    }
    expect(grandRevealStage(9)).toBe(0);
    expect(grandRevealStage(5000)).toBe(GRAND_REVEAL_STAGES - 1);
    GRAND_REVEAL_MILESTONES.forEach((citizens, stage) => expect(grandRevealStage(citizens)).toBe(stage));
    expect(() => grandRevealStage(-1)).toThrow();
    expect(() => grandRevealStage(Number.NaN)).toThrow();
  });

  it('is pure: the same land and count give the same mist', () => {
    const a = grandRevealField(island(), home), b = grandRevealField(island(), home);
    for (let stage = 0; stage < GRAND_REVEAL_STAGES; stage++) expect(grandRevealMask(a, stage)).toEqual(grandRevealMask(b, stage));
    expect(a.budgets).toEqual(b.budgets);
  });

  it('never closes what was open, keeps the town clear and ends with the whole land', () => {
    const field = grandRevealField(island(), home);
    let previous: Uint8Array | null = null;
    for (let stage = 0; stage < GRAND_REVEAL_STAGES; stage++) {
      const mask = grandRevealMask(field, stage);
      if (previous) for (let c = 0; c < mask.length; c++) expect(mask[c]!).toBeGreaterThanOrEqual(previous[c]!);
      for (let z = home.z0 / field.cell; z < home.z1 / field.cell; z++) for (let x = Math.floor(home.x0 / field.cell); x < home.x1 / field.cell; x++)
        expect(mask[Math.floor(x) + Math.floor(z) * field.cells]).toBe(255);
      previous = mask;
    }
    expect(previous!.every(v => v === 255)).toBe(true);
    // The ridge holds the mist longer than the open lowland at the same distance.
    const at = (x: number, z: number) => field.cost[Math.floor(x / field.cell) + Math.floor(z / field.cell) * field.cells]!;
    expect(at(256, 330)).toBeGreaterThan(at(256 + 60, 150));
  });

  it('judges what each stage opened on a real raised land', () => {
    const seedKey = '["channel","90210"]';
    const world = { ...grandWorldTraits({ seedKey, character: 'river-valley', identity: { biome: 'woodland', landmark: 'lighthouse', profileColourTargets: [] } }), landform: 'lake-country' as const };
    const land = generateGrandLand({ seedKey, kingdomId: '90210', name: 'Test', biome: 'woodland', tier: 'hamlet', character: 'river-valley', world });
    const t = land.sites.town;
    const field = grandRevealField(land, { x0: Math.round(t.x - t.rx), z0: Math.round(t.z - t.rz), x1: Math.round(t.x + t.rx), z1: Math.round(t.z + t.rz) });
    const openings = Array.from({ length: GRAND_REVEAL_STAGES }, (_, stage) => grandRevealOpening(field, stage));
    expect(openings[0]!.kind).toBe('founding');
    expect(openings.at(-1)!.kind).toBe('whole');
    for (const opening of openings.slice(1)) {
      expect(opening.opened).toBeGreaterThan(0.02);
      expect(opening.line.length).toBeGreaterThan(10);
    }
    // The founding valley is a hamlet's world, not the island: most of the land waits under the mist.
    const first = grandRevealMask(field, 0);
    let clear = 0, dry = 0;
    for (let c = 0; c < first.length; c++) if (field.kind[c] !== 2) { dry++; if (first[c] === 255) clear++; }
    expect(clear / dry).toBeLessThan(0.35);
  }, 60_000);
});
