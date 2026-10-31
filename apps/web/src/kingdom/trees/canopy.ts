import * as THREE from 'three';
import type { CanopyMotion } from '../../../../../packages/content/src/trees';

/**
 * The quiet breeze in the crowns. One displacement function of a point's position in its tree, written twice: in GLSL
 * for the clay-derived tree material (and so for its sun caster, which compiles the same vertex shader), and in
 * TypeScript for tests and for anything on the CPU that must agree with the picture.
 *
 * - Roots and bole are fixed: below the crown pivot, and within reach of the ground, the offset is exactly zero.
 * - The offset is a smooth function of position, so wood and leaves that touch keep touching; nothing detaches.
 * - Each tree takes its phase from its own placement, and gusts roll across the grove along the wind, so no two
 *   trees move in step and the woods never pulse together.
 * - Motion is horizontal and small (`sway` + `flutter`, at most about a voxel): the silhouette holds. A cached sun
 *   shadow drawn at any moment differs from the live crown by no more than that.
 */

/** The one line of the kingdom clay vertex shader the tree material extends (the instancing transform). */
export const CANOPY_VERTEX_ANCHOR = 'local=instanceMatrix*local;n=mat3(instanceMatrix)*n;vLodFade=aLodFade;';

const GLSL = `
      {
        // Blueprint-local metres: undo the instance's detail-level scale on the raw vertex.
        float canopyLevel=length(instanceMatrix[0].xyz);
        vec3 canopyLocal=vec3(p*uScale)*canopyLevel;
        vec3 canopyOrigin=instanceMatrix[3].xyz;
        float canopyHeight=canopyLocal.y,canopyRadial=length(canopyLocal.xz-aCanopyRoot.xy)/max(aCanopy.z,.001);
        float canopyRise=clamp((canopyHeight-aCanopy.x)/max(aCanopy.y-aCanopy.x,.001),0.,1.);
        float canopyHang=smoothstep(.25,1.,canopyRadial)*smoothstep(.25,.9,canopyHeight);
        float canopyWeight=mix(canopyRise*canopyRise*(3.-2.*canopyRise),canopyHang,aCanopy.w);
        float canopyStrength=length(uCanopyWind.xz);
        vec2 canopyDir=canopyStrength>0.?uCanopyWind.xz/canopyStrength:vec2(1.,0.);
        float canopySeed=fract(sin(dot(canopyOrigin.xz,vec2(12.9898,78.233)))*43758.5453)*6.2831853;
        float canopyTravel=dot(canopyOrigin.xz,canopyDir)*.045;
        float canopyTime=uCanopyTime*6.2831853/aCanopyMotion.z;
        float canopySway=.3+.55*sin(canopyTime-canopyTravel+canopySeed)+.15*sin(canopyTime*1.87+canopySeed*1.7);
        float canopyFlutter=sin(uCanopyTime*2.7+dot(canopyLocal,vec3(1.7,1.1,1.3))+canopySeed);
        vec2 canopyOffset=canopyStrength*canopyWeight*(canopyDir*aCanopyMotion.x*canopySway+vec2(-canopyDir.y,canopyDir.x)*aCanopyMotion.y*canopyFlutter);
        local.xz+=canopyOffset;
      }`;

const HEADER = 'in vec4 aCanopy;in vec4 aCanopyMotion;in vec2 aCanopyRoot;uniform float uCanopyTime;uniform vec3 uCanopyWind;\n';

/** The clay vertex shader with the canopy offset applied right after the instance transform. */
export function canopyVertexShader(clay: string): string {
  const parts = clay.split(CANOPY_VERTEX_ANCHOR);
  if (parts.length !== 2) throw new Error('Picture trees cannot find their one instancing anchor in the kingdom clay vertex shader.');
  return `${HEADER}${parts[0]}${CANOPY_VERTEX_ANCHOR}${GLSL}${parts[1]}`;
}

/** Adds the two wind uniforms to the shared clay uniforms object (idempotent); the clay shader itself ignores them. */
export function installCanopyUniforms(uniforms: Record<string, THREE.IUniform>): { uCanopyTime: THREE.IUniform<number>; uCanopyWind: THREE.IUniform<THREE.Vector3> } {
  uniforms.uCanopyTime ??= { value: 0 };
  uniforms.uCanopyWind ??= { value: new THREE.Vector3(0.8, 0, 0.6) };
  return { uCanopyTime: uniforms.uCanopyTime as THREE.IUniform<number>, uCanopyWind: uniforms.uCanopyWind as THREE.IUniform<THREE.Vector3> };
}

