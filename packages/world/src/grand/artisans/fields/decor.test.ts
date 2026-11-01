import { describe, expect, it } from 'vitest';
import { M } from '../../palette';
import { Cover, type FieldPlot } from '../../types';
import { createFieldDecorSampler, fieldDecorFurrow, fieldDecorHeight, fieldDecorMaterial, FIELD_DECOR_FALLBACK, type FieldDecorLand } from './decor';

function fixture(crop: number, rows: 0 | 1 = 0): FieldDecorLand {
  const size = 64, n = size * size;
  const p: FieldPlot = { x0: 16, x1: 48, z0: 16, z1: 48, rows, crop };
  const land: FieldDecorLand = { size, seed: { seedKey: 'test-realm', kingdomId: '1', name: 'test', biome: 'meadow', tier: 'hamlet', character: 'river-valley' }, ground: new Uint16Array(n).fill(20), water: new Uint16Array(n), cover: new Uint8Array(n), plot: new Uint16Array(n), plots: [p] };
  for (let z = p.z0; z < p.z1; z++) for (let x = p.x0; x < p.x1; x++) { land.cover[x + z * size] = Cover.field; land.plot[x + z * size] = 1; }
  return land;
}

describe('source-field decor sampler', () => {
  it('honours field, water and plot masks without changing ground or other arrays', () => {
    const land = fixture(M.crop.wheat), sample = createFieldDecorSampler(land);
    const i = 20 + 20 * land.size;
    const before = [...land.ground];
    expect(sample(0, 0)).toBe(FIELD_DECOR_FALLBACK);
    land.cover[i] = Cover.reserved; expect(sample(20, 20)).toBe(FIELD_DECOR_FALLBACK);
    land.cover[i] = Cover.field; land.water[i] = 21; expect(sample(20, 20)).toBe(0);
    land.water[i] = 0; land.plot[i] = 0; expect(sample(20, 20)).toBe(0);
    expect([...land.ground]).toEqual(before);
    expect(sample(64, 0)).toBe(FIELD_DECOR_FALLBACK);
  });
  it('dresses only existing dry hedge cells, preserving cover gaps', () => {
    const land = fixture(M.crop.wheat), i = 10 + 10 * land.size;
    land.cover[i] = Cover.hedge;
    const sample = createFieldDecorSampler(land);
    expect(fieldDecorHeight(sample(10, 10))).toBeGreaterThanOrEqual(2);
    expect(sample(11, 10)).toBe(FIELD_DECOR_FALLBACK);
    land.water[i] = 21;
    expect(sample(10, 10)).toBe(0);
  });
  it('keeps unsupported crops on the producer fallback', () => {
    const sample = createFieldDecorSampler(fixture(M.crop.sunflower));
    expect(sample(18, 18)).toBe(FIELD_DECOR_FALLBACK);
  });
  it('builds bounded contiguous profiles with crop-specific plants and real gaps', () => {
    for (const crop of [M.crop.wheat, M.crop.wheatPale, M.crop.lavender, M.crop.lavenderDark, M.crop.cabbage]) {
      const sample = createFieldDecorSampler(fixture(crop));
      const profiles = Array.from({ length: 32 * 32 }, (_, k) => sample(16 + k % 32, 16 + Math.floor(k / 32)));
      expect(profiles.some(v => v === 0)).toBe(true);
      expect(profiles.some(v => fieldDecorHeight(v) >= 2)).toBe(true);
      for (const profile of profiles) {
        const height = fieldDecorHeight(profile); expect(height).toBeLessThanOrEqual(3);
        for (let step = 0; step < height; step++) expect(fieldDecorMaterial(profile, step)).toBeGreaterThan(0);
        expect(fieldDecorMaterial(profile, height)).toBe(0);
      }
    }
  });
  it('aligns bare soil furrows to supported plot-relative empty rows only', () => {
    for (const crop of [M.crop.wheat, M.crop.wheatPale, M.crop.lavender, M.crop.lavenderDark]) for (const rows of [0, 1] as const) {
      const land = fixture(crop, rows), plot = land.plots[0]!, sample = createFieldDecorSampler(land);
      for (let z = plot.z0; z < plot.z1; z++) for (let x = plot.x0; x < plot.x1; x++) {
        const across = rows === 0 ? z - plot.z0 : x - plot.x0;
        expect(fieldDecorFurrow(plot, x, z)).toBe(across % 3 === 2);
        if (fieldDecorFurrow(plot, x, z)) expect(sample(x, z)).toBe(0);
      }
    }
    const other = fixture(M.crop.cabbage).plots[0]!;
    expect(fieldDecorFurrow(other, 18, 18)).toBeNull();
  });
  it('is stable at chunk borders and transposes row direction with its plot', () => {
    const land = fixture(M.crop.lavender, 0);
    const a = createFieldDecorSampler(land), otherWorker = createFieldDecorSampler(land);
    const b = createFieldDecorSampler(fixture(M.crop.lavender, 1));
    const original = new Map<string, number>(), tiled = new Map<string, number>();
    for (let z = 16; z < 48; z++) for (let x = 16; x < 48; x++) {
      original.set(`${x},${z}`, a(x, z));
      expect(fieldDecorHeight(a(x, z))).toBe(fieldDecorHeight(b(z, x)));
    }
    // Revisit halos in reverse tile order, including each neighbour's shared edge.
    for (const start of [32, 16]) for (let z = 16; z < 48; z++) for (let x = start - 1; x <= start + 16; x++) {
      if (x >= 16 && x < 48) tiled.set(`${x},${z}`, otherWorker(x, z));
    }
    expect(tiled.size).toBe(original.size);
    for (const [key, value] of original) expect(tiled.get(key)).toBe(value);
    const shifted = { ...land, seed: { ...land.seed, seedKey: 'another-realm' } };
    const other = createFieldDecorSampler(shifted);
    expect([...original].some(([key, value]) => { const [x, z] = key.split(',').map(Number); return other(x!, z!) !== value; })).toBe(true);
  });
});
