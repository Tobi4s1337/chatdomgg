import * as THREE from 'three';
import type { Vec3 } from '@chatdom/shared';
import { getEnvironment, windowGlowForHour } from '@chatdom/render';
import type { TrailStop } from '../map/route';

/**
 * The lantern path home: posts the town set out along the real street route to your door, kindled one by one from
 * where you stand, and the warm light at your own door as you come close.
 *
 * Light only, never a solid: nothing here is collision, and nothing here is read by the kingdom's collision. The voxel
 * world is lit by baked light volumes and ignores scene lights, so "light" is drawn: emissive lantern glass, a
 * camera-facing halo round each flame, and a warm pool laid on the ground under it (a pass that brightens the ground
 * by its own colour, so the cobbles read lit rather than fogged, and a faint additive pass that carries the warmth on
 * the darkest stone). Every material is unlit; the hour grades the post's ambient and how strong the glow is, on the
 * same day-to-night curve as the windows.
 *
 * Draw calls: posts, glass, halos, two pool passes and the door's wash: six, for any number of lanterns.
 */

export interface LanternTrailOptions {
  readonly scene: THREE.Scene;
  /** The drawn ground's height at (x, z), or null when unknown; posts stand on it (fall back to the stop's own y). */
  groundAt?(x: number, z: number): number | null;
  readonly reducedMotion: () => boolean;
}

export interface LanternDoor {
  /** The front step, at street level. */
  readonly position: Vec3;
  /** Outward from the door toward the street, unit x/z. */
  readonly outward: readonly [number, number];
}

export interface LanternTrail {
  /** Light a trail along these stops: kindled one by one from the first (nearest you) toward the door, ~80–110 ms apart, each with a small flare; reduced motion: all fade in together. Replaces a lit trail (the old one fades out). */
  light(stops: readonly TrailStop[], now: number): void;
  /** Put the trail out gently. */
  douse(now: number): void;
  readonly lit: boolean;
  /** Your own door (or null): its plaque glows as you come within ~14 m, fully at ~4 m, whether or not the trail is lit. */
  setDoor(door: LanternDoor | null): void;
  /** Each frame, before render. feet = your feet or null; hour 0..24 (by day the glow is subtler but still visible). Lanterns you have walked past (more than ~6 m behind you along the route) gently dim and go out, so the trail always leads ahead; when you are within ~3 m of the door the trail douses itself and the plaque does a small warm welcome swell. Flames flicker subtly (skip flicker with reduced motion). */
  frame(now: number, feet: Vec3 | null, hour: number): void;
  /** For tests and stills. */
  readonly debug: { readonly lanterns: number; readonly litLanterns: number; readonly doorGlow: number };
  dispose(): void;
}

/** The group every piece hangs under. The kingdom's collision never reads it. */
export const LANTERN_TRAIL_GROUP = 'play:lantern-trail';

// Timing, in milliseconds.
/** Between one lantern kindling and the next, walking away from you. */
export const KINDLE_STEP_MS = 95;
/** The post settles into view this long before its flame catches. */
const POST_LEAD_MS = 150;
const POST_IN_MS = 220;
const POST_OUT_MS = 650;
const KINDLE_MS = 420;
const REDUCED_KINDLE_MS = 650;
/** The flare peaks this long after the flame catches, then settles. */
const FLARE_PEAK_MS = 120;
const PASSED_OUT_MS = 1500;
const DOUSE_MS = 950;
const DOUSE_STEP_MS = 35;
const REPLACED_OUT_MS = 700;
const SWELL_RISE_MS = 380;
const SWELL_FALL_MS = 1400;

// Distances, in metres.
/** A lantern further behind you than this along the route goes out... */
export const PASSED_METRES = 6;
/** ...and comes back if you turn round and walk back within this. */
const RELIGHT_METRES = 3.5;
/** Further than this from the trail, you are not walking it: nothing goes out behind you. */
const OFF_TRAIL_METRES = 12;
export const DOOR_FAR_METRES = 14;
export const DOOR_FULL_METRES = 4;
export const DOOR_ARRIVE_METRES = 3;
/** Leaving the door by this much arms the welcome for the next time you come home. */
const DOOR_REARM_METRES = 5;
/** A lantern relit within this of one still glowing takes it over rather than doubling it. */
const REUSE_METRES = 0.4;

// The post, in its own frame: x toward the street (the arm), y up, origin at the foot.
const ARM_REACH = 0.5;
/** The flame's centre: inside the glass, under the end of the arm. */
const LAMP: readonly [number, number, number] = [ARM_REACH, 1.445, 0];
const POOL_RADIUS = 3.0;
const DOOR_POOL_RADIUS = 2.1;
const POOL_GRID = 9;
const POOL_LIFT = 0.035;
const HALO_RADIUS = 0.72;
const DOOR_HALO_RADIUS = 0.34;
/** The face of the house stands this far back from the step; the door's light is drawn on it. */
const DOOR_SETBACK = 0.3;
const WASH_WIDTH = 2.6, WASH_HEIGHT = 2.8;
/** The plaque beside the door, on the viewer's right: across and up from the foot of the door, metres. */
const PLAQUE_AT: readonly [number, number] = [0.86, 1.48];
const INITIAL_CAPACITY = 48;