/**
 * The tree material: the kingdom clay's own uniforms object (light field, grade, fog, sun-shadow receiver) and
 * fragment shader, with only the anchored vertex change. `sync` follows later receiver injections into the clay
 * fragment shader, the same way ground dressing does. A sun caster registered from a mesh of this material
 * compiles this vertex shader, so shadow depth always moves with the crown it is drawn from.
 */
export function createCanopyMaterial(clay: THREE.ShaderMaterial): { material: THREE.ShaderMaterial; sync(): void; setWind(time: number, direction: readonly [number, number], strength: number): void; dispose(): void } {
  if (clay.glslVersion !== THREE.GLSL3) throw new Error('Picture trees derive only from the GLSL3 kingdom clay material.');
  const wind = installCanopyUniforms(clay.uniforms);
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: clay.uniforms, defines: { ...clay.defines },
    vertexShader: canopyVertexShader(clay.vertexShader), fragmentShader: clay.fragmentShader,
    alphaToCoverage: clay.alphaToCoverage,
  });
  material.name = 'picture-trees';
  return {
    material,
    sync() {
      if (material.fragmentShader === clay.fragmentShader && material.uniforms === clay.uniforms) return;
      material.fragmentShader = clay.fragmentShader; material.uniforms = clay.uniforms; material.needsUpdate = true;
    },
    setWind(time, direction, strength) {
      const length = Math.hypot(direction[0], direction[1]) || 1, k = Math.max(0, Math.min(1, strength)) / length;
      wind.uCanopyTime.value = time; wind.uCanopyWind.value.set(direction[0] * k, 0, direction[1] * k);
    },
    dispose() { material.dispose(); },
  };
}

/**
 * Per-form constants, one value read by every instance (the ground-dressing band trick): attach all three to each
 * detail level's geometry of a tree form, before its mesh is drawn or registered as a sun caster.
 */
export function canopyAttributes(canopy: CanopyMotion, root: readonly [number, number, number]): Record<'aCanopy' | 'aCanopyMotion' | 'aCanopyRoot', THREE.InstancedBufferAttribute> {
  const constant = (values: readonly number[]) => new THREE.InstancedBufferAttribute(new Float32Array(values), values.length, false, 0x40000000);
  return {
    aCanopy: constant([canopy.pivot, canopy.top, canopy.reach, canopy.hang]),
    aCanopyMotion: constant([canopy.sway, canopy.flutter, canopy.period, 0]),
    aCanopyRoot: constant([root[0] * 0.125, root[2] * 0.125]),
  };
}
export function attachCanopy(geometry: THREE.BufferGeometry, canopy: CanopyMotion, root: readonly [number, number, number]): void {
  for (const [name, attribute] of Object.entries(canopyAttributes(canopy, root))) geometry.setAttribute(name, attribute);
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fract = (x: number) => x - Math.floor(x);

/**
 * The CPU mirror of the GLSL offset: blueprint-local metres in, world-space horizontal offset out. `origin` is the
 * placement's `position`, `wind` the direction scaled by strength (0..1).
 */
export function canopyOffset(canopy: CanopyMotion, rootLocal: readonly [number, number], local: readonly [number, number, number], origin: readonly [number, number, number], time: number, wind: readonly [number, number]): [number, number] {
  const radial = Math.hypot(local[0] - rootLocal[0], local[2] - rootLocal[1]) / Math.max(canopy.reach, 0.001);
  const rise = Math.max(0, Math.min(1, (local[1] - canopy.pivot) / Math.max(canopy.top - canopy.pivot, 0.001)));
  const hang = smooth(0.25, 1, radial) * smooth(0.25, 0.9, local[1]);
  const weight = rise * rise * (3 - 2 * rise) * (1 - canopy.hang) + hang * canopy.hang;
  const strength = Math.hypot(wind[0], wind[1]);
  const dir = strength > 0 ? [wind[0] / strength, wind[1] / strength] as const : [1, 0] as const;
  const seed = fract(Math.sin(origin[0] * 12.9898 + origin[2] * 78.233) * 43758.5453) * 6.2831853;
  const travel = (origin[0] * dir[0] + origin[2] * dir[1]) * 0.045, t = time * 6.2831853 / canopy.period;
  const sway = 0.3 + 0.55 * Math.sin(t - travel + seed) + 0.15 * Math.sin(t * 1.87 + seed * 1.7);
  const flutter = Math.sin(time * 2.7 + local[0] * 1.7 + local[1] * 1.1 + local[2] * 1.3 + seed);
  return [
    strength * weight * (dir[0] * canopy.sway * sway - dir[1] * canopy.flutter * flutter),
    strength * weight * (dir[1] * canopy.sway * sway + dir[0] * canopy.flutter * flutter),
  ];
}
