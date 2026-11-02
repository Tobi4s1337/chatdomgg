import * as THREE from 'three';
import { createVoxelMaterial, type VoxelRenderState } from '@chatdom/render';
import type { MaterialRegistry, VoxelMaterial } from '@chatdom/shared';
import type { BoundsXZ } from '../../../../../packages/world/src/settlement/types';
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
/**
 * Today's floor draws the founded lawns as a smooth surface, so a town street never shows its grading. The
 * grand floor keeps the exact half-metre steps, and at a low sun every step's bank drew a dark contour line
 * through the lawns and along the streets. Inside the installed town (easing out over the next 16 m) turf and
 * paving take the native floor's softened occlusion and their banks are lit mostly as the ground above them: the
 * step stays a visible voxel ledge, not a drawn line. Composed structures are cleared from the town's reserve, so
 * there the floor's only stone is its paving. Beyond the town the land keeps its full relief, and rock and soil
 * (the crag's faces) are untouched everywhere.
 */
const NATIVE_AO = 'float ao=mix(.49,1.,vAo);';
const HOSTED_TURF = 'float hostedTurf=kind==2.||kind==3.?1.-smoothstep(0.,16.,max(max(uHostedTown.x-vWorld.x,vWorld.x-uHostedTown.y),max(uHostedTown.z-vWorld.z,vWorld.z-uHostedTown.w))):0.;'
  + 'if(hostedTurf>0.&&abs(n.y)<.5)n=normalize(mix(n,vec3(0.,1.,0.),.72*hostedTurf));';
const HOSTED_AO = 'float ao=mix(.49,1.,mix(vAo,mix(.8,1.,vAo),hostedTurf));';
/** No town: every term below is the identity. */
const NO_TOWN = [1e9, -1e9, 1e9, -1e9] as const;

export function hostedFragment(native: string): string {
  if (native.split(NATIVE_FACING).length !== 2) throw new Error('The hosted grand floor expects one native facing term');
  if (native.split(NATIVE_GRASS).length !== 2) throw new Error('The hosted grand floor expects one native grass term');
  if (native.split(NATIVE_AO).length !== 2) throw new Error('The hosted grand floor expects one native occlusion term');
  const main = native.indexOf('void main');
  if (main < 0) throw new Error('The hosted grand floor expects a fragment entry point');
  return `${native.slice(0, main)}uniform vec4 uHostedTown;\n${native.slice(main)}`
    .replace(NATIVE_FACING, HOSTED_FACING).replace(NATIVE_AO, HOSTED_AO)
    .replace(NATIVE_GRASS, `${NATIVE_GRASS}\n      ${HOSTED_NIGHT_GRASS}\n      ${HOSTED_TURF}`);
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

/**
 * Packed quads keep their real half-metre vertices. The existing kingdom owns every light and the grade.
 * `town` is the installed physical region in world metres, whose lawns are graded in half-metre steps.
 */
export function createHostedGrandMaterial(palette: readonly GrandMaterial[], native: VoxelRenderState, town?: BoundsXZ): HostedGrandMaterial {
  const bounds = town ? [town.minX, town.maxX, town.minZ, town.maxZ] : NO_TOWN;
  if (bounds.some(value => !Number.isFinite(value)) || (town && (town.minX >= town.maxX || town.minZ >= town.maxZ)))
    throw new Error('The hosted grand floor needs a finite installed region');
  const own = createVoxelMaterial(hostedPalette(palette), 'terrain');
  const uniforms = { ...native.material.uniforms, uPalette: own.material.uniforms.uPalette!, uTerrain: { value: 1 }, uGrandLodFade: { value: 1 },
    uHostedTown: { value: new THREE.Vector4(...bounds) } };
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
