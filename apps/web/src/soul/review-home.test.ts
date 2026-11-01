import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelMaterial } from '@chatdom/shared';
import { createHearthHome, MAT, MATERIALS } from '@chatdom/content';
import { buildSoulReviewHome } from './review-home';

const material: VoxelMaterial = { id: 1, name: 'roof', solid: true, occludesFaces: true,
  occludesAo: true, blocksLight: true, colour: '#aa6655', surface: 'stone' };
const make = (boxes: { from: number[]; to: number[]; material: number }[], size = [4, 4, 1]) => VoxelBlueprintSchema.parse({
  version: 1, id: 'review-fixture', styleId: 'hearth', kind: 'home', lattice: 'build', size, boxes, windows: [],
});

describe('review home geometry', () => {
  it('renders ordered openings and later restored material as exposed faces', () => {
    const result = buildSoulReviewHome(make([
      { from: [0, 0, 0], to: [4, 4, 1], material: 1 },
      { from: [1, 1, 0], to: [3, 3, 1], material: 0 },
      { from: [2, 1, 0], to: [3, 3, 1], material: 1 },
    ]), [material], 1);
    const positions = result.surfaces[0]!.geometry.getAttribute('position');
    // A ray through the cut sees no front or back triangles; the restored strip does.
    const trianglesCovering = (x: number, y: number) => {
      let count = 0;
      for (let i = 0; i < positions.count; i += 3) {
        const xs = [0, 1, 2].map(n => positions.getX(i + n));
        const ys = [0, 1, 2].map(n => positions.getY(i + n));
        const zs = [0, 1, 2].map(n => positions.getZ(i + n));
        if (zs.every(z => z === zs[0]) && x > Math.min(...xs) && x < Math.max(...xs)
          && y > Math.min(...ys) && y < Math.max(...ys)) count++;
      }
      return count;
    };
    expect(trianglesCovering(0.1875, 0.1875)).toBe(0);
    expect(trianglesCovering(0.3125, 0.1875)).toBeGreaterThan(0);
  });

  it('offsets chunk coordinates and places snow only on exposed roof tops', () => {
    const result = buildSoulReviewHome(make([{ from: [31, 0, 0], to: [34, 1, 1], material: 1 }], [34, 1, 1]), [material], 1);
    const surface = result.surfaces[0]!.geometry;
    surface.computeBoundingBox();
    expect(surface.boundingBox!.min.x).toBe(31 * 0.125);
    expect(surface.boundingBox!.max.x).toBe(34 * 0.125);
    const positions = result.snow.getAttribute('position');
    const normals = result.snow.getAttribute('normal');
    expect(positions.count).toBeGreaterThan(0);
    for (let i = 0; i < positions.count; i++) {
      expect(positions.getY(i)).toBeCloseTo(0.15);
      expect([normals.getX(i), normals.getY(i), normals.getZ(i)]).toEqual([0, 1, 0]);
    }
    expect(buildSoulReviewHome(make([{ from: [0, 0, 0], to: [4, 4, 1], material: 1 }]), [material], 2)
      .snow.getAttribute('position').count).toBe(0);
  });

  it('converts all three authored Hearth cottages with shaded surfaces and roof snow', () => {
    const start = performance.now();
    const stats = ([0, 1, 2] as const).map(variant => {
      const home = buildSoulReviewHome(createHearthHome('cottage', variant), MATERIALS.materials, MAT.terracotta);
      let vertices = 0;
      const shades = new Set<number>();
      let minShade = 1, maxShade = 0;
      for (const surface of home.surfaces) {
        const positions = surface.geometry.getAttribute('position');
        const colors = surface.geometry.getAttribute('color');
        expect(colors.count).toBe(positions.count);
        vertices += positions.count;
        for (let i = 0; i < colors.count; i++) {
          const shade = colors.getX(i);
          minShade = Math.min(minShade, shade);
          maxShade = Math.max(maxShade, shade);
          shades.add(shade);
        }
        surface.geometry.dispose();
      }
      const snowVertices = home.snow.getAttribute('position').count;
      expect(home.snow.getAttribute('color')).toBeUndefined();
      home.snow.dispose();
      expect(vertices).toBeGreaterThan(0);
      expect(snowVertices).toBeGreaterThan(0);
      expect(shades.size).toBeGreaterThan(1);
      expect(minShade).toBeGreaterThanOrEqual(0.4);
      expect(maxShade).toBeLessThanOrEqual(1);
      return { variant, groups: home.surfaces.length, vertices, snowVertices };
    });
    console.info('Hearth review homes:', JSON.stringify({ elapsedMs: Math.round(performance.now() - start), stats }));
  }, 30_000);

});
