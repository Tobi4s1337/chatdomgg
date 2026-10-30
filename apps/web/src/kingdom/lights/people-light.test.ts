import type { Vec3 } from '@chatdom/shared';
import { describe, expect, it } from 'vitest';
import type { LightFieldSource } from '../light-field';
import { createPeopleLight } from './people-light';

const at = (x: number): Vec3 => [x, 1.6, 0];
const options = { position: [0, 3.2, 0] as Vec3, near: [0, 1, 0] as Vec3, reach: 7, pilot: .12, full: 1, capacity: 2, rise: .6, fade: 30 };
// One recorded evening at a market lamp: [time, accepted people] → strength. Two people fill it.
const trace: readonly (readonly [number, readonly Vec3[], number])[] = [
  [0, [], .12],                       // nobody yet: the pilot glow only
  [1, [at(20)], .12],                 // a walker still out of reach
  [1.3, [at(6.5)], .56],              // crossing in, 6.5 m away: half of capacity two, risen 0.44 in 0.3 s
  [1.6, [at(2), at(4)], .56 + .88 * .3 / .6], // a second walker: rising at 0.88 per 0.6 s
  [1.6, [at(2), at(4)], .56 + .88 * .3 / .6], // the same frame again does not advance the rise
  [1.6, [at(2)], .56],                // the same time with new people redoes that step, never doubles it
  [2, [at(2), at(3), at(5)], 1],      // a crowd beyond capacity holds full
  [5, [at(1), at(9)], 1 - .88 * 3 / 30], // one has left the crowd since the last sample: easing toward half
  [5, [at(1), at(2)], 1],             // both still near at that moment: holding full
  [20, [], .56],                      // the last ones left: fading behind them, 0.88 over 30 s
  [20, [], .56],
  [35, [], .12],                      // back to the pilot glow, never below
  [36, [[0, 8.5, 0]], .12],           // reach is a sphere round `near`: someone 7.5 m above it is not near
  [10, [at(1)], .56],                 // seek back: settles at the target of the people given, no invented past fade
  [11, [], .56 - .88 / 30],
];

describe('createPeopleLight', () => {
  it('rises, holds and fades for accepted people, replays exactly and clears on authority loss', () => {
    const light = createPeopleLight(options);
    const source = light.source();
    const run = () => trace.map(([time, people, expected], index) => {
      const level = light.update(time, people);
      expect(level, `step ${index} at ${time}s`).toBeCloseTo(expected, 10);
      expect(light.source()).toBe(source);
      expect(source.strength).toBe(level);
      return level;
    });
    const first = run();
    expect(source.position).toEqual([0, 3.2, 0]);
    const field: LightFieldSource = source;
    expect(field.strength).toBe(first.at(-1));

    light.clear();
    expect(source.strength).toBe(0);
    expect(light.source().strength).toBe(0);
    expect(run()).toEqual(first);

    light.clear();
    expect(light.update(50, [at(1)])).toBe(.56);
    expect(light.update(50.15, [at(1), at(2)])).toBeCloseTo(.56 + .88 / 4, 10);
  });

  it('applies the defaults and refuses input it cannot honour', () => {
    const lamp = createPeopleLight({ position: [4, 2, 4], reach: 3 });
    expect([lamp.update(0, []), lamp.update(1, [[4, 2, 6]]), lamp.update(1.3, [[4, 2, 6]])]).toEqual([0, 1, 1]);
    expect(lamp.update(1.65, [])).toBeCloseTo(.5, 10);
    expect(lamp.update(2, [])).toBe(0);
    expect(lamp.update(3, [])).toBe(0);
    const bad = [
      { position: [0, Number.NaN, 0] }, { near: [0, 0] }, { reach: 0 }, { capacity: Number.NaN }, { capacity: 0 },
      { pilot: -.1 }, { full: 1.2 }, { pilot: .6, full: .5 }, { rise: -1 }, { fade: Infinity },
    ];
    for (const change of bad) expect(() => createPeopleLight({ position: [0, 0, 0], reach: 2, ...change } as never), JSON.stringify(change)).toThrow(RangeError);
    expect(() => lamp.update(Number.NaN, [])).toThrow(RangeError);
    expect(() => lamp.update(4, [[0, Infinity, 0]])).toThrow(RangeError);
    const pinned = createPeopleLight({ position: [0, 0, 0], reach: 1, pilot: .4, full: .4, rise: 0, fade: 0 });
    expect([pinned.update(0, []), pinned.update(1, [[0, 0, 0]])]).toEqual([.4, .4]);
  });
});
