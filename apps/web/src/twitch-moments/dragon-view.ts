import * as THREE from 'three';
import { MAT, MATERIALS } from '@chatdom/content';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { CELL } from './banner';
import {
  DRAGON_LOOKS, HEAD_CELLS, JAW_CELLS, LEG_CELLS, NECK_CELLS, TAIL_CELLS, TORSO_CELLS, WING_CELLS, dragonBlueprints, dragonParts, mirrorCell, type DragonLook,
} from './dragon-art';
import { DRAGON_BEAT, hash01, type DragonForm, type DragonFrame, type SpectacleLayer, type SpectacleLayerHost } from './spectacle';

/** Bounded effect pools: breath embers, smoke from the nostrils, the dust ring of a takeoff or landing. */
export const DRAGON_LIMITS = { embers: 300, smoke: 48, dust: 120 } as const;

const UP = new THREE.Vector3(0, 1, 0);
const cells = (x: number, y: number, z: number) => new THREE.Vector3(x * CELL, y * CELL, z * CELL);
const rel = (c: Vec3, pivot: Vec3) => cells(c[0] - pivot[0], c[1] - pivot[1], c[2] - pivot[2]);
const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, w: number) => a + (b - a) * w;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const TAU = Math.PI * 2;
const palette = (id: number) => new THREE.Color(MATERIALS.materials.find(m => m.id === id)?.colour ?? '#808080');

// ---------------------------------------------------------------- timing

type Ease = 'io' | 'c2' | 'in' | 'out' | 'back' | 'lin';
const EASE: Record<Ease, (u: number) => number> = {
  io: u => u * u * (3 - 2 * u), in: u => u * u * u,
  /** Smoother step: no jolt at either end, for paths whose heading follows their motion. */
  c2: u => u * u * u * (u * (6 * u - 15) + 10), out: u => 1 - (1 - u) ** 3, lin: u => u,
  /** Overshoots by about a tenth and settles back: the toy's snap. */
  back: u => 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2,
};
/** Keyframes [ms, value, ease into this key]; held before the first key and after the last. */
type Key = readonly [number, number, Ease?];
function curve(t: number, keys: readonly Key[]): number {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, ease = 'io'] = keys[i]!;
    if (t < t1) { const [t0, v0] = keys[i - 1]!; return v0 + (v1 - v0) * EASE[ease]((t - t0) / (t1 - t0)); }
  }
  return keys.at(-1)![1];
}
const ramp = (t: number, a: number, b: number) => EASE.io(clamp((t - a) / (b - a), 0, 1));
/** Cubic Hermite timing from 0 to 1 with start slope m0 and a soft stop: speed matched on the way in, eased to rest. */
const arrive = (u: number, m0: number) => { const k = clamp(u, 0, 1); return (k ** 3 - 2 * k * k + k) * m0 + 3 * k * k - 2 * k ** 3; };

// ---------------------------------------------------------------- the body's pose

/**
 * The rig's pose as a handful of readable numbers. Angles are radians; positive lifts up, curls to the dragon's
 * left (+x) and sweeps back. Poses blend linearly, and weights past 0..1 extrapolate, which is how anticipation
 * and overshoot ride on the same keys.
 */
interface Body {
  /** 0 standing, 1 lying on its belly. */ crouch: number;
  /** 0 legs on the ground, 1 folded for flight. */ tuck: number;
  /** Legs reaching forward and down to land. */ reach: number;
  /** Torso pitched nose-up about the hind hips on the ground; added to the flight pitch in the air. */ rear: number;
  neck: number; curl: number; head: number; jaw: number; jerk: number;
  /** 0 wings folded, 1 open; lift, sweep, bend (the hand folding back in its plane) and flex apply when open. */
  spread: number; lift: number; sweep: number; bend: number; flex: number;
  tail: number; tailCurl: number; sway: number;
  eyes: number; throat: number;
}
const STAND: Body = {
  crouch: 0, tuck: 0, reach: 0, rear: 0, neck: 0, curl: 0, head: -0.1, jaw: 0, jerk: 0,
  spread: 0, lift: 0, sweep: 0, bend: 0, flex: 0, tail: 0, tailCurl: 0, sway: 0.06, eyes: 1, throat: 0,
};
const CURLED: Body = { ...STAND, crouch: 1, neck: -0.12, curl: 0.38, head: -0.18, tail: 0, tailCurl: 0.34, sway: 0.02, eyes: 0 };
const FLYING: Body = { ...STAND, tuck: 1, spread: 1, sweep: 0.06, bend: 0.05, neck: -0.06, head: -0.06, sway: 0.14 };
const BODY_KEYS = Object.keys(STAND) as (keyof Body)[];
const mix = (a: Body, b: Partial<Body>, w: number): Body => {
  const out = { ...a };
  if (w === 0) return out;
  for (const k of BODY_KEYS) { const v = b[k]; if (v !== undefined) out[k] = a[k] + (v - a[k]) * w; }
  return out;
};
/**
 * Folded wings. The inner membrane is hinged along the flank, so a rigid fold keeps that hinge: the arm stands
 * nearly upright beside the back with the wrist peaked over the shoulder, and the hand folds back down its trailing
 * edge, lying just outside the inner membrane.
 */
const FOLD = { lift: 1.25, sweep: 0.05, bend: 2.3, flex: 0, offset: 1.2 } as const;
/** Per-segment shape of the neck: its resting S (relaxed in flight), how a lift spreads along it, and a jerk. */
const NECK_BASE = [0.3, 0.12, -0.12, -0.28], NECK_SHAPE = [1, 0.8, 0.45, 0.15], NECK_JERK = [0.2, 0.3, 0.3, 0.2];
/** The tail's droop when standing, and how it lies along the ground when the dragon is down. */
const TAIL_DROOP = [-0.22, -0.14, -0.05, 0.04, 0.08, 0.1], TAIL_DOWN = [-0.7, 0.58, 0.12, 0.05, 0.03, 0.02];

/** One wingbeat at clock t: lift, the hand's lagging flex, and the body's answering bob in cells. */
function beat(t: number, period: number, amp: number, glide = 0) {
  const c = ((t / period) % 1 + 1) % 1, u = Math.min(1, c / (1 - glide)), w = Math.sin(u * TAU);
  // The downstroke is the power stroke: deeper than the recovery.
  return { lift: amp * (w > 0 ? 0.8 * w : 1.05 * w) + 0.1 * amp, flex: -0.5 * amp * Math.cos(u * TAU), bob: -w * amp * 1.6 };
}
const flap = (b: Body, f: { lift: number; flex: number }, w = 1): Body => mix(b, { lift: f.lift, flex: f.flex }, w);
/** The landing flare: rear up, wings forward and beating back, legs reaching for the ground. */
const FLARE: Partial<Body> = { sweep: -0.25, rear: 0.45, tuck: 0, reach: 0.5, head: -0.1 };

// ---------------------------------------------------------------- places and paths

