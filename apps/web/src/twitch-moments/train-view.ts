import * as THREE from 'three';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { CELL } from './banner';
import { hash01, TRAIN_BEAT, type SpectacleLayer, type SpectacleLayerHost, type TrainFrame } from './spectacle';
import {
  CAR_CELLS, CORD_CELLS, CROSSHEAD_CELLS, DRIVER_CELLS, FLAG_CELLS, LID_CELLS, LOCO_CELLS, MAIN_ROD_CELLS, PUFF_CELLS, RAIL_TOP, READY_PARCEL_CELLS,
  SIDE_ROD_CELLS, TENDER_CELLS, TRACK_CELLS, WAGON_CELLS, WHEEL_CELLS, cordBlueprint, crossheadBlueprint, flagBlueprint, lidBlueprint, mainRodBlueprint,
  puffBlueprint, readyParcelBlueprint, sideRodBlueprint, trackBlueprint, trainParts, trainSet, type TrainSet, type TrainVariant,
} from './train-art';

/** Hard caps: track pieces round the loop, pennants and cord lengths over the streets, steam cubes, lit glass. */
export const TRAIN_LIMITS = { pieces: 1600, flags: 1200, cords: 1600, puffs: 200, lights: 160, loopPoints: 4096 } as const;

type Cells = readonly [number, number, number];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (u: number) => { const k = clamp01(u); return k * k * (3 - 2 * k); };
const smoothstep = (a: number, b: number, x: number) => smooth((x - a) / (b - a));
/** A toy's settle: past the mark by a hair, then home. */
const backOut = (u: number) => { const k = clamp01(u) - 1, c = 1.36; return 1 + (c + 1) * k * k * k + c * k * k; };
const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const UP = new THREE.Vector3(0, 1, 0);

/** Gap between buffers, and how far a coupling carriage rolls up from. */
const GAP = 1.5 * CELL, COUPLE_FROM = 7;
/** The train stands while it gathers on the track, then pulls away. */
const ROLL = 900;
const [AWAY_FROM, AWAY_TO] = TRAIN_BEAT.closing.away;

// ---------------------------------------------------------------- the loop

/**
 * The track as a closed loop: the supplied polyline smoothed through its own points (centripetal Catmull-Rom, so a
 * coarse ring still gives the train curves it can take) and resampled every half metre, then sampled by arc length.
 */
class Loop {
  readonly length: number;
  private readonly points: THREE.Vector3[];
  private readonly cumulative: Float64Array;
  private constructor(points: THREE.Vector3[]) {
    this.points = points;
    this.cumulative = new Float64Array(points.length + 1);
    for (let i = 0; i < points.length; i++) this.cumulative[i + 1] = this.cumulative[i]! + points[i]!.distanceTo(points[(i + 1) % points.length]!);
    this.length = this.cumulative[points.length]!;
  }
  static from(track: readonly Vec3[]): Loop | null {
    const points = track.map(v3);
    if (points.length > 2 && points[0]!.distanceTo(points.at(-1)!) < 1e-3) points.pop();
    if (points.length < 3) return null;
    const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
    curve.arcLengthDivisions = Math.min(20_000, Math.max(200, points.length * 12));
    const length = curve.getLength();
    if (!(length > 8)) return null;
    const dense = curve.getSpacedPoints(Math.min(TRAIN_LIMITS.loopPoints, Math.max(24, Math.ceil(length / 0.5))));
    dense.pop();
    return new Loop(dense);
  }
  at(distance: number, out: THREE.Vector3): THREE.Vector3 {
    const n = this.points.length, s = ((distance % this.length) + this.length) % this.length;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.cumulative[mid]! <= s) lo = mid; else hi = mid; }
    const span = this.cumulative[lo + 1]! - this.cumulative[lo]!;
    return out.copy(this.points[lo]!).lerp(this.points[(lo + 1) % n]!, span > 0 ? (s - this.cumulative[lo]!) / span : 0);
  }
  /** Shortest way round the loop between two distances. */
  gap(a: number, b: number): number { const d = Math.abs(a - b) % this.length; return Math.min(d, this.length - d); }
}

// ---------------------------------------------------------------- the clock

/** Distance covered from t0 to t while the speed eases (smoothstep) from v0 to v1 over [t0, t1], then holds v1. */
function rampDistance(t: number, t0: number, t1: number, v0: number, v1: number): number {
  if (t <= t0) return 0;
  const span = t1 - t0, tau = Math.min(t, t1) - t0, u = tau / span;
  return v0 * tau + (v1 - v0) * span * (u * u * u - u * u * u * u / 2) + (t > t1 ? v1 * (t - t1) : 0);
}
const rampSpeed = (t: number, t0: number, t1: number, v0: number, v1: number) => v0 + (v1 - v0) * smoothstep(t0, t1, t);

/**
 * Where the train is at any instant of its life, as a pure function of the frame. It stands, pulls away and runs
 * at one lap per `lapMs`; after the end it slows to a festival crawl, whistles at `away` and steams off, faster.
 */
