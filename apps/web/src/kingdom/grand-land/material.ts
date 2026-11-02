import * as THREE from 'three';
import { createVoxelMaterial, type VoxelRenderState } from '@chatdom/render';
import type { MaterialRegistry, VoxelMaterial } from '@chatdom/shared';
import { GRAND_QUAD_VERTEX } from '../../../../../packages/render/src/grand/terrain-material';
import { GrandKind, type GrandMaterial } from '../../../../../packages/world/src/grand/palette';

import { HOSTED_PAVING } from './palette';
export { HOSTED_PAVING } from './palette';

/**
 * The native fragment gives a vertical face half the sky fill of a top face. That suits the old smooth floor,
 * whose only vertical faces are walls, but the grand floor's half-metre grading steps then draw a dark line
 * across every lawn and street. The grand land's own shading lifts sides to about three quarters of a top,
 * so the hosted floor does the same; undersides keep the native value, and every light, field and the grade
 * stay shared with the kingdom.
 */
const NATIVE_FACING = 'float facing=.5+.5*max(n.y,0.);';
const HOSTED_FACING = 'float facing=n.y<-.5?.5:.74+.26*max(n.y,0.);';
/**
 * The grand meadow green is the golden hour's richest colour, but under the moon it read as a lit lawn,
 * about a third brighter and yellower than the native floor's night grass. As the grade's night rises the
 * hosted grass settles to the same deep, cool green; by day (night 0) it is untouched.
 */
const NATIVE_GRASS = 'if(kind==2.)base*=.91+.075*sin(vWorld.x*.13)*sin(vWorld.z*.17)+.04*sin((vWorld.x+vWorld.z)*.43);';
const HOSTED_NIGHT_GRASS = 'if(kind==2.)base*=mix(vec3(1.),vec3(.55,.52,.95),uNight);';

export function hostedFragment(native: string): string {
  if (native.split(NATIVE_FACING).length !== 2) throw new Error('The hosted grand floor expects one native facing term');
  if (native.split(NATIVE_GRASS).length !== 2) throw new Error('The hosted grand floor expects one native grass term');
  return native.replace(NATIVE_FACING, HOSTED_FACING).replace(NATIVE_GRASS, `${NATIVE_GRASS}\n      ${HOSTED_NIGHT_GRASS}`);
}

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

export interface HostedGrandMaterial {
  readonly material: THREE.ShaderMaterial;
  /** Bind once per mesh; set mesh.userData.grandLodFade before drawing (defaults to 1). */
  bindFade(mesh: THREE.Mesh): void;
  dispose(): void;
}

/** Packed quads keep their real half-metre vertices. The existing kingdom owns every light and the grade. */
export function createHostedGrandMaterial(palette: readonly GrandMaterial[], native: VoxelRenderState): HostedGrandMaterial {
  const own = createVoxelMaterial(hostedPalette(palette), 'terrain');
  const uniforms = { ...native.material.uniforms, uPalette: own.material.uniforms.uPalette!, uTerrain: { value: 1 }, uGrandLodFade: { value: 1 } };
  const vertex = GRAND_QUAD_VERTEX
    .replace('uniform mat4 modelMatrix, viewMatrix, projectionMatrix;', '')
    .replace('in vec3 position;', '')
    .replace('flat out vec3 vNormal;', 'out vec3 vNormal;')
    .replace('out vec3 vWorld;', 'uniform float uGrandLodFade; out vec3 vWorld;')
    .replace('out vec3 vWorld;', 'out float vSky; out float vLodFade; out vec3 vWorld;')
    .replace('vWorld = world.xyz;', 'vWorld = world.xyz; vSky = 1.; vLodFade = uGrandLodFade;');
  const material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, vertexShader: vertex,
    fragmentShader: hostedFragment(native.material.fragmentShader), defines: { ...native.material.defines }, alphaToCoverage: true });
  // uTerrain selects the native floor light response only. The packed vertex deliberately does not
  // sample uTerrainHeight: flattening to the old visual grid would destroy the grand cliffs and exact floor.
  const bound = new WeakSet<THREE.Mesh>();
  return {
    material,
    bindFade(mesh) {
      if (bound.has(mesh)) return;
      bound.add(mesh);
      const previous = mesh.onBeforeRender;
      mesh.onBeforeRender = function (renderer, scene, camera, geometry, drawnMaterial, group) {
        previous.call(this, renderer, scene, camera, geometry, drawnMaterial, group);
        if (drawnMaterial !== material) return;
        const fade: unknown = mesh.userData.grandLodFade;
        uniforms.uGrandLodFade.value = typeof fade === 'number' && Number.isFinite(fade) ? fade : 1;
        material.uniformsNeedUpdate = true;
      };
    },
    dispose() { material.dispose(); own.dispose(); },
  };
}
