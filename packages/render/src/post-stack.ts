import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Environment } from './atmosphere';

export type PostQuality = 'low' | 'balanced' | 'high' | 'capture';
export interface PostStackOptions {
  quality?: PostQuality;
  toneMapping?: 'aces' | 'agx';
  /** Material fog is the default until every scene material shares the post fog contract. */
  fog?: 'material' | 'post';
}
export interface PostLight { position: THREE.Vector3; strength: number }
export interface PostFrame {
  environment: Environment;
  hour?: number;
  /** Optical-axis distance in metres; null disables DOF. It is never enabled for a wide shot. */
  focusDistance?: number | null;
  beacon?: PostLight;
  forge?: PostLight;
}

/** Pixel caps bound both memory and shader work, independent of CSS/retina display dimensions. */
export const POST_QUALITY = {
  low: { maxPixels: 850_000, maxPixelRatio: 1, samples: 0, aoSamples: 0, bloomScale: .5, shafts: false, dof: false },
  balanced: { maxPixels: 1_450_000, maxPixelRatio: 1.25, samples: 2, aoSamples: 8, bloomScale: .65, shafts: false, dof: true },
  high: { maxPixels: 2_100_000, maxPixelRatio: 1.5, samples: 2, aoSamples: 12, bloomScale: 1, shafts: true, dof: true },
  // Deterministic software captures retain actual HDR bloom; avoid multisample resolve and expensive AO.
  capture: { maxPixels: 2_100_000, maxPixelRatio: 1, samples: 0, aoSamples: 4, bloomScale: .5, shafts: false, dof: false },
} as const;

