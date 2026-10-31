import * as THREE from 'three';
import type { Vec3 } from '@chatdom/shared';
import { dustPose, emberPose, emptyPose, fireflyPose, shaftFrame, type ShaftFrame } from './ambient';
import { EFFECTS_BUDGET, glowCapacity, isQuality, maxCoveragePixels, smokeCapacity, type FamilyBudget } from './budget';
import { SPARK_SECONDS, createTrack, emitFlight, sparkPose, TRAIL_SECONDS } from './cues';
import { GlowLayer } from './glow-layer';
import { hashString, mix32, seedHash, slotKey } from './random';
import { emptySmoke, smokePose, SmokeLayer, SMOKE_SECONDS } from './smoke';
import type { Effects, EffectsDiagnostics, EffectsFrame, EffectsQuality, FlightCue } from './types';

export type { Effects, EffectsDiagnostics, EffectsFrame, EffectsQuality, EffectSource, FlightCue, FlightSample, ShaftSource, SparkBurst } from './types';
export { EFFECTS_BUDGET, EFFECTS_QUALITIES, glowCapacity, smokeCapacity, maxCoveragePixels } from './budget';
export { SPARK_SECONDS, TRAIL_SECONDS } from './cues';
export { SMOKE_SECONDS } from './smoke';
export * from './adapters';

const KIND = { firefly: 0x1f1e, ember: 0xe3b0, smoke: 0x5e0c, dust: 0xd057, spark: 0x59a4, flight: 0xf117 } as const;
type Family = 'fireflies' | 'embers' | 'smoke' | 'dust' | 'sparks';
const MAX_ID_LENGTH = 256;
/** Per family, at most this many entries of a frame's array are read; the rest are counted as skipped. */
const MAX_INPUT = 2048;
/** Recent flight samples read per frame (the newest), and bursts remembered at once. */
const MAX_HISTORY = 512, MAX_REMEMBERED = 256;
const MAX_SHAFT = { length: 64, radius: 16 };

interface Candidate {
  id: string; key: number; x: number; y: number; z: number; distance: number;
  /** Dust: unit axis, length and radius. Sparks: the burst's latched start. */
  dx: number; dy: number; dz: number; length: number; radius: number; startedAt: number;
}

const finiteVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Number.isFinite(value[2]);
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;

/** Of two inputs with the same identity, the one with the smaller (position, …) tuple wins: input order never matters. */
function before(a: Candidate, b: Candidate): boolean {
  if (a.x !== b.x) return a.x < b.x;
  if (a.y !== b.y) return a.y < b.y;
  if (a.z !== b.z) return a.z < b.z;
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt;
  if (a.dx !== b.dx) return a.dx < b.dx;
  if (a.dy !== b.dy) return a.dy < b.dy;
  if (a.dz !== b.dz) return a.dz < b.dz;
  if (a.length !== b.length) return a.length < b.length;
  return a.radius < b.radius;
}
const nearest = (a: Candidate, b: Candidate) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The effects library: one deterministic vocabulary of small lights and air for the existing HDR scene. The caller
 * owns the scene, camera and every input; this owns two transparent draws (glints and smoke voxels) and nothing else.
 */
