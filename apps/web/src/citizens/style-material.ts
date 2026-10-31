import * as THREE from 'three';
import { VOXEL_METRES } from '@chatdom/shared';
import { PORTRAIT, type CitizenMesh } from '@chatdom/content/avatar-style';
import type { VoxelRenderState } from '@chatdom/render';

const linear = (c: number) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;

/** Exact recipe albedo, converted once from sRGB, with the content mesher's AO and true convex edges. */
export function styledCitizenGeometry(mesh: CitizenMesh, surface: 'solid' | 'glass'): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions.map(n => n * VOXEL_METRES.avatar), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('aPaint', new THREE.BufferAttribute(mesh.colours.map(linear), 3));
  geometry.setAttribute('aOcclusion', new THREE.BufferAttribute(mesh.occlusion, 1));
  geometry.setAttribute('aFaceUv', new THREE.BufferAttribute(mesh.faceUv, 2));
  geometry.setAttribute('aEdges', new THREE.BufferAttribute(mesh.edges, 4));
  geometry.setAttribute('aTangentU', new THREE.BufferAttribute(mesh.tangentU, 3));
  geometry.setAttribute('aTangentV', new THREE.BufferAttribute(mesh.tangentV, 3));
  const alpha = new Float32Array(mesh.colours.length / 3).fill(1);
  if (surface === 'glass') for (let i = 0; i < alpha.length; i++) {
    const luma = mesh.colours[i * 3]! * .2126 + mesh.colours[i * 3 + 1]! * .7152 + mesh.colours[i * 3 + 2]! * .0722;
    alpha[i] = luma > .7 ? .2 : luma > .4 ? .34 : .62;
  }
  geometry.setAttribute('aPaintAlpha', new THREE.BufferAttribute(alpha, 1));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

const vertexShader = /* glsl */ `
  in vec3 aPaint, aTangentU, aTangentV;
  in float aOcclusion, aPaintAlpha, aLodFade;
  in vec2 aFaceUv; in vec4 aEdges;
  out vec3 vWorld, vNormal, vPaint, vTangentU, vTangentV;
  out float vAo, vSky, vLodFade, vPaintAlpha;
  out vec2 vFaceUv; out vec4 vEdges;
  void main() {
    mat4 transform=modelMatrix*instanceMatrix;
    vec4 world=transform*vec4(position,1.);
    vWorld=world.xyz;vNormal=normalize(mat3(transform)*normal);
    vTangentU=normalize(mat3(transform)*aTangentU);vTangentV=normalize(mat3(transform)*aTangentV);
    vPaint=aPaint;vPaintAlpha=aPaintAlpha;vLodFade=aLodFade;
    vAo=aOcclusion;vSky=1.;vFaceUv=aFaceUv;vEdges=aEdges;
    gl_Position=projectionMatrix*viewMatrix*world;
  }
`;

function replaceOnce(source: string, from: string, to: string): string {
  if (source.split(from).length !== 2) throw new Error(`Citizen lighting shader anchor changed: ${from}`);
  return source.replace(from, to);
}

/**
 * Reuse the kingdom's complete lighting/fog/output path and live uniform objects.
 * Only the geometry/albedo interface differs; there is no private palette texture
 * or alternate portrait lighting in the street. Fail loudly if an anchor changes.
 */
export function createStyledCitizenMaterial(lighting: VoxelRenderState, surface: 'solid' | 'glass'): THREE.ShaderMaterial {
  const source = lighting.material;
  let fragmentShader = replaceOnce(source.fragmentShader, 'flat in uint vMaterial;', `
    in vec3 vPaint,vTangentU,vTangentV;in vec2 vFaceUv;in vec4 vEdges;in float vPaintAlpha;
    const uint vMaterial=0u;`);
  fragmentShader = replaceOnce(fragmentShader,
    'vec4 swatch=texelFetch(uPalette,ivec2(int(vMaterial&255u),int(vMaterial>>8u)),0);vec3 base=swatch.rgb;',
    'vec4 swatch=vec4(vPaint,9.);vec3 base=swatch.rgb;');
  fragmentShader = replaceOnce(fragmentShader, 'vec3 n=normalize(vNormal);', `
    float w=${PORTRAIT.bevel.toFixed(3)};
    float a=vEdges.x*(1.-smoothstep(0.,w,vFaceUv.x));
    float b=vEdges.y*(1.-smoothstep(0.,w,1.-vFaceUv.x));
    float c=vEdges.z*(1.-smoothstep(0.,w,vFaceUv.y));
    float d=vEdges.w*(1.-smoothstep(0.,w,1.-vFaceUv.y));
    vec3 n=normalize(vNormal+((b-a)*vTangentU+(d-c)*vTangentV)*1.15);`);
  fragmentShader = replaceOnce(fragmentShader, 'float ao=mix(.49,1.,vAo);', 'float ao=vAo;');
  fragmentShader = replaceOnce(fragmentShader, 'gl_FragColor.a=cover;', 'gl_FragColor.a=vPaintAlpha;');
  // Recipe paint is deliberate. World-space material grain would crawl across a
  // moving face and perturb the exact selected dye before lighting even begins.
  fragmentShader = replaceOnce(fragmentShader, 'base*=1.+(.03*variation-.015)*detail;', '');
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: source.uniforms, defines: { ...source.defines },
    vertexShader, fragmentShader, transparent: surface === 'glass', depthWrite: surface !== 'glass',
  });
  material.name = `Citizen paint ${surface}`;
  return material;
}
