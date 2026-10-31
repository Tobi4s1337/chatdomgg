import * as THREE from 'three';
import type { Vec3 } from '@chatdom/shared';
import type { WaterBody } from '@chatdom/world';
import type { WaterReach } from '../../../../../../packages/world/src/places/water/reaches';
import { RING_CAP, type Ring } from './events';
import { between } from './random';

/**
 * The life layers that are light rather than bodies: particle motes, rings, mist and lamp glows. Every buffer is
 * sized once; motion lives in the shaders as a pure function of the caller's time, so a frame costs uniform writes
 * and at most `RING_CAP` instance rows, and seeking is exact. Draw order after the water (4): rings 5, motes 6,
 * glows 7, mist 8 and up.
 */

const HEADER = /* glsl */`
  uniform float uTime, uAmount, uPixels;
  attribute vec4 aSeed;
  varying float vAlpha; varying vec3 vColour;
  float pointSize(vec4 mv, float metres, float lo, float hi) { return clamp(metres * projectionMatrix[1][1] * uPixels * .5 / -mv.z, lo, hi); }
`;
const SOFT_DOT = /* glsl */`
  varying float vAlpha; varying vec3 vColour;
  void main() {
    float d = length(gl_PointCoord - .5) * 2.;
    float a = vAlpha * pow(max(0., 1. - d * d), 1.6);
    if (a < .004) discard;
    gl_FragColor = vec4(vColour * a, a);
  }
`;

interface Motes { readonly points: THREE.Points; readonly uniforms: Record<string, THREE.IUniform> }

/** A fixed-size point cloud whose shader places every mote from its seed and the caller's time. */
function motes(name: string, count: number, seed: number, stream: number, vertex: string, uniforms: Record<string, THREE.IUniform>, additive: boolean, homes?: readonly Vec3[]): Motes {
  const geometry = new THREE.BufferGeometry(), seeds = new Float32Array(count * 4), position = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) for (let k = 0; k < 4; k++) seeds[i * 4 + k] = between(0, 1, seed, stream, i, k);
  homes?.forEach((p, i) => position.set(p, i * 3));
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const all = { uTime: { value: 0 }, uAmount: { value: 0 }, uPixels: { value: 900 }, ...uniforms };
  const material = new THREE.ShaderMaterial({
    name, uniforms: all, vertexShader: HEADER + vertex, fragmentShader: SOFT_DOT, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.CustomBlending,
    // Premultiplied over: a mote adds its light and covers by its own alpha, never more.
    ...(additive ? {} : { blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }),
  });
  const points = new THREE.Points(geometry, material);
  points.name = name; points.frustumCulled = false; points.renderOrder = 6;
  const viewport = new THREE.Vector4();
  // The size of a mote in pixels follows whatever target is being drawn (the canvas or a reflection).
  points.onBeforeRender = renderer => { renderer.getCurrentViewport(viewport); all.uPixels.value = viewport.w; };
  return { points, uniforms: all };
}

/** Fireflies about the reed beds: tiny, blinking, dimmer than any lit pane. */
export const FIREFLY_PEAK = 0.75;
export function fireflies(homes: readonly Vec3[], seed: number): Motes {
  return motes('water-life:fireflies', Math.max(1, homes.length), seed, 61, /* glsl */`
    void main() {
      float t = uTime;
      vec3 p = position + vec3(.45 * sin(t * (.21 + .2 * aSeed.x) + aSeed.y * 6.283), .16 * sin(t * (.33 + .2 * aSeed.z) + aSeed.w * 6.283), .45 * cos(t * (.17 + .2 * aSeed.y) + aSeed.x * 6.283));
      float blink = pow(max(0., sin(t * (.55 + .8 * aSeed.z) + aSeed.w * 40.)), 3.);
      // Not every firefly is out at once: more come out as the night deepens.
      float awake = step(aSeed.x, uAmount * 1.1);
      vAlpha = awake * uAmount * (.3 + .7 * blink) * ${FIREFLY_PEAK.toFixed(2)};
      vColour = vec3(.86, .95, .45);
      vec4 mv = modelViewMatrix * vec4(p, 1.);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = pointSize(mv, .07, 2.5, 5.5);
    }`, {}, true, homes);
}

