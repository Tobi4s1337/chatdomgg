import * as THREE from 'three';

export interface Environment {
  zenith: string;
  horizon: string;
  fog: string;
  ambient: string;
  sun: string;
  sunDirection: [number, number, number];
  sunIntensity: number;
  ambientIntensity: number;
  night: number;
}

type Grade = Omit<Environment, 'sunDirection'> & { hour: number };

// These are deliberately authored as a sequence, rather than a physical latitude/clock.
// The live kingdom can hold dusk for as long as its story needs it.
const grades: Grade[] = [
  { hour: 0, zenith: '#171d48', horizon: '#454267', fog: '#505474', ambient: '#7484bb', sun: '#aebde6', sunIntensity: 0.13, ambientIntensity: 0.55, night: 1 },
  { hour: 5, zenith: '#302d59', horizon: '#a87787', fog: '#827d96', ambient: '#a49bbf', sun: '#e6ad96', sunIntensity: 0.28, ambientIntensity: 0.65, night: 0.65 },
  { hour: 7, zenith: '#8e9fc0', horizon: '#efd0a8', fog: '#c3b9b4', ambient: '#c5cbe0', sun: '#ffddb1', sunIntensity: 0.95, ambientIntensity: 0.85, night: 0.04 },
  { hour: 12, zenith: '#6595c1', horizon: '#d3e0df', fog: '#b5c9d3', ambient: '#d4e1ea', sun: '#fff1d5', sunIntensity: 1.3, ambientIntensity: 0.95, night: 0 },
  { hour: 16, zenith: '#8098bb', horizon: '#edc498', fog: '#cbbab0', ambient: '#d2c8d1', sun: '#ffcf92', sunIntensity: 1.12, ambientIntensity: 0.86, night: 0 },
  { hour: 19, zenith: '#46578d', horizon: '#b68fa9', fog: '#777f9e', ambient: '#98a5c8', sun: '#ffc58b', sunIntensity: 0.95, ambientIntensity: 0.62, night: 0.22 },
  { hour: 21, zenith: '#252f62', horizon: '#655d86', fog: '#565e80', ambient: '#8494c0', sun: '#c3c8e2', sunIntensity: 0.32, ambientIntensity: 0.53, night: 0.78 },
  { hour: 24, zenith: '#171d48', horizon: '#454267', fog: '#505474', ambient: '#7484bb', sun: '#aebde6', sunIntensity: 0.13, ambientIntensity: 0.55, night: 1 },
];

