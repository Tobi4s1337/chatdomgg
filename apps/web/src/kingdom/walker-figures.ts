import * as THREE from 'three';
import type { VoxelRenderState } from '@chatdom/render';
import { createStyledCitizenMaterial } from '../citizens/style-material';

/**
 * At scale, the nearest walkers are drawn in full and everyone further away as a simple figure: one instanced draw
 * of a small block silhouette in a muted tunic per person, lit by the same kingdom light as the full citizens.
 * Walkers never vanish because a street is busy; the far ones only lose their detail.
 */

export const FULL_WALKER_LIMIT = 64;
/** A walker who is drawn in full stays so until a newcomer is clearly nearer: 15% and a metre and a half. */
const KEEP_FACTOR = .85, KEEP_MARGIN_M = 1.5;
/** Crossfade between full and simple, so a walker crossing the boundary dissolves rather than swaps. */
export const WALKER_DETAIL_BLEND_MS = 350;

export interface WalkerPoint { readonly id: string; readonly x: number; readonly y: number; readonly z: number; readonly self?: boolean }
type Eye = { readonly x: number; readonly y: number; readonly z: number };

/**
 * Pure split into the nearest `limit` walkers (full) and the rest (simple). Pass the previous full set as
 * `previous` for hysteresis: someone already drawn in full keeps their detail until a newcomer is clearly nearer,
 * so a walker at the boundary never flips between full and simple from one frame to the next. You are always full.
 */
export function nearestWalkers<T extends WalkerPoint>(poses: readonly T[], eye: Eye, limit = FULL_WALKER_LIMIT, previous: ReadonlySet<string> = new Set()) {
  const scored: { pose: T; score: number }[] = [];
  for (const pose of poses) {
    if (![pose.x, pose.y, pose.z].every(Number.isFinite)) continue;
    const distance = Math.hypot(pose.x - eye.x, pose.y - eye.y, pose.z - eye.z);
    scored.push({ pose, score: pose.self ? -Infinity : previous.has(pose.id) ? distance * KEEP_FACTOR - KEEP_MARGIN_M : distance });
  }
  scored.sort((a, b) => a.score - b.score || (a.pose.id < b.pose.id ? -1 : a.pose.id > b.pose.id ? 1 : 0));
  const count = Math.max(0, Math.floor(limit));
  return { full: scored.slice(0, count).map(item => item.pose), simple: scored.slice(count).map(item => item.pose) };
}

export interface BlendedWalker<T> { readonly pose: T; readonly opacity: number }

/** The split with memory and a crossfade. One per renderer of walkers. */
export function createWalkerSplit(limit = FULL_WALKER_LIMIT) {
  let fullIds: ReadonlySet<string> = new Set();
  const blend = new Map<string, number>();
  let lastNow: number | undefined;
  return {
    split<T extends WalkerPoint>(poses: readonly T[], eye: Eye, now = performance.now()): { full: BlendedWalker<T>[]; simple: BlendedWalker<T>[] } {
      const dt = lastNow === undefined ? 0 : Math.max(0, Math.min(100, now - lastNow));
      lastNow = now;
      const result = nearestWalkers(poses, eye, limit, fullIds);
      fullIds = new Set(result.full.map(pose => pose.id));
      const full: BlendedWalker<T>[] = [], simple: BlendedWalker<T>[] = [], seen = new Set<string>();
      for (const pose of [...result.full, ...result.simple]) {
        seen.add(pose.id);
        const target = fullIds.has(pose.id) ? 1 : 0;
        const previous = blend.get(pose.id);
        // A walker seen for the first time takes their level at once; only a change of level crossfades.
        const value = previous === undefined || previous === target ? target : target > previous ? Math.min(1, previous + dt / WALKER_DETAIL_BLEND_MS) : Math.max(0, previous - dt / WALKER_DETAIL_BLEND_MS);
        blend.set(pose.id, value);
        const eased = value * value * (3 - 2 * value);
        if (value > 0) full.push({ pose, opacity: eased });
        if (value < 1) simple.push({ pose, opacity: 1 - eased });
      }
      for (const id of blend.keys()) if (!seen.has(id)) blend.delete(id);
      return { full, simple };
    },
    get fullIds() { return fullIds; },
    clear() { fullIds = new Set(); blend.clear(); lastNow = undefined; },
  };
}

