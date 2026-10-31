import * as THREE from 'three';
import type { Environment } from '@chatdom/render';
import { sampleLandWater, type KingdomLandform } from '@chatdom/world';

/**
 * Bench preview of the founded pond, streams, leat and tailrace: one sheet per wet cell at each course's own
 * level, masked by the same metre terrain corners the ground mesh draws. The lake keeps the product water.
 * Rendering the finished water belongs to places-water; this only proves the geography holds water.
 */
export function createWaterPreview(scene: THREE.Scene, landform: KingdomLandform, terrain: (x: number, z: number) => number): {
  update(environment: Environment, elapsedSeconds: number): void; dispose(): void;
} {
  const positions: number[] = [], depths: number[] = [];
  const visited = new Set<string>();
  const corner = (x: number, z: number) => {
    const water = sampleLandWater(landform, x, z);
    return water ? { surface: water.surface, depth: water.surface - Math.fround(terrain(x, z)), lake: water.id === 'lake' } : undefined;
  };
  const cell = (x: number, z: number) => {
    const key = `${x},${z}`;
    if (visited.has(key)) return;
    visited.add(key);
    const c = [corner(x, z), corner(x, z + 1), corner(x + 1, z + 1), corner(x + 1, z)];
    if (c.some(v => !v || v.lake) || c.every(v => v!.depth <= 0)) return;
    // Same fixed diagonal as the terrain mesh: (00, 01, 11) and (00, 11, 10).
    const p = [[x, z], [x, z + 1], [x + 1, z + 1], [x + 1, z]] as const;
    for (const i of [0, 1, 2, 0, 2, 3]) { positions.push(p[i]![0], c[i]!.surface, p[i]![1]); depths.push(c[i]!.depth); }
  };
  for (const stream of landform.streams) for (let i = 1; i < stream.points.length; i++) {
    const a = stream.points[i - 1]!, b = stream.points[i]!, reach = Math.ceil(Math.max(a.width, b.width) / 2 + 2);
    const steps = Math.ceil(Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1]));
    for (let k = 0; k <= steps; k++) {
      const x = a.position[0] + (b.position[0] - a.position[0]) * k / steps, z = a.position[1] + (b.position[1] - a.position[1]) * k / steps;
      for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) cell(Math.floor(x) + dx, Math.floor(z) + dz);
    }
  }
  for (const body of landform.waters) {
    if (body.id === 'lake') continue;
    const rx = Math.ceil(body.radiusX * 1.25 + 2), rz = Math.ceil(body.radiusZ * 1.25 + 2);
    for (let z = Math.floor(body.z) - rz; z <= body.z + rz; z++) for (let x = Math.floor(body.x) - rx; x <= body.x + rx; x++) cell(x, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(depths, 1));
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() } },
    vertexShader: /* glsl */ `
      in float aDepth; out float vDepth; out vec3 vWorld;
      void main() { vDepth = aDepth; vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz; gl_Position = projectionMatrix * viewMatrix * world; }`,
    fragmentShader: /* glsl */ `
      out vec4 courseColour; in float vDepth;
      #define gl_FragColor courseColour
      in vec3 vWorld;
      uniform float uTime, uNight; uniform vec3 uZenith, uHorizon;
      void main() {
        if (vDepth <= 0.0) discard;
        float deep = smoothstep(0.03, 0.9, vDepth), coverage = smoothstep(0.0, max(fwidth(vDepth), 0.025) * 1.5, vDepth);
        float p = dot(vWorld.xz, vec2(0.31, 0.17)) + uTime * 0.6;
        vec3 normal = normalize(vec3(-0.04 * cos(p), 1.0, -0.03 * sin(p * 0.7)));
        vec3 viewDir = normalize(cameraPosition - vWorld), reflected = reflect(-viewDir, normal);
        vec3 sky = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.55, clamp(reflected.y, 0.0, 1.0)), 0.62));
        float fresnel = 0.18 + 0.64 * pow(1.0 - max(dot(viewDir, normal), 0.0), 5.0);
        vec3 shallow = mix(vec3(0.065, 0.14, 0.135), vec3(0.018, 0.045, 0.055), uNight);
        vec3 bed = mix(vec3(0.065, 0.18, 0.20), vec3(0.018, 0.065, 0.105), uNight);
        vec3 c = mix(mix(shallow, bed, deep), sky, fresnel * mix(0.75, 0.5, uNight) * smoothstep(0.025, 0.6, vDepth));
        gl_FragColor = vec4(c, coverage);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    update(environment, elapsedSeconds) {
      material.uniforms.uZenith!.value.set(environment.zenith);
      material.uniforms.uHorizon!.value.set(environment.horizon);
      material.uniforms.uNight!.value = environment.night;
      material.uniforms.uTime!.value = elapsedSeconds;
    },
    dispose() { scene.remove(mesh); geometry.dispose(); material.dispose(); },
  };
}
