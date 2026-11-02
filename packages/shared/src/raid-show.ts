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

/** Disposable speech at the caravan; neither a home slot nor a walker identity is implied. */
export const RAID_CHAT_CUE_TTL_MS = 10_000;
export const RAID_CHAT_MAX_CUES = 32;
export const RAID_CHAT_FRAME_MAX_BYTES = 96 * 1024;
export const RaidChatCueSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().regex(/^raid-chat\.[a-f0-9]{64}$/u),
  lightId: z.string().regex(/^raid-light\.[a-f0-9]{64}$/u),
  kingdomId: KingdomIdSchema, origin: z.enum(['live', 'simulated']),
  asOf: EpochMsSchema, expiresAt: EpochMsSchema,
  raid: RaidGuestVisualMarkSchema.omit({ expiresAt: true }),
  parts: z.array(z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('text'), text: z.string().min(1).max(240) }),
    z.strictObject({ kind: z.literal('emote'), id: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u), alt: z.string().min(1).max(32) }),
  ])).min(1).max(16),
}).superRefine((cue, context) => {
  if (cue.expiresAt <= cue.asOf || cue.expiresAt > cue.asOf + RAID_CHAT_CUE_TTL_MS) context.addIssue({ code: 'custom', message: 'Raid speech lasts at most ten seconds' });
  if (cue.parts.reduce((count, part) => count + (part.kind === 'text' ? part.text.length : part.alt.length), 0) > 480) context.addIssue({ code: 'custom', message: 'Raid speech exceeds its bubble budget' });
});
export type RaidChatCue = z.infer<typeof RaidChatCueSchema>;
export const RAID_CHAT_LIGHT_LEASE_MS = PRESENCE_LEASE_MS;
/** A witnessed chatter's light, independent of whether that message contains displayable speech. */
export const RaidChatLightSchema = z.strictObject({
  lightId: RaidChatCueSchema.shape.lightId,
  kingdomId: KingdomIdSchema, origin: z.enum(['live', 'simulated']),
  asOf: EpochMsSchema, expiresAt: EpochMsSchema,
  raid: RaidChatCueSchema.shape.raid,
}).superRefine((light, context) => {
  if (light.expiresAt <= light.asOf || light.expiresAt > light.asOf + RAID_CHAT_LIGHT_LEASE_MS) context.addIssue({ code: 'custom', message: 'Raid light cannot outlive its witnessed presence lease' });
});
export type RaidChatLight = z.infer<typeof RaidChatLightSchema>;
export const RaidChatFrameSchema = z.strictObject({
  version: z.literal(1), kingdomId: KingdomIdSchema, origin: z.enum(['live', 'simulated']),
  asOf: EpochMsSchema, lights: z.array(RaidChatLightSchema).max(RAID_CHAT_MAX_CUES), cues: z.array(RaidChatCueSchema).max(RAID_CHAT_MAX_CUES),
}).superRefine((frame, context) => {
  const lights = new Map(frame.lights.map(light => [light.lightId, light]));
  if (lights.size !== frame.lights.length || frame.lights.some(light => light.kingdomId !== frame.kingdomId
    || light.origin !== frame.origin || light.asOf > frame.asOf || light.expiresAt <= frame.asOf)) {
    context.addIssue({ code: 'custom', message: 'Raid lights do not belong to this current frame' });
  }
  if (new Set(frame.cues.map(cue => cue.id)).size !== frame.cues.length
    || new Set(frame.cues.map(cue => cue.lightId)).size !== frame.cues.length) context.addIssue({ code: 'custom', message: 'Raid speech repeats a cue or light' });
  if (frame.cues.some(cue => cue.kingdomId !== frame.kingdomId || cue.origin !== frame.origin
    || cue.asOf > frame.asOf || cue.expiresAt <= frame.asOf)) context.addIssue({ code: 'custom', message: 'Raid speech does not belong to this current frame' });
  if (frame.cues.some(cue => {
    const light = lights.get(cue.lightId);
    return !light || cue.expiresAt > light.expiresAt || cue.raid.raidId !== light.raid.raidId
      || cue.raid.fromKingdomId !== light.raid.fromKingdomId || cue.raid.fromName !== light.raid.fromName;
  })) context.addIssue({ code: 'custom', message: 'Raid speech must belong to a witnessed current light' });
});
export type RaidChatFrame = z.infer<typeof RaidChatFrameSchema>;
export interface RaidChatFeed {
  readonly origin: 'live' | 'simulated';
  subscribe(receive: (frame: RaidChatFrame) => void): () => void;
}

