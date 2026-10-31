import { expect, it } from 'vitest';
import { createHomeStepMaterial, createWalkFootsteps, type WalkFootstepFrame } from './walk-footsteps';
import { MATERIALS, MAT } from '@chatdom/content';
import { VOXEL_FIXTURE } from '@chatdom/shared/world-fixtures';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';

it('sounds only travelled gait contacts, consuming jumps, corrections and returning ownership without catch-up', () => {
  const steps = createWalkFootsteps();
  let now = 0, placement = 0, revision = 1;
  const frame = (distance: number, options: Partial<WalkFootstepFrame> = {}) => {
    now += 100;
    return steps.update({ now, pose: { distance, x: distance, y: 0, z: 0, speed: 4 },
      active: true, grounded: true, placement, revision, ...options });
  };
  // A mounted avatar can already have travelled; no arrival footfall. Stops do not run a timer.
  expect(frame(.85)).toBeNull();
  expect(frame(.85)).toBeNull();
  expect(frame(.95)).toBe(1);
  expect(frame(1.4)).toBeNull();
  expect(frame(1.81)).toBe(2);
  // Distance also grows in flight. Neither the jump, its crossed contacts nor first landing replay.
  expect(frame(2.2, { grounded: false })).toBeNull();
  expect(frame(2.8, { grounded: false })).toBeNull();
  expect(frame(3.65)).toBeNull();
  expect(frame(4.05)).toBeNull();
  expect(frame(4.55)).toBe(5);
  // Even a short room placement across a thin wall consumes its crossed contact.
  placement++;
  expect(frame(5.45)).toBeNull();
  revision++;
  expect(frame(5.5)).toBeNull();
  expect(frame(9)).toBeNull(); // Large correction, no burst.
  expect(frame(9.5)).toBeNull();
  now += 2000;
  expect(frame(9.95)).toBeNull(); // Hidden/paused render clock.
  expect(frame(10.4)).toBeNull();
  expect(frame(10.85)).toBe(12);
  expect(frame(11.5, { active: false })).toBeNull(); // Menu, mute, disconnect or released camera.
  expect(frame(11.75)).toBeNull(); // Owner returns at a crossed contact.
  expect(frame(12.15)).toBeNull();
  expect(frame(12.65)).toBe(14);
  steps.reset(); // Visibility/blur can interrupt and return between render frames.
  expect(frame(13.55)).toBeNull();
});

it('reads the retained rotated home floor and respects material overwrites and carved air', () => {
  const blueprint: VoxelBlueprint = { ...VOXEL_FIXTURE, size: [8, 4, 8], windows: [], boxes: [
    { from: [0, 0, 0], to: [8, 2, 8], material: MAT.stone },
    { from: [2, 1, 2], to: [4, 2, 4], material: MAT.timber },
    { from: [3, 1, 2], to: [4, 2, 4], material: MAT.air },
  ] };
  const sample = createHomeStepMaterial({ materials: MATERIALS, assets: [{ assetHash: 'floor', blueprint }],
    placements: [{ id: 'home', plotId: 'owned-plot', assetHash: 'floor', position: [10, 2, 20], rotation: 1 }] });
  const feet = (x: number, y: number, z: number): Vec3 => [10 + z * .125, 2 + y * .125, 20 - x * .125];
  expect(sample('owned-plot', feet(2.5, 2, 2.5))).toBe('wood');
  expect(sample('owned-plot', feet(1.5, 2, 2.5))).toBe('stone');
  expect(sample('owned-plot', feet(3.5, 2, 2.5))).toBeUndefined(); // Air cut wins over the wood.
  expect(sample('owned-plot', feet(3.5, 1, 2.5))).toBe('stone'); // Its lower stone support remains.
  expect(sample('unknown-plot', feet(2.5, 2, 2.5))).toBeUndefined();
  expect(sample(null, feet(2.5, 2, 2.5))).toBeUndefined();
});
