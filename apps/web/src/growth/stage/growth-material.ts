import * as THREE from 'three';
import type { VoxelRenderState } from '@chatdom/render';

/**
 * The kingdom's own voxel material, cut by height so a home can be raised course by course without remeshing:
 * `uGrow` = (floor, top) in world metres. Only the courses between them are drawn, and the newest course carries a
 * warm edge, the way fresh timber catches lantern light. Each piece being raised gets its own material (and mesh);
 * they all share one compiled program, and a piece's cut is one uniform rather than a per-instance attribute, so a
 * single draw raises it with no instancing bookkeeping. The terrain variant cuts by a ring instead, so new streets
 * spread outward from a quarter's green; the ring stays fully off (w = 0) unless a caller sets one, because a
 * zero-radius ring with w = 1 would discard everything.
 */
const VERTEX_DECLARATIONS = 'out float vGrowFloor; out float vGrowTop; uniform vec2 uGrow;\n';
const VERTEX_ANCHOR = 'vWorld=world.xyz;';
const VERTEX_GROW = 'vWorld=world.xyz;vGrowFloor=uGrow.x;vGrowTop=uGrow.y;';
const FRAGMENT_DECLARATIONS = 'in float vGrowFloor; in float vGrowTop; uniform float uGrowGlow; uniform vec4 uGrowRing;\n';
const FRAGMENT_ANCHOR = 'float threshold=fract(dot(floor(gl_FragCoord.xy),vec2(.754877666,.569840296)));';
const FRAGMENT_CUT = `if(vWorld.y<vGrowFloor||vWorld.y>vGrowTop)discard;
      if(uGrowRing.w!=0.){float ringDistance=length(vWorld.xz-uGrowRing.xy)-uGrowRing.z;if(ringDistance*uGrowRing.w>0.)discard;}
      ${FRAGMENT_ANCHOR}`;
const OUTPUT_ANCHOR = 'gl_FragColor=vec4(colour,1.);';
const OUTPUT_GLOW = `if(vGrowTop<1e5){float course=1.-smoothstep(0.,.42,vGrowTop-vWorld.y);colour+=vec3(1.,.52,.2)*course*uGrowGlow*(.35+.65*uNight);}
      gl_FragColor=vec4(colour,1.);`;

function inject(shader: string, anchor: string, replacement: string, what: string): string {
  if (shader.split(anchor).length !== 2) throw new Error(`The voxel ${what} anchor for growth is missing or repeated.`);
  return shader.replace(anchor, replacement);
}

export interface GrowthMaterial {
  readonly material: THREE.ShaderMaterial;
  /** World-space floor and top of the courses drawn. */
  setCut(floor: number, top: number): void;
  /** Keep the inside (1) or the outside (-1) of a ring around (x, z); 0 disables. */
  setRing(x: number, z: number, radius: number, keep: -1 | 0 | 1): void;
  setGlow(value: number): void;
  dispose(): void;
}

export function createGrowthMaterial(state: VoxelRenderState): GrowthMaterial {
  const base = state.material;
  const vertexShader = inject(base.vertexShader.replace('void main(){', `${VERTEX_DECLARATIONS}void main(){`), VERTEX_ANCHOR, VERTEX_GROW, 'vertex');
  if (!vertexShader.includes(VERTEX_DECLARATIONS)) throw new Error('The voxel vertex entry point for growth is missing.');
  let fragmentShader = inject(base.fragmentShader, FRAGMENT_ANCHOR, FRAGMENT_CUT, 'fragment');
  fragmentShader = inject(fragmentShader, OUTPUT_ANCHOR, OUTPUT_GLOW, 'output');
  fragmentShader = fragmentShader.replace('void main(){', `${FRAGMENT_DECLARATIONS}void main(){`);
  const own = { uGrow: { value: new THREE.Vector2(-1e6, 1e6) }, uGrowGlow: { value: 0 }, uGrowRing: { value: new THREE.Vector4(0, 0, 0, 0) } };
  // Shared uniform objects keep the environment, light volumes and shadows in step with the kingdom material.
  const material = new THREE.ShaderMaterial({ glslVersion: base.glslVersion, uniforms: { ...base.uniforms, ...own }, defines: { ...base.defines },
    vertexShader, fragmentShader, alphaToCoverage: base.alphaToCoverage, side: base.side });
  material.onBeforeRender = base.onBeforeRender;
  return {
    material,
    setCut(floor, top) { own.uGrow.value.set(floor, top); },
    setRing(x, z, radius, keep) { own.uGrowRing.value.set(x, z, radius, keep); },
    setGlow(value) { own.uGrowGlow.value = value; },
    dispose() { material.dispose(); },
  };
}
