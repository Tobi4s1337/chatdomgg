import { TokenSchema, type CitizenChatCue, type KingdomId, type PersonId, type PresenceInput } from '@chatdom/shared';
import { z } from 'zod';
import type { RealmSupportObservation } from '@chatdom/shared/realm';

/** Optional private service port. Producers pass only normalized, already verified observations. */
export interface RealmDeliverySink {
  observation(input: PresenceInput): Promise<void>;
  support?(input: RealmSupportObservation): Promise<void>;
  speech(input: { readonly kingdomId: KingdomId; readonly personId: PersonId; readonly messageId: string;
    readonly observedAt: number; readonly parts: CitizenChatCue['parts']; readonly words: string | null }, current: () => boolean): void;
  remove(kingdomId: KingdomId, messageId: string): void;
  clear(kingdomId: KingdomId, personId?: PersonId): void;
}

const Message = z.object({ message: z.object({ text: z.string().max(500), fragments: z.array(z.object({
  type: z.string().max(32), text: z.string().max(500), emote: z.object({ id: TokenSchema }).nullish(),
})).max(128).optional() }) });

/** This transient extraction is installed only with a service sink. No provider payload crosses the port. */
export function speechParts(raw: unknown): CitizenChatCue['parts'] {
  const parsed = Message.safeParse(raw);
  if (!parsed.success) return [];
  const message = parsed.data.message;
  // Text is plain speech, never HTML. Commands (and their private creation words) stay out of bubbles.
  const text = message.text.trim();
  if (!text || text.startsWith('!') || text.length > 240) return [];
  if (message.fragments?.length) {
    const parts: CitizenChatCue['parts'] = [];
    for (const fragment of message.fragments) {
      if (fragment.type === 'emote' && fragment.emote && fragment.text.length > 0 && fragment.text.length <= 32) {
        parts.push({ kind: 'emote', id: fragment.emote.id, alt: fragment.text });
      } else if (fragment.text.length > 0 && fragment.text.length <= 240) parts.push({ kind: 'text', text: fragment.text });
    }
    if (parts.length > 0 && parts.length <= 16 && parts.reduce((count, part) => count + (part.kind === 'text' ? part.text.length : part.alt.length), 0) <= 480) return parts;
  }
  return [{ kind: 'text', text }];
}
