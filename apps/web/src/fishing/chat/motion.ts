/*
 * How a chat float moves, as plain functions of time: cast in from the end of the pier, bob, dip at a bite, drag in
 * zigzags through a fight, and leave (sink, lift out with a catch, or be yanked under by a legend). Pure, so a frozen
 * bench frame and a live frame agree exactly, and the motion is tested without a GPU.
 */

export type Vec = [number, number, number];
export type FloatPhase = 'float' | 'bite' | 'fight';
export type FloatExit = 'gone' | 'caught' | 'broken';

/** Seconds. The cast's flight from the pier's end, the settle after it, and each way of leaving. */
export const CAST_S = 1.05, SETTLE_S = .9, FADE_IN_S = .6;
export const EXIT_S: Readonly<Record<FloatExit, number>> = Object.freeze({ gone: 1.5, caught: .95, broken: .55 });
export const LEAP_S = 1.3;
/** How high the cast arcs above the line between the pier's end and the float, in metres. */
const CAST_HEIGHT = 1.7;

export interface FloatMotion {
  readonly phase: FloatPhase;
  /** When this phase began. */
  readonly since: number;
  /** When the float first showed. */
  readonly born: number;
  /** Cast in from `from` (a new line) or faded in where it lies (a line a snapshot brought). */
  readonly cast: boolean;
  readonly from: Vec;
  readonly at: Vec;
  readonly waterY: number;
  /** 0..2π, a per-line offset so floats never bob in step. */
  readonly seed: number;
  /** Unit x, z: the way a hooked fish pulls, roughly away from the pier. */
  readonly pull: readonly [number, number];
  readonly exit: FloatExit | null;
  readonly exitAt: number;
}

export interface FloatPose {
  x: number; y: number; z: number;
  /** Lean around the float's own right axis, radians. */
  tilt: number;
  /** Which way it leans, radians about Y. */
  lean: number;
  scale: number;
  /** The light's strength, 0..~1.6. */
  glow: number;
  /** True while the float is in the air on its cast. */
  flying: boolean;
}

export const blankPose = (): FloatPose => ({ x: 0, y: 0, z: 0, tilt: 0, lean: 0, scale: 1, glow: 1, flying: false });

const clamp01 = (value: number) => value < 0 ? 0 : value > 1 ? 1 : value;
const smooth = (value: number) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
/** A triangle wave in -1..1 with a softened turn, so a zigzag reads as darts rather than a sine. */
export function zigzag(t: number): number {
  const p = t - Math.floor(t);
  const tri = p < .5 ? p * 4 - 1 : 3 - p * 4;
  return Math.sign(tri) * Math.pow(Math.abs(tri), .7);
}

/** Bite dips: one hard pull under, then nibbles. Returns metres below the rest line. */
export function biteDip(age: number): number {
  if (age < 0) return 0;
  const first = age < .32 ? Math.sin(age / .32 * Math.PI) * .16 : 0;
  const cycle = (age - .2) % .46, nibble = age > .2 && cycle < .16 ? Math.sin(cycle / .16 * Math.PI) * .075 : 0;
  return Math.max(first, nibble);
}