const clamp01 = (n: number) => (n <= 0 ? 0 : n >= 1 ? 1 : n);
const smooth01 = (n: number) => { const t = clamp01(n); return t * t * (3 - 2 * t); };
const smoothstep = (edge0: number, edge1: number, n: number) => smooth01((n - edge0) / (edge1 - edge0));
/** A gentle overshoot for the post settling into place. */
const settle = (n: number) => { const t = clamp01(n), c = 1.4; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

interface Slot {
  active: boolean;
  /** Still part of the lit trail (not doused or replaced). */
  current: boolean;
  /** Stop index in the current trail. */
  index: number;
  x: number; y: number; z: number;
  /** The lamp's world position. */
  lx: number; ly: number; lz: number;
  at: number;
  seed: number;
  postAt: number;
  kindleAt: number;
  kindleMs: number;
  flare: number;
  carried: number;
  outAt: number;
  outMs: number;
  passed: boolean;
  /** Last written values, for debug and takeovers. */
  glass: number;
  presence: number;
}

const newSlot = (): Slot => ({ active: false, current: false, index: -1, x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, at: 0, seed: 0,
  postAt: 0, kindleAt: 0, kindleMs: KINDLE_MS, flare: 1, carried: 0, outAt: Infinity, outMs: DOUSE_MS, passed: false, glass: 0, presence: 0 });

// ---------------------------------------------------------------------------------------------------------------
// The post and its lantern, as a handful of boxes (metres, post frame). Vertex colours carry the materials.

const IRON = '#26272c', IRON_WORN = '#34343a', OAK = '#3f2c1f', OAK_DARK = '#2e2017', STONE = '#5a554e', STONE_DARK = '#46423d', BRASS = '#8a6a32';
type Box = readonly [x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, colour: string];

function postBoxes(): Box[] {
  const b: Box[] = [];
  const h = (w: number) => w / 2;
  // A squat stone footing with a chamfered course, then the oak shaft.
  b.push([-h(0.36), 0, -h(0.36), h(0.36), 0.12, h(0.36), STONE_DARK]);
  b.push([-h(0.28), 0.12, -h(0.28), h(0.28), 0.2, h(0.28), STONE]);
  b.push([-h(0.125), 0.2, -h(0.125), h(0.125), 1.8, h(0.125), OAK]);
  // A darker face strip down the street side gives the shaft its grain.
  b.push([h(0.125), 0.26, -h(0.05), h(0.125) + 0.008, 1.74, h(0.05), OAK_DARK]);
  // Iron straps.
  for (const y of [0.34, 1.12, 1.56]) b.push([-h(0.155), y, -h(0.155), h(0.155), y + 0.05, h(0.155), IRON]);
  // Cap and finial.
  b.push([-h(0.18), 1.8, -h(0.18), h(0.18), 1.85, h(0.18), IRON]);
  b.push([-h(0.1), 1.85, -h(0.1), h(0.1), 1.89, h(0.1), IRON_WORN]);
  b.push([-h(0.045), 1.89, -h(0.045), h(0.045), 1.95, h(0.045), IRON]);
  // The arm toward the street, with a stepped brace under it and a little curl at the tip.
  b.push([h(0.125), 1.71, -h(0.05), ARM_REACH + 0.07, 1.765, h(0.05), IRON]);
  b.push([h(0.125), 1.5, -h(0.04), h(0.125) + 0.06, 1.58, h(0.04), IRON]);
  b.push([h(0.125) + 0.05, 1.57, -h(0.04), h(0.125) + 0.12, 1.64, h(0.04), IRON]);
  b.push([h(0.125) + 0.11, 1.63, -h(0.04), h(0.125) + 0.19, 1.71, h(0.04), IRON]);
  b.push([ARM_REACH + 0.05, 1.765, -h(0.05), ARM_REACH + 0.1, 1.8, h(0.05), IRON]);
  // The hanger, then the lantern: a stepped cap, four corner bars, a sill with a drip under it.
  const [lx] = LAMP;
  b.push([lx - 0.016, 1.66, -0.016, lx + 0.016, 1.71, 0.016, IRON]);
  b.push([lx - 0.04, 1.64, -0.04, lx + 0.04, 1.665, 0.04, IRON_WORN]);
  b.push([lx - 0.09, 1.61, -0.09, lx + 0.09, 1.64, 0.09, IRON]);
  b.push([lx - 0.135, 1.575, -0.135, lx + 0.135, 1.61, 0.135, IRON]);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const cx = lx + sx * 0.098, cz = sz * 0.098;
    b.push([cx - 0.02, 1.31, cz - 0.02, cx + 0.02, 1.575, cz + 0.02, IRON]);
  }
  // A thin mid band round the cage.
  b.push([lx - 0.12, 1.43, -0.12, lx + 0.12, 1.445, 0.12, IRON_WORN]);
  b.push([lx - 0.125, 1.275, -0.125, lx + 0.125, 1.31, 0.125, IRON]);
  b.push([lx - 0.05, 1.245, -0.05, lx + 0.05, 1.275, 0.05, BRASS]);
  return b;
}

/** The glass: a little narrower than the cage so the bars stand proud at its corners. */
const GLASS_BOX: Box = [LAMP[0] - 0.088, 1.31, -0.088, LAMP[0] + 0.088, 1.575, 0.088, '#ffffff'];