/** Revalidate against an advancing epoch clock even when transport stops. Expiry can only remove cues. */
export function parseRaidChatFrame(raw: unknown, now: number): RaidChatFrame | null {
  if (!EpochMsSchema.safeParse(now).success) return null;
  try {
    if (typeof raw === 'string') {
      if (raw.length > RAID_CHAT_FRAME_MAX_BYTES || utf8.encode(raw).byteLength > RAID_CHAT_FRAME_MAX_BYTES) return null;
      raw = JSON.parse(raw) as unknown;
    }
    const parsed = RaidChatFrameSchema.safeParse(raw);
    if (!parsed.success || parsed.data.asOf > now + 5_000
      || utf8.encode(JSON.stringify(parsed.data)).byteLength > RAID_CHAT_FRAME_MAX_BYTES) return null;
    const lights = parsed.data.lights.filter(light => light.expiresAt > now), keys = new Set(lights.map(light => light.lightId));
    return { ...parsed.data, lights, cues: parsed.data.cues.filter(cue => cue.expiresAt > now && keys.has(cue.lightId)) };
  } catch { return null; }
}

/** Channel-level witnessed history. A pennant never asserts who rode, arrived, or earned a stamp. */
export const RAID_PENNANT_FRAME_MAX_BYTES = 96 * 1024;
export const RAID_PENNANT_LIMIT = 64;
export const RaidPennantSchema = z.strictObject({
  raidId: RaidGuestVisualMarkSchema.shape.raidId,
  from: z.strictObject({ kingdomId: KingdomIdSchema, login: z.string().regex(/^[a-z0-9_]{1,64}$/u),
    name: RaidGuestVisualMarkSchema.shape.fromName }),
  occurredAt: EpochMsSchema,
});
export type RaidPennant = z.infer<typeof RaidPennantSchema>;
export const RaidPennantFrameSchema = z.strictObject({
  version: z.literal(1), origin: z.enum(['live', 'simulated']), kingdomId: KingdomIdSchema, asOf: EpochMsSchema,
  /** Newest incoming commit first; late history keeps its original provider date. */
  items: z.array(RaidPennantSchema).max(RAID_PENNANT_LIMIT),
}).superRefine((frame, context) => {
  if (new Set(frame.items.map(item => item.raidId)).size !== frame.items.length ||
      frame.items.some(item => item.from.kingdomId === frame.kingdomId || item.occurredAt > frame.asOf + 5_000)) {
    context.addIssue({ code: 'custom', message: 'A pennant frame needs distinct witnessed visits to this kingdom' });
  }
});
export type RaidPennantFrame = z.infer<typeof RaidPennantFrameSchema>;
export interface RaidPennantFeed {
  readonly origin: RaidPennantFrame['origin'];
  subscribe(receive: (frame: RaidPennantFrame) => void): () => void;
}

/** History does not expire; only scope, malformed data and implausible future read time invalidate it. */
export function parseRaidPennantFrame(raw: unknown, now: number): RaidPennantFrame | null {
  if (!EpochMsSchema.safeParse(now).success) return null;
  try {
    if (typeof raw === 'string') {
      if (raw.length > RAID_PENNANT_FRAME_MAX_BYTES || utf8.encode(raw).byteLength > RAID_PENNANT_FRAME_MAX_BYTES) return null;
      raw = JSON.parse(raw) as unknown;
    }
    const parsed = RaidPennantFrameSchema.safeParse(raw);
    if (!parsed.success || parsed.data.asOf > now + 5_000 ||
        utf8.encode(JSON.stringify(parsed.data)).byteLength > RAID_PENNANT_FRAME_MAX_BYTES) return null;
    return parsed.data;
  } catch { return null; }
}

