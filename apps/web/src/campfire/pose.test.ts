import { describe, expect, it } from 'vitest';
import { VOXEL_METRES } from '@chatdom/shared';
import { createBodyParts, partMatrix, transformPoint } from '@chatdom/content/avatars';
import { AVATAR_PALETTE } from '@chatdom/content/materials';
import { SEATED_POSTURES, seatedPose, sharedSeatTop, solveSeat } from './pose';

const parts = createBodyParts('balanced', AVATAR_PALETTE.skin[3]);
const extent = (time: number, posture: (typeof SEATED_POSTURES)[number], filter: (attachment: string) => boolean) => {
  const pose = seatedPose({ posture, time, phase: .4, attend: .5 });
  const ys = parts.filter(p => filter(p.attachment)).flatMap(p => p.boxes.flatMap(b => [b.from, b.to].map(c => transformPoint(partMatrix(p, pose), [c[0] * VOXEL_METRES.avatar, c[1] * VOXEL_METRES.avatar, c[2] * VOXEL_METRES.avatar])[1])));
  return { min: Math.min(...ys), max: Math.max(...ys) };
};

describe('seated poses', () => {
  it('ground every posture on one seat height', () => {
    const top = sharedSeatTop();
    expect(top).toBeGreaterThan(.1);
    expect(top).toBeLessThan(.3);
    for (const posture of SEATED_POSTURES) {
      const solution = solveSeat(posture);
      expect(solution.seatTop).toBeCloseTo(top, 9);
      expect(solution.lowest).toBeGreaterThanOrEqual(-1e-9);
      expect(solution.soleForward).toBeGreaterThan(.1);
    }
  });

  it('keep soles on the ground and hips on the seat at every sampled moment', () => {
    for (const posture of SEATED_POSTURES) for (const time of [0, 1.3, 7.7, 42.1, 600.5]) {
      expect(extent(time, posture, a => a.startsWith('foot')).min).toBeCloseTo(0, 9);
      expect(extent(time, posture, () => true).min).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('is a pure function of public time', () => {
    const a = seatedPose({ posture: 'lean', time: 12.5, phase: .2, attend: -.3 });
    const b = seatedPose({ posture: 'lean', time: 12.5, phase: .2, attend: -.3 });
    expect(a).toEqual(b);
    expect(seatedPose({ posture: 'lean', time: 13.5, phase: .2, attend: -.3 })).not.toEqual(a);
  });
});
