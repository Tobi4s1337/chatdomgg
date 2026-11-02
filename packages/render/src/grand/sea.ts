import * as THREE from 'three';
import { GRAND_COMMON, type GrandUniforms } from './light';
import { LAND_MIST_GLSL, NO_MIST, type LandMistUniforms } from './mist';

/**
 * The sea: one plane to the horizon, coloured by the depth under it (sand-teal shallows to deep blue),
 * foam where it meets the land, small moving waves, Schlick Fresnel toward a planar reflection of the
 * land and sky (or the analytic sky where reflection is off), and the sun's glint path.
 * The reflection follows three.js's Reflector construction (MIT): a camera mirrored by reflecting its
 * position, forward and up vectors, sampled with a projective texture matrix.
 */
export interface GrandSeaOptions {
  readonly seaY: number;
  /** RG half-float: R ground height (m), G coast distance (m, + inland), over [0, landMetres]². */
  readonly floor: THREE.DataTexture;
  readonly landMetres: number;
  readonly reflection: boolean;
  readonly reflectionScale?: number;
  /** Longest side of the reflection target in pixels (spec 56 starts high reflection at 512²). */
  readonly reflectionMax?: number;
  /** The land's sea mist (GW13), shared with the terrain; without one the sea is all open. */
  readonly mist?: LandMistUniforms;
}

export class GrandSea {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.RawShaderMaterial;
  readonly reflectionCamera = new THREE.PerspectiveCamera();
  readonly target: THREE.WebGLRenderTarget | null;
  private readonly textureMatrix = new THREE.Matrix4();
  private readonly seaY: number;
  private readonly scale: number;
  private readonly maxSide: number;

