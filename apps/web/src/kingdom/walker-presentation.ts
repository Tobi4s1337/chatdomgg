import type { RealmSeat } from '@chatdom/shared/realm';
import type { InteractionRegistry } from '@chatdom/world/interactions';
import { SEAT_KINDS } from '@chatdom/world/interactions';
import type { RealmWalkerPose } from '../realm/client';

export type WalkerPresentation = RealmWalkerPose & { readonly posture?: 'seated' };

/**
 * Occupancy selects an installed anchor; it never supplies another position authority. The room keeps the
 * walking body at its supported approach. Only the drawn feet use the same record's seated rest and facing.
 */
export function presentWalkers(poses: readonly RealmWalkerPose[], seats: readonly RealmSeat[],
  registry: InteractionRegistry): readonly WalkerPresentation[] {
  const occupied = new Map(seats.map(seat => [seat.walkerId, seat]));
  return poses.map(pose => {
    const seat = occupied.get(pose.id);
    const record = seat && registry.get(seat.targetId);
    if (!record || !SEAT_KINDS.has(record.target.kind)
      || !record.rest || !record.rest.every(Number.isFinite) || record.facing === null || !Number.isFinite(record.facing)) return pose;
    const yaw = ((Math.round(record.facing * 256 / (Math.PI * 2)) % 256) + 256) % 256;
    return { ...pose, x: record.rest[0], y: record.rest[1], z: record.rest[2], yaw, speed: 0, posture: 'seated' };
  });
}
