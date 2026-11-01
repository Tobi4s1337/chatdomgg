import { describe, expect, it } from 'vitest';
import { createVoxelMaterial } from '@chatdom/render';
import { MATERIALS } from '@chatdom/content';
import { MaterialRegistrySchema } from '@chatdom/shared';
import { grandPalette } from '../../../../../packages/world/src/grand/palette';
import { createHostedGrandMaterial, hostedPalette, HOSTED_PAVING } from './material';

describe('the hosted grand material', () => {
  const palette = grandPalette({ stone: 'sandstone', grass: 'summer', hueDrift: 0, autumn: .5 });
  it('retains grand IDs in its own valid palette and an explicit paved material', () => {
    const registry = MaterialRegistrySchema.parse(hostedPalette(palette));
    expect(registry.materials.find(m => m.id === HOSTED_PAVING)?.surface).toBe('stone');
    for (const material of palette) expect(registry.materials.find(m => m.id === material.id)?.colour).toBe(material.colour);
  });
  it('shares the native grade, fields, beacon and Forge light without flattening real geometry', () => {
    const native = createVoxelMaterial(MATERIALS, 'terrain'), hosted = createHostedGrandMaterial(palette, native);
    for (const key of ['uSun', 'uSunDirection', 'uAmbient', 'uLight', 'uFarLight', 'uBeaconLight', 'uSmithyPower'])
      expect(hosted.material.uniforms[key]).toBe(native.material.uniforms[key]);
    expect(hosted.material.uniforms.uPalette).not.toBe(native.material.uniforms.uPalette);
    expect(hosted.material.vertexShader).toContain('in uvec2 aQuad;');
    expect(hosted.material.vertexShader).not.toContain('groundHeight(');
    expect(hosted.material.vertexShader).not.toContain('uniform mat4 modelMatrix');
    expect(hosted.material.vertexShader).toContain('out float vSky; out float vLodFade;');
    expect(hosted.material.fragmentShader).toBe(native.material.fragmentShader);
    hosted.dispose(); native.dispose();
  });
});
