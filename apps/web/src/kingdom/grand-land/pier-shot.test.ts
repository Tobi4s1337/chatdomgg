import { describe, expect, it } from 'vitest';
import type { RealmFoundedScene } from '@chatdom/world';
import { pierShot } from './pier-shot';

// A 2.5 m wide, 16 m deck and a 4 m deep, 8 m wide head, as 0.125 m build-lattice blueprints.
const deck = { assetHash: 'deck', blueprint: { lattice: 'build', size: [20, 4, 128], boxes: [] } };
const head = { assetHash: 'head', blueprint: { lattice: 'build', size: [64, 4, 32], boxes: [] } };
const home = { assetHash: 'home', blueprint: { lattice: 'build', size: [64, 64, 64], boxes: [] } };

/** Willowmere's pier as pier frames it: root (238.25, 227.75), deck out toward -X (turn 3), deck top at 0. */
function scene(withPier = true) {
  const placements = [{ id: 'home:1', assetHash: 'home', position: [200, 0, 200], rotation: 0 }];
  if (withPier) placements.push(
    // Turn 3 maps local [x, z] to [-z, x]: local +Z (out) is world -X, local +X (side) is world +Z.
    { id: 'pier:lake:deck', assetHash: 'deck', position: [238.25, 0, 226.5], rotation: 3 },
    { id: 'pier:lake:head', assetHash: 'head', position: [222.25, 0, 223.75], rotation: 3 },
  );
  return { assets: [deck, home, head], placements } as unknown as Pick<RealmFoundedScene, 'assets' | 'placements'>;
}
const flat = () => -2;

describe('the pier shot', () => {
  it("frames the deck from the shore with pier's own starting pose", () => {
    const pose = pierShot(scene(), flat)!;
    expect(pose.root).toEqual([238.25, 0, 227.75]);
    expect(pose.head).toEqual([218.25, 0, 227.75]);
    expect(pose.target).toEqual([228.25, 0, 227.75]);
    // 16 m behind the root along the deck, 18 m to its +X-local side, 9 m over the deck.
    expect(pose.eye).toEqual([254.25, 9, 245.75]);
    expect(pose.fov).toBe(45);
  });

  it('takes the other side when the land cuts the sightline, and keeps air over a rise', () => {
    const ridge = (_x: number, z: number) => (z > 236 ? 12 : -2);
    const pose = pierShot(scene(), ridge)!;
    expect(pose.eye[2]).toBe(209.75);
    const hill = (x: number) => (x > 250 ? 10 : -2);
    expect(pierShot(scene(), hill)!.eye[1]).toBe(13);
  });

  it('offers no shot without a pier, so the director never cuts to an empty bank', () => {
    expect(pierShot(scene(false), flat)).toBeNull();
  });
});
