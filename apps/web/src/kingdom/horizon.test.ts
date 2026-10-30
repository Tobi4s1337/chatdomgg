import { describe, expect, it } from 'vitest';
import { createHorizonSurface } from './horizon';

const layout = { bounds: { minX: -17, maxX: 19, minZ: -15, maxZ: 18 } };
// Curvature makes triangle-plane interpolation distinguishable from analytic sampling.
const ground = (x: number, z: number): number => 7 + x / 16 - z / 32 + (x * x + z * z) / 1024;

describe.each([10, 20] as const)('horizon at %d m detail', farStep => {
  it('joins the detailed terrain and samples representative rendered planes', () => {
    // Omitting farStep exercises the production default in the 10 m case.
    const options = farStep === 10 ? { sampleTerrain: ground } : { sampleTerrain: ground, farStep };
    const { geometry, clipBounds, sampleHeight } = createHorizonSurface(layout, options);
    expect(clipBounds).toEqual([-32, 32, -16, 32]);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const index = geometry.index!;
    const wanted = new Set(['-32,0', '32,0', '0,-16', '0,32']);
    for (let i = 0; i < position.count && wanted.size; i++) {
      const x = position.getX(i), z = position.getZ(i), key = `${x},${z}`;
      if (!wanted.has(key)) continue;
      expect(position.getY(i)).toBe(Math.fround(ground(x, z)));
      const nx = (Math.fround(ground(x - 1, z)) - Math.fround(ground(x + 1, z))) / 2;
      const nz = (Math.fround(ground(x, z - 1)) - Math.fround(ground(x, z + 1))) / 2;
      const length = Math.hypot(nx, 1, nz);
      expect(normal.getX(i)).toBeCloseTo(nx / length, 6);
      expect(normal.getY(i)).toBeCloseTo(1 / length, 6);
      expect(normal.getZ(i)).toBeCloseTo(nz / length, 6);
      wanted.delete(key);
    }
    expect(wanted.size).toBe(0);

    // Test actual triangle planes in far terrain, the outer fan and the 1 m collar.
    const outerX = Math.ceil(clipBounds[1] / farStep) * farStep + farStep;
    const regions = new Set(['far', 'fan', 'collar']);
    for (let i = 0; i < index.count && regions.size; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const xs = ids.map(id => position.getX(id)), zs = ids.map(id => position.getZ(id));
      const cx = (xs[0]! + xs[1]! + xs[2]!) / 3, cz = (zs[0]! + zs[1]! + zs[2]!) / 3;
      const region = cx > 300 && cz > 300 ? 'far'
        : cx > outerX && cx < outerX + farStep && cz > 0 && cz < 16 ? 'fan'
          : cx > 32 && cx < outerX && cz > 0 && cz < 16 ? 'collar' : '';
      if (!regions.has(region)) continue;
      const cross = (zs[1]! - zs[0]!) * (xs[2]! - xs[0]!) - (xs[1]! - xs[0]!) * (zs[2]! - zs[0]!);
      expect(cross).toBeGreaterThan(0);
      const weights = [0.13, 0.31, 0.56];
      const x = ids.reduce((sum, id, j) => sum + position.getX(id) * weights[j]!, 0);
      const z = ids.reduce((sum, id, j) => sum + position.getZ(id) * weights[j]!, 0);
      const y = ids.reduce((sum, id, j) => sum + position.getY(id) * weights[j]!, 0);
      expect(sampleHeight(x, z)).toBeCloseTo(y, 7);
      regions.delete(region);
    }
    expect([...regions]).toEqual([]);
    // Detailed contact also interpolates the 1 m mesh, not the curved analytic surface.
    const x = -13.25, z = 6.75, ix = Math.floor(x), iz = Math.floor(z), u = x - ix, v = z - iz;
    const a = Math.fround(ground(ix, iz)), b = Math.fround(ground(ix, iz + 1)), c = Math.fround(ground(ix + 1, iz + 1));
    expect(sampleHeight(x, z)).toBeCloseTo(a + u * (c - b) + v * (b - a), 10);
    expect(() => sampleHeight(NaN, 0)).toThrow('bounded horizon');
    expect(() => sampleHeight(1101, 0)).toThrow('bounded horizon');
    geometry.dispose();
  });
});

it('rejects invalid detail and terrain bounds', () => {
  for (const farStep of [0, -10, 15, 40, NaN, Infinity]) {
    expect(() => createHorizonSurface(layout, { farStep: farStep as 10, sampleTerrain: ground })).toThrow('10 or 20');
  }
  expect(() => createHorizonSurface({ bounds: { minX: 0, maxX: 513, minZ: 0, maxZ: 16 } }, { sampleTerrain: ground })).toThrow('bounded horizon');
  expect(() => createHorizonSurface({ bounds: { minX: NaN, maxX: 1, minZ: 0, maxZ: 16 } }, { sampleTerrain: ground })).toThrow('finite');
});
