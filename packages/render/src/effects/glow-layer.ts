import * as THREE from 'three';
import type { GlowPose } from './ambient';

// Small camera-facing squares (a moving spark stretched into a short tick along its motion), sized in world metres but clamped in screen pixels: near the camera a glint stays a
// glint (never a floating lamp), far away it never shrinks below a stable pixel and dims instead of shimmering.
// Linear HDR colour above the bloom threshold gives a source-sized glow from the existing post stack. Normal blending
// (not additive) keeps overlaps from stacking into a white veil; depth test keeps voxel silhouettes in front.
const vertexShader = /* glsl */ `
  attribute vec4 aPose;
  attribute vec4 aColour;
  attribute vec3 aStreak;
  uniform vec2 uViewport;
  uniform float uMinPixels, uMaxPixels, uMaxStreak, uFogDensity;
  uniform vec2 uFogRange;
  varying vec4 vColour;
  varying vec2 vCorner;
  varying float vAlong;
  void main() {
    vec4 view = viewMatrix * vec4(aPose.xyz, 1.0);
    float depth = max(-view.z, 1e-3);
    bool perspective = projectionMatrix[3][3] < .5;
    float pixelsPerMetre = projectionMatrix[1][1] * uViewport.y * .5 / (perspective ? depth : 1.0);
    float pixels = aPose.w * pixelsPerMetre;
    float shown = clamp(pixels, uMinPixels, uMaxPixels);
    float energy = pixels < uMinPixels ? (pixels / uMinPixels) * (pixels / uMinPixels) : 1.0;
    vec4 clip = projectionMatrix * view;
    // A moving glint stretches back along its screen motion, head at the particle, by at most uMaxStreak pixels.
    vec2 axis = vec2(1.0, 0.0);
    float streak = 0.0;
    if (dot(aStreak, aStreak) > 0.0) {
      vec4 tail = projectionMatrix * (viewMatrix * vec4(aPose.xyz - aStreak, 1.0));
      if (tail.w > 1e-3 && clip.w > 1e-3) {
        vec2 run = (clip.xy / clip.w - tail.xy / tail.w) * uViewport * .5;
        float runLength = length(run);
        if (runLength > .25) { axis = run / runLength; streak = min(runLength, uMaxStreak); }
      }
    }
    // position.x runs from tail (-.5) to head (.5) along the axis; position.y across it.
    float along = mix(-(shown * .5 + streak), shown * .5, position.x + .5);
    vec2 offset = axis * along + vec2(-axis.y, axis.x) * position.y * shown;
    clip.xy += offset / (uViewport * .5) * clip.w;
    gl_Position = clip;
    float fog = uFogDensity > 0.0 ? 1.0 - exp(-uFogDensity * uFogDensity * depth * depth)
      : uFogRange.y > uFogRange.x ? smoothstep(uFogRange.x, uFogRange.y, depth) : 0.0;
    // A streak spreads the same light over more pixels, so it dims as it lengthens.
    float spread = shown / (shown + streak * .6);
    vColour = vec4(aColour.rgb, aColour.a * energy * (1.0 - fog) * mix(1.0, spread, .5));
    vCorner = position.xy * 2.0;
    vAlong = streak > 0.0 ? position.x + .5 : 1.0;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec4 vColour;
  varying vec2 vCorner;
  varying float vAlong;
  void main() {
    vec2 d = abs(vCorner);
    float edge = max(d.x, d.y);
    // A crisp pixel square: a one-texel antialiased rim, no radial blob falloff.
    float rim = max(fwidth(edge), 1e-4);
    float cover = 1.0 - smoothstep(1.0 - rim, 1.0, edge);
    // The tail of a streak cools toward nothing; the head stays a crisp square.
    float alpha = vColour.a * cover * mix(.15, 1.0, vAlong * vAlong);
    if (alpha < .004) discard;
    gl_FragColor = vec4(vColour.rgb, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const FOG_SCALE = .72;

export class GlowLayer {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private pose!: THREE.InstancedBufferAttribute;
  private colour!: THREE.InstancedBufferAttribute;
  private streak!: THREE.InstancedBufferAttribute;
  private count = 0;
  private viewport = new THREE.Vector4();

  constructor(capacity: number, pixels: { min: number; max: number; streak: number }) {
    const material = new THREE.ShaderMaterial({
      name: 'Chatdom effects glow', vertexShader, fragmentShader,
      uniforms: {
        uViewport: { value: new THREE.Vector2(1920, 1080) }, uMinPixels: { value: pixels.min }, uMaxPixels: { value: pixels.max },
        uMaxStreak: { value: pixels.streak },
        uFogDensity: { value: 0 }, uFogRange: { value: new THREE.Vector2(0, 0) },
      },
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(this.allocate(capacity), material);
    this.mesh.name = 'Chatdom effects glow';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    // Lit, fogged glints draw after opaque voxels and the window halos.
    this.mesh.renderOrder = 3;
    this.mesh.onBeforeRender = (renderer, scene) => {
      const uniforms = material.uniforms;
      renderer.getCurrentViewport(this.viewport);
      uniforms.uViewport!.value.set(Math.max(1, this.viewport.z), Math.max(1, this.viewport.w));
      const fog = scene.fog;
      uniforms.uFogDensity!.value = fog instanceof THREE.FogExp2 ? fog.density * FOG_SCALE : 0;
      if (fog instanceof THREE.Fog) uniforms.uFogRange!.value.set(fog.near, fog.far);
      else uniforms.uFogRange!.value.set(0, 0);
    };
  }

  get capacity(): number { return this.pose.count; }
  get drawn(): number { return this.count; }

  private allocate(capacity: number): THREE.InstancedBufferGeometry {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.pose = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.colour = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.streak = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aPose', this.pose);
    geometry.setAttribute('aStreak', this.streak);
    geometry.setAttribute('aColour', this.colour);
    geometry.instanceCount = 0;
    return geometry;
  }

  /** Reallocates for a new tier; the old buffers are released immediately. */
  resize(capacity: number, pixels: { min: number; max: number; streak: number }): void {
    const old = this.mesh.geometry;
    this.mesh.geometry = this.allocate(capacity);
    old.dispose();
    this.mesh.material.uniforms.uMinPixels!.value = pixels.min;
    this.mesh.material.uniforms.uMaxPixels!.value = pixels.max;
    this.mesh.material.uniforms.uMaxStreak!.value = pixels.streak;
    this.count = 0;
    this.mesh.visible = false;
  }

  begin(): void { this.count = 0; }

  push(pose: GlowPose): boolean {
    if (this.count >= this.pose.count) return false;
    const i = this.count * 4;
    const p = this.pose.array as Float32Array, c = this.colour.array as Float32Array, s = this.streak.array as Float32Array;
    const j = this.count * 3;
    s[j] = pose.sx; s[j + 1] = pose.sy; s[j + 2] = pose.sz;
    p[i] = pose.x; p[i + 1] = pose.y; p[i + 2] = pose.z; p[i + 3] = pose.size;
    c[i] = pose.r; c[i + 1] = pose.g; c[i + 2] = pose.b; c[i + 3] = pose.alpha;
    this.count++;
    return true;
  }

  end(): void {
    const geometry = this.mesh.geometry;
    geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (!this.count) return;
    for (const attribute of [this.pose, this.colour, this.streak]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, this.count * attribute.itemSize);
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
