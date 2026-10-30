import * as THREE from 'three';

const RECEIVER_MARKER = '/* sun-visibility */';
const DIRECTION_EPSILON = Math.cos(0.0005);
const BIAS_MATRIX = new THREE.Matrix4().set(
  .5, 0, 0, .5,
  0, .5, 0, .5,
  0, 0, .5, .5,
  0, 0, 0, 1,
);

/** Local render policy, not an authoritative world or voxel contract. */
export interface SunShadowOptions {
  /** The bounded settlement and its tallest caster, in world metres. */
  bounds: THREE.Box3;
  resolution?: 1024 | 2048;
}

export interface SunShadowStats {
  readonly updates: number;
  readonly casters: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly textureBytes: number;
  readonly transformBytes: number;
  readonly enabled: boolean;
}

/**
 * A sphere keeps map scale independent of sun orientation. Snapping world origin to a
 * texel removes sub-texel translation, without following the presentation camera.
 */
export function fitSunShadowCamera(
  camera: THREE.OrthographicCamera, bounds: THREE.Box3, direction: THREE.Vector3, resolution: number,
): { matrix: THREE.Matrix4; metresPerTexel: number; depthRange: number } {
  const values = [...bounds.min.toArray(), ...bounds.max.toArray(), ...direction.toArray()];
  if (bounds.isEmpty() || values.some(value => !Number.isFinite(value)) || direction.lengthSq() < 1e-12
    || !Number.isInteger(resolution) || resolution < 1) throw new Error('Invalid sun shadow bounds or direction');
  const centre = bounds.getCenter(new THREE.Vector3());
  const radius = Math.ceil((bounds.getSize(new THREE.Vector3()).length() * .5 + 8) / 16) * 16;
  if (!Number.isFinite(radius) || radius > 4096) throw new Error('Sun shadow bounds exceed the bounded kingdom map');
  const sun = direction.clone().normalize();
  camera.left = camera.bottom = -radius;
  camera.right = camera.top = radius;
  camera.near = 1;
  camera.far = radius * 4 + 20;
  camera.position.copy(centre).addScaledVector(sun, radius * 2 + 10);
  camera.up.set(0, 0, -1);
  if (Math.abs(sun.z) > .99) camera.up.set(0, 1, 0);
  camera.lookAt(centre);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const projectionView = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const origin = new THREE.Vector3().applyMatrix4(projectionView).multiplyScalar(resolution / 2);
  camera.projectionMatrix.elements[12]! += (Math.round(origin.x) - origin.x) * 2 / resolution;
  camera.projectionMatrix.elements[13]! += (Math.round(origin.y) - origin.y) * 2 / resolution;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  const matrix = new THREE.Matrix4().multiplyMatrices(BIAS_MATRIX, camera.projectionMatrix).multiply(camera.matrixWorldInverse);
  return { matrix, metresPerTexel: radius * 2 / resolution, depthRange: camera.far - camera.near };
}

// Manual depth comparison works with WebGL2's core depth texture support. Receiver-plane
// depth correction prevents the PCF taps from mistaking a sloping roof for its own shadow.
const receiverGLSL = /* glsl */ `
uniform sampler2D uSunShadowMap;
uniform mat4 uSunShadowMatrix;
uniform vec2 uSunShadowTexel;
uniform float uSunShadowEnabled, uSunShadowBias, uSunShadowNormalBias, uSunShadowSoft;
float sunShadowVisibility(vec3 world, vec3 normal) {
  if (uSunShadowEnabled <= 0.0) return 1.0;
  vec4 projected = uSunShadowMatrix * vec4(world + normal * uSunShadowNormalBias, 1.0);
  vec3 p = projected.xyz / projected.w;
  vec3 dx = dFdx(p), dy = dFdy(p);
  float determinant = dx.x * dy.y - dx.y * dy.x;
  vec2 gradient = abs(determinant) > 1e-10
    ? vec2(dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z) / determinant
    : vec2(0.0);
  gradient = clamp(gradient, vec2(-10.0), vec2(10.0));
  if (any(lessThanEqual(p, vec3(0.0))) || any(greaterThanEqual(p, vec3(1.0)))) return 1.0;
  vec2 texelPosition = p.xy / uSunShadowTexel - 0.5;
  vec2 base = floor(texelPosition), f = fract(texelPosition);
  float visible = 0.0, total = 0.0;
  for (int y = -1; y <= 2; y++) for (int x = -1; x <= 2; x++) {
    if (uSunShadowSoft < 0.5 && (x < 0 || x > 1 || y < 0 || y > 1)) continue;
    float wx = x == -1 ? 1.0 - f.x : x == 2 ? f.x : 1.0;
    float wy = y == -1 ? 1.0 - f.y : y == 2 ? f.y : 1.0;
    if (uSunShadowSoft < 0.5) { wx = x == 0 ? 1.0 - f.x : f.x; wy = y == 0 ? 1.0 - f.y : f.y; }
    vec2 uv = (base + vec2(float(x), float(y)) + 0.5) * uSunShadowTexel;
    float receiver = p.z + dot(gradient, uv - p.xy) - uSunShadowBias;
    float sampleDepth = texture(uSunShadowMap, uv).r;
    float weight = wx * wy;
    visible += step(receiver, sampleDepth) * weight;
    total += weight;
  }
  return mix(1.0, visible / max(total, 0.001), uSunShadowEnabled);
}
`;

