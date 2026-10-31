import { unit, wrap } from './random';

/**
 * One drawn glint: world metres, HDR linear colour, opacity and quad edge in metres. `sx, sy, sz` is the world
 * displacement the glint covered over its streak time; a non-zero streak stretches the square back along it.
 */
export interface GlowPose { x: number; y: number; z: number; r: number; g: number; b: number; alpha: number; size: number; sx: number; sy: number; sz: number }

export function emptyPose(): GlowPose { return { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, alpha: 0, size: 0, sx: 0, sy: 0, sz: 0 }; }

export const TAU = Math.PI * 2;
export const smooth = (t: number) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };
/** Wind is supplied in metres per second; anything stronger than a gale is held to it, so nothing streaks away. */
export const MAX_WIND = 8;
export function windScale(wx: number, wz: number): number {
  const length = Math.hypot(wx, wz);
  return length > MAX_WIND ? MAX_WIND / length : 1;
}

// Warm, not lime: a lantern-yellow glint that reads as a small life, not as a lamp.
const FIREFLY = [1, .74, .3] as const;
const FIREFLY_PEAK = 2.3;
const FIREFLY_SIZE = .055;

/**
 * A firefly wanders slowly inside a low dome around its hedge or meadow source and glints a few times a minute.
 * Between glints it is dark and invisible. Returns false when nothing is drawn.
 */
export function fireflyPose(key: number, sx: number, sy: number, sz: number, time: number, wx: number, wz: number, out: GlowPose): boolean {
  const period = 4.2 + 4.6 * unit(key, 0), duty = .16 + .12 * unit(key, 1);
  const u = wrap(time + period * unit(key, 2), period) / period;
  if (u >= duty) return false;
  const flash = u / duty;
  // Some glint once, some twice in quick succession: a quiet sign of a crafted, living field.
  const twice = unit(key, 3) > .62;
  const pulse = !twice ? Math.sin(Math.PI * flash) ** 2
    : flash < .5 ? Math.sin(TAU * flash) ** 2 : .7 * Math.sin(TAU * flash - Math.PI) ** 2;
  if (pulse <= .002) return false;
  const angle = TAU * unit(key, 4), radius = .35 + 2.1 * Math.sqrt(unit(key, 5));
  const w1 = .17 + .2 * unit(key, 6), w2 = .11 + .16 * unit(key, 7), w3 = .23 + .25 * unit(key, 8);
  const p1 = TAU * unit(key, 9), p2 = TAU * unit(key, 10), p3 = TAU * unit(key, 11);
  const ws = windScale(wx, wz) * .1;
  out.x = sx + Math.cos(angle) * radius + .55 * Math.sin(time * w1 + p1) + .22 * Math.sin(time * w3 * 1.7 + p2) + wx * ws;
  out.z = sz + Math.sin(angle) * radius + .55 * Math.cos(time * w2 + p2) + .22 * Math.cos(time * w1 * 1.9 + p3) + wz * ws;
  out.y = sy + .2 + 1.15 * unit(key, 12) + .28 * Math.sin(time * w3 + p3);
  const level = FIREFLY_PEAK * pulse * (.75 + .25 * unit(key, 13));
  out.r = FIREFLY[0] * level; out.g = FIREFLY[1] * level; out.b = FIREFLY[2] * level;
  out.alpha = Math.min(1, pulse * 1.6);
  out.size = FIREFLY_SIZE;
  out.sx = 0; out.sy = 0; out.sz = 0;
  return true;
}

// Embers cool from a hot orange-gold to a dull red before they go out.
const HOT = [1, .52, .14] as const, COOL = [.85, .13, .035] as const;
const EMBER_SIZE = .06;

/**
 * An ember lifts from a real fire, wanders, leans with the supplied wind, cools and goes out. Each life is a cycle
 * whose index seeds its own path, heat and size, so the plume is a loose scatter of different lives rather than a
 * string of equal squares; a share of cycles stay unlit so the fire breathes rather than streams.
 */
export function emberPose(key: number, sx: number, sy: number, sz: number, time: number, wx: number, wz: number, out: GlowPose): boolean {
  const life = 1.5 + 1.8 * unit(key, 0);
  const shifted = time + life * unit(key, 1);
  const cycle = Math.floor(shifted / life), age = shifted - cycle * life;
  // Each life runs its own length inside the slot's period: short sparks of the coal next to slow drifting ones.
  const own = life * (.55 + .45 * unit(key, 11, cycle));
  if (age >= own || unit(key, 2, cycle) < .3) return false;
  const u = age / own;
  const angle = TAU * unit(key, 3, cycle), start = .22 * Math.sqrt(unit(key, 4, cycle));
  // Lateral drift varies widely between lives (some climb nearly straight, some lean well out of the column).
  const lean = unit(key, 5, cycle), drift = .03 + .36 * lean * lean;
  const rise = .5 + .5 * unit(key, 6, cycle);
  const wobble = 1.6 + 3.2 * unit(key, 7, cycle), phase = TAU * unit(key, 8, cycle);
  const ws = windScale(wx, wz);
  const carry = age * (.4 + .35 * unit(key, 9, cycle)) * ws;
  // The wander turns as the ember climbs, so its path bends instead of running on a straight ray.
  const turn = angle + (unit(key, 12, cycle) - .5) * 2.4 * u;
  const reach = start + drift * age;
  const sway = (.05 + .07 * unit(key, 13, cycle)) * age * Math.sin(age * wobble + phase);
  out.x = sx + Math.cos(turn) * reach + sway * Math.sin(turn) + wx * carry;
  out.z = sz + Math.sin(turn) * reach - sway * Math.cos(turn) + wz * carry;
  out.y = sy + rise * age - .07 * age * age;
  const heat = (1 - u) ** 1.4;
  const flicker = .78 + .22 * Math.sin(age * (11 + 11 * unit(key, 10, cycle)) + phase);
  // Lives differ in brightness: a few bright motes over many dimmer ones.
  const strength = .45 + .75 * unit(key, 14, cycle) ** 1.6;
  const level = (.42 + 2.5 * heat * heat) * flicker * strength;
  out.r = (COOL[0] + (HOT[0] - COOL[0]) * heat) * level;
  out.g = (COOL[1] + (HOT[1] - COOL[1]) * heat) * level;
  out.b = (COOL[2] + (HOT[2] - COOL[2]) * heat) * level;
  out.alpha = smooth(age / .12) * (1 - smooth((u - .58) / .42));
  out.size = EMBER_SIZE * (.7 + .3 * unit(key, 15, cycle)) * (1 - .45 * u);
  out.sx = 0; out.sy = 0; out.sz = 0;
  return out.alpha > .002;
}

