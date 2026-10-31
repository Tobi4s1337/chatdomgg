import * as THREE from 'three';
import { TAU, smooth, windScale } from './ambient';
import { unit } from './random';

/** One smoke voxel: centre and edge in world metres, its turn, opacity and how much fire-warmth it still holds. */
export interface SmokePose { x: number; y: number; z: number; size: number; yaw: number; tilt: number; alpha: number; warm: number }

export function emptySmoke(): SmokePose { return { x: 0, y: 0, z: 0, size: 0, yaw: 0, tilt: 0, alpha: 0, warm: 0 }; }

/** The longest a puff lives; its rise is bounded by this, so a chimney's smoke stays short. */
export const SMOKE_SECONDS = 4.2;

/**
 * Chimney smoke is made of soft grey voxels. Each slot is one puff after another: it leaves the real mouth small and
 * still warm from the fire below, rises and slows, turns, curls about the plume's axis, leans with the supplied wind,
 * grows and thins out within a couple of metres. A share of lives are skipped so the hearth breathes in uneven beats.
 */
export function smokePose(key: number, sx: number, sy: number, sz: number, time: number, wx: number, wz: number, out: SmokePose): boolean {
  const life = 3.2 + 1 * unit(key, 0);
  const shifted = time + life * unit(key, 1);
  const cycle = Math.floor(shifted / life), age = shifted - cycle * life, u = age / life;
  if (unit(key, 2, cycle) < .14) return false;
  // Buoyancy fades as the puff cools: fast off the mouth, nearly hanging at the top.
  const rise = (1.35 + .55 * unit(key, 3, cycle)) * (1 - (1 - u) ** 1.8);
  const ws = windScale(wx, wz);
  // The higher the puff, the more the wind has it.
  const carry = (.32 + .18 * unit(key, 4, cycle)) * age * (.35 + .65 * u) * ws;
  const turnRate = (.9 + .8 * unit(key, 5, cycle)) * (unit(key, 6, cycle) < .5 ? -1 : 1);
  const curl = TAU * unit(key, 7, cycle) + age * turnRate, radius = .04 + .26 * u;
  out.x = sx + Math.cos(curl) * radius + wx * carry;
  out.y = sy + .04 + rise;
  out.z = sz + Math.sin(curl) * radius + wz * carry;
  out.size = (.1 + .34 * Math.sqrt(u)) * (.8 + .32 * unit(key, 8, cycle));
  out.yaw = TAU * unit(key, 9, cycle) + age * .35 * turnRate;
  out.tilt = (unit(key, 10, cycle) - .5) * .9 + age * .12 * turnRate;
  out.alpha = smooth(u / .05) * (1 - smooth((u - .22) / .78)) * (.42 + .16 * unit(key, 11, cycle));
  out.warm = 1 - smooth(u / .22);
  return out.alpha > .004;
}

