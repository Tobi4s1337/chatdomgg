import * as THREE from 'three';
import { FORGE_MOOD_COUGH_AT, FORGE_MOOD_SIGH_AT, emberLevel, emberMotion, hash, smooth } from './timeline';

/** Pool sizes. The same caps hold on every device; nothing is created after construction. */
export const FORGE_MOOD_SOOT = 24;
export const FORGE_MOOD_EMBERS = 14;
const COUGH_CUBES = 20;
// Where the reduced-motion puff sits for its whole life: roughly where the full cough comes to rest.
const PUFF_REST_TRAVEL = 0.62, PUFF_REST_SPREAD = 0.9;

// Grey-brown clay soot, never black: it has to read against a dusk sky as a soft lump of a cough.
const SOOT_TONES = ['#7a7068', '#6b625b', '#847970', '#625a54', '#74695f'];
// Rounded lobes around the cloud centre, in metres: a body, two cheeks and a crown.
const LOBES: readonly (readonly [number, number, number, number])[] = [[0, 0, 0, 0.24], [-0.25, -0.08, 0.1, 0.17], [0.26, 0.02, -0.08, 0.18], [0.02, 0.2, 0.02, 0.16]];

const VERTEX = /* glsl */ `
  attribute vec3 aTint;
  varying vec3 vTint;
  varying vec3 vNormalW;
  varying vec3 vLocal;
  void main() {
    vTint = aTint;
    vLocal = position;
    mat4 world = modelMatrix * instanceMatrix;
    vNormalW = normalize(mat3(world) * normal);
    gl_Position = projectionMatrix * viewMatrix * world * vec4(position, 1.0);
  }
`;

// A clay cube: lit top, softened edges, and a little ember warmth on the underside of soot.
const FRAGMENT = /* glsl */ `
  uniform float uEmissive;
  uniform float uWarm;
  varying vec3 vTint;
  varying vec3 vNormalW;
  varying vec3 vLocal;
  void main() {
    vec3 a = abs(vLocal) * 2.0;
    float second = a.x + a.y + a.z - max(a.x, max(a.y, a.z)) - min(a.x, min(a.y, a.z));
    float edge = 1.0 - 0.2 * smoothstep(0.7, 1.0, second);
    vec3 n = normalize(vNormalW);
    float light = 0.64 + 0.3 * max(n.y, 0.0) + 0.08 * max(dot(n, vec3(0.57, 0.24, 0.79)), 0.0) - 0.08 * max(-n.y, 0.0);
    vec3 colour = mix(vTint * light, vTint * (0.88 + 0.12 * edge), uEmissive) * edge;
    colour += vec3(0.42, 0.17, 0.05) * uWarm * max(-n.y, 0.0) * (1.0 - uEmissive);
    gl_FragColor = vec4(colour, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const GLOW_VERTEX = /* glsl */ `
  uniform float uSize;
  varying vec2 vUv;
  void main() {
    vUv = position.xy;
    vec4 view = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    view.xy += position.xy * uSize;
    gl_Position = projectionMatrix * view;
  }
