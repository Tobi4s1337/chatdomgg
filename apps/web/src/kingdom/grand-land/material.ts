import * as THREE from 'three';
import { createVoxelMaterial, type VoxelRenderState } from '@chatdom/render';
import type { MaterialRegistry, VoxelMaterial } from '@chatdom/shared';
import type { BoundsXZ } from '../../../../../packages/world/src/settlement/types';
import { GRAND_QUAD_VERTEX } from '../../../../../packages/render/src/grand/terrain-material';
import { LAND_MIST_GLSL, type LandMistUniforms } from '../../../../../packages/render/src/grand/mist';
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
 * there the floor's only stone is its paving. The town's few real cuts (rock and soil banks of 1.5 m and more on
 * the castle mound) get the same light, but only strictly inside the installed region: lit as the ground above
 * they read as stone outcrops in the lawn, where a bank facing away from a low sun read as a dark hole. Beyond the
 * town the land keeps its full relief, and the crag's faces outside the region are untouched.
 */
const NATIVE_AO = 'float ao=mix(.49,1.,vAo);';
const HOSTED_TURF = 'float hostedEdge=max(max(uHostedTown.x-vWorld.x,vWorld.x-uHostedTown.y),max(uHostedTown.z-vWorld.z,vWorld.z-uHostedTown.w));'
  + 'float hostedTurf=kind==2.||kind==3.?1.-smoothstep(0.,16.,hostedEdge):kind==1.?1.-smoothstep(-1.,0.,hostedEdge):0.;'
  + 'if(hostedTurf>0.&&abs(n.y)<.5)n=normalize(mix(n,vec3(0.,1.,0.),.72*hostedTurf));';
const HOSTED_AO = 'float ao=mix(.49,1.,mix(vAo,mix(.8,1.,vAo),hostedTurf));';
/**
 * The town's land use. Today the free ground between the streets drew as one mown lawn, so from the stream the
 * town stood on a cleared meadow. A byte per metre (the planner's use code and its field's row direction) tints the
 * grass top: crop parcels in their own colours with drill rows along their lane, meadow, heath and the bracken
 * toward the woods. The rows fade out where they would alias, the step faces stay turf, and paving, homes and every
 * other material are untouched. Code 0 is the lawn as it was.
 */
const HOSTED_USE = 'if(kind==2.&&n.y>.5){vec2 useUv=(vWorld.xz-uTownUseRect.xy)/uTownUseRect.zw;'
  + 'if(useUv.x>=0.&&useUv.y>=0.&&useUv.x<1.&&useUv.y<1.){vec2 use=texture(uTownUse,useUv).rg;int useCode=int(use.r*255.+.5);'
  + 'if(useCode>0&&useCode<16){vec4 look=uTownUseLook[useCode];float rowAngle=use.g*255./256.*3.14159265;'
  + 'float across=dot(vWorld.xz,vec2(-sin(rowAngle),cos(rowAngle)))*2.;float rowWidth=fwidth(across);'
  + 'float furrow=(1.-smoothstep(.18,.32,abs(fract(across)-.5)))*(1.-smoothstep(.25,.6,rowWidth));'
  + 'float grain=.94+.06*sin(vWorld.x*1.7+vWorld.z*.9)*sin(vWorld.z*1.3-vWorld.x*.4);'
  + 'base=mix(base,look.rgb*grain*(1.-.55*look.a*furrow),.9);}}}';
/** No land use: an empty rectangle far from any town. */
const NO_USE = [1e9, 1e9, 1, 1] as const;
/** No town: every term below is the identity. */
const NO_TOWN = [1e9, -1e9, 1e9, -1e9] as const;

/** The kingdom's fog term: the sea mist (GW13) lies on the land under it, so distance still hazes the mist itself. */
const NATIVE_FOG = 'colour=mix(colour,fogColour,min(.86,fogAmount));';
const HOSTED_MIST = 'vec4 hostedMist=landMist(vWorld);colour=mix(colour,hostedMist.rgb,hostedMist.a);';

