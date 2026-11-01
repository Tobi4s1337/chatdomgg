import { expect, it } from 'vitest';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial } from '@chatdom/render';
import { createGrowthMaterial } from '../growth/stage/growth-material';

it('leaves ordinary construction pieces unmasked until a caller explicitly requests a quarter ring', () => {
  const clay = createVoxelMaterial(MATERIALS, 'build'), growth = createGrowthMaterial(clay);
  try {
    // THREE.Vector4() defaults w=1: that accidentally enables a zero-radius ring and discards the whole home.
    expect(growth.material.uniforms.uGrowRing!.value.toArray()).toEqual([0, 0, 0, 0]);
    growth.setCut(14, 25);
    expect(growth.material.uniforms.uGrow!.value.toArray()).toEqual([14, 25]);
    expect(growth.material.uniforms.uGrowRing!.value.w).toBe(0);
    growth.setRing(8, 12, 30, 1);
    expect(growth.material.uniforms.uGrowRing!.value.toArray()).toEqual([8, 12, 30, 1]);
    growth.setRing(0, 0, 0, 0);
    expect(growth.material.uniforms.uGrowRing!.value.w).toBe(0);
  } finally { growth.dispose(); clay.dispose(); }
});