interface Lair { readonly at: THREE.Vector3; readonly facing: THREE.Vector3; readonly yaw: number }
/**
 * The town's sky as the dragon flies it: the hub it circles (the castle's crown when supplied, else the town's middle),
 * the ring's radius, the circling height `alt` (absolute) and `lift` (its height over the hub, which scales its climbs
 * and dives), and the dive's `floor`, clear of the roofs and the keep.
 */
interface Sky { readonly centre: THREE.Vector3; readonly hub: THREE.Vector3; readonly ring: number; readonly alt: number; readonly lift: number; readonly floor: number }
interface Puff { readonly t: number; readonly seed: number }
interface Pose {
  readonly at: THREE.Vector3; readonly yaw: number; readonly pitch: number; readonly roll: number; readonly body: Body;
  /** Clock for the tail and the breathing. */ readonly clock: number; readonly breath: number;
  readonly smoke: Puff | null; readonly dust: Puff | null; readonly embers: number | null;
}

type Path = (t: number) => THREE.Vector3;
/** Sample a flight path at t: heading and climb from its neighbours, bank from the turn rate (a coordinated turn). */
function fly(path: Path, t: number, fallbackYaw: number) {
  const dt = 140, a = path(t - dt), p = path(t), b = path(t + dt), v = b.clone().sub(a), flat = Math.hypot(v.x, v.z);
  if (flat < 1e-3) return { at: p, yaw: fallbackYaw, pitch: 0, roll: 0 };
  // Turn rate from the heading change between neighbouring chords; at a path's ends, from the chords beside them.
  const heading = (u: THREE.Vector3, w: THREE.Vector3) => (Math.hypot(w.x - u.x, w.z - u.z) > 1e-3 ? Math.atan2(w.x - u.x, w.z - u.z) : null);
  let h0 = heading(a, p), h1 = heading(p, b);
  if (h0 === null && h1 !== null) { h0 = h1; h1 = heading(b, path(t + 2 * dt)); }
  else if (h1 === null && h0 !== null) { h1 = h0; h0 = heading(path(t - 2 * dt), a); }
  const turn = h0 !== null && h1 !== null ? wrap(h1 - h0) / (dt / 1000) : 0;
  const speed = flat / (2 * dt / 1000);
  return { at: p, yaw: Math.atan2(v.x, v.z), pitch: clamp(Math.atan2(v.y, flat), -0.7, 0.7), roll: -clamp(Math.atan(speed * turn / 9.8), -0.75, 0.75) };
}
const bezier = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, s: number) => {
  const k = 1 - s;
  return p0.clone().multiplyScalar(k * k * k).addScaledVector(p1, 3 * k * k * s).addScaledVector(p2, 3 * k * s * s).addScaledVector(p3, s * s * s);
};

const A = DRAGON_BEAT.active, ORBIT_RAMP = 5000, OMEGA = TAU / A.orbitMs;
/** Circling the castle: the ring's least radius (m), its height over the crown per metre of radius, clamped (m). */
const ORBIT = { min: 55, rise: 0.5, over: [28, 52] as const } as const;
/** Orbit clock with a gentle start, so the dragon leaves its hover over the town and leans into the circle. */
const soft = (e: number) => (e <= 0 ? 0 : e < ORBIT_RAMP ? e * e / (2 * ORBIT_RAMP) : e - ORBIT_RAMP / 2);
/** Swoop and breath offsets along the orbit: lift (share of the ceiling), dive (share of the way to the floor), radius and surge. */
function attackOffset(kind: 'swoop' | 'breath', t: number) {
  if (kind === 'swoop') {
    const w = A.swoop.windup, low = w + A.swoop.strike * 0.4, end = w + A.swoop.strike;
    return {
      lift: curve(t, [[0, 0], [w - 200, 0.06, 'c2'], [w + 200, 0, 'c2']]), dive: curve(t, [[w, 0], [low, 1, 'c2'], [end, 0, 'c2']]),
      radius: curve(t, [[w, 0], [low, -0.2, 'c2'], [end, 0, 'c2']]), surge: curve(t, [[0, 0], [w, -0.03, 'c2'], [low, 0.04, 'c2'], [end, 0, 'c2']]),
    };
  }
  const w = A.breath.windup, end = w + A.breath.strike;
  return {
    lift: curve(t, [[0, 0], [w - 200, 0.04, 'c2'], [w, 0.04], [w + 1000, -0.05, 'c2'], [end, 0, 'c2']]), dive: 0,
    radius: curve(t, [[w, 0], [w + 1000, -0.1, 'c2'], [end, 0, 'c2']]), surge: curve(t, [[0, 0], [w, -0.03, 'c2'], [end, 0, 'c2']]),
  };
}

// ---------------------------------------------------------------- the town's light

/** What the dragon does to the town's light: the colour and strength of its fire on the roofs, and the dusk drawn down. */
export interface DragonGlow { readonly colour: readonly [number, number, number]; readonly strength: number; readonly night: number }
const NO_GLOW: DragonGlow = { colour: [0, 0, 0], strength: 0, night: 0 };
/** How far the dusk is drawn down while the dragon is abroad (the town's lamps then read brighter), and its fire's reach. */
export const DRAGON_LIGHT = { waking: 0.3, abroad: 0.22, fire: 0.5, eyes: 0.08 } as const;

/**
 * The town under the dragon. As it wakes the dusk is drawn down (the lamps hold, the roofs go cold); while it is
 * abroad the town stays a shade darker; its breath washes the roofs in its fire, in proportion to the embers in the
 * air; at a fall or a homecoming the dusk returns. Pure in the frame, the pose and the drawn embers.
 */
function dragonGlow(frame: DragonFrame, p: { readonly body: { readonly eyes: number; readonly throat: number } }, look: DragonLook, embers: number): DragonGlow {
  const S = DRAGON_BEAT.summoning, V = DRAGON_BEAT.victory, R = DRAGON_BEAT.retreat;
  const night = frame.phase === 'stir' ? 0
    : frame.phase === 'summoning' ? lerp(DRAGON_LIGHT.waking * ramp(frame.t, 0, S.roar), DRAGON_LIGHT.abroad, ramp(frame.t, S.climb[0], S.climb[1]))
      : frame.phase === 'active' ? DRAGON_LIGHT.abroad
        : frame.phase === 'victory' ? DRAGON_LIGHT.abroad * (1 - ramp(frame.t, V.land, V.bow[1] + 1200))
          : DRAGON_LIGHT.abroad * (1 - ramp(frame.t, R.away[0], R.settle[1]));
  const fire = DRAGON_LIGHT.fire * Math.min(1, embers / (DRAGON_LIMITS.embers * 0.45)) + DRAGON_LIGHT.fire * 0.35 * clamp(p.body.throat, 0, 1);
  const eyes = DRAGON_LIGHT.eyes * clamp(p.body.eyes - 1, 0, 0.6) / 0.6;
  const strength = clamp(fire + eyes, 0, 0.6);
  const hot = new THREE.Color(look.embers[1] ?? look.eye);
  return { colour: strength > 0 ? [hot.r, hot.g, hot.b] : [0, 0, 0], strength, night };
}