// Soft voxels: lit from above by the sky, darker beneath, and the faces' rims fade so the cube reads as a puff of
// smoke the size of a voxel, not a glass box. The grey takes the hour from the scene's own fog colour, so smoke is
// violet-grey at dusk and blue-grey under the moon; it never emits, so bloom leaves it alone.
const vertexShader = /* glsl */ `
  attribute vec4 aPuff;
  attribute vec4 aLook;
  uniform float uViewportHeight, uMinPixels, uMaxPixels, uFogDensity;
  uniform vec2 uFogRange;
  varying vec3 vNormal;
  varying vec2 vFace;
  varying float vAlpha, vWarm;
  void main() {
    vec4 centre = viewMatrix * vec4(aPuff.xyz, 1.0);
    float depth = max(-centre.z, 1e-3);
    bool perspective = projectionMatrix[3][3] < .5;
    float pixelsPerMetre = projectionMatrix[1][1] * uViewportHeight * .5 / (perspective ? depth : 1.0);
    float pixels = aPuff.w * pixelsPerMetre;
    float shown = clamp(pixels, uMinPixels, uMaxPixels);
    float energy = pixels < uMinPixels ? sqrt(pixels / uMinPixels) : 1.0;
    float edge = shown / max(pixelsPerMetre, 1e-6);
    float cy = cos(aLook.x), sy = sin(aLook.x), cx = cos(aLook.y), sx = sin(aLook.y);
    mat3 turn = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy) * mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
    vNormal = turn * normal;
    vFace = uv;
    vec3 world = aPuff.xyz + turn * position * edge;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    float fog = uFogDensity > 0.0 ? 1.0 - exp(-uFogDensity * uFogDensity * depth * depth)
      : uFogRange.y > uFogRange.x ? smoothstep(uFogRange.x, uFogRange.y, depth) : 0.0;
    vAlpha = aLook.z * energy * (1.0 - fog);
    vWarm = aLook.w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSmoke, uWarm;
  varying vec3 vNormal;
  varying vec2 vFace;
  varying float vAlpha, vWarm;
  void main() {
    vec3 n = normalize(vNormal);
    float light = .86 + .2 * max(n.y, 0.0) - .14 * max(-n.y, 0.0) + .04 * n.x;
    vec3 colour = uSmoke * light;
    // Fire-warmth from the hearth below lights the young puff's underside.
    colour = mix(colour, uWarm, vWarm * (.28 + .4 * max(-n.y, 0.0)));
    vec2 f = abs(vFace - .5) * 2.0;
    float rim = 1.0 - .8 * smoothstep(.3, 1.0, max(f.x, f.y));
    float alpha = vAlpha * rim;
    if (alpha < .004) discard;
    gl_FragColor = vec4(colour, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const FOG_SCALE = .72;
// Neutral grey smoke, pulled a little toward the hour's horizon tone.
const GREY = new THREE.Color(.19, .19, .2), WARM = new THREE.Color(.42, .2, .07);

export class SmokeLayer {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private puff!: THREE.InstancedBufferAttribute;
  private look!: THREE.InstancedBufferAttribute;
  private count = 0;
  private viewport = new THREE.Vector4();

  constructor(capacity: number, pixels: { min: number; max: number }) {
    const material = new THREE.ShaderMaterial({
      name: 'Chatdom effects smoke', vertexShader, fragmentShader,
      uniforms: {
        uViewportHeight: { value: 1080 }, uMinPixels: { value: pixels.min }, uMaxPixels: { value: pixels.max },
        uFogDensity: { value: 0 }, uFogRange: { value: new THREE.Vector2(0, 0) },
        uSmoke: { value: GREY.clone() }, uWarm: { value: WARM.clone() },
      },
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.FrontSide,
    });
    this.mesh = new THREE.Mesh(this.allocate(capacity), material);
    this.mesh.name = 'Chatdom effects smoke';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    const horizon = new THREE.Color();
    this.mesh.onBeforeRender = (renderer, scene) => {
      const uniforms = material.uniforms;
      renderer.getCurrentViewport(this.viewport);
      uniforms.uViewportHeight!.value = Math.max(1, this.viewport.w);
      const fog = scene.fog;
      uniforms.uFogDensity!.value = fog instanceof THREE.FogExp2 ? fog.density * FOG_SCALE : 0;
      if (fog instanceof THREE.Fog) uniforms.uFogRange!.value.set(fog.near, fog.far);
      else uniforms.uFogRange!.value.set(0, 0);
      const smoke = uniforms.uSmoke!.value as THREE.Color;
      smoke.copy(GREY);
      if (fog) {
        // Keep the grey's lightness, take a share of the horizon's hue.
        horizon.copy(fog.color);
        const level = Math.max(horizon.r, horizon.g, horizon.b, 1e-3);
        smoke.lerp(horizon.multiplyScalar(GREY.r / level), .3);
      }
    };
  }

  get capacity(): number { return this.puff.count; }
  get drawn(): number { return this.count; }

  private allocate(capacity: number): THREE.InstancedBufferGeometry {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(box.getIndex());
    geometry.setAttribute('position', box.getAttribute('position'));
    geometry.setAttribute('normal', box.getAttribute('normal'));
    geometry.setAttribute('uv', box.getAttribute('uv'));
    box.dispose();
    this.puff = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.look = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aPuff', this.puff);
    geometry.setAttribute('aLook', this.look);
    geometry.instanceCount = 0;
    return geometry;
  }

  resize(capacity: number, pixels: { min: number; max: number }): void {
    const old = this.mesh.geometry;
    this.mesh.geometry = this.allocate(capacity);
    old.dispose();
    this.mesh.material.uniforms.uMinPixels!.value = pixels.min;
    this.mesh.material.uniforms.uMaxPixels!.value = pixels.max;
    this.count = 0;
    this.mesh.visible = false;
  }

  begin(): void { this.count = 0; }

  push(pose: SmokePose): boolean {
    if (this.count >= this.puff.count) return false;
    const i = this.count * 4;
    const p = this.puff.array as Float32Array, l = this.look.array as Float32Array;
    p[i] = pose.x; p[i + 1] = pose.y; p[i + 2] = pose.z; p[i + 3] = pose.size;
    l[i] = pose.yaw; l[i + 1] = pose.tilt; l[i + 2] = pose.alpha; l[i + 3] = pose.warm;
    this.count++;
    return true;
  }

  end(): void {
    this.mesh.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (!this.count) return;
    for (const attribute of [this.puff, this.look]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, this.count * 4);
      attribute.needsUpdate = true;
    }
  }

  clear(): void { this.begin(); this.end(); }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
