import * as THREE from 'three';

/**
 * Skyfire's aurora: a few curtains of light, each one continuous ribbon of sky drawn by its own small shader.
 *
 * The layer that owns the beat lays each curtain out every frame as a folded path of columns (a foot on the
 * curtain's hem, a height and a light per column); this module turns that into a vertical ribbon and shades it the
 * way the real thing looks from below: a bright broken hem, bands of vertical rays that climb out of it and drift slowly
 * along the fold, a body that thins upward, green and teal low, violet and rose where the light runs out at the top.
 * Where a fold turns into the line of sight the ribbon overlaps itself and, being additive light, reads as a bright
 * pleat. It writes no depth, takes no fog or tone mapping, and the hills, castle and roofs stand in front of it.
 */

/** Columns per curtain: enough that a fold bends smoothly at stream resolution. */
export const AURORA_COLUMNS = 160;

export interface AuroraColumn {
  /** The hem, in world space. */
  x: number; y: number; z: number;
  /** Curtain height above the hem here, metres. */
  height: number;
  /** 0..1: unroll, end taper, hush behind the name. */
  light: number;
}

export interface AuroraPalette {
  /** The hem's colour, the body's, the crown's and the tips of the highest rays (linear). */
  readonly hem: THREE.Color; readonly body: THREE.Color; readonly crown: THREE.Color; readonly tip: THREE.Color;
}

const vertexShader = /* glsl */ `
  in float aLight;
  out vec2 vUv;
  out float vLight;
  void main() {
    vUv = uv;
    vLight = aLight;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  in float vLight;
  out vec4 fragColor;
  uniform float uTime, uSeed, uStrength;
  uniform vec3 uHem, uBody, uCrown, uTip;
  float hash(float n) { return fract(sin(n * 12.9898 + uSeed * 78.233) * 43758.5453); }
  float noise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
  void main() {
    // u runs along the curtain in metres, v from the hem (0) to the top of the column (1).
    float u = vUv.x, v = vUv.y, t = uTime;
    // Rays, at the scale the real thing shows from the ground: broad bright bands a dozen metres apart, rays of a
    // few metres within them and a faint fine grain, each sliding along the fold at its own pace. Sharpened, so the
    // curtain is bright rays over a dim glow rather than an even sheet.
    float bands = noise(u * 0.075 + t * 0.05);
    float rays = bands * 0.45 + noise(u * 0.31 - t * 0.16) * 0.38 + noise(u * 0.93 + t * 0.31) * 0.17;
    rays = pow(clamp(rays, 0.0, 1.0), 2.6) * 2.8;
    // Each ray reaches its own height; the long faint crown only where the rays are strong.
    float reach = 0.42 + 0.58 * noise(u * 0.11 - t * 0.04);
    float topFade = 1.0 - smoothstep(reach * 0.45, reach * (0.9 + 0.3 * rays), v);
    // The hem: the brightest line, its lower edge soft and broken by the rays rather than a ruled edge.
    float edge = 0.012 + 0.03 * (1.0 - rays * 0.5);
    float hem = smoothstep(0.0, edge, v) * exp(-v * 14.0) * (0.45 + 0.75 * rays);
    float body = smoothstep(0.0, 0.08, v) * exp(-v * 2.6) * (0.35 + 0.65 * bands);
    float streaks = rays * smoothstep(0.0, 0.05, v) * exp(-v * 1.2);
    float light = (hem * 1.3 + body * 0.2 + streaks * 0.62) * topFade;
    // The hem flickers very gently along its length, like a lit ribbon catching a breeze.
    light *= 0.85 + 0.15 * noise(u * 0.12 - t * 0.7);
    vec3 colour = mix(uHem, uBody, smoothstep(0.0, 0.16, v));
    colour = mix(colour, uCrown, smoothstep(0.24, 0.6, v));
    colour = mix(colour, uTip, smoothstep(0.58, 0.95, v));
    fragColor = vec4(colour * light * vLight * uStrength, 1.0);
  }
`;

interface Curtain {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly position: THREE.BufferAttribute;
  readonly uv: THREE.BufferAttribute;
  readonly light: THREE.BufferAttribute;
}

