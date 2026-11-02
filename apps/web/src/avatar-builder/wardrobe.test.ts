// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import { WALK_BODY } from '@chatdom/shared/realm';
import { foundedInstalledHomes, homeThreshold, settleOnFloor } from '@chatdom/world/interactions';
import { grandLand, oldLand, type Land } from '../walk/solids-lands';
import type { OwnHomeInside } from '../play/slots';
import { WARDROBE, WARDROBE_PARTS, boxesGeometry, mirrorView, wardrobeInReach, wardrobeObject, wardrobeSpot } from './wardrobe';

/** Every owned-able home on a land, as the walk lends it to the wardrobe once you are inside. */
function homesOf(land: Land): OwnHomeInside[] {
  const assets = new Map(land.scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const plots = [...new Set(land.scene.placements.filter(p => p.plotId && assets.get(p.assetHash)?.kind === 'home').map(p => p.plotId!))];
  return plots.flatMap(plotId => {
    const installed = foundedInstalledHomes(land.scene, new Map([[plotId, 'drawn']])).homes[0];
    const threshold = installed ? homeThreshold(installed, land.world) : null, anchor = threshold?.placement?.anchors[0];
    const door = anchor?.position, inside = anchor?.rest;
    return threshold?.interior && door && inside ? [{ plotId, interior: threshold.interior, door, inside, world: land.world }] : [];
  });
}

const solid = (land: Land, p: Vec3) => land.world.query({ min: [p[0] - .005, p[1] - .005, p[2] - .005], max: [p[0] + .005, p[1] + .005, p[2] + .005] })
  .some(b => p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1] && p[2] >= b.min[2] && p[2] <= b.max[2]);

describe.each([['the old land', oldLand], ['the grand land', grandLand]] as const)('the wardrobe at home on %s', (_name, make) => {
  it('stands flush in a wall of nearly every home, never in a gap, never in the way and never in reach of a body', async () => {
    const land = await make();
    const homes = homesOf(land);
    expect(homes.length).toBeGreaterThan(5);
    const placed = homes.map(home => ({ home, spot: wardrobeSpot(home) }));
    const found = placed.filter(p => p.spot);
    // A home whose every wall is windows or doorways keeps the ledger's "Your look" page as its way in.
    expect(found.length / homes.length).toBeGreaterThanOrEqual(.9);
    for (const { home, spot } of found) {
      const s = spot!, label = home.plotId;
      const at = (out: number, side: number, up: number): Vec3 =>
        [s.base[0] + s.normal[0] * out + s.normal[1] * side, s.base[1] + up, s.base[2] + s.normal[1] * out - s.normal[0] * side];
      // The press's back is let into solid wall at every corner and its face stands in open air.
      for (const side of [-.48, .48]) for (const up of [.2, 2.1]) {
        expect(solid(land, at(-WARDROBE.recess + .01, side, up)), `${label} wall behind`).toBe(true);
        expect(solid(land, at(WARDROBE.proud + .05, side, up)), `${label} air in front`).toBe(false);
      }
      // Standing at it: a clear, supported place in reach that faces it.
      const stand = settleOnFloor(land.world, at(.85, 0, 0));
      expect(stand, `${label} somewhere to stand`).not.toBeNull();
      expect(wardrobeInReach(s, stand!, Math.atan2(-s.normal[0], -s.normal[1])), `${label} in reach`).toBe(true);
      expect(wardrobeInReach(s, stand!, Math.atan2(s.normal[0], s.normal[1])), `${label} back turned`).toBe(false);
      // Well clear of the street door.
      expect(Math.hypot(s.base[0] - home.door[0], s.base[2] - home.door[2])).toBeGreaterThan(1.15);
      // The mirror's camera stands in the glass: inside the wall behind the press, square to you, under two metres off.
      const view = mirrorView(s, stand!);
      expect(solid(land, view.eye), `${label} mirror eye in the wall`).toBe(true);
      const toYou = Math.hypot(view.eye[0] - stand![0], view.eye[2] - stand![2]);
      expect(toYou, `${label} mirror distance`).toBeGreaterThan(.7);
      expect(toYou).toBeLessThan(1.8);
    }
  }, 240_000);
});

describe('the press', () => {
  it('stays shallower than a body, so walking up to the wall never passes into it', () => {
    expect(WARDROBE.proud + .06).toBeLessThan(WALK_BODY.radius);
    for (const [from, to] of WARDROBE_PARTS) {
      expect(to[2]).toBeLessThanOrEqual(WARDROBE.proud + .061);
      expect(from[2]).toBeGreaterThanOrEqual(-WARDROBE.recess);
      expect(Math.max(Math.abs(from[0]), Math.abs(to[0]))).toBeLessThanOrEqual(WARDROBE.width / 2 + .01);
      expect(to[1]).toBeLessThanOrEqual(WARDROBE.height + .01);
      for (const axis of [0, 1, 2] as const) expect(to[axis]).toBeGreaterThan(from[axis]);
    }
  });

  it('builds one mesh per material, turned onto its wall', () => {
    const spot = { base: [3, 1, 4] as Vec3, normal: [1, 0] as const, yaw: Math.PI / 2, prompt: [3.2, 2.35, 4] as Vec3 };
    const group = wardrobeObject(spot);
    expect(group.children.map(child => child.name).sort()).toEqual(['home-wardrobe:brass', 'home-wardrobe:glass', 'home-wardrobe:wood']);
    expect(group.position.toArray()).toEqual([3, 1, 4]);
    expect(boxesGeometry(WARDROBE_PARTS).getIndex()!.count).toBe(WARDROBE_PARTS.length * 36);
  });
});
