import { describe, expect, it } from 'vitest';
import { generateKingdom, terrainHeight } from '@chatdom/world';
import { createHorizonSurface } from './horizon';
import { sampleRenderedTerrainHeight } from './terrain-worker';

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

describe('conforming distant terrain collar', () => {
  it.each(['hamlet', 'town'] as const)('joins %s ground exactly and leaves no interior overlap or unmatched outer joins', tier => {
    const layout = generateKingdom({ seed: 'lanternmere', tier, firstYear: tier === 'hamlet' ? 2025 : 2022, year: 2026 });
    const { geometry, clipBounds: bounds, sampleHeight } = createHorizonSurface(layout);
    expect(bounds).toEqual(tier === 'hamlet' ? [-96, 96, -112, 144] : [-176, 176, -112, 272]);
    const outer = [Math.floor(bounds[0] / 10) * 10 - 10, Math.ceil(bounds[1] / 10) * 10 + 10,
      Math.floor(bounds[2] / 10) * 10 - 10, Math.ceil(bounds[3] / 10) * 10 + 10];
    const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), indices = geometry.index!;
    const edges = new Map<number, number>();
    let area = 0, sharedVertices = 0;
    for (let id = 0; id < position.count; id++) {
      const x = position.getX(id), y = position.getY(id), z = position.getZ(id);
      check([x, y, z].every(Number.isFinite), `Invalid horizon vertex ${id}`);
      const atOuterJoin = ((x === outer[0] || x === outer[1]) && z >= outer[2]! && z <= outer[3]!)
        || ((z === outer[2] || z === outer[3]) && x >= outer[0]! && x <= outer[1]!);
      if (atOuterJoin) check(Math.abs(sampleHeight(x, z) - y) < 1e-8, `Contact misses outer join at ${x},${z}`);
      const isShared = ((x === bounds[0] || x === bounds[1]) && z >= bounds[2] && z <= bounds[3])
        || ((z === bounds[2] || z === bounds[3]) && x >= bounds[0] && x <= bounds[1]);
      if (!isShared) continue;
      sharedVertices++;
      check(y === Math.fround(terrainHeight(layout, x, z)), `Terrain seam at ${x},${z}`);
      const nx = (Math.fround(terrainHeight(layout, x - 1, z)) - Math.fround(terrainHeight(layout, x + 1, z))) / 2;
      const nz = (Math.fround(terrainHeight(layout, x, z - 1)) - Math.fround(terrainHeight(layout, x, z + 1))) / 2;
      const length = Math.hypot(nx, 1, nz);
      check(Math.abs(normal.getX(id) - nx / length) < 1e-6 && Math.abs(normal.getY(id) - 1 / length) < 1e-6
        && Math.abs(normal.getZ(id) - nz / length) < 1e-6, 'Terrain edge normals differ');
    }
    for (let i = 0; i < indices.count; i += 3) {
      const triangle = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
      const [a, b, c] = triangle;
      const cross = (position.getZ(b!) - position.getZ(a!)) * (position.getX(c!) - position.getX(a!))
        - (position.getX(b!) - position.getX(a!)) * (position.getZ(c!) - position.getZ(a!));
      check(cross > 0, 'Degenerate or reversed terrain triangle'); area += cross / 2;
      const centreX = triangle.reduce((sum, id) => sum + position.getX(id), 0) / 3;
      const centreZ = triangle.reduce((sum, id) => sum + position.getZ(id), 0) / 3;
      // All collar/join triangles plus a regular distant sample; bounded local queries only.
      if (Math.abs(centreX) < bounds[1] + 40 && centreZ > bounds[2] - 40 && centreZ < bounds[3] + 40 || i % 291 === 0) {
        const expected = triangle.reduce((sum, id) => sum + position.getY(id), 0) / 3;
        check(Math.abs(sampleHeight(centreX, centreZ) - expected) < 1e-8, `Contact misses triangle at ${centreX},${centreZ}`);
      }
      check(triangle.every(id => position.getX(id) <= bounds[0]) || triangle.every(id => position.getX(id) >= bounds[1])
        || triangle.every(id => position.getZ(id) <= bounds[2]) || triangle.every(id => position.getZ(id) >= bounds[3]),
      'Distant terrain overlaps detailed terrain');
      for (let corner = 0; corner < 3; corner++) {
        const a = triangle[corner]!, b = triangle[(corner + 1) % 3]!;
        const key = Math.min(a, b) * position.count + Math.max(a, b);
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    let boundaryCount = 0;
    for (const [key, count] of edges) {
      check(count === 1 || count === 2, 'Overlapping triangles at a shared edge');
      if (count === 2) continue;
      boundaryCount++;
      const a = Math.floor(key / position.count), b = key % position.count;
      const ax = position.getX(a), az = position.getZ(a), bx = position.getX(b), bz = position.getZ(b);
      const outerBoundary = (ax === bx && Math.abs(ax) === 1100) || (az === bz && Math.abs(az) === 1100);
      const innerBoundary = (ax === bx && (ax === bounds[0] || ax === bounds[1]) && Math.min(az, bz) >= bounds[2] && Math.max(az, bz) <= bounds[3])
        || (az === bz && (az === bounds[2] || az === bounds[3]) && Math.min(ax, bx) >= bounds[0] && Math.max(ax, bx) <= bounds[1]);
      check(outerBoundary || innerBoundary, `Unmatched collar edge ${ax},${az} to ${bx},${bz}`);
      if (innerBoundary) check(Math.hypot(bx - ax, bz - az) === 1, 'Inner seam is not sampled every metre');
    }
    const innerPerimeter = 2 * (bounds[1] - bounds[0] + bounds[3] - bounds[2]);
    expect(sharedVertices).toBe(innerPerimeter);
    expect(boundaryCount).toBe(innerPerimeter + 4 * 220);
    expect(area).toBe(2200 ** 2 - (bounds[1] - bounds[0]) * (bounds[3] - bounds[2]));
    expect(indices.count / 3).toBeLessThan(160_000);
    expect(position.array.byteLength + normal.array.byteLength + indices.array.byteLength).toBeLessThan(4 * 1024 * 1024);
    for (let z = bounds[2]; z <= bounds[3]; z += 11.25) for (let x = bounds[0]; x <= bounds[1]; x += 7.75) {
      expect(sampleHeight(x, z)).toBeCloseTo(sampleRenderedTerrainHeight(layout, x, z), 10);
    }
    expect(() => sampleHeight(NaN, 0)).toThrow('bounded horizon');
    expect(() => sampleHeight(1101, 0)).toThrow('bounded horizon');
    console.info(`Horizon ${tier}: ${indices.count / 3} triangles, ${position.count} shared vertices, ${position.array.byteLength + normal.array.byteLength + indices.array.byteLength} bytes`);
    geometry.dispose();
  });

  it('rejects bounds that cannot fit the bounded horizon', () => {
    const layout = generateKingdom({ seed: 'bounds', tier: 'hamlet', firstYear: 2025, year: 2026 });
    expect(() => createHorizonSurface({ ...layout, bounds: { minX: 0, maxX: 513, minZ: 0, maxZ: 16 } })).toThrow('bounded horizon');
    expect(() => createHorizonSurface({ ...layout, bounds: { minX: NaN, maxX: 1, minZ: 0, maxZ: 16 } })).toThrow('finite');
  });
});
