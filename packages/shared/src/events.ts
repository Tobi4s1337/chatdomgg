import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema, PersonIdSchema, PositiveIntSchema, TokenSchema } from './identity';

export const EventCauseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('intent'), id: TokenSchema }),
  z.strictObject({ kind: z.literal('fact'), seq: PositiveIntSchema }),
  z.strictObject({ kind: z.literal('external'), source: TokenSchema, id: TokenSchema }),
  z.strictObject({ kind: z.literal('scheduled'), id: TokenSchema }),
]);
export type EventCause = z.infer<typeof EventCauseSchema>;

/** Define an actual catalogue entry. There is deliberately no catch-all unknown body. */
export function createIntentSchema<const T extends string, A extends z.ZodType>(type: T, args: A) {
  return z.strictObject({ id: TokenSchema, type: z.literal(type), args });
}

/** The seq is per kingdom. Actor null means system, never an invented person. */
export function createFactSchema<const T extends string, B extends z.ZodType>(type: T, body: B) {
  return z.strictObject({
    version: z.literal(1),
    kingdomId: KingdomIdSchema,
    seq: PositiveIntSchema,
    occurredAt: EpochMsSchema,
    receivedAt: EpochMsSchema,
    committedAt: EpochMsSchema,
    origin: z.enum(['live', 'recovered', 'simulated']),
    type: z.literal(type),
    actor: PersonIdSchema.nullable(),
    body,
    cause: EventCauseSchema,
  }).superRefine((fact, ctx) => {
    if (fact.receivedAt > fact.committedAt) {
      ctx.addIssue({ code: 'custom', path: ['committedAt'], message: 'Commit cannot precede receipt on the authoritative clock.' });
    }
    if (fact.cause.kind === 'fact' && fact.cause.seq >= fact.seq) {
      ctx.addIssue({ code: 'custom', path: ['cause', 'seq'], message: 'A cause must precede its fact in this kingdom.' });
    }
  });
}
