import type { ForgeChatAvailability, KingdomId } from '@chatdom/shared';
import type { DurableRealmServices } from '../persistence';
import { forgeMessageKey } from './forge';

/** Read adapters only: no chat HTTP response may reserve coal or manufacture a made piece. */
export function forgeChatAuthority(options: {
  readonly origin: 'live' | 'simulated';
  readonly services: Pick<DurableRealmServices, 'retain'>;
  readonly founded: (kingdomId: KingdomId) => boolean;
}) {
  return {
    async resolveTarget(kingdomId: KingdomId): Promise<{ broadcasterId: string; availability: ForgeChatAvailability } | null> {
      const hold = await options.services.retain(kingdomId);
      try {
        const kingdom = hold.kingdom;
        if (!kingdom.current || kingdom.origin !== options.origin || kingdom.kingdomId !== kingdomId || !options.founded(kingdomId)) return null;
        const stream = kingdom.privateState.stream;
        return { broadcasterId: kingdomId, availability: stream.sessionId !== null && stream.liveUntil > kingdom.databaseNow()
          ? { status: 'ready' }
          : { status: 'cold', reason: 'stream-offline', message: 'The forge fire rests while the stream is offline. Bring your wish when the kingdom wakes; your coal stays yours.' } };
      } finally { await hold.release(); }
    },
    async recoverCommitted(input: { kingdomId: KingdomId; personId: string; messageId: string }): Promise<{ attachmentId: string; committedAt: number } | null> {
      const hold = await options.services.retain(input.kingdomId);
      try {
        const kingdom = hold.kingdom;
        if (!kingdom.current || kingdom.origin !== options.origin || kingdom.kingdomId !== input.kingdomId) return null;
        const key = forgeMessageKey(input.kingdomId, input.messageId);
        const made = Object.values(kingdom.privateState.attachments).find(item => item.forgeKey === key && item.ownerId === input.personId
          && item.attachment.kingdomId === input.kingdomId && item.attachment.provenance.source === options.origin);
        return made ? { attachmentId: made.attachment.id, committedAt: made.attachment.committedAt } : null;
      } finally { await hold.release(); }
    },
  };
}
