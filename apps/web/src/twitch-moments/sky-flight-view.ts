import * as THREE from 'three';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { CELL } from './banner';
import {
  BASKET_CELLS, BEAST_SCALE, BODY_CELLS, BOW_CELLS, HEAD_CELLS, KITE_CELLS, LEG_CELLS, MANE_CELLS, TAIL_CELLS, WING_INNER_CELLS, WING_OUTER_CELLS,
  basketBlueprint, beastParts, bowBlueprint, kiteBlueprint, threadBlueprint, type BowColour, type ThreadColour,
} from './sky-art';
import {
  POWER_UP_BEAT, SKY_BEAT, SKY_LIMITS, hash01, type ApprovedEffect, type SkyBeatFrame, type SkyOrigin, type SpectacleLayer, type SpectacleLayerHost,
} from './spectacle';

/**
 * What flies when chat cheers big: the Hearthbeast's low pass, a sky of kites from every home, and a gigantified
 * emote floating over the plaza. Every pose is a pure function of the frame's own clock, its seed and the supplied
 * places; nothing accumulates between frames, so a beat looks the same at any frame interval or after a seek.
 */

const UP = new THREE.Vector3(0, 1, 0);
const HB = SKY_BEAT.hearthbeast, KB = SKY_BEAT.kites, BB = POWER_UP_BEAT.balloon;
const cells = (x: number, y: number, z: number) => new THREE.Vector3(x * CELL, y * CELL, z * CELL);
const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => { const v = clamp01(t); return v * v * (3 - 2 * v); };
const span = (a: number, b: number, t: number) => smooth((t - a) / (b - a));
const easeInOut = (t: number) => { const v = clamp01(t); return v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2; };
/** Arrives with a small overshoot and settles: the house's toy feel. */
const easeOutBack = (t: number, s = 1.2) => { const v = clamp01(t) - 1; return 1 + (s + 1) * v * v * v + s * v * v; };
/** 0 → 1 → 0 over [0, 1]. */
const bell = (t: number) => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------- the Hearthbeast's pass

/** Wingspan 16 m at full scale; it flies 10–16 m over the highest roof, entering and leaving this far past the town. */
const BEAST = { beyond: 34, above: 12, aboveMin: 10, aboveMax: 16, maxLive: 2 } as const;
/** Wing angles (rad, + up): held glide, top of the upstroke, bottom of the downstroke. */
const WING = { glide: 0.14, up: 1.0, down: -0.7, upstroke: 460, downstroke: 300, recover: 660 } as const;

interface WingPose { a: number; b: number; sweep: number; lift: number; surge: number; pitch: number; pulse: number }

/** The wing clock: a strong downstroke at every authored instant, held glides between them. */
function wingbeat(t: number): WingPose {
  const breathe = Math.sin(t / 650);
  const pose: WingPose = { a: WING.glide + 0.025 * breathe, b: -0.04 + 0.03 * Math.sin(t / 650 - 0.8), sweep: 0, lift: 0, surge: 0, pitch: 0, pulse: 0 };
  const lead = WING.upstroke + 60;
  for (const at of HB.wings) {
    const tau = t - at;
    // The body sinks a touch while the wings rise, then lifts and surges forward after each stroke.
    if (tau > -lead && tau < 0) pose.lift -= 0.22 * bell((tau + lead) / lead);
    if (tau >= 0 && tau < 1300) { pose.lift += 1.0 * bell(tau / 1300); pose.surge += 0.9 * bell(tau / 1400); pose.pulse += bell(tau / 700); }
    if (tau < -lead || tau >= WING.downstroke - 60 + WING.recover) continue;
    if (tau < -60) {
      // Anticipation: the wings gather up and back, the wrists bent so the tips trail.
      const k = easeInOut((tau + lead) / WING.upstroke);
      pose.a = lerp(WING.glide, WING.up, k); pose.b = lerp(0, -0.45, k); pose.sweep = 0.2 * k; pose.pitch = 0.05 * k;
    } else if (tau < WING.downstroke - 60) {
      // The stroke: fast and heavy, the outer feathers lagging up then whipping through past the line.
      const k = (tau + 60) / WING.downstroke, e = easeInOut(k);
      pose.a = lerp(WING.up, WING.down, e); pose.b = lerp(-0.45, -0.3, k) + 0.75 * bell(k);
      pose.sweep = lerp(0.2, -0.08, e); pose.pitch = lerp(0.05, -0.06, e);
    } else {
      // Recovery: back to the glide with a soft overshoot; the tips settle a beat later.
      const k = (tau - WING.downstroke + 60) / WING.recover;
      pose.a = WING.down + (WING.glide - WING.down) * easeOutBack(k, 0.9);
      pose.b = -0.3 * (1 - k) * Math.cos(2.2 * Math.PI * k); pose.sweep = lerp(-0.08, 0, smooth(k)); pose.pitch = -0.06 * (1 - smooth(k));
    }
  }
  return pose;
}

interface Flight {
  readonly p0: THREE.Vector3; readonly c: THREE.Vector3; readonly p2: THREE.Vector3;
  readonly cruise: number;
  /** The cheerer's roof (or the castle crown) and when the beast passes closest to it. */
  readonly target: THREE.Vector3 | null; readonly closest: number;
}

interface Beast {
  readonly root: THREE.Group; readonly mane: THREE.Group; readonly head: THREE.Group;
  readonly eyes: THREE.Mesh[]; readonly ember: THREE.Mesh; readonly halo: THREE.Mesh;
  readonly wings: { readonly inner: THREE.Group; readonly outer: THREE.Group; readonly side: 1 | -1 }[];
  readonly tail: THREE.Group[]; readonly legs: { readonly group: THREE.Group; readonly fore: boolean }[];
}

// ---------------------------------------------------------------- kites

/** Each kite climbs for this long, and drifts away for this long once its string is let go. */
/** A flock kite is 2.2 m across its sail; the leader half as big again. */
const KITE = { rise: 2400, drift: 2400, strings: 22, leadStrings: 30, bows: 5, scale: 1.35, leadScale: 2, maxBeats: 6 } as const;
const STRING_WIDTH = { flock: 0.055, lead: 0.085, rope: 0.07 } as const;