/** Wheel spray: drops thrown off the descending buckets, falling into the tailrace. A faint rainbow at noon. */
export const SPRAY_COUNT = 72;
export interface WheelSprayInput { readonly pivot: Vec3; readonly axis: Vec3; readonly radius: number; readonly width: number; readonly level: number; readonly omega: number }
export function wheelSpray(wheel: WheelSprayInput, seed: number, index: number): Motes {
  const axis = new THREE.Vector3(...wheel.axis).normalize(), down = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize();
  return motes('water-life:wheel-spray', SPRAY_COUNT, seed, 620 + index, /* glsl */`
    uniform vec3 uPivot, uAxis, uDown; uniform float uRadius, uWidth, uLevel, uOmega, uRainbow;
    vec3 hue(float h) { return clamp(abs(mod(h * 6. + vec3(0., 4., 2.), 6.) - 3.) - 1., 0., 1.); }
    void main() {
      float life = .7 + .6 * aSeed.w;
      float tau = fract(uTime / life + aSeed.x * 7.);
      float age = tau * life;
      // Thrown from the rim on the descending side, mostly from its lower half where the buckets spill.
      float ang = mix(-1.05, .55, aSeed.y);
      vec3 radial = cos(ang) * uDown + sin(ang) * vec3(0., 1., 0.);
      vec3 start = uPivot + radial * uRadius * (.97 + .05 * aSeed.z) + uAxis * (aSeed.z - .5) * uWidth;
      vec3 v = cross(uAxis, radial) * uOmega * uRadius * .85 + radial * (.25 + .55 * aSeed.w) + uAxis * (aSeed.z - .5) * .5;
      vec3 p = start + v * age + vec3(0., -4.9, 0.) * age * age;
      vAlpha = uAmount * step(uLevel, p.y) * (1. - tau) * .5;
      vColour = mix(vec3(.84, .9, .98), hue(aSeed.y * .85), uRainbow * .45);
      vec4 mv = modelViewMatrix * vec4(p, 1.);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = pointSize(mv, .045, 1., 5.);
    }`, {
    uPivot: { value: new THREE.Vector3(...wheel.pivot) }, uAxis: { value: axis }, uDown: { value: down }, uRadius: { value: wheel.radius },
    uWidth: { value: wheel.width }, uLevel: { value: wheel.level }, uOmega: { value: wheel.omega }, uRainbow: { value: 0 },
  }, false);
}

/** The weir: broken drops off the crest and a low breath of mist where they land. */
export const WEIR_SPRAY_COUNT = 48;
export interface WeirSprayInput { readonly a: Vec3; readonly b: Vec3; readonly downstream: readonly [number, number]; readonly drop: number }
export function weirSpray(weir: WeirSprayInput, seed: number, index: number): Motes {
  const d = Math.hypot(...weir.downstream) || 1;
  return motes('water-life:weir-spray', WEIR_SPRAY_COUNT, seed, 640 + index, /* glsl */`
    uniform vec3 uA, uB, uDown; uniform float uDrop;
    void main() {
      bool puff = aSeed.w > .62;
      float life = puff ? 3.2 : .55 + .3 * aSeed.z;
      float tau = fract(uTime / life + aSeed.x * 5.);
      float age = tau * life;
      vec3 crest = mix(uA, uB, aSeed.y) + uDown * .08;
      vec3 p;
      if (puff) {
        // Mist rolls off the foot of the fall and lifts as it thins.
        p = crest + uDown * (.25 + .5 * tau + .2 * aSeed.z) + vec3(0., -uDrop + .05 + .35 * tau, 0.);
        vAlpha = uAmount * .1 * sin(3.1416 * tau);
      } else {
        vec3 v = uDown * (.45 + .35 * aSeed.z) + vec3(0., .25 + .3 * aSeed.w, 0.);
        p = crest + v * age + vec3(0., -4.9, 0.) * age * age;
        vAlpha = uAmount * step(crest.y - uDrop, p.y) * (1. - tau) * .55;
      }
      vColour = vec3(.88, .93, .97);
      vec4 mv = modelViewMatrix * vec4(p, 1.);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = puff ? pointSize(mv, .32, 2., 48.) : pointSize(mv, .04, 1., 4.);
    }`, {
    uA: { value: new THREE.Vector3(...weir.a) }, uB: { value: new THREE.Vector3(...weir.b) },
    uDown: { value: new THREE.Vector3(weir.downstream[0] / d, 0, weir.downstream[1] / d) }, uDrop: { value: weir.drop },
  }, false);
}

