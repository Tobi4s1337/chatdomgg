import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema } from './identity';

/**
 * The anvil's line, read by anyone in the kingdom. Wishes are durable from the moment the realm accepts them;
 * several may be drafted at once, but the stream sees one ritual at a time, in the order the wishes arrived.
 * Position 0 is the wish whose ritual is being shown at the anvil now; position 1 is next.
 * Never carries a wish's words, a verdict or a private reason.
 */
export const FORGE_QUEUE_ROUTE = '/api/realm/forge/queue' as const;
export const FORGE_QUEUE_LIMITS = {
  /** Readers poll while the anvil card or the Forge panel is open. */
  pollMs: 3000,
  /** After this long at the anvil, the Forge says the smith is taking care rather than staying silent. */
  slowMs: 30_000,
  /** The broadcaster's list shows at most this many makers. */
  makers: 24,
} as const;

const Count = z.number().int().min(0).max(4096);
export const ForgeQueueStateSchema = z.enum(['waiting', 'forging']);
export type ForgeQueueState = z.infer<typeof ForgeQueueStateSchema>;

export const ForgeQueueMakerSchema = z.strictObject({
  position: Count,
  /** The approved name the citizen card shows; never a Twitch login guessed from an ID. */
  name: z.string().min(1).max(64),
  state: ForgeQueueStateSchema,
});
export type ForgeQueueMaker = z.infer<typeof ForgeQueueMakerSchema>;

export const ForgeQueueViewSchema = z.strictObject({
  version: z.literal(1),
  kingdomId: KingdomIdSchema,
  /** Every wish the realm holds for this kingdom that has not ended, including the one at the anvil. */
  total: Count,
  /** Wishes behind the one at the anvil. */
  waiting: Count,
  /** When the ritual now at the anvil began, or null when the anvil rests. */
  forgingSince: EpochMsSchema.nullable(),
  at: EpochMsSchema,
  /** Only for the signed-in maker: their own place in line. */
  yours: z.strictObject({ position: Count, state: ForgeQueueStateSchema }).optional(),
  /** Only for the kingdom's broadcaster: who waits, in order, by approved name. */
  makers: z.array(ForgeQueueMakerSchema).max(FORGE_QUEUE_LIMITS.makers).optional(),
});
export type ForgeQueueView = z.infer<typeof ForgeQueueViewSchema>;
