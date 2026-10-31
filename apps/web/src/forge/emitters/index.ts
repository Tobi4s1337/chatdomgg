import * as THREE from 'three';

export interface ForgeEmitterInput {
  time: number;
  anvil: THREE.Vector3;
  activity: number;
  fillHeight?: number;
  landed?: { position: THREE.Vector3; kind: 'smoke' | 'glow'; direction?: THREE.Vector3 }[];
  strike?: number;
  /** One welcome beat, in world coordinates; age is seconds since landing. */
  landingBeat?: { position: THREE.Vector3; age: number; colour?: THREE.ColorRepresentation };
}

const MAX_LANDED = 18;
const SPARKS = 72;
const PER_LANDING = 8;
const fract = (n: number) => n - Math.floor(n);
const hash = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453123);
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** A fixed-capacity, seekable visual layer. All coordinates are world coordinates. */
export function createForgeEmitters(scene: THREE.Scene) {
  const root = new THREE.Group();
  root.frustumCulled = false;
  scene.add(root);

  function pool(count: number, mode: 0 | 1 | 2 | 3 | 4 | 5) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: mode === 1 || mode === 5 ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: { uMode: { value: mode }, uColour: { value: new THREE.Color(0xffba60) }, uPixelScale: { value: 300 } },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        uniform float uPixelScale;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(96.0, aSize * (uPixelScale / max(0.1, -mv.z)));
        }
      `,
      fragmentShader: `
        uniform int uMode;
        uniform vec3 uColour;
        varying float vAlpha;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float a;
          vec3 c;
          if (uMode == 3) {
            // A diffuse breath, with no hard rim or solid luminous centre.
            float d = length(p);
            a = pow(max(0.0, 1.0 - d), 2.8) * vAlpha;
            c = uColour;
          } else if (uMode == 4) {
            // Fine glints, their tails tapering into the air.
            float core = (1.0 - smoothstep(0.02, 0.23, abs(p.x))) * (1.0 - smoothstep(0.05, 0.95, abs(p.y)));
            float halo = (1.0 - smoothstep(0.0, 0.45, length(p))) * 0.25;
            a = (core * 0.75 + halo) * vAlpha;
            // The hot glint core contributes radiance; its alpha still shapes the tail.
            c = mix(uColour, vec3(1.0, 0.83, 0.52), 0.55) * 3.4;
          } else if (uMode == 5) {
            float d = min(length(p * vec2(0.96, 1.04)), min(length((p - vec2(-0.27, -0.1)) * 1.25), length((p - vec2(0.25, 0.12)) * 1.32)));
            a = (1.0 - smoothstep(0.2, 1.0, d)) * vAlpha;
            c = vec3(0.62, 0.61, 0.59);
          } else if (uMode == 1) {
            // A soft union of offset lobes makes a puff rather than a flat disc.
            float d = min(length(p * vec2(0.94, 1.05)), min(length((p - vec2(-0.32, -0.08)) * 1.23), length((p - vec2(0.29, 0.12)) * 1.3)));
            a = (1.0 - smoothstep(0.42, 1.0, d)) * vAlpha;
            c = vec3(0.37, 0.39, 0.43);
          } else if (uMode == 2) {
            float d = length(p);
            float star = max((1.0 - smoothstep(0.0, 0.14, abs(p.x))) * (1.0 - smoothstep(0.08, 0.9, abs(p.y))), (1.0 - smoothstep(0.0, 0.14, abs(p.y))) * (1.0 - smoothstep(0.08, 0.9, abs(p.x))));
            a = (star * 0.55 + (1.0 - smoothstep(0.0, 0.55, d)) * 0.35) * vAlpha;
            c = vec3(1.0, 0.67, 0.25) * 4.0;
          } else {
            // Tiny square hot fragments, with a darker amber edge.
            float edge = max(abs(p.x), abs(p.y));
            a = (1.0 - smoothstep(0.78, 1.0, edge)) * vAlpha;
            c = mix(vec3(0.9, 0.31, 0.055), vec3(1.0, 0.73, 0.28), 1.0 - edge) * mix(1.0, 3.5, 1.0 - edge);
          }
          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    const points = new THREE.Points(geometry, material);
    if (mode === 1 || mode === 5) {
      const viewport = new THREE.Vector2();
      points.onBeforeRender = (renderer, _scene, camera) => {
        const perspective = camera as THREE.PerspectiveCamera;
        if (perspective.isPerspectiveCamera) material.uniforms.uPixelScale!.value =
          renderer.getDrawingBufferSize(viewport).y / (2 * Math.tan(THREE.MathUtils.degToRad(perspective.fov * .5)));
      };
    }
    points.frustumCulled = false;
    root.add(points);
    return { geometry, material, positions, sizes, alphas };
  }

  const spark = pool(SPARKS, 0);
  const pour = pool(16, 0);
  const smoke = pool(MAX_LANDED * PER_LANDING, 1);
  const glow = pool(MAX_LANDED * PER_LANDING, 2);
  const breath = pool(2, 3);
  const embers = pool(12, 4);
  const landingSmoke = pool(6, 5);
  const pools = [spark, pour, smoke, glow, breath, embers, landingSmoke];

  function update(input: ForgeEmitterInput) {
    const time = Number.isFinite(input.time) ? input.time : 0;
    const activity = clamp(input.activity || 0);
    const strike = clamp(input.strike || 0);
    const fillHeight = Math.max(0, Number.isFinite(input.fillHeight) ? input.fillHeight! : 0);
    for (let i = 0; i < SPARKS; i++) {
      const phase = fract(time / 1.35 + hash(i + 3));
      const angle = hash(i + 70) * Math.PI * 2;
      const speed = 0.22 + hash(i + 160) * 0.58;
      const arc = phase * speed;
      const j = i * 3;
      spark.positions[j] = input.anvil.x + Math.cos(angle) * arc;
      spark.positions[j + 1] = input.anvil.y + fillHeight + 0.18 + phase * (1.2 + hash(i + 240) * 0.55) - phase * phase * 1.45;
      spark.positions[j + 2] = input.anvil.z + Math.sin(angle) * arc;
      spark.sizes[i] = 0.035 + hash(i + 400) * 0.035;
      spark.alphas[i] = Math.sin(Math.PI * phase) * Math.min(0.8, activity * 0.7 + strike * 0.3) * (hash(i + 300) < activity ? 1 : strike * 0.5);
    }
    for (let i = 0; i < 16; i++) {
      const phase = fract(time / 0.72 + i / 16);
      const j = i * 3;
      pour.positions[j] = input.anvil.x + (hash(i + 900) - 0.5) * 0.10;
      pour.positions[j + 1] = input.anvil.y + fillHeight + 1.4 * (1 - phase * phase);
      pour.positions[j + 2] = input.anvil.z + (hash(i + 950) - 0.5) * 0.10;
      pour.sizes[i] = 0.055 + hash(i + 1000) * 0.025;
      pour.alphas[i] = activity * Math.sin(Math.PI * phase) * 0.8;
    }
    smoke.alphas.fill(0);
    glow.alphas.fill(0);
    const landed = input.landed || [];
    for (let k = 0; k < Math.min(MAX_LANDED, landed.length); k++) {
      const entry = landed[k];
      if (!entry) continue;
      const target = entry.kind === 'smoke' ? smoke : glow;
      for (let n = 0; n < PER_LANDING; n++) {
        const i = k * PER_LANDING + n;
        const seed = k * 23 + n;
        const phase = fract(time / (entry.kind === 'smoke' ? 3.8 : 1.7) + hash(seed + 500));
        const j = i * 3;
        if (entry.kind === 'smoke') {
          const exhale = Math.sin(phase * Math.PI * .5) * .7;
          target.positions[j] = entry.position.x + (entry.direction?.x ?? 0) * exhale + Math.sin(time * 0.45 + seed + phase * 3.0) * phase * 0.2 + phase * 0.18;
          target.positions[j + 1] = entry.position.y + phase * 2.0;
          target.positions[j + 2] = entry.position.z + (entry.direction?.z ?? 0) * exhale + Math.cos(seed * 1.3 + phase * 3.0) * phase * 0.18;
          target.sizes[i] = 0.24 + phase * 0.42;
          target.alphas[i] = Math.sin(Math.PI * phase) * 0.42;
        } else {
          const angle = hash(seed + 600) * Math.PI * 2;
          const radius = 0.07 + hash(seed + 700) * 0.28;
          target.positions[j] = entry.position.x + Math.cos(angle) * radius;
          target.positions[j + 1] = entry.position.y + 0.05 + phase * 0.36;
          target.positions[j + 2] = entry.position.z + Math.sin(angle) * radius;
          target.sizes[i] = 0.045 + hash(seed + 800) * 0.065;
          target.alphas[i] = Math.sin(Math.PI * phase) * 0.52;
        }
      }
    }
    breath.alphas.fill(0);
    embers.alphas.fill(0);
    landingSmoke.alphas.fill(0);
    const beat = input.landingBeat;
    if (beat && Number.isFinite(beat.age) && beat.age >= 0 && beat.age < 2.5) {
      const age = beat.age;
      const origin = beat.position;
      const fade = Math.pow(1 - age / 2.5, 1.5);
      const bloom = Math.min(1, age / 0.16);
      breath.material.uniforms.uColour!.value.set(beat.colour ?? 0xffba60);
      embers.material.uniforms.uColour!.value.set(beat.colour ?? 0xffba60);
      for (let i = 0; i < 2; i++) {
        const j = i * 3;
        breath.positions[j] = origin.x + (i ? 0.17 : -0.12);
        breath.positions[j + 1] = origin.y + 0.18 + age * 0.13 + i * 0.16;
        breath.positions[j + 2] = origin.z + (i ? -0.12 : 0.08);
        breath.sizes[i] = (i ? 1.05 : 1.45) + age * 0.2;
        breath.alphas[i] = bloom * fade * (i ? 0.18 : 0.26);
      }
      for (let i = 0; i < 12; i++) {
        const j = i * 3;
        const angle = hash(i + 1200) * Math.PI * 2;
        const distance = (0.12 + age * (0.35 + hash(i + 1300) * 0.55));
        embers.positions[j] = origin.x + Math.cos(angle) * distance;
        embers.positions[j + 1] = origin.y + 0.14 + age * (0.28 + hash(i + 1400) * 0.55) - age * age * 0.055;
        embers.positions[j + 2] = origin.z + Math.sin(angle) * distance;
        embers.sizes[i] = 0.055 + hash(i + 1500) * 0.085;
        embers.alphas[i] = bloom * fade * (0.45 + hash(i + 1600) * 0.4);
      }
      for (let i = 0; i < 6; i++) {
        const j = i * 3;
        const angle = hash(i + 1700) * Math.PI * 2;
        const drift = 0.08 + age * (0.12 + hash(i + 1800) * 0.15);
        landingSmoke.positions[j] = origin.x + Math.cos(angle + age * 0.32) * drift;
        landingSmoke.positions[j + 1] = origin.y + 0.1 + i * 0.035 + age * (0.22 + hash(i + 1900) * 0.2);
        landingSmoke.positions[j + 2] = origin.z + Math.sin(angle + age * 0.32) * drift;
        landingSmoke.sizes[i] = 0.25 + hash(i + 2000) * 0.18 + age * 0.18;
        landingSmoke.alphas[i] = bloom * fade * 0.16;
      }
    }
    for (const p of pools) {
      p.geometry.getAttribute('position').needsUpdate = true;
      p.geometry.getAttribute('aSize').needsUpdate = true;
      p.geometry.getAttribute('aAlpha').needsUpdate = true;
    }
  }

  function dispose() {
    scene.remove(root);
    for (const p of pools) {
      p.geometry.dispose();
      p.material.dispose();
    }
  }
  return { update, dispose };
}
