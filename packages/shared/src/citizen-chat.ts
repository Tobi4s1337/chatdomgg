import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema, TokenSchema, UIntSchema } from './identity';

/** Public witnessed speech is separate from presence. No private chat archive or person IDs. */
export const CitizenChatCueSchema = z.strictObject({
  version: z.literal(1), id: TokenSchema, kingdomId: KingdomIdSchema, epoch: TokenSchema,
  origin: z.enum(['live', 'simulated']), slot: UIntSchema.max(65534),
  asOf: EpochMsSchema, expiresAt: EpochMsSchema,
  parts: z.array(z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('text'), text: z.string().min(1).max(240) }),
    z.strictObject({ kind: z.literal('emote'), id: TokenSchema, alt: z.string().min(1).max(32) }),
  ])).min(1).max(16),
}).superRefine((cue, context) => {
  if (cue.expiresAt <= cue.asOf || cue.expiresAt > cue.asOf + 10000) context.addIssue({ code: 'custom', message: 'Speech lasts at most ten seconds' });
  if (cue.parts.reduce((count, part) => count + (part.kind === 'text' ? part.text.length : part.alt.length), 0) > 480) context.addIssue({ code: 'custom', message: 'Speech is too long for a bubble' });
});
export type CitizenChatCue = z.infer<typeof CitizenChatCueSchema>;
