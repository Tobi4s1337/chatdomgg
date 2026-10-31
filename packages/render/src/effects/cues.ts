import { TAU, smooth, windScale, type GlowPose } from './ambient';
import { unit } from './random';

// Cue effects: they exist only while a real event says so. A burst is a pure function of its own clock age, so an
// unchanged burst plays once and a seek lands on the same frame; a flight trail is drawn only along positions the
// caller actually recorded.

/** No spark outlives this; a burst older than it draws nothing and frees its slot. */
export const SPARK_SECONDS = 1.05;
const SPARK_HOT = [1, .8, .48] as const, SPARK_COOL = [1, .34, .06] as const;
const GRAVITY = 7.6, DRAG = 2.4;
/** Seconds of motion a spark's streak covers: a short tick of light, never a laser line. */
const STREAK = .045;

/**
 * Slot 0 of a burst is the strike's flash, a single white-hot square that is gone in a seventh of a second; the
 * rest are sparks thrown up and out, slowed by the air, pulled down, cooling from white-gold to orange.
 */
export function sparkPose(key: number, slot: number, sx: number, sy: number, sz: number, age: number, wx: number, wz: number, out: GlowPose): boolean {
  if (!(age >= 0)) return false;
  if (slot === 0) {
    const flash = 1 - age / .14;
    if (flash <= 0) return false;
    const level = 4.6 * flash * flash;
    out.x = sx; out.y = sy + .04; out.z = sz;
    out.r = level; out.g = .82 * level; out.b = .52 * level;
    out.alpha = Math.min(1, flash * 1.4); out.size = .16;
    out.sx = 0; out.sy = 0; out.sz = 0;
    return true;
  }
  const life = .3 + .72 * unit(key, 0) ** 1.4;
  if (age >= life) return false;
  const u = age / life;
  const theta = TAU * unit(key, 1), elevation = .2 + 1.15 * unit(key, 2), speed = 1.8 + 3.6 * unit(key, 3) ** .8;
  const horizontal = Math.cos(elevation) * speed;
  const vx = Math.cos(theta) * horizontal, vz = Math.sin(theta) * horizontal, vy = Math.sin(elevation) * speed;
  const fade = Math.exp(-DRAG * age), travel = (1 - fade) / DRAG;
  const ws = windScale(wx, wz) * .15 * age;
  out.x = sx + vx * travel + wx * ws;
  out.y = sy + vy * travel - .5 * GRAVITY * age * age;
  out.z = sz + vz * travel + wz * ws;
  out.sx = vx * fade * STREAK; out.sy = (vy * fade - GRAVITY * age) * STREAK; out.sz = vz * fade * STREAK;
  const heat = (1 - u) ** 1.5;
  const level = 1.3 + 3.9 * heat;
  out.r = (SPARK_COOL[0] + (SPARK_HOT[0] - SPARK_COOL[0]) * heat) * level;
  out.g = (SPARK_COOL[1] + (SPARK_HOT[1] - SPARK_COOL[1]) * heat) * level;
  out.b = (SPARK_COOL[2] + (SPARK_HOT[2] - SPARK_COOL[2]) * heat) * level;
  out.alpha = 1 - smooth((u - .62) / .38);
  out.size = .03 * (.8 + .45 * unit(key, 4));
  return out.alpha > .002;
}

/** The recorded path of one flight: ascending, finite, de-duplicated samples (see `prepareTrack` in index.ts). */
export interface Track { times: Float64Array; xs: Float64Array; ys: Float64Array; zs: Float64Array; n: number }

export function createTrack(capacity: number): Track {
  return { times: new Float64Array(capacity), xs: new Float64Array(capacity), ys: new Float64Array(capacity), zs: new Float64Array(capacity), n: 0 };
}

/** Linear between the two recorded samples around `time`; false outside the recorded span. Never extrapolates. */
export function sampleTrack(track: Track, time: number, out: { x: number; y: number; z: number }): boolean {
  const { times, n } = track;
  if (n === 0 || time < times[0]! || time > times[n - 1]!) return false;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid]! <= time) lo = mid; else hi = mid; }
  const span = times[hi]! - times[lo]!, k = span > 0 ? (time - times[lo]!) / span : 0;
  out.x = track.xs[lo]! + (track.xs[hi]! - track.xs[lo]!) * k;
  out.y = track.ys[lo]! + (track.ys[hi]! - track.ys[lo]!) * k;
  out.z = track.zs[lo]! + (track.zs[hi]! - track.zs[lo]!) * k;
  return true;
}

