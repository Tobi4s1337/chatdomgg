import type { Vec3 } from '@chatdom/shared';
import type { PeopleLight, PeopleLightOptions, PeopleLightSource } from './types';

interface Settled { time: number; level: number }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isVec3 = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every(finite);
const strength = (value: number, name: string) => {
  if (!finite(value) || value < 0 || value > 1) throw new RangeError(`People light ${name} must be a strength from 0 to 1`);
  return value;
};
const seconds = (value: number, name: string) => {
  if (!finite(value) || value < 0) throw new RangeError(`People light ${name} must be a finite, nonnegative number of seconds`);
  return value;
};

/**
 * One warm light that wakes for the people near it: it rises while anyone accepted is within reach, holds while
 * they stay, and fades behind them. Every lamp, place lantern and interior glow that answers to passers-by runs
 * through this, so they all breathe the same way.
 *
 * Strength climbs with occupancy from `pilot` (nobody near) to `full` (`capacity` people or more). It moves toward
 * that target linearly: pilot → full takes `rise` seconds, full → pilot takes `fade` seconds. Time is the caller's
 * presentation clock. The first update after creation or `clear()` has no history and settles at the current
 * target; a repeated time re-evaluates the same step, so it never advances a fade; an earlier time is a seek and
 * settles at the target for the people given. Replaying a recorded input trace after `clear()` reproduces it exactly.
 */
export function createPeopleLight(options: PeopleLightOptions): PeopleLight {
  if (!isVec3(options.position)) throw new RangeError('People light position must be three finite numbers');
  if (options.near !== undefined && !isVec3(options.near)) throw new RangeError('People light near must be three finite numbers');
  if (!finite(options.reach) || options.reach <= 0) throw new RangeError('People light reach must be a positive distance');
  const capacity = options.capacity ?? 1;
  if (!finite(capacity) || capacity <= 0) throw new RangeError('People light capacity must be a positive number of people');
  const pilot = strength(options.pilot ?? 0, 'pilot'), full = strength(options.full ?? 1, 'full');
  if (pilot > full) throw new RangeError('People light pilot cannot be brighter than full');
  const rise = seconds(options.rise ?? .6, 'rise'), fade = seconds(options.fade ?? .7, 'fade');

  const [nx, ny, nz] = options.near ?? options.position;
  const reachSq = options.reach * options.reach, span = full - pilot;
  const position: Vec3 = Object.freeze([options.position[0], options.position[1], options.position[2]] as const);
  const source: { readonly position: Vec3; strength: number } = { position, strength: 0 };
  // `before` is the state the latest step started from, so a same-time call can redo that step with new people.
  let before: Settled | null = null, latest: Settled | null = null;

  const target = (people: readonly Vec3[]) => {
    let near = 0;
    for (const person of people) {
      if (!isVec3(person)) throw new RangeError('People light positions must be three finite numbers');
      const dx = person[0] - nx, dy = person[1] - ny, dz = person[2] - nz;
      if (dx * dx + dy * dy + dz * dz <= reachSq) near++;
    }
    return near ? pilot + span * Math.min(1, near / capacity) : pilot;
  };
  const step = (from: Settled, time: number, goal: number): Settled => {
    const duration = goal > from.level ? rise : fade;
    if (goal === from.level || duration === 0) return { time, level: goal };
    const moved = (time - from.time) * span / duration;
    const level = goal > from.level ? Math.min(goal, from.level + moved) : Math.max(goal, from.level - moved);
    // Sampled clocks carry float drift: a finished rise or fade lands exactly, so dark reads as 0, not 1e-16.
    return { time, level: Math.abs(goal - level) < 1e-9 ? goal : level };
  };

  return {
    update(time, people) {
      if (!finite(time)) throw new RangeError('People light time must be a finite number of seconds');
      const goal = target(people);
      if (!latest || time < latest.time) before = latest = { time, level: goal };
      else if (time > latest.time) { before = latest; latest = step(before, time, goal); }
      // Same time: a settle is settled again; a step is redone from where it started, never advanced twice.
      else if (before === latest) before = latest = { time, level: goal };
      else latest = step(before ?? latest, time, goal);
      return source.strength = latest.level;
    },
    source: (): PeopleLightSource => source,
    clear() { before = latest = null; source.strength = 0; },
  };
}