// ---------------------------------------------------------------- the rig

interface Wing { readonly side: 1 | -1; readonly inner: THREE.Group; readonly outer: THREE.Group; readonly wrist: THREE.Vector3 }
interface Rig {
  readonly form: DragonForm; readonly look: DragonLook; readonly root: THREE.Group; readonly torso: THREE.Mesh;
  readonly neck: THREE.Group[]; readonly head: THREE.Group; readonly jaw: THREE.Group; readonly tail: THREE.Group[];
  readonly legs: { readonly fore: boolean; readonly upper: THREE.Group; readonly lower: THREE.Group }[]; readonly wings: Wing[];
  readonly eyes: THREE.Mesh[]; readonly halos: THREE.Mesh[]; readonly throat: THREE.Mesh[];
  readonly mouth: THREE.Object3D; readonly nostrils: THREE.Object3D; readonly centre: THREE.Object3D;
  readonly materials: { readonly eye: THREE.MeshBasicMaterial; readonly halo: THREE.MeshBasicMaterial; readonly throat: THREE.MeshBasicMaterial };
  readonly parts: number;
}

/**
 * The earned dragon: one authored rig at a time, posed as a pure function of the frame (phase, its clock, the
 * encounter clock, telegraph, flinch and health) and the supplied lair and sky. Nothing is guessed: without the
 * places a phase needs, the dragon is not shown. Breath embers, smoke and dust are bounded instanced cubes.
 */