/** How long a trail glint lives, and the trail clock: one base tick per high-tier glint. */
export const TRAIL_SECONDS = .75;
export const TRAIL_TICK = TRAIL_SECONDS / 27;
const at = { x: 0, y: 0, z: 0 };
const GOLD = [1, .8, .44] as const, ROSE = [1, .42, .2] as const, RUNE = [.58, .96, .9] as const;

export interface FlightBudget { trail: number; step: number; motes: number }

/**
 * The Forge flight: the piece's own glint, a few rune-pale motes circling it while it flies, and a warm trail of
 * glints left where it has actually been. Trail glints are pinned to absolute ticks of the effect clock, so each
 * stays where it was dropped and fades in place; lower tiers keep every `step`-th tick of the same clock.
 */
export function emitFlight(key: number, track: Track, head: { x: number; y: number; z: number } | null, startedAt: number,
  time: number, budget: FlightBudget, out: GlowPose, push: (pose: GlowPose) => void): void {
  if (head) {
    // The streak points back along the last recorded twentieth of a second.
    const back = sampleTrack(track, Math.max(startedAt, time - .05), at);
    out.x = head.x; out.y = head.y; out.z = head.z;
    out.sx = back ? head.x - at.x : 0; out.sy = back ? head.y - at.y : 0; out.sz = back ? head.z - at.z : 0;
    const pulse = .85 + .15 * Math.sin(time * 9.5 + TAU * unit(key, 0));
    out.r = GOLD[0] * 3.2 * pulse; out.g = GOLD[1] * 3.2 * pulse; out.b = GOLD[2] * 3.2 * pulse;
    out.alpha = 1; out.size = .11;
    push(out);
    for (let m = 0; m < budget.motes; m++) {
      const spin = (2.6 + 1.8 * unit(key, 1, m)) * (m % 2 ? -1 : 1), radius = .2 + .14 * unit(key, 2, m);
      const a = TAU * unit(key, 3, m) + time * spin;
      out.x = head.x + Math.cos(a) * radius; out.z = head.z + Math.sin(a) * radius;
      out.y = head.y + .1 * Math.sin(time * 3.1 + TAU * unit(key, 4, m));
      const twinkle = .55 + .45 * Math.sin(time * 7 + m * 2.1) ** 2;
      out.r = RUNE[0] * 2.2 * twinkle; out.g = RUNE[1] * 2.2 * twinkle; out.b = RUNE[2] * 2.2 * twinkle;
      out.alpha = .9; out.size = .045;
      out.sx = 0; out.sy = 0; out.sz = 0;
      push(out);
    }
  }
  const step = Math.max(1, Math.round(budget.step)), tick = TRAIL_TICK * step;
  const newest = Math.floor(time / tick) * step;
  for (let k = 0; k < budget.trail; k++) {
    const index = newest - k * step, age = time - index * TRAIL_TICK;
    // Each glint was shed somewhere inside its own tick, so the trail is a scatter along the path, not a dotted line.
    const dropped = index * TRAIL_TICK - unit(key, 8, index) * tick;
    if (age > TRAIL_SECONDS || dropped < startedAt || !sampleTrack(track, dropped, at)) continue;
    const life = age / TRAIL_SECONDS, fade = (1 - life) ** 1.6;
    // Each glint keeps its own drift for its whole life: it loosens from the path and settles a little.
    const a = TAU * unit(key, 5, index), loosen = (.1 + .42 * unit(key, 6, index)) * age + .06 * unit(key, 9, index);
    out.x = at.x + Math.cos(a) * loosen; out.z = at.z + Math.sin(a) * loosen;
    out.y = at.y + (unit(key, 7, index) - .5) * .2 - .3 * age * age;
    const twinkle = .6 + .4 * Math.sin(age * (14 + 10 * unit(key, 10, index)) + TAU * unit(key, 11, index)) ** 2;
    const level = (2 * fade + .35) * twinkle * (.7 + .5 * unit(key, 12, index));
    out.r = (GOLD[0] + (ROSE[0] - GOLD[0]) * life) * level;
    out.g = (GOLD[1] + (ROSE[1] - GOLD[1]) * life) * level;
    out.b = (GOLD[2] + (ROSE[2] - GOLD[2]) * life) * level;
    out.alpha = fade; out.size = (.045 + .05 * unit(key, 13, index)) * (1 - .5 * life);
    out.sx = 0; out.sy = 0; out.sz = 0;
    if (out.alpha > .004) push(out);
  }
}