class Timeline {
  readonly pace: number;
  readonly endAt: number;
  constructor(loopLength: number, frame: TrainFrame) {
    this.pace = loopLength / TRAIN_BEAT.lapMs;
    this.endAt = frame.closingT === null ? Infinity : frame.t - frame.closingT;
  }
  private run = (t: number) => rampDistance(t, ROLL, TRAIN_BEAT.arrive, 0, this.pace);
  private runSpeed = (t: number) => rampSpeed(t, ROLL, TRAIN_BEAT.arrive, 0, this.pace);
  private close(c: number, from: number, speed: boolean): number {
    const crawl = 0.3 * this.pace, fast = 1.7 * this.pace, slow = 1800, go = AWAY_FROM + 2600;
    if (speed) return c < slow ? rampSpeed(c, 0, slow, from, crawl) : c < AWAY_FROM ? crawl : rampSpeed(c, AWAY_FROM, go, crawl, fast);
    return rampDistance(Math.min(c, slow), 0, slow, from, crawl) + crawl * Math.min(Math.max(c - slow, 0), AWAY_FROM - slow)
      + (c > AWAY_FROM ? rampDistance(c, AWAY_FROM, go, crawl, fast) : 0);
  }
  distance(t: number): number {
    if (t <= this.endAt) return this.run(Math.max(0, t));
    return this.run(this.endAt) + this.close(t - this.endAt, this.runSpeed(this.endAt), false);
  }
  speed(t: number): number { return t <= this.endAt ? this.runSpeed(Math.max(0, t)) : this.close(t - this.endAt, this.runSpeed(this.endAt), true); }
  /** It gathers out of the air on the track, and thins away as it steams off. */
  fade(t: number): number {
    const come = smoothstep(120, 1100, t);
    return t <= this.endAt ? come : come * (1 - smoothstep(AWAY_FROM + 1000, AWAY_TO - 300, t - this.endAt));
  }
  /** Ms since the end at train time t, or null while it runs. */
  closing(t: number): number | null { return t > this.endAt ? t - this.endAt : null; }
}

// ---------------------------------------------------------------- instanced parts

/**
 * One prepared part drawn many times with the kingdom clay. The geometry is a clone of the host's prepared mesh
 * (which stays the host's), carrying its own per-instance dissolve: the clay's `aLodFade` dither.
 */
export class Pool {
  readonly mesh: THREE.InstancedMesh;
  private readonly fades: THREE.InstancedBufferAttribute;
  count = 0;
  constructor(source: THREE.BufferGeometry, material: THREE.Material, readonly capacity: number, parent: THREE.Group, name: string) {
    const geometry = source.clone();
    this.fades = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
    this.fades.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aLodFade', this.fades);
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.visible = false; this.mesh.name = name;
    parent.add(this.mesh);
  }
  push(matrix: THREE.Matrix4, fade: number): void {
    if (this.count >= this.capacity || fade <= 0.01) return;
    this.mesh.setMatrixAt(this.count, matrix);
    this.fades.setX(this.count, Math.min(1, fade));
    this.count++;
  }
  flush(): void {
    this.mesh.count = this.count; this.mesh.visible = this.count > 0;
    if (this.count > 0) { this.mesh.instanceMatrix.needsUpdate = true; this.fades.needsUpdate = true; }
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.dispose(); }
}

/** Lit glass: a core of plain light and an additive halo around it, both owned here. */
class Lights {
  readonly core: THREE.InstancedMesh;
  readonly halo: THREE.InstancedMesh;
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly coreMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  private readonly haloMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  private readonly scratch = new THREE.Color();
  count = 0;
  constructor(parent: THREE.Group, readonly capacity: number) {
    this.core = this.instanced(this.coreMaterial, 'train-lights');
    this.halo = this.instanced(this.haloMaterial, 'train-halo');
    this.halo.renderOrder = 2;
    parent.add(this.core, this.halo);
  }
  private instanced(material: THREE.Material, name: string): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, material, this.capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false; mesh.name = name;
    return mesh;
  }
  /** `core` and `halo` are matrices of unit boxes; the halo is dimmed by `glow`, which reaching 0 hides it. */
  push(core: THREE.Matrix4, halo: THREE.Matrix4, colour: THREE.Color, glow: number): void {
    if (this.count >= this.capacity) return;
    this.core.setMatrixAt(this.count, core); this.core.setColorAt(this.count, colour);
    this.halo.setMatrixAt(this.count, halo); this.halo.setColorAt(this.count, this.scratch.copy(colour).multiplyScalar(glow));
    this.count++;
  }
  flush(): void {
    for (const mesh of [this.core, this.halo]) {
      mesh.count = this.count; mesh.visible = this.count > 0;
      if (this.count > 0) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true; }
    }
  }
  dispose(): void {
    this.core.removeFromParent(); this.halo.removeFromParent();
    this.core.dispose(); this.halo.dispose(); this.geometry.dispose(); this.coreMaterial.dispose(); this.haloMaterial.dispose();
  }
}

