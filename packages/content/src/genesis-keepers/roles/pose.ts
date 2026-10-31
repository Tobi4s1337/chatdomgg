import type { AvatarPose } from '../../avatars/index';

/** Joint rotations of an authored key, in degrees (the rig's X, then Y, then Z order). */
export type Rotations = AvatarPose['rotations'];

export const pose = (id: string, label: string, rotations: Rotations): AvatarPose => ({ id, label, rotations });

/** A solved base pose with small per-bone offsets added: how an act's keys move around the pose that meets its fixture. */
export function nudge(base: Rotations, bones: Rotations): Rotations {
  const out: Record<string, readonly [number, number, number]> = { ...base };
  for (const [bone, r] of Object.entries(bones)) {
    const b = out[bone] ?? [0, 0, 0];
    out[bone] = [b[0] + r[0], b[1] + r[1], b[2] + r[2]];
  }
  return out as Rotations;
}
