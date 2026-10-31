import * as THREE from 'three';

export interface Environment {
  zenith: string;
  horizon: string;
  fog: string;
  ambient: string;
  sun: string;
  /** The key light: the sun by day, the moon once the sun has set. Shading and shadows follow it. */
  sunDirection: [number, number, number];
  sunIntensity: number;
  ambientIntensity: number;
  night: number;
  /** The hour's shadow tint: where sky and sun cannot reach, surfaces sink toward this, never toward grey. */
  shadow: string;
  /** Warm glow along the horizon toward the sun; black when there is none. Sky and distance fog share it. */
  glow: string;
  /** Painted clouds: thin edges in `cloud`, thick cores and undersides in `cloudShade`, `cloudCover` 0..1 of the upper sky. */
  cloud: string;
  cloudShade: string;
  cloudCover: number;
  /** Scene `FogExp2.density` for this hour. Voxel fog scales from it with its own height falloff. */
  fogDensity: number;
  /** `renderer.toneMappingExposure` for this hour. */
  exposure: number;
}

type Grade = Omit<Environment, 'sunDirection'> & { hour: number };

// Authored as a sequence, not a physical latitude or clock: the live kingdom can hold dusk as long as
// its story needs. Noon is a clear summer day with cool blue shadows; dusk is lilac over a gold band
// with indigo shadows; night is deep blue to violet, so the only warm things are people's lights.
// Exposure stays at the shipped 1.08 for day and dusk; the dark hours lift it a little.
const grades: Grade[] = [
  { hour: 0, zenith: '#0e1745', horizon: '#2e2f66', fog: '#2a2f58', ambient: '#6474b8', shadow: '#1e2458', sun: '#a9bdf2', glow: '#000000', cloud: '#1f2552', cloudShade: '#363d78', cloudCover: 0.26, sunIntensity: 0.28, ambientIntensity: 0.52, night: 1, fogDensity: 0.0012, exposure: 1.16 },
  { hour: 5, zenith: '#3a3d7c', horizon: '#e3a48e', fog: '#8a7c9e', ambient: '#8d89c4', shadow: '#47458a', sun: '#ffb79c', glow: '#5a2a26', cloud: '#8c7bab', cloudShade: '#f2b49e', cloudCover: 0.3, sunIntensity: 0.36, ambientIntensity: 0.6, night: 0.62, fogDensity: 0.0012, exposure: 1.12 },
  { hour: 7, zenith: '#5d86c8', horizon: '#f0d4b4', fog: '#c0c6d6', ambient: '#a3b4df', shadow: '#5a68aa', sun: '#ffe2bc', glow: '#3a2414', cloud: '#fff6ee', cloudShade: '#c6c0d2', cloudCover: 0.3, sunIntensity: 1.12, ambientIntensity: 0.68, night: 0.03, fogDensity: 0.0009, exposure: 1.08 },
  { hour: 12, zenith: '#3f7fd0', horizon: '#a8cdec', fog: '#a4c4e6', ambient: '#8fb0e6', shadow: '#4b63b0', sun: '#fff0d0', glow: '#000000', cloud: '#ffffff', cloudShade: '#b3c3df', cloudCover: 0.32, sunIntensity: 1.34, ambientIntensity: 0.6, night: 0, fogDensity: 0.00064, exposure: 1.08 },
  { hour: 16, zenith: '#577fc4', horizon: '#f2cc98', fog: '#c6b8b0', ambient: '#9aa4d8', shadow: '#5658a2', sun: '#ffcf8e', glow: '#3c2210', cloud: '#fff2de', cloudShade: '#c8aab0', cloudCover: 0.3, sunIntensity: 1.34, ambientIntensity: 0.62, night: 0, fogDensity: 0.0008, exposure: 1.08 },
  { hour: 18, zenith: '#6670b8', horizon: '#f7b878', fog: '#ab95ae', ambient: '#8a8acb', shadow: '#4d4b9a', sun: '#ffb46a', glow: '#64321a', cloud: '#e2bfc8', cloudShade: '#f8b47c', cloudCover: 0.3, sunIntensity: 1.18, ambientIntensity: 0.56, night: 0.1, fogDensity: 0.0009, exposure: 1.08 },
  { hour: 19.25, zenith: '#242e63', horizon: '#655d85', fog: '#50577e', ambient: '#7187d8', shadow: '#383b80', sun: '#91a7ed', glow: '#39252b', cloud: '#454a70', cloudShade: '#726c8f', cloudCover: 0.3, sunIntensity: 0.48, ambientIntensity: 0.52, night: 0.6, fogDensity: 0.00095, exposure: 1.08 },
  { hour: 20.5, zenith: '#20285c', horizon: '#504b72', fog: '#3f416f', ambient: '#667fc9', shadow: '#2a2c68', sun: '#91a6ed', glow: '#2c1830', cloud: '#444478', cloudShade: '#81779f', cloudCover: 0.28, sunIntensity: 0.3, ambientIntensity: 0.5, night: 0.76, fogDensity: 0.0012, exposure: 1.12 },
  { hour: 24, zenith: '#0e1745', horizon: '#2e2f66', fog: '#2a2f58', ambient: '#6474b8', shadow: '#1e2458', sun: '#a9bdf2', glow: '#000000', cloud: '#1f2552', cloudShade: '#363d78', cloudCover: 0.26, sunIntensity: 0.28, ambientIntensity: 0.52, night: 1, fogDensity: 0.0012, exposure: 1.16 },
];