`;
const GLOW_FRAGMENT = /* glsl */ `
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    float d = length(vUv) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 2.2) * uStrength;
    gl_FragColor = vec4(vec3(1.0, 0.55, 0.2) * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Three draws: instanced soot cubes, instanced ember cubes, and a small warm glow on the anvil.
 * Positions are world metres; the caller's root has an identity transform.
 */
export function createForgeMoodLayers(anvil: readonly [number, number, number]) {
  const group = new THREE.Group();
  group.name = 'forge-mood';
  group.visible = false;
  const anchor = new THREE.Vector3(...anvil);
  const origin = anchor.clone().add(new THREE.Vector3(0.3, 0.06, 0.04));
  const direction = new THREE.Vector3(0.5, 1, 0.22).normalize();

  const cubeMaterial = (emissive: number) => new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { uEmissive: { value: emissive }, uWarm: { value: 0 } } });
  const sootGeometry = new THREE.BoxGeometry(1, 1, 1), emberGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sootTint = new THREE.InstancedBufferAttribute(new Float32Array(FORGE_MOOD_SOOT * 3), 3);
  const emberTint = new THREE.InstancedBufferAttribute(new Float32Array(FORGE_MOOD_EMBERS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  sootGeometry.setAttribute('aTint', sootTint);
  emberGeometry.setAttribute('aTint', emberTint);
  const sootMaterial = cubeMaterial(0), emberMaterial = cubeMaterial(1);
  const soot = new THREE.InstancedMesh(sootGeometry, sootMaterial, FORGE_MOOD_SOOT);
  const embers = new THREE.InstancedMesh(emberGeometry, emberMaterial, FORGE_MOOD_EMBERS);
  soot.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  embers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  soot.frustumCulled = embers.frustumCulled = false;
  const glowGeometry = new THREE.PlaneGeometry(1, 1);
  const glowMaterial = new THREE.ShaderMaterial({ vertexShader: GLOW_VERTEX, fragmentShader: GLOW_FRAGMENT, uniforms: { uSize: { value: 1.5 }, uStrength: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.position.copy(anchor).add(new THREE.Vector3(0.05, 0.16, 0));
  glow.frustumCulled = false;
  glow.renderOrder = 2;
  group.add(soot, embers, glow);

  // Authored per-particle constants, computed once.
  const tone = new THREE.Color();
  const sootOffset = Array.from({ length: FORGE_MOOD_SOOT }, (_, i) => {
    const lobe = LOBES[i % LOBES.length]!, theta = hash(i + 0.1) * Math.PI * 2, phi = Math.acos(2 * hash(i + 0.2) - 1), r = lobe[3] * Math.cbrt(0.25 + 0.75 * hash(i + 0.3));
    tone.set(SOOT_TONES[i % SOOT_TONES.length]!).multiplyScalar(0.94 + 0.12 * hash(i + 0.4));
    sootTint.setXYZ(i, tone.r, tone.g, tone.b);
    return new THREE.Vector3(lobe[0] + Math.sin(phi) * Math.cos(theta) * r, lobe[1] + Math.cos(phi) * r * 0.8, lobe[2] + Math.sin(phi) * Math.sin(theta) * r);
  });
  const sootSize = Array.from({ length: FORGE_MOOD_SOOT }, (_, i) => i < COUGH_CUBES ? (i % 4 === 0 ? 0.13 : 0.095) + 0.06 * hash(i + 0.5) : 0.05 + 0.025 * hash(i + 0.5));
  const sootFade = Array.from({ length: COUGH_CUBES }, (_, i) => 1.05 + 0.85 * hash(i + 0.6) + (i % 4 === 3 ? -0.15 : i % 4 === 0 ? 0.2 : 0));
  const sootSpin = Array.from({ length: FORGE_MOOD_SOOT }, (_, i) => new THREE.Vector3(hash(i + 0.7) - 0.5, hash(i + 0.8) - 0.5, hash(i + 0.9) - 0.5).multiplyScalar(0.9));
  const emberHome = Array.from({ length: FORGE_MOOD_EMBERS }, (_, i) => anchor.clone().add(new THREE.Vector3((hash(i + 3.1) - 0.5) * 0.86, 0.05 + 0.4 * hash(i + 3.2) ** 1.4, (hash(i + 3.3) - 0.5) * 0.42)));
  const emberSize = Array.from({ length: FORGE_MOOD_EMBERS }, (_, i) => 0.038 + 0.032 * hash(i + 3.4));

  const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Euler(), quaternion = new THREE.Quaternion(), matrix = new THREE.Matrix4(), away = new THREE.Vector3();
  const hot = new THREE.Color('#ffb24a'), dim = new THREE.Color('#a8401a'), ember = new THREE.Color();
  const place = (mesh: THREE.InstancedMesh, i: number, size: number) => {
    scale.setScalar(Math.max(size, 0));
    quaternion.setFromEuler(rotation);
    mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
  };

  /**
   * Sets every owned instance from elapsed seconds alone. Reduced motion keeps the same clock,
   * the same puff and the same ember dip, but nothing travels, wobbles, spins or hops.
   */
  function pose(t: number, reduced: boolean) {
    group.visible = true;
    // The soot: a tiny tickle at the anvil, one burst, a lingering lump that crumbles away.
    for (let i = 0; i < COUGH_CUBES; i++) {
      const tau = t - FORGE_MOOD_COUGH_AT - 0.05 * hash(i + 1.1);
      const fade = 1 - smooth(sootFade[i]!, sootFade[i]! + 0.42, t);
      let size = 0;
      if (reduced) {
        // The puff simply appears where it would come to rest, and crumbles there.
        if (tau >= 0) {
          position.copy(origin).addScaledVector(direction, PUFF_REST_TRAVEL).addScaledVector(sootOffset[i]!, PUFF_REST_SPREAD);
          size = sootSize[i]! * 0.86 * smooth(0, 0.2, tau) * fade;
          rotation.set((hash(i + 2.1) - 0.5) * 0.5, hash(i + 2.2) * 1.6, (hash(i + 2.3) - 0.5) * 0.5);
        }
      } else if (tau >= 0) {
        const travel = 0.56 * (1 - Math.exp(-tau * 6.5)) + 0.12 * tau, spread = 0.22 + 0.7 * (1 - Math.exp(-tau * 7)) + 0.1 * tau;
        position.copy(origin).addScaledVector(direction, travel).addScaledVector(sootOffset[i]!, spread);
        position.x += Math.sin(t * 1.3 + i * 2.1) * 0.025;
        position.y += Math.sin(t * 1.1 + i * 1.7) * 0.02;
        const pop = 0.3 + 0.7 * smooth(0, 0.1, tau) + 0.14 * smooth(0.05, 0.14, tau) * (1 - smooth(0.14, 0.4, tau));
        size = sootSize[i]! * pop * fade;
        const spin = 1 - Math.exp(-tau * 2.2);
        // Mostly upright cubes read as one voxel puff; a little tilt keeps it soft.
        rotation.set((hash(i + 2.1) - 0.5) * 0.5 + sootSpin[i]!.x * spin, hash(i + 2.2) * 1.6 + sootSpin[i]!.y * spin, (hash(i + 2.3) - 0.5) * 0.5 + sootSpin[i]!.z * spin);
      } else if (i < 3 && t > 0.1) {
        // The tickle before the cough: three crumbs swell where it will come out.
        const swell = smooth(0.1, 0.25, t);
        position.copy(origin).addScaledVector(sootOffset[i]!, 0.12 * swell);
        position.y += 0.02 * Math.sin(t * 40 + i);
        size = sootSize[i]! * 0.42 * swell;
        rotation.set((hash(i + 2.1) - 0.5) * 0.5, hash(i + 2.2) * 1.6, (hash(i + 2.3) - 0.5) * 0.5);
      }
      place(soot, i, size);
    }
    // The sigh: a few crumbs rise slowly, curl and fade halfway through the sulk. It is all travel,
    // so reduced motion leaves it out.
    for (let j = 0; j < FORGE_MOOD_SOOT - COUGH_CUBES; j++) {
      const i = COUGH_CUBES + j, tau = t - FORGE_MOOD_SIGH_AT - 0.07 * j;
      let size = 0;
      if (!reduced && tau >= 0) {
        position.copy(origin).add(away.set(0.03 * j - 0.04 + 0.07 * Math.sin(tau * 2.4 + j), 0.05 + 0.4 * (1 - Math.exp(-tau * 2.1)), 0.02 * j));
        size = sootSize[i]! * smooth(0, 0.12, tau) * (1 - smooth(0.42, 0.78, tau));
        rotation.set(j + tau * 1.4, j * 2 + tau, 0.5 * j);
      }
      place(soot, i, size);
    }
    soot.instanceMatrix.needsUpdate = true;

    // The fire: a little intake, a startled drop, a droop, then a hop back to itself.
    const level = emberLevel(t), motion = emberMotion(t), still = reduced ? 0 : 1;
    for (let i = 0; i < FORGE_MOOD_EMBERS; i++) {
      const home = emberHome[i]!, h = hash(i + 4.1);
      position.copy(home);
      if (!reduced) {
        const bob = Math.sin(t * (1.6 + h) + h * 9) * 0.035 * (1 - 0.7 * motion.droop);
        position.lerp(origin, 0.32 * motion.draw);
        away.copy(home).sub(origin).normalize();
        position.addScaledVector(away, 0.17 * motion.scatter).addScaledVector(direction, 0.05 * motion.scatter);
        position.y += bob - motion.droop * (0.05 + 0.3 * (home.y - anchor.y)) + motion.hop * (0.08 + 0.05 * h) - motion.sink * (home.y - anchor.y) * 0.85;
      }
      rotation.set(h * 5 + t * (0.4 + h) * still, h * 3, h * 7 + t * 0.3 * still);
      place(embers, i, level < 0.01 ? 0 : emberSize[i]! * (0.45 + 0.55 * Math.min(1, level)) * (1 - 0.55 * motion.sink));
      const flicker = reduced ? 0.95 + 0.05 * Math.sin(t * 2.4 + h * 20) : 0.86 + 0.14 * Math.sin(t * (6 + 3 * h) + h * 20);
      ember.copy(dim).lerp(hot, Math.min(1, level)).multiplyScalar((0.55 + 1.35 * Math.min(level, 1.3)) * flicker);
      emberTint.setXYZ(i, ember.r, ember.g, ember.b);
    }
    embers.instanceMatrix.needsUpdate = true;
    emberTint.needsUpdate = true;
    sootMaterial.uniforms.uWarm!.value = Math.min(1, level) * 0.8;
    glowMaterial.uniforms.uStrength!.value = 0.34 * Math.min(level, 1.3);
    glowMaterial.uniforms.uSize!.value = 1.25 + 0.3 * Math.min(level, 1.3);
  }

  function hide() {
    group.visible = false;
    glowMaterial.uniforms.uStrength!.value = 0;
  }

  function dispose() {
    group.removeFromParent();
    sootGeometry.dispose(); emberGeometry.dispose(); glowGeometry.dispose();
    sootMaterial.dispose(); emberMaterial.dispose(); glowMaterial.dispose();
    soot.dispose(); embers.dispose();
  }

  return { group, pose, hide, dispose };
}
