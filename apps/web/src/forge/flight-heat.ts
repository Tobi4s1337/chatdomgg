import * as THREE from 'three';
import type { ForgeRitualFrame } from '@chatdom/shared';

/** The skin carries hearth warmth through flight, then settles into its kingdom colours. */
export function forgeFlightHeat(frame: ForgeRitualFrame | null): number {
  if (!frame) return 0;
  const p = THREE.MathUtils.clamp(frame.phaseProgress, 0, 1);
  if (frame.phase === 'cool') return .9 * THREE.MathUtils.smoothstep(p, .35, 1);
  if (frame.phase === 'flight') return .9 - .35 * THREE.MathUtils.smoothstep(p, 0, 1);
  if (frame.phase === 'landed') return .55 * (1 - THREE.MathUtils.smoothstep(p, 0, .5));
  return 0;
}

/** Decorate an owned voxel material, leaving the registry palette and shared light uniforms alone. */
export function addForgeFlightHeat(material: THREE.ShaderMaterial) {
  const heat = { value: 0 };
  const fog = '      // Keep the nearby street crisp.';
  if (!material.fragmentShader.includes(fog)) throw new Error('Forge heat needs the voxel material surface');
  material.uniforms.uFlightHeat = heat;
  material.fragmentShader = material.fragmentShader
    .replace('out vec4 voxelColour;', 'out vec4 voxelColour; uniform float uFlightHeat;')
    .replace(fog, `      // Residual warmth belongs to the solid skin, not a glowing wire grid.
      float treasureRim=pow(1.-abs(dot(n,normalize(cameraPosition-vWorld))),1.8);
      colour=mix(colour,colour*vec3(1.1,.9,.7)+vec3(.18,.08,.015),uFlightHeat*.5);
      colour+=(vec3(.28,.085,.008)+vec3(.9,.46,.08)*treasureRim)*uFlightHeat;
${fog}`);
  return { update(frame: ForgeRitualFrame | null) { heat.value = forgeFlightHeat(frame); } };
}