  constructor(uniforms: GrandUniforms, options: GrandSeaOptions) {
    this.seaY = options.seaY;
    this.scale = options.reflectionScale ?? 0.5;
    this.maxSide = options.reflectionMax ?? 1024;
    this.target = options.reflection ? new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: true }) : null;
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        ...uniforms,
        ...(options.mist ?? NO_MIST.uniforms),
        uFloor: { value: options.floor }, uFloorMetres: { value: options.landMetres }, uSeaY: { value: options.seaY },
        uReflection: { value: this.target?.texture ?? null }, uReflectionOn: { value: options.reflection ? 1 : 0 },
        uTextureMatrix: { value: this.textureMatrix },
      },
      vertexShader: /* glsl */ `
        precision highp float;
        uniform mat4 modelMatrix, viewMatrix, projectionMatrix, uTextureMatrix;
        in vec3 position; out vec3 vWorld; out vec4 vReflect;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.); vWorld = w.xyz; vReflect = uTextureMatrix * w; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 cameraPosition;
        uniform sampler2D uFloor, uReflection, uCloudMap;
        uniform float uFloorMetres, uSeaY, uReflectionOn, uCloudTile, uCloudHeight, uCloudShadow;
        uniform vec2 uCloudOffset;
        in vec3 vWorld; in vec4 vReflect; out vec4 outColour;
        ${GRAND_COMMON}
        ${LAND_MIST_GLSL}
        vec2 waves(vec2 p, float t){
          vec2 g = vec2(0.);
          g += vec2(cos(p.x * .21 + p.y * .07 + t * 1.1), cos(p.y * .23 - p.x * .05 + t * .9)) * .32;
          g += vec2(vnoise(p * .55 + t * .35) - .5, vnoise(p.yx * .55 - t * .3) - .5) * .9;
          g += vec2(vnoise(p * 1.9 - t * .8) - .5, vnoise(p.yx * 1.9 + t * .7) - .5) * .45;
          return g;
        }
        void main(){
          vec2 uv = vWorld.xz / uFloorMetres;
          bool inside = all(greaterThan(uv, vec2(0.))) && all(lessThan(uv, vec2(1.)));
          vec2 floorData = inside ? texture(uFloor, uv).rg : vec2(uSeaY - 30., -300.);
          float depth = max(uSeaY - floorData.r, 0.);
          float coast = floorData.g;
          vec3 view = vWorld - cameraPosition; float dist = length(view); view /= dist;
          float calm = 1. - smoothstep(300., 1800., dist) * .75;
          vec2 g = waves(vWorld.xz, uTime) * calm;
          vec3 n = normalize(vec3(g.x * .09, 1., g.y * .09));
          // Body colour by depth: sandy teal over the shelf, deep blue beyond.
          vec3 shallow = vec3(.30, .62, .58), mid = vec3(.07, .33, .42), deep = vec3(.025, .12, .24);
          vec3 body = mix(shallow, mid, smoothstep(.3, 4.5, depth));
          body = mix(body, deep, smoothstep(5., 18., depth));
          body *= mix(uSkyColor * .9 + uGroundColor * .3, vec3(1.), .3);
          vec3 s = normalize(uSunDir);
          vec2 cp = vWorld.xz + s.xz / max(s.y, .12) * (uCloudHeight - vWorld.y);
          float cloud = 1. - uCloudShadow * smoothstep(.25, .75, texture(uCloudMap, (cp - uCloudOffset) / uCloudTile).r);
          body += uSunColor * .035 * max(s.y, 0.) * cloud * (1. - smoothstep(0., 6., depth));
          vec3 r = reflect(view, n);
          r.y = abs(r.y);
          vec3 reflected = skyColour(r, false);
          if (uReflectionOn > .5) {
            vec2 ruv = vReflect.xy / vReflect.w + g * .012 * calm;
            vec4 land = texture(uReflection, clamp(ruv, vec2(.001), vec2(.999)));
            reflected = mix(reflected, land.rgb, land.a);
          }
          float fresnel = .02 + .98 * pow(1. - max(dot(-view, n), 0.), 5.);
          vec3 col = mix(body, reflected, clamp(fresnel * 1.15, 0., 1.));
          // Glint: a path of sun on the water.
          float glint = pow(max(dot(r, s), 0.), 380.) * 9. + pow(max(dot(r, s), 0.), 40.) * .22;
          col += uSunColor * glint * cloud * (1. - uNight * .7);
          // Foam at the shore: a broken band that breathes.
          float band = 1. - smoothstep(0., 2.4, max(-coast, 0.));
          float foamNoise = vnoise(vWorld.xz * .6 + vec2(uTime * .3, -uTime * .2));
          float foam = band * smoothstep(.35, .7, foamNoise + .45 * sin(uTime * 1.3 + coast * 2.5));
          foam += (1. - smoothstep(0., .45, depth)) * .55;
          col = mix(col, (uSkyColor * .55 + uSunColor * .3 * cloud + vec3(.25)) , clamp(foam, 0., .85) * (1. - smoothstep(200., 900., dist)));
          vec4 mist = landMist(vWorld); col = mix(col, mist.rgb, mist.a);
          col = aerial(col, vWorld, cameraPosition);
          outColour = vec4(col, 1.);
        }`,
    });
    const geometry = new THREE.PlaneGeometry(40000, 40000, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.set(options.landMetres / 2, options.seaY, options.landMetres / 2);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Render the mirrored land and sky into the reflection target; the sea hides itself for the pass. */
  renderReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, uniforms: GrandUniforms): void {
    if (!this.target) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const fit = Math.min(this.scale, this.maxSide / Math.max(size.x, size.y));
    const w = Math.max(2, Math.floor(size.x * fit)), h = Math.max(2, Math.floor(size.y * fit));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    const normal = new THREE.Vector3(0, 1, 0), plane = new THREE.Vector3(camera.position.x, this.seaY, camera.position.z);
    const eye = camera.getWorldPosition(new THREE.Vector3());
    if (eye.y < this.seaY + 0.5) return;
    const rotation = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const view = plane.clone().sub(eye).reflect(normal).negate().add(plane);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rotation).add(eye);
    const target = plane.clone().sub(look).reflect(normal).negate().add(plane);
    const rc = this.reflectionCamera;
    rc.position.copy(view);
    rc.up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal);
    rc.lookAt(target);
    rc.fov = camera.fov; rc.aspect = camera.aspect; rc.near = camera.near; rc.far = camera.far;
    rc.updateMatrixWorld(); rc.updateProjectionMatrix();
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    const previous = renderer.getRenderTarget();
    this.mesh.visible = false;
    uniforms.uClipBelow.value = this.seaY - 0.2;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, rc);
    renderer.setRenderTarget(previous);
    uniforms.uClipBelow.value = -1e6;
    this.mesh.visible = true;
  }

  dispose(): void { this.material.dispose(); this.mesh.geometry.dispose(); this.target?.dispose(); }
}

/** The sea floor map: ground height and coast distance in metres, half-float RG at half land resolution. */
export function seaFloorTexture(ground: Uint16Array, coast: Int8Array, size: number, voxel: number): THREE.DataTexture {
  const half = size / 2, data = new Uint16Array(half * half * 2);
  for (let z = 0; z < half; z++) for (let x = 0; x < half; x++) {
    const i = x * 2 + z * 2 * size;
    const g = Math.min(ground[i]!, ground[i + 1]!, ground[i + size]!, ground[i + size + 1]!);
    const c = (coast[i]! + coast[i + 1]! + coast[i + size]! + coast[i + size + 1]!) / 4;
    data[(x + z * half) * 2] = THREE.DataUtils.toHalfFloat(g * voxel);
    data[(x + z * half) * 2 + 1] = THREE.DataUtils.toHalfFloat(c * voxel);
  }
  const texture = new THREE.DataTexture(data, half, half, THREE.RGFormat, THREE.HalfFloatType);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
