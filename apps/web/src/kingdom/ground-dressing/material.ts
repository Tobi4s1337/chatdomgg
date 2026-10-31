import * as THREE from 'three';

/**
 * The one line of the kingdom clay vertex shader this material extends: where an instance transform is applied and
 * its detail fade read. If the clay shader changes here, ground dressing must be updated with it, so this fails
 * loudly instead of drawing every level at once.
 */
export const DRESSING_VERTEX_ANCHOR = 'local=instanceMatrix*local;n=mat3(instanceMatrix)*n;vLodFade=aLodFade;';

/**
 * Detail fades by camera distance, in the shader, with the clay's complementary dither. `aBand` is one constant per
 * level mesh (near, far, fade half-width, far edge is the form's last level): a level fades in across its near edge
 * exactly as the closer level fades out, and the last level dissolves across the far cut. An instance outside its
 * band collapses to its origin and rasterises nothing. A still camera therefore needs no instance rewrite at all.
 */
const FADE = `local=instanceMatrix*local;n=mat3(instanceMatrix)*n;
      {
        vec3 dressingOrigin=(modelMatrix*vec4(instanceMatrix[3].xyz,1.)).xyz;
        float dressingDistance=distance(cameraPosition,dressingOrigin),dressingWidth=aBand.z;
        float dressingIn=aBand.x>0.?smoothstep(aBand.x-dressingWidth,aBand.x+dressingWidth,dressingDistance):1.;
        float dressingOut=smoothstep(aBand.y-dressingWidth,aBand.y+dressingWidth,dressingDistance);
        vLodFade=dressingOut>0.?(aBand.w>.5?1.-dressingOut:-1.-dressingOut):dressingIn;
        if(dressingDistance<aBand.x-dressingWidth||dressingDistance>aBand.y+dressingWidth)local=vec4(dressingOrigin,1.);
      }`;

export function dressingVertexShader(clay: string): string {
  const parts = clay.split(DRESSING_VERTEX_ANCHOR);
  if (parts.length !== 2) throw new Error('Ground dressing cannot find its one instancing anchor in the kingdom clay vertex shader.');
  return `in vec4 aBand;\n${parts[0]}${FADE}${parts[1]}`;
}

/**
 * A material derived from the kingdom clay: the very same uniforms object (light field, grade, fog, shadows) and the
 * production fragment shader, with only the anchored vertex change. `sync` follows later receiver injections into
 * the clay fragment shader (sun shadows bind after construction); it never disposes anything of the caller's.
 */
export function createDressingMaterial(clay: THREE.ShaderMaterial): { material: THREE.ShaderMaterial; sync(): void; dispose(): void } {
  if (clay.glslVersion !== THREE.GLSL3) throw new Error('Ground dressing derives only from the GLSL3 kingdom clay material.');
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: clay.uniforms, defines: { ...clay.defines },
    vertexShader: dressingVertexShader(clay.vertexShader), fragmentShader: clay.fragmentShader,
    alphaToCoverage: clay.alphaToCoverage,
  });
  material.name = 'ground-dressing';
  return {
    material,
    sync() {
      if (material.fragmentShader === clay.fragmentShader && material.uniforms === clay.uniforms) return;
      material.fragmentShader = clay.fragmentShader; material.uniforms = clay.uniforms; material.needsUpdate = true;
    },
    dispose() { material.dispose(); },
  };
}

/** One constant per mesh: an instanced attribute every instance reads at index 0. */
export function bandAttribute(near: number, far: number, width: number, last: boolean): THREE.InstancedBufferAttribute {
  return new THREE.InstancedBufferAttribute(new Float32Array([near, far, width, last ? 1 : 0]), 4, false, 0x40000000);
}
