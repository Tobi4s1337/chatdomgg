import { expect, it } from 'vitest';
import { MATERIALS } from '@chatdom/content';
import { forgeRitualFrame, FORGE_STAGE_TIMING } from '@chatdom/forge';
import { createVoxelMaterial } from '@chatdom/render';
import { forgeFlightHeat } from './flight-heat';
import { createLandingMaterial } from './realm-scene/landing-light';

it('carries isolated residual heat through the actual flight/contact boundary, then returns to the kit', () => {
  const source = createVoxelMaterial(MATERIALS, 'build');
  const gift = createLandingMaterial(source.material), previous = createLandingMaterial(source.material);
  try {
    const flight = FORGE_STAGE_TIMING.find(([phase]) => phase === 'flight')!;
    const landed = FORGE_STAGE_TIMING.find(([phase]) => phase === 'landed')!;
    const frame = (time: number) => forgeRitualFrame('SIMULATED-heat', time);
    gift.setFlightFrame(frame((flight[1] + flight[2]) / 2));
    expect(gift.material.uniforms.uFlightHeat!.value).toBeGreaterThan(.5);
    expect(previous.material.uniforms.uFlightHeat!.value).toBe(0);
    expect(source.material.uniforms.uFlightHeat).toBeUndefined();
    expect(gift.material.uniforms.uLight).toBe(source.material.uniforms.uLight);
    expect(forgeFlightHeat(frame(flight[1] - .00001))).toBeCloseTo(forgeFlightHeat(frame(flight[1])), 5);
    expect(forgeFlightHeat(frame(landed[1] - .00001))).toBeCloseTo(forgeFlightHeat(frame(landed[1])), 5);
    // The gift is still visibly warm when the landing camera first settles.
    gift.setFlightFrame(frame((landed[1] + landed[2]) / 2));
    expect(gift.material.uniforms.uFlightHeat!.value).toBeGreaterThan(.4);
    gift.setFlightFrame(frame(landed[2]));
    expect(gift.material.uniforms.uFlightHeat!.value).toBe(0);
    // Both warm treatments must run after the voxel surface colour exists, before its fog is applied.
    const shader = gift.material.fragmentShader, surface = shader.indexOf('vec3 colour=');
    expect(shader.indexOf('colour+=uLandingWarmth')).toBeGreaterThan(surface);
    expect(shader.indexOf('colour=mix(colour,colour*vec3(1.1')).toBeGreaterThan(surface);
  } finally { gift.dispose(); previous.dispose(); source.dispose(); }
});