interface KiteSpec {
  readonly anchor: THREE.Vector3; readonly lead: boolean; readonly key: number;
  readonly start: number; readonly release: number; readonly drift: number; readonly height: number; readonly downwind: number;
  readonly phase: number; readonly omega: number; readonly delay: number; readonly side: number;
}

/** The shared wind: one slow gust field the whole sky feels, arriving at each kite by where it stands. */
const gust = (t: number) => 0.6 * Math.sin(t * 0.00052) + 0.4 * Math.sin(t * 0.00131 + 1.3);

// ---------------------------------------------------------------- the float

/** A float is 7 m tall, its centre at least 15 m over the plaza and 9 m over the highest roof. */
const FLOAT = { height: 7, puff: 1.6, basketScale: 1.6, hang: 2.2, altitude: 15, clearance: 9, tether: 18, ropes: 5 } as const;

interface EffectMeshes {
  readonly geometries: (THREE.BufferGeometry | null)[];
  readonly size: readonly [number, number, number];
  ready: boolean; failed: boolean; evicted: boolean; used: number;
}
interface Balloon { readonly group: THREE.Group; readonly float: THREE.Group; readonly mesh: THREE.Mesh; readonly basket: THREE.Group; readonly key: string }

// ---------------------------------------------------------------- instanced parts

/**
 * A prepared part drawn many times in one call. It shares the host's mesh buffers through its own geometry and
 * adds a per-instance fade the voxel material dissolves by, so kites unfold and leave without popping.
 */
interface Pool {
  readonly mesh: THREE.InstancedMesh; readonly fade: THREE.InstancedBufferAttribute; readonly capacity: number; readonly shared: string[];
  count: number;
}

/**
 * The flying layer for the Hearthbeast rung, the kites rung and gigantified emotes. Other kinds and rungs belong
 * to the shell layer and are ignored here.
 */