/** A shaft's frame, prepared once per frame from the validated caller input. */
export interface ShaftFrame {
  x: number; y: number; z: number;
  /** Unit axis, and two unit vectors across it. */
  dx: number; dy: number; dz: number; ax: number; ay: number; az: number; bx: number; by: number; bz: number;
  length: number; radius: number;
}

/** Builds the frame across a unit axis (any two perpendiculars; chosen deterministically from the axis). */
export function shaftFrame(out: ShaftFrame, x: number, y: number, z: number, dx: number, dy: number, dz: number, length: number, radius: number): void {
  const n = Math.hypot(dx, dy, dz);
  dx /= n; dy /= n; dz /= n;
  // Cross with whichever world axis is least aligned with the shaft.
  let ax: number, ay: number, az: number;
  if (Math.abs(dy) < .9) { ax = dz; ay = 0; az = -dx; } else { ax = 0; ay = -dz; az = dy; }
  const m = Math.hypot(ax, ay, az);
  ax /= m; ay /= m; az /= m;
  Object.assign(out, { x, y, z, dx, dy, dz, ax, ay, az, bx: dy * az - dz * ay, by: dz * ax - dx * az, bz: dx * ay - dy * ax, length, radius });
}

// Dust is lit, not luminous: a pale warm mote below the bloom threshold, catching the light as it turns.
const DUST = [1, .87, .66] as const;
const DUST_SIZE = .03;

/**
 * A mote drifting inside a real light shaft. It lives only inside the caller's cylinder: it travels slowly along
 * the axis and wraps, fading out at both ends and at the rim, so the shaft's edges are never drawn as a beam.
 */
export function dustPose(key: number, shaft: ShaftFrame, time: number, wx: number, wz: number, out: GlowPose): boolean {
  // Metres per second along the axis, in either direction; slow enough to read as hanging in the air.
  const speed = (.015 + .045 * unit(key, 0)) * (unit(key, 1) < .5 ? -1 : 1);
  const along = wrap(unit(key, 2) + time * speed / shaft.length, 1);
  const ends = smooth(along / .14) * smooth((1 - along) / .18);
  if (ends <= .002) return false;
  const p1 = TAU * unit(key, 3), p2 = TAU * unit(key, 4), p3 = TAU * unit(key, 5);
  const spin = (unit(key, 6) - .5) * .16;
  const angle = TAU * unit(key, 7) + time * spin + .35 * Math.sin(time * .21 + p1);
  const r = shaft.radius * Math.min(1, Math.sqrt(unit(key, 8)) + .12 * Math.sin(time * (.13 + .1 * unit(key, 9)) + p2));
  const rim = 1 - smooth((Math.abs(r) / shaft.radius - .68) / .32);
  if (rim <= .002) return false;
  const ca = Math.cos(angle) * r, sa = Math.sin(angle) * r, s = along * shaft.length;
  // The faintest stir of the room's air, scaled down hard: motes in a shaft barely notice the wind outside.
  const ws = windScale(wx, wz) * .04 * Math.sin(time * .3 + p3);
  out.x = shaft.x + shaft.dx * s + shaft.ax * ca + shaft.bx * sa + wx * ws;
  out.y = shaft.y + shaft.dy * s + shaft.ay * ca + shaft.by * sa + .03 * Math.sin(time * .5 + p3);
  out.z = shaft.z + shaft.dz * s + shaft.az * ca + shaft.bz * sa + wz * ws;
  // A flake flashes as it turns its face to the light, then dims; most of the time it is barely there.
  const turn = Math.sin(time * (.5 + .9 * unit(key, 10)) + p1);
  const glint = turn * turn * turn * turn;
  const level = .3 + .5 * glint;
  out.r = DUST[0] * level; out.g = DUST[1] * level; out.b = DUST[2] * level;
  out.alpha = ends * rim * (.5 + .5 * glint);
  out.size = DUST_SIZE * (.75 + .5 * unit(key, 11));
  out.sx = 0; out.sy = 0; out.sz = 0;
  return out.alpha > .004;
}