export interface RaidPennantArchiveCursor {
  readonly origin: RaidPennantFrame['origin']; readonly kingdomId: z.infer<typeof KingdomIdSchema>;
  readonly ceiling: number; readonly before: number;
}
/** A public commit position, scoped to one origin/destination; never provider or person identity. */
export function parseRaidPennantArchiveCursor(raw: unknown): RaidPennantArchiveCursor | null {
  if (typeof raw !== 'string' || raw.length > 128) return null;
  const match = /^pennants:1:(live|simulated):([1-9][0-9]{0,31}):([1-9][0-9]{0,15}):([1-9][0-9]{0,15})$/u.exec(raw);
  if (!match) return null;
  const ceiling = Number(match[3]), before = Number(match[4]);
  if (!Number.isSafeInteger(ceiling) || !Number.isSafeInteger(before) || before > ceiling) return null;
  return { origin: match[1] as RaidPennantFrame['origin'], kingdomId: KingdomIdSchema.parse(match[2]), ceiling, before };
}
export const RaidPennantArchivePageSchema = z.strictObject({
  ...RaidPennantFrameSchema.shape,
  next: z.string().max(128).nullable(),
}).superRefine((page, context) => {
  const { next, ...frame } = page;
  if (!RaidPennantFrameSchema.safeParse(frame).success) context.addIssue({ code: 'custom', message: 'Invalid pennant history frame' });
  if (next !== null) {
    const cursor = parseRaidPennantArchiveCursor(next);
    if (!cursor || cursor.origin !== page.origin || cursor.kingdomId !== page.kingdomId || page.items.length === 0) {
      context.addIssue({ code: 'custom', message: 'The earlier-pennant cursor must belong to this page' });
    }
  }
});
export type RaidPennantArchivePage = z.infer<typeof RaidPennantArchivePageSchema>;
export interface RaidPennantArchiveReader {
  readonly origin: RaidPennantFrame['origin'];
  read(before: string | null, signal: AbortSignal): Promise<RaidPennantArchivePage>;
}
export function parseRaidPennantArchivePage(raw: unknown, now: number): RaidPennantArchivePage | null {
  if (!EpochMsSchema.safeParse(now).success) return null;
  try {
    if (typeof raw === 'string') {
      if (raw.length > RAID_PENNANT_FRAME_MAX_BYTES || utf8.encode(raw).byteLength > RAID_PENNANT_FRAME_MAX_BYTES) return null;
      raw = JSON.parse(raw) as unknown;
    }
    const parsed = RaidPennantArchivePageSchema.safeParse(raw);
    if (!parsed.success || parsed.data.asOf > now + 5_000 || utf8.encode(JSON.stringify(parsed.data)).byteLength > RAID_PENNANT_FRAME_MAX_BYTES) return null;
    return parsed.data;
  } catch { return null; }
}

/**
 * The gate party, public (RS11). Who chose to march, gathered at this kingdom's own gate, and where the
 * monarch is taking them. Joining the march is a public act on the stream: names and looks are the same
 * ones the walker frame already shows. No person ID, session, ticket, Twitch token or chat roster appears.
 *
 * - `gather`: the gate is open and walkers join or leave; `countdown`: Twitch holds the raid (from Twitch's
 *   own `createdAt`); `checking`: past the countdown with no witnessed raid yet; `setout`: Twitch's raid was
 *   witnessed and the party leaves through the gate. Anything else is no party (the reader returns `null`).
 * - `marchers` holds at most `RAID_PARTY_DRAWN` real walkers, leader first; `more` counts the rest. Nobody is
 *   ever drawn from `more`.
 * - `walker` is the marcher's current public walker ID in this kingdom's room, when they are walking here,
 *   so a host can draw that body once (at the gate) rather than twice.
 */