/** Flour dust drifting out of the mill door, catching the light. */
export const DUST_COUNT = 28;
export interface DustInput { readonly position: Vec3; readonly normal: Vec3 }
export function flourDust(door: DustInput, seed: number, index: number): Motes {
  const n = new THREE.Vector3(...door.normal).setY(0).normalize(), side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n);
  return motes('water-life:flour-dust', DUST_COUNT, seed, 630 + index, /* glsl */`
    uniform vec3 uDoor, uNormal, uSide;
    void main() {
      float life = 6. + 3. * aSeed.w;
      float tau = fract(uTime / life + aSeed.x * 3.);
      vec3 p = uDoor + uNormal * (.15 + 1.4 * aSeed.x * tau + .2 * aSeed.y) + uSide * ((aSeed.y - .5) * 1.5 + .15 * sin(uTime * .7 + aSeed.z * 9.))
        + vec3(0., .1 + 1.5 * aSeed.z + .25 * sin(uTime * .4 + aSeed.w * 7.), 0.);
      vAlpha = uAmount * sin(3.1416 * tau) * .55;
      vColour = vec3(.98, .92, .76);
      vec4 mv = modelViewMatrix * vec4(p, 1.);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = pointSize(mv, .028, 1., 3.);
    }`, { uDoor: { value: new THREE.Vector3(...door.position) }, uNormal: { value: n }, uSide: { value: side } }, false);
}

/** Drops thrown up where a fish falls back in. */
export const SPLASH_COUNT = 24;
export const SPLASH_LIFE = 0.9;
export function splash(seed: number): Motes {
  return motes('water-life:splash', SPLASH_COUNT, seed, 650, /* glsl */`
    uniform vec3 uCentre; uniform float uStart;
    void main() {
      float age = uTime - uStart;
      float a = aSeed.x * 6.283;
      vec3 v = vec3(cos(a), 0., sin(a)) * (.35 + .6 * aSeed.y) + vec3(0., 1.1 + 1.2 * aSeed.z, 0.);
      vec3 p = uCentre + v * age + vec3(0., -4.9, 0.) * age * age;
      float alive = step(0., age) * step(age, ${SPLASH_LIFE.toFixed(2)}) * step(uCentre.y, p.y);
      vAlpha = uAmount * alive * (1. - age / ${SPLASH_LIFE.toFixed(2)}) * .6;
      vColour = vec3(.9, .95, 1.);
      vec4 mv = modelViewMatrix * vec4(p, 1.);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = pointSize(mv, .04, 1., 4.);
    }`, { uCentre: { value: new THREE.Vector3() }, uStart: { value: -1e6 } }, false);
}

// ── Rings ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Rings { readonly mesh: THREE.Mesh; write(rings: readonly Ring[], time: number, colour: THREE.Color, life: number): void }

