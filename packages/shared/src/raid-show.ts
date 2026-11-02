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
