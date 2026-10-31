import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, type VoxelRenderState } from '@chatdom/render';
import { ANVIL_MATERIALS } from './sculpt';

export interface AnvilMaterial {
  state: VoxelRenderState;
  material: THREE.ShaderMaterial;
  uniforms: { uAnvilHeat: { value: number }; uAnvilTime: { value: number }; uAnvilShaping: { value: number } };
  dispose(): void;
}

const ids = ANVIL_MATERIALS;

/**
 * The iron's own response, identical to the engraving's metal (engraving/index.ts): the same
 * view-space key, the same grazing edge and the same near-black values. A plate cut from that
 * metal and set flush in the cheek has nothing to separate it from the anvil, so the mark reads
 * as cut into the iron, not stuck on it.
 */
export const ANVIL_IRON_GLSL = `
  vec3 anvilIronResponse(vec3 vn){
    float key=max(0.,dot(vn,normalize(vec3(-.45,.75,1.))));
    float edge=pow(1.-abs(vn.z),2.);
    return vec3(.008,.009,.010)+vec3(.018,.020,.022)*key+vec3(.025,.023,.021)*edge;
  }`;

/**
 * The anvil's world light on top of that response. Faces that look up take the hour's sky, so the
 * working face is a cool lilac plane above dark flanks (the vertical cheek takes none, and stays
 * the engraving's exact value). Worn steel is several steps brighter and carries the sky's lilac
 * and the low sun's gold where the sun reaches it. Warm street and forge light tints it all.
 */
const ANVIL_LIGHT_GLSL = `
  vec3 anvilIron(uint id,vec3 vn,vec3 n,vec3 sky,vec3 sun,vec3 warm){
    vec3 metal=anvilIronResponse(vn);
    float up=max(n.y,0.),key=max(0.,dot(vn,normalize(vec3(-.45,.75,1.)))),edge=pow(1.-abs(vn.z),2.);
    metal+=sky*.24*up*up+sun*.03*up+warm*.06;
    if(id==${ANVIL_MATERIALS.steel}u)
      metal=vec3(.02,.022,.027)+vec3(.04,.044,.052)*key+vec3(.035,.035,.037)*edge+sky*.26*(.3+.7*up)+sun*.08+warm*.14;
    if(id==${ANVIL_MATERIALS.rust}u)metal=vec3(.016,.009,.006)+vec3(.022,.012,.007)*key+sky*.04*up+warm*.05;
    if(id==${ANVIL_MATERIALS.dent}u)metal*=.86;
    return metal;
  }`;
const isIron = `(vMaterial==${ids.iron}u||vMaterial==${ids.steel}u||vMaterial==${ids.rust}u||vMaterial==${ids.dent}u)`;

/**
 * The production voxel material on the character lattice, with a hero treatment for the iron.
 *
 * Iron is the engraving's metal (ANVIL_IRON_GLSL) plus the hour's sky on its upward faces; the
 * mesher's corner AO and sky openness still darken the hardy hole, the arches and the hollows.
 * Stone keeps the kingdom's light, sky, sun and shadow response, as a matte monolith rather than
 * coursed masonry. Dusk reaches the iron as a lilac and gold rim on the bright worn steel.
 */
export function createAnvilMaterial(): AnvilMaterial {
  const state = createVoxelMaterial(MATERIALS, 'avatar');
  const source = state.material;
  const uniforms = { uAnvilHeat: { value: 0 }, uAnvilTime: { value: 0 }, uAnvilShaping: { value: 0 } };
  const replace = (shader: string, from: string, to: string) => {
    if (shader.split(from).length !== 2) throw new Error(`The anvil material no longer matches the voxel shader at "${from.slice(0, 40)}".`);
    return shader.replace(from, to);
  };
  let fragment = replace(source.fragmentShader, 'void main(){', `uniform float uAnvilHeat,uAnvilTime,uAnvilShaping;
    ${ANVIL_IRON_GLSL}
    ${ANVIL_LIGHT_GLSL}
    void main(){`);
  // Keep the sky and the (shadowed) sun apart before the street's warm light joins them.
  fragment = replace(fragment, 'vec3 uvw=(vWorld-uLightOrigin)/uLightExtent;', `vec3 anvilSky=cool,anvilSun=light-cool;
      vec3 uvw=(vWorld-uLightOrigin)/uLightExtent;`);
  fragment = replace(fragment, 'float kind=swatch.a;', `float kind=swatch.a;
      bool heroIron=${isIron};
      // A monolith: the block is one dressed stone, without the kingdom's coursed mortar.
      if(vMaterial==${ids.stone}u)kind=5.;
      if(vMaterial==${ids.stain}u){base=texelFetch(uPalette,ivec2(${ids.stone},0),0).rgb*vec3(.5,.47,.45);kind=5.;}
      if(heroIron)kind=8.;`);
  fragment = replace(fragment, 'vec3 colour=base*edge*light*ao;', `vec3 colour=base*edge*light*ao;
      if(heroIron){
        vec3 vn=normalize((viewMatrix*vec4(n,0.)).xyz);
        colour=anvilIron(vMaterial,vn,n,anvilSky,anvilSun,light-anvilSky-anvilSun)*mix(.42,1.,vAo)*mix(.3,1.,smoothstep(.0,.55,vSky));
      }`);
  const material = new THREE.ShaderMaterial({
    glslVersion: source.glslVersion, uniforms: { ...source.uniforms, ...uniforms },
    vertexShader: source.vertexShader, fragmentShader: fragment,
  });
  return {
    state, material, uniforms,
    dispose() { material.dispose(); state.dispose(); },
  };
}
