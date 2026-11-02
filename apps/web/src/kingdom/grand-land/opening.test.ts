import { expect, it } from 'vitest';
import { OPENING_GLIDE, OPENING_HOLD, openingPose, type OpeningLens } from './opening';

const island: OpeningLens = { eye: [450, 370, 700], target: [14, 98, 66], fov: 43 };
const hero: OpeningLens = { eye: [218, 39, 142], target: [-1, 38, -15], fov: 52 };
// A ridge between the island eye and the town that a straight dive would cut through.
const ridge = (x: number, z: number) => Math.hypot(x - 330, z - 420) < 120 ? 260 : 10;

it('holds on the island, descends without touching the land and settles exactly on the hero', () => {
  expect(openingPose(island, hero, 0, ridge)).toEqual({ ...island, done: false });
  expect(openingPose(island, hero, OPENING_HOLD - .01, ridge).eye).toEqual(island.eye);
  for (let t = OPENING_HOLD; t < OPENING_HOLD + OPENING_GLIDE; t += .25) {
    const pose = openingPose(island, hero, t, ridge);
    expect(pose.done).toBe(false);
    if (t < OPENING_HOLD + OPENING_GLIDE * .85) expect(pose.eye[1]).toBeGreaterThan(ridge(pose.eye[0], pose.eye[2]) + 20);
    expect(pose.fov).toBeGreaterThanOrEqual(43);
    expect(pose.fov).toBeLessThanOrEqual(52);
  }
  expect(openingPose(island, hero, OPENING_HOLD + OPENING_GLIDE, ridge)).toEqual({ ...hero, done: true });
});

it('is the same pose for the same shots and time', () => {
  const a = openingPose(island, hero, OPENING_HOLD + 5, ridge), b = openingPose({ ...island }, { ...hero }, OPENING_HOLD + 5, ridge);
  expect(a).toEqual(b);
});
