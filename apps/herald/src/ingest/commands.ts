import { ChatCommandEnvelopeSchema, parseChatCommand, type ChatCommand, type KingdomId } from '@chatdom/shared';
import { z } from 'zod';
import { publicDisplayName } from '../source/observations';

const Message = z.object({ chatter_user_id: z.string(), chatter_user_login: z.string(), chatter_user_name: z.string(),
  message_id: z.string(), message: z.object({ text: z.string().max(500) }) });

/** Syntax and verified identity only. Ordinary chat and full provider payloads never enter the command port. */
export function chatCommand(raw: unknown, kingdomId: KingdomId, origin: 'live' | 'simulated', at: number): ChatCommand | null {
  const parsed = Message.safeParse(raw);
  if (!parsed.success) return null;
  const event = parsed.data, command = parseChatCommand(event.message.text), displayName = publicDisplayName(event.chatter_user_name);
  if (!command || displayName === null) return null;
  // Forge wishes remain private and transient; battle strikes already have their own witnessed port.
  if (command.command === 'forge' || command.command === 'strike') return null;
  const result = ChatCommandEnvelopeSchema.safeParse({ version: 1, kind: 'command', kingdomId, origin, at,
    messageId: event.message_id, chatter: { twitchId: event.chatter_user_id, login: event.chatter_user_login, displayName }, ...command });
  return result.success && result.data.kind === 'command' ? result.data : null;
}