const LANTERN: Record<TrainVariant, readonly THREE.Color[]> = {
  festival: ['#ffcf73', '#ffad5a', '#ffe4b0'].map(c => new THREE.Color(c)),
  golden: ['#ffe199', '#fff0c8', '#ffd27c'].map(c => new THREE.Color(c)),
};
const HEADLAMP = new THREE.Color('#fff2d2'), FIREBOX = new THREE.Color('#ff8436'), LEAD_EMPTY = new THREE.Color('#c4652a'), LEAD_FULL = new THREE.Color('#ffd86e');

type CarKind = 'loco' | 'tender' | 'wagon' | 'carriage';
interface CarSpec { readonly kind: CarKind; readonly cells: number; readonly pivot: Cells; readonly half: number }
const SPECS: Record<CarKind, CarSpec> = {
  loco: { kind: 'loco', cells: LOCO_CELLS.length, pivot: LOCO_CELLS.pivot, half: 0.3 * LOCO_CELLS.length * CELL },
  tender: { kind: 'tender', cells: TENDER_CELLS.length, pivot: TENDER_CELLS.pivot, half: 0.3 * TENDER_CELLS.length * CELL },
  wagon: { kind: 'wagon', cells: WAGON_CELLS.length, pivot: WAGON_CELLS.pivot, half: 0.32 * WAGON_CELLS.length * CELL },
  carriage: { kind: 'carriage', cells: CAR_CELLS.length, pivot: CAR_CELLS.pivot, half: 0.32 * CAR_CELLS.length * CELL },
};

interface Flag { readonly position: THREE.Vector3; readonly yaw: number; readonly colour: number; readonly order: number; readonly phase: number }
interface Cord { readonly matrix: THREE.Matrix4; readonly order: number }

export type TrainLayer = SpectacleLayer<TrainFrame | null> & {
  focus(): THREE.Vector3 | null;
  nameplates(): readonly { name: string; position: THREE.Vector3 }[];
};

/**
 * The Hype Train on its track round the town, and the bunting over the streets. Everything is instanced, bounded
 * by TRAIN_LIMITS and posed from the frame alone, except the chest lid, which opens from the moment it is told to.
 * With no supplied track the train and its rails do not appear at all.
 */