const blendColor = (a: string, b: string, t: number): string =>
  `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
const wrapHour = (hour: number) => Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 12;

/**
 * Where the sun is. It rises in the east, stands high in the south at noon, so the town's fronts face
 * it, and sets in the west-north-west, so dusk shadows run east-south-east.
 */
export function solarDirection(hour: number): [number, number, number] {
  const angle = (wrapHour(hour) - 6) * Math.PI / 12, rise = Math.sin(angle);
  const direction = new THREE.Vector3(Math.cos(angle) + 0.22, rise + 0.55, -0.3 + 0.9 * Math.max(rise, 0)).normalize();
  return [direction.x, direction.y, direction.z];
}

/** The moon stands in the south-south-west, high enough to model walls in cool light and short shadows. */
export function lunarDirection(hour: number): [number, number, number] {
  const drift = (((wrapHour(hour) - 18 + 24) % 24) - 6) * 0.035;
  const direction = new THREE.Vector3(-0.38 - drift, 0.66, 0.66 - drift * 0.4).normalize();
  return [direction.x, direction.y, direction.z];
}

/** Hour wraps at midnight, including negative and greater-than-24 values. */
export function getEnvironment(hour: number): Environment {
  const h = wrapHour(hour);
  const index = grades.findIndex((grade) => grade.hour > h);
  // The wrapped hour is in [0, 24), bracketed by the 0 and 24 keys.
  const a = grades[index - 1]!;
  const b = grades[index]!;
  const u = (h - a.hour) / (b.hour - a.hour);
  const t = u * u * (3 - 2 * u);
  const sun = new THREE.Vector3(...solarDirection(h));
  // The key light hands over to the moon as the sun leaves the sky, so walls keep a direction at night.
  const daylight = THREE.MathUtils.smoothstep(sun.y, -0.04, 0.14);
  const direction = new THREE.Vector3(...lunarDirection(h)).lerp(sun, daylight).normalize();
  const mix = (key: 'zenith' | 'horizon' | 'fog' | 'ambient' | 'sun' | 'shadow' | 'glow' | 'cloud' | 'cloudShade') => blendColor(a[key], b[key], t);
  const lerp = (key: 'sunIntensity' | 'ambientIntensity' | 'night' | 'cloudCover' | 'fogDensity' | 'exposure') => THREE.MathUtils.lerp(a[key], b[key], t);
  return {
    zenith: mix('zenith'), horizon: mix('horizon'), fog: mix('fog'), ambient: mix('ambient'), sun: mix('sun'),
    sunDirection: [direction.x, direction.y, direction.z],
    sunIntensity: lerp('sunIntensity'), ambientIntensity: lerp('ambientIntensity'), night: lerp('night'),
    shadow: mix('shadow'), glow: mix('glow'), cloud: mix('cloud'), cloudShade: mix('cloudShade'),
    cloudCover: lerp('cloudCover'), fogDensity: lerp('fogDensity'), exposure: lerp('exposure'),
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
  uniform vec3 uZenith, uHorizon, uSunColor, uSunDirection, uMoonDirection, uBeaconDirection, uGlow, uCloud, uCloudShade;
  uniform float uNight, uTime, uBeaconStrength, uCloudCover;
  varying vec3 vDirection;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x), mix(hash(i+vec2(0.,1.)), hash(i+1.), f.x), f.y);
  }
  // Rotated octaves keep the value noise from lining up into rows.
  float fbm(vec2 p) {
    const mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
    float sum = 0.0, amplitude = 0.5;
    for (int i = 0; i < 4; i++) { sum += noise(p) * amplitude; p = turn * p * 2.03 + 5.2; amplitude *= 0.5; }
    return sum / 0.9375;
  }
  void main() {
    vec3 d = normalize(vDirection);
    float altitude = max(d.y, 0.0);
    vec3 color = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.5, altitude), 0.5));
    vec3 sunFlat = normalize(vec3(uSunDirection.x, 0.0, uSunDirection.z) + vec3(0.0001, 0.0, 0.0));
    float sunward = max(dot(normalize(vec3(d.x, 0.0, d.z) + vec3(0.0001, 0.0, 0.0)), sunFlat), 0.0);
    // A warm band low on the sky, strongest under the sun; at noon its colour is black.
    color += uGlow * exp(-altitude * 7.0) * (0.35 + 0.65 * sunward * sunward);
    float towardSun = max(dot(d, uSunDirection), 0.0);
    color += uSunColor * pow(towardSun, 14.0) * (1.0-uNight) * 0.14;
    float sun = smoothstep(0.9991, 0.9995, towardSun) * smoothstep(-0.04, 0.08, uSunDirection.y) * (1.0-uNight);
    color = mix(color, uSunColor * 1.08, sun * 0.85);
    float moonDot = dot(d, uMoonDirection);
    float moon = smoothstep(0.9991, 0.99945, moonDot) * uNight;
    color += vec3(0.20, 0.22, 0.30) * pow(max(moonDot, 0.0), 240.0) * uNight;
    color = mix(color, vec3(0.72, 0.74, 0.72), moon * 0.88);
    // Painted clouds on one high layer: broken, domain-warped puffs, smaller toward the horizon by
    // perspective and faded out before they could stretch into stripes. Thin edges take the lit
    // colour; thick cores and undersides take the shade.
    vec2 uv = d.xz / (d.y + 0.12) * 3.1 + vec2(uTime * 0.012, uTime * 0.004);
    vec2 warp = vec2(noise(uv * 0.45 + 3.1), noise(uv * 0.45 + 9.7)) - 0.5;
    // A slow large-scale mask breaks the layer into banks and clear gaps.
    float banks = noise(uv * 0.16 + 1.7);
    float density = fbm(uv + warp * 1.1) + (banks - 0.5) * 0.3;
    float threshold = 0.5 + (0.5 - uCloudCover) * 0.5;
    float layer = smoothstep(0.035, 0.18, d.y);
    float cloud = smoothstep(threshold, threshold + 0.06, density) * layer;
    float core = smoothstep(threshold + 0.015, threshold + 0.13, density);
    vec3 cloudColor = mix(uCloud, uCloudShade, core * (0.55 + 0.45 * sunward));
    // Edges toward the sun catch a little extra of its colour.
    cloudColor += uSunColor * (1.0 - core) * pow(towardSun, 5.0) * (1.0 - uNight) * 0.25;
    color = mix(color, cloudColor, cloud * 0.94);
    // Light catches the underside of the clouds where the beacon reaches them.
    // This is angular and soft, so it remains a patch of sky rather than a wedge.
    float beaconCloud = exp(-pow(acos(clamp(dot(d, uBeaconDirection), -1.0, 1.0)) / 0.11, 2.0));
    color += vec3(0.44, 0.16, 0.036) * beaconCloud * (0.12 + cloud * 0.88) * uBeaconStrength * uBeaconStrength;
    // Sparse pinpricks anchored to sky direction; no time-dependent shimmer.
    vec2 starUV = vec2(atan(d.z, d.x) * 34.0, asin(clamp(d.y, -1.0, 1.0)) * 34.0);
    vec2 cell = floor(starUV), local = fract(starUV);
    float chance = hash(cell);
    vec2 point = vec2(hash(cell + 17.1), hash(cell + 31.7)) * 0.7 + 0.15;
    float star = (1.0-smoothstep(0.02, 0.085, length(local-point))) * step(0.94, chance);
    // Stars come out by contrast: a bright sky hides them before the night value says so.
    float dark = 1.0 - smoothstep(0.05, 0.22, dot(color, vec3(0.299, 0.587, 0.114)));
    color += vec3(0.64, 0.70, 0.85) * star * uNight * dark * smoothstep(0.04, 0.25, d.y) * (1.0-cloud*0.9) * 0.65;
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
    float width = mix(0.34, 0.09, smoothstep(0.0, 1.0, height));
    float core = exp(-pow(x / width, 2.0) * 2.0) * (1.0-smoothstep(0.38, 1.0, height));
    float veil = exp(-x*x*9.0) * (0.9 + 0.1*sin(height*10.0-uTime*0.25));
    float alpha = envelope * (core*(0.30 + 0.36*uStrength) + veil*0.16) * uStrength;
    vec3 color = mix(vec3(0.95, 0.42, 0.12), vec3(1.8, 1.02, 0.42), core);
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
const baseFragment = /* glsl */ `
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r2 = dot(p, p);
    float core = exp(-r2 * 24.0);
    float bloom = exp(-r2 * 5.0) * (1.0-smoothstep(0.5, 1.0, length(p)));
    float alpha = (core * 0.66 + bloom * 0.30) * uStrength * uStrength;
    gl_FragColor = vec4(mix(vec3(1.0, 0.38, 0.08), vec3(2.3, 1.1, 0.38), core), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The sky follows camera translation but retains world orientation. Dispose when the scene is torn down. */
export function createAtmosphere(scene: THREE.Scene): {
  update(hour: number, elapsedSeconds: number, camera: THREE.Camera, beaconPosition: THREE.Vector3, beaconStrength: number): void;
  readonly reflectionExclusions: readonly THREE.Object3D[];
  dispose(): void;
} {
  const skyGeometry = new THREE.SphereGeometry(1, 48, 24);
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunColor: { value: new THREE.Color() }, uSunDirection: { value: new THREE.Vector3() }, uMoonDirection: { value: new THREE.Vector3() }, uBeaconDirection: { value: new THREE.Vector3(0, 1, 0) }, uBeaconStrength: { value: 0 }, uNight: { value: 0 }, uTime: { value: 0 }, uGlow: { value: new THREE.Color() }, uCloud: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() }, uCloudCover: { value: 0.3 } },
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
  // A small warm source at the tower gives the column somewhere to begin.
  const baseMaterial = new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 0 } }, vertexShader: shaftVertex, fragmentShader: baseFragment,
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  });
  const base = new THREE.Mesh(haloGeometry, baseMaterial);
  base.renderOrder = 3;
  scene.add(base);
  const beaconLift = new THREE.Vector3();
  return {
    reflectionExclusions: [sky, shaft, halo, base],
    update(hour, elapsedSeconds, camera, beaconPosition, beaconStrength) {
      const grade = getEnvironment(hour);
      sky.position.copy(camera.position);
      const uniforms = skyMaterial.uniforms;
      uniforms.uZenith!.value.set(grade.zenith);
      uniforms.uHorizon!.value.set(grade.horizon);
      uniforms.uSunColor!.value.set(grade.sun);
      // The disc and its glow sit where the sun really is, even when the moon is the key light.
      uniforms.uSunDirection!.value.fromArray(solarDirection(hour));
      uniforms.uMoonDirection!.value.fromArray(lunarDirection(hour));
      uniforms.uGlow!.value.set(grade.glow);
      uniforms.uCloud!.value.set(grade.cloud);
      uniforms.uCloudShade!.value.set(grade.cloudShade);
      uniforms.uCloudCover!.value = grade.cloudCover;
      uniforms.uNight!.value = grade.night;
      const seconds = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
      uniforms.uTime!.value = seconds;
      const strength = Number.isFinite(beaconStrength) ? THREE.MathUtils.clamp(beaconStrength, 0, 1) : 0;
      // By day the beacon is a fire on the crown, not a beam: the column and its sky halo need dusk.
      const column = strength * THREE.MathUtils.smoothstep(grade.night, 0.05, 0.26);
      const height = 15 + column * 75;
      uniforms.uBeaconDirection!.value.copy(beaconPosition).add(beaconLift.set(0, height * 0.75, 0)).sub(camera.position).normalize();
      uniforms.uBeaconStrength!.value = column;
      shaft.visible = column > 0.001;
      shaft.position.copy(beaconPosition).y += height * 0.5;
      shaft.scale.set(10 + column * 12, height, 1);
      // Keep the column vertical while presenting its soft profile to the camera.
      shaft.lookAt(camera.position.x, shaft.position.y, camera.position.z);
      halo.visible = column > 0.001;
      halo.position.copy(beaconPosition).y += height * 0.73;
      halo.quaternion.copy(camera.quaternion);
      halo.scale.setScalar(10 + column * 18);
      haloMaterial.uniforms.uStrength!.value = column;
      // The crown fire stays at any hour, smaller and calmer in daylight.
      const crown = strength * THREE.MathUtils.lerp(0.55, 1, THREE.MathUtils.smoothstep(grade.night, 0.05, 0.26));
      base.visible = crown > 0.001;
      base.position.copy(beaconPosition).y += 1.2;
      base.quaternion.copy(camera.quaternion);
      base.scale.setScalar(4 + crown * 22);
      baseMaterial.uniforms.uStrength!.value = crown;
      shaftMaterial.uniforms.uStrength!.value = column;
      shaftMaterial.uniforms.uTime!.value = seconds;
    },
    dispose() {
      scene.remove(sky, shaft, halo, base);
      skyGeometry.dispose(); skyMaterial.dispose(); shaftGeometry.dispose(); shaftMaterial.dispose(); haloGeometry.dispose(); haloMaterial.dispose(); baseMaterial.dispose();
    },
  };
}
