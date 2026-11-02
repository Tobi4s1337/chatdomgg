import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema, TokenSchema, UIntSchema } from '../../../../packages/shared/src/identity';

/** Server-to-server evidence. A raid names channels and a count, never a list of people who rode. */
const Channel = z.strictObject({
  kingdomId: KingdomIdSchema,
  login: z.string().regex(/^[a-z0-9_]{1,64}$/u),
  name: z.string().min(1).max(128).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)),
});

export const RAID_OBSERVATION_ROUTE = '/internal/realm/raid-gate/observe';
export const RAID_ROADS_ROUTE = '/realm/raid-roads';
export const RAID_PENNANTS_ROUTE = '/realm/raid-pennants/:kingdomId';
export const RAID_BEAT_WINDOW_MS = 60_000;

export const RaidObservationSchema = z.strictObject({
  version: z.literal(1),
  /** The exact EventSub message ID, preserved on every retry. */
  id: TokenSchema,
  origin: z.enum(['live', 'simulated']),
  kingdomId: KingdomIdSchema,
  direction: z.enum(['incoming', 'outgoing']),
  occurredAt: EpochMsSchema,
  receivedAt: EpochMsSchema,
  from: Channel,
  to: Channel,
  viewers: UIntSchema.min(1),
}).superRefine((value, context) => {
  if (value.from.kingdomId === value.to.kingdomId) context.addIssue({ code: 'custom', message: 'A raid joins different channels.' });
  const local = value.direction === 'incoming' ? value.to.kingdomId : value.from.kingdomId;
  if (value.kingdomId !== local) context.addIssue({ code: 'custom', message: 'The raid must match the subscribed direction.' });
  if (value.occurredAt > value.receivedAt + 5_000) context.addIssue({ code: 'custom', message: 'Provider time exceeds the clock allowance.' });
});
export type RaidObservation = z.infer<typeof RaidObservationSchema>;
export const RaidObservationEnvelopeSchema = z.strictObject({ version: z.literal(1), raid: RaidObservationSchema });