/** A small set of curtains under `group`; `draw` lays one out for this frame, `end` hides the ones not drawn. */
export function createAuroraCurtains(group: THREE.Group, count: number, columns = AURORA_COLUMNS) {
  const curtains: Curtain[] = [];
  const drawn = new Set<number>();
  for (let c = 0; c < count; c++) {
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(new Float32Array(columns * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const uv = new THREE.BufferAttribute(new Float32Array(columns * 2 * 2), 2).setUsage(THREE.DynamicDrawUsage);
    const light = new THREE.BufferAttribute(new Float32Array(columns * 2), 1).setUsage(THREE.DynamicDrawUsage);
    const index: number[] = [];
    for (let j = 0; j < columns - 1; j++) {
      const a = j * 2, b = a + 1, d = a + 2, e = a + 3;
      index.push(a, d, b, b, d, e);
    }
    geometry.setIndex(index);
    geometry.setAttribute('position', position);
    geometry.setAttribute('uv', uv);
    geometry.setAttribute('aLight', light);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false,
      uniforms: { uTime: { value: 0 }, uSeed: { value: c + 1 }, uStrength: { value: 1 },
        uHem: { value: new THREE.Color() }, uBody: { value: new THREE.Color() }, uCrown: { value: new THREE.Color() }, uTip: { value: new THREE.Color() } },
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `aurora-curtain-${c}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    // After the town and the sky, before the sparks and shells written over it.
    mesh.renderOrder = 4;
    group.add(mesh);
    curtains.push({ mesh, position, uv, light });
  }

  return {
    columns,
    /**
     * Lay curtain `c` out from `column(j, out)` for j in 0..columns-1. `time` drives the drifting rays (seconds of
     * the beat, so a frame looks the same whenever it is sampled); `strength` scales the whole curtain.
     */
    draw(c: number, column: (j: number, out: AuroraColumn) => void, palette: AuroraPalette, time: number, seed: number, strength = 1): void {
      const curtain = curtains[c];
      if (!curtain) return;
      const p = curtain.position.array as Float32Array, uv = curtain.uv.array as Float32Array, l = curtain.light.array as Float32Array;
      const at: AuroraColumn = { x: 0, y: 0, z: 0, height: 0, light: 0 };
      let along = 0, px = 0, pz = 0;
      for (let j = 0; j < columns; j++) {
        column(j, at);
        if (j > 0) along += Math.hypot(at.x - px, at.z - pz);
        px = at.x; pz = at.z;
        const o = j * 6, k = j * 4, light = Math.max(0, Math.min(1, at.light));
        p[o] = at.x; p[o + 1] = at.y; p[o + 2] = at.z;
        p[o + 3] = at.x; p[o + 4] = at.y + Math.max(0.01, at.height); p[o + 5] = at.z;
        uv[k] = along; uv[k + 1] = 0; uv[k + 2] = along; uv[k + 3] = 1;
        l[j * 2] = light; l[j * 2 + 1] = light;
      }
      curtain.position.needsUpdate = true; curtain.uv.needsUpdate = true; curtain.light.needsUpdate = true;
      const u = curtain.mesh.material.uniforms;
      u.uTime!.value = time; u.uSeed!.value = (seed % 997) / 97 + c * 1.37; u.uStrength!.value = strength;
      (u.uHem!.value as THREE.Color).copy(palette.hem); (u.uBody!.value as THREE.Color).copy(palette.body);
      (u.uCrown!.value as THREE.Color).copy(palette.crown); (u.uTip!.value as THREE.Color).copy(palette.tip);
      curtain.mesh.visible = true;
      drawn.add(c);
    },
    /** Hide every curtain not drawn since the last `end`. */
    end(): number {
      let shown = 0;
      curtains.forEach((curtain, c) => { curtain.mesh.visible = drawn.has(c); if (curtain.mesh.visible) shown++; });
      drawn.clear();
      return shown;
    },
    dispose(): void {
      for (const curtain of curtains) { group.remove(curtain.mesh); curtain.mesh.geometry.dispose(); curtain.mesh.material.dispose(); }
      curtains.length = 0;
    },
  };
}
export type AuroraCurtains = ReturnType<typeof createAuroraCurtains>;