export const RAID_PARTY_DRAWN = 40;
export const RAID_PARTY_FRAME_MAX_BYTES = 24 * 1024;
const PartyName = z.string().min(1).max(64).regex(/^[^\p{Cc}\p{Cf}\p{Cs}]*$/u);
export const RaidPartyMarcherSchema = z.strictObject({
  /** Stable per party and person for this frame's lifetime, never a person ID. */
  key: z.string().regex(/^marcher\.[a-f0-9]{24}$/u),
  name: PartyName,
  look: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_.-]*$/u),
  walker: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/u).nullable(),
  /** The source monarch, walking with their people. At most one, always first. */
  leader: z.boolean(),
  joinedAt: EpochMsSchema,
});
export type RaidPartyMarcher = z.infer<typeof RaidPartyMarcherSchema>;
export const RaidPartyPublicFrameSchema = z.strictObject({
  version: z.literal(1), origin: z.enum(['live', 'simulated']), kingdomId: KingdomIdSchema, asOf: EpochMsSchema,
  phase: z.enum(['gather', 'countdown', 'checking', 'setout']),
  /** The source kingdom's own public face; its arms come from the Atlas heraldry of `kingdomId`. */
  /** Names are Twitch's own, from witnessed raid evidence or the realm's records; null when not yet known here. */
  source: z.strictObject({ login: z.string().regex(/^[a-z0-9_]{1,64}$/u).nullable(), name: PartyName.nullable() }),
  destination: z.strictObject({ kingdomId: KingdomIdSchema, login: z.string().regex(/^[a-z0-9_]{1,64}$/u).nullable(),
    name: PartyName.nullable(), land: z.enum(['founded', 'waiting', 'unknown']) }),
  countdownEndsAt: EpochMsSchema.nullable(),
  departedAt: EpochMsSchema.nullable(),
  raidId: RaidGuestVisualMarkSchema.shape.raidId.nullable(),
  marchers: z.array(RaidPartyMarcherSchema).max(RAID_PARTY_DRAWN),
  more: z.number().int().min(0).max(1_000_000),
}).superRefine((frame, context) => {
  const leaders = frame.marchers.filter(marcher => marcher.leader).length;
  if (leaders > 1 || (leaders === 1 && !frame.marchers[0]!.leader)
      || new Set(frame.marchers.map(marcher => marcher.key)).size !== frame.marchers.length
      || new Set(frame.marchers.flatMap(marcher => marcher.walker ? [marcher.walker] : [])).size !== frame.marchers.filter(marcher => marcher.walker).length
      || frame.destination.kingdomId === frame.kingdomId
      || (frame.phase === 'setout') !== (frame.departedAt !== null && frame.raidId !== null)
      || (frame.phase === 'countdown' && frame.countdownEndsAt === null)
      || (frame.more > 0 && frame.marchers.length < RAID_PARTY_DRAWN)) {
    context.addIssue({ code: 'custom', message: 'A party frame needs one leader first, distinct marchers and a phase its facts support' });
  }
});
export type RaidPartyPublicFrame = z.infer<typeof RaidPartyPublicFrameSchema>;

/** `null` is no party: nobody is gathering here. A frame older than 30 s is stale and draws nobody. */
export function parseRaidPartyFrame(raw: unknown, now: number): RaidPartyPublicFrame | null {
  if (!EpochMsSchema.safeParse(now).success) return null;
  try {
    if (typeof raw === 'string') {
      if (raw.length > RAID_PARTY_FRAME_MAX_BYTES || utf8.encode(raw).byteLength > RAID_PARTY_FRAME_MAX_BYTES) return null;
      raw = JSON.parse(raw) as unknown;
    }
    const parsed = RaidPartyPublicFrameSchema.safeParse(raw);
    if (!parsed.success || parsed.data.asOf > now + 5_000 || parsed.data.asOf < now - 30_000) return null;
    return parsed.data;
  } catch { return null; }
}

/** `GET /realm/raid-party/:kingdomId` reply: the current party, or `party: null` when nobody gathers. */
export const RaidPartyReplySchema = z.strictObject({
  version: z.literal(1), origin: z.enum(['live', 'simulated']), kingdomId: KingdomIdSchema, asOf: EpochMsSchema,
  party: RaidPartyPublicFrameSchema.nullable(),
}).superRefine((reply, context) => {
  if (reply.party && (reply.party.kingdomId !== reply.kingdomId || reply.party.origin !== reply.origin)) {
    context.addIssue({ code: 'custom', message: 'A party reply names one kingdom and origin' });
  }
});
export type RaidPartyReply = z.infer<typeof RaidPartyReplySchema>;
export interface RaidPartyPublicFeed {
  readonly origin: RaidPartyPublicFrame['origin'];
  /** Receives the current party, or `null` when nobody gathers (and on any failed or stale read). */
  subscribe(receive: (party: RaidPartyPublicFrame | null) => void): () => void;
}