export interface WalkerFigure {
  readonly id: string;
  /** Soles on the ground, as for the full citizens. */
  readonly position: readonly [number, number, number];
  readonly heading: number;
  /** Metres travelled, driving the stride. */
  readonly distance: number;
  readonly speed: number;
  readonly opacity?: number;
}

/** Top of the simple figure's head above its soles, for name and bubble anchors. */
export const FIGURE_HEAD_TOP_M = 1.84;
const HIP_M = .78, SHOULDER_M = 1.32;
/** Muted dyes, the same family as the wardrobe's everyday tunics. */
const TINTS = ['#7d5a4a', '#5d6b55', '#566577', '#7a6a4a', '#6b5470', '#7f6d5d', '#4f6a6a', '#8a6a52', '#6a5a66', '#5f5a48'];
const linear = (hex: string) => new THREE.Color(hex);

type Box = { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number]; readonly paint: string; readonly limb: number; readonly tint: number };
/** Limbs: 1 left leg, 2 right leg, 3 left arm, 4 right arm, 0 still. */
const FIGURE: readonly Box[] = [
  { min: [-.2, .12, -.1], max: [-.02, HIP_M, .1], paint: '#4a3f36', limb: 1, tint: 0 },
  { min: [.02, .12, -.1], max: [.2, HIP_M, .1], paint: '#4a3f36', limb: 2, tint: 0 },
  { min: [-.21, 0, -.11], max: [-.01, .12, .15], paint: '#2e2620', limb: 1, tint: 0 },
  { min: [.01, 0, -.11], max: [.21, .12, .15], paint: '#2e2620', limb: 2, tint: 0 },
  { min: [-.25, HIP_M - .04, -.14], max: [.25, 1.37, .14], paint: '#e4dccd', limb: 0, tint: 1 },
  { min: [-.25, HIP_M - .02, -.145], max: [.25, HIP_M + .06, .145], paint: '#5a4330', limb: 0, tint: 0 },
  { min: [-.36, .86, -.08], max: [-.25, SHOULDER_M + .03, .08], paint: '#e4dccd', limb: 3, tint: 1 },
  { min: [.25, .86, -.08], max: [.36, SHOULDER_M + .03, .08], paint: '#e4dccd', limb: 4, tint: 1 },
  { min: [-.355, .76, -.07], max: [-.255, .86, .07], paint: '#b9917a', limb: 3, tint: 0 },
  { min: [.255, .76, -.07], max: [.355, .86, .07], paint: '#b9917a', limb: 4, tint: 0 },
  { min: [-.21, 1.37, -.2], max: [.21, 1.78, .2], paint: '#b9917a', limb: 0, tint: 0 },
  { min: [-.225, 1.66, -.215], max: [.225, FIGURE_HEAD_TOP_M, .205], paint: '#3d2f26', limb: 0, tint: 0 },
  { min: [-.225, 1.42, -.215], max: [.225, 1.66, -.12], paint: '#3d2f26', limb: 0, tint: 0 },
];