/** Where the float is and how it looks at `now`. Writes into `out` and returns it. */
export function floatPose(motion: FloatMotion, now: number, out: FloatPose): FloatPose {
  const { at, waterY, seed } = motion;
  const age = now - motion.born, phaseAge = Math.max(0, now - motion.since);
  const bob = Math.sin(now * 1.7 + seed) * .016 + Math.sin(now * 2.9 + seed * 1.7) * .006;
  out.x = at[0]; out.y = waterY + bob; out.z = at[2];
  out.tilt = Math.sin(now * 1.3 + seed) * .07; out.lean = seed; out.scale = 1; out.glow = 1; out.flying = false;
  if (motion.cast && age < CAST_S) {
    const u = clamp01(age / CAST_S), from = motion.from;
    out.x = from[0] + (at[0] - from[0]) * u; out.z = from[2] + (at[2] - from[2]) * u;
    out.y = from[1] + (waterY - from[1]) * u + CAST_HEIGHT * 4 * u * (1 - u);
    out.tilt = (u - .5) * 1.4 + Math.sin(age * 15) * .25; out.lean = Math.atan2(at[0] - from[0], at[2] - from[2]);
    out.glow = .7 + .3 * u; out.flying = true;
    return out;
  }
  if (motion.cast && age < CAST_S + SETTLE_S) {
    // It lands, goes under a little and bounces up twice before resting.
    const s = age - CAST_S;
    out.y -= Math.cos(s * 13) * Math.exp(-s * 5) * .09;
    out.tilt += Math.sin(s * 11) * Math.exp(-s * 4) * .35;
  }
  if (!motion.cast) { out.glow = smooth(age / FADE_IN_S); out.scale = .6 + .4 * smooth(age / FADE_IN_S); }
  if (motion.phase === 'bite') {
    out.y -= biteDip(phaseAge);
    out.tilt = .32 + Math.sin(now * 17 + seed) * .06;
    out.glow *= 1 + .25 * Math.sin(now * 9) ** 2;
  } else if (motion.phase === 'fight') {
    const ramp = smooth(phaseAge / .35), [px, pz] = motion.pull;
    const across = zigzag(phaseAge / 1.15 + seed * .1) * .55 * ramp, along = (.3 + .22 * Math.sin(phaseAge * 1.3 + seed)) * ramp;
    out.x += px * along + pz * across; out.z += pz * along - px * across;
    out.y = waterY - .05 * ramp - Math.abs(Math.sin(phaseAge * 9 + seed)) * .035 + bob * .4;
    out.tilt = .5 * ramp + Math.sin(phaseAge * 7) * .1; out.lean = Math.atan2(px, pz);
    out.glow *= 1.1 + .2 * Math.abs(Math.sin(phaseAge * 6));
  }
  if (motion.exit) {
    const u = clamp01((now - motion.exitAt) / EXIT_S[motion.exit]);
    if (motion.exit === 'gone') {
      out.y -= .2 * smooth(u); out.scale *= 1 - smooth(u); out.glow *= 1 - u;
    } else if (motion.exit === 'caught') {
      // Lifted clear with the fish: up and back toward the pier, shrinking out of the picture.
      out.x += (motion.from[0] - out.x) * .25 * u; out.z += (motion.from[2] - out.z) * .25 * u;
      out.y += 1.1 * Math.sin(u * Math.PI * .5); out.tilt = .2; out.scale *= 1 - u * u; out.glow *= (1 + .6 * Math.sin(u * Math.PI)) * (1 - u);
    } else {
      // A legend takes it: a flare as the line goes taut, then straight down.
      out.y -= .9 * u * u; out.scale *= 1 - .75 * u; out.tilt = .9 * u; out.glow *= (u < .25 ? 1 + 3 * u : 1.75 * (1 - u) / .75);
    }
  }
  return out;
}

/** Whether the float has finished leaving and its slot can be freed. */
export function floatDone(motion: FloatMotion, now: number): boolean {
  return motion.exit !== null && now - motion.exitAt >= EXIT_S[motion.exit];
}

/**
 * The caught fish's leap: up out of the water at `from`, across `dir` (unit x, z) by `distance`, and back in.
 * Writes the body's centre and returns the pitch (radians, nose up positive) so the fish follows its arc.
 */
export function leapPose(age: number, from: Vec, dir: readonly [number, number], height: number, distance: number, waterY: number, out: Vec): number {
  const u = clamp01(age / LEAP_S);
  out[0] = from[0] + dir[0] * distance * u; out[2] = from[2] + dir[1] * distance * u;
  out[1] = waterY - .15 + (height + .15) * 4 * u * (1 - u);
  const rise = (height + .15) * 4 * (1 - 2 * u);
  return Math.atan2(rise, distance);
}
