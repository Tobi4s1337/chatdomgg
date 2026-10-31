import { unit, wrap } from './random';

/** One drawn glint: world metres, HDR linear colour, opacity and quad edge in metres. */
export interface GlowPose { x: number; y: number; z: number; r: number; g: number; b: number; alpha: number; size: number }

export function emptyPose(): GlowPose { return { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, alpha: 0, size: 0 }; }

const TAU = Math.PI * 2;
const smooth = (t: number) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };

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
  out.x = sx + Math.cos(angle) * radius + .55 * Math.sin(time * w1 + p1) + .22 * Math.sin(time * w3 * 1.7 + p2) + wx * .1;
  out.z = sz + Math.sin(angle) * radius + .55 * Math.cos(time * w2 + p2) + .22 * Math.cos(time * w1 * 1.9 + p3) + wz * .1;
  out.y = sy + .2 + 1.15 * unit(key, 12) + .28 * Math.sin(time * w3 + p3);
  const level = FIREFLY_PEAK * pulse * (.75 + .25 * unit(key, 13));
  out.r = FIREFLY[0] * level; out.g = FIREFLY[1] * level; out.b = FIREFLY[2] * level;
  out.alpha = Math.min(1, pulse * 1.6);
  out.size = FIREFLY_SIZE;
  return true;
}

// Embers cool from a hot orange-gold to a dull red before they go out.
const HOT = [1, .52, .14] as const, COOL = [.85, .13, .035] as const;
const EMBER_SIZE = .06;
const MAX_WIND = 8;

/**
 * An ember lifts from a real fire, wobbles, leans with the supplied wind, cools and goes out. Each life is a cycle
 * whose index seeds its own path; a share of cycles stay unlit so the fire breathes rather than streams.
 */
export function emberPose(key: number, sx: number, sy: number, sz: number, time: number, wx: number, wz: number, out: GlowPose): boolean {
  const life = 1.7 + 1.5 * unit(key, 0);
  const shifted = time + life * unit(key, 1);
  const cycle = Math.floor(shifted / life), age = shifted - cycle * life, u = age / life;
  if (unit(key, 2, cycle) < .32) return false;
  const angle = TAU * unit(key, 3, cycle), start = .14 * Math.sqrt(unit(key, 4, cycle));
  const drift = .1 + .14 * unit(key, 5, cycle), rise = .5 + .45 * unit(key, 6, cycle);
  const wobble = 2.2 + 2.4 * unit(key, 7, cycle), phase = TAU * unit(key, 8, cycle);
  const windLength = Math.hypot(wx, wz), windScale = windLength > MAX_WIND ? MAX_WIND / windLength : 1;
  const carry = age * (.45 + .3 * unit(key, 9, cycle)) * windScale;
  const sway = .07 * age * Math.sin(age * wobble + phase);
  out.x = sx + Math.cos(angle) * (start + drift * age) + sway * Math.sin(angle) + wx * carry;
  out.z = sz + Math.sin(angle) * (start + drift * age) - sway * Math.cos(angle) + wz * carry;
  out.y = sy + rise * age - .075 * age * age;
  const heat = (1 - u) ** 1.4;
  const flicker = .82 + .18 * Math.sin(age * (13 + 9 * unit(key, 10, cycle)) + phase);
  const level = (.45 + 2.6 * heat * heat) * flicker;
  out.r = (COOL[0] + (HOT[0] - COOL[0]) * heat) * level;
  out.g = (COOL[1] + (HOT[1] - COOL[1]) * heat) * level;
  out.b = (COOL[2] + (HOT[2] - COOL[2]) * heat) * level;
  out.alpha = smooth(age / .12) * (1 - smooth((u - .62) / .38));
  out.size = EMBER_SIZE * (1 - .45 * u);
  return out.alpha > .002;
}
