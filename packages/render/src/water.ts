import * as THREE from 'three';
import type { Environment } from './atmosphere';

export interface WaterOptions {
  lake: { x: number; z: number; radiusX: number; radiusZ: number; level: number };
  /** Height samples in row-major order, at origin + [x,z] * step. */
  terrain: { data: Float32Array; width: number; height: number; origin: [number, number]; step: number };
}

/** A bounded pond with a terrain-defined shoreline and an analytic sky reflection. */
export function createWater(scene: THREE.Scene, options: WaterOptions): {
  update(environment: Environment, elapsedSeconds: number, camera: THREE.Camera): void;
  dispose(): void;
} {
  const { lake, terrain } = options;
  if (terrain.width < 2 || terrain.height < 2 || terrain.data.length !== terrain.width * terrain.height || terrain.step <= 0) {
    throw new Error('Water requires a complete terrain height grid');
  }
  const heights = new THREE.DataTexture(terrain.data, terrain.width, terrain.height, THREE.RedFormat, THREE.FloatType);
  heights.minFilter = THREE.NearestFilter;
  heights.magFilter = THREE.NearestFilter;
  heights.generateMipmaps = false;
  heights.needsUpdate = true;
  const geometry = new THREE.PlaneGeometry(lake.radiusX * 2.6, lake.radiusZ * 2.6);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uHeight: { value: heights }, uOrigin: { value: new THREE.Vector2(...terrain.origin) },
      uSize: { value: new THREE.Vector2(terrain.width, terrain.height) }, uStep: { value: terrain.step },
      uLevel: { value: lake.level }, uTime: { value: 0 }, uNight: { value: 0 },
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() }, uSunDirection: { value: new THREE.Vector3() },
      uSunIntensity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      out vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      out vec4 waterColour;
      #define gl_FragColor waterColour
      uniform sampler2D uHeight;
      uniform vec2 uOrigin, uSize;
      uniform float uStep, uLevel, uTime, uNight, uSunIntensity;
      uniform vec3 uZenith, uHorizon, uSun, uSunDirection;
      in vec3 vWorld;

      float terrainHeight(vec2 world) {
        vec2 grid = (world - uOrigin) / uStep;
        if (any(lessThan(grid, vec2(0.0))) || any(greaterThan(grid, uSize - 1.0))) return uLevel + 1.0;
        grid = min(grid, uSize - 1.001);
        ivec2 p = ivec2(floor(grid));
        vec2 f = fract(grid);
        float h00 = texelFetch(uHeight, p, 0).r;
        float h10 = texelFetch(uHeight, p + ivec2(1,0), 0).r;
        float h01 = texelFetch(uHeight, p + ivec2(0,1), 0).r;
        float h11 = texelFetch(uHeight, p + ivec2(1,1), 0).r;
        // Match the terrain mesh's fixed diagonal, including on non-planar cells.
        return f.x <= f.y
          ? h00 + f.x * (h11 - h01) + f.y * (h01 - h00)
          : h00 + f.x * (h10 - h00) + f.y * (h11 - h10);
      }
      // Fade high-frequency detail as its phase becomes smaller than a pixel.
      float filteredWave(float phase) {
        float footprint = fwidth(phase);
        return sin(phase) * (1.0 - smoothstep(0.8, 3.0, footprint));
      }
      void main() {
        float depth = uLevel - terrainHeight(vWorld.xz);
        float shoreAA = max(fwidth(depth), 0.025);
        float coverage = smoothstep(0.0, shoreAA * 1.5, depth);
        float deep = smoothstep(0.03, 0.9, depth);
        float t = uTime;
        float p1 = dot(vWorld.xz, vec2(0.24, 0.11)) + t * 0.22;
        float p2 = dot(vWorld.xz, vec2(-0.13, 0.34)) - t * 0.15;
        float wave = filteredWave(p1) * 0.65 + filteredWave(p2) * 0.35;
        float filter1 = 1.0 - smoothstep(0.8, 3.0, fwidth(p1));
        float filter2 = 1.0 - smoothstep(0.8, 3.0, fwidth(p2));
        vec3 normal = normalize(vec3(-0.035 * cos(p1) * filter1 - 0.012 * cos(p2) * filter2, 1.0,
                                     -0.016 * cos(p1) * filter1 - 0.032 * cos(p2) * filter2));
        vec3 viewDir = normalize(cameraPosition - vWorld);
        vec3 reflected = reflect(-viewDir, normal);
        float skyAltitude = clamp(reflected.y, 0.0, 1.0);
        vec3 sky = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.55, skyAltitude), 0.62));
        float fresnel = 0.18 + 0.64 * pow(1.0 - max(dot(viewDir, normal), 0.0), 5.0);
        // The last shallow centimetres reveal the subdued bank. A bright
        // shallow tint and full sky reflection here draw an artificial rim.
        vec3 shallow = mix(vec3(0.065, 0.14, 0.135), vec3(0.018, 0.045, 0.055), uNight);
        vec3 bed = mix(vec3(0.065, 0.18, 0.20), vec3(0.018, 0.065, 0.105), uNight);
        vec3 colour = mix(shallow, bed, deep);
        float reflectionDepth = smoothstep(0.025, 0.6, depth);
        colour = mix(colour, sky, fresnel * mix(0.75, 0.5, uNight) * reflectionDepth);
        // Sunlight follows the actual reflected direction; it is restrained and fades at night.
        float sunDot = max(dot(normalize(reflected), normalize(uSunDirection)), 0.0);
        float sun = pow(sunDot, 48.0) * min(uSunIntensity, 1.0) * (1.0 - uNight);
        colour += uSun * sun * 0.16;
        colour += wave * mix(0.012, 0.005, uNight) * deep;
        if (depth <= 0.0) discard;
        gl_FragColor = vec4(colour, coverage);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(lake.x, lake.level, lake.z);
  scene.add(mesh);
  return {
    update(environment, elapsedSeconds) {
      material.uniforms.uZenith!.value.set(environment.zenith);
      material.uniforms.uHorizon!.value.set(environment.horizon);
      material.uniforms.uSun!.value.set(environment.sun);
      material.uniforms.uSunDirection!.value.fromArray(environment.sunDirection);
      material.uniforms.uSunIntensity!.value = environment.sunIntensity;
      material.uniforms.uNight!.value = environment.night;
      material.uniforms.uTime!.value = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      heights.dispose();
    },
  };
}
