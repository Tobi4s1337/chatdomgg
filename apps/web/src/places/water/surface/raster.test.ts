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
});