/** Box-built figure geometry with the attributes the citizens' paint material reads, plus limb and tint masks. */
export function walkerFigureGeometry(): THREE.BufferGeometry {
  const position: number[] = [], normal: number[] = [], paint: number[] = [], occlusion: number[] = [], faceUv: number[] = [];
  const edges: number[] = [], tangentU: number[] = [], tangentV: number[] = [], alpha: number[] = [], limb: number[] = [], tint: number[] = [], index: number[] = [];
  const faces: readonly { n: [number, number, number]; u: [number, number, number]; v: [number, number, number] }[] = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  for (const box of FIGURE) {
    const colour = linear(box.paint);
    const centre = box.min.map((value, axis) => (value + box.max[axis]!) / 2), half = box.min.map((value, axis) => (box.max[axis]! - value) / 2);
    for (const face of faces) {
      const base = position.length / 3;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        for (let axis = 0; axis < 3; axis++) position.push(centre[axis]! + (face.n[axis]! + face.u[axis]! * su + face.v[axis]! * sv) * half[axis]!);
        normal.push(...face.n); tangentU.push(...face.u); tangentV.push(...face.v);
        paint.push(colour.r, colour.g, colour.b);
        // Undersides sit in their own shade; a soft gradient keeps the block from reading as a flat cut-out.
        occlusion.push(face.n[1] < 0 ? .62 : face.n[1] > 0 ? 1 : sv < 0 ? .84 : 1);
        faceUv.push((su + 1) / 2, (sv + 1) / 2); edges.push(0, 0, 0, 0); alpha.push(1); limb.push(box.limb); tint.push(box.tint);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 3));
  geometry.setAttribute('aOcclusion', new THREE.Float32BufferAttribute(occlusion, 1));
  geometry.setAttribute('aFaceUv', new THREE.Float32BufferAttribute(faceUv, 2));
  geometry.setAttribute('aEdges', new THREE.Float32BufferAttribute(edges, 4));
  geometry.setAttribute('aTangentU', new THREE.Float32BufferAttribute(tangentU, 3));
  geometry.setAttribute('aTangentV', new THREE.Float32BufferAttribute(tangentV, 3));
  geometry.setAttribute('aPaintAlpha', new THREE.Float32BufferAttribute(alpha, 1));
  geometry.setAttribute('aLimb', new THREE.Float32BufferAttribute(limb, 1));
  geometry.setAttribute('aTintMask', new THREE.Float32BufferAttribute(tint, 1));
  geometry.setIndex(index);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** The citizens' paint vertex stage, with a swinging stride for the limbs and a per-person tunic dye. */
const FIGURE_VERTEX = /* glsl */ `
  in vec3 aPaint, aTangentU, aTangentV, aTint;
  in float aOcclusion, aPaintAlpha, aLodFade, aLimb, aTintMask;
  in vec2 aFaceUv, aGait; in vec4 aEdges;
  out vec3 vWorld, vNormal, vPaint, vTangentU, vTangentV;
  out float vAo, vSky, vLodFade, vPaintAlpha;
  out vec2 vFaceUv; out vec4 vEdges;
  mat3 swingX(float a){float c=cos(a),s=sin(a);return mat3(1.,0.,0.,0.,c,s,0.,-s,c);}
  void main() {
    float swing=sin(aGait.x)*aGait.y;
    float angle=aLimb<.5?0.:aLimb<1.5?swing:aLimb<2.5?-swing:aLimb<3.5?-swing*.8:swing*.8;
    vec3 pivot=vec3(0.,aLimb<2.5?${HIP_M.toFixed(2)}:${SHOULDER_M.toFixed(2)},0.);
    mat3 limb=swingX(angle);
    vec3 p=position,n=normal,tu=aTangentU,tv=aTangentV;
    if(aLimb>.5){p=limb*(p-pivot)+pivot;n=limb*n;tu=limb*tu;tv=limb*tv;}
    // The body lifts a little at each passing step and rests level when standing.
    p.y+=abs(cos(aGait.x))*aGait.y*.05;
    mat4 transform=modelMatrix*instanceMatrix;
    vec4 world=transform*vec4(p,1.);
    vWorld=world.xyz;vNormal=normalize(mat3(transform)*n);
    vTangentU=normalize(mat3(transform)*tu);vTangentV=normalize(mat3(transform)*tv);
    vPaint=aPaint*mix(vec3(1.),aTint,aTintMask);vPaintAlpha=aPaintAlpha;vLodFade=aLodFade;
    vAo=aOcclusion;vSky=1.;vFaceUv=aFaceUv;vEdges=aEdges;
    gl_Position=projectionMatrix*viewMatrix*world;
  }
`;

/** The fragment inputs the vertex stage above must feed; checked so a change to the paint material fails loudly. */
export const FIGURE_VARYINGS = ['vWorld', 'vNormal', 'vPaint', 'vTangentU', 'vTangentV', 'vAo', 'vSky', 'vLodFade', 'vPaintAlpha', 'vFaceUv', 'vEdges'] as const;

export function createWalkerFigureMaterial(lighting: VoxelRenderState): THREE.ShaderMaterial {
  const material = createStyledCitizenMaterial(lighting, 'solid');
  for (const name of FIGURE_VARYINGS) if (!new RegExp(`\\b${name}\\b`).test(material.fragmentShader)) throw new Error(`Citizen paint shader no longer reads ${name}.`);
  material.vertexShader = FIGURE_VERTEX;
  material.name = 'Simple walker figure';
  material.needsUpdate = true;
  return material;
}

const STRIDE_M = 1.5, SWING_RAD = .5, OPACITY_RATE_MS = 120, FADE_OUT_MS = 250;
const hash = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };

/** One draw call for every simple figure. Opacity eases toward what the caller asks; figures that leave fade out. */
export function createWalkerFigures(scene: THREE.Object3D, lighting: VoxelRenderState, initialCapacity = 256) {
  const geometry = walkerFigureGeometry();
  const material = createWalkerFigureMaterial(lighting);
  const tints = TINTS.map(linear);
  let capacity = 0, mesh: THREE.InstancedMesh | undefined;
  let fades!: THREE.InstancedBufferAttribute, tintAttribute!: THREE.InstancedBufferAttribute, gait!: THREE.InstancedBufferAttribute;
  const allocate = (size: number) => {
    if (mesh) { scene.remove(mesh); mesh.dispose(); }
    capacity = size;
    fades = new THREE.InstancedBufferAttribute(new Float32Array(size), 1); fades.setUsage(THREE.DynamicDrawUsage);
    tintAttribute = new THREE.InstancedBufferAttribute(new Float32Array(size * 3), 3); tintAttribute.setUsage(THREE.DynamicDrawUsage);
    gait = new THREE.InstancedBufferAttribute(new Float32Array(size * 2), 2); gait.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aLodFade', fades); geometry.setAttribute('aTint', tintAttribute); geometry.setAttribute('aGait', gait);
    mesh = new THREE.InstancedMesh(geometry, material, size);
    mesh.name = 'walker-figures'; mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
  };
  allocate(Math.max(16, Math.floor(initialCapacity)));
  const shown = new Map<string, { figure: WalkerFigure; opacity: number; lastSeen: number }>();
  const heads = new Map<string, THREE.Vector3>();
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3(), unit = new THREE.Vector3(1, 1, 1);
  let lastNow: number | undefined;
  return {
    /** Name and bubble anchors for figures that are visible this frame. */
    get heads(): ReadonlyMap<string, THREE.Vector3> { return heads; },
    get count() { return mesh?.count ?? 0; },
    get mesh() { return mesh; },
    update(figures: readonly WalkerFigure[], now = performance.now()) {
      const dt = lastNow === undefined ? 0 : Math.max(0, Math.min(100, now - lastNow));
      lastNow = now;
      for (const figure of figures) {
        if (![...figure.position, figure.heading, figure.distance, figure.speed].every(Number.isFinite)) continue;
        const entry = shown.get(figure.id);
        if (entry) { entry.figure = figure; entry.lastSeen = now; } else shown.set(figure.id, { figure, opacity: 0, lastSeen: now });
      }
      heads.clear();
      if (shown.size > capacity) { let size = capacity; while (size < shown.size) size *= 2; allocate(size); }
      let count = 0;
      for (const [id, entry] of shown) {
        const present = entry.lastSeen === now;
        const target = present ? Math.max(0, Math.min(1, entry.figure.opacity ?? 1)) : 0;
        const rate = dt / (present ? OPACITY_RATE_MS : FADE_OUT_MS);
        entry.opacity = target > entry.opacity ? Math.min(target, entry.opacity + rate) : Math.max(target, entry.opacity - rate);
        if (!present && entry.opacity <= 0) { shown.delete(id); continue; }
        if (entry.opacity <= 0) continue;
        const { position, heading, distance, speed } = entry.figure;
        rotation.setFromAxisAngle(up, heading);
        matrix.compose(at.set(position[0], position[1], position[2]), rotation, unit);
        mesh!.setMatrixAt(count, matrix);
        fades.setX(count, entry.opacity);
        const colour = tints[hash(id) % tints.length]!;
        tintAttribute.setXYZ(count, colour.r, colour.g, colour.b);
        gait.setXY(count, distance / STRIDE_M * Math.PI * 2, Math.min(1, Math.max(0, speed / 1.2)) * SWING_RAD);
        if (present) heads.set(id, new THREE.Vector3(position[0], position[1] + FIGURE_HEAD_TOP_M + .08, position[2]));
        count++;
      }
      mesh!.count = count;
      mesh!.instanceMatrix.needsUpdate = true; fades.needsUpdate = true; tintAttribute.needsUpdate = true; gait.needsUpdate = true;
    },
    clear() { shown.clear(); heads.clear(); if (mesh) mesh.count = 0; lastNow = undefined; },
    dispose() { shown.clear(); heads.clear(); if (mesh) { scene.remove(mesh); mesh.dispose(); } geometry.dispose(); material.dispose(); },
  };
}
