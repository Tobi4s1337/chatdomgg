import { describe, expect, it } from 'vitest';
import { createSurfaceLandWater } from './water-source';
import { groundAt, waterAt, type WaterGround } from '../../places/water/surface/coverage';
import { rasterWaterAt } from '../../places/water/surface/raster';
import type { LandGroundSource } from '../../../../../packages/world/src/land-interface';

const scene = { layoutRevision: 'water-test', collisionRevision: 4 };
const physical = (height: (x: number, z: number) => number | null = () => -2): LandGroundSource => ({
  ...scene, sample: (x, z) => { const y = height(x, z); return y === null ? null : [x, y, z]; },
});
const grid = (width = 4, height = 4, step = 1, origin: readonly [number, number] = [0, 0]): WaterGround =>
  ({ width, height, step, origin, data: new Float32Array(width * height).fill(-1) });
const basin = { id: 'lake', x: 2, z: 2, radiusX: 1, radiusZ: 1, level: 1, depth: 2 };
const meta = { raster: { kind: 'sea' as const, biome: 'coast' }, lake: { kind: 'lake' as const, biome: 'woodland' } };
const rect = (minX: number, minZ: number, maxX: number, maxZ: number) => ({ minX, minZ, maxX, maxZ });

describe('renderer water land adapter', () => {
  it('matches raster renderer wet/dry cells but uses physical rather than interpolated visual depth', () => {
    const ground = grid(), raster = { levels: new Float32Array(16).fill(1), seaLevel: 0 };
    raster.levels[1] = NaN;
    const water = createSurfaceLandWater(scene, physical(), { ground, raster, bodies: [], reaches: [] }, meta);
    expect(groundAt(ground, 0.25, 0.25)).toBe(-1);
    expect(rasterWaterAt(raster, ground, 0.25, 0.25)?.depth).toBe(2);
    expect(water.sample(0.25, 0.25)).toEqual({ state: 'wet', level: 1, depth: 3, ...meta.raster });
    expect(rasterWaterAt(raster, ground, 1.25, 0.25)).toBeNull();
    expect(water.sample(1.25, 0.25)).toEqual({ state: 'dry' });
    expect(water.sample(-0.001, 0)).toBeNull();
    expect(water.sample(4, 0)).toBeNull();
    expect(createSurfaceLandWater(scene, physical(() => null), { ground, raster, bodies: [], reaches: [] }, meta).sample(0, 0)).toBeNull();
  });

  it('distinguishes known zero-depth shore from unknown or submerged water', () => {
    const ground = grid(), raster = { levels: new Float32Array(16).fill(1), seaLevel: 0 };
    const surface = { ground, raster, bodies: [], reaches: [] };
    const shore = createSurfaceLandWater(scene, physical(() => 1), surface, meta);
    expect(shore.sample(.25, .25)).toEqual({ state: 'shore', level: 1, depth: 0, ...meta.raster });
    // A renderer surface buried below physical ground is not a valid shallow-water certificate.
    expect(createSurfaceLandWater(scene, physical(() => 1.5), surface, meta).sample(.25, .25)).toBeNull();
    expect(createSurfaceLandWater(scene, physical(() => null), surface, meta).sample(.25, .25)).toBeNull();
  });

  it('reports a tiny dry cell as shore and refuses changed water levels', () => {
    const ground = grid(4, 4, 0.25), levels = new Float32Array(16).fill(1);
    const raster = { levels, seaLevel: 0 };
    const source = createSurfaceLandWater(scene, physical(), { ground, raster, bodies: [], reaches: [] }, meta);
    expect(source.coverage(rect(0, 0, 0.5, 0.5))).toEqual({ state: 'wet', level: 1, minDepth: 3, ...meta.raster });
    // Each adapter is installed against an immutable raster snapshot.
    const dryLevels = levels.slice(); dryLevels[1] = NaN;
    const dry = createSurfaceLandWater(scene, physical(), { ground, raster: { ...raster, levels: dryLevels }, bodies: [], reaches: [] }, meta);
    expect(dry.coverage(rect(0, 0, 0.5, 0.5))).toEqual({ state: 'shore', level: 1, minDepth: 0, ...meta.raster });
    expect(dry.coverage(rect(0.25, 0, 0.5, 0.25))).toEqual({ state: 'dry' });
    const steppedLevels = levels.slice(); steppedLevels[1] = 2;
    const stepped = createSurfaceLandWater(scene, physical(), { ground, raster: { ...raster, levels: steppedLevels }, bodies: [], reaches: [] }, meta);
    expect(stepped.coverage(rect(0, 0, 0.5, 0.5))).toBeNull();
  });

  it('refuses mixed coverage when any tiny visual cell or physical column is unknown', () => {
    const ground = grid(4, 4, 0.25), levels = new Float32Array(16).fill(1);
    levels[1] = NaN;
    const surface = { ground, raster: { levels, seaLevel: 0 }, bodies: [], reaches: [] };
    const unknownVisual = grid(4, 4, 0.25); unknownVisual.data[5] = NaN;
    const visual = createSurfaceLandWater(scene, physical(), { ...surface, ground: unknownVisual }, meta);
    expect(visual.coverage(rect(0, 0, 0.75, 0.75))).toBeNull();
    const unknownPhysical = createSurfaceLandWater(scene, physical((x, z) => x >= 0.5 && z >= 0.5 ? null : -2), surface, meta);
    expect(unknownPhysical.coverage(rect(0, 0, 0.75, 0.75))).toBeNull();
  });

  it('handles negative origins and the renderer’s extended final raster cell', () => {
    const ground = grid(2, 2, 1, [-2, -3]), raster = { levels: new Float32Array(4).fill(1), seaLevel: 0 };
    const source = createSurfaceLandWater(scene, physical(), { ground, raster, bodies: [], reaches: [] }, meta);
    expect(source.sample(-0.01, -1.01)?.state).toBe('wet');
    expect(source.sample(0, -2)).toBeNull();
    expect(source.coverage(rect(-1, -2, 0, -1))).toEqual({ state: 'wet', level: 1, minDepth: 3, ...meta.raster });
    expect(source.coverage(rect(-1, -2, 0.01, -1))).toBeNull();
  });

  it('uses the actual ellipse including feather and refuses to certify mixed shoreline', () => {
    const ground = grid(6, 6), surface = { ground, bodies: [basin], reaches: [] };
    const source = createSurfaceLandWater(scene, physical(), surface, meta);
    expect(waterAt(surface.bodies, [], ground, 2, 2)?.id).toBe('lake');
    expect(source.sample(2, 2)).toEqual({ state: 'wet', level: 1, depth: 3, ...meta.lake });
    expect(source.sample(5, 5)).toEqual({ state: 'dry' });
    expect(source.coverage(rect(1.8, 1.8, 2.2, 2.2))).toEqual({ state: 'wet', level: 1, minDepth: 3, ...meta.lake });
    expect(source.coverage(rect(3.5, 1.8, 4, 2.2))).toEqual({ state: 'shore', level: 1, minDepth: 0, ...meta.lake });
    expect(source.coverage(rect(4.5, 4.5, 5, 5))).toEqual({ state: 'dry' });
    expect(createSurfaceLandWater(scene, physical(), { ...surface, bodies: [basin, { ...basin, id: 'other' }] }, meta).coverage(rect(1, 1, 2, 2))).toBeNull();
  });

  it('requires metadata for wet water and snapshots its description', () => {
    const ground = grid(), raster = { levels: new Float32Array(16).fill(1), seaLevel: 0 };
    const surface = { ground, raster, bodies: [], reaches: [] };
    const missing = createSurfaceLandWater(scene, physical(), surface, {});
    expect(missing.sample(0.25, 0.25)).toBeNull();
    expect(missing.coverage(rect(0, 0, 1, 1))).toBeNull();
    const description = { kind: 'sea' as const, biome: 'coast' };
    const source = createSurfaceLandWater(scene, physical(), surface, { raster: description });
    description.biome = 'changed';
    expect(source.sample(0.25, 0.25)).toEqual({ state: 'wet', level: 1, depth: 3, kind: 'sea', biome: 'coast' });
    expect(source.coverage(rect(0, 0, 1, 1))).toEqual({ state: 'wet', level: 1, minDepth: 3, kind: 'sea', biome: 'coast' });
  });

  it('treats invalid descriptions and non-finite visual ground as unknown', () => {
    const ground = grid(), raster = { levels: new Float32Array(16).fill(1), seaLevel: 0 };
    const surface = { ground, raster, bodies: [], reaches: [] };
    for (const description of [{ kind: 'ocean', biome: 'coast' }, { kind: 'sea', biome: '  ' }]) {
      const source = createSurfaceLandWater(scene, physical(), surface,
        { raster: description as typeof meta.raster });
      expect(source.sample(0.25, 0.25)).toBeNull();
      expect(source.coverage(rect(0, 0, 1, 1))).toBeNull();
    }
    const unknown = grid(); unknown.data[0] = NaN;
    const dry = createSurfaceLandWater(scene, physical(), { ...surface, ground: unknown,
      raster: { ...raster, levels: new Float32Array(16).fill(NaN) } }, meta);
    expect(dry.sample(0.25, 0.25)).toBeNull();
    expect(dry.coverage(rect(0, 0, 1, 1))).toBeNull();
  });

  it('samples an interpolated reach but does not certify its area', () => {
    const ground = grid(6, 6);
    const point = (x: number, level: number, s: number) => ({ position: [x, 2] as const, bed: -1, level,
      width: 1, depth: level + 1, s, tangent: [1, 0] as const, slope: 0.25, speed: 0.4,
      flow: [0.4, 0] as const, still: false });
    const reach = { id: 'stream', kind: 'stream' as const, length: 4, points: [point(0, 2, 0), point(4, 1, 4)],
      source: { kind: 'spring' as const }, mouth: { kind: 'open' as const }, openSpeed: 0.4 };
    const surface = { ground, bodies: [], reaches: [reach] };
    const metadata = { stream: { kind: 'river' as const, biome: 'woods' } };
    const source = createSurfaceLandWater(scene, physical(), surface, metadata);
    expect(waterAt([], [reach], ground, 2, 2)?.level).toBe(1.5);
    expect(source.sample(2, 2)).toEqual({ state: 'wet', level: 1.5, depth: 3.5, ...metadata.stream });
    expect(source.coverage(rect(1, 1, 2, 2))).toBeNull();
  });

  it('rejects invalid renderer grids and mismatched revisions', () => {
    const ground = grid(), raster = { levels: new Float32Array(16).fill(1), seaLevel: 0 };
    const surface = { ground, raster, bodies: [], reaches: [] };
    expect(() => createSurfaceLandWater(scene, { ...physical(), collisionRevision: 5 }, surface, meta)).toThrow();
    expect(() => createSurfaceLandWater(scene, physical(), { ...surface, ground: { ...ground, step: Infinity } }, meta)).toThrow();
    expect(() => createSurfaceLandWater(scene, physical(), { ...surface, raster: { ...raster, levels: new Float32Array(2) } }, meta)).toThrow();
  });
});
