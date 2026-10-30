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
 * The iron's response: near-black, cool blue-grey, lit by the same view-space key and
 * sheen the engraving uses for its metal. Exported so the engraving's plate can use the
 * identical response and vanish into the cheek (an integration change in engraving/).
 * Expects uSun, uSunIntensity, uSunDirection, uAmbient and uAmbientIntensity in scope.
 */
export const ANVIL_IRON_GLSL = `
  vec3 anvilIronResponse(vec3 vn){
    float key=max(0.,dot(vn,normalize(vec3(-.45,.75,1.))));
    float sheen=pow(1.-abs(vn.z),2.);
    return vec3(.024,.028,.035)+vec3(.07,.08,.095)*key+vec3(.035,.037,.042)*sheen;
  }
  vec3 anvilIron(uint id,vec3 vn,vec3 n){
    vec3 metal=anvilIronResponse(vn);
    float key=max(0.,dot(vn,normalize(vec3(-.45,.75,1.))));
    float sheen=pow(1.-abs(vn.z),2.);
    if(id==${ANVIL_MATERIALS.steel}u){
      // Bright worn steel, with the hour's lilac sky and gold sun along it.
      metal=vec3(.07,.078,.088)+vec3(.15,.16,.175)*key+vec3(.06,.06,.06)*sheen;
      metal+=uAmbient*uAmbientIntensity*.07*max(vn.y,0.)+uSun*uSunIntensity*.1*max(dot(n,normalize(uSunDirection)),0.);
    }
    if(id==${ANVIL_MATERIALS.rust}u)metal=vec3(.05,.026,.016)+vec3(.085,.042,.024)*key+vec3(.02,.012,.008)*sheen;
    if(id==${ANVIL_MATERIALS.dent}u)metal*=.72;
    return metal;
  }`;
const isIron = `(vMaterial==${ids.iron}u||vMaterial==${ids.steel}u||vMaterial==${ids.rust}u||vMaterial==${ids.dent}u)`;

/**
 * The production voxel material on the character lattice, with a hero treatment for the iron.
 *
 * Iron uses the engraving's view-space key and sheen at near-black values (ANVIL_IRON_GLSL).
 * The mesher's corner AO and sky openness still darken the hardy hole and the hollows. Stone keeps the kingdom's
 * light, sky, sun and shadow response, as a matte monolith rather than coursed masonry.
 * Dusk enters the iron only as a lilac and gold rim on the bright worn steel.
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
    void main(){`);
  fragment = replace(fragment, 'float kind=swatch.a;', `float kind=swatch.a;
      bool heroIron=${isIron};
      // A monolith: the block is one dressed stone, without the kingdom's coursed mortar.
      if(vMaterial==${ids.stone}u)kind=5.;
      if(vMaterial==${ids.stain}u){base=texelFetch(uPalette,ivec2(${ids.stone},0),0).rgb*vec3(.5,.47,.45);kind=5.;}
      if(heroIron)kind=8.;`);
  fragment = replace(fragment, 'vec3 colour=base*edge*light*ao;', `vec3 colour=base*edge*light*ao;
      if(heroIron){
        vec3 vn=normalize((viewMatrix*vec4(n,0.)).xyz);
        colour=anvilIron(vMaterial,vn,n)*mix(.42,1.,vAo)*mix(.3,1.,smoothstep(.0,.55,vSky));
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