export function postStackSize(width: number, height: number, pixelRatio: number, quality: PostQuality): { width: number; height: number } {
  if (![width, height, pixelRatio].every(Number.isFinite) || width <= 0 || height <= 0 || pixelRatio <= 0) {
    throw new Error('Post stack requires a positive finite viewport');
  }
  const budget = POST_QUALITY[quality];
  const ratio = Math.min(pixelRatio, budget.maxPixelRatio, Math.sqrt(budget.maxPixels / width / height));
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) };
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Original depth reconstruction/composition. No geometry overrides: packed voxel vertices, instancing,
// terrain displacement and cutout glass all retain precisely the depth their beauty draw produced.
const fragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse, tDepth;
  uniform mat4 uProjectionInverse, uCameraWorld;
  uniform vec2 uTexel;
  uniform float uProjectionY, uAoSamples, uFocus, uFogDensity, uNight, uShafts;
  uniform vec3 uFog, uGlow, uSunDirection;
  uniform vec4 uBeacon, uForge;
  varying vec2 vUv;
  float chatdomLuminance(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }
  vec3 viewPoint(vec2 uv, float depth) {
    vec4 p = uProjectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }
  float readDepth(vec2 uv) { return texture2D(tDepth, clamp(uv, uTexel * .5, 1.0 - uTexel * .5)).x; }
  float contact(vec3 p, float depth) {
    vec3 dx = dFdx(p), dy = dFdy(p);
    vec3 n = normalize(cross(dx, dy));
    if (uAoSamples < .5 || depth > .99999 || -p.z > 180.0) return 0.0;
    if (dot(n, -p) < 0.0) n = -n;
    // Sub-metre contact, not an outline around whole buildings. World-distance rejection avoids halos.
    float radius = .65;
    float screenRadius = min(.035, radius * uProjectionY / max(-p.z, .1) * .5);
    float obscured = 0.0;
    for (int i = 0; i < 12; i++) {
      if (float(i) >= uAoSamples) break;
      float f = (float(i) + .5) / uAoSamples;
      float a = float(i) * 2.39996323;
      vec2 offset = vec2(cos(a) * uTexel.x / uTexel.y, sin(a)) * sqrt(f) * screenRadius;
      vec2 uv = vUv + offset;
      if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) continue;
      float d = readDepth(uv);
      if (d > .99999) continue;
      vec3 delta = viewPoint(uv, d) - p;
      float distance = length(delta);
      float horizon = max(dot(n, delta) / max(distance, .001) - .12, 0.0);
      obscured += horizon * (1.0 - smoothstep(radius * .3, radius, distance));
    }
    return min(.22, obscured / max(uAoSamples, 1.0) * 1.8);
  }
  vec3 focusColour(vec3 colour, vec3 p) {
    if (uFocus <= 0.0) return colour;
    // Only distant background softens. Foreground silhouettes and the subject retain their sharp edge.
    float circle = clamp((-p.z - uFocus * 1.25) / max(-p.z, .1), 0.0, 1.0) * 2.2;
    if (circle < .25) return colour;
    vec3 sum = colour; float weight = 1.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * .78539816;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * circle * uTexel;
      float z = -viewPoint(uv, readDepth(uv)).z;
      float accepted = smoothstep(uFocus, uFocus * 1.25, z);
      sum += texture2D(tDiffuse, uv).rgb * accepted; weight += accepted;
    }
    return sum / weight;
  }
  vec3 lightShaft(vec4 source) {
    if (uShafts < .5 || source.w <= 0.0 || any(lessThan(source.xy, vec2(0.0))) || any(greaterThan(source.xy, vec2(1.0)))) return vec3(0.0);
    // A source hidden behind opaque geometry cannot paint rays through the obstruction.
    float z = -viewPoint(source.xy, readDepth(source.xy)).z;
    if (z + .6 < source.z) return vec3(0.0);
    vec2 delta = source.xy - vUv;
    float reach = 1.0 - smoothstep(.03, .23, length(delta));
    if (reach <= 0.0) return vec3(0.0);
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      vec2 uv = vUv + delta * (float(i) + .5) / 8.0;
      float sampleZ = -viewPoint(uv, readDepth(uv)).z;
      vec3 light = texture2D(tDiffuse, uv).rgb;
      float bright = smoothstep(1.05, 2.5, chatdomLuminance(light));
      sum += light * bright * step(source.z - .6, sampleZ);
    }
    return sum * (.0125 * reach * source.w);
  }
  void main() {
    vec4 inputColour = texture2D(tDiffuse, vUv);
    float depth = readDepth(vUv);
    vec3 p = viewPoint(vUv, depth);
    vec3 colour = focusColour(inputColour.rgb, p);
    float emission = smoothstep(.8, 1.5, chatdomLuminance(colour));
    colour *= 1.0 - contact(p, depth) * (1.0 - emission);
    if (uFogDensity > 0.0 && depth < .99999) {
      vec3 world = (uCameraWorld * vec4(p, 1.0)).xyz;
      vec3 eye = uCameraWorld[3].xyz;
      float distance = length(p);
      // Analytic integral of exponential height density along this visible camera segment.
      float falloff = .019, a = clamp(-falloff * (world.y - eye.y), -20.0, 20.0);
      float integral = abs(a) < .001 ? 1.0 + a * .5 : (exp(a) - 1.0) / a;
      float opticalDepth = distance * uFogDensity * exp(clamp(-falloff * eye.y, -20.0, 20.0)) * integral;
      float fog = min(.86, 1.0 - exp(-opticalDepth));
      vec3 ray = normalize(world - eye);
      float sunward = pow(max(dot(ray, normalize(uSunDirection)), 0.0), 6.0);
      colour = mix(colour, uFog + uGlow * sunward * .8, fog);
    }
    colour += lightShaft(uBeacon) + lightShaft(uForge);
    // Restrained hour-linked colour separation; keep source chroma and HDR headroom.
    float dark = 1.0 - smoothstep(.025, .4, chatdomLuminance(colour));
    colour *= mix(vec3(1.0), vec3(.975, .99, 1.035), dark * uNight * .35);
    vec2 edge = (vUv - .5) * 1.41421356;
    colour *= 1.0 - .075 * smoothstep(.25, .95, dot(edge, edge));
    gl_FragColor = vec4(max(colour, vec3(0.0)), inputColour.a);
  }
