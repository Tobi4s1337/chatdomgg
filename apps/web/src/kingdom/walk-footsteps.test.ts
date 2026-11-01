import { expect, it } from 'vitest';
import { createHomeStepMaterial, createStepCueMaterial, createWalkFootsteps, type WalkFootstepFrame } from './walk-footsteps';
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

it('steps on what the public ground really is: water, laid stone, cobble, the earth of a trail, and grass by default', async () => {
  const { generateSettlementPlan, samplePublicGround, sampleLandWater } = await import('@chatdom/world');
  const { createPublicStepSurface } = await import('./walk-footsteps');
  const plan = generateSettlementPlan({ seed: 'lanternmere', tier: 'hamlet', firstYear: 2025, year: 2026 });
  const step = createPublicStepSurface(plan);
  const seen = new Map<string, number>();
  for (let x = -90; x <= 90; x += 2.5) for (let z = -90; z <= 90; z += 2.5) {
    const surface = step(x, z), ground = samplePublicGround(plan, x, z);
    seen.set(surface, (seen.get(surface) ?? 0) + 1);
    if ((sampleLandWater(plan.landform, x, z)?.shoreDistance ?? 1) < 0) { expect(surface).toBe('shallows'); continue; }
    if (ground && ground.pavingDistance <= 0) expect(['cobble', 'stone']).toContain(surface);
    else if (ground?.kind === 'trail' && ground.reservedDistance <= 0) expect(surface).toBe('earth');
    else expect(surface).toBe('grass');
  }
  // Off the paving is grass, not dirt: the old "everything off the road is earth" is gone.
  expect(seen.get('grass') ?? 0).toBeGreaterThan(seen.get('earth') ?? 0);
  expect(seen.get('cobble') ?? 0).toBeGreaterThan(0);
  // The land's painted surface wins once it can say, and standing water under it is shallows.
  const painted = createPublicStepSurface(plan, (x) => x > 0 ? { surface: 'snow', waterDepth: 0 } : { surface: 'sand', waterDepth: .2 });
  expect(painted(10, 0)).toBe('snow');
  expect(painted(-10, 0)).toBe('shallows');
}, 30_000);

it('hears other walkers nearest first, a small crowd at most, 6 dB under your own steps', async () => {
  const { createOthersSteps, othersStepDistance, OTHERS_STEP_METRES, OTHERS_STEPS_PER_HALF_SECOND } = await import('./walk-footsteps');
  // 6 dB under yours at the same distance under the mix's law 1 / (1 + d / 8).
  for (const metres of [0, 1, 4.5, 12]) expect((1 / (1 + othersStepDistance(metres) / 8)) / (1 / (1 + metres / 8))).toBeCloseTo(.5, 12);
  const steps = createOthersSteps();
  const falls = Array.from({ length: 10 }, (_, index) => ({ id: `w${index}`, distance: 11 - index }));
  falls.push({ id: 'far', distance: OTHERS_STEP_METRES + .1 }, { id: 'nan', distance: Number.NaN });
  const first = steps.choose(0, falls);
  expect(first.map(fall => fall.id)).toEqual(['w9', 'w8', 'w7', 'w6', 'w5', 'w4']);
  expect(first).toHaveLength(OTHERS_STEPS_PER_HALF_SECOND);
  // The half second is full; the same walkers cannot step again within 180 ms anyway.
  expect(steps.choose(100, falls)).toEqual([]);
  // Half a second on, the nearest are heard again; strangers beyond 12 m and broken distances never are.
  const later = steps.choose(500, falls).map(fall => fall.id);
  expect(later).toEqual(['w9', 'w8', 'w7', 'w6', 'w5', 'w4']);
  expect(later).not.toContain('far');
  steps.reset();
  expect(steps.choose(510, [{ id: 'w9', distance: 1 }])).toHaveLength(1);
});

it('gives every step surface a material the step cue plays in this build, and each ground itself once registered', () => {
  const surfaces = ['grass', 'meadow', 'earth', 'gravel', 'cobble', 'stone', 'plank', 'sand', 'snow', 'shallows', 'rock',
    'wood', 'fabric', 'glass', 'metal'] as const;
  const materials = ['wood', 'stone', 'earth', 'metal', 'glass', 'fabric'];
  const today = createStepCueMaterial([]);
  for (const surface of surfaces) expect(materials, surface).toContain(today(surface));
  expect([today('wood'), today('stone'), today('earth')]).toEqual(['wood', 'stone', 'earth']);
  expect([today('grass'), today('cobble'), today('plank'), today('rock')]).toEqual(['earth', 'stone', 'wood', 'stone']);
  const registered = createStepCueMaterial(surfaces.map(surface => `step:${surface}`));
  for (const surface of surfaces) expect(registered(surface)).toBe(surface);
  // The library's own list in this build: never a material the cue would refuse.
  const live = createStepCueMaterial();
  for (const surface of surfaces) expect([...materials, surface]).toContain(live(surface));
});
