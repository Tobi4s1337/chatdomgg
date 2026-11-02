import { z } from 'zod';
import { CitizenChatCueSchema } from '../citizen-chat';
import { EpochMsSchema, KingdomIdSchema, PersonIdSchema, TokenSchema, UIntSchema } from '../identity';
import { FORGE_WISH_WORDS_MAX } from '../forge-words';

/** Private service-only route. Browser callers never supply identity, slot bindings or a caller lease. */
export const REALM_HERALD_ROUTE = '/internal/realm/herald' as const;
const Origin = z.enum(['live', 'simulated']);

/** Herald reports a person; the room resolves that person's current home slot and presence epoch. */
export const RealmHeraldChatSchema = z.strictObject({
  version: z.literal(1), id: TokenSchema, kingdomId: KingdomIdSchema, personId: PersonIdSchema,
  origin: Origin, asOf: EpochMsSchema, expiresAt: EpochMsSchema, parts: CitizenChatCueSchema.shape.parts,
}).superRefine((chat, context) => {
  const publicShape = CitizenChatCueSchema.safeParse({ version: chat.version, id: chat.id,
    kingdomId: chat.kingdomId, origin: chat.origin, asOf: chat.asOf, expiresAt: chat.expiresAt,
    parts: chat.parts, epoch: 'service-check', slot: 0 });
  if (!publicShape.success) for (const issue of publicShape.error.issues) context.addIssue({
    code: 'custom', message: issue.message, path: issue.path,
  });
});

export const RealmHeraldForgeCommandSchema = z.strictObject({
  kingdomId: KingdomIdSchema, personId: PersonIdSchema, messageId: TokenSchema,
  slot: UIntSchema.max(65534), words: z.string().trim().min(1).max(FORGE_WISH_WORDS_MAX), observedAt: EpochMsSchema,
});

/** Wishes are transient private work, not domain commands, stored chat, approvals or coal grants. */
export const RealmHeraldEnvelopeSchema = z.union([
  z.strictObject({ version: z.literal(1), chat: RealmHeraldChatSchema }),
  z.strictObject({ version: z.literal(1), chatCleanup: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('remove'), origin: Origin, kingdomId: KingdomIdSchema,
      messageIds: z.array(TokenSchema).min(1).max(1000) }),
    z.strictObject({ type: z.literal('clear'), origin: Origin, kingdomId: KingdomIdSchema,
      personId: PersonIdSchema.optional() }),
  ]) }),
  z.strictObject({ version: z.literal(1), forge: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('wish'), origin: Origin, command: RealmHeraldForgeCommandSchema }),
    z.strictObject({ type: z.literal('cancel'), origin: Origin, kingdomId: KingdomIdSchema, messageId: TokenSchema }),
    z.strictObject({ type: z.literal('clear'), origin: Origin, kingdomId: KingdomIdSchema, personId: PersonIdSchema.optional() }),
  ]) }),
]);
export type RealmHeraldChat = z.infer<typeof RealmHeraldChatSchema>;
export type RealmHeraldEnvelope = z.infer<typeof RealmHeraldEnvelopeSchema>;
