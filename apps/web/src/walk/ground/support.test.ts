import { describe, expect, it } from 'vitest';
import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';
import { createSupportClassifier } from './support';

const FLOOR = -16;
const box = (min: [number, number, number], max: [number, number, number]): SolidBox => ({ min, max });

/**
 * A small founded world: terrain columns on half-metre cells from the floor up to 1 m, a 2 m stone plinth from
 * (4, 4) whose top is 1.5 m, and three 0.25 m stair treads climbing along +z from (8, 0).
 */
function world(): CollisionWorld & { queries: number } {
  const solids: SolidBox[] = [];
  for (let x = -8; x < 16; x += .5) for (let z = -8; z < 16; z += .5) solids.push(box([x, FLOOR, z], [x + .5, 1, z + .5]));
  solids.push(box([4, 1, 4], [6, 1.5, 6]));
  for (let n = 0; n < 3; n++) solids.push(box([8, 1, n * .5], [9, 1.25 + n * .25, n * .5 + .5]));
  const fake = {
    revision: 1, queries: 0,
    query(bounds: SolidBox) {
      fake.queries++;
      return solids.filter(s => s.min[0] < bounds.max[0] && s.max[0] > bounds.min[0] && s.min[1] < bounds.max[1] && s.max[1] > bounds.min[1]
        && s.min[2] < bounds.max[2] && s.max[2] > bounds.min[2]);
    },
  };
  return fake;
}

describe('what the feet rest on', () => {
  it('tells open terrain from placements under or around the feet', () => {
    const support = createSupportClassifier(world(), { terrainFloorY: FLOOR });
    expect(support.at(0, 1, 0)).toBe('terrain');
    expect(support.at(5, 1.5, 5)).toBe('solid');
    // Beside the plinth, within the body's radius of its side, the drawn terrain is not the whole story either.
    expect(support.at(3.8, 1, 5)).toBe('solid');
    expect(support.at(3.6, 1, 5)).toBe('terrain');
    expect(support.at(8.5, 1.5, 1.25)).toBe('solid');
    // Feet more than a step above the plinth top (a jump high over it) are not resting on it.
    expect(support.at(5, 4, 5)).toBe('terrain');
    expect(support.at(Number.NaN, 1, 0)).toBe('solid');
  });

  it('queries each 4 m bin once, however many walkers sample it', () => {
    const fake = world();
    const support = createSupportClassifier(fake, { terrainFloorY: FLOOR });
    for (let n = 0; n < 500; n++) support.at(.5 + (n % 30) * .1, 1, .5 + (n % 7) * .3);
    expect(support.queries).toBe(1);
    expect(fake.queries).toBe(1);
    support.at(5, 1.5, 5);
    expect(support.queries).toBe(2);
  });

  it('drops the oldest bins past its capacity', () => {
    const support = createSupportClassifier(world(), { terrainFloorY: FLOOR, bins: 2 });
    support.at(1, 1, 1); support.at(5, 1, 1); support.at(9, 1, 1);
    expect(support.queries).toBe(3);
    support.at(9, 1, 1); support.at(5, 1, 1);
    expect(support.queries).toBe(3);
    support.at(1, 1, 1);
    expect(support.queries).toBe(4);
  });

  it('answers the stepped floor a sole lands on, below a given height, and nothing on bare terrain', () => {
    const support = createSupportClassifier(world(), { terrainFloorY: FLOOR });
    expect(support.topAt(8.5, .25, 2)).toBe(1.25);
    expect(support.topAt(8.5, .75, 2)).toBe(1.5);
    expect(support.topAt(8.5, 1.25, 2)).toBe(1.75);
    // A tread above `below` is a riser to the sole, not a floor.
    expect(support.topAt(8.5, 1.25, 1.6)).toBeNull();
    // A point on a tread's edge still finds it.
    expect(support.topAt(9, .5, 2)).toBe(1.5);
    expect(support.topAt(5, 5, 2)).toBe(1.5);
    expect(support.topAt(0, 0, 2)).toBeNull();
    expect(support.topAt(Number.NaN, 0, 2)).toBeNull();
  });

  it('treats unknown terrain cells as barriers, never as terrain', () => {
    const unknown: CollisionWorld = { revision: 1, query: () => [box([0, FLOOR, 0], [.5, 496, .5])] };
    const support = createSupportClassifier(unknown, { terrainFloorY: FLOOR, terrainCeilingY: 496 });
    expect(support.at(.25, 1, .25)).toBe('solid');
  });

  it('refuses a world it cannot tell terrain in', () => {
    expect(() => createSupportClassifier(world(), { terrainFloorY: Number.NaN })).toThrow();
  });
});
