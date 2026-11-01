import * as THREE from 'three';
import { createVoxelMaterial, type VoxelRenderState } from '@chatdom/render';
import type { MaterialRegistry, VoxelMaterial } from '@chatdom/shared';
import { GRAND_QUAD_VERTEX } from '../../../../../packages/render/src/grand/terrain-material';
import { GrandKind, type GrandMaterial } from '../../../../../packages/world/src/grand/palette';

import { HOSTED_PAVING } from './palette';
export { HOSTED_PAVING } from './palette';

const surfaces: Readonly<Record<number, VoxelMaterial['surface']>> = {
  [GrandKind.grass]: 'grass', [GrandKind.earth]: 'earth', [GrandKind.sand]: 'earth',
  [GrandKind.rock]: 'earth', [GrandKind.snow]: 'earth', [GrandKind.ice]: 'earth',
  [GrandKind.leaf]: 'leaf', [GrandKind.bark]: 'wood', [GrandKind.crop]: 'leaf',
  [GrandKind.flower]: 'leaf', [GrandKind.water]: 'earth', [GrandKind.glow]: 'stone',
  [GrandKind.stone]: 'stone', [GrandKind.plaster]: 'plaster', [GrandKind.roof]: 'roof',
  [GrandKind.wood]: 'wood', [GrandKind.metal]: 'metal', [GrandKind.fabric]: 'fabric', [GrandKind.glass]: 'glass',
};

export function hostedPalette(materials: readonly GrandMaterial[], paving = '#9b9483'): MaterialRegistry {
  const air: VoxelMaterial = { id: 0, name: 'grand-air', colour: '#000000', surface: 'air', solid: false,
    occludesFaces: false, occludesAo: false, blocksLight: false };
  return { version: 1, revision: 0, materials: [air,
    ...materials.filter(m => m.id !== 0 && m.id !== HOSTED_PAVING).map(m => ({
      id: m.id, name: `grand-${m.id}`, colour: m.colour, surface: surfaces[m.kind] ?? 'earth',
      solid: true, occludesFaces: true, occludesAo: true, blocksLight: true,
    })),
    { ...air, id: HOSTED_PAVING, name: 'grand-paving', colour: paving, surface: 'stone', solid: true,
      occludesFaces: true, occludesAo: true, blocksLight: true },
  ] };
}

export interface HostedGrandMaterial { readonly material: THREE.ShaderMaterial; dispose(): void }

/** Packed quads keep their real half-metre vertices. The existing kingdom owns every light and the grade. */
export function createHostedGrandMaterial(palette: readonly GrandMaterial[], native: VoxelRenderState): HostedGrandMaterial {
  const own = createVoxelMaterial(hostedPalette(palette), 'terrain');
  const uniforms = { ...native.material.uniforms, uPalette: own.material.uniforms.uPalette!, uTerrain: { value: 1 } };
  const vertex = GRAND_QUAD_VERTEX
    .replace('uniform mat4 modelMatrix, viewMatrix, projectionMatrix;', '')
    .replace('in vec3 position;', '')
    .replace('flat out vec3 vNormal;', 'out vec3 vNormal;')
    .replace('out vec3 vWorld;', 'out float vSky; out float vLodFade; out vec3 vWorld;')
    .replace('vWorld = world.xyz;', 'vWorld = world.xyz; vSky = 1.; vLodFade = 1.;');
  const material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, vertexShader: vertex,
    fragmentShader: native.material.fragmentShader, defines: { ...native.material.defines }, alphaToCoverage: true });
  // uTerrain selects the native floor light response only. The packed vertex deliberately does not
  // sample uTerrainHeight: flattening to the old visual grid would destroy the grand cliffs and exact floor.
  return { material, dispose() { material.dispose(); own.dispose(); } };
}
