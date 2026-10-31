import { describe, expect, it } from 'vitest';
import { VOXEL_METRES, type AvatarPartBlueprint, type Vec3 } from '@chatdom/shared';
import { MAT } from '../materials';
import { BODY_FAMILIES, compileAvatarPart, createBodyParts, partMatrix, transformPoint, type AvatarPose } from './index';

const M = VOXEL_METRES.avatar;
const MARK = MAT.brass;

/**
 * Deliberately asymmetric fixtures: an L-shaped hat badge on the `hat` socket and a tool on `gripRight`.
 * Each carries one brass marker cell. Their pivots are part-local cells, as the factories produce.
 */
const badge: AvatarPartBlueprint = {
  version: 1, id: 'fixture.badge', lattice: 'avatar', size: [3, 2, 1], pivot: [0, 0, 0], attachment: 'hat', layer: 'accessory',
  boxes: [{ from: [0, 0, 0], to: [3, 1, 1], material: MAT.cream }, { from: [2, 1, 0], to: [3, 2, 1], material: MARK }],
};
const tool: AvatarPartBlueprint = {
  version: 1, id: 'fixture.tool', lattice: 'avatar', size: [1, 1, 3], pivot: [0, 0, 0], attachment: 'gripRight', layer: 'accessory',
  boxes: [{ from: [0, 0, 0], to: [1, 1, 2], material: MAT.timber }, { from: [0, 0, 2], to: [1, 1, 3], material: MARK }],
};

/** Centre of the single marker cell found in the compiled asset, carried through the bench's part transform. */
function marker(part: AvatarPartBlueprint, pose: AvatarPose): Vec3 {
  const asset = compileAvatarPart(part, 0);
  const [sx, sy] = asset.size;
  const found: Vec3[] = [];
  asset.voxels.forEach((v, i) => { if (v === MARK) found.push([i % sx + .5, Math.floor(i / sx) % sy + .5, Math.floor(i / (sx * sy)) + .5]); });
  expect(found).toHaveLength(1);
  const local = found[0]!.map(n => n * M) as unknown as Vec3;
  return transformPoint(partMatrix(part, pose), local);
}

/** Root-local centre of a body part's bounds in a pose, in metres. */
function centre(part: AvatarPartBlueprint, pose: AvatarPose): Vec3 {
  return transformPoint(partMatrix(part, pose), part.size.map(n => n * M / 2) as unknown as Vec3);
}

const close = (actual: Vec3, expected: Vec3): void => {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i]!, 6);
};

const REST: AvatarPose = { id: 'rest', label: 'rest', rotations: {} };
// Head turned 90° to its left (about +Y); right arm raised straight forward (−90° about X at the shoulder).
const TURN: AvatarPose = { id: 'turn', label: 'head turn', rotations: { head: [0, 90, 0] } };
const REACH: AvatarPose = { id: 'reach', label: 'reach', rotations: { upperArmRight: [-90, 0, 0] } };

describe('avatar attachment and scale', () => {
  for (const family of BODY_FAMILIES) it(`places markers and parts in metres on the ${family} body`, () => {
    // Hat socket: head (0,16,0) + (0,8,0) = 24 cells = 1.5 m. Marker cell (2,1,0) centre (2.5,1.5,.5) cells.
    close(marker(badge, REST), [2.5 * M, 1.5 + 1.5 * M, .5 * M]);
    // Turned 90° about +Y, local (x, y, z) becomes (z, y, −x): the badge's long arm now points backward.
    close(marker(badge, TURN), [.5 * M, 1.5 + 1.5 * M, -2.5 * M]);
    // Right grip at rest: hand (5,8,0) + (0,0,1). Tool marker centre (.5,.5,2.5) cells.
    close(marker(tool, REST), [5.5 * M, 8.5 * M, 3.5 * M]);
    // Arm raised forward from the shoulder (5,15,0): hand at (5,15,7), grip offset (0,0,1) turns to (0,1,0),
    // and the tool's +Z length turns to +Y: (.5,.5,2.5) → (.5,2.5,−.5). Marker at (5.5, 18.5, 6.5) cells.
    close(marker(tool, REACH), [5.5 * M, 18.5 * M, 6.5 * M]);

    const parts = new Map(createBodyParts(family, MAT.skin5).map(part => [part.attachment, part]));
    // Canonical pivots: each family's geometry sits on the same joints. At rest a part's lowest corner is
    // its (0,0,0) cell, so these rows are where the frozen rig puts them, whatever the family's volume.
    const floor = (id: AvatarPartBlueprint['attachment']): number => transformPoint(partMatrix(parts.get(id)!, REST), [0, 0, 0])[1] / M;
    expect(floor('head')).toBeCloseTo(16, 6);
    expect(floor('handRight')).toBeCloseTo(6, 6);
    expect(floor('forearmLeft')).toBeCloseTo(8, 6);
    expect(floor('thighRight')).toBeCloseTo(4, 6);
    expect(floor('footLeft')).toBeCloseTo(0, 6);
    // Left is −X and right is +X, at the same height either side.
    const left = centre(parts.get('handLeft')!, REST), right = centre(parts.get('handRight')!, REST);
    expect(left[0]).toBeLessThan(-3 * M);
    expect(right[0]).toBeGreaterThan(3 * M);
    expect(left[1]).toBeCloseTo(right[1], 6);
    // The body's own hand follows the raised arm forward and up to shoulder height; the left hand stays put.
    const raised = centre(parts.get('handRight')!, REACH);
    expect(raised[2]).toBeGreaterThan(6 * M);
    expect(raised[1]).toBeGreaterThan(14 * M);
    close(centre(parts.get('handLeft')!, REACH), left);
    // Same head height for every family: the head tops out at 24 cells, one third of it head.
    const head = parts.get('head')!;
    expect(transformPoint(partMatrix(head, REST), [0, head.size[1] * M, 0])[1]).toBeCloseTo(24 * M, 6);
  });

  it('rejects an unknown socket and a build-lattice part', () => {
    expect(() => partMatrix({ ...badge, attachment: 'tail' as never })).toThrow();
    expect(() => compileAvatarPart({ ...badge, attachment: 'tail' as never }, 0)).toThrow();
    expect(() => compileAvatarPart({ ...badge, lattice: 'build' as never }, 0)).toThrow();
  });
});