const blendColor = (a: string, b: string, t: number): string =>
  `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;

/** Hour wraps at midnight, including negative and greater-than-24 values. */
export function getEnvironment(hour: number): Environment {
  const h = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 12;
  const index = grades.findIndex((grade) => grade.hour > h);
  // The wrapped hour is in [0, 24), bracketed by the 0 and 24 keys.
  const a = grades[index - 1]!;
  const b = grades[index]!;
  const u = (h - a.hour) / (b.hour - a.hour);
  const t = u * u * (3 - 2 * u);
  const angle = (h - 6) * Math.PI / 12;
  const direction = new THREE.Vector3(Math.cos(angle), Math.sin(angle) + 0.55, -0.35).normalize();
  return {
    zenith: blendColor(a.zenith, b.zenith, t), horizon: blendColor(a.horizon, b.horizon, t),
    fog: blendColor(a.fog, b.fog, t), ambient: blendColor(a.ambient, b.ambient, t),
    sun: blendColor(a.sun, b.sun, t), sunDirection: [direction.x, direction.y, direction.z],
    sunIntensity: THREE.MathUtils.lerp(a.sunIntensity, b.sunIntensity, t),
    ambientIntensity: THREE.MathUtils.lerp(a.ambientIntensity, b.ambientIntensity, t),
    night: THREE.MathUtils.lerp(a.night, b.night, t),
  };
}

const skyVertex = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    vec4 clip = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
    gl_Position = clip.xyww;
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uZenith, uHorizon, uSunColor, uSunDirection, uBeaconDirection;
  uniform float uNight, uTime, uBeaconStrength;
  varying vec3 vDirection;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x), mix(hash(i+vec2(0.,1.)), hash(i+1.), f.x), f.y);
  }
  void main() {
    vec3 d = normalize(vDirection);
    float altitude = max(d.y, 0.0);
    vec3 color = mix(uHorizon, uZenith, pow(smoothstep(0.0, 1.0, altitude), 0.62));
    float towardSun = max(dot(d, uSunDirection), 0.0);
    color += uSunColor * pow(towardSun, 12.0) * (1.0-uNight) * 0.11;
    float sun = smoothstep(0.9991, 0.9995, towardSun) * smoothstep(-0.04, 0.08, uSunDirection.y) * (1.0-uNight);
    color = mix(color, uSunColor * 1.08, sun * 0.85);
    vec3 moonDir = normalize(vec3(-uSunDirection.x, max(0.16, -uSunDirection.y), -uSunDirection.z));
    float moonDot = dot(d, moonDir);
    float moon = smoothstep(0.9991, 0.99945, moonDot) * uNight;
    color += vec3(0.20, 0.22, 0.30) * pow(max(moonDot, 0.0), 240.0) * uNight;
    color = mix(color, vec3(0.72, 0.74, 0.72), moon * 0.88);
    // Broad, low-contrast broken brush strokes. Projection fades at the horizon,
    // preventing an infinitely stretched line and keeping the skyline readable.
    vec2 cloudUV = d.xz / max(d.y + 0.32, 0.32);
    cloudUV *= vec2(2.5, 4.8);
    cloudUV.x += uTime * 0.003;
    float cloud = noise(cloudUV) * 0.65 + noise(cloudUV * 2.03 + 8.7) * 0.25 + noise(cloudUV * 4.1) * 0.10;
    cloud = smoothstep(0.48, 0.65, cloud) * smoothstep(0.025, 0.18, d.y) * (1.0-smoothstep(0.70, 1.0, d.y));
    vec3 cloudColor = mix(mix(uHorizon, vec3(0.9, 0.84, 0.79), 0.46), vec3(0.25, 0.27, 0.40), uNight);
    color = mix(color, cloudColor, cloud * mix(0.48, 0.28, uNight));
    // Light catches the underside of the clouds where the beacon reaches them.
    // This is angular and soft, so it remains a patch of sky rather than a wedge.
    float beaconCloud = exp(-pow(acos(clamp(dot(d, uBeaconDirection), -1.0, 1.0)) / 0.16, 2.0));
    color += vec3(0.32, 0.13, 0.045) * beaconCloud * cloud * uBeaconStrength;
    // Sparse pinpricks anchored to sky direction; no time-dependent shimmer.
    vec2 starUV = vec2(atan(d.z, d.x) * 34.0, asin(clamp(d.y, -1.0, 1.0)) * 34.0);
    vec2 cell = floor(starUV), local = fract(starUV);
    float chance = hash(cell);
    vec2 point = vec2(hash(cell + 17.1), hash(cell + 31.7)) * 0.7 + 0.15;
    float star = (1.0-smoothstep(0.015, 0.065, length(local-point))) * step(0.982, chance);
    color += vec3(0.64, 0.70, 0.85) * star * uNight * smoothstep(0.04, 0.25, d.y) * (1.0-cloud*0.8) * 0.65;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const shaftVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const shaftFragment = /* glsl */ `
  uniform float uStrength, uTime;
  varying vec2 vUv;
  void main() {
    float x = abs(vUv.x * 2.0 - 1.0);
    float height = vUv.y;
    float envelope = smoothstep(0.0, 0.045, height) * (1.0-smoothstep(0.65, 1.0, height));
    float core = exp(-x*x*90.0) * (1.0-smoothstep(0.12, 0.83, height));
    float veil = exp(-x*x*12.0) * (0.9 + 0.1*sin(height*10.0-uTime*0.25));
    float alpha = envelope * (core*0.40 + veil*0.13) * uStrength;
    vec3 color = mix(vec3(0.95, 0.42, 0.12), vec3(1.0, 0.72, 0.33), core);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const haloFragment = /* glsl */ `
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float halo = exp(-dot(p,p)*5.5) * (1.0-smoothstep(0.48, 1.0, length(p)));
    gl_FragColor = vec4(vec3(0.91, 0.48, 0.22), halo * uStrength * 0.17);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The sky follows camera translation but retains world orientation. Dispose when the scene is torn down. */
export function createAtmosphere(scene: THREE.Scene): {
  update(hour: number, elapsedSeconds: number, camera: THREE.Camera, beaconPosition: THREE.Vector3, beaconStrength: number): void;
  dispose(): void;
} {
  const skyGeometry = new THREE.SphereGeometry(1, 48, 24);
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunColor: { value: new THREE.Color() }, uSunDirection: { value: new THREE.Vector3() }, uBeaconDirection: { value: new THREE.Vector3(0, 1, 0) }, uBeaconStrength: { value: 0 }, uNight: { value: 0 }, uTime: { value: 0 } },
    vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);

  const shaftGeometry = new THREE.PlaneGeometry(1, 1);
  const shaftMaterial = new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 0 }, uTime: { value: 0 } }, vertexShader: shaftVertex, fragmentShader: shaftFragment,
    side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  });
  const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
  shaft.renderOrder = 2;
  scene.add(shaft);
  const haloGeometry = new THREE.PlaneGeometry(1, 1);
  const haloMaterial = new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 0 } }, vertexShader: shaftVertex, fragmentShader: haloFragment,
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  });
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  halo.renderOrder = 1;
  scene.add(halo);
  return {
    update(hour, elapsedSeconds, camera, beaconPosition, beaconStrength) {
      const grade = getEnvironment(hour);
      sky.position.copy(camera.position);
      skyMaterial.uniforms.uZenith!.value.set(grade.zenith);
      skyMaterial.uniforms.uHorizon!.value.set(grade.horizon);
      skyMaterial.uniforms.uSunColor!.value.set(grade.sun);
      skyMaterial.uniforms.uSunDirection!.value.fromArray(grade.sunDirection);
      skyMaterial.uniforms.uNight!.value = grade.night;
      skyMaterial.uniforms.uTime!.value = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
      const strength = Number.isFinite(beaconStrength) ? THREE.MathUtils.clamp(beaconStrength, 0, 1) : 0;
      const height = 15 + strength * 75;
      skyMaterial.uniforms.uBeaconDirection!.value.copy(beaconPosition).add(new THREE.Vector3(0, height * 0.75, 0)).sub(camera.position).normalize();
      skyMaterial.uniforms.uBeaconStrength!.value = strength;
      shaft.visible = strength > 0.001;
      shaft.position.copy(beaconPosition).y += height * 0.5;
      shaft.scale.set(6 + strength * 7, height, 1);
      // Keep the column vertical while presenting its soft profile to the camera.
      shaft.lookAt(camera.position.x, shaft.position.y, camera.position.z);
      halo.visible = strength > 0.001;
      halo.position.copy(beaconPosition).y += height * 0.73;
      halo.quaternion.copy(camera.quaternion);
      halo.scale.setScalar(10 + strength * 18);
      haloMaterial.uniforms.uStrength!.value = strength;
      shaftMaterial.uniforms.uStrength!.value = strength;
      shaftMaterial.uniforms.uTime!.value = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
    },
    dispose() {
      scene.remove(sky, shaft, halo);
      skyGeometry.dispose(); skyMaterial.dispose(); shaftGeometry.dispose(); shaftMaterial.dispose(); haloGeometry.dispose(); haloMaterial.dispose();
    },
  };
}
