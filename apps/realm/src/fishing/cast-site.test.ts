import { describe, expect, it } from 'vitest';
import type { FishingPierSite, Vec3 } from '@chatdom/shared';
import type { RealmChannelPose } from '../room-channels';
import { aimFishingCast, onFishingLip } from './cast-site';

const base: FishingPierSite = { version: 1, id: 'pier:lake', root: [100, 0, 200], turn: 0, deckY: 2, waterY: 1, walk: 20, water: 'lake', biome: 'meadow', depth: [] };
const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]] as const;
const rights = [[1, 0], [0, -1], [-1, 0], [0, 1]] as const;
const poseAt = (site: FishingPierSite, across = 0, along = 23.4, height = site.deckY, yaw = site.turn * 64): RealmChannelPose => {
  const out = directions[site.turn]!, right = rights[site.turn]!;
  return { position: [site.root[0] + across * right[0] + along * out[0], height, site.root[2] + across * right[1] + along * out[1]], yaw, grounded: true, collisionRevision: 7 };
};
const deep = () => ({ waterY: 1, groundY: 0 });

describe('authoritative pier cast geometry', () => {
  it.each([0, 1, 2, 3] as const)('casts outward on turn %i using byte yaw and charge distance', turn => {
    const site = { ...base, turn }, pose = poseAt(site), [dx, dz] = directions[turn]!;
    for (const [charge, distance] of [[200, 2], [1600, 7], [5000, 7]] as const) {
      const result = aimFishingCast(site, pose, 7, charge, deep);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.anchor).toEqual(pose.position);
      expect(result.float[0]).toBeCloseTo(site.root[0] + (site.walk + 4 + distance) * dx, 8);
      expect(result.float[1]).toBe(site.waterY);
      expect(result.float[2]).toBeCloseTo(site.root[2] + (site.walk + 4 + distance) * dz, 8);
      expect(result.depthM).toBe(1);
    }
    expect(aimFishingCast(site, { ...pose, yaw: (turn * 64 + 128) % 256 }, 7, 200, deep).ok).toBe(false);
    expect(aimFishingCast(site, { ...pose, yaw: (turn * 64 + 24) % 256 }, 7, 200, deep).ok).toBe(true);
    expect(aimFishingCast(site, { ...pose, yaw: (turn * 64 + 25) % 256 }, 7, 200, deep).ok).toBe(false);
  });

  it('requires a grounded body on the current revision, at the lip with valid byte yaw', () => {
    const pose = poseAt(base);
    for (const bad of [{ ...pose, grounded: false }, { ...pose, collisionRevision: 6 }, { ...pose, yaw: -1 }, { ...pose, yaw: 256 }, { ...pose, yaw: 0.5 },
      { ...pose, position: [NaN, 2, 223.4] as Vec3 }, { ...pose, position: [100, Infinity, 223.4] as Vec3 }, poseAt(base, 0, 22.899), poseAt(base, 0, 23.851), poseAt(base, 3.551), poseAt(base, -3.551), poseAt(base, 0, 23.4, 2.301)]) {
      expect(onFishingLip(base, bad, 7)).toBe(false);
      expect(aimFishingCast(base, bad, 7, 200, deep).ok).toBe(false);
    }
    for (const valid of [poseAt(base, 0, 22.9), poseAt(base, 0, 23.85), poseAt(base, 3.55), poseAt(base, -3.55), poseAt(base, 0, 23.4, 2.3)]) expect(onFishingLip(base, valid, 7)).toBe(true);
    expect(onFishingLip(base, pose, -1)).toBe(false);
    expect(onFishingLip(base, pose, NaN)).toBe(false);
  });

  it('refuses a malformed site without throwing', () => {
    const pose = poseAt(base);
    for (const malformed of [{ ...base, root: null }, { ...base, root: [100, 0] }, { ...base, version: 2 }, { ...base, id: 'pier:forged' }]) {
      expect(() => onFishingLip(malformed as unknown as FishingPierSite, pose, 7)).not.toThrow();
      expect(onFishingLip(malformed as unknown as FishingPierSite, pose, 7)).toBe(false);
    }
  });

  it('refuses invalid site fields, charge values, and any bad point along the water corridor', () => {
    const pose = poseAt(base);
    for (const site of [{ ...base, turn: 4 }, { ...base, walk: 0 }, { ...base, walk: NaN }, { ...base, deckY: NaN }, { ...base, waterY: Infinity }, { ...base, root: [NaN, 0, 0] }]) {
      expect(onFishingLip(site as FishingPierSite, pose, 7)).toBe(false);
    }
    for (const charge of [NaN, Infinity, -1, 199.999, 5000.001]) expect(aimFishingCast(base, pose, 7, charge, deep).ok).toBe(false);
    const visited: number[] = [];
    expect(aimFishingCast(base, pose, 7, 1600, (_x, z) => { visited.push(z); return deep(); }).ok).toBe(true);
    expect(visited.length).toBe(29);
    expect(visited[0]).toBeCloseTo(224, 8);
    expect(visited.at(-1)).toBeCloseTo(231, 8);
    for (let i = 1; i < visited.length; i++) expect(visited[i]! - visited[i - 1]!).toBeCloseTo(.25, 8);
    for (const bad of [{ waterY: null, groundY: 0 }, { waterY: 1, groundY: .0001 }, { waterY: 1.002, groundY: 0 }, { waterY: 1, groundY: NaN }, { waterY: NaN, groundY: 0 }]) {
      expect(aimFishingCast(base, pose, 7, 1600, (_x, z) => Math.abs(z - 227) < .001 ? bad : deep()).ok).toBe(false);
    }
  });
});