export function createSkyFlightLayer(root: THREE.Group, host: SpectacleLayerHost): SpectacleLayer<readonly SkyBeatFrame[]> & { focus(): THREE.Vector3 | null } {
  const layer = new THREE.Group();
  layer.name = 'sky-flight';
  root.add(layer);
  const { places } = host;
  let disposed = false, applies = 0;
  // Every part is authored once per layer; frames only place them.
  const art = {
    beast: beastParts(host.kit), kite: kiteBlueprint(host.kit, false), lead: kiteBlueprint(host.kit, true), basket: basketBlueprint(host.kit),
    bows: { cloth: bowBlueprint(host.kit, 'cloth'), cream: bowBlueprint(host.kit, 'cream'), gold: bowBlueprint(host.kit, 'gold') } satisfies Record<BowColour, VoxelBlueprint>,
    threads: { cream: threadBlueprint(host.kit, 'cream'), gold: threadBlueprint(host.kit, 'gold'), rope: threadBlueprint(host.kit, 'rope') } satisfies Record<ThreadColour, VoxelBlueprint>,
  };

  // Glow pieces are the only materials this layer owns; the beast's eyes and ember heart are lit from within.
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xffd98a, toneMapped: false });
  const emberMaterial = new THREE.MeshBasicMaterial({ color: 0xffa24a, toneMapped: false });
  const haloMaterial = new THREE.MeshBasicMaterial({ color: 0xff8a3c, transparent: true, opacity: 0.26, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const eyeGeometry = new THREE.BoxGeometry(HEAD_CELLS.eyeSize[0] * CELL, HEAD_CELLS.eyeSize[1] * CELL, HEAD_CELLS.eyeSize[2] * CELL);
  const emberGeometry = new THREE.BoxGeometry(2.3 * CELL, 2.3 * CELL, 2.3 * CELL), haloGeometry = new THREE.BoxGeometry(4.6 * CELL, 4.6 * CELL, 4.6 * CELL);

  const beasts = new Map<string, Beast>(), balloons = new Map<string, Balloon>();
  const effects = new Map<string, EffectMeshes>();
  const pools = new Map<string, Pool>();
  let focusPoint: THREE.Vector3 | null = null;
  let drawn = { kites: 0, motes: 0 };

  // Scratch, reused every frame; nothing here carries motion from one frame to the next.
  const m4 = new THREE.Matrix4(), m4b = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3();
  const ta = new THREE.Vector3(), tb = new THREE.Vector3(), tc = new THREE.Vector3(), td = new THREE.Vector3(), forward = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);

  // ---------------------------------------------------------------- places

  /** Where a beat starts: the cheerer's roof, or the castle crown for a public origin. Null when not supplied. */
  function originPoint(origin: SkyOrigin): THREE.Vector3 | null {
    if (origin.kind === 'home') { const roof = places.roof(origin.slot); return roof ? v3(roof) : null; }
    const castle = places.castle();
    return castle ? v3(castle.crown) : null;
  }

  function highestRoof(): number | null {
    let top: number | null = null;
    for (const slot of places.homes().slice(0, 512)) { const roof = places.roof(slot); if (roof && (top === null || roof[1] > top)) top = roof[1]; }
    return top;
  }

  // ---------------------------------------------------------------- instancing

  function pool(blueprint: VoxelBlueprint, capacity: number): Pool {
    let p = pools.get(blueprint.id);
    if (p) return p;
    const source = host.mesh(blueprint, new THREE.Vector3()).geometry;
    const geometry = new THREE.BufferGeometry(), shared: string[] = [];
    geometry.setIndex(source.index);
    for (const [name, attribute] of Object.entries(source.attributes)) { geometry.setAttribute(name, attribute); shared.push(name); }
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
    fade.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aLodFade', fade);
    const mesh = new THREE.InstancedMesh(geometry, host.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.count = 0; mesh.name = `sky-${blueprint.id}`;
    layer.add(mesh);
    p = { mesh, fade, capacity, shared, count: 0 };
    pools.set(blueprint.id, p);
    return p;
  }

  function put(p: Pool, matrix: THREE.Matrix4, fade: number): void {
    if (p.count >= p.capacity || fade <= 0.01) return;
    p.mesh.setMatrixAt(p.count, matrix);
    p.fade.setX(p.count, Math.min(1, fade));
    p.count++;
  }

  /** A thread from a to b: one stretched cell, centred on the segment. */
  const centreCell = new THREE.Matrix4().makeTranslation(-CELL / 2, -CELL / 2, -CELL / 2);
  function stick(p: Pool, a: THREE.Vector3, b: THREE.Vector3, width: number, fade: number): void {
    tc.subVectors(b, a);
    const length = tc.length();
    if (length < 1e-4) return;
    q.setFromUnitVectors(Z, tc.divideScalar(length));
    td.addVectors(a, b).multiplyScalar(0.5);
    s3.set(width / CELL, width / CELL, (length + width * 0.5) / CELL);
    m4.compose(td, q, s3).multiply(centreCell);
    put(p, m4, fade);
    drawn.motes++;
  }

  /** A sagging line from a to b in `segments` sticks: the wind bellies it and gravity pulls its middle down. */
  function line(p: Pool, a: THREE.Vector3, b: THREE.Vector3, segments: number, sag: number, wind: THREE.Vector3, width: number, fade: number): void {
    const prev = new THREE.Vector3().copy(a), next = new THREE.Vector3();
    for (let i = 1; i <= segments; i++) {
      const u = i / segments, belly = 4 * u * (1 - u);
      next.lerpVectors(a, b, u).addScaledVector(UP, -sag * belly).addScaledVector(wind, sag * 0.45 * belly);
      stick(p, prev, next, width, fade);
      prev.copy(next);
    }
  }

  // ---------------------------------------------------------------- the Hearthbeast

  function buildBeast(): Beast {
    const parts = art.beast, pivot = BODY_CELLS.pivot;
    const rel = (c: readonly [number, number, number], o: readonly [number, number, number] = pivot) => cells(c[0] - o[0], c[1] - o[1], c[2] - o[2]);
    const group = (parent: THREE.Object3D, at: THREE.Vector3, blueprint: VoxelBlueprint, offset: THREE.Vector3) => {
      const g = new THREE.Group();
      g.position.copy(at);
      g.add(host.mesh(blueprint, offset));
      parent.add(g);
      return g;
    };
    const beast = new THREE.Group();
    beast.name = 'hearthbeast';
    beast.rotation.order = 'YZX';
    beast.add(host.mesh(parts.body, cells(-pivot[0], -pivot[1], -pivot[2])));
    const ember = new THREE.Mesh(emberGeometry, emberMaterial), halo = new THREE.Mesh(haloGeometry, haloMaterial);
    ember.position.copy(rel(BODY_CELLS.ember)); halo.position.copy(ember.position);
    beast.add(ember, halo);
    const mane = group(beast, rel(BODY_CELLS.mane), parts.mane, cells(-MANE_CELLS.pivot[0], -MANE_CELLS.pivot[1], -MANE_CELLS.pivot[2]));
    const head = group(beast, rel(BODY_CELLS.neck), parts.head, cells(-HEAD_CELLS.pivot[0], -HEAD_CELLS.pivot[1], -HEAD_CELLS.pivot[2]));
    head.rotation.order = 'YZX';
    const eyes = HEAD_CELLS.eyes.map(eye => {
      const mesh = new THREE.Mesh(eyeGeometry, eyeMaterial);
      mesh.position.copy(rel(eye, HEAD_CELLS.pivot));
      head.add(mesh);
      return mesh;
    });
    const wings = ([1, -1] as const).map((side, i) => {
      const [px, py] = WING_INNER_CELLS.pivot, [ox, oy] = WING_OUTER_CELLS.pivot;
      const inner = group(beast, rel(BODY_CELLS.shoulders[i]!), parts.wingInner[i]!, cells(-px, -py, side === 1 ? 0 : -WING_INNER_CELLS.size[2]));
      const [wx, , wz] = WING_INNER_CELLS.wrist;
      const outer = group(inner, cells(wx - px, 0, side * wz), parts.wingOuter[i]!, cells(-ox, -oy, side === 1 ? 0 : -WING_OUTER_CELLS.size[2]));
      return { inner, outer, side };
    });
    const { base, mid, tuft } = TAIL_CELLS;
    const tail0 = group(beast, rel(BODY_CELLS.tail), parts.tail[0], cells(-base.pivot[0], -base.pivot[1], -base.pivot[2]));
    const tail1 = group(tail0, cells(base.next[0] - base.pivot[0], 0, 0), parts.tail[1], cells(-mid.pivot[0], -mid.pivot[1], -mid.pivot[2]));
    const tail2 = group(tail1, cells(mid.next[0] - mid.pivot[0], 0, 0), parts.tail[2], cells(-tuft.pivot[0], -tuft.pivot[1], -tuft.pivot[2]));
    const legs = BODY_CELLS.legs.map((hip, i) => {
      const fore = i < 2, cell = fore ? LEG_CELLS.fore : LEG_CELLS.hind;
      return { group: group(beast, rel(hip), fore ? parts.fore : parts.hind, cells(-cell.pivot[0], -cell.pivot[1], -cell.pivot[2])), fore };
    });
    layer.add(beast);
    return { root: beast, mane, head, eyes, ember, halo, wings, tail: [tail0, tail1, tail2], legs };
  }

  /** The pass, from the far side of the town (behind the castle when it stands off-centre) out past the near side. */
  function flight(frame: SkyBeatFrame): Flight | null {
    const sky = places.sky();
    if (!sky) return null;
    const centre = v3(sky.centre), radius = Math.max(8, sky.radius);
    const roofs = highestRoof() ?? centre.y + Math.min(10, sky.ceiling * 0.4);
    let cruise = roofs + BEAST.above;
    const ceiling = centre.y + sky.ceiling;
    if (ceiling >= roofs + BEAST.aboveMin && ceiling < cruise) cruise = ceiling;
    cruise = Math.min(roofs + BEAST.aboveMax, Math.max(roofs + BEAST.aboveMin, cruise));
    const castle = places.castle();
    let heading = Math.PI * 2 * hash01(frame.seed, 21);
    if (castle) {
      const away = ta.subVectors(centre, v3(castle.crown)).setY(0);
      if (away.length() > radius * 0.15) heading = Math.atan2(away.z, away.x);
    }
    heading += (hash01(frame.seed, 22) - 0.5) * 0.5;
    const dir = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading)), across = new THREE.Vector3(dir.z, 0, -dir.x);
    const target = originPoint(frame.origin);
    // Lean the pass toward the cheerer's home so the head turn reads; bow it gently one way so the beast banks.
    const lean = target ? Math.max(-0.35 * radius, Math.min(0.35 * radius, tb.subVectors(target, centre).dot(across) * 0.45)) : 0;
    const bowed = (hash01(frame.seed, 23) - 0.5) * 0.6 * radius, reach = radius + BEAST.beyond;
    const p0 = centre.clone().addScaledVector(dir, -reach).addScaledVector(across, lean + bowed);
    const p2 = centre.clone().addScaledVector(dir, reach).addScaledVector(across, lean + bowed);
    const p1 = centre.clone().addScaledVector(across, lean);
    const c = p1.clone().multiplyScalar(2).sub(tc.addVectors(p0, p2).multiplyScalar(0.5));
    const f: Flight = { p0, c, p2, cruise, target, closest: HB.overhead };
    if (!target) return f;
    let best = Infinity, closest: number = HB.overhead;
    for (let t: number = HB.enter; t <= HB.exit; t += 120) {
      const d = path(f, t, td).distanceToSquared(target);
      if (d < best) { best = d; closest = t; }
    }
    return { ...f, closest };
  }

  /** Path position at beat time t: a quadratic through the overhead point, extended straight after the exit. */
  function path(f: Flight, t: number, out: THREE.Vector3): THREE.Vector3 {
    const s = (t - HB.enter) / (HB.exit - HB.enter), u = Math.min(1, s), w = 1 - u;
    out.set(0, 0, 0).addScaledVector(f.p0, w * w).addScaledVector(f.c, 2 * u * w).addScaledVector(f.p2, u * u);
    if (s > 1) out.addScaledVector(tangent(f, 1, ta), s - 1);
    // Low over the far roofs, lowest just past overhead, then climbing away over the near side.
    out.y = f.cruise + 1.5 * (1 - span(0, 0.5, s)) - 0.8 * bell((s - 0.3) / 0.45) + 9 * span(0.6, 1.3, s);
    return out;
  }
  /** d(position)/ds, horizontal. */
  function tangent(f: Flight, s: number, out: THREE.Vector3): THREE.Vector3 {
    const u = Math.min(1, Math.max(0, s));
    return out.set(0, 0, 0).addScaledVector(f.p0, -2 * (1 - u)).addScaledVector(f.c, 2 - 4 * u).addScaledVector(f.p2, 2 * u).setY(0);
  }
  const headingAt = (f: Flight, s: number) => { const d = tangent(f, s, tb); return Math.atan2(-d.z, d.x); };

  function poseBeast(beast: Beast, frame: SkyBeatFrame, f: Flight): boolean {
    const t = frame.t;
    const scale = span(HB.enter, HB.enter + 1800, t) * (1 - span(HB.exit + 300, HB.end, t));
    if (scale <= 0.002 || t >= HB.end) return false;
    const wing = wingbeat(t), s = (t - HB.enter) / (HB.exit - HB.enter), ds = 200 / (HB.exit - HB.enter);
    const position = path(f, t, beast.root.position);
    position.addScaledVector(tangent(f, s, forward).normalize(), wing.surge).addScaledVector(UP, wing.lift);
    // Orientation: along the path, nose following the climb, banking into the turn.
    let turn = headingAt(f, s + ds) - headingAt(f, s - ds);
    if (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < -Math.PI) turn += Math.PI * 2;
    const climb = (path(f, t + 200, tc).y - path(f, t - 200, td).y) / 400 * 1000;
    const speed = tangent(f, s, tb).length() / (HB.exit - HB.enter) * 1000;
    const bank = Math.max(-0.42, Math.min(0.42, -turn * 3.2));
    beast.root.rotation.set(bank + 0.03 * Math.sin(t / 900), headingAt(f, s), Math.atan2(climb, speed) * 0.8 + wing.pitch);
    beast.root.scale.setScalar(BEAST_SCALE * (0.04 + 0.96 * scale));

    for (const { inner, outer, side } of beast.wings) {
      inner.rotation.set(-side * wing.a, -side * wing.sweep, 0);
      outer.rotation.set(-side * wing.b, -side * wing.sweep * 0.6, 0);
    }
    // The call at the start: the head lifts and the mane rises with it.
    const call = bell((t - HB.call + 200) / 1100);
    // The look: toward the cheerer's home as it passes, eased in and out around the closest approach.
    let yaw = 0, pitch = 0;
    if (f.target) {
      const look = span(f.closest - 2400, f.closest - 1000, t) * (1 - span(f.closest + 1000, f.closest + 2400, t));
      if (look > 0) {
        const neck = tc.copy(beast.head.position).multiplyScalar(beast.root.scale.x).applyQuaternion(beast.root.quaternion).add(beast.root.position);
        const local = td.subVectors(f.target, neck).applyQuaternion(q.copy(beast.root.quaternion).invert());
        yaw = Math.max(-0.7, Math.min(0.7, Math.atan2(-local.z, local.x))) * look;
        pitch = Math.max(-0.6, Math.min(0.2, Math.atan2(local.y, Math.hypot(local.x, local.z)))) * look;
      }
    }
    // The head holds steady against the body's pitch and nods a little with each stroke.
    beast.head.rotation.set(-bank * 0.4, yaw, pitch + 0.32 * call - wing.pitch * 0.8 + 0.05 * wing.pulse);
    beast.mane.rotation.set(-bank * 0.2, yaw * 0.32, (pitch + 0.32 * call) * 0.25);
    beast.mane.scale.setScalar(1 + 0.05 * call + 0.025 * wing.pulse);
    // Eyes: a slow blink twice in the pass, each from the seed.
    const blinkAt = [2400 + 900 * hash01(frame.seed, 31), 6600 + 900 * hash01(frame.seed, 32)];
    const blink = Math.max(...blinkAt.map(at => bell((t - at + 90) / 180)));
    for (const eye of beast.eyes) eye.scale.set(1, 1 - 0.85 * blink, 1);
    // The ember breathes and flares a little with each stroke.
    const glow = 1 + 0.07 * Math.sin(t / 260) + 0.16 * wing.pulse;
    beast.ember.scale.setScalar(glow); beast.halo.scale.setScalar(0.9 + 0.25 * Math.sin(t / 410 + 0.6) + 0.3 * wing.pulse);
    // Legs tucked under, paddling a hair after each stroke.
    for (const leg of beast.legs) leg.group.rotation.set(0, 0, (leg.fore ? -1.1 : -1.38) + (leg.fore ? 0.16 : 0.1) * wing.pulse);
    // The tail streams: a travelling wave, a lag behind the lift and a lean against the bank.
    const wave = Math.PI * 2 / 1700, phase = hash01(frame.seed, 33) * Math.PI * 2;
    beast.tail.forEach((segment, i) => {
      const lag = wingbeat(t - 140 - i * 120).lift;
      segment.rotation.set(0, 0.14 * Math.sin(0.6 * wave * t - i * 0.95 + phase) + bank * 0.45 * (i + 1) / 3,
        (i === 0 ? 0.12 : 0.05) + 0.1 * Math.sin(wave * t - i * 0.85) + 0.12 * (wing.lift - lag));
    });
    return true;
  }

  // ---------------------------------------------------------------- kites

  /** One kite per home with a roof, bounded; `budget` counts followers, the leader rides on a seat of its own. */
  function kiteSpecs(frame: SkyBeatFrame, budget: number): { specs: KiteSpec[]; wind: THREE.Vector3 } {
    // The wind blows toward the castle when one stands off-centre, so the sails face the town's usual view of it.
    let angle = Math.PI * 2 * hash01(frame.seed, 11);
    const sky = places.sky(), castle = places.castle();
    if (sky && castle) {
      const toward = ta.subVectors(v3(castle.crown), v3(sky.centre)).setY(0);
      if (toward.length() > sky.radius * 0.15) angle = Math.atan2(toward.z, toward.x) + (hash01(frame.seed, 12) - 0.5) * 0.9;
    }
    const wind = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const specs: KiteSpec[] = [];
    const leadSlot = frame.origin.kind === 'home' ? frame.origin.slot : null;
    const leadAnchor = originPoint(frame.origin);
    const homes = places.homes().filter(slot => slot !== leadSlot);
    const followers = Math.max(0, Math.min(homes.length, budget));
    const anchors: { anchor: THREE.Vector3; key: number; lead: boolean }[] = [];
    if (leadAnchor) anchors.push({ anchor: leadAnchor, key: leadSlot ?? -1, lead: true });
    // More homes than kites: an even spread down the streets, so the whole town flies.
    for (let i = 0; i < followers; i++) {
      const slot = homes[Math.floor(i * homes.length / followers)]!, roof = places.roof(slot);
      if (roof) anchors.push({ anchor: v3(roof), key: slot, lead: false });
    }
    if (!anchors.length) return { specs, wind };
    const middle = anchors.reduce((sum, a) => sum.add(a.anchor), new THREE.Vector3()).divideScalar(anchors.length);
    const riseWindow = KB.rise[1] - KB.rise[0] - KB.lead - KITE.rise, driftWindow = KB.drift[1] - KB.drift[0] - KB.lead - KITE.drift;
    for (const { anchor, key, lead } of anchors) {
      const h = (salt: number) => hash01(frame.seed ^ Math.imul(key + 7, 0x2f6b), salt);
      const height = lead ? 28 : 14 + 7 * h(1);
      specs.push({
        anchor: anchor.clone().addScaledVector(UP, 0.25), lead, key,
        start: lead ? KB.rise[0] : KB.rise[0] + KB.lead + riseWindow * h(2),
        // The leader is let go first and leads the flock away, slowly enough to stay in the sky until the last.
        release: lead ? KB.drift[0] : KB.drift[0] + KB.lead + driftWindow * h(3), drift: lead ? KB.drift[1] - KB.drift[0] : KITE.drift,
        height, downwind: height * (lead ? 0.5 : 0.5 + 0.12 * h(4)),
        phase: Math.PI * 2 * h(5), omega: (Math.PI * 2 / 3400) * (0.85 + 0.3 * h(6)),
        // A gust crosses the town at ~9 m/s, so the sky ripples rather than swaying as one.
        delay: tb.subVectors(anchor, middle).dot(wind) / 9 * 1000, side: h(7) < 0.5 ? -1 : 1,
      });
    }
    return { specs, wind };
  }

  /** Draws one kite with its string and tail; returns the bridle point when the kite is in the sky. */
  function drawKite(k: KiteSpec, t: number, wind: THREE.Vector3): THREE.Vector3 | null {
    if (t < k.start) return null;
    const rise = (t - k.start) / KITE.rise, drift = clamp01((t - k.release) / k.drift);
    const fade = smooth(rise / 0.18) * (1 - span(0.55, 1, drift));
    if (fade <= 0.01) return null;
    const across = new THREE.Vector3(wind.z, 0, -wind.x), size = k.lead ? KITE.leadScale : KITE.scale, airborne = smooth(rise);
    const g = gust(t - k.delay), g2 = gust(t - k.delay - 400);
    const position = k.anchor.clone().addScaledVector(UP, k.height * easeOutBack(rise, 0.9)).addScaledVector(wind, k.downwind * smooth(rise * 1.2));
    position.addScaledVector(across, airborne * (1.1 * Math.sin(k.omega * t + k.phase) + 0.5 * Math.sin(1.73 * k.omega * t + 2 * k.phase) + 1.3 * g));
    position.addScaledVector(UP, airborne * (0.45 * Math.sin(0.8 * k.omega * t + 1.3 * k.phase) + 0.6 * g2)).addScaledVector(wind, airborne * 0.6 * g);
    // Let go: the kite lifts away downwind with a curl to one side, its string trailing after it.
    position.addScaledVector(wind, 42 * drift * drift).addScaledVector(UP, 10 * drift).addScaledVector(across, k.side * 4 * bell(drift));

    // Facing the flyer: the sail's face looks down the line, a little into the wind; it rolls as it sways.
    const toAnchor = ta.subVectors(k.anchor, position).normalize();
    const n = tb.copy(toAnchor).lerp(tc.copy(wind).negate(), 0.3).normalize();
    const u = new THREE.Vector3().copy(UP).addScaledVector(n, -UP.dot(n)).normalize();
    const x = new THREE.Vector3().crossVectors(u, n);
    const roll = airborne * (0.22 * Math.cos(k.omega * t + k.phase) + 0.15 * g) + (1 - airborne) * 0.5 * Math.sin(rise * 9);
    x.applyAxisAngle(n, roll); u.applyAxisAngle(n, roll);
    const scale = size * (0.35 + 0.65 * smooth(rise / 0.3)) * (1 - 0.25 * drift);
    m4.makeBasis(x, u, n).scale(s3.setScalar(scale)).setPosition(position);
    m4.multiply(m4b.makeTranslation(-KITE_CELLS.bridle[0] * CELL, -KITE_CELLS.bridle[1] * CELL, -KITE_CELLS.bridle[2] * CELL));
    put(pool(k.lead ? art.lead : art.kite, k.lead ? KITE.maxBeats : SKY_LIMITS.kites), m4, fade);
    drawn.kites++;

    // The string: from the roof to the bridle, or trailing beneath the kite once it is let go.
    const thread = pool(art.threads[k.lead ? 'gold' : 'cream'], threadCapacity(k.lead ? 'gold' : 'cream'));
    const length = k.anchor.distanceTo(position);
    const free = smooth(drift / 0.45), trail = position.clone().addScaledVector(toAnchor, Math.min(length, 5 * size));
    const base = k.anchor.clone().lerp(trail, free);
    line(thread, base, position, k.lead ? KITE.leadStrings : KITE.strings, length * 0.05 * (1 + 0.3 * g), wind, k.lead ? STRING_WIDTH.lead : STRING_WIDTH.flock, fade);

    // The tail: bows on a line streaming downwind from the bottom tip, each a beat behind the one above it.
    const tip = position.clone().addScaledVector(u, (KITE_CELLS.tail[1] - KITE_CELLS.bridle[1]) * CELL * scale).addScaledVector(n, (KITE_CELLS.tail[2] - KITE_CELLS.bridle[2]) * CELL * scale);
    const down = new THREE.Vector3().copy(wind).multiplyScalar(0.75).addScaledVector(UP, -0.65).normalize();
    const spacing = 0.5 * scale, prev = tip.clone(), next = new THREE.Vector3(), along = new THREE.Vector3();
    for (let i = 1; i <= KITE.bows; i++) {
      next.copy(tip).addScaledVector(down, i * spacing).addScaledVector(x, Math.sin(k.omega * 2.6 * t - i * 0.9 + k.phase) * 0.12 * i * scale)
        .addScaledVector(UP, Math.sin(k.omega * 1.9 * t - i * 0.7) * 0.05 * i * scale);
      stick(thread, prev, next, k.lead ? STRING_WIDTH.lead * 0.8 : STRING_WIDTH.flock, fade);
      along.subVectors(prev, next).normalize();
      const bx = tc.copy(x).addScaledVector(along, -x.dot(along)).normalize(), bz = td.crossVectors(bx, along);
      const colour: BowColour = k.lead ? 'gold' : i % 2 === 1 ? 'cloth' : 'cream';
      m4.makeBasis(bx, along, bz).scale(s3.setScalar(scale)).setPosition(next);
      m4.multiply(m4b.makeTranslation(-BOW_CELLS.pivot[0] * CELL, -BOW_CELLS.pivot[1] * CELL, -BOW_CELLS.pivot[2] * CELL));
      put(pool(art.bows[colour], bowCapacity(colour)), m4, fade);
      prev.copy(next);
    }
    return position;
  }

  const threadCapacity = (colour: ThreadColour) => colour === 'gold' ? KITE.maxBeats * (KITE.leadStrings + KITE.bows)
    : colour === 'cream' ? SKY_LIMITS.kites * (KITE.strings + KITE.bows) : SKY_LIMITS.balloons * (FLOAT.ropes * 4 + FLOAT.tether);
  /** Leaders hang five gold bows; every other kite alternates cloth and cream, three and two. */
  const bowCapacity = (colour: BowColour) => colour === 'gold' ? KITE.maxBeats * KITE.bows : SKY_LIMITS.kites * (colour === 'cloth' ? Math.ceil(KITE.bows / 2) : Math.floor(KITE.bows / 2));

  // ---------------------------------------------------------------- the float

  function effectMeshes(effect: ApprovedEffect): EffectMeshes {
    const key = `${effect.id}@${effect.revision}`;
    let entry = effects.get(key);
    if (entry) { entry.used = applies; return entry; }
    const size: [number, number, number] = [1, 1, 1];
    for (const frame of effect.frames) for (let d = 0; d < 3; d++) size[d] = Math.max(size[d]!, frame.blueprint.size[d]!);
    const made: EffectMeshes = { geometries: effect.frames.map(() => null), size, ready: false, failed: effect.frames.length === 0, evicted: false, used: applies };
    effects.set(key, made);
    effect.frames.forEach((frame, i) => {
      host.meshAsync(frame.blueprint).then(geometry => {
        if (disposed || made.evicted) { geometry.dispose(); return; }
        made.geometries[i] = geometry;
        made.ready = made.geometries.every(g => g !== null);
      }, () => { made.failed = true; });
    });
    entry = made;
    return entry;
  }

  function frameIndex(effect: ApprovedEffect, t: number): number {
    if (effect.frames.length < 2 || effect.periodMs <= 0) return 0;
    let at = ((t % effect.periodMs) + effect.periodMs) % effect.periodMs;
    for (let i = 0; i < effect.frames.length; i++) { at -= Math.max(0, effect.frames[i]!.durationMs); if (at < 0) return i; }
    return effect.frames.length - 1;
  }

  function buildBalloon(key: string, geometry: THREE.BufferGeometry): Balloon {
    const group = new THREE.Group(), float = new THREE.Group(), basket = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, host.material);
    mesh.frustumCulled = false;
    float.add(mesh);
    const [bx, by, bz] = BASKET_CELLS.pivot;
    basket.add(host.mesh(art.basket, cells(-bx, -by, -bz)));
    basket.scale.setScalar(FLOAT.basketScale);
    group.add(float, basket);
    group.name = 'emote-float';
    layer.add(group);
    return { group, float, mesh, basket, key };
  }

  function poseBalloon(b: Balloon, frame: SkyBeatFrame, effect: ApprovedEffect, made: EffectMeshes): boolean {
    const plaza = places.plaza(), t = frame.t;
    if (!plaza || t >= BB.end) return false;
    const ground = v3(plaza), castle = places.castle();
    let yaw = Math.PI * 2 * hash01(frame.seed, 41);
    if (castle) { const face = ta.subVectors(ground, v3(castle.crown)).setY(0); if (face.lengthSq() > 1) yaw = Math.atan2(face.x, face.z); }
    const across = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), facing = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const side = (hash01(frame.seed, 42) - 0.5) * 10, drifting = hash01(frame.seed, 44) < 0.5 ? -1 : 1, phase = hash01(frame.seed, 45) * Math.PI * 2;
    // High enough that its basket clears the tallest roof.
    const roofs = highestRoof();
    const altitude = Math.max(ground.y + FLOAT.altitude, roofs === null ? -Infinity : roofs + FLOAT.clearance) + 2.5 * hash01(frame.seed, 43);
    const rise = clamp01((t - BB.rise[0]) / (BB.rise[1] - BB.rise[0])), drift = clamp01((t - BB.drift[0]) / (BB.drift[1] - BB.drift[0]));
    const away = clamp01((t - BB.away[0]) / (BB.away[1] - BB.away[0]));
    const inflate = smooth(rise) * (1 - span(0.35, 1, away));
    if (inflate <= 0.01) return false;
    const [sx, sy, sz] = made.size, s = Math.max(0.5, Math.min(8, FLOAT.height / (Math.max(sx, sy) * CELL)));
    const settled = span(0.7, 1, rise);
    const centre = b.group.position.copy(ground).addScaledVector(across, side);
    centre.y = lerp(ground.y + 2.5, altitude, easeOutBack(rise, 1.1));
    centre.addScaledVector(across, drifting * (drift - 0.5) * 7 * settled).addScaledVector(facing, Math.sin(drift * Math.PI) * 1.5)
      .addScaledVector(UP, settled * 0.4 * Math.sin(Math.PI * 2 * t / 4300 + phase));
    centre.addScaledVector(UP, 16 * away * away).addScaledVector(across, drifting * 5 * away);
    // A slow turn either way of facing the town, a little roll, and squash-and-stretch as it fills.
    const stretch = bell(rise) * 0.07;
    b.group.rotation.set(0, yaw + settled * 0.42 * Math.sin(Math.PI * 2 * t / 12_000 + phase), 0);
    b.float.rotation.set(0.03 * Math.sin(Math.PI * 2 * t / 6100), 0, 0.05 * Math.sin(Math.PI * 2 * t / 5200 + phase));
    b.float.scale.set(s * inflate * (1 - stretch * 0.6), s * inflate * (1 + stretch), s * inflate * FLOAT.puff * (1 - stretch * 0.6));
    b.mesh.position.set(-sx / 2 * CELL, -sy / 2 * CELL, -sz / 2 * CELL);
    const geometry = made.geometries[frameIndex(effect, t)];
    if (geometry && b.mesh.geometry !== geometry) b.mesh.geometry = geometry;
    // The basket hangs below on its ropes and swings a beat behind the float.
    const drop = sy / 2 * CELL * s * inflate * (1 + stretch), swing = 0.11 * Math.sin(Math.PI * 2 * t / 2900 + phase + 0.6) * settled;
    b.basket.position.set(Math.sin(swing) * FLOAT.hang, -drop - FLOAT.hang * inflate * Math.cos(swing), 0);
    b.basket.rotation.set(0, 0, swing);
    b.basket.scale.setScalar(FLOAT.basketScale * inflate);
    b.group.updateMatrix(); b.basket.updateMatrix();
    const inLayer = (p: THREE.Vector3, inBasket: boolean) => (inBasket ? p.applyMatrix4(b.basket.matrix) : p).applyMatrix4(b.group.matrix);
    const rope = pool(art.threads.rope, threadCapacity('rope'));
    const halfW = sx * CELL * s * inflate * 0.2, halfD = sz * CELL * s * inflate * FLOAT.puff * 0.3;
    BASKET_CELLS.corners.forEach(([cx, cy, cz], i) => {
      const top = inLayer(new THREE.Vector3((i % 2 ? 1 : -1) * halfW, -drop * 0.92, (i < 2 ? -1 : 1) * halfD), false);
      const bottom = inLayer(new THREE.Vector3((cx - BASKET_CELLS.pivot[0]) * CELL, (cy - BASKET_CELLS.pivot[1]) * CELL, (cz - BASKET_CELLS.pivot[2]) * CELL), true);
      line(rope, top, bottom, FLOAT.ropes, 0, UP, STRING_WIDTH.rope, 1);
    });
    // The mooring line to the plaza; it is let go as the float leaves.
    const under = inLayer(new THREE.Vector3(0, -BASKET_CELLS.pivot[1] * CELL, 0), true);
    const stake = ground.clone().addScaledVector(across, side * 0.6).lerp(under, smooth(away / 0.5) * 0.85);
    line(rope, under.clone(), stake, FLOAT.tether, under.distanceTo(stake) * 0.06, facing, STRING_WIDTH.rope, 1 - span(0.5, 0.9, away));
    return true;
  }

  // ---------------------------------------------------------------- lifecycle

  const oldestFirst = (a: SkyBeatFrame, b: SkyBeatFrame) => b.t - a.t || (a.id < b.id ? -1 : 1);

  return {
    blueprints: (): readonly VoxelBlueprint[] => {
      const { beast } = art;
      return [beast.body, beast.mane, beast.head, ...beast.wingInner, ...beast.wingOuter, ...beast.tail, beast.fore, beast.hind, art.kite, art.lead,
        ...Object.values(art.bows), art.basket, ...Object.values(art.threads)];
    },
    apply(frames: readonly SkyBeatFrame[]): void {
      if (disposed) return;
      applies++;
      let focusBeast: THREE.Vector3 | null = null, focusKite: THREE.Vector3 | null = null, focusFloat: THREE.Vector3 | null = null;
      drawn = { kites: 0, motes: 0 };
      for (const p of pools.values()) p.count = 0;

      // The Hearthbeast: one per beat, the oldest first, bounded.
      const passes = frames.filter(f => f.kind === 'cheer' && f.rung === 'hearthbeast' && f.t >= 0 && f.t < HB.end).sort(oldestFirst).slice(0, BEAST.maxLive);
      const live = new Set<string>();
      for (const frame of passes) {
        const f = flight(frame);
        if (!f) continue;
        const beast = beasts.get(frame.id) ?? buildBeast();
        beasts.set(frame.id, beast);
        beast.root.visible = poseBeast(beast, frame, f);
        // Frames run oldest first, so the last one seen is the newest pass.
        if (beast.root.visible) { live.add(frame.id); focusBeast = beast.root.position.clone(); }
      }
      for (const [id, beast] of [...beasts]) if (!live.has(id)) { layer.remove(beast.root); beasts.delete(id); }

      // Kites: every beat's own leader has a reserved seat; the oldest beat's flock takes the rest of the sky and
      // a later one fills whatever is left.
      let budget: number = SKY_LIMITS.kites - KITE.maxBeats;
      for (const frame of frames.filter(f => f.kind === 'cheer' && f.rung === 'kites' && f.t >= 0 && f.t < KB.end).sort(oldestFirst).slice(0, KITE.maxBeats)) {
        const { specs, wind } = kiteSpecs(frame, budget);
        budget -= specs.filter(spec => !spec.lead).length;
        let lead: THREE.Vector3 | null = null, first: THREE.Vector3 | null = null;
        for (const spec of specs) {
          const at = drawKite(spec, frame.t, wind);
          if (at && spec.lead) lead = at;
          else if (at) first ??= at;
        }
        // The newest beat's own kite leads the shot; without one, its first kite in the air.
        focusKite = lead ?? first ?? focusKite;
      }

      // Floats: only an approved effect, meshed exactly; nothing is drawn until every frame is ready.
      const floats = new Set<string>();
      for (const frame of frames.filter(f => f.kind === 'balloon' && f.effect !== null && f.t >= 0 && f.t < BB.end).sort(oldestFirst).slice(0, SKY_LIMITS.balloons)) {
        const effect = frame.effect!, made = effectMeshes(effect);
        if (!made.ready || made.failed) continue;
        const key = `${effect.id}@${effect.revision}`;
        let b = balloons.get(frame.id);
        if (b && b.key !== key) { layer.remove(b.group); b = undefined; }
        b ??= buildBalloon(key, made.geometries[0]!);
        balloons.set(frame.id, b);
        b.group.visible = poseBalloon(b, frame, effect, made);
        if (b.group.visible) { floats.add(frame.id); focusFloat = b.group.position.clone(); }
      }
      for (const [id, b] of [...balloons]) if (!floats.has(id)) { layer.remove(b.group); balloons.delete(id); }
      // Keep a few unused effect meshes for a repeat; release the rest.
      const idle = [...effects].filter(([, e]) => e.used !== applies).sort((a, b) => b[1].used - a[1].used);
      for (const [key, e] of idle.slice(4)) { e.evicted = true; for (const g of e.geometries) g?.dispose(); effects.delete(key); }

      for (const p of pools.values()) { p.mesh.count = p.count; p.mesh.instanceMatrix.needsUpdate = true; p.fade.needsUpdate = true; }
      // The director frames the biggest flying moment: the kites' leader, then the beast, then a float.
      focusPoint = focusKite ?? focusBeast ?? focusFloat;
    },
    focus(): THREE.Vector3 | null {
      if (!focusPoint) return null;
      layer.updateWorldMatrix(true, false);
      return layer.localToWorld(focusPoint.clone());
    },
    stats: () => ({ beasts: beasts.size, kites: drawn.kites, stringMotes: drawn.motes, balloons: balloons.size }),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.remove(layer);
      for (const p of pools.values()) {
        // Hand the shared buffers back untouched: only this pool's own fade attribute is released.
        for (const name of p.shared) p.mesh.geometry.deleteAttribute(name);
        p.mesh.geometry.setIndex(null);
        p.mesh.geometry.dispose();
        p.mesh.dispose();
      }
      pools.clear();
      for (const e of effects.values()) { e.evicted = true; for (const g of e.geometries) g?.dispose(); }
      effects.clear();
      beasts.clear(); balloons.clear();
      for (const m of [eyeMaterial, emberMaterial, haloMaterial]) m.dispose();
      for (const g of [eyeGeometry, emberGeometry, haloGeometry]) g.dispose();
      focusPoint = null;
    },
  };
}
export type SkyFlightLayer = ReturnType<typeof createSkyFlightLayer>;