export function createDragonLayer(root: THREE.Group, host: SpectacleLayerHost): SpectacleLayer<DragonFrame | null> & { focus(): THREE.Vector3 | null; head(): THREE.Vector3 | null; glow(): DragonGlow } {
  const layer = new THREE.Group();
  layer.name = 'dragon';
  root.add(layer);
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const emberMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const smokeMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x1a1816 });
  const dustMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x1c1914 });
  const pool = (material: THREE.Material, count: number, name: string) => {
    const mesh = new THREE.InstancedMesh(unit, material, count);
    mesh.name = name; mesh.frustumCulled = false; mesh.count = 0;
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    layer.add(mesh);
    return mesh;
  };
  const embers = pool(emberMaterial, DRAGON_LIMITS.embers, 'dragon-embers'), smoke = pool(smokeMaterial, DRAGON_LIMITS.smoke, 'dragon-smoke'), dust = pool(dustMaterial, DRAGON_LIMITS.dust, 'dragon-dust');
  const SMOKE = [MAT.stone, MAT.limestone, MAT.plaster].map(palette), DUST = [MAT.earth, MAT.limestone, MAT.thatch, MAT.paving].map(palette);
  let rig: Rig | null = null, focus: THREE.Vector3 | null = null, headAt: THREE.Vector3 | null = null, lastGlow: DragonGlow = NO_GLOW;

  function build(form: DragonForm): Rig {
    const p = dragonParts(form, host.kit), look = p.look, group = new THREE.Group();
    group.name = `dragon-${form}`;
    let parts = 0;
    const part = (parent: THREE.Object3D, blueprint: VoxelBlueprint, at: THREE.Vector3, pivot: Vec3) => {
      const joint = new THREE.Group(), mesh = host.mesh(blueprint, cells(-pivot[0], -pivot[1], -pivot[2]));
      joint.position.copy(at); joint.add(mesh); parent.add(joint); parts++;
      return { joint, mesh };
    };
    const T = TORSO_CELLS, torso = part(group, p.torso, new THREE.Vector3(), T.pivot);
    const neck: THREE.Group[] = [];
    let parent: THREE.Object3D = torso.joint, at = rel(T.neck, T.pivot);
    for (const bp of p.neck) { const n = part(parent, bp, at, NECK_CELLS.pivot); neck.push(n.joint); parent = n.joint; at = rel(NECK_CELLS.next, NECK_CELLS.pivot); }
    const head = part(parent, p.head, at, HEAD_CELLS.pivot).joint;
    const jaw = part(head, p.jaw, rel(HEAD_CELLS.jaw, HEAD_CELLS.pivot), JAW_CELLS.pivot).joint;
    const tail: THREE.Group[] = [];
    parent = torso.joint; at = rel(T.tail, T.pivot);
    p.tail.forEach((bp, i) => {
      const t = part(parent, bp, at, i === p.tail.length - 1 ? TAIL_CELLS.tip.pivot : TAIL_CELLS.pivot);
      tail.push(t.joint); parent = t.joint; at = rel(TAIL_CELLS.next, TAIL_CELLS.pivot);
    });
    const legs: Rig['legs'][number][] = [];
    for (const [fore, hips] of [[true, T.fore], [false, T.hind]] as const) for (const hip of hips) {
      const spec = LEG_CELLS[fore ? 'fore' : 'hind'], bps = fore ? p.fore : p.hind;
      const upper = part(torso.joint, bps.upper, rel(hip, T.pivot), spec.upper.pivot).joint;
      legs.push({ fore, upper, lower: part(upper, bps.lower, rel(spec.upper.knee, spec.upper.pivot), spec.lower.pivot).joint });
    }
    const wings = (['left', 'right'] as const).map((side, i): Wing => {
      const W = WING_CELLS, m = (c: Vec3, width: number) => (side === 'left' ? c : mirrorCell(c, width));
      const innerPivot = m(W.inner.pivot, W.inner.size[0]), outerPivot = m(W.outer.pivot, W.outer.size[0]);
      const inner = part(torso.joint, p.wings[side].inner, rel(T.shoulders[i]!, T.pivot), innerPivot).joint;
      const wrist = rel(m(W.inner.wrist, W.inner.size[0]), innerPivot);
      return { side: side === 'left' ? 1 : -1, inner, outer: part(inner, p.wings[side].outer, wrist, outerPivot).joint, wrist };
    });
    // Glow: the eyes and a soft halo round them; throat seams under the neck and chest; the maw behind the teeth.
    const glow = (colour: number, additive: boolean) => new THREE.MeshBasicMaterial({
      color: colour, transparent: true, toneMapped: false, depthWrite: !additive, ...(additive ? { blending: THREE.AdditiveBlending } : {}),
    });
    const materials = { eye: glow(look.eye, false), halo: glow(look.eye, true), throat: glow(look.embers[2]!, true) };
    const box = (parent: THREE.Object3D, material: THREE.Material, at: THREE.Vector3, size: Vec3) => {
      const mesh = new THREE.Mesh(unit, material);
      mesh.position.copy(at); mesh.scale.copy(cells(size[0], size[1], size[2])); mesh.frustumCulled = false;
      parent.add(mesh);
      return mesh;
    };
    const eyes = HEAD_CELLS.eyes.map(c => box(head, materials.eye, rel(c, HEAD_CELLS.pivot), [1.05, 1.05, 2.1]));
    const halos = HEAD_CELLS.eyes.map(c => box(head, materials.halo, rel(c, HEAD_CELLS.pivot), [2.4, 2.1, 3.2]));
    const throat = neck.map((joint, i) => {
      const r = NECK_CELLS.radius[i]!;
      return box(joint, materials.throat, rel([5, 5 - r - 0.15, 4.5], NECK_CELLS.pivot), [r * 1.2, 0.7, 6.4]);
    });
    throat.push(box(torso.joint, materials.throat, rel([8, 1.2, 22], T.pivot), [6, 0.8, 9]));
    throat.push(box(head, materials.throat, rel(HEAD_CELLS.maw.centre, HEAD_CELLS.pivot), HEAD_CELLS.maw.size));
    const anchor = (c: Vec3) => { const o = new THREE.Object3D(); o.position.copy(rel(c, HEAD_CELLS.pivot)); head.add(o); return o; };
    layer.add(group);
    return {
      form, look, root: group, torso: torso.mesh, neck, head, jaw, tail, legs, wings, eyes, halos, throat, materials, parts,
      mouth: anchor(HEAD_CELLS.mouth), nostrils: anchor(HEAD_CELLS.nostrils), centre: anchor(HEAD_CELLS.centre),
    };
  }

  function drop(): void {
    if (!rig) return;
    layer.remove(rig.root);
    for (const m of Object.values(rig.materials)) m.dispose();
    rig = null;
  }

  // ---------------------------------------------------------------- places

  function places(scale: number): { lair: Lair | null; sky: Sky | null } {
    const l = host.places.lair(), s = host.places.sky(), c = host.places.castle();
    let lair: Lair | null = null, sky: Sky | null = null;
    if (l) {
      const facing = v3(l.facing).setY(0);
      if (facing.lengthSq() < 1e-8) facing.set(0, 0, 1);
      facing.normalize();
      lair = { at: v3(l.position), facing, yaw: Math.atan2(facing.x, facing.z) };
    }
    if (s && s.radius > 0 && s.ceiling > 0) {
      const centre = v3(s.centre);
      if (c) {
        // It circles the castle: near enough that the town looks up at it over its own roofs, high enough to clear the
        // keep with its whole wingspan, and diving to just over the battlements.
        const crown = v3(c.crown), hub = new THREE.Vector3(crown.x, centre.y, crown.z);
        const ring = clamp(0.5 * Math.hypot(crown.x - centre.x, crown.z - centre.z), ORBIT.min, Math.max(ORBIT.min, s.radius * 0.7));
        const alt = crown.y + clamp(ring * ORBIT.rise, ORBIT.over[0], ORBIT.over[1]), floor = crown.y + 24 * CELL * scale;
        sky = { centre, hub, ring, alt, lift: alt - centre.y, floor: Math.min(floor, alt - 6) };
      } else {
        // The dive's floor clears the roofs.
        const alt = centre.y + s.ceiling;
        sky = { centre, hub: centre.clone(), ring: s.radius * 0.7, alt, lift: s.ceiling, floor: Math.min(centre.y + s.ceiling * 0.45, centre.y + s.ceiling * 0.9) };
      }
    }
    return { lair, sky };
  }
  const height = (b: Body, scale: number) => {
    // Rearing pivots on the hind hips (9 cells back, 2 down from the torso pivot), so lift the pivot to keep them up.
    const rear = Math.max(0, b.rear), lift = 9 * Math.sin(rear) - 2 * (1 - Math.cos(rear));
    return (lerp(TORSO_CELLS.stand, TORSO_CELLS.lie, b.crouch) + lift) * CELL * scale;
  };
  const grounded = (lair: Lair, b: Body, scale: number, breath: number) =>
    ({ at: lair.at.clone().addScaledVector(UP, height(b, scale) + breath * 0.25 * CELL * scale), yaw: lair.yaw, pitch: b.rear, roll: 0 });
  /** The orbit point and its unit tangent at encounter clock e, without attacks. */
  function orbitAt(sky: Sky, theta0: number, e: number, health: number, attack: { kind: 'swoop' | 'breath'; start: number } | null = null): THREE.Vector3 {
    const radius = sky.ring, base = sky.alt - sky.lift * 0.1 * (1 - health) + sky.lift * 0.035 * Math.sin(e / 9700 * TAU);
    let theta = theta0 - OMEGA * soft(e), r = radius, y = base;
    if (attack) {
      const o = attackOffset(attack.kind, e - attack.start);
      theta -= o.surge; r += o.radius * radius; y += o.lift * sky.lift - o.dive * Math.max(0, base - sky.floor);
    }
    return new THREE.Vector3(sky.hub.x + r * Math.cos(theta), y, sky.hub.z + r * Math.sin(theta));
  }
  const theta0 = (sky: Sky, lair: Lair) => Math.atan2(lair.at.z - sky.hub.z, lair.at.x - sky.hub.x);
  /** Where the dragon arrives over the town: the orbit point nearest its lair, and the orbit's heading there. */
  const station = (sky: Sky, lair: Lair) => {
    const th = theta0(sky, lair), at = orbitAt(sky, th, 0, 1);
    return { at, tangent: new THREE.Vector3(Math.sin(th), 0, -Math.cos(th)) };
  };
  /**
   * Home from the orbit at encounter clock `end`: a spiral out round the walls along the shorter arc to the lair's
   * bearing. It leaves with the orbit's own motion (turning back through a slow wheel when home lies the other
   * way), keeps its height until it is beyond the roofs, and eases to rest over the lair at `ms`.
   */
  function spiralHome(sky: Sky, lair: Lair, end: number, health: number, ms: number, scale: number): Path {
    const th = theta0(sky, lair), from = orbitAt(sky, th, end, health), c = sky.hub;
    const a0 = Math.atan2(from.z - c.z, from.x - c.x), r0 = Math.hypot(from.x - c.x, from.z - c.z);
    const r1 = Math.hypot(lair.at.x - c.x, lair.at.z - c.z), da = wrap(Math.atan2(lair.at.z - c.z, lair.at.x - c.x) - a0);
    const y1 = lair.at.y + TORSO_CELLS.stand * CELL * scale, orbit = -OMEGA * Math.min(1, end / ORBIT_RAMP);
    const m0 = Math.abs(da) > 1e-3 ? clamp(orbit * ms / da, -1.5, 2.5) : 0;
    return t => {
      if (t < 0) return orbitAt(sky, th, end + t, health);
      const u = clamp(t / ms, 0, 1), a = a0 + da * arrive(u, m0), r = lerp(r0, r1, EASE.c2(u));
      return new THREE.Vector3(c.x + r * Math.cos(a), lerp(from.y, y1, EASE.c2(clamp((u - 0.18) / 0.82, 0, 1))), c.z + r * Math.sin(a));
    };
  }

  // ---------------------------------------------------------------- phases

  function stir(t: number, lair: Lair, scale: number): Pose {
    const B = DRAGON_BEAT.stir;
    const lift = curve(t, [[B.lift[0], 0], [B.lift[0] + 320, -0.15], [B.lift[1], 1, 'back'], [B.settle[0], 1], [B.settle[1], 0]]);
    const snort = curve(t, [[B.breath - 520, 0], [B.breath - 60, 1], [B.breath + 120, -0.8, 'out'], [B.breath + 900, 0]]);
    let b = mix(CURLED, { curl: 0.14, neck: 0.1, head: 0.06 }, lift);
    b = { ...b, head: b.head + 0.07 * snort, jaw: Math.max(0, -snort) * 0.1, sway: 0.02 + 0.22 * ramp(t, 900, 1500) * (1 - ramp(t, 2400, 3200)) };
    b.eyes = curve(t, [[B.lift[0], 0], [B.lift[0] + 800, 0.55], [4150, 0.55], [4300, 0.04], [4460, 0.55], [B.settle[0] + 500, 0.4], [B.settle[1] - 500, 0]]);
    const breath = Math.sin(t / 3600 * TAU);
    return { ...grounded(lair, b, scale, breath), body: b, clock: t, breath, smoke: t >= B.breath ? { t: t - B.breath, seed: 1 } : null, dust: null, embers: null };
  }

  function summoningGround(t: number): Body {
    const S = DRAGON_BEAT.summoning, roar = S.roar;
    const rise = curve(t, [[S.rise[0], 0], [S.rise[1], 1, 'back']]);
    const b = mix(CURLED, STAND, rise);
    b.crouch += curve(t, [[3800, 0], [4250, 0.32], [S.takeoff, 0, 'out']]);
    b.eyes = curve(t, [[S.eyes, 0], [S.eyes + 260, 1.35, 'out'], [S.eyes + 900, 1], [roar - 150, 1], [roar + 80, 1.6, 'out'], [roar + 1000, 1.15]]);
    b.rear = curve(t, [[2300, 0], [2850, 0.55], [roar + 200, 0.62, 'out'], [3900, 0.42], [4250, -0.06], [S.takeoff, 0, 'out']]);
    // Draw back, then the roar thrusts the head out and the jaw snaps open.
    b.head = curve(t, [[S.rise[1], -0.1], [roar - 100, 0.5], [roar + 90, 0.18, 'out'], [3900, 0.1], [S.takeoff, -0.05]]);
    b.neck = curve(t, [[S.rise[1], 0], [roar - 100, 0.26], [roar + 90, 0.06, 'out'], [3900, 0.08], [S.takeoff, 0]]);
    b.jaw = curve(t, [[roar - 120, 0], [roar + 60, 1, 'back'], [3850, 0.9], [4150, 0]]);
    b.spread = curve(t, [[2300, 0], [2950, 1, 'back']]);
    b.lift = curve(t, [[2300, 0], [2950, 0.78, 'back'], [3900, 0.6], [4250, 1.05], [S.takeoff, 1.1, 'out']]);
    b.flex = curve(t, [[2300, 0], [2950, 0.35, 'back'], [4250, 0.2]]);
    b.sweep = curve(t, [[2300, 0], [2950, -0.22], [4250, -0.05]]);
    b.tail = curve(t, [[2300, 0], [roar, 0.14], [S.takeoff, 0.05]]);
    return b;
  }

  function summoning(t: number, lair: Lair, sky: Sky, scale: number): Pose {
    const S = DRAGON_BEAT.summoning, breath = Math.sin(t / 2600 * TAU) * (t < S.roar ? 1 : 0.3);
    const smoke = t >= S.roar - 80 && t < S.roar + 2600 ? { t: t - S.roar + 80, seed: 2 } : null;
    if (t < S.takeoff) { const b = summoningGround(t); return { ...grounded(lair, b, scale, breath), body: b, clock: t, breath, smoke, dust: null, embers: null }; }
    const { at: end, tangent } = station(sky, lair), start = lair.at.clone().addScaledVector(UP, TORSO_CELLS.stand * CELL * scale), span = start.distanceTo(end);
    const p1 = start.clone().addScaledVector(lair.facing, 16 * CELL * scale).addScaledVector(UP, (end.y - start.y) * 0.6);
    const p2 = end.clone().addScaledVector(tangent, -span * 0.38);
    const climb = S.climb[1] - S.takeoff, path: Path = ms => bezier(start, p1, p2, end, EASE.io(clamp((ms - S.takeoff) / climb, 0, 1)));
    const up = t - S.takeoff, hover = t >= S.climb[1];
    // Heavy beats off the ground, easing into the hover's slower rhythm; the first downstroke starts from the raised wings.
    const period = lerp(860, 1150, ramp(up, 0, climb)), wings = beat(up + period * 0.25, period, lerp(1.0, 0.78, ramp(up, 0, climb)));
    let b = flap(mix(FLYING, { tuck: 0.65, neck: 0.04, head: -0.28, rear: 0.14 }, ramp(up, climb - 900, climb + 600)), wings);
    b = mix(b, { tuck: 0 }, 1 - ramp(up, 0, 900));
    b = mix(b, summoningGround(S.takeoff), 1 - ramp(up, 0, 260));
    b.jaw = hover ? Math.max(0, Math.sin((t - S.climb[1]) / 5200 * TAU) - 0.8) * 2 : 0;
    let pose: { at: THREE.Vector3; yaw: number; pitch: number; roll: number };
    if (!hover) {
      // Leave the ground pose level and ease into the climb's attitude; arrive level for the hover.
      pose = fly(path, t, lair.yaw);
      const leave = ramp(up, 0, 700), level = 1 - ramp(up, climb - 700, climb);
      pose.yaw = lair.yaw + wrap(pose.yaw - lair.yaw) * leave; pose.pitch *= leave * level; pose.roll *= leave * level;
    } else {
      const drift = t - S.climb[1];
      pose = { at: end.clone().add(new THREE.Vector3(Math.sin(drift / 2300) * 0.6, 0, Math.cos(drift / 2900) * 0.6 - 0.6).multiplyScalar(scale)), yaw: Math.atan2(tangent.x, tangent.z), pitch: 0, roll: 0 };
    }
    pose.at.addScaledVector(UP, wings.bob * CELL * scale * ramp(up, 0, 600));
    return { ...pose, pitch: pose.pitch + b.rear, body: b, clock: t, breath: 0, smoke, dust: up < 2600 ? { t: up, seed: 3 } : null, embers: null };
  }

  function active(frame: DragonFrame, lair: Lair, sky: Sky, scale: number): Pose {
    const e = frame.elapsed, h = clamp(frame.health, 0, 1), th = theta0(sky, lair), tele = frame.telegraph;
    const attack = tele ? { kind: tele.kind, start: e - tele.t } : null, path: Path = ms => orbitAt(sky, th, ms, h, attack);
    const pose = fly(path, e, lair.yaw);
    // Lower health: the beat labours, with a longer glide in each stroke, and the tail hangs a little.
    const wings = beat(e, 1500, 0.62 + 0.16 * (1 - h), 0.08 + 0.3 * (1 - h));
    let b = flap({ ...FLYING, curl: 0.06, head: -0.14, tail: -0.05 * (1 - h) }, wings), embers: number | null = null;
    if (tele?.kind === 'swoop') {
      const w = A.swoop.windup, low = w + A.swoop.strike * 0.4, end = w + A.swoop.strike, t = tele.t;
      // Windup: it rears back with its wings high and its eyes flaring; the dive tucks the wings; the pull-up flares and beats.
      b = mix(b, { rear: 0.42, lift: 0.95, sweep: -0.2, bend: -0.1, flex: 0.35, neck: 0.18, head: 0.25, jaw: 0.3, eyes: 1.6 }, curve(t, [[0, 0], [450, 1, 'back'], [w, 1], [w + 340, 0]]));
      b = mix(b, { lift: 0.2, sweep: 0.75, bend: 0.55, flex: -0.25, neck: -0.1, head: -0.35, jaw: 0.45, eyes: 1.4, tail: 0.06 }, curve(t, [[w, 0], [w + 340, 1], [low, 1], [low + 350, 0]]));
      b = mix(b, { lift: -0.55, sweep: -0.1, bend: 0, flex: 0.5, neck: 0.05, head: 0.05, rear: 0.25, eyes: 1.2 }, curve(t, [[low, 0], [low + 350, 1], [end - 450, 1], [end, 0]]));
    } else if (tele?.kind === 'breath') {
      const w = A.breath.windup, end = w + A.breath.strike, t = tele.t;
      // Windup: the head draws back and the throat fills with light; the strike opens the jaw on a cone of embers.
      b = mix(b, { lift: 0.4, flex: 0.2, sweep: -0.05, rear: 0.15 }, curve(t, [[0, 0], [700, 1], [w, 1], [w + 500, 0]]));
      b = mix(b, { neck: 0.22, head: 0.3, jaw: 0.15, eyes: 1.35 }, curve(t, [[0, 0], [600, 1, 'out'], [w, 1], [w + 120, 0, 'in']]));
      b = mix(b, { neck: -0.1, head: -0.55, jaw: 1, eyes: 1.5 }, curve(t, [[w, 0], [w + 150, 1, 'back'], [end - 300, 1], [end, 0]]));
      b.throat = curve(t, [[0, 0], [w - 50, 1, 'in'], [end - 300, 1], [end, 0]]) * (0.88 + 0.12 * Math.sin(t / 45));
      if (t >= w + 50 && t < end + 700) embers = t - w - 50;
    }
    if (frame.flinch !== null && frame.flinch >= 0 && frame.flinch < A.flinch) {
      // A struck flinch: the head jerks aside, the wings hitch, the eyes wince; a damped wobble settles it.
      const k = frame.flinch / A.flinch, r = (k < 0.12 ? k / 0.12 : (1 - k) ** 2 * Math.cos((k - 0.12) * 9)), side = hash01(frame.strikes, 7) < 0.5 ? 1 : -1;
      b = { ...b, jerk: b.jerk + 0.35 * r * side, head: b.head + 0.4 * r, neck: b.neck + 0.1 * r, lift: b.lift + 0.4 * r, flex: b.flex - 0.3 * r, eyes: b.eyes * (1 - 0.45 * Math.max(0, r)) };
      pose.roll += 0.16 * r * side;
    }
    pose.at.addScaledVector(UP, wings.bob * CELL * scale);
    return { ...pose, pitch: pose.pitch + b.rear, body: b, clock: e, breath: 0, smoke: null, dust: null, embers };
  }

  /** Victory and retreat share the way home: from the orbit at the fight's end to a landing at the lair. */
  function home(frame: DragonFrame, lair: Lair, sky: Sky, scale: number, won: boolean): Pose {
    const t = frame.t, h = clamp(frame.health, 0, 1), end = Math.max(0, frame.elapsed - t);
    const land = won ? DRAGON_BEAT.victory.land : DRAGON_BEAT.retreat.away[1], path = spiralHome(sky, lair, end, h, land, scale);
    const breath = Math.sin(t / 2400 * TAU);
    let b: Body, pose: { at: THREE.Vector3; yaw: number; pitch: number; roll: number }, dust: Puff | null = null, smoke: Puff | null = null;
    if (won) {
      const V = DRAGON_BEAT.victory;
      b = flap({ ...FLYING, head: -0.2, eyes: 0.85 }, beat(t, 1800, 0.34, 0.35));
      // The reel: wings thrown up and flailing, head thrown back with a cry, the body tumbling a little.
      const flail = beat(t, 640, 0.9);
      b = mix(b, { lift: flail.lift + 0.3, flex: flail.flex + 0.3, head: 0.55, neck: 0.2, jaw: 0.6, rear: 0.45, eyes: curve(t, [[0, 1.6], [V.reel[1], 0.9]]) }, curve(t, [[0, 0], [180, 1, 'out'], [V.reel[1] - 300, 1], [V.reel[1] + 200, 0]]));
      b = mix(flap(b, beat(t, 560, 0.7), ramp(t, V.land - 1700, V.land - 1000)), FLARE, ramp(t, V.land - 1700, V.land - 900));
      if (t >= V.land) {
        // Down: the landing presses it low, it catches its breath with its wings still up, then bows and folds them.
        b = mix(b, { ...STAND, lift: 0.55, flex: 0.2, spread: 1, sweep: -0.1, head: -0.15, neck: -0.04, eyes: 0.85, rear: 0 }, ramp(t, V.land, V.land + 500));
        b.crouch = curve(t, [[V.land, 0], [V.land + 120, 0.38, 'out'], [V.land + 700, 0.06], [V.bow[0], 0]]);
        b = mix(b, { crouch: 0.42, neck: -0.22, head: -0.85, rear: -0.1, spread: 0, tailCurl: 0.22, eyes: 0.5, jaw: 0, sway: 0.03 }, curve(t, [[V.bow[0], 0], [V.bow[1], 1, 'back']]));
        b.eyes *= 1 - 0.9 * curve(t, [[10_400, 0], [10_520, 1], [10_700, 0]]);
        dust = t < V.land + 2600 ? { t: t - V.land, seed: 4 } : null;
      }
    } else {
      const R = DRAGON_BEAT.retreat;
      b = flap({ ...FLYING, head: -0.08 }, beat(t, 1100, 0.75));
      b = mix(b, { neck: 0.26, head: 0.5 }, curve(t, [[R.roar - 420, 0], [R.roar - 80, 1], [R.roar + 90, 0.55, 'out'], [R.roar + 700, 0.5], [R.roar + 1100, 0]]));
      b.jaw = curve(t, [[R.roar - 60, 0], [R.roar + 80, 1, 'back'], [R.roar + 700, 0.9], [R.roar + 1000, 0]]);
      b.eyes = curve(t, [[0, 1], [R.roar, 1.5, 'out'], [R.roar + 1200, 1]]);
      b = mix(flap(b, beat(t, 560, 0.7), ramp(t, land - 1700, land - 1000)), FLARE, ramp(t, land - 1700, land - 900));
      if (t >= land) {
        b = mix(b, { ...STAND, spread: 1, lift: 0.5, rear: 0 }, ramp(t, land, land + 400));
        b.crouch = curve(t, [[land, 0], [land + 120, 0.32, 'out'], [land + 500, 0.05]]);
        b = mix(b, CURLED, curve(t, [[R.settle[0] + 200, 0], [R.settle[1], 1, 'io']]));
        dust = t < land + 2600 ? { t: t - land, seed: 5 } : null;
      }
      smoke = t >= R.roar - 60 && t < R.roar + 2600 ? { t: t - R.roar + 60, seed: 6 } : null;
    }
    if (t < land) {
      const f = fly(path, t, lair.yaw), settle = ramp(t, land - 1400, land - 150);
      // Hovering down over the lair it wheels round to face the town and levels out, so touchdown meets the ground pose.
      f.yaw += wrap(lair.yaw - f.yaw) * settle; f.pitch *= 1 - settle; f.roll *= 1 - settle;
      if (won && t < DRAGON_BEAT.victory.reel[1]) f.roll += 0.45 * Math.sin(t / 170) * (1 - ramp(t, 600, DRAGON_BEAT.victory.reel[1]));
      f.at.addScaledVector(UP, Math.max(0, 9 * Math.sin(Math.max(0, b.rear)) - 2 * (1 - Math.cos(b.rear))) * (1 - b.tuck) * CELL * scale);
      pose = f;
    } else pose = grounded(lair, b, scale, breath * (won ? 1 : 0.5));
    return { ...pose, pitch: (t < land ? pose.pitch : 0) + b.rear, body: b, clock: t, breath: t < land ? 0 : breath, smoke, dust, embers: null };
  }

  // ---------------------------------------------------------------- applying a pose

  function poseRig(r: Rig, p: Pose): void {
    const b = p.body, s = r.look.scale;
    r.root.position.copy(p.at);
    r.root.rotation.set(-p.pitch, p.yaw, p.roll, 'YXZ');
    r.root.scale.setScalar(s);
    r.torso.scale.set(1 + 0.02 * p.breath, 1 + 0.03 * p.breath, 1);
    let sum = 0;
    r.neck.forEach((joint, i) => {
      const lift = NECK_BASE[i]! * (1 - 0.75 * b.tuck) * (1 - 0.6 * b.crouch) + b.neck * NECK_SHAPE[i]!;
      sum += lift;
      joint.rotation.set(-lift, b.curl + b.jerk * NECK_JERK[i]!, 0, 'YXZ');
    });
    // The head keeps its own level against the body and neck, as a creature steadies its gaze.
    r.head.rotation.set(-clamp(b.head - p.pitch - sum, -1.3, 1.3), b.curl * 0.6 + b.jerk * 0.5, 0, 'YXZ');
    r.jaw.rotation.set(clamp(b.jaw, 0, 1.2) * 0.72, 0, 0);
    const n = r.tail.length, flight = b.tuck;
    r.tail.forEach((joint, i) => {
      const sway = Math.sin(p.clock / 2600 * TAU - i * 0.75) * b.sway * (0.5 + i * 0.25), bob = Math.sin(p.clock / 1500 * TAU - i * 0.6) * 0.035 * flight;
      const lift = TAIL_DROOP[i]! * (1 - flight) * (1 - b.crouch) + TAIL_DOWN[i]! * b.crouch + b.tail * (0.5 + i / n) + bob;
      joint.rotation.set(lift, -b.tailCurl * (0.7 + 0.15 * i) + sway, 0, 'YXZ');
    });
    const c = b.crouch, k = b.tuck, reach = b.reach, rear = Math.max(0, b.rear) * (1 - k), paw = clamp(rear / 0.5, 0, 1) * (1 - c);
    for (const leg of r.legs) {
      if (leg.fore) {
        // Forelegs lie forward under the chin when down, tuck under the chest in flight and paw the air when rearing.
        leg.upper.rotation.x = -1.05 * c + 0.75 * k - 0.6 * reach + 0.4 * rear - 0.55 * paw;
        leg.lower.rotation.x = -0.52 * c - 1.6 * k - 0.3 * reach - 0.7 * paw;
      } else {
        // Hind legs stay planted under a rear, fold under the haunch when down, and trail behind in flight.
        leg.upper.rotation.x = -1.45 * c + 1.0 * k - 0.4 * reach + rear;
        leg.lower.rotation.x = 2.95 * c + 0.5 * k + 0.2 * reach;
      }
    }
    for (const w of r.wings) {
      const open = clamp(b.spread, 0, 1.2), shut = 1 - clamp(b.spread, 0, 1);
      w.inner.rotation.set(0, w.side * lerp(FOLD.sweep, b.sweep, open), w.side * lerp(FOLD.lift, b.lift, open), 'YZX');
      w.outer.position.copy(w.wrist).addScaledVector(UP, -FOLD.offset * CELL * shut);
      w.outer.rotation.set(0, w.side * lerp(FOLD.bend, b.bend, open), w.side * lerp(FOLD.flex, b.flex, open), 'YZX');
    }
    const eyes = Math.max(0, b.eyes), flare = Math.max(0, eyes - 1);
    r.materials.eye.opacity = Math.min(1, eyes);
    r.materials.eye.color.setHex(r.look.eye).multiplyScalar(1 + 0.6 * flare);
    r.materials.halo.opacity = 0.3 * Math.min(1, eyes) + 0.3 * flare;
    for (const m of r.eyes) { m.visible = eyes > 0.02; m.scale.copy(cells(1.05, 1.05, 2.1)).multiplyScalar(1 + 0.3 * flare); }
    for (const m of r.halos) m.visible = eyes > 0.02;
    r.materials.throat.opacity = clamp(b.throat, 0, 1) * 0.85;
    for (const m of r.throat) m.visible = b.throat > 0.01;
    r.root.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- effects

  const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), tmp = new THREE.Vector3(), size = new THREE.Vector3(), colour = new THREE.Color();
  const local = (o: THREE.Object3D) => layer.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
  /** The head's forward in layer space, tipped down by `down` radians (the gape of the open jaw). */
  const forward = (r: Rig, down: number) => {
    const qHead = r.head.getWorldQuaternion(new THREE.Quaternion()), qLayer = layer.getWorldQuaternion(new THREE.Quaternion()).invert();
    return new THREE.Vector3(0, -Math.sin(down), Math.cos(down)).applyQuaternion(qHead).applyQuaternion(qLayer).normalize();
  };
  const put = (mesh: THREE.InstancedMesh, i: number, at: THREE.Vector3, edge: number, c: THREE.Color) => {
    mesh.setMatrixAt(i, m4.compose(at, q0, size.setScalar(edge))); mesh.setColorAt(i, c);
  };
  const flush = (mesh: THREE.InstancedMesh, n: number) => {
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  /** A breath of embers streaming from the open jaw toward the ground ahead: born on a fixed schedule, each one pure in its age. */
  function breathe(r: Rig, ms: number, ground: number): number {
    const N = DRAGON_LIMITS.embers, span = A.breath.strike - 350, life = 720, s = r.look.scale, ramp4 = r.look.embers;
    const mouth = local(r.mouth), dir = forward(r, 0.3), side = new THREE.Vector3().crossVectors(dir, UP).normalize(), lift = new THREE.Vector3().crossVectors(side, dir);
    let n = 0;
    for (let i = 0; i < N; i++) {
      const age = ms - (i / N) * span;
      if (age < 0 || age >= life) continue;
      const u = age / life, a = hash01(i, 11) * TAU, spread = 0.2 * Math.sqrt(hash01(i, 12)) + 0.08 * u;
      const d = tmp.copy(dir).addScaledVector(side, Math.cos(a) * spread).addScaledVector(lift, Math.sin(a) * spread).normalize();
      const reach = (16 + 9 * hash01(i, 13)) * s * 0.5 * (age / 1000) * (1 - 0.35 * u);
      const at = mouth.clone().addScaledVector(d, reach).addScaledVector(UP, 0.8 * u * u * s + Math.sin(age / 90 + i) * 0.08 * s * u);
      if (at.y < ground + 0.15) continue;
      const k = Math.min(ramp4.length - 1.001, u * (ramp4.length - 1)), c0 = Math.floor(k);
      colour.setHex(ramp4[c0]!).lerp(new THREE.Color(ramp4[c0 + 1]!), k - c0);
      put(embers, n++, at, CELL * s * (0.7 + 1.1 * hash01(i, 14)) * (u < 0.12 ? 0.4 + 5 * u : 1 - 0.8 * (u - 0.12) / 0.88), colour);
    }
    return n;
  }

  /** Smoke from the nostrils, left in the air where it was breathed: grey cubes that drift on and up, swell and shrink away. */
  function puff(nose: THREE.Vector3, dir: THREE.Vector3, p: Puff, s: number): number {
    let n = 0;
    for (let i = 0; i < 24 && n < DRAGON_LIMITS.smoke; i++) {
      const age = p.t - i * 22, life = 1500 + 700 * hash01(i, 20 + p.seed);
      if (age < 0 || age >= life) continue;
      const u = age / life, j = hash01(i, 30 + p.seed) - 0.5, l = hash01(i, 40 + p.seed) - 0.5;
      const at = nose.clone().addScaledVector(dir, (0.25 + 1.6 * EASE.out(u)) * s).addScaledVector(UP, (0.7 * u + 0.6 * u * u) * s);
      at.x += j * 0.9 * u * s; at.z += l * 0.9 * u * s;
      put(smoke, n++, at, CELL * s * (1.2 + 2.4 * u) * (1 - u ** 4), SMOKE[Math.floor(hash01(i, 50) * SMOKE.length)]!);
    }
    return n;
  }

  /** The dust ring of a takeoff or a landing, rolling out over the ground round the dragon's feet. */
  function kick(p: Puff, centre: THREE.Vector3, s: number): number {
    let n = 0;
    for (let i = 0; i < DRAGON_LIMITS.dust; i++) {
      const age = p.t - (i % 4) * 30, life = 1400 + 900 * hash01(i, 60 + p.seed);
      if (age < 0 || age >= life) continue;
      const u = age / life, a = (i / DRAGON_LIMITS.dust) * TAU + hash01(i, 70) * 0.2, reach = (14 + 34 * EASE.out(u) * (0.75 + 0.5 * hash01(i, 80))) * CELL * s;
      const at = new THREE.Vector3(centre.x + Math.cos(a) * reach, centre.y + (0.3 + 2.5 * Math.sin(Math.PI * u) * hash01(i, 90)) * CELL * s, centre.z + Math.sin(a) * reach);
      put(dust, n++, at, CELL * s * (1.6 + 1.4 * hash01(i, 100)) * (1 - u), DUST[Math.floor(hash01(i, 110) * DUST.length)]!);
    }
    return n;
  }

  function hide(): void {
    if (rig) rig.root.visible = false;
    flush(embers, 0); flush(smoke, 0); flush(dust, 0);
    focus = null; headAt = null; lastGlow = NO_GLOW;
  }

  return {
    blueprints: () => dragonBlueprints(host.kit),
    apply(frame: DragonFrame | null): void {
      if (!frame) { drop(); hide(); return; }
      if (rig && rig.form !== frame.form) drop();
      const scale = DRAGON_LOOKS[frame.form].scale, { lair, sky } = places(scale);
      if (!lair || (frame.phase !== 'stir' && !sky)) { hide(); return; }
      const sample = (f: DragonFrame): Pose => (f.phase === 'stir' ? stir(f.t, lair, scale)
        : f.phase === 'summoning' ? summoning(f.t, lair, sky!, scale)
          : f.phase === 'active' ? active(f, lair, sky!, scale)
            : home(f, lair, sky!, scale, f.phase === 'victory'));
      rig ??= build(frame.form);
      rig.root.visible = true;
      layer.updateWorldMatrix(true, false);
      const p = sample(frame);
      // Smoke stays where it was breathed: pose the rig at the puff's first instant to find the nostrils then.
      let nose: { at: THREE.Vector3; dir: THREE.Vector3 } | null = null;
      if (p.smoke) {
        poseRig(rig, sample({ ...frame, t: frame.t - p.smoke.t, elapsed: frame.elapsed - p.smoke.t }));
        nose = { at: local(rig.nostrils), dir: forward(rig, -0.35) };
      }
      poseRig(rig, p);
      const ground = sky ? Math.min(sky.centre.y, lair.at.y) : lair.at.y;
      flush(embers, p.embers !== null ? breathe(rig, p.embers, ground) : 0);
      flush(smoke, p.smoke && nose ? puff(nose.at, nose.dir, p.smoke, scale) : 0);
      flush(dust, p.dust ? kick(p.dust, lair.at, scale) : 0);
      focus = rig.root.getWorldPosition(new THREE.Vector3());
      headAt = rig.centre.getWorldPosition(new THREE.Vector3());
      lastGlow = dragonGlow(frame, p, rig.look, embers.count);
    },
    /** The dragon's light on the town this frame: its fire, and how far its waking draws the dusk down. */
    glow: () => lastGlow,
    /** The dragon's body in world space, for the director's shot; null while it is not shown. */
    focus: () => focus?.clone() ?? null,
    /** The middle of its head in world space, for a caption; null while it is not shown. */
    head: () => headAt?.clone() ?? null,
    stats: () => ({ rigs: rig && rig.root.visible ? 1 : 0, parts: rig && rig.root.visible ? rig.parts : 0, embers: embers.count, smoke: smoke.count, dust: dust.count }),
    dispose(): void {
      drop();
      for (const mesh of [embers, smoke, dust]) { layer.remove(mesh); mesh.dispose(); }
      emberMaterial.dispose(); smokeMaterial.dispose(); dustMaterial.dispose(); unit.dispose();
      root.remove(layer);
      focus = null; headAt = null;
    },
  };
}
export type DragonLayer = ReturnType<typeof createDragonLayer>;
