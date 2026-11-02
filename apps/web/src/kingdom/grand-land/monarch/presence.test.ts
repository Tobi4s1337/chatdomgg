import { describe, expect, it } from 'vitest';
import { MONARCH_GAZE_MS, MONARCH_RETURN_MS, createMonarchPresence, findMonarch, gazeToward, monarchBeacon } from './presence';
import { arrivalKey, bearingWords, firstArrival } from './arrival-line';
import { homeMarkStrength } from './home-mark';
import { crownBoxes } from './crown';

const at = (id: string, x: number, z: number, crown = '', self = false) => ({ id, x, y: 0, z, crown, self });

describe('the monarch among the walkers', () => {
  it('trusts only the room’s crown mark, and names nobody when two walkers carry it', () => {
    expect(findMonarch([at('a', 0, 0), at('b', 1, 1, 'Monarch')])?.id).toBe('b');
    expect(findMonarch([at('a', 0, 0, 'monarch')])).toBeNull();
    expect(findMonarch([at('a', 0, 0, 'King'), at('b', 1, 1, 'Queen')])).toBeNull();
    expect(findMonarch([at('a', 0, 0)])).toBeNull();
  });

  it('rings once when the monarch walks in, not for a monarch already walking when you open the kingdom', () => {
    const watcher = createMonarchPresence();
    expect(watcher.update(0, [at('c', 0, 0), at('m', 4, 0, 'Monarch')]).arrived).toBe(false);
    const later = createMonarchPresence();
    expect(later.update(0, [at('c', 0, 0)]).arrived).toBe(false);
    expect(later.update(100, [at('c', 0, 0), at('m', 4, 0, 'Monarch')]).arrived).toBe(true);
    expect(later.update(200, [at('c', 0, 0), at('m', 4, 0, 'Monarch')]).arrived).toBe(false);
    // A dropped connection is not a second entrance; a real return after a while is.
    later.update(300, [at('c', 0, 0)]);
    expect(later.update(5_000, [at('c', 0, 0), at('m', 4, 0, 'Monarch')]).arrived).toBe(false);
    later.update(5_100, [at('c', 0, 0)]);
    expect(later.update(5_100 + MONARCH_RETURN_MS + 1, [at('c', 0, 0), at('m', 4, 0, 'Monarch')]).arrived).toBe(true);
  });

  it('greets the monarch’s own arrival with the bell', () => {
    const own = createMonarchPresence();
    expect(own.update(0, [at('m', 0, 0, 'Monarch', true)]).arrived).toBe(true);
  });

  it('turns nearby heads toward the monarch as they walk in, within a neck’s reach, then lets them go', () => {
    const monarch = findMonarch([at('m', 0, 10, 'Monarch')]);
    // Facing +X (heading π/2), the monarch is to the left: a negative turn, clamped to the neck.
    const turned = gazeToward(monarch, 0, 2_000, { id: 'c', x: 0, z: 0, heading: Math.PI / 2 })!;
    expect(turned.yaw).toBeLessThan(0);
    expect(Math.abs(turned.yaw)).toBeLessThanOrEqual(1.05);
    // Facing them already: no turn needed.
    expect(Math.abs(gazeToward(monarch, 0, 2_000, { id: 'c', x: 0, z: 0, heading: 0 })!.yaw)).toBeLessThan(1e-6);
    // Too far, too late, or the monarch themselves: heads keep their own pose.
    expect(gazeToward(monarch, 0, 2_000, { id: 'c', x: 0, z: -20, heading: 0 })).toBeUndefined();
    expect(gazeToward(monarch, 0, MONARCH_GAZE_MS + 100, { id: 'c', x: 9, z: 10, heading: 0 })).toBeUndefined();
    expect(gazeToward(monarch, 0, 2_000, { id: 'm', x: 0, z: 10, heading: 0 })).toBeUndefined();
    // Close by, people still look up as the monarch passes.
    expect(gazeToward(monarch, 0, MONARCH_GAZE_MS + 100, { id: 'c', x: 2, z: 10, heading: 0 })?.weight).toBeGreaterThan(.5);
  });

  it('catches the beacon on arrival, settles it while the monarch stays, and leaves it dark when they are away', () => {
    expect(monarchBeacon(false, 0, 1_000)).toBe(0);
    expect(monarchBeacon(true, 0, 0)).toBe(0);
    expect(monarchBeacon(true, 0, 1_600)).toBeCloseTo(.88, 2);
    expect(monarchBeacon(true, 0, 1_600)).toBeLessThan(.9); // The live beacon's own cue stays its own.
    expect(monarchBeacon(true, 0, 20_000)).toBeCloseTo(.5, 2);
  });
});

describe('the arrival line', () => {
  it('speaks to a guest or citizen once per standing, and to the monarch every time', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    expect(firstArrival(storage, '129634568', 'guest')).toBe(true);
    storage.setItem(arrivalKey('129634568', 'guest'), '1');
    expect(firstArrival(storage, '129634568', 'guest')).toBe(false);
    expect(firstArrival(storage, '129634568', 'citizen')).toBe(true);
    expect(firstArrival(storage, '129634568', 'monarch')).toBe(true);
  });
  it('says where the castle stands from where you look', () => {
    expect(bearingWords([0, 0], [0, 1], [0, 10])).toBe('ahead of you');
    expect(bearingWords([0, 0], [0, 1], [0, -10])).toBe('behind you');
    // Looking along +Z, the right hand is -X.
    expect(bearingWords([0, 0], [0, 1], [-10, 0])).toBe('to your right');
    expect(bearingWords([0, 0], [0, 1], [10, 0])).toBe('to your left');
  });
  it('marks your home from across the town and lets the mark go as you reach your door', () => {
    expect(homeMarkStrength(3, 1)).toBe(0);
    expect(homeMarkStrength(40, 0)).toBeGreaterThan(.3);
    expect(homeMarkStrength(40, 1)).toBeGreaterThan(homeMarkStrength(40, 0));
  });
});

describe('the crown', () => {
  it('is a small circlet that sits on a head, with its stones at the brow and temples', () => {
    const boxes = crownBoxes();
    const width = Math.max(...boxes.map(box => box.max[0])) - Math.min(...boxes.map(box => box.min[0]));
    const height = Math.max(...boxes.map(box => box.max[1]));
    expect(width).toBeGreaterThan(.3); expect(width).toBeLessThan(.42);
    expect(height).toBeLessThan(.2);
    expect(boxes.filter(box => box.paint === '#b3263a')).toHaveLength(1);
  });
});
