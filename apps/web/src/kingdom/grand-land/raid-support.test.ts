import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import { clipToRegion, createRaidMomentHooks, createRaidSupport, createShotSight, createSiteVisibility, raidTorchLights, type RaidRegion } from './raid-support';

type Box = { min: Vec3; max: Vec3 };
const region: RaidRegion = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
// A flat floor at y 2 (columns), a 4 m house at x 5..9, and a raised step at x -10..-8 (+.5 m).
const floorAt = (x: number, z: number) => x >= -10 && x < -8 && z >= -2 && z < 2 ? 2.5 : 2;
const house: Box = { min: [5, 2, -2], max: [9, 6, 2] };
function worldOf(extra: readonly Box[] = []): CollisionWorld {
  return {
    revision: 1,
    query(bounds) {
      const out: Box[] = [];
      const hit = (b: Box) => b.min.every((v, i) => v < bounds.max[i]!) && b.max.every((v, i) => v > bounds.min[i]!);
      for (const b of [house, ...extra]) if (hit(b)) out.push(b);
      // Ground columns in half-metre cells, as the compiler answers them.
      for (let x = Math.floor(bounds.min[0] * 2) / 2; x < bounds.max[0]; x += .5) for (let z = Math.floor(bounds.min[2] * 2) / 2; z < bounds.max[2]; z += .5) {
        const column: Box = { min: [x, -8, z], max: [x + .5, floorAt(x + .25, z + .25), z + .5] };
        if (hit(column)) out.push(column);
      }
      return out;
    },
  };
}
function support(options: { world?: CollisionWorld; water?: (x: number, z: number) => number | null; live?: () => boolean } = {}) {
  return createRaidSupport({ world: options.world ?? worldOf(), region,
    groundAt: (x, z) => x >= region.minX && x < region.maxX && z >= region.minZ && z < region.maxZ ? [x, floorAt(x, z), z] : null,
    waterDepth: options.water ?? (() => 0), live: options.live ?? (() => true) });
}

describe('raid prop support on the adopted floor', () => {
  it('stands a lamp and a wall bay on flat dry founded ground', () => {
    const check = support();
    expect(check({ foot: [0, 2, 0], radius: .65, height: 2.4 })).toBe(true);
    expect(check({ foot: [0, 2, 8], radius: 1.5, height: 4.5 })).toBe(true);
  });
  it('refuses a body that overlaps a house, ground that rises, water and a foot that floats', () => {
    const check = support();
    expect(check({ foot: [4.8, 2, 0], radius: .65, height: 2.4 })).toBe(false);
    expect(check({ foot: [-8, 2, 0], radius: .65, height: 2.4 })).toBe(false);
    expect(check({ foot: [0, 1.9, 0], radius: .65, height: 2.4 })).toBe(false);
    const wet = support({ water: (x) => x > -1 && x < 1 ? .3 : 0 });
    expect(wet({ foot: [0, 2, 0], radius: .65, height: 2.4 })).toBe(false);
    expect(support({ water: () => null })({ foot: [0, 2, 0], radius: .65, height: 2.4 })).toBe(false);
  });
  it('gives a wall bay its 18 cm rise and a lamp only 8 cm', () => {
    const step: Box = { min: [0, 2, 0], max: [.5, 2.15, .5] };
    const ground = (x: number, z: number): Vec3 => [x, x >= 0 && x < .5 && z >= 0 && z < .5 ? 2.15 : 2, z];
    const check = createRaidSupport({ world: worldOf([step]), region, groundAt: ground, waterDepth: () => 0, live: () => true });
    expect(check({ foot: [0, 2, 0], radius: 1.5, height: 4.5 })).toBe(true);
    expect(check({ foot: [0, 2, 0], radius: .65, height: 2.4 })).toBe(false);
  });
  it('keeps props on walkable ground, lets the visual road run beyond it, and says no once the world retires', () => {
    let live = true;
    const check = support({ live: () => live });
    expect(check({ foot: [19.8, 2, 0], radius: .65, height: 2.4 })).toBe(false);
    expect(check({ foot: [40, 2, 0], radius: 1.9, height: 5.6 })).toBe(true);
    expect(check({ foot: [0, 2, -12], radius: 1.9, height: 5.6 })).toBe(true);
    live = false;
    expect(check({ foot: [0, 2, 0], radius: .65, height: 2.4 })).toBe(false);
  });
  it('refuses malformed sites', () => {
    const check = support();
    expect(check({ foot: [Number.NaN, 2, 0], radius: .65, height: 2.4 })).toBe(false);
    expect(check({ foot: [0, 2, 0], radius: 0, height: 2.4 })).toBe(false);
    expect(check({ foot: [0, 2, 0], radius: .65, height: 40 })).toBe(false);
  });
});