function boxGeometry(boxes: readonly Box[]): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], colours: number[] = [], indices: number[] = [];
  const colour = new THREE.Color();
  // Six faces: normal axis, sign, and the two in-plane axes in winding order.
  const faces = [[0, 1, 1, 2], [0, -1, 2, 1], [1, 1, 2, 0], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 1, 0]] as const;
  for (const [x0, y0, z0, x1, y1, z1, hex] of boxes) {
    colour.set(hex);
    const lo = [x0, y0, z0], hi = [x1, y1, z1];
    for (const [axis, sign, u, v] of faces) {
      const base = positions.length / 3;
      for (const [a, c] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
        const p = [0, 0, 0];
        p[axis] = sign > 0 ? hi[axis]! : lo[axis]!;
        p[u] = a ? hi[u]! : lo[u]!;
        p[v] = c ? hi[v]! : lo[v]!;
        positions.push(p[0]!, p[1]!, p[2]!);
        const n = [0, 0, 0]; n[axis] = sign; normals.push(n[0]!, n[1]!, n[2]!);
        colours.push(colour.r, colour.g, colour.b);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------------------------------------------
// Shaders. All unlit; tone mapping and output colour space follow the renderer like the window lights do.

const DITHER = /* glsl */ `
  void presenceDither(float presence) {
    // The same screen threshold the voxel meshes and window lights dissolve with.
    float threshold = fract(dot(floor(gl_FragCoord.xy), vec2(.754877666, .569840296)));
    if (threshold >= presence) discard;
  }`;

const postVertex = /* glsl */ `
  attribute vec3 color;
  attribute vec3 aState; // presence, flame, settle
  uniform vec3 uLamp;
  varying vec3 vColor, vNormal;
  varying float vPresence, vWarm;
  void main() {
    vec3 p = position;
    p.y *= aState.z;
    vColor = color;
    vPresence = aState.x;
    vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    // The lantern lights its own post: faces turned toward the flame, falling off fast with distance.
    vec3 toLamp = uLamp - position;
    float d = length(toLamp);
    float facing = max(dot(normal, toLamp / max(d, 1e-4)), 0.0);
    vWarm = aState.y * (0.2 + 0.8 * facing) / (1.0 + d * d * 14.0);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
  }`;

const postFragment = /* glsl */ `
  uniform vec3 uSky, uGround, uKey, uKeyDirection, uWarm;
  varying vec3 vColor, vNormal;
  varying float vPresence, vWarm;
  ${DITHER}
  void main() {
    presenceDither(vPresence);
    vec3 n = normalize(vNormal);
    vec3 ambient = mix(uGround, uSky, n.y * 0.5 + 0.5);
    vec3 key = uKey * max(dot(n, uKeyDirection), 0.0);
    vec3 colour = vColor * (ambient + key) + vColor * uWarm * vWarm * 9.0 + uWarm * vWarm * 0.06;
    gl_FragColor = vec4(colour, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const glassVertex = /* glsl */ `
  attribute vec2 aGlass; // presence, glow
  uniform vec3 uLamp;
  varying vec3 vLocal;
  varying float vPresence, vGlow;
  void main() {
    vLocal = position - uLamp;
    vPresence = aGlass.x;
    vGlow = aGlass.y;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }`;

const glassFragment = /* glsl */ `
  uniform vec3 uSky;
  uniform float uBright;
  varying vec3 vLocal;
  varying float vPresence, vGlow;
  ${DITHER}
  void main() {
    presenceDither(vPresence);
    // The flame sits low in the glass: hottest there, amber toward the corners and the cap.
    vec3 q = vLocal / vec3(0.088, 0.13, 0.088);
    float core = exp(-(q.x * q.x + q.z * q.z) * 0.55 - (q.y + 0.18) * (q.y + 0.18) * 1.6);
    vec3 flame = mix(vec3(0.92, 0.26, 0.035), vec3(1.0, 0.58, 0.2), smoothstep(0.15, 0.7, core));
    flame = mix(flame, vec3(1.0, 0.8, 0.5), smoothstep(0.7, 0.98, core));
    vec3 lit = flame * (0.55 + 2.1 * core) * uBright * vGlow;
    // Unlit, it is dark sooty glass that still catches a little of the sky.
    vec3 cold = vec3(0.035, 0.03, 0.028) + uSky * 0.16;
    gl_FragColor = vec4(cold * (1.0 - clamp(vGlow, 0.0, 1.0)) + lit, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const haloVertex = /* glsl */ `
  attribute vec2 aHalo; // strength, radius
  varying vec2 vUv;
  varying float vStrength;
  void main() {
    vec4 centre = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    // Drawn a little toward the camera, so the cage and the glass never cut it.
    centre.xyz += normalize(-centre.xyz) * min(0.32, max(0.0, -centre.z - 0.2));
    centre.xy += position.xy * aHalo.y * 2.0;
    vUv = position.xy * 2.0;
    vStrength = aHalo.x;
    gl_Position = projectionMatrix * centre;
  }`;

const haloFragment = /* glsl */ `
  varying vec2 vUv;
  varying float vStrength;
  void main() {
    float r2 = dot(vUv, vUv);
    if (r2 >= 1.0 || vStrength <= 0.0) discard;
    // A tight hot core and a short soft skirt: sized to the flame, never a blown-out disc.
    float core = exp(-r2 * 34.0);
    float skirt = exp(-r2 * 5.0) * (1.0 - smoothstep(0.5, 1.0, r2));
    vec3 colour = mix(vec3(1.0, 0.40, 0.09), vec3(1.0, 0.7, 0.38), core) * (1.2 + 1.6 * core);
    gl_FragColor = vec4(colour, (core * 0.6 + skirt * 0.5) * vStrength);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const poolVertex = /* glsl */ `
  attribute float aPool;
  varying vec2 vUv;
  varying float vStrength;
  void main() {
    vUv = uv;
    vStrength = aPool;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }`;

const poolFalloff = /* glsl */ `
  varying vec2 vUv;
  varying float vStrength;
  float falloff() {
    float r2 = dot(vUv, vUv);
    if (r2 >= 1.0 || vStrength <= 0.0) discard;
    // Inverse-square from a lamp ~1.4 m up, eased to nothing at the rim.
    float lamp = 1.0 / (1.0 + r2 * 10.0) - 1.0 / 11.0;
    return lamp * (11.0 / 10.0) * (1.0 - smoothstep(0.7, 1.0, r2)) * vStrength;
  }`;

/** Brightens what is under it by its own colour: dst * (1 + src). Not tone mapped: it is a factor, not a colour. */
const poolLightFragment = /* glsl */ `
  ${poolFalloff}
  void main() {
    float f = falloff();
    gl_FragColor = vec4(vec3(1.0, 0.46, 0.15) * f * 2.8, 1.0);
  }`;

/** The faint warm wash on top, so the pool still reads on the darkest stone. */
const poolGlowFragment = /* glsl */ `
  ${poolFalloff}
  void main() {
    float f = falloff();
    gl_FragColor = vec4(vec3(1.0, 0.5, 0.17) * 0.22, f * f * 0.9 + f * 0.25);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const washVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

/**
 * The light at your door, on the face of the house: warm lamplight spilling from the head of the door down its frame,
 * and the name plaque beside it glowing like lit brass. Drawn as light on the wall, never as a solid.
 * Quad frame: x across the front (viewer's right +), y up from the step, metres.
 */
const washFragment = /* glsl */ `
  uniform float uStrength;
  uniform vec2 uSize, uPlaque, uPlaqueHalf;
  varying vec2 vUv;
  void main() {
    if (uStrength <= 0.0) discard;
    vec2 p = vec2((vUv.x - 0.5) * uSize.x, vUv.y * uSize.y);
    // Over the door: a soft warm bloom, falling away down the frame and fading at the sides.
    vec2 head = vec2(p.x / 0.95, (p.y - 2.1) / 0.8);
    float spill = exp(-dot(head, head) * 1.7) * 0.5;
    spill += exp(-p.x * p.x / 0.36) * smoothstep(0.0, 1.9, p.y) * (1.0 - smoothstep(2.0, 2.6, p.y)) * 0.1;
    // The plaque: a rounded plate, brightest at its rim where brass catches the light, with a short glow round it.
    vec2 q = abs(p - uPlaque) - uPlaqueHalf + 0.035;
    float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.035;
    float plate = 1.0 - smoothstep(-0.004, 0.01, sdf);
    float rim = plate * smoothstep(-0.032, -0.014, sdf);
    float face = plate * (0.4 + 0.25 * smoothstep(-0.12, 0.12, p.y - uPlaque.y));
    float around = exp(-max(sdf, 0.0) * 16.0) * (1.0 - plate) * 0.4;
    float plaque = face * 0.9 + rim * 0.9 + around;
    // Nothing reaches the edges of the quad.
    vec2 edge = min(vUv, 1.0 - vUv);
    spill *= smoothstep(0.0, 0.22, edge.x) * smoothstep(0.0, 0.16, edge.y);
    vec3 colour = vec3(1.0, 0.4, 0.1) * 1.2 * spill + vec3(1.0, 0.5, 0.15) * 1.15 * plaque;
    float strength = max(max(colour.r, colour.g), colour.b);
    gl_FragColor = vec4(colour / max(strength, 1e-4), strength * uStrength * 0.4);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// ---------------------------------------------------------------------------------------------------------------

export function createLanternTrail(options: LanternTrailOptions): LanternTrail {
  const group = new THREE.Group();
  group.name = LANTERN_TRAIL_GROUP;
  // Nothing here is a solid: no raycasts, no shadows, no collision.
  group.userData = { collision: false, presentationOnly: true };
  options.scene.add(group);

  const lamp = new THREE.Vector3(...LAMP);
  const postUniforms = {
    uLamp: { value: lamp }, uSky: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
    uKey: { value: new THREE.Color() }, uKeyDirection: { value: new THREE.Vector3(0, 1, 0) }, uWarm: { value: new THREE.Color(1, 0.5, 0.18) },
  };
  const glassUniforms = { uLamp: { value: lamp }, uSky: { value: new THREE.Color() }, uBright: { value: 1 } };
  const postMaterial = new THREE.ShaderMaterial({ name: 'lantern-post', uniforms: postUniforms, vertexShader: postVertex, fragmentShader: postFragment });
  const glassMaterial = new THREE.ShaderMaterial({ name: 'lantern-glass', uniforms: glassUniforms, vertexShader: glassVertex, fragmentShader: glassFragment });
  const haloMaterial = new THREE.ShaderMaterial({ name: 'lantern-halo', vertexShader: haloVertex, fragmentShader: haloFragment,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const poolLightMaterial = new THREE.ShaderMaterial({ name: 'lantern-pool-light', vertexShader: poolVertex, fragmentShader: poolLightFragment,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor, blendDst: THREE.OneFactor, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const poolGlowMaterial = new THREE.ShaderMaterial({ name: 'lantern-pool-glow', vertexShader: poolVertex, fragmentShader: poolGlowFragment,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const washUniforms = { uStrength: { value: 0 }, uSize: { value: new THREE.Vector2(WASH_WIDTH, WASH_HEIGHT) },
    uPlaque: { value: new THREE.Vector2(...PLAQUE_AT) }, uPlaqueHalf: { value: new THREE.Vector2(0.19, 0.12) } };
  const washMaterial = new THREE.ShaderMaterial({ name: 'lantern-door-wash', uniforms: washUniforms, vertexShader: washVertex, fragmentShader: washFragment,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });

  const postGeometry = boxGeometry(postBoxes());
  const glassGeometry = boxGeometry([GLASS_BOX]);
  glassGeometry.deleteAttribute('color');
  const quad = new THREE.PlaneGeometry(1, 1);
  const washGeometry = new THREE.PlaneGeometry(WASH_WIDTH, WASH_HEIGHT).translate(0, WASH_HEIGHT / 2, 0);
  const wash = new THREE.Mesh(washGeometry, washMaterial);
  wash.name = 'play:lantern-door-wash';
  wash.visible = false;
  wash.renderOrder = 3;
  wash.frustumCulled = false;
  group.add(wash);

  let slots: Slot[] = [];
  let posts!: THREE.InstancedMesh, glass!: THREE.InstancedMesh, halos!: THREE.InstancedMesh;
  let poolGeometry!: THREE.BufferGeometry, poolLight!: THREE.Mesh, poolGlow!: THREE.Mesh;
  let postState!: THREE.InstancedBufferAttribute, glassState!: THREE.InstancedBufferAttribute, haloState!: THREE.InstancedBufferAttribute;
  let poolStrength!: THREE.BufferAttribute;
  const perPool = POOL_GRID * POOL_GRID;

  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), translation = new THREE.Vector3(), unit = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);

  /** (Re)builds the instanced layers for `capacity` lanterns, keeping every slot's placement. */
  function build(capacity: number): void {
    const previous = slots;
    if (posts) {
      group.remove(posts, glass, halos, poolLight, poolGlow);
      posts.geometry.dispose(); glass.geometry.dispose(); halos.geometry.dispose(); poolGeometry.dispose();
      posts.dispose(); glass.dispose(); halos.dispose();
    }
    slots = Array.from({ length: capacity }, (_, i) => previous[i] ?? newSlot());
    const postGeo = postGeometry.clone();
    postState = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    postState.setUsage(THREE.DynamicDrawUsage);
    postGeo.setAttribute('aState', postState);
    posts = new THREE.InstancedMesh(postGeo, postMaterial, capacity);
    posts.name = 'play:lantern-posts';
    const glassGeo = glassGeometry.clone();
    glassState = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    glassState.setUsage(THREE.DynamicDrawUsage);
    glassGeo.setAttribute('aGlass', glassState);
    glass = new THREE.InstancedMesh(glassGeo, glassMaterial, capacity);
    glass.name = 'play:lantern-glass';
    // Halo 0 and pool 0 are the door's; lantern i is halo and pool i + 1.
    const haloGeo = quad.clone();
    haloState = new THREE.InstancedBufferAttribute(new Float32Array((capacity + 1) * 2), 2);
    haloState.setUsage(THREE.DynamicDrawUsage);
    haloGeo.setAttribute('aHalo', haloState);
    halos = new THREE.InstancedMesh(haloGeo, haloMaterial, capacity + 1);
    halos.name = 'play:lantern-halos';
    halos.renderOrder = 4;

    poolGeometry = new THREE.BufferGeometry();
    const pools = capacity + 1;
    poolGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pools * perPool * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(pools * perPool * 2);
    for (let p = 0; p < pools; p++) for (let j = 0; j < POOL_GRID; j++) for (let i = 0; i < POOL_GRID; i++) {
      const k = (p * perPool + j * POOL_GRID + i) * 2;
      uv[k] = (i / (POOL_GRID - 1)) * 2 - 1; uv[k + 1] = (j / (POOL_GRID - 1)) * 2 - 1;
    }
    poolGeometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    poolStrength = new THREE.BufferAttribute(new Float32Array(pools * perPool), 1).setUsage(THREE.DynamicDrawUsage);
    poolGeometry.setAttribute('aPool', poolStrength);
    const index: number[] = [];
    for (let p = 0; p < pools; p++) for (let j = 0; j < POOL_GRID - 1; j++) for (let i = 0; i < POOL_GRID - 1; i++) {
      const a = p * perPool + j * POOL_GRID + i, b = a + 1, c = a + POOL_GRID, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
    poolGeometry.setIndex(index);
    poolLight = new THREE.Mesh(poolGeometry, poolLightMaterial);
    poolLight.name = 'play:lantern-pool-light';
    poolGlow = new THREE.Mesh(poolGeometry, poolGlowMaterial);
    poolGlow.name = 'play:lantern-pool-glow';
    poolLight.renderOrder = 1; poolGlow.renderOrder = 2;
    for (const mesh of [posts, glass, halos, poolLight, poolGlow]) { mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add(mesh); }
    for (let i = 0; i < capacity; i++) { if (slots[i]!.active) place(i, slots[i]!, slots[i]!.lx - slots[i]!.x, slots[i]!.lz - slots[i]!.z); else hide(i); }
    if (door) placeDoor(door);
  }

  const ground = (x: number, z: number, fallback: number): number => {
    const y = options.groundAt?.(x, z);
    return typeof y === 'number' && Number.isFinite(y) ? y : fallback;
  };

  /** Lays one pool's grid on the drawn ground round (cx, cz). */
  function layPool(pool: number, cx: number, cz: number, radius: number, fallback: number): void {
    const array = poolGeometry.getAttribute('position').array as Float32Array;
    for (let j = 0; j < POOL_GRID; j++) for (let i = 0; i < POOL_GRID; i++) {
      const x = cx + ((i / (POOL_GRID - 1)) * 2 - 1) * radius, z = cz + ((j / (POOL_GRID - 1)) * 2 - 1) * radius;
      const k = (pool * perPool + j * POOL_GRID + i) * 3;
      array[k] = x; array[k + 1] = ground(x, z, fallback) + POOL_LIFT; array[k + 2] = z;
    }
    poolGeometry.getAttribute('position').needsUpdate = true;
  }

  function collapsePool(pool: number): void {
    const array = poolGeometry.getAttribute('position').array as Float32Array;
    array.fill(0, pool * perPool * 3, (pool + 1) * perPool * 3);
    (poolStrength.array as Float32Array).fill(0, pool * perPool, (pool + 1) * perPool);
    poolGeometry.getAttribute('position').needsUpdate = true;
    poolStrength.needsUpdate = true;
  }

  /** Stands a post at the slot with its arm reaching (ix, iz) toward the street. */
  function place(i: number, slot: Slot, ix: number, iz: number): void {
    const length = Math.hypot(ix, iz) || 1;
    const ux = ix / length, uz = iz / length;
    rotation.setFromAxisAngle(up, Math.atan2(-uz, ux));
    translation.set(slot.x, slot.y, slot.z);
    matrix.compose(translation, rotation, unit);
    posts.setMatrixAt(i, matrix); glass.setMatrixAt(i, matrix);
    slot.lx = slot.x + ux * ARM_REACH; slot.lz = slot.z + uz * ARM_REACH; slot.ly = slot.y + LAMP[1];
    matrix.makeTranslation(slot.lx, slot.ly, slot.lz);
    halos.setMatrixAt(i + 1, matrix);
    posts.instanceMatrix.needsUpdate = glass.instanceMatrix.needsUpdate = halos.instanceMatrix.needsUpdate = true;
    // The pool sits under the lamp, nudged a little further over the street the arm reaches into.
    layPool(i + 1, slot.lx + ux * 0.25, slot.lz + uz * 0.25, POOL_RADIUS, slot.y);
  }

  function hide(i: number): void {
    postState.setXYZ(i, 0, 0, 1); glassState.setXY(i, 0, 0); haloState.setXY(i + 1, 0, 0);
    collapsePool(i + 1);
  }

  let door: LanternDoor | null = null;
  let doorGlow = 0, doorTarget = 0, swellAt = -Infinity, armed = false;

  function placeDoor(value: LanternDoor): void {
    const [x, y, z] = value.position;
    const length = Math.hypot(value.outward[0], value.outward[1]) || 1;
    const ox = value.outward[0] / length, oz = value.outward[1] / length;
    const wx = x - ox * DOOR_SETBACK, wz = z - oz * DOOR_SETBACK;
    const wy = ground(wx, wz, y);
    wash.position.set(wx, wy, wz);
    wash.rotation.set(0, Math.atan2(ox, oz), 0);
    wash.updateMatrix();
    // The viewer's right, looking at the house from the street, is (oz, -ox).
    matrix.makeTranslation(wx + oz * PLAQUE_AT[0] + ox * 0.04, wy + PLAQUE_AT[1], wz - ox * PLAQUE_AT[0] + oz * 0.04);
    halos.setMatrixAt(0, matrix);
    halos.instanceMatrix.needsUpdate = true;
    layPool(0, x + ox * 0.5, z + oz * 0.5, DOOR_POOL_RADIUS, y);
  }

  build(INITIAL_CAPACITY);

  // The current trail, for working out how far along it you are.
  let lit = false;
  let routeX = new Float32Array(0), routeZ = new Float32Array(0), routeAt = new Float32Array(0), routeCount = 0;

  /** Glass level, flare and post presence for a slot at `now`. */
  function levels(slot: Slot, now: number, out: { glass: number; flare: number; presence: number; settle: number }): void {
    const sinceKindle = now - slot.kindleAt;
    const kindled = sinceKindle >= 0 ? smooth01(sinceKindle / slot.kindleMs) : 0;
    const fading = now >= slot.outAt ? 1 - smooth01((now - slot.outAt) / slot.outMs) : 1;
    out.glass = Math.max(kindled, slot.carried) * fading;
    const x = sinceKindle / FLARE_PEAK_MS;
    out.flare = sinceKindle >= 0 && slot.flare > 0 ? slot.flare * x * Math.exp(1 - x) * fading : 0;
    const sincePost = now - slot.postAt;
    const shown = sincePost >= 0 ? smooth01(sincePost / POST_IN_MS) : 0;
    const postOutAt = slot.outAt + slot.outMs * 0.55;
    const gone = now >= postOutAt ? smooth01((now - postOutAt) / POST_OUT_MS) : 0;
    out.presence = shown * (1 - gone);
    out.settle = slot.flare > 0 ? (sincePost >= 0 ? 0.92 + 0.08 * settle(sincePost / (POST_IN_MS * 1.6)) : 0.92) : 1;
  }
  const sample = { glass: 0, flare: 0, presence: 0, settle: 1 };

  function retire(slot: Slot, now: number, ms: number): void {
    slot.current = false;
    if (slot.outAt > now) { slot.outAt = now; slot.outMs = ms; }
  }

  function light(stops: readonly TrailStop[], now: number): void {
    const reduced = options.reducedMotion();
    // Glowing lanterns of the old trail that stand where a new one goes are taken over, not doubled.
    const old: number[] = [];
    for (let i = 0; i < slots.length; i++) if (slots[i]!.active) { old.push(i); levels(slots[i]!, now, sample); slots[i]!.glass = sample.glass; slots[i]!.presence = sample.presence; }
    const claimed = new Set<number>();
    const placements: { slot: number; reuse: boolean }[] = [];
    let need = 0;
    for (const stop of stops) {
      let reuse = -1;
      for (const i of old) {
        const s = slots[i]!;
        if (claimed.has(i) || s.presence < 0.9) continue;
        if (Math.hypot(s.x - stop.position[0], s.z - stop.position[2]) < REUSE_METRES) { reuse = i; break; }
      }
      if (reuse >= 0) { claimed.add(reuse); placements.push({ slot: reuse, reuse: true }); } else { placements.push({ slot: -1, reuse: false }); need++; }
    }
    for (const i of old) if (!claimed.has(i)) retire(slots[i]!, now, REPLACED_OUT_MS);
    let free = 0;
    for (const slot of slots) if (!slot.active) free++;
    if (free < need) build(Math.max(slots.length * 2, slots.length + need - free));

    if (routeX.length < stops.length) { routeX = new Float32Array(stops.length); routeZ = new Float32Array(stops.length); routeAt = new Float32Array(stops.length); }
    routeCount = stops.length;
    let cursor = 0;
    stops.forEach((stop, index) => {
      const placement = placements[index]!;
      let i = placement.slot;
      if (i < 0) { while (slots[cursor]!.active) cursor++; i = cursor++; }
      const slot = slots[i]!;
      const [px, py, pz] = stop.position;
      routeX[index] = px; routeZ[index] = pz; routeAt[index] = stop.at;
      const delay = reduced ? 0 : index * KINDLE_STEP_MS;
      slot.current = true; slot.index = index; slot.at = stop.at; slot.passed = false; slot.outAt = Infinity; slot.outMs = DOUSE_MS;
      slot.kindleMs = reduced ? REDUCED_KINDLE_MS : KINDLE_MS;
      slot.flare = reduced ? 0 : 1;
      if (placement.reuse) {
        // Already standing and lit: it keeps its light and flares as the kindling passes it.
        slot.carried = slot.glass;
        slot.kindleAt = now + delay; slot.postAt = Math.min(slot.postAt, now - POST_IN_MS);
        return;
      }
      slot.active = true;
      slot.carried = 0;
      slot.seed = ((index * 2654435761) % 1000) / 1000 * Math.PI * 2 + stop.at * 0.37;
      slot.postAt = now + delay; slot.kindleAt = now + delay + (reduced ? 0 : POST_LEAD_MS);
      slot.x = px; slot.z = pz; slot.y = ground(px, pz, py);
      // The arm reaches toward the street: away from the side this post stands on. Neighbours stand on the other side,
      // so the middle of the street is toward their midpoint; a lone post reaches across its own right-hand side.
      const fx = stop.forward[0], fz = stop.forward[1];
      const rx = -fz, rz = fx;
      const a = stops[index - 1]?.position, b = stops[index + 1]?.position;
      let mx = 0, mz = 0, n = 0;
      if (a) { mx += a[0]; mz += a[2]; n++; }
      if (b) { mx += b[0]; mz += b[2]; n++; }
      let toward = n ? (mx / n - px) * rx + (mz / n - pz) * rz : 0;
      if (Math.abs(toward) < 0.2) toward = index % 2 === 0 ? -1 : 1;
      const sign = toward > 0 ? 1 : -1;
      place(i, slot, rx * sign, rz * sign);
    });
    lit = stops.length > 0;
  }

  function douse(now: number): void {
    if (!lit) return;
    lit = false;
    // From the door back toward you, a lamplighter's walk in reverse, but quick.
    let last = 0;
    for (const slot of slots) if (slot.active && slot.current) last = Math.max(last, slot.index);
    for (const slot of slots) if (slot.active && slot.current) {
      const delay = options.reducedMotion() ? 0 : (last - slot.index) * DOUSE_STEP_MS;
      slot.current = false;
      if (slot.outAt > now + delay) { slot.outAt = now + delay; slot.outMs = DOUSE_MS; }
    }
    routeCount = 0;
  }

  /** How far along the trail (metres from its start) the point (x, z) is, or NaN when it is well off the trail. */
  function progress(x: number, z: number): number {
    if (routeCount === 0) return Number.NaN;
    let best = Infinity, along = Number.NaN;
    if (routeCount === 1) {
      return Math.hypot(x - routeX[0]!, z - routeZ[0]!) > OFF_TRAIL_METRES ? Number.NaN : routeAt[0]!;
    }
    for (let i = 1; i < routeCount; i++) {
      const ax = routeX[i - 1]!, az = routeZ[i - 1]!, dx = routeX[i]! - ax, dz = routeZ[i]! - az, span = dx * dx + dz * dz;
      const raw = span > 1e-9 ? ((x - ax) * dx + (z - az) * dz) / span : 0;
      // Before the first lantern and past the last the trail runs on.
      const t = i === 1 ? Math.min(1, raw) : i === routeCount - 1 ? Math.max(0, raw) : clamp01(raw);
      const ct = clamp01(t);
      const d = Math.hypot(x - ax - dx * ct, z - az - dz * ct);
      if (d < best - 1e-6) { best = d; along = routeAt[i - 1]! + (routeAt[i]! - routeAt[i - 1]!) * t; }
    }
    return best > OFF_TRAIL_METRES ? Number.NaN : along;
  }

  let lastNow = Number.NaN, gradedHour = Number.NaN, night = 1;
  const keyDirection = new THREE.Vector3();
  function grade(hour: number): void {
    if (Math.abs(hour - gradedHour) < 0.02) return;
    gradedHour = hour;
    const environment = getEnvironment(hour);
    night = windowGlowForHour(hour);
    // The post stands in the same sky as the town: its ambient and key follow the hour, kept a touch darker than
    // the voxel walls so the iron reads as iron.
    postUniforms.uSky.value.set(environment.ambient).multiplyScalar(environment.ambientIntensity * 0.42);
    postUniforms.uGround.value.set(environment.shadow).multiplyScalar(0.3);
    postUniforms.uKey.value.set(environment.sun).multiplyScalar(environment.sunIntensity * 0.45);
    keyDirection.set(...environment.sunDirection).normalize();
    postUniforms.uKeyDirection.value.copy(keyDirection);
    glassUniforms.uSky.value.set(environment.zenith);
    glassUniforms.uBright.value = 0.55 + 0.45 * night;
  }

  function frame(now: number, feet: Vec3 | null, hour: number): void {
    if (disposed || !Number.isFinite(now)) return;
    const dt = Number.isFinite(lastNow) ? Math.min(250, Math.max(0, now - lastNow)) : 0;
    lastNow = now;
    grade(Number.isFinite(hour) ? hour : 20);
    const reduced = options.reducedMotion();
    const haloDay = 0.3 + 0.7 * night, poolDay = 0.12 + 0.88 * night;

    // Your door: near is warm, and coming home is welcomed.
    if (door) {
      const d = feet ? Math.hypot(feet[0] - door.position[0], feet[2] - door.position[2]) : Infinity;
      doorTarget = feet ? smoothstep(DOOR_FAR_METRES, DOOR_FULL_METRES, d) : 0;
      if (d > DOOR_REARM_METRES && Number.isFinite(d)) armed = true;
      if (d < DOOR_ARRIVE_METRES) {
        if (lit) douse(now);
        if (armed) { armed = false; swellAt = now; }
      }
    } else doorTarget = 0;
    // Eased so a teleport or a door that turns up mid-walk fades rather than pops.
    doorGlow += (doorTarget - doorGlow) * (1 - Math.exp(-dt / 320));

    // Lanterns you have walked well past go out; turn back and they come back.
    if (lit && feet) {
      const along = progress(feet[0], feet[2]);
      if (Number.isFinite(along)) for (const slot of slots) {
        if (!slot.active || !slot.current) continue;
        const behind = along - slot.at;
        if (!slot.passed && behind > PASSED_METRES) {
          slot.passed = true; slot.outAt = now; slot.outMs = PASSED_OUT_MS;
        } else if (slot.passed && behind < RELIGHT_METRES) {
          levels(slot, now, sample);
          slot.passed = false; slot.carried = sample.glass; slot.outAt = Infinity;
          slot.kindleAt = now; slot.kindleMs = reduced ? REDUCED_KINDLE_MS : KINDLE_MS; slot.flare = reduced ? 0 : 0.5;
          slot.postAt = now - POST_IN_MS * sample.presence;
        }
      }
    }

    const t = now / 1000;
    let highest = -1;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      if (!slot.active) continue;
      levels(slot, now, sample);
      // Retired and fully gone: free the slot.
      if (!slot.current && now > slot.outAt + slot.outMs * 0.55 + POST_OUT_MS) {
        slot.active = false; slot.glass = 0; slot.presence = 0; hide(i); continue;
      }
      highest = i;
      const s = slot.seed;
      const flicker = reduced ? 1 : 1 + 0.055 * Math.sin(t * 7.3 + s) + 0.035 * Math.sin(t * 12.9 + s * 2.3) + 0.022 * Math.sin(t * 23.1 + s * 0.7);
      slot.glass = sample.glass; slot.presence = sample.presence;
      const flame = sample.glass * flicker + sample.flare * 0.9;
      postState.setXYZ(i, sample.presence, flame * (0.4 + 0.6 * night), sample.settle);
      glassState.setXY(i, sample.presence, flame);
      haloState.setXY(i + 1, (sample.glass * (0.85 + 0.15 * flicker) + sample.flare * 1.1) * haloDay, HALO_RADIUS * (1 + 0.22 * sample.flare));
      const pool = sample.glass * (0.92 + 0.08 * flicker) * poolDay + sample.flare * 0.25 * poolDay;
      (poolStrength.array as Float32Array).fill(pool, (i + 1) * perPool, (i + 2) * perPool);
    }
    posts.count = glass.count = highest + 1;

    // The door: its glow by distance, the welcome swell over it.
    const since = now - swellAt;
    const swell = since < 0 ? 0 : since < SWELL_RISE_MS ? smooth01(since / SWELL_RISE_MS) : Math.exp(-(since - SWELL_RISE_MS) / (SWELL_FALL_MS * 0.45));
    const doorLight = door ? doorGlow + 0.65 * (swell > 0.002 ? swell : 0) : 0;
    debugDoor = doorLight;
    const doorFlicker = reduced ? 1 : 1 + 0.03 * Math.sin(t * 6.1) + 0.02 * Math.sin(t * 15.7 + 1.3);
    haloState.setXY(0, doorLight * doorFlicker * 0.4 * (0.25 + 0.75 * night), DOOR_HALO_RADIUS * (1 + 0.2 * swell));
    (poolStrength.array as Float32Array).fill(doorLight * poolDay, 0, perPool);
    washUniforms.uStrength.value = doorLight * doorFlicker * (0.3 + 0.7 * night);
    wash.visible = doorLight > 0.002;

    postState.needsUpdate = glassState.needsUpdate = haloState.needsUpdate = poolStrength.needsUpdate = true;
  }

  let debugDoor = 0, disposed = false;
  const debug = {
    get lanterns() { let n = 0; for (const slot of slots) if (slot.active && slot.current) n++; return n; },
    get litLanterns() { let n = 0; for (const slot of slots) if (slot.active && slot.glass >= 0.5) n++; return n; },
    get doorGlow() { return debugDoor; },
  };

  return {
    light(stops, now) { if (!disposed) light(stops, now); },
    douse(now) { if (!disposed) douse(now); },
    get lit() { return lit; },
    setDoor(value) {
      if (disposed) return;
      const same = value && door && value.position.every((v, i) => v === door!.position[i]) && value.outward[0] === door.outward[0] && value.outward[1] === door.outward[1];
      if (same) return;
      door = value ? { position: [...value.position] as Vec3, outward: [value.outward[0], value.outward[1]] } : null;
      if (door) placeDoor(door);
      else { collapsePool(0); haloState.setXY(0, 0, 0); haloState.needsUpdate = true; wash.visible = false; doorGlow = 0; }
      armed = false; swellAt = -Infinity;
    },
    frame,
    debug,
    dispose() {
      if (disposed) return;
      disposed = true;
      options.scene.remove(group);
      group.remove(posts, glass, halos, poolLight, poolGlow, wash);
      posts.geometry.dispose(); glass.geometry.dispose(); halos.geometry.dispose(); poolGeometry.dispose();
      posts.dispose(); glass.dispose(); halos.dispose();
      postGeometry.dispose(); glassGeometry.dispose(); quad.dispose(); washGeometry.dispose();
      for (const material of [postMaterial, glassMaterial, haloMaterial, poolLightMaterial, poolGlowMaterial, washMaterial]) material.dispose();
      slots = [];
    },
  };
}