/** At most `RING_CAP` expanding rings lying on the water, one instanced draw. */
export function rings(): Rings {
  const quad = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index; geometry.setAttribute('position', quad.getAttribute('position'));
  const where = new THREE.InstancedBufferAttribute(new Float32Array(RING_CAP * 4), 4), life = new THREE.InstancedBufferAttribute(new Float32Array(RING_CAP * 2), 2);
  where.setUsage(THREE.DynamicDrawUsage); life.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aWhere', where); geometry.setAttribute('aLife', life);
  geometry.instanceCount = 0;
  quad.dispose();
  const uniforms = { uColour: { value: new THREE.Color() } };
  const material = new THREE.ShaderMaterial({
    name: 'water-life:rings', uniforms, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    vertexShader: /* glsl */`
      attribute vec4 aWhere; attribute vec2 aLife; varying vec2 vLocal; varying vec2 vLife;
      void main() {
        vLocal = position.xz; vLife = aLife;
        vec3 p = aWhere.xyz + vec3(position.x * aWhere.w * 1.2, .012, position.z * aWhere.w * 1.2);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColour; varying vec2 vLocal; varying vec2 vLife;
      void main() {
        float d = length(vLocal) * 1.2, age = vLife.x;
        float r = 1. - (1. - age) * (1. - age);
        float band = exp(-pow((d - r) / (.035 + .05 * age), 2.)) + .45 * exp(-pow((d - r * .62) / (.03 + .04 * age), 2.));
        float a = band * vLife.y * pow(1. - age, 1.4) * .42;
        if (a < .004) discard;
        gl_FragColor = vec4(uColour, a);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'water-life:rings'; mesh.frustumCulled = false; mesh.renderOrder = 5;
  return {
    mesh,
    write(list, time, colour, ringLife) {
      for (let i = 0; i < RING_CAP; i++) {
        const ring = list[i];
        // Rows past the drawn count are cleared, so a frame's buffers depend on that frame alone.
        if (ring) { where.setXYZW(i, ring.x, ring.y, ring.z, ring.radius); life.setXY(i, Math.min(1, Math.max(0, (time - ring.start) / ringLife)), ring.strength); }
        else { where.setXYZW(i, 0, 0, 0, 0); life.setXY(i, 0, 0); }
      }
      where.needsUpdate = life.needsUpdate = true;
      geometry.instanceCount = list.length;
      uniforms.uColour.value.copy(colour);
    },
  };
}

// ── Mist ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Mist hugs the water this far above it and never covers more than this. */
export const MIST_HEIGHT = 0.3;
export const MIST_OPACITY = 0.35;

/**
 * Low mist sheets over every supplied water: an ellipse per basin, a ribbon per course. Each sheet is at most
 * `MIST_OPACITY`; sheets draw nearest first and write depth, so where two meet the farther one is not stacked
 * under the nearer.
 */
export function mist(bodies: readonly WaterBody[], reaches: readonly WaterReach[]): { readonly meshes: THREE.Mesh[]; readonly uniforms: { uTime: THREE.IUniform<number>; uAmount: THREE.IUniform<number>; uColour: THREE.IUniform<THREE.Color> } } {
  const uniforms = { uTime: { value: 0 }, uAmount: { value: 0 }, uColour: { value: new THREE.Color() } };
  const material = new THREE.ShaderMaterial({
    name: 'water-life:mist', uniforms, transparent: true, depthWrite: true, depthFunc: THREE.LessDepth, blending: THREE.NormalBlending,
    vertexShader: /* glsl */`
      attribute float aEdge; varying float vEdge; varying vec3 vWorld;
      void main() { vEdge = aEdge; vec4 w = modelMatrix * vec4(position, 1.); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uAmount; uniform vec3 uColour; varying float vEdge; varying vec3 vWorld;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec2 p = vWorld.xz * .11 + vec2(uTime * .012, uTime * .007);
        float cloud = .55 * n(p) + .3 * n(p * 2.3 - uTime * .01) + .15 * n(p * 5.1);
        float near = smoothstep(2.5, 9., distance(cameraPosition, vWorld));
        float a = ${MIST_OPACITY.toFixed(2)} * uAmount * smoothstep(.25, .8, cloud) * (1. - smoothstep(.55, 1., vEdge)) * near;
        if (a < .01) discard;
        gl_FragColor = vec4(uColour, a);
      }`,
  });
  const meshes: THREE.Mesh[] = [];
  const add = (name: string, positions: number[], edges: number[], index: number[]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edges, 1));
    geometry.setIndex(index); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.renderOrder = 8; meshes.push(mesh);
  };
  for (const body of bodies) {
    const positions = [body.x, body.level + MIST_HEIGHT, body.z], edges = [0], index: number[] = [], rings = 6, around = 48;
    for (let r = 1; r <= rings; r++) for (let k = 0; k < around; k++) {
      const a = (k / around) * Math.PI * 2, f = (r / rings) * 1.05;
      positions.push(body.x + Math.cos(a) * body.radiusX * f, body.level + MIST_HEIGHT, body.z + Math.sin(a) * body.radiusZ * f); edges.push(r / rings);
    }
    for (let k = 0; k < around; k++) index.push(0, 1 + ((k + 1) % around), 1 + k);
    for (let r = 1; r < rings; r++) for (let k = 0; k < around; k++) {
      const a = 1 + (r - 1) * around + k, b = 1 + (r - 1) * around + ((k + 1) % around), c = a + around, d = b + around;
      index.push(a, b, c, b, d, c);
    }
    add(`water-life:mist:${body.id}`, positions, edges, index);
  }
  for (const reach of reaches) {
    const positions: number[] = [], edges: number[] = [], index: number[] = [], pts = reach.points;
    pts.forEach((p, i) => {
      const half = p.width / 2 + 1;
      for (const [side, edge] of [[-1, 1], [-0.5, 0.5], [0, 0], [0.5, 0.5], [1, 1]] as const) {
        positions.push(p.position[0] - p.tangent[1] * half * side, p.level + MIST_HEIGHT, p.position[1] + p.tangent[0] * half * side);
        edges.push(Math.max(edge, i === 0 || i === pts.length - 1 ? 0.6 : 0));
      }
      if (i) for (let k = 0; k < 4; k++) { const a = (i - 1) * 5 + k, b = a + 1, c = a + 5, d = c + 1; index.push(a, c, b, b, c, d); }
    });
    if (pts.length > 1) add(`water-life:mist:${reach.id}`, positions, edges, index);
  }
  return { meshes, uniforms };
}

// ── Glows ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One small warm disc texture, shared by every lamp and lantern glow. */
export function glowTexture(): THREE.Texture {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2), core = Math.max(0, 1 - d);
    // A hot core and a soft warm halo: the glass reads as lit from across the water.
    const a = Math.min(1, Math.pow(core, 1.6) * 0.75 + Math.pow(core, 5) * 1.2), i = (y * size + x) * 4;
    data[i] = 255; data[i + 1] = Math.round(200 + 30 * Math.pow(core, 3)); data[i + 2] = Math.round(130 + 60 * Math.pow(core, 5)); data[i + 3] = Math.round(a * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}