export function hostedFragment(native: string, mist = false): string {
  if (native.split(NATIVE_FACING).length !== 2) throw new Error('The hosted grand floor expects one native facing term');
  if (native.split(NATIVE_GRASS).length !== 2) throw new Error('The hosted grand floor expects one native grass term');
  if (native.split(NATIVE_AO).length !== 2) throw new Error('The hosted grand floor expects one native occlusion term');
  const main = native.indexOf('void main');
  if (main < 0) throw new Error('The hosted grand floor expects a fragment entry point');
  if (mist && native.split(NATIVE_FOG).length !== 2) throw new Error('The hosted grand floor expects one native fog term for its mist');
  const hosted = `${native.slice(0, main)}uniform vec4 uHostedTown;uniform vec4 uTownUseRect;uniform vec4 uTownUseLook[16];uniform sampler2D uTownUse;\n${mist ? `${LAND_MIST_GLSL}\n` : ''}${native.slice(main)}`
    .replace(NATIVE_FACING, HOSTED_FACING).replace(NATIVE_AO, HOSTED_AO)
    .replace(NATIVE_GRASS, `${NATIVE_GRASS}\n      ${HOSTED_USE}\n      ${HOSTED_NIGHT_GRASS}\n      ${HOSTED_TURF}`);
  return mist ? hosted.replace(NATIVE_FOG, `${HOSTED_MIST}\n      ${NATIVE_FOG}`) : hosted;
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

/** The town's land use over its physical region: a use code and a row direction byte per one-metre cell. */
export interface TownUseMask {
  readonly origin: readonly [number, number];
  readonly width: number;
  readonly depth: number;
  readonly data: Uint8Array;
  readonly rows: Uint8Array;
  /** Per use code: the ground's sRGB tint and how strongly its drill rows show (0 to 1). */
  readonly look: Readonly<Record<number, { readonly tint: string; readonly rows: number }>>;
}

function useTexture(use: TownUseMask | undefined): { texture: THREE.DataTexture; rect: THREE.Vector4; look: THREE.Vector4[] } {
  const look = Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, 0, 0));
  if (!use) {
    const texture = new THREE.DataTexture(new Uint8Array(2), 1, 1, THREE.RGFormat);
    texture.needsUpdate = true;
    return { texture, rect: new THREE.Vector4(...NO_USE), look };
  }
  const cells = use.width * use.depth;
  if (!Number.isInteger(use.width) || !Number.isInteger(use.depth) || use.width < 1 || use.depth < 1 || use.data.length !== cells || use.rows.length !== cells
    || !use.origin.every(Number.isFinite)) throw new Error('The town land use needs one code and one row byte per cell');
  const texels = new Uint8Array(cells * 2);
  for (let i = 0; i < cells; i++) { texels[i * 2] = use.data[i]!; texels[i * 2 + 1] = use.rows[i]!; }
  const texture = new THREE.DataTexture(texels, use.width, use.depth, THREE.RGFormat);
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
  texture.unpackAlignment = 1; texture.needsUpdate = true;
  for (const [code, { tint, rows }] of Object.entries(use.look)) {
    const index = Number(code);
    if (!(index > 0 && index < 16)) throw new Error(`Town land use ${code} is outside the floor's sixteen looks`);
    const colour = new THREE.Color(tint);
    look[index]!.set(colour.r, colour.g, colour.b, Math.min(1, Math.max(0, rows)));
  }
  return { texture, rect: new THREE.Vector4(use.origin[0], use.origin[1], use.width, use.depth), look };
}

export interface HostedGrandMaterial {
  readonly material: THREE.ShaderMaterial;
  /** Bind once per mesh; set mesh.userData.grandLodFade before drawing (defaults to 1). */
  bindFade(mesh: THREE.Mesh): void;
  /** Lay (or replace) the town's land use once it is planned; until then the floor keeps its own turf. */
  setTownUse(use: TownUseMask): void;
  dispose(): void;
}

/**
 * Packed quads keep their real half-metre vertices. The existing kingdom owns every light and the grade.
 * `town` is the installed physical region in world metres, whose lawns are graded in half-metre steps.
 */
/** `mist`: the land's sea mist, for a kingdom on its own world; a pinned land without one draws no mist at all. */
export function createHostedGrandMaterial(palette: readonly GrandMaterial[], native: VoxelRenderState, town?: BoundsXZ, use?: TownUseMask, mist?: LandMistUniforms): HostedGrandMaterial {
  const bounds = town ? [town.minX, town.maxX, town.minZ, town.maxZ] : NO_TOWN;
  if (bounds.some(value => !Number.isFinite(value)) || (town && (town.minX >= town.maxX || town.minZ >= town.maxZ)))
    throw new Error('The hosted grand floor needs a finite installed region');
  const own = createVoxelMaterial(hostedPalette(palette), 'terrain');
  const uniforms = { ...native.material.uniforms, uPalette: own.material.uniforms.uPalette!, uTerrain: { value: 1 }, uGrandLodFade: { value: 1 },
    uHostedTown: { value: new THREE.Vector4(...bounds) } };
  let townUse = useTexture(use);
  Object.assign(uniforms, { uTownUse: { value: townUse.texture }, uTownUseRect: { value: townUse.rect }, uTownUseLook: { value: townUse.look } });
  if (mist) Object.assign(uniforms, mist);
  const vertex = GRAND_QUAD_VERTEX
    .replace('uniform mat4 modelMatrix, viewMatrix, projectionMatrix;', '')
    .replace('in vec3 position;', '')
    .replace('flat out vec3 vNormal;', 'out vec3 vNormal;')
    .replace('out vec3 vWorld;', 'uniform float uGrandLodFade; out vec3 vWorld;')
    .replace('out vec3 vWorld;', 'out float vSky; out float vLodFade; out vec3 vWorld;')
    .replace('vWorld = world.xyz;', 'vWorld = world.xyz; vSky = 1.; vLodFade = uGrandLodFade;');
  const material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, vertexShader: vertex,
    fragmentShader: hostedFragment(native.material.fragmentShader, !!mist), defines: { ...native.material.defines }, alphaToCoverage: true });
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
    setTownUse(next) {
      const made = useTexture(next);
      townUse.texture.dispose(); townUse = made;
      const u = uniforms as Record<string, THREE.IUniform>;
      u.uTownUse!.value = made.texture; (u.uTownUseRect!.value as THREE.Vector4).copy(made.rect);
      made.look.forEach((look, i) => (u.uTownUseLook!.value as THREE.Vector4[])[i]!.copy(look));
    },
    dispose() { material.dispose(); own.dispose(); townUse.texture.dispose(); },
  };
}
