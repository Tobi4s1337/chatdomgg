import { EpochMsSchema, RAID_GUEST_VISUAL_LEASE_MS, parseRaidGuestVisualMark, type RaidGuestVisualMark } from '@chatdom/shared';
import { RaidGuestProjectionSchema, type RaidGuestProjection } from '../../../api/src/raid-gate/guest-contracts';

/**
 * Reduce an accepted/duplicate ACTUAL room-arrival projection to public dress, never private identity.
 * The caller must still own that same admitted seat after every await. `confirmedAt` is the original
 * accepted arrival/present receipt time, not database completion or render time. Re-reading history,
 * receiving an invitation, or retrying an arrival must never move it forward.
 *
 * Keep this beside the authority: the browser-safe shared codec deliberately knows no private projection.
 * There is no storage, timer or cache here; room lifecycle/runtime owns revocation and the existing frame
 * owns delivery. Zero pose or identity lookups and one <=640-byte mark per actual marked walker.
 */
export function deriveRaidGuestVisualMark(
  guest: RaidGuestProjection,
  confirmedAt: number,
  now: number,
): RaidGuestVisualMark | null {
  const projection = RaidGuestProjectionSchema.safeParse(guest);
  if (!projection.success || !EpochMsSchema.safeParse(confirmedAt).success
    || confirmedAt < projection.data.arrivedAt || confirmedAt > now) return null;
  return parseRaidGuestVisualMark({
    raidId: projection.data.raidId,
    fromKingdomId: projection.data.from.kingdomId,
    fromName: projection.data.from.name,
    expiresAt: confirmedAt + RAID_GUEST_VISUAL_LEASE_MS,
  }, now);
}