describe('moment shot sightline', () => {
  const height = (x: number, z: number) => x > 30 && x < 40 ? 30 : floorAt(x, z);
  const sight = createShotSight({ world: worldOf(), region, height, live: () => true });
  it('passes a clear shot and refuses one through a house, under the land or behind a hill', () => {
    const clear = { eye: [0, 8, -15], target: [0, 3, 0], fov: 45 };
    expect(sight(clear)).toBe(clear);
    expect(sight({ eye: [0, 4, 0], target: [14, 4, 0], fov: 45 })).toBeNull();
    expect(sight({ eye: [0, 2.2, -15], target: [0, 3, 0], fov: 45 })).toBeNull();
    expect(sight({ eye: [60, 10, 0], target: [12, 3, 0], fov: 45 })).toBeNull();
  });
  it('does not let the subject hide itself and reads the land beyond the town', () => {
    expect(sight({ eye: [0, 5, 0], target: [6, 4, 0], fov: 45 })).not.toBeNull();
    expect(sight({ eye: [-200, 60, 0], target: [0, 3, -10], fov: 45 })).not.toBeNull();
  });
  it('checks pennant cloth from the camera at three heights', () => {
    const visible = createSiteVisibility(sight, () => [0, 4, -10]);
    expect(visible({ foot: [0, 2, 0], height: 4.5 })).toBe(true);
    expect(visible({ foot: [12, 2, 0], height: 3 })).toBe(true);
    const behind = createSiteVisibility(sight, () => [2, 3, 0]);
    expect(behind({ foot: [12, 2, 0], height: 3 })).toBe(false);
  });
  it('clips the line to the walkable region and keeps an inside subject as its end', () => {
    const [from, to] = clipToRegion([-40, 10, 0], [0, 2, 0], region)!;
    expect(from[0]).toBeCloseTo(-19.999, 3);
    expect(to).toEqual([0, 2, 0]);
    expect(clipToRegion([-40, 10, 30], [40, 10, 30], region)).toBeNull();
  });
});

describe('the hooks offered to raid-show', () => {
  it('bundles support, pennant sight and the shot sightline from one world', () => {
    let live = true;
    const hooks = createRaidMomentHooks({ world: worldOf(), region, live: () => live, height: floorAt, eye: () => [0, 6, -15],
      groundAt: (x, z) => [x, floorAt(x, z), z], waterDepth: () => 0 });
    expect(hooks.raidChatSupport({ foot: [0, 2, 0], radius: .65, height: 2.4 })).toBe(true);
    expect(hooks.raidPennantVisible({ foot: [0, 2, 0], height: 4.5 })).toBe(true);
    expect(hooks.validatePose({ eye: [-15, 4, 0], target: [15, 4, 0], fov: 45 })).toBeNull();
    live = false;
    expect(hooks.raidChatSupport({ foot: [0, 2, 0], radius: .65, height: 2.4 })).toBe(false);
    expect(hooks.validatePose({ eye: [0, 6, -15], target: [0, 3, 0], fov: 45 })).toBeNull();
  });
  it('lights at most twelve drawn torch posts and nothing before raid-show exposes them', () => {
    expect(raidTorchLights(undefined)).toEqual([]);
    expect(raidTorchLights({ view: {} })).toEqual([]);
    const sites = Array.from({ length: 15 }, (_, i) => ({ foot: [i, .25, 0], radius: .65, height: 2.4 }));
    const lights = raidTorchLights({ raidTorchSites: [{ foot: [Number.NaN, 0, 0] }, ...sites] });
    expect(lights).toHaveLength(12);
    expect(lights[0]).toEqual({ position: [0, 2.45, 0], strength: .85 });
  });
});