/**
 * One cached map for this bounded kingdom. Register the chosen static detail mesh BEFORE
 * camera culling rewrites its instance matrices. Geometry/height uniforms stay shared;
 * placements are copied so the presentation camera and its LOD fades cannot change shadows.
 * Re-register or invalidate after an actual world edit. Call updateSunDirection only once
 * construction is ready, before the main render. Presence changes never invalidate this map.
 *
 * Technique reference: Three 0.186 WebGLShadowMap, DepthTexture and WebGLRenderer state
 * handling (MIT). This implementation uses public APIs and original shader code.
 */
export function createSunShadows(renderer: THREE.WebGLRenderer, options: SunShadowOptions): {
  bindReceiver(material: THREE.ShaderMaterial): void;
  setResolution(resolution: 1024 | 2048): void;
  register(mesh: THREE.Mesh): () => void;
  invalidate(): void;
  updateSunDirection(direction: THREE.Vector3 | readonly [number, number, number]): boolean;
  readonly stats: SunShadowStats;
  dispose(): void;
} {
  let resolution = options.resolution ?? 2048;
  if (resolution !== 1024 && resolution !== 2048) throw new Error('Sun shadow resolution must be 1024 or 2048');
  const bounds = options.bounds.clone();
  const camera = new THREE.OrthographicCamera();
  // Validate before allocating any resources.
  const fit = fitSunShadowCamera(camera, bounds, new THREE.Vector3(1, 1, -.35), resolution);
  const depth = new THREE.DepthTexture(resolution, resolution, THREE.UnsignedIntType);
  depth.minFilter = depth.magFilter = THREE.NearestFilter;
  const target = new THREE.WebGLRenderTarget(resolution, resolution, {
    format: THREE.RedFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false, depthTexture: depth,
    generateMipmaps: false,
  });
  target.texture.name = 'kingdom-sun-unused-colour';
  depth.name = 'kingdom-sun-depth';
  const scene = new THREE.Scene();
  const uniforms = {
    uSunShadowMap: { value: depth }, uSunShadowMatrix: { value: fit.matrix },
    uSunShadowTexel: { value: new THREE.Vector2(1 / resolution, 1 / resolution) },
    uSunShadowEnabled: { value: 0 }, uSunShadowBias: { value: .015 / fit.depthRange },
    uSunShadowNormalBias: { value: .025 }, uSunShadowSoft: { value: resolution === 2048 ? 1 : 0 },
  };
  const receivers = new Set<THREE.ShaderMaterial>();
  const materials = new Map<THREE.ShaderMaterial, THREE.ShaderMaterial>();
  const casters = new Map<THREE.Mesh, THREE.Mesh>();
  const stats = { updates: 0, casters: 0, drawCalls: 0, triangles: 0,
    textureBytes: resolution * resolution * 5, transformBytes: 0, enabled: false };
  const lastSun = new THREE.Vector3();
  let dirty = true, disposed = false;

  function removeCaster(mesh: THREE.Mesh): void {
    const caster = casters.get(mesh);
    if (!caster) return;
    scene.remove(caster);
    if (caster instanceof THREE.InstancedMesh) { stats.transformBytes -= caster.instanceMatrix.array.byteLength; caster.dispose(); }
    casters.delete(mesh); stats.casters = casters.size; dirty = true;
  }

  return {
    stats,
    setResolution(value) {
      if (value !== 1024 && value !== 2048) throw new Error('Sun shadow resolution must be 1024 or 2048');
      if (disposed || value === resolution) return;
      resolution = value;
      // setSize releases the old GPU attachments; Three resizes the same depth
      // texture object on its next attachment, so receiver uniforms stay stable.
      target.setSize(value, value);
      uniforms.uSunShadowTexel.value.set(1 / value, 1 / value);
      uniforms.uSunShadowSoft.value = value === 2048 ? 1 : 0;
      uniforms.uSunShadowEnabled.value = 0;
      stats.textureBytes = value * value * 5; stats.enabled = false; dirty = true;
    },
    bindReceiver(material) {
      if (disposed) throw new Error('Sun shadows are disposed');
      if (receivers.has(material)) return;
      // The horizon may copy an already-bound ground shader and its shared uniforms.
      if (material.uniforms.uSunShadowMap === uniforms.uSunShadowMap
        && material.fragmentShader.includes('float sunShadowVisibility(')) { receivers.add(material); return; }
      if (material.glslVersion !== THREE.GLSL3 || material.fragmentShader.split(RECEIVER_MARKER).length !== 2) {
        throw new Error('Sun shadow receiver requires one explicit sun-visibility marker in a GLSL3 material');
      }
      // Inject before main, after existing varying/uniform declarations. The helper only
      // uses its explicit arguments, so it does not depend on those declaration positions.
      material.fragmentShader = `${receiverGLSL}\n${material.fragmentShader.replace(RECEIVER_MARKER, '* sunShadowVisibility(vWorld,n)')}`;
      Object.assign(material.uniforms, uniforms);
      material.needsUpdate = true;
      receivers.add(material);
    },
    register(mesh) {
      if (disposed) throw new Error('Sun shadows are disposed');
      if (!(mesh.material instanceof THREE.ShaderMaterial) || mesh.material.glslVersion !== THREE.GLSL3) {
        throw new Error('Sun casters require their exact GLSL3 vertex transform');
      }
      removeCaster(mesh);
      let material = materials.get(mesh.material);
      if (!material) {
        material = new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3, uniforms: mesh.material.uniforms,
          vertexShader: mesh.material.vertexShader,
          fragmentShader: 'out vec4 unusedColour; void main(){ unusedColour = vec4(1.0); }',
          defines: { ...mesh.material.defines }, side: THREE.DoubleSide, colorWrite: false,
          depthWrite: true, depthTest: true, blending: THREE.NoBlending, toneMapped: false,
        });
        materials.set(mesh.material, material);
      }
      mesh.updateWorldMatrix(true, false);
      let caster: THREE.Mesh;
      if (mesh instanceof THREE.InstancedMesh) {
        caster = new THREE.InstancedMesh(mesh.geometry, material, mesh.count);
        (caster as THREE.InstancedMesh).instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.array), 16);
        stats.transformBytes += (caster as THREE.InstancedMesh).instanceMatrix.array.byteLength;
      } else caster = new THREE.Mesh(mesh.geometry, material);
      caster.matrix.copy(mesh.matrixWorld); caster.matrixAutoUpdate = false;
      caster.frustumCulled = true; caster.name = `${mesh.name}:sun-caster`;
      scene.add(caster); casters.set(mesh, caster); stats.casters = casters.size; dirty = true;
      return () => { if (casters.get(mesh) === caster) removeCaster(mesh); };
    },
    invalidate() { if (!disposed) dirty = true; },
    updateSunDirection(direction) {
      if (disposed) return false;
      const sun = direction instanceof THREE.Vector3 ? direction.clone() : new THREE.Vector3(...direction);
      if (sun.toArray().some(value => !Number.isFinite(value)) || sun.lengthSq() < 1e-12) throw new Error('Invalid sun direction');
      sun.normalize();
      // A below-horizon source cannot cast a useful terrestrial sun shadow. Fade its
      // final low-angle contribution rather than popping a map on the horizon.
      const strength = THREE.MathUtils.smoothstep(sun.y, .015, .06);
      if (!strength || !casters.size) { uniforms.uSunShadowEnabled.value = 0; stats.enabled = false; return false; }
      if (!dirty && lastSun.dot(sun) >= DIRECTION_EPSILON) {
        uniforms.uSunShadowEnabled.value = strength; stats.enabled = true; return false;
      }
      const fitted = fitSunShadowCamera(camera, bounds, sun, resolution);
      uniforms.uSunShadowMatrix.value.copy(fitted.matrix);
      uniforms.uSunShadowBias.value = .015 / fitted.depthRange;
      const oldTarget = renderer.getRenderTarget(), oldFace = renderer.getActiveCubeFace(), oldMip = renderer.getActiveMipmapLevel();
      const oldViewport = renderer.getViewport(new THREE.Vector4()), oldScissor = renderer.getScissor(new THREE.Vector4());
      const oldScissorTest = renderer.getScissorTest(), oldClear = renderer.autoClear, oldXR = renderer.xr.enabled;
      const oldAutoReset = renderer.info.autoReset;
      const oldCounts = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        points: renderer.info.render.points, lines: renderer.info.render.lines };
      try {
        renderer.xr.enabled = false; renderer.autoClear = false; renderer.info.autoReset = false;
        renderer.setRenderTarget(target); renderer.setViewport(0, 0, resolution, resolution); renderer.setScissorTest(false);
        renderer.clear(false, true, false);
        renderer.render(scene, camera);
        stats.drawCalls = renderer.info.render.calls - oldCounts.calls;
        stats.triangles = renderer.info.render.triangles - oldCounts.triangles;
        stats.updates++; stats.enabled = true;
        uniforms.uSunShadowEnabled.value = strength; lastSun.copy(sun); dirty = false;
      } finally {
        renderer.setRenderTarget(oldTarget, oldFace, oldMip); renderer.setViewport(oldViewport);
        renderer.setScissor(oldScissor); renderer.setScissorTest(oldScissorTest);
        renderer.autoClear = oldClear; renderer.xr.enabled = oldXR; renderer.info.autoReset = oldAutoReset;
        // Preserve logical draw counters, but never rewind Three's frame ID: its
        // geometry upload cache uses that ID to distinguish physical render passes.
        Object.assign(renderer.info.render, oldCounts);
      }
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true; uniforms.uSunShadowEnabled.value = 0; stats.enabled = false;
      for (const source of [...casters.keys()]) removeCaster(source);
      for (const material of materials.values()) material.dispose();
      materials.clear(); receivers.clear(); scene.clear(); target.dispose();
      // target.dispose owns its depth attachment through Three's render-target path.
    },
  };
}
