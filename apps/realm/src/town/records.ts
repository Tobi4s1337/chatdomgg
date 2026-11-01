import { z } from 'zod';
import { EpochMsSchema, PersonIdSchema, TokenSchema, UIntSchema, type PersonId } from '@chatdom/shared';
import { GROVE_LIMIT, GroveEntrySchema, TOWN_COLOURS } from '@chatdom/shared/twitch-moments';
import type { MomentRecordTransaction } from '../../../herald/src/twitch-moments/ports';
import { RECORD_NAMESPACE } from '../../../herald/src/twitch-moments/records';

/**
 * The town's own durable records, beside the moment records in the same namespace and transaction: the night, who has
 * come home tonight, the grove, each poll's applied state and the carried-out decrees. Minimal state only; never a
 * message, a vote by person or a provider payload.
 */

/** The kingdom's current night: opened by a live broadcast, rested when it ends. `number` counts witnessed broadcasts. */
export const NightRecordSchema = z.strictObject({
  version: z.literal(1), nightKey: TokenSchema, number: UIntSchema.min(1), phase: z.enum(['open', 'rest']),
  streamId: TokenSchema.nullable(), openedAt: EpochMsSchema, changedAt: EpochMsSchema,
});
export type NightRecord = z.infer<typeof NightRecordSchema>;

/** The last night a citizen was welcomed home, and when. One per person; it says nothing about what they said. */
export const HomecomingRecordSchema = z.strictObject({
  version: z.literal(1), personId: PersonIdSchema, nightKey: TokenSchema, at: EpochMsSchema,
});
export type HomecomingRecord = z.infer<typeof HomecomingRecordSchema>;

/** Every planting by home slot: a follower's sapling, a planted tree. Lasts; a re-follow never plants twice. */
export const GroveRecordSchema = z.strictObject({ version: z.literal(1), plantings: z.array(GroveEntrySchema).max(GROVE_LIMIT) });
export type GroveRecord = z.infer<typeof GroveRecordSchema>;

/** A poll's newest applied report: begin < progress < end, ordered by provider time; an ended poll never reopens. */
export const PollRecordSchema = z.strictObject({
  version: z.literal(1), pollKey: TokenSchema, phase: z.enum(['begin', 'progress', 'end']), changedAt: EpochMsSchema,
  /** All votes in the newest applied report: Twitch's tallies only rise, so a lower total is an older report. */
  total: UIntSchema,
});
export type PollRecord = z.infer<typeof PollRecordSchema>;
/** Retained after a poll ends, so an old poll delivered late cannot reclaim the board or its decree. */
const PollHeadSchema = z.strictObject({ version: z.literal(1), pollKey: TokenSchema, startedAt: EpochMsSchema });
type PollHead = z.infer<typeof PollHeadSchema>;

/** A decree the kingdom carried out. `colours`: the town flies `choice`. */
export const DecreeRecordSchema = z.strictObject({
  version: z.literal(1), subject: z.literal('colours'), choice: z.enum(TOWN_COLOURS), pollKey: TokenSchema, decidedAt: EpochMsSchema,
});
export type DecreeRecord = z.infer<typeof DecreeRecordSchema>;

/** Families the realm's record store must accept for the town (see `normalizedTownRecord`). */
export const TOWN_FAMILIES: ReadonlySet<string> = new Set(['night', 'homecoming', 'grove', 'poll', 'poll-head', 'decree', 'redemption']);

/** Validates one stored town record against its key, as the moment store does for every family. */
export function normalizedTownRecord(family: string, id: string | undefined, value: unknown): unknown {
  switch (family) {
    case 'night': if (id === undefined) return NightRecordSchema.parse(value); break;
    case 'grove': if (id === undefined) return GroveRecordSchema.parse(value); break;
    case 'poll-head': if (id === undefined) return PollHeadSchema.parse(value); break;
    case 'redemption': if (id && value === true) return true; break;
    case 'homecoming': { const r = HomecomingRecordSchema.parse(value); if (id === r.personId) return r; break; }
    case 'poll': { const r = PollRecordSchema.parse(value); if (id === r.pollKey) return r; break; }
    case 'decree': { const r = DecreeRecordSchema.parse(value); if (id === r.subject) return r; break; }
  }
  throw new TypeError('Unknown or mismatched town record');
}

const key = (family: string, id?: string) => id === undefined ? `${RECORD_NAMESPACE}:${family}` : `${RECORD_NAMESPACE}:${family}:${id}`;
async function read<T>(tx: MomentRecordTransaction, recordKey: string, schema: z.ZodType<T>): Promise<T | null> {
  const value = await tx.get(recordKey);
  if (value === undefined || value === null) return null;
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`Record ${recordKey.split(':')[1]} failed validation`);
  return parsed.data;
}

/** Typed access to the town's records inside one moment transaction. */
export function townRecords(tx: MomentRecordTransaction) {
  return {
    /** A redemption is one act even if Twitch sends it under another delivery ID. */
    claimRedemption: (redemptionId: string) => tx.claim(key('redemption', TokenSchema.parse(redemptionId))),
    night: () => read(tx, key('night'), NightRecordSchema),
    putNight: (record: NightRecord) => tx.put(key('night'), NightRecordSchema.parse(record)),
    homecoming: (personId: PersonId) => read(tx, key('homecoming', personId), HomecomingRecordSchema),
    putHomecoming: (record: HomecomingRecord) => tx.put(key('homecoming', record.personId), HomecomingRecordSchema.parse(record)),
    grove: () => read(tx, key('grove'), GroveRecordSchema),
    putGrove: (record: GroveRecord) => tx.put(key('grove'), GroveRecordSchema.parse(record)),
    poll: (pollKey: string) => read(tx, key('poll', TokenSchema.parse(pollKey)), PollRecordSchema),
    putPoll: (record: PollRecord) => tx.put(key('poll', record.pollKey), PollRecordSchema.parse(record)),
    pollHead: () => read(tx, key('poll-head'), PollHeadSchema),
    putPollHead: (record: PollHead) => tx.put(key('poll-head'), PollHeadSchema.parse(record)),
    decree: () => read(tx, key('decree', 'colours'), DecreeRecordSchema),
    putDecree: (record: DecreeRecord) => tx.put(key('decree', record.subject), DecreeRecordSchema.parse(record)),
  };
}
export type TownRecords = ReturnType<typeof townRecords>;
