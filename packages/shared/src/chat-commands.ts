import { z } from 'zod';
import { DisplayNameSchema, EpochMsSchema, KingdomIdSchema, PersonIdSchema, TokenSchema, TwitchLoginSchema } from './identity';

/** One Herald-only door for every realm feature's chat commands. Never carries ordinary chat text. */
export const CHAT_COMMAND_ROUTE = '/internal/realm/chat-commands';
export const CHAT_COMMAND_MAX_AGE_MS = 30_000;
export const ChatCommandNameSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/u);
export const ChatCommandArgSchema = z.string().max(32).regex(/^[^\p{Cc}\p{Cf}]*$/u).nullable();
const common = {
  version: z.literal(1), origin: z.enum(['live', 'simulated']), kingdomId: KingdomIdSchema,
  /** Actual chat message ID for commands; EventSub delivery ID for moderation cleanup. */
  messageId: TokenSchema, at: EpochMsSchema,
};
export const ChatCommandEnvelopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('command'),
    chatter: z.strictObject({ twitchId: PersonIdSchema, login: TwitchLoginSchema, displayName: DisplayNameSchema }),
    command: ChatCommandNameSchema, arg: ChatCommandArgSchema }),
  z.strictObject({ ...common, kind: z.literal('cleanup'), twitchId: PersonIdSchema.nullable(),
    reason: z.enum(['ban', 'timeout', 'delete', 'clear']), targetMessageId: TokenSchema.nullable() }),
]).superRefine((value, ctx) => {
  if (value.kind !== 'cleanup') return;
  if (value.reason === 'delete' ? value.targetMessageId === null || value.twitchId === null : value.targetMessageId !== null) {
    ctx.addIssue({ code: 'custom', message: 'Only message deletion carries a target message ID, with its author.' });
  }
  if (value.twitchId === null && value.reason !== 'clear') ctx.addIssue({ code: 'custom', message: 'Only a room clear omits an identity.' });
});
export type ChatCommandEnvelope = z.infer<typeof ChatCommandEnvelopeSchema>;
export type ChatCommand = Extract<ChatCommandEnvelope, { kind: 'command' }>;
export type ChatCommandCleanup = Extract<ChatCommandEnvelope, { kind: 'cleanup' }>;

/** Syntax only: feature names and argument meanings belong to handlers registered in the realm. */
export function parseChatCommand(text: string): { command: string; arg: string | null } | null {
  if (text.length > 256 || /[\p{Cc}\p{Cf}]/u.test(text)) return null;
  const match = /^!([a-z][a-z0-9_-]{0,31})(?: +(.+))?$/iu.exec(text.trim());
  if (!match) return null;
  const arg = match[2]?.trim() || null;
  if (!ChatCommandArgSchema.safeParse(arg).success) return null;
  return { command: match[1]!.toLowerCase(), arg };
}
