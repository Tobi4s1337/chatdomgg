import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createAuroraCurtains } from './aurora';
import { createSkyVeil } from './sky-veil';

// GLSL ES 3.00 keywords and reserved words (§3.8). Any of them as an identifier fails compilation, and the kingdom
// scene treats a shader that will not compile as a failed frame, so the stream would close on the sky's first light.
const RESERVED = new Set(`attribute const uniform varying layout centroid flat smooth break continue do for while switch
case default if else in out inout float int void bool true false invariant discard return mat2 mat3 mat4 mat2x2 mat2x3
mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uint uvec2 uvec3
uvec4 lowp mediump highp precision sampler2D sampler3D samplerCube sampler2DShadow samplerCubeShadow sampler2DArray
sampler2DArrayShadow isampler2D isampler3D isamplerCube isampler2DArray usampler2D usampler3D usamplerCube
usampler2DArray struct attribute varying coherent volatile restrict readonly writeonly resource atomic_uint
noperspective patch sample subroutine common partition active asm class union enum typedef template this goto inline
noinline public static extern external interface long short double half fixed unsigned superp input output hvec2 hvec3
hvec4 dvec2 dvec3 dvec4 fvec2 fvec3 fvec4 sampler3DRect filter image1D image2D image3D imageCube iimage1D iimage2D
iimage3D iimageCube uimage1D uimage2D uimage3D uimageCube sizeof cast namespace using`.split(/\s+/));
/** Words a shader may use as keywords and types, not as names it declares. */
const declared = (source: string): string[] => {
  const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const names = [...code.matchAll(/\b(?:float|int|uint|bool|vec[234]|ivec[234]|mat[234])\s+([A-Za-z_]\w*)/g)].map(m => m[1]!);
  return names.filter(name => RESERVED.has(name) || name.startsWith('gl_'));
};

describe('sky shaders', () => {
  it('declare no reserved word, so the town never loses a frame to a compile error', () => {
    const group = new THREE.Group(), curtains = createAuroraCurtains(group, 1), veil = createSkyVeil(group);
    const materials = group.children.flatMap(child => (child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial ? [child.material] : []));
    expect(materials.length).toBeGreaterThanOrEqual(2);
    for (const material of materials) {
      expect(material.glslVersion).toBe(THREE.GLSL3);
      expect(declared(material.vertexShader)).toEqual([]);
      expect(declared(material.fragmentShader)).toEqual([]);
    }
    expect(declared('void main() { vec2 flat = vec2(0.0); float sample = 1.0; }')).toEqual(['flat', 'sample']);
    curtains.dispose(); veil.dispose();
  });
});
