import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema } from './identity';
import { PRESENCE_LEASE_MS } from './presence';

/** The same room-owned lease used by RaidGuestAuthority; presentation cannot outlive its evidence. */
export const RAID_GUEST_VISUAL_LEASE_MS = PRESENCE_LEASE_MS;
/** Bounds JSON work before parsing. The four canonical fields fit even with a 128-character Unicode name. */
export const RAID_GUEST_VISUAL_MAX_BYTES = 640;
const utf8 = new TextEncoder();

/**
 * Public decoration of an EXISTING admitted walker, never an invitation, roster or gameplay right.
 * The containing walker frame/state owns destination, origin and render key. Only the source channel ID
 * is public here: use it with the Atlas heraldry function rather than sending a second crest definition.
 * No person, entry, session, pose, reward, home or permission belongs in this mark.
 */
export const RaidGuestVisualMarkSchema = z.strictObject({
  raidId: z.string().regex(/^raid\.[a-f0-9]{64}$/u),
  fromKingdomId: KingdomIdSchema,
  fromName: z.string().min(1).max(128).regex(/^[^\p{Cc}\p{Cf}\p{Cs}]*$/u),
  expiresAt: EpochMsSchema,
});
export type RaidGuestVisualMark = z.infer<typeof RaidGuestVisualMarkSchema>;

/**
 * Both existing transports share this reader: an object on the public frame, JSON in Colyseus' flat field.
 * `now` is current authoritative time (or the client's advancing estimate), never a cached frame's time
 * on every render. A missing, malformed, expired or implausibly long lease draws no insignia.
 */
export function parseRaidGuestVisualMark(raw: unknown, now: number): RaidGuestVisualMark | null {
  if (!EpochMsSchema.safeParse(now).success) return null;
  try {
    if (typeof raw === 'string') {
      if (!raw.length || raw.length > RAID_GUEST_VISUAL_MAX_BYTES || utf8.encode(raw).byteLength > RAID_GUEST_VISUAL_MAX_BYTES) return null;
      raw = JSON.parse(raw) as unknown;
    }
    const parsed = RaidGuestVisualMarkSchema.safeParse(raw);
    if (!parsed.success || parsed.data.expiresAt <= now || parsed.data.expiresAt > now + RAID_GUEST_VISUAL_LEASE_MS) return null;
    // The same bound applies to object input; unpaired surrogates are refused by fromName's grammar.
    if (utf8.encode(JSON.stringify(parsed.data)).byteLength > RAID_GUEST_VISUAL_MAX_BYTES) return null;
    return parsed.data;
  } catch { return null; }
}

/** Canonical, bounded schema field. Empty means no mark and is backward compatible with older writers. */
export function encodeRaidGuestVisualMark(raw: RaidGuestVisualMark | null | undefined, now: number): string {
  const mark = parseRaidGuestVisualMark(raw, now);
  return mark ? JSON.stringify(mark) : '';
}
