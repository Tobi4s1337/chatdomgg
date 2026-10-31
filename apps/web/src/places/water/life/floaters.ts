import type { Vec3 } from '@chatdom/shared';
import type { XZ } from '@chatdom/world';
import { nearestSegment } from '../surface/coverage';
import { contactGap, onWalk, type Habitat } from './habitat';
import { between, hash, STREAM } from './random';

/**
 * Named floaters: small paper-lantern floats a person sets on the water through an action the caller owns and
 * supplies. The caller's actions are finite records; each float drifts with the real flow (still water: the
 * seeded breeze), stops against a bank or a solid, and goes out after a bounded life. Labels are the caller's
 * public-safe text, carried through untouched for the host's approved text treatment.
 */
export interface FloaterAction {
  readonly id: string;
  /** Public-safe caller text; the host draws it. */
  readonly label: string;
  /** Caller seconds when the float touched the water. */
  readonly launched: number;
  /** Where it was set down, on the water. */
  readonly from: XZ;
}

/** Most floats drawn at once (the newest), and how long each lives, seconds. */
export const FLOATER_CAP = 12;
export const FLOATER_LIFE = 180;
/** The last seconds of a float's life, while its lantern burns down. */
export const FLOATER_FADE = 12;
const FLOATER_LABEL_MAX = 40;
const STEP = 0.5;
/** Turns a blocked float tries, nearest the water's own direction first. */
const DEFLECT = [0, 0.5, -0.5, 1, -1, 1.5, -1.5];
const SAMPLES = Math.ceil(FLOATER_LIFE / STEP) + 1;

export interface FloaterTrack {
  readonly key: string;
  /** x, y (water level), z per `STEP` seconds after launch. */
  readonly points: Float32Array;
}

export function assertFloater(action: FloaterAction): void {
  if (typeof action.id !== 'string' || !action.id || action.id.length > 64) throw new RangeError('A floater needs an id of 1–64 characters');
  if (typeof action.label !== 'string' || action.label.length > FLOATER_LABEL_MAX) throw new RangeError(`A floater label is caller text of at most ${FLOATER_LABEL_MAX} characters`);
  if (!Number.isFinite(action.launched)) throw new RangeError('A floater needs a finite launch time');
  if (!Array.isArray(action.from) || action.from.length !== 2 || !action.from.every(Number.isFinite)) throw new RangeError('A floater needs a finite x/z launch point');
}

export const floaterKey = (action: FloaterAction) => `${action.id}@${action.launched}:${action.from[0]},${action.from[1]}`;

/** Velocity of the water at a point: the nearest course's own flow, or a slow seeded breeze over still water. */
function drift(habitat: Habitat, seed: number, x: number, z: number, t: number, breeze: XZ): XZ {
  let best: { flow: XZ; lateral: number; pull: XZ } | null = null;
  for (const reach of habitat.reaches) {
    const near = nearestSegment(reach, x, z);
    if (!near || near.lateral > near.width / 2 + 0.5) continue;
    let index = 0, distance = Infinity;
    reach.points.forEach((p, i) => { const d = Math.hypot(p.position[0] - x, p.position[1] - z); if (d < distance) { distance = d; index = i; } });
    const p = reach.points[index]!;
    // A gentle pull toward the thread of the stream keeps floats off the banks.
    const toward: XZ = [p.position[0] - x, p.position[1] - z], d = Math.hypot(...toward) || 1;
    if (!best || near.lateral < best.lateral) best = { flow: p.flow, lateral: near.lateral, pull: [toward[0] / d * 0.04, toward[1] / d * 0.04] };
  }
  if (best && Math.hypot(...best.flow) > 0.02) return [best.flow[0] * 0.8 + best.pull[0], best.flow[1] * 0.8 + best.pull[1]];
  // Over still water the breeze veers slowly back and forth, so a float wanders rather than ruling a line.
  const turn = 0.35 * Math.sin(t * 0.05 + (hash(seed, STREAM.floater) % 7)), c = Math.cos(turn), s = Math.sin(turn);
  return [breeze[0] * c - breeze[1] * s, breeze[0] * s + breeze[1] * c];
}

/**
 * The whole path of one float, integrated once from its action: deterministic in the caller's seed and action,
 * so any time inside its life reads the same position.
 */
export function floaterTrack(habitat: Habitat, seed: number, action: FloaterAction): FloaterTrack | null {
  const start = habitat.waterAt(action.from[0], action.from[1]);
  if (!start || onWalk(habitat.walks, [action.from[0], start.level, action.from[1]])) return null;
  const angle = between(0, Math.PI * 2, seed, STREAM.floater, 1), speed = between(0.03, 0.06, seed, STREAM.floater, 2);
  const breeze: XZ = [Math.cos(angle) * speed, Math.sin(angle) * speed];
  const points = new Float32Array(SAMPLES * 3);
  let [x, z] = action.from, level = start.level;
  for (let i = 0; i < SAMPLES; i++) {
    points[3 * i] = x; points[3 * i + 1] = level; points[3 * i + 2] = z;
    const [vx, vz] = drift(habitat, seed, x, z, i * STEP, breeze);
    // A float meeting a stone or the bank slides along it, turning up to a right angle either way; where it can go
    // nowhere it rests until the water carries it on. It never drifts onto a walk.
    for (const turn of DEFLECT) {
      const c = Math.cos(turn), s = Math.sin(turn), nx = x + (vx * c - vz * s) * STEP, nz = z + (vx * s + vz * c) * STEP;
      const water = habitat.waterAt(nx, nz);
      if (!water || water.depth < 0.08 || habitat.obstacles.some(o => { const gap = contactGap(o, nx, nz); return gap < 0.15 && gap < contactGap(o, x, z); }) || onWalk(habitat.walks, [nx, water.level, nz])) continue;
      x = nx; z = nz; level = water.level;
      break;
    }
  }
  return { key: floaterKey(action), points };
}

export interface FloaterState { readonly position: Vec3; readonly light: number; readonly age: number }

/** Position and lantern strength of a float `age` seconds after launch, or null outside its life. */
export function floaterAt(track: FloaterTrack, age: number, out: { position: [number, number, number]; light: number }): boolean {
  if (!(age >= 0 && age < FLOATER_LIFE)) return false;
  const f = age / STEP, i = Math.min(SAMPLES - 2, Math.floor(f)), k = f - i, p = track.points;
  for (let a = 0; a < 3; a++) out.position[a] = p[3 * i + a]! + (p[3 * i + 3 + a]! - p[3 * i + a]!) * k;
  out.position[1] += 0.01 * Math.sin(age * 2.1);
  const rise = Math.min(1, age / 1.5), end = Math.min(1, (FLOATER_LIFE - age) / FLOATER_FADE);
  out.light = Math.max(0, Math.min(rise, end));
  return true;
}

/** The floats to draw at `time`: alive, newest first, at most `FLOATER_CAP`. Also counts the older ones dropped. */
export function liveFloaters(actions: readonly FloaterAction[], time: number): { live: FloaterAction[]; dropped: number } {
  const alive = actions.filter(a => time >= a.launched && time < a.launched + FLOATER_LIFE)
    .sort((a, b) => b.launched - a.launched || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { live: alive.slice(0, FLOATER_CAP), dropped: Math.max(0, alive.length - FLOATER_CAP) };
}