`;

class DepthPass extends ShaderPass {
  override render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget, deltaSeconds: number, maskActive: boolean): void {
    this.uniforms.tDepth!.value = read.depthTexture;
    super.render(renderer, write, read, deltaSeconds, maskActive);
  }
}

class ScaledBloomPass extends UnrealBloomPass {
  scale = 1;
  override setSize(width: number, height: number): void {
    super.setSize(Math.max(32, Math.round(width * this.scale)), Math.max(32, Math.round(height * this.scale)));
  }
}

/** Render before UI; reflections/shadow maps run first and remain separate linear scene renders. */
export function createPostStack(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, options: PostStackOptions = {}) {
  let quality = options.quality ?? 'balanced', disposed = false;
  const hdr = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const outputMapping = options.toneMapping === 'agx' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
  const initialSize = renderer.getSize(new THREE.Vector2());
  let cssWidth = Math.max(1, initialSize.x), cssHeight = Math.max(1, initialSize.y), requestedRatio = renderer.getPixelRatio();
  let width = 1, height = 1, exposure = renderer.toneMappingExposure;
  let composer: EffectComposer | undefined, depth: DepthPass | undefined, bloom: ScaledBloomPass | undefined;
  let output: OutputPass | undefined, scenePass: RenderPass | undefined;
  /** What the scene pass draws while the passes are warmed: nothing. */
  const emptyScene = new THREE.Scene();
  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4(), oldClear = new THREE.Color();
  const projected = new THREE.Vector3(), viewed = new THREE.Vector3();
  const uniforms = {
    tDiffuse: { value: null as THREE.Texture | null }, tDepth: { value: null as THREE.Texture | null },
    uProjectionInverse: { value: new THREE.Matrix4() }, uCameraWorld: { value: new THREE.Matrix4() },
    uTexel: { value: new THREE.Vector2(1, 1) }, uProjectionY: { value: 1 }, uAoSamples: { value: 0 },
    uFocus: { value: 0 }, uFogDensity: { value: 0 }, uNight: { value: 0 }, uShafts: { value: 0 },
    uFog: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    uBeacon: { value: new THREE.Vector4() }, uForge: { value: new THREE.Vector4() },
  };
  if (hdr) {
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: true, stencilBuffer: false,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    });
    target.texture.name = 'Chatdom linear HDR';
    target.texture.generateMipmaps = false;
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(1);
    depth = new DepthPass(new THREE.ShaderMaterial({
      name: 'Chatdom contact and air', uniforms, vertexShader, fragmentShader,
      depthTest: false, depthWrite: false, toneMapped: false,
    }));
    bloom = new ScaledBloomPass(new THREE.Vector2(1, 1), .24, .18, 1.05);
    bloom.materialHighPassFilter.uniforms.smoothWidth!.value = .25;
    output = new OutputPass();
    scenePass = new RenderPass(scene, camera);
    composer.addPass(scenePass);
    composer.addPass(depth);
    composer.addPass(bloom);
    composer.addPass(output);
  }

  function resize(nextWidth: number, nextHeight: number, pixelRatio = renderer.getPixelRatio()): void {
    if (disposed) return;
    const next = postStackSize(nextWidth, nextHeight, pixelRatio, quality);
    cssWidth = nextWidth; cssHeight = nextHeight; requestedRatio = pixelRatio;
    width = next.width; height = next.height;
    const budget = POST_QUALITY[quality];
    uniforms.uTexel.value.set(1 / width, 1 / height);
    uniforms.uAoSamples.value = budget.aoSamples;
    uniforms.uShafts.value = budget.shafts ? 1 : 0;
    if (!budget.dof) uniforms.uFocus.value = 0;
    if (composer && bloom) {
      const samples = Math.min(budget.samples, renderer.capabilities.maxSamples);
      for (const target of [composer.renderTarget1, composer.renderTarget2]) {
        if (target.samples !== samples) { target.dispose(); target.samples = samples; }
      }
      bloom.scale = budget.bloomScale;
      composer.setSize(width, height);
    }
  }
  resize(cssWidth, cssHeight, requestedRatio);

  function setLight(target: THREE.Vector4, light: PostLight | undefined): void {
    target.set(0, 0, 0, 0);
    if (!light || !Number.isFinite(light.strength) || light.strength <= 0 || !Number.isFinite(light.position.x) || !Number.isFinite(light.position.y) || !Number.isFinite(light.position.z)) return;
    viewed.copy(light.position).applyMatrix4(camera.matrixWorldInverse);
    if (viewed.z >= -camera.near) return;
    projected.copy(light.position).project(camera);
    target.set(projected.x * .5 + .5, projected.y * .5 + .5, -viewed.z, Math.min(1, light.strength));
  }

  function draw(deltaSeconds: number, onePixel: boolean): void {
    if (disposed) return;
    const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const tone = renderer.toneMapping, colourSpace = renderer.outputColorSpace, oldExposure = renderer.toneMappingExposure;
    const autoClear = renderer.autoClear, xr = renderer.xr.enabled, scissorTest = renderer.getScissorTest();
    const clearAlpha = renderer.getClearAlpha(), autoReset = renderer.info.autoReset;
    renderer.getViewport(viewport); renderer.getScissor(scissor); renderer.getClearColor(oldClear);
    try {
      renderer.xr.enabled = false; renderer.setScissorTest(false); renderer.autoClear = true;
      // Only the screen pass follows the renderer's viewport; the passes' own targets keep theirs.
      if (onePixel) renderer.setViewport(0, 0, 1, 1);
      renderer.toneMapping = outputMapping; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMappingExposure = exposure;
      // Count the complete composer frame, rather than only the last fullscreen triangle.
      renderer.info.autoReset = false; renderer.info.reset();
      camera.updateMatrixWorld();
      uniforms.uProjectionInverse.value.copy(camera.projectionMatrixInverse);
      uniforms.uCameraWorld.value.copy(camera.matrixWorld);
      uniforms.uProjectionY.value = camera.projectionMatrix.elements[5]!;
      if (composer) composer.render(Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0);
      else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
    } finally {
      renderer.setRenderTarget(target, face, mip);
      renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
      renderer.setClearColor(oldClear, clearAlpha); renderer.autoClear = autoClear; renderer.xr.enabled = xr;
      renderer.toneMapping = tone; renderer.outputColorSpace = colourSpace; renderer.toneMappingExposure = oldExposure;
      renderer.info.autoReset = autoReset;
    }
  }

  return {
    resize,
    setQuality(next: PostQuality): void { if (quality !== next) { quality = next; resize(cssWidth, cssHeight, requestedRatio); } },
    update(frame: PostFrame): void {
      if (disposed) return;
      const env = frame.environment;
      exposure = Number.isFinite(env.exposure) ? THREE.MathUtils.clamp(env.exposure, .1, 4) : 1;
      uniforms.uNight.value = env.night;
      uniforms.uFog.value.set(env.fog); uniforms.uGlow.value.set(env.glow);
      uniforms.uSunDirection.value.fromArray(env.sunDirection);
      uniforms.uFogDensity.value = options.fog === 'post' ? env.fogDensity * .48 : 0;
      uniforms.uFocus.value = POST_QUALITY[quality].dof && frame.focusDistance != null && Number.isFinite(frame.focusDistance) && frame.focusDistance > camera.near && frame.focusDistance < 40 ? frame.focusDistance : 0;
      setLight(uniforms.uBeacon.value, frame.beacon); setLight(uniforms.uForge.value, frame.forge);
    },
    render(deltaSeconds = 0): void { draw(deltaSeconds, false); },
    /**
     * Draw the composer's own passes once, over an empty scene and onto one pixel of the canvas, so the driver has
     * finished their programs (in the targets and formats they really draw into) before the first real frame.
     */
    warm(): void {
      if (disposed || !composer || !scenePass) return;
      scenePass.scene = emptyScene;
      try { draw(0, true); } finally { scenePass.scene = scene; }
    },
    /** The target the scene's main pass draws into, or null when it draws straight to the canvas. */
    sceneTarget(): THREE.WebGLRenderTarget | null { return composer ? composer.readBuffer : null; },
    diagnostics() {
      let textureBytes = 0;
      if (composer && bloom) {
        for (const target of [composer.renderTarget1, composer.renderTarget2]) textureBytes += target.width * target.height * 12 * (1 + target.samples);
        for (const target of [bloom.renderTargetBright, ...bloom.renderTargetsHorizontal, ...bloom.renderTargetsVertical]) textureBytes += target.width * target.height * 8;
      }
      return { hdr, quality, width, height, textureBytes, toneMapping: options.toneMapping ?? 'aces', fog: options.fog ?? 'material', aoSamples: hdr ? uniforms.uAoSamples.value : 0, bloom: hdr, focusDistance: uniforms.uFocus.value, disposed };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // r186 UnrealBloomPass.dispose omits the high-pass material it allocates.
      bloom?.materialHighPassFilter.dispose();
      depth?.dispose(); bloom?.dispose(); output?.dispose(); composer?.dispose();
    },
  };
}
