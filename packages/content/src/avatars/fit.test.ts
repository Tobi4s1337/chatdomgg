import { describe, expect, it } from 'vitest';
import { VOXEL_METRES, type AvatarPartBlueprint, type Vec3 } from '@chatdom/shared';
import { MAT } from '../materials';
import { BODY_FAMILIES, compileAvatarPart, createBodyParts, partMatrix, transformPoint, type AvatarPose } from './index';
import { Sculpt } from './sculpt';

const M = VOXEL_METRES.avatar;

/**
 * The seam between authored cells and the posed rig, through the same compiler and transforms the
 * bench uses. Expected positions are worked out by hand from the frozen joints (head pivot y = 16,
 * right shoulder [5, 15, 0], wrist 7 cells below it, grip one cell in front of the wrist), so a wrong
 * axis, a doubled pivot or a cells/metres slip moves a marker off its answer.
 */
const POSE: AvatarPose = {
  id: 'seam',
  label: 'Head turned left, right arm raised forward',
  // Head: +90° about Y turns +Z (face) towards +X. Right upper arm: −90° about X swings the hanging arm forward to horizontal.
  rotations: { head: [0, 90, 0], upperArmRight: [-90, 0, 0] },
};

/** A lopsided hat: a brim over the right-front of the crown with a brass marker on its front-right corner. */
function hatFixture(): AvatarPartBlueprint {
  return new Sculpt()
    .box([-2, 24, -2], [3, 25, 3], MAT.cream)
    .box([2, 24, 3], [3, 25, 4], MAT.brass)
    .toPart('fixture.hat', 'hat', 'accessory');
}

/** A short tool held in the right grip, its brass tip three cells ahead of the grip. */
function toolFixture(): AvatarPartBlueprint {
  return new Sculpt()
    .box([5, 7, 1], [6, 8, 4], MAT.timber)
    .box([5, 7, 4], [6, 8, 5], MAT.brass)
    .toPart('fixture.tool', 'gripRight', 'accessory');
}

/** Root-local metres of the centre of the part's only brass cell, after compiling and posing it. */
function marker(part: AvatarPartBlueprint, pose: AvatarPose): Vec3 {
  const asset = compileAvatarPart(part, 0);
  const [sx, sy] = asset.size;
  const found = [...asset.voxels.entries()].filter(([, m]) => m === MAT.brass);
  expect(found).toHaveLength(1);
  const i = found[0]![0];
  const cell: Vec3 = [i % sx, Math.floor(i / sx) % sy, Math.floor(i / (sx * sy))];
  return transformPoint(partMatrix(part, pose), cell.map(c => (c + .5) * M) as unknown as Vec3);
}

const metres = (cells: Vec3): Vec3 => cells.map(c => c * M) as unknown as Vec3;
const expectNear = (actual: Vec3, expected: Vec3): void => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 9));

describe('attachment seam', () => {
  it('places asymmetric markers where the frozen rig says, at rest and posed', () => {
    // At rest the brass cells sit where they were authored: centres at cell + ½.
    expectNear(marker(hatFixture(), { id: 'rest', label: 'rest', rotations: {} }), metres([2.5, 24.5, 3.5]));
    expectNear(marker(toolFixture(), { id: 'rest', label: 'rest', rotations: {} }), metres([5.5, 7.5, 4.5]));
    // Hat marker, head-relative (2.5, 8.5, 3.5), turned +90° about Y: (z, y, −x) = (3.5, 8.5, −2.5).
    expectNear(marker(hatFixture(), POSE), metres([3.5, 24.5, -2.5]));
    // Tool tip, shoulder-relative (0.5, −7.5, 4.5), −90° about X: (x, −z·sin, y·sin) = (0.5, 4.5, 7.5).
    expectNear(marker(toolFixture(), POSE), metres([5.5, 19.5, 7.5]));
  });

  it('keeps every body family on the same pivots, sides and posed joints', () => {
    for (const family of BODY_FAMILIES) {
      const parts = createBodyParts(family, MAT.skin3);
      const byBone = new Map(parts.map(part => [part.attachment, part]));
      expect(byBone.size).toBe(parts.length);
      const pivot = (bone: AvatarPartBlueprint['attachment'], pose: AvatarPose): Vec3 => {
        const part = byBone.get(bone)!;
        return transformPoint(partMatrix(part, pose), part.pivot.map(c => c * M) as unknown as Vec3);
      };
      // Canonical pivots: the head at y = 16, wrists at (±5, 8, 0), ankles at (±2, 1, 0), whatever the contour.
      expectNear(pivot('head', POSE), metres([0, 16, 0]));
      expectNear(pivot('handLeft', POSE), metres([-5, 8, 0]));
      expectNear(pivot('footRight', POSE), metres([2, 1, 0]));
      // The raised right wrist: (0, −7, 0) below the shoulder swings to (0, 0, 7) in front of it.
      expectNear(pivot('handRight', POSE), metres([5, 15, 7]));
      // Left parts stay on −X and right parts on +X: no mirrored attachment.
      for (const part of parts) {
        const side = part.attachment.endsWith('Left') ? -1 : part.attachment.endsWith('Right') ? 1 : 0;
        if (!side) continue;
        const asset = compileAvatarPart(part, 0);
        const [sx, sy] = asset.size;
        asset.voxels.forEach((m, i) => {
          if (!m) return;
          const x = transformPoint(partMatrix(part), [(i % sx + .5) * M, (Math.floor(i / sx) % sy + .5) * M, (Math.floor(i / (sx * sy)) + .5) * M])[0];
          expect(Math.sign(x)).toBe(side);
        });
      }
    }
  });

  it('rejects an unknown socket and a build-lattice part', () => {
    expect(() => new Sculpt().box([0, 0, 0], [1, 1, 1], MAT.cream).toPart('fixture.tail', 'tail' as never, 'accessory')).toThrow();
    const hat = hatFixture();
    expect(() => compileAvatarPart({ ...hat, attachment: 'tail' as never }, 0)).toThrow();
    expect(() => compileAvatarPart({ ...hat, lattice: 'build' as never }, 0)).toThrow();
  });
});