export function createEffects(options: { scene: THREE.Scene; camera: THREE.Camera; seed: number; quality: EffectsQuality }): Effects {
  const { scene, camera } = options;
  const seed = seedHash(options.seed);
  let quality: EffectsQuality = isQuality(options.quality) ? options.quality : 'balanced';
  let disposed = false, idle = true;
  const glow = new GlowLayer(glowCapacity(quality), EFFECTS_BUDGET[quality].glow);
  const smoke = new SmokeLayer(smokeCapacity(quality), EFFECTS_BUDGET[quality].smokePixels);
  scene.add(smoke.mesh, glow.mesh);

  const keys = new Map<string, number>();
  const sourceKey = (id: string) => {
    let key = keys.get(id);
    if (key === undefined) {
      if (keys.size >= 4096) keys.clear();
      key = hashString(id); keys.set(id, key);
    }
    return key;
  };
  /** burstId → the start first seen for it. Transient: `reset` forgets, so a replay from the start is exact. */
  const latched = new Map<string, number>();
  const pool: Candidate[] = [];
  const candidate = (i: number) => pool[i] ??= { id: '', key: 0, x: 0, y: 0, z: 0, distance: 0, dx: 0, dy: 0, dz: 0, length: 0, radius: 0, startedAt: 0 };
  const byId = new Map<string, Candidate>();
  const picked: Candidate[] = [];
  const pose = emptyPose(), puff = emptySmoke();
  const shaft = {} as ShaftFrame;
  const track = createTrack(MAX_HISTORY + 1);
  const order = Array.from({ length: MAX_HISTORY }, (_, i) => i);
  const scratch = { times: new Float64Array(MAX_HISTORY), xs: new Float64Array(MAX_HISTORY), ys: new Float64Array(MAX_HISTORY), zs: new Float64Array(MAX_HISTORY) };
  const head = { x: 0, y: 0, z: 0 };
  const eye = new THREE.Vector3(), viewProjection = new THREE.Matrix4(), frustum = new THREE.Frustum(), sphere = new THREE.Sphere();
  const counts = { fireflies: 0, embers: 0, smoke: 0, dust: 0, sparks: 0, flight: 0, skipped: 0, smokeSkipped: 0 };
  let time = 0, wx = 0, wz = 0;

  /** Reads one input entry into a candidate, or returns false when it is malformed. */
  function read(family: Family, input: unknown, c: Candidate): boolean {
    const s = input as { id?: unknown; position?: unknown; direction?: unknown; length?: unknown; radius?: unknown; burstId?: unknown; startedAt?: unknown } | null;
    if (!s || typeof s !== 'object' || !validId(s.id) || !finiteVec3(s.position)) return false;
    c.id = s.id; [c.x, c.y, c.z] = s.position;
    c.dx = 0; c.dy = 0; c.dz = 0; c.length = 0; c.radius = 0; c.startedAt = 0;
    if (family === 'dust') {
      const { direction, length, radius } = s;
      if (!finiteVec3(direction) || typeof length !== 'number' || typeof radius !== 'number') return false;
      const n = Math.hypot(direction[0], direction[1], direction[2]);
      if (!(n > 1e-6) || !(length > 0 && length <= MAX_SHAFT.length) || !(radius > 0 && radius <= MAX_SHAFT.radius)) return false;
      c.dx = direction[0] / n; c.dy = direction[1] / n; c.dz = direction[2] / n; c.length = length; c.radius = radius;
    } else if (family === 'sparks') {
      if (!validId(s.burstId) || typeof s.startedAt !== 'number' || !Number.isFinite(s.startedAt)) return false;
      // A burst is identified by its cue, not by where it is drawn.
      c.id = s.burstId; c.startedAt = s.startedAt;
    }
    return true;
  }

  /**
   * The `limit` nearest visible, valid, de-duplicated inputs of one family, ordered by (distance, id). Duplicates
   * resolve by value and the ordering is total, so neither input order nor repetition can change the frame.
   */
  function select(family: Family, sources: unknown, budget: FamilyBudget, spread: (c: Candidate) => number): number {
    picked.length = 0;
    byId.clear();
    if (!Array.isArray(sources)) return 0;
    const skip = () => { if (family === 'smoke') counts.smokeSkipped++; else counts.skipped++; };
    let used = 0;
    for (let i = 0; i < sources.length; i++) {
      if (i >= MAX_INPUT) { skip(); continue; }
      const c = candidate(used);
      if (!read(family, sources[i], c)) { skip(); continue; }
      const other = byId.get(c.id);
      if (other) {
        skip();
        // The winner's values move into the kept entry; this pool slot is reused by the next input.
        if (before(c, other)) swapInto(other, c);
        continue;
      }
      byId.set(c.id, c); used++;
    }
    for (const c of byId.values()) {
      if (family === 'sparks') {
        // The first start seen for a burst holds; re-sending it each frame with a new start cannot restart it.
        let start = latched.get(c.id);
        if (start === undefined) {
          if (latched.size >= MAX_REMEMBERED) latched.delete(latched.keys().next().value!);
          latched.set(c.id, c.startedAt); start = c.startedAt;
        }
        c.startedAt = start;
        const age = time - start;
        // Not yet begun, or already over: no slot and no draw, and not counted against the budget.
        if (!(age >= 0 && age <= SPARK_SECONDS)) continue;
      }
      let cx = c.x, cy = c.y, cz = c.z, extent = 0;
      if (family === 'dust') { cx += c.dx * c.length * .5; cy += c.dy * c.length * .5; cz += c.dz * c.length * .5; extent = c.length * .5; }
      c.distance = Math.hypot(cx - eye.x, cy - eye.y, cz - eye.z);
      sphere.center.set(cx, cy, cz); sphere.radius = spread(c) + extent;
      if (c.distance - extent > budget.reach || !frustum.intersectsSphere(sphere)) { skip(); continue; }
      picked.push(c);
    }
    picked.sort(nearest);
    if (picked.length > budget.sources) { for (let i = budget.sources; i < picked.length; i++) skip(); picked.length = budget.sources; }
    for (const c of picked) c.key = sourceKey(c.id);
    return picked.length;
  }

  /** Copies one entry's values into another, so pool objects keep their identities. */
  function swapInto(target: Candidate, from: Candidate): void {
    target.id = from.id; target.x = from.x; target.y = from.y; target.z = from.z;
    target.dx = from.dx; target.dy = from.dy; target.dz = from.dz; target.length = from.length; target.radius = from.radius; target.startedAt = from.startedAt;
  }

  const fadeAt = (distance: number, reach: number) => 1 - THREE.MathUtils.smoothstep(distance, reach * .8, reach);
  const windCarry = () => Math.min(8, Math.hypot(wx, wz));

  function emitGlints(family: 'fireflies' | 'embers', sources: unknown): void {
    const budget = EFFECTS_BUDGET[quality][family];
    const kind = family === 'fireflies' ? KIND.firefly : KIND.ember, at = family === 'fireflies' ? fireflyPose : emberPose;
    const reach = family === 'fireflies' ? 3.6 : 3 + windCarry() * 2.4;
    const n = select(family, sources, budget, () => reach);
    counts[family] = n;
    for (let s = 0; s < n; s++) {
      const source = picked[s]!, fade = fadeAt(source.distance, budget.reach);
      for (let i = 0; i < budget.perSource; i++) {
        if (!at(slotKey(seed, kind, source.key, i), source.x, source.y, source.z, time, wx, wz, pose)) continue;
        pose.alpha *= fade;
        if (pose.alpha > .002) glow.push(pose);
      }
    }
  }

  function emitDust(sources: unknown): void {
    const budget = EFFECTS_BUDGET[quality].dust;
    const n = select('dust', sources, budget, c => c.radius + .2);
    counts.dust = n;
    for (let s = 0; s < n; s++) {
      const source = picked[s]!, fade = fadeAt(source.distance, budget.reach);
      shaftFrame(shaft, source.x, source.y, source.z, source.dx, source.dy, source.dz, source.length, source.radius);
      // Denser shafts get more motes, up to the tier's limit: a narrow window shaft is not a dust storm.
      const volume = Math.PI * source.radius * source.radius * source.length;
      const motes = Math.min(budget.perSource, Math.max(2, Math.round(volume * 9)));
      for (let i = 0; i < motes; i++) {
        if (!dustPose(slotKey(seed, KIND.dust, source.key, i), shaft, time, wx, wz, pose)) continue;
        pose.alpha *= fade;
        if (pose.alpha > .002) glow.push(pose);
      }
    }
  }

  function emitSparks(sources: unknown): void {
    const budget = EFFECTS_BUDGET[quality].sparks;
    const n = select('sparks', sources, budget, () => 3.4);
    counts.sparks = n;
    for (let s = 0; s < n; s++) {
      const burst = picked[s]!, age = time - burst.startedAt, fade = fadeAt(burst.distance, budget.reach);
      // The burst's own identity seeds it, so it looks the same wherever and whenever it is replayed.
      const key = mix32(burst.key ^ KIND.spark);
      for (let i = 0; i < budget.perSource; i++) {
        if (!sparkPose(slotKey(seed, KIND.spark, key, i), i, burst.x, burst.y, burst.z, age, wx, wz, pose)) continue;
        pose.alpha *= fade;
        if (pose.alpha > .002) glow.push(pose);
      }
    }
  }

  function emitSmoke(sources: unknown): void {
    const budget = EFFECTS_BUDGET[quality].smoke;
    const n = select('smoke', sources, budget, () => 2.6 + windCarry() * 1.6);
    counts.smoke = n;
    for (let s = 0; s < n; s++) {
      const source = picked[s]!, fade = fadeAt(source.distance, budget.reach);
      for (let i = 0; i < budget.perSource; i++) {
        if (!smokePose(slotKey(seed, KIND.smoke, source.key, i), source.x, source.y, source.z, time, wx, wz, puff)) continue;
        puff.alpha *= fade;
        if (puff.alpha > .004) smoke.push(puff);
      }
    }
  }

  /** Validated, ascending, de-duplicated recorded samples of this cue, newest at most MAX_HISTORY, never after now. */
  function prepareTrack(cue: FlightCue): void {
    track.n = 0;
    const history = (cue as { history?: unknown }).history;
    let m = 0;
    if (Array.isArray(history)) {
      for (let i = Math.max(0, history.length - MAX_HISTORY); i < history.length; i++) {
        const sample = history[i] as { time?: unknown; position?: unknown } | null;
        if (!sample || typeof sample.time !== 'number' || !Number.isFinite(sample.time) || !finiteVec3(sample.position)) { counts.skipped++; continue; }
        // Only the past of this flight: never a recorded future, never a sample from before it began.
        if (sample.time > time || sample.time < cue.startedAt || time - sample.time > TRAIL_SECONDS + 1) continue;
        scratch.times[m] = sample.time; [scratch.xs[m], scratch.ys[m], scratch.zs[m]] = sample.position; order[m] = m; m++;
      }
    }
    const sorted = order.slice(0, m).sort((a, b) => scratch.times[a]! - scratch.times[b]!
      || scratch.xs[a]! - scratch.xs[b]! || scratch.ys[a]! - scratch.ys[b]! || scratch.zs[a]! - scratch.zs[b]!);
    for (const i of sorted) {
      if (track.n > 0 && track.times[track.n - 1] === scratch.times[i]) continue;
      track.times[track.n] = scratch.times[i]!; track.xs[track.n] = scratch.xs[i]!; track.ys[track.n] = scratch.ys[i]!; track.zs[track.n] = scratch.zs[i]!;
      track.n++;
    }
    if (cue.active) {
      // The piece's real position now closes the path; it replaces a sample recorded at this same instant.
      if (track.n > 0 && track.times[track.n - 1] === time) track.n--;
      track.times[track.n] = time; [track.xs[track.n], track.ys[track.n], track.zs[track.n]] = cue.position; track.n++;
    }
  }

  function emitFlightCue(input: unknown): void {
    counts.flight = 0;
    if (input === null || input === undefined) return;
    const cue = input as FlightCue;
    if (typeof cue !== 'object' || !validId(cue.id) || !finiteVec3(cue.position) || typeof cue.startedAt !== 'number'
      || !Number.isFinite(cue.startedAt) || typeof cue.active !== 'boolean') { counts.skipped++; return; }
    if (time < cue.startedAt) return;
    const budget = EFFECTS_BUDGET[quality].flight;
    const [x, y, z] = cue.position;
    if (Math.hypot(x - eye.x, y - eye.y, z - eye.z) > budget.reach) { counts.skipped++; return; }
    prepareTrack(cue);
    head.x = x; head.y = y; head.z = z;
    const drawnBefore = glow.drawn;
    emitFlight(mix32(seed ^ sourceKey(cue.id) ^ KIND.flight), track, cue.active ? head : null, cue.startedAt, time, budget, pose, p => { glow.push(p); });
    counts.flight = glow.drawn - drawnBefore;
  }

  function zero(): void {
    counts.fireflies = 0; counts.embers = 0; counts.smoke = 0; counts.dust = 0; counts.sparks = 0; counts.flight = 0;
    counts.skipped = 0; counts.smokeSkipped = 0;
  }

  return {
    update(frame: EffectsFrame): void {
      if (disposed) return;
      zero();
      glow.begin(); smoke.begin();
      idle = !frame || typeof frame !== 'object' || !Number.isFinite(frame.time);
      if (!idle) {
        time = frame.time;
        camera.updateMatrixWorld();
        eye.setFromMatrixPosition(camera.matrixWorld);
        viewProjection.copy(camera.matrixWorld).invert().premultiply(camera.projectionMatrix);
        frustum.setFromProjectionMatrix(viewProjection);
        const wind = finiteVec3(frame.wind) ? frame.wind : [0, 0, 0];
        wx = wind[0]; wz = wind[2];
        // Fixed order: cue light first, so the moment always has its glints; ambient air fills its own budgets.
        emitFlightCue(frame.flight);
        emitSparks(frame.sparks);
        emitGlints('embers', frame.embers);
        emitGlints('fireflies', frame.fireflies);
        emitDust(frame.dust);
        emitSmoke(frame.smoke);
      }
      glow.end(); smoke.end();
    },
    setQuality(next: EffectsQuality): void {
      if (disposed || !isQuality(next) || next === quality) return;
      quality = next;
      glow.resize(glowCapacity(quality), EFFECTS_BUDGET[quality].glow);
      smoke.resize(smokeCapacity(quality), EFFECTS_BUDGET[quality].smokePixels);
    },
    reset(): void {
      if (disposed) return;
      glow.clear(); smoke.clear();
      latched.clear();
      track.n = 0;
      idle = true;
      zero();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      glow.dispose(); smoke.dispose();
      keys.clear(); byId.clear(); latched.clear(); picked.length = 0; pool.length = 0;
    },
    diagnostics(): EffectsDiagnostics {
      return {
        quality, disposed, idle,
        glow: { capacity: glow.capacity, count: glow.drawn, fireflySources: counts.fireflies, emberSources: counts.embers,
          dustShafts: counts.dust, sparkBursts: counts.sparks, flightGlints: counts.flight, skipped: counts.skipped },
        smoke: { capacity: smoke.capacity, count: smoke.drawn, sources: counts.smoke, skipped: counts.smokeSkipped },
        rememberedBursts: latched.size,
        maxCoveragePixels: maxCoveragePixels(quality, glow.drawn, smoke.drawn),
      };
    },
  };
}

/** The longest any particle in the library can live, in seconds (a seek this far back has nothing left to show). */
export const EFFECTS_MEMORY_SECONDS = Math.max(SPARK_SECONDS, TRAIL_SECONDS, SMOKE_SECONDS);
