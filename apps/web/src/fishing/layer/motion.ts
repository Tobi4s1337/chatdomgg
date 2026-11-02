/** How a line looks over time. Pure functions of the presented phase and local seconds; the server already decided it. */
export type LinePhase = 'held' | 'drawing' | 'flying' | 'waiting' | 'bite' | 'fighting' | 'hauling' | 'leaping' | 'landed' | 'reeling' | 'snapped';

export const FLIGHT_S = .65, LEAP_S = 1.05, REEL_S = .7, SNAP_S = 1.1, LANDED_S = 5.5;
const HOLD = .86, DRAWN = 2.05, CAST = .3;

const clamp = (value: number, min = 0, max = 1) => value < min ? min : value > max ? max : value;
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
export const easeOut = (value: number) => 1 - (1 - clamp(value)) ** 3;

export interface FightPose { readonly tension: number; readonly progress: number; readonly run: boolean; readonly tired: boolean; readonly reeling: boolean }

/** Rod pitch above horizontal, total bend (radians spread up the rod) and a fine shake, for one moment. */
export function rodPose(phase: LinePhase, age: number, time: number, fight: FightPose, drawAge: number,
  out: { pitch: number; bend: number; shake: number }) {
  const sway = Math.sin(time * 1.3) * .018;
  let pitch = HOLD + sway, bend = .03, shake = 0;
  switch (phase) {
    case 'drawing': pitch = HOLD + (DRAWN - HOLD) * easeOut(drawAge / 1.4); bend = .05 + .1 * easeOut(drawAge / 1.4); break;
    case 'flying': {
      // A whip forward: past the release angle, then back up to a fishing angle as the line pays out.
      const whip = clamp(age / .16);
      pitch = age < .16 ? DRAWN + (CAST - .12 - DRAWN) * easeOut(whip) : CAST - .12 + (.56 - CAST + .12) * smooth((age - .16) / .5);
      bend = age < .16 ? .55 * whip : .55 * Math.exp(-(age - .16) * 6) * Math.cos((age - .16) * 26) + .06;
      break;
    }
    case 'waiting': pitch = .56 + sway * .6; bend = .07; break;
    case 'bite': pitch = .5 - .07 * Math.exp(-age * 5); bend = .2 + .25 * Math.exp(-age * 4); shake = .012 * Math.exp(-age * 3); break;
    case 'fighting': {
      const load = clamp(fight.tension);
      pitch = (fight.reeling ? .78 : .52) - load * .22 + (fight.run ? -.08 : 0);
      bend = .16 + load * 1.05 + (fight.run ? .12 : 0);
      shake = load > .8 ? (load - .8) * .09 : fight.run ? .01 : 0;
      break;
    }
    case 'hauling': pitch = .95 + Math.sin(time * 9) * .02; bend = .7; shake = .008; break;
    case 'leaping': pitch = .95 + .25 * smooth(age / LEAP_S); bend = .6 * (1 - smooth(age / LEAP_S)) + .08; break;
    case 'landed': pitch = HOLD + (.25) * (1 - smooth(age / .8)); bend = .04; break;
    case 'reeling': pitch = .56 + (HOLD - .56) * smooth(age / REEL_S); bend = .06; break;
    case 'snapped': pitch = .4 + (HOLD - .4) * smooth(age / .9); bend = .5 * Math.exp(-age * 9) * Math.cos(age * 30); break;
    case 'held': break;
  }
  out.pitch = pitch; out.bend = bend; out.shake = shake;
  return out;
}

export type Vec = [number, number, number];

/** Where the float is: arcing out, riding the water, dipping under a bite, dragged by the fish, or coming home. */
export function floatPosition(phase: LinePhase, age: number, time: number, from: Readonly<Vec>, target: Readonly<Vec>,
  fish: Readonly<Vec>, waterY: number, choppy: number, nibble: number, out: Vec): Vec {
  const bob = Math.sin(time * 2.1) * (.012 + choppy * .02) + Math.sin(time * 3.7 + 1.3) * choppy * .01;
  switch (phase) {
    case 'flying': {
      const u = clamp(age / FLIGHT_S);
      out[0] = from[0] + (target[0] - from[0]) * u; out[2] = from[2] + (target[2] - from[2]) * u;
      out[1] = from[1] + (target[1] - from[1]) * u + Math.sin(Math.PI * u) * 1.9;
      return out;
    }
    case 'bite': {
      const dip = .14 * (1 - Math.exp(-age * 12)) + Math.sin(age * 31) * .012;
      out[0] = target[0] + Math.sin(age * 23) * .03; out[1] = waterY - dip; out[2] = target[2] + Math.cos(age * 19) * .03;
      return out;
    }
    case 'fighting': case 'hauling':
      out[0] = fish[0]; out[1] = waterY - .06 + Math.sin(time * 11) * .02; out[2] = fish[2];
      return out;
    default:
      out[0] = target[0]; out[1] = waterY + bob - nibble * .045; out[2] = target[2];
      return out;
  }
}

/** The hooked fish under the surface: it works side to side, runs away and is won back, closer as the fight is won. */
export function fishPath(time: number, seed: number, target: Readonly<Vec>, near: Readonly<Vec>, right: Readonly<Vec>,
  progress: number, run: number, waterY: number, out: Vec): Vec {
  const won = clamp(progress) ** .85, reach = 1 - won;
  const side = Math.sin(time * .9 + seed) * 1.4 * reach + Math.sin(time * 2.3 + seed * 2) * .35 * reach;
  const away = run * .9 * reach;
  const dx = target[0] - near[0], dz = target[2] - near[2], length = Math.hypot(dx, dz) || 1;
  out[0] = near[0] + dx * reach + right[0] * side + dx / length * away;
  out[2] = near[2] + dz * reach + right[2] * side + dz / length * away;
  out[1] = waterY - .18;
  return out;
}

/** The leap: out of the water in a high arc and down onto the planks in front of the fisher. */
export function leapPosition(age: number, from: Readonly<Vec>, deck: Readonly<Vec>, out: Vec): Vec {
  const u = smooth(age / LEAP_S);
  out[0] = from[0] + (deck[0] - from[0]) * u; out[2] = from[2] + (deck[2] - from[2]) * u;
  out[1] = from[1] + (deck[1] - from[1]) * u + Math.sin(Math.PI * clamp(age / LEAP_S)) * 1.7;
  return out;
}

/** Sag of the line, as a fraction of its length: slack lines hang, loaded lines run straight. */
export function lineSag(phase: LinePhase, age: number, tension: number): number {
  switch (phase) {
    case 'flying': return .04;
    case 'waiting': return .085;
    case 'bite': return .03;
    case 'fighting': return .06 * (1 - clamp(tension)) ** 2;
    case 'hauling': case 'leaping': return .005;
    case 'reeling': return .07 * (1 - clamp(age / REEL_S));
    case 'snapped': return .2 + age * .25;
    default: return .08;
  }
}

/** A point on the drawn line from the tip to the float, sagging under gravity and never below the water. */
export function linePoint(tip: Readonly<Vec>, end: Readonly<Vec>, sag: number, u: number, waterY: number, out: Vec): Vec {
  const length = Math.hypot(end[0] - tip[0], end[1] - tip[1], end[2] - tip[2]);
  out[0] = tip[0] + (end[0] - tip[0]) * u;
  out[2] = tip[2] + (end[2] - tip[2]) * u;
  out[1] = tip[1] + (end[1] - tip[1]) * u - 4 * u * (1 - u) * sag * length;
  if (u < .999 && out[1] < waterY + .004) out[1] = waterY + .004;
  return out;
}