export function createTrainLayer(root: THREE.Group, host: SpectacleLayerHost): TrainLayer {
  const layer = new THREE.Group();
  layer.name = 'hype-train';
  root.add(layer);
  const pools = new Map<string, Pool>();
  const lights = new Lights(layer, TRAIN_LIMITS.lights);
  const sets: Record<TrainVariant, TrainSet> = { festival: trainSet(host.kit, 'festival'), golden: trainSet(host.kit, 'golden') };
  const parts = {
    sideRod: sideRodBlueprint(host.kit), mainRod: mainRodBlueprint(host.kit), crosshead: crossheadBlueprint(host.kit), lid: lidBlueprint(host.kit),
    parcels: Array.from({ length: READY_PARCEL_CELLS.kinds }, (_, i) => readyParcelBlueprint(host.kit, i)),
    track: trackBlueprint(host.kit), flags: Array.from({ length: FLAG_CELLS.colours }, (_, i) => flagBlueprint(host.kit, i)),
    cord: cordBlueprint(host.kit), puff: puffBlueprint(host.kit),
  };

  let key: string | null = null, openedAt: number | null = null;
  let loopCache: { signature: string; loop: Loop | null; rails: { matrices: Float32Array; distances: Float64Array } | null } | null = null;
  let buntingCache: { signature: string; flags: Flag[]; cords: Cord[] } | null = null;
  let focus: THREE.Vector3 | null = null;
  let plates: { name: string; position: THREE.Vector3 }[] = [];
  let counts = { cars: 0, rails: 0, flags: 0, cords: 0, puffs: 0, lights: 0 };

  const m = new THREE.Matrix4(), tmp = new THREE.Matrix4(), rot = new THREE.Matrix4(), out = new THREE.Matrix4(), halo = new THREE.Matrix4();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), s3 = new THREE.Vector3();
  const colour = new THREE.Color();

  function pool(blueprint: VoxelBlueprint, capacity: number): Pool {
    let found = pools.get(blueprint.id);
    if (!found) {
      found = new Pool(host.mesh(blueprint, new THREE.Vector3()).geometry, host.material, capacity, layer, blueprint.id);
      pools.set(blueprint.id, found);
    }
    return found;
  }

  // ---------------------------------------------------------------- caches

  function currentLoop() {
    const track = host.places.track();
    let signature = 'none';
    if (track) {
      let sum = 0;
      for (const [x, y, z] of track) sum += x * 1.31 + y * 0.77 + z * 2.03;
      signature = `${track.length}:${sum.toFixed(3)}`;
    }
    if (loopCache?.signature !== signature) loopCache = { signature, loop: track ? Loop.from(track) : null, rails: null };
    return loopCache;
  }

  /** Track pieces end to end round the loop, each set along its own chord; a hair longer only past the piece cap. */
  function rails(loop: Loop) {
    const cache = loopCache!;
    if (cache.rails) return cache.rails;
    const count = Math.min(TRAIN_LIMITS.pieces, Math.max(8, Math.round(loop.length / (TRACK_CELLS.length * CELL))));
    const pitch = loop.length / count, stretch = pitch / (TRACK_CELLS.length * CELL);
    const matrices = new Float32Array(count * 16), distances = new Float64Array(count);
    const [px, py, pz] = TRACK_CELLS.pivot;
    for (let j = 0; j < count; j++) {
      const at = (j + 0.5) * pitch;
      loop.at(at + pitch / 2, a); loop.at(at - pitch / 2, b); loop.at(at, p);
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      e.set(0, Math.atan2(-dz, dx), Math.atan2(dy, Math.hypot(dx, dz)), 'YZX');
      out.compose(p, q.setFromEuler(e), s3.set(stretch, 1, 1)).multiply(tmp.makeTranslation(-px * CELL, -py * CELL, -pz * CELL));
      out.toArray(matrices, j * 16);
      distances[j] = at;
    }
    cache.rails = { matrices, distances };
    return cache.rails;
  }

  /** Pennants hung along each supplied run: a sagging cord per span, flags spaced along it in the kingdom's colours. */
  function bunting() {
    const runs = host.places.bunting();
    let sum = 0, n = 0;
    for (const run of runs) for (const [x, y, z] of run) { sum += x * 1.31 + y * 0.77 + z * 2.03; n++; }
    const signature = `${runs.length}:${n}:${sum.toFixed(3)}`;
    if (buntingCache?.signature === signature) return buntingCache;
    const flags: Flag[] = [], cords: Cord[] = [];
    runs.forEach((run, r) => {
      const points = run.map(v3);
      let total = 0;
      for (let i = 1; i < points.length; i++) total += points[i]!.distanceTo(points[i - 1]!);
      if (total <= 0) return;
      let along = 0, colourIndex = 0;
      for (let i = 1; i < points.length; i++) {
        const from = points[i - 1]!, to = points[i]!, span = from.distanceTo(to);
        if (span < 0.3) { along += span; continue; }
        const sag = Math.min(1, 0.035 * span + 0.1);
        const curve = (u: number, target: THREE.Vector3) => target.copy(from).lerp(to, u).addScaledVector(UP, -sag * 4 * u * (1 - u));
        const segments = Math.min(32, Math.max(2, Math.ceil(span / 0.5)));
        for (let k = 0; k < segments && cords.length < TRAIN_LIMITS.cords; k++) {
          curve(k / segments, a); curve((k + 1) / segments, b);
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, length = Math.hypot(dx, dy, dz);
          e.set(0, Math.atan2(-dz, dx), Math.atan2(dy, Math.hypot(dx, dz)), 'YZX');
          const matrix = new THREE.Matrix4().compose(a, q.setFromEuler(e), s3.set(length / (CORD_CELLS.length * CELL), 1, 1))
            .multiply(tmp.makeTranslation(0, -CORD_CELLS.pivot[1] * CELL, -CORD_CELLS.pivot[2] * CELL));
          cords.push({ matrix, order: (along + span * (k + 0.5) / segments) / total });
        }
        const yaw = Math.atan2(-(to.z - from.z), to.x - from.x), count = Math.max(1, Math.floor(span / 0.72));
        for (let k = 0; k < count && flags.length < TRAIN_LIMITS.flags; k++) {
          const u = (k + 0.5) / count, order = (along + span * u) / total;
          flags.push({ position: curve(u, new THREE.Vector3()).addScaledVector(UP, -0.5 * CELL), yaw, colour: colourIndex++ % FLAG_CELLS.colours, order,
            phase: hash01(r * 7919 + flags.length, 11) * Math.PI * 2 + order * 14 });
        }
        along += span;
      }
    });
    buntingCache = { signature, flags, cords };
    return buntingCache;
  }

  // ---------------------------------------------------------------- placing

  /** The car standing on the loop with its bogies at s ± half: its matrix at the rail top, lifted and rolled. */
  function carMatrix(loop: Loop, s: number, half: number, lift: number, roll: number, pitchJolt: number, target: THREE.Matrix4): THREE.Matrix4 {
    loop.at(s + half, a); loop.at(s - half, b);
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    p.copy(a).add(b).multiplyScalar(0.5);
    p.y += RAIL_TOP * CELL + lift;
    e.set(roll, Math.atan2(-dz, dx), Math.atan2(dy, Math.hypot(dx, dz)) + pitchJolt, 'YZX');
    return target.compose(p, q.setFromEuler(e), s3.set(1, 1, 1));
  }

  /** A part at car cell `at` (blueprint coordinates), turned about its own pivot. */
  function place(target: Pool, base: THREE.Matrix4, carPivot: Cells, at: Cells, pivot: Cells, angle: number, axis: 'x' | 'z', fade: number): void {
    out.copy(base).multiply(tmp.makeTranslation((at[0] - carPivot[0]) * CELL, (at[1] - carPivot[1]) * CELL, (at[2] - carPivot[2]) * CELL));
    if (angle !== 0) out.multiply(axis === 'z' ? rot.makeRotationZ(angle) : rot.makeRotationX(angle));
    target.push(out.multiply(tmp.makeTranslation(-pivot[0] * CELL, -pivot[1] * CELL, -pivot[2] * CELL)), fade);
  }

  /** A lit glass at car cell `at`, `size` cells, with a halo `spread` cells across. */
  function light(base: THREE.Matrix4, carPivot: Cells, at: Cells, size: Cells, spread: number, tint: THREE.Color, glow: number, fade: number): void {
    if (fade <= 0.02) return;
    const x = (at[0] - carPivot[0]) * CELL, y = (at[1] - carPivot[1]) * CELL, z = (at[2] - carPivot[2]) * CELL;
    out.copy(base).multiply(tmp.makeTranslation(x, y, z)).multiply(rot.makeScale(size[0] * CELL * fade, size[1] * CELL * fade, size[2] * CELL * fade));
    halo.copy(base).multiply(tmp.makeTranslation(x, y, z)).multiply(rot.makeScale(spread * CELL, spread * CELL, spread * CELL));
    lights.push(out, halo, tint, glow * fade);
  }

  const cellPoint = (base: THREE.Matrix4, carPivot: Cells, at: Cells) =>
    new THREE.Vector3((at[0] - carPivot[0]) * CELL, (at[1] - carPivot[1]) * CELL, (at[2] - carPivot[2]) * CELL).applyMatrix4(base);

  // ---------------------------------------------------------------- the train

  function drawTrain(frame: TrainFrame, loop: Loop, clock: Timeline, atMs: number): void {
    const t = frame.t, fade = clock.fade(t);
    if (fade <= 0.01) return;
    const variant: TrainVariant = frame.golden ? 'golden' : 'festival', set = sets[variant];
    const carriages = Math.max(0, Math.min(TRAIN_BEAT.carriages, Math.floor(frame.carriages)));
    const consist: CarSpec[] = [SPECS.loco, SPECS.tender, ...(frame.treasure ? [SPECS.wagon] : []), ...Array.from({ length: carriages }, () => SPECS.carriage)];
    const pace = Math.min(1.7, clock.speed(t) / clock.pace);
    const names = frame.names.slice(0, TRAIN_BEAT.names);

    // The newest carriage rolls up from behind, meets the buffers with a bump and settles.
    let extra = 0, jolt = 0, arriving = 1;
    if (carriages > 0 && frame.coupling !== null && frame.coupling < TRAIN_BEAT.couple) {
      const u = frame.coupling / TRAIN_BEAT.couple, contact = 0.55;
      arriving = smoothstep(0, 0.22, u);
      if (u < contact) { const x = u / contact; extra = COUPLE_FROM * (1 - x) * (1 - 0.6 * x); }
      else { const w = (u - contact) / (1 - contact); extra = -0.1 * Math.sin(w * Math.PI * 2.5) * Math.exp(-4 * w); jolt = 0.035 * Math.sin(w * Math.PI * 3) * Math.exp(-4 * w); }
    }

    let s = clock.distance(t), carriage = 0;
    for (let i = 0; i < consist.length; i++) {
      const car = consist[i]!, newest = car.kind === 'carriage' && carriage === carriages - 1, ahead = i === consist.length - 2 && carriages > 0;
      if (i > 0) s -= consist[i - 1]!.cells * CELL / 2 + GAP + car.cells * CELL / 2 + (newest ? extra : 0);
      const carFade = fade * (newest ? arriving : 1);
      const lift = pace * (0.011 * Math.sin(s * 4.3 + i * 1.9) + 0.005 * Math.sin(s * 11.7 + i)) * (car.kind === 'loco' ? 0.6 : 1);
      const roll = Math.min(1, pace) * 0.009 * Math.sin(s * 2.9 + i * 2.4);
      carMatrix(loop, s, car.half, lift, roll, newest ? jolt : ahead ? -jolt * 0.4 : 0, m);
      const flicker = (k: number) => 0.9 + 0.1 * Math.sin(t * 0.011 + k * 2.1) * Math.sin(t * 0.0047 + k * 0.7);
      if (car.kind === 'loco') {
        place(pool(set.loco, 1), m, car.pivot, car.pivot, LOCO_CELLS.pivot, 0, 'z', carFade);
        drawLoco(set, m, s, carFade, frame.progress, t);
        focus = cellPoint(m, car.pivot, [car.pivot[0], 10, car.pivot[2]]);
        light(m, car.pivot, LOCO_CELLS.headlamp, [0.6, 1, 2], 6, HEADLAMP, 0.32, carFade);
        light(m, car.pivot, LOCO_CELLS.firebox, [0.4, 2, 3], 4, colour.copy(FIREBOX).multiplyScalar(flicker(91)), 0.3, carFade);
      } else if (car.kind === 'tender') {
        place(pool(set.tender, 1), m, car.pivot, car.pivot, TENDER_CELLS.pivot, 0, 'z', carFade);
        wheels(set, m, car.pivot, TENDER_CELLS.wheels, s, carFade);
      } else if (car.kind === 'wagon') {
        place(pool(set.wagon, 1), m, car.pivot, car.pivot, WAGON_CELLS.pivot, 0, 'z', carFade);
        wheels(set, m, car.pivot, WAGON_CELLS.wheels, s, carFade);
        drawChest(m, carFade, frame.treasureOpen, atMs);
        WAGON_CELLS.lanterns.forEach((at, k) => light(m, car.pivot, at, [0.9, 0.9, 0.9], 3, colour.copy(LANTERN[variant][k % 3]!).multiplyScalar(flicker(60 + k)), 0.22, carFade));
      } else {
        place(pool(set.carriage, TRAIN_BEAT.carriages), m, car.pivot, car.pivot, CAR_CELLS.pivot, 0, 'z', carFade);
        wheels(set, m, car.pivot, CAR_CELLS.wheels, s, carFade);
        // The lanterns light one after another as the carriage arrives.
        CAR_CELLS.lanterns.forEach((at, k) => {
          const lit = newest ? smoothstep(0.2 + k * 0.03, 0.4 + k * 0.03, (frame.coupling ?? TRAIN_BEAT.couple) / TRAIN_BEAT.couple) : 1;
          light(m, car.pivot, at, [0.9, 0.9, 0.9], 3, colour.copy(LANTERN[variant][(k + carriage) % 3]!).multiplyScalar(flicker(carriage * 13 + k)), 0.22, carFade * lit);
        });
        const name = names[carriage];
        if (name !== undefined && carFade > 0.5) plates.push({ name, position: cellPoint(m, car.pivot, CAR_CELLS.nameplate) });
        carriage++;
      }
      counts.cars++;
    }
  }

  function wheels(set: TrainSet, base: THREE.Matrix4, carPivot: Cells, xs: readonly number[], s: number, fade: number): void {
    const target = pool(set.wheel, 96), angle = -s / (WHEEL_CELLS.radius * CELL);
    for (const x of xs) for (const z of CAR_CELLS.wheelZ) place(target, base, carPivot, [x, WHEEL_CELLS.radius, z + 0.5], WHEEL_CELLS.pivot, angle, 'z', fade);
  }

  /** Driving wheels, trucks and the motion: side rods ride the crank pins, main rods drive the crossheads, quartered. */
  function drawLoco(set: TrainSet, base: THREE.Matrix4, s: number, fade: number, progress: number, t: number): void {
    const pivot = LOCO_CELLS.pivot, theta = -s / (DRIVER_CELLS.radius * CELL), c = LOCO_CELLS.crank, axle = LOCO_CELLS.axle;
    const drivers = pool(set.driver, 4), carrying = pool(set.wheel, 96);
    for (const [x, y] of LOCO_CELLS.drivers) for (const z of LOCO_CELLS.wheelZ) place(drivers, base, pivot, [x, y, z + 0.5], DRIVER_CELLS.pivot, theta, 'z', fade);
    const small = -s / (WHEEL_CELLS.radius * CELL);
    for (const [x, y] of LOCO_CELLS.carrying) for (const z of LOCO_CELLS.wheelZ) place(carrying, base, pivot, [x, y, z + 0.5], WHEEL_CELLS.pivot, small, 'z', fade);
    const [rear, front] = LOCO_CELLS.drivers;
    for (let side = 0; side < 2; side++) {
      const phi = theta + side * Math.PI / 2, cx = Math.cos(phi) * c, cy = Math.sin(phi) * c;
      place(pool(parts.sideRod, 2), base, pivot, [rear[0] + cx, rear[1] + cy, LOCO_CELLS.sideRodZ[side]! + 0.5], SIDE_ROD_CELLS.pivot, 0, 'z', fade);
      const px = front[0] + cx, py = front[1] + cy, reach = Math.sqrt(LOCO_CELLS.mainRod ** 2 - (axle - py) ** 2), head = px + reach;
      const z = LOCO_CELLS.mainRodZ[side]! + 0.5;
      place(pool(parts.mainRod, 2), base, pivot, [px, py, z], MAIN_ROD_CELLS.pivot, Math.atan2(axle - py, reach), 'z', fade);
      place(pool(parts.crosshead, 2), base, pivot, [head, axle, z], CROSSHEAD_CELLS.pivot, 0, 'z', fade);
    }
    // The lead lantern fills from its floor with the level's progress, and breathes when it is full.
    const fill = clamp01(progress), { base: at, height, width } = LOCO_CELLS.lead, h = Math.max(0.12, fill * height);
    const full = fill >= 0.999 ? 0.82 + 0.18 * Math.sin(t * 0.008) : 1;
    colour.copy(LEAD_EMPTY).lerp(LEAD_FULL, fill).multiplyScalar(full);
    light(base, pivot, [at[0], at[1] + h / 2, at[2]], [width * 0.95, h, width * 0.95], 5 + 2 * fill, colour, 0.12 + 0.3 * fill, fade);
  }

  /** The chest opens from the instant the frame first says so; parcels pop out to stand ready on the bed. */
  function drawChest(base: THREE.Matrix4, fade: number, open: boolean, atMs: number): void {
    const pivot = WAGON_CELLS.pivot;
    if (!open) openedAt = null;
    else openedAt ??= atMs;
    const since = openedAt === null ? 0 : atMs - openedAt;
    const lid = openedAt === null ? 0 : backOut(since / 900);
    place(pool(parts.lid, 1), base, pivot, WAGON_CELLS.hinge, LID_CELLS.pivot, -WAGON_CELLS.open * lid, 'x', fade);
    if (openedAt === null) return;
    WAGON_CELLS.seats.forEach((seat, i) => {
      const k = clamp01((since - 500 - i * 160) / 520);
      if (k <= 0) return;
      const ease = smooth(k), from = WAGON_CELLS.from;
      const at: Cells = [from[0] + (seat[0] - from[0]) * ease, from[1] + (seat[1] - from[1]) * ease + Math.sin(Math.PI * k) * 6, from[2] + (seat[2] - from[2]) * ease];
      place(pool(parts.parcels[i % READY_PARCEL_CELLS.kinds]!, 4), base, pivot, at, READY_PARCEL_CELLS.pivot, (hash01(i, 5) - 0.5) * 0.5 * ease, 'x', fade);
    });
  }

  // ---------------------------------------------------------------- steam

  /**
   * Steam as a pure function of the clock: one emission slot every 100 ms, each placed where the stack was at its
   * own instant. A chuff (a quarter turn of the drivers) is a strong puff; between them the stack breathes. The
   * cylinder cocks blow sideways as it pulls away and as it steams off; the whistle plumes on arrival and farewell.
   */
  function drawSteam(frame: TrainFrame, loop: Loop, clock: Timeline): void {
    const slot = 100, life = 2800, t = frame.t, target = pool(parts.puff, TRAIN_LIMITS.puffs);
    const chuff = Math.PI * 2 * DRIVER_CELLS.radius * CELL / 4, wind = new THREE.Vector3(0.28, 0, 0.12), side = new THREE.Vector3();
    const pivot = LOCO_CELLS.pivot, half = SPECS.loco.half, pose = new THREE.Matrix4();
    const emit = (origin: THREE.Vector3, velocity: THREE.Vector3, drag: number, rise: number, age: number, lifeMs: number, size0: number, size1: number, fade: number, seed: number) => {
      const sec = age / 1000, k = (1 - Math.exp(-drag * sec)) / drag;
      p.copy(origin).addScaledVector(velocity, k).addScaledVector(UP, rise * sec).addScaledVector(wind, sec);
      const size = size0 + (size1 - size0) * (1 - Math.exp(-1.4 * sec));
      e.set(hash01(seed, 21) * Math.PI, hash01(seed, 22) * Math.PI + sec * 0.6, 0);
      out.compose(p, q.setFromEuler(e), s3.set(size, size, size)).multiply(tmp.makeTranslation(-PUFF_CELLS.pivot[0] * CELL, -PUFF_CELLS.pivot[1] * CELL, -PUFF_CELLS.pivot[2] * CELL));
      target.push(out, fade * (1 - smoothstep(0.35, 1, age / lifeMs)));
    };
    for (let k = Math.floor(t / slot); k >= Math.max(0, Math.ceil((t - life) / slot)) && target.count < target.capacity; k--) {
      const at = k * slot, age = t - at, strength = clock.fade(at), closing = clock.closing(at);
      if (strength <= 0.05 || (closing !== null && closing > AWAY_TO)) continue;
      const pace = clock.speed(at) / clock.pace;
      carMatrix(loop, clock.distance(at), half, 0, 0, 0, pose);
      const strong = Math.floor(clock.distance(at) / chuff) > Math.floor(clock.distance(at - slot) / chuff);
      const cubes = strong ? 3 : pace < 0.12 ? (k % 2 === 0 ? 1 : 0) : (k % 3 === 0 ? 1 : 0);
      const stack = cellPoint(pose, pivot, LOCO_CELLS.chimney);
      for (let j = 0; j < cubes; j++) {
        const seed = k * 16 + j;
        const velocity = new THREE.Vector3((hash01(seed, 1) - 0.5) * 0.5, (strong ? 1.5 : 0.9) + 0.5 * hash01(seed, 2), (hash01(seed, 3) - 0.5) * 0.5);
        emit(stack, velocity, 1.6, 0.3, age, life, strong ? 0.5 : 0.32, strong ? 1.35 : 0.8, strength, seed);
      }
      const cocks = (at >= ROLL - 200 && at <= 3600) || (closing !== null && closing >= AWAY_FROM - 100 && closing <= AWAY_FROM + 2200);
      if (cocks && age < 1300) {
        LOCO_CELLS.cocks.forEach((cell, j) => {
          const seed = k * 16 + 8 + j;
          side.set(0, 0, j === 0 ? -1 : 1).transformDirection(pose).multiplyScalar(1.6 + 0.6 * hash01(seed, 4));
          emit(cellPoint(pose, pivot, cell), side, 3, 0.25, age, 1300, 0.25, 0.75, strength, seed);
        });
      }
      const whistle = (at >= 300 && at <= 1300) || (closing !== null && closing >= AWAY_FROM - 300 && closing <= AWAY_FROM + 1100);
      if (whistle && age < 1500) {
        const seed = k * 16 + 12;
        emit(cellPoint(pose, pivot, LOCO_CELLS.whistle), new THREE.Vector3((hash01(seed, 6) - 0.5) * 0.3, 2.4, (hash01(seed, 7) - 0.5) * 0.3), 2.5, 0.2, age, 1500, 0.15, 0.4, strength, seed);
      }
    }
    counts.puffs = target.count;
  }

  // ---------------------------------------------------------------- rails and bunting

  /**
   * Rails lay themselves out from under the standing train both ways round the loop, each piece rising out of the
   * ground and settling; after the train has gone they lift away from the far side, closing on where it left.
   */
  function drawRails(frame: TrainFrame, loop: Loop, clock: Timeline): void {
    const { matrices, distances } = rails(loop), target = pool(parts.track, TRAIN_LIMITS.pieces);
    const trainLength = (LOCO_CELLS.length + TENDER_CELLS.length + TRAIN_BEAT.carriages * CAR_CELLS.length) * CELL, halfLoop = loop.length / 2;
    const closing = frame.closingT, vanish = closing === null ? 0 : clock.distance(clock.endAt + AWAY_TO);
    for (let j = 0; j < distances.length; j++) {
      const s = distances[j]!;
      const inAt = 100 + 1800 * loop.gap(s, -trainLength / 2) / halfLoop;
      let r = clamp01((frame.t - inAt) / 420);
      if (closing !== null) r = Math.min(r, 1 - clamp01((closing - (8500 + 1500 * (1 - loop.gap(s, vanish) / halfLoop))) / 360));
      if (r <= 0) continue;
      out.fromArray(matrices, j * 16);
      if (r < 1) out.elements[13]! -= 0.3 * (1 - backOut(r));
      target.push(out, clamp01(r * 1.6));
    }
    counts.rails = target.count;
  }

  /** Flags rise into place along each run in order and unfurl with a little overshoot; they come down the same way. */
  function drawBunting(frame: TrainFrame): void {
    const amount = clamp01(frame.bunting);
    if (amount <= 0) return;
    const { flags, cords } = bunting(), t = frame.t;
    const cordPool = pool(parts.cord, TRAIN_LIMITS.cords);
    for (const cord of cords) {
      const r = clamp01((amount - 0.55 * cord.order) / 0.2);
      if (r > 0) cordPool.push(cord.matrix, r);
    }
    const flagPools = parts.flags.map(flag => pool(flag, Math.ceil(TRAIN_LIMITS.flags / FLAG_CELLS.colours) + 1));
    const [px, py, pz] = FLAG_CELLS.pivot;
    for (const flag of flags) {
      const r = clamp01((amount - 0.6 * flag.order) / 0.4);
      if (r <= 0) continue;
      const flutter = (0.2 * Math.sin(t * 0.0024 + flag.phase) + 0.09 * Math.sin(t * 0.0061 + flag.phase * 1.7)) * (0.4 + 0.6 * r);
      e.set(flutter, flag.yaw + 0.08 * Math.sin(t * 0.0017 + flag.phase), 0, 'YXZ');
      out.compose(flag.position, q.setFromEuler(e), s3.set(0.5 + 0.5 * smooth(r), Math.max(0.02, backOut(r)), 1))
        .multiply(tmp.makeTranslation(-px * CELL, -py * CELL, -pz * CELL));
      flagPools[flag.colour]!.push(out, clamp01(r * 2));
    }
    counts.cords = cordPool.count;
    counts.flags = flagPools.reduce((n, flag) => n + flag.count, 0);
  }

  // ---------------------------------------------------------------- lifecycle

  function clear(): void {
    for (const found of pools.values()) found.dispose();
    pools.clear();
    lights.count = 0; lights.flush();
    loopCache = null; buntingCache = null; key = null; openedAt = null; focus = null; plates = [];
    counts = { cars: 0, rails: 0, flags: 0, cords: 0, puffs: 0, lights: 0 };
  }

  return {
    blueprints: () => trainParts(host.kit),
    apply(frame: TrainFrame | null, atMs: number): void {
      if (!frame) { if (pools.size > 0 || key !== null) clear(); return; }
      if (frame.key !== key) { key = frame.key; openedAt = null; }
      for (const found of pools.values()) found.count = 0;
      lights.count = 0;
      focus = null; plates = [];
      counts = { cars: 0, rails: 0, flags: 0, cords: 0, puffs: 0, lights: 0 };
      const loop = currentLoop().loop;
      if (loop) {
        const clock = new Timeline(loop.length, frame);
        drawRails(frame, loop, clock);
        drawTrain(frame, loop, clock, atMs);
        drawSteam(frame, loop, clock);
      }
      drawBunting(frame);
      for (const found of pools.values()) found.flush();
      lights.flush();
      counts.lights = lights.count;
      layer.updateWorldMatrix(true, false);
      focus = focus && layer.localToWorld(focus);
      for (const plate of plates) layer.localToWorld(plate.position);
    },
    stats: () => ({ ...counts }),
    focus: () => focus?.clone() ?? null,
    nameplates: () => plates.map(plate => ({ name: plate.name, position: plate.position.clone() })),
    dispose(): void { clear(); lights.dispose(); root.remove(layer); },
  };
}
