import { EpochMsSchema, PersonIdSchema, TokenSchema, UIntSchema } from '@chatdom/shared';
import { z } from 'zod';
import { DragonFormSchema } from '../../../herald/src/twitch-moments/records';

/** Fighters remembered by person for the cadence and the count; beyond this many the count still grows. */
export const DRAGON_FIGHTER_MEMORY = 4096;

/**
 * The realm's own authority over one earned dragon, private to the moment records. The public `battle` fact is
 * projected from it on every change; strikes, health and the outcome are decided here and nowhere else.
 */
export const DragonRecordSchema = z.strictObject({
  version: z.literal(1),
  battleKey: TokenSchema,
  source: z.literal('hype'),
  trainKey: TokenSchema,
  form: DragonFormSchema,
  phase: z.enum(['summoning', 'active', 'victory', 'retreat']),
  /** The fight begins (the dragon has climbed to the town's sky) and ends: retreat unless the crowd has won. */
  startsAt: EpochMsSchema,
  endsAt: EpochMsSchema,
  acceptedStrikes: UIntSchema,
  fighters: UIntSchema.max(1_000_000),
  fighterIds: z.array(PersonIdSchema).max(DRAGON_FIGHTER_MEMORY),
  sharedSessionKey: TokenSchema.nullable(),
  revision: UIntSchema,
});
export type DragonRecord = z.infer<typeof DragonRecordSchema>;
