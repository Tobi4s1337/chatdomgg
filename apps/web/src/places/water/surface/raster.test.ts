import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWaterSurface } from './surface';

describe('native water raster', () => {
  it('merges wet cells at their real levels, leaves a dry island, and queries negative origins', () => {
    const ground = { data: new Float32Array(16).fill(-2), width: 4, height: 4, origin: [-10, -20] as const, step: 2 };
    const levels = new Float32Array([
      0, 0, 2, 2,
      0, NaN, 2, 2,
      0, 0, 2, 2,
      0, 0, 2, 2,
    ]);
    const surface = createWaterSurface({ ground, raster: { levels, seaLevel: 0 }, bodies: [], reaches: [], quality: 'reduced' });
    expect(surface.waterAt(-10, -20)).toEqual({ id: 'raster', level: 0, depth: 2 });
    expect(surface.waterAt(-8, -18)).toBeNull();
    expect(surface.waterAt(-6, -18)).toEqual({ id: 'raster', level: 2, depth: 4 });
    expect(surface.waterAt(-2.01, -12.01)).toEqual({ id: 'raster', level: 2, depth: 4 });
    expect(surface.waterAt(-2, -12)).toBeNull();
    expect(surface.waterAt(-10.1, -20)).toBeNull();
    expect(surface.root.children).toHaveLength(1);
    const geometry = (surface.root.children[0] as THREE.Mesh).geometry;
    expect(geometry.index!.count / 6).toBeLessThan(15);
    const position = geometry.getAttribute('position');
    expect(new Set(Array.from({ length: position.count }, (_, i) => position.getY(i)))).toEqual(new Set([0, 2]));
    surface.dispose();
  });

  it('runs the open sea from the raster edge to its reach at sea level, over a deep bed, without a gap or overlap', () => {
    const ground = { data: new Float32Array(16).fill(-2), width: 4, height: 4, origin: [-10, -20] as const, step: 2 };
    const levels = new Float32Array(16).fill(0);
    const surface = createWaterSurface({ ground, raster: { levels, seaLevel: 0 }, bodies: [], reaches: [], quality: 'reduced', openSea: 100 });
    const sea = surface.root.children.find(child => child.name === 'water:open-sea') as THREE.Mesh;
    expect(sea).toBeDefined();
    const position = sea.geometry.getAttribute('position'), index = sea.geometry.index!;
    expect(new Set(Array.from({ length: position.count }, (_, i) => position.getY(i)))).toEqual(new Set([0]));
    // Area of the ring is the reach square less the raster's square (8 × 8 m from (-10, -20)) inset by two 2 m cells:
    // the ring reaches under the raster and the shader keeps it to the outermost cell and beyond.
    let area = 0;
    for (let t = 0; t < index.count; t += 3) {
      const [a, b, c] = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(position, index.getX(t + k)));
      area += new THREE.Vector3().subVectors(b!, a!).cross(new THREE.Vector3().subVectors(c!, a!)).length() / 2;
    }
    expect(area).toBeCloseTo(200 * 200, 6);
    const box = sea.geometry.boundingBox!;
    expect([box.min.x, box.max.x, box.min.z, box.max.z]).toEqual([-106, 94, -116, 84]);
    // Upward faces, like the raster's own quads.
    const [a, b, c] = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(position, index.getX(k)));
    expect(new THREE.Vector3().subVectors(b!, a!).cross(new THREE.Vector3().subVectors(c!, a!)).y).toBeGreaterThan(0);
    expect((sea.material as THREE.ShaderMaterial).polygonOffsetUnits).toBeLessThan(0);
    const uniforms = (sea.material as THREE.ShaderMaterial).uniforms;
    expect(uniforms.uOpenSea!.value).toBe(100);
    expect(uniforms.uOpenSeaMesh!.value).toBe(1);
    const raster = surface.root.children.find(child => child.name === 'water:raster') as THREE.Mesh;
    expect((raster.material as THREE.ShaderMaterial).uniforms.uOpenSeaMesh!.value).toBe(0);
    expect(uniforms.uOutsideGroundHeight!.value).toBe(-40);
    surface.dispose();
    expect(() => createWaterSurface({ ground, raster: { levels, seaLevel: 0 }, bodies: [], reaches: [], quality: 'reduced', openSea: 6 })).toThrow(RangeError);
  });
});
