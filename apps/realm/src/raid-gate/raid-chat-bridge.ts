import { RealmHeraldEnvelopeSchema } from '@chatdom/shared/realm';
import type { KingdomId } from '@chatdom/shared';
import { RealmEveningBridge, type RealmEveningOptions } from '../evening/bridge';
import type { IngressReply } from '../ingress';
import type { RaidChatPresentation } from './raid-chat-presentation';

export interface RaidChatBridgeOptions extends RealmEveningOptions {
  readonly raidChat: RaidChatPresentation;
  /** Read-only retained writer check. This adapter never opens a kingdom or grants a room seat. */
  readonly current: (kingdomId: KingdomId) => boolean;
}

/**
 * The same authenticated Herald speech door, extended for a qualified visitor without a destination home.
 * Unqualified speech and all Forge work retain the existing evening owner. No fake home slot enters its path.
 */
export class RaidChatBridge extends RealmEveningBridge {
  private raidChatStopped = false;
  constructor(readonly raidOptions: RaidChatBridgeOptions) { super(raidOptions); }

  override async accept(authorization: string | undefined, raw: unknown): Promise<IngressReply> {
    if (this.raidChatStopped || this.options.ingress.gate.authenticate(authorization) !== 'herald') return super.accept(authorization, raw);
    const parsed = RealmHeraldEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return super.accept(authorization, raw);
    const envelope = parsed.data;
    if (!('chat' in envelope) && !('chatCleanup' in envelope)) return super.accept(authorization, raw);
    const input = 'chat' in envelope ? envelope.chat : envelope.chatCleanup;
    if (input.origin !== this.options.origin) return super.accept(authorization, raw);
    // Removal is applied before another await; the original evening path still removes ordinary speech.
    if ('chatCleanup' in envelope) {
      await this.raidOptions.raidChat.accept(envelope);
      return super.accept(authorization, raw);
    }
    if (!this.raidOptions.current(input.kingdomId)) { this.raidOptions.raidChat.clear(input.kingdomId); return super.accept(authorization, raw); }
    const result = await this.raidOptions.raidChat.accept(envelope);
    if (this.raidChatStopped || !this.raidOptions.current(input.kingdomId)) {
      this.raidOptions.raidChat.clear(input.kingdomId);
      return { http: 503, body: { version: 1, status: 'unavailable', message: 'The kingdom is reconnecting.' } };
    }
    if (result === 'handled') return { http: 202, body: { version: 1, status: 'relayed' } };
    return super.accept(authorization, raw);
  }

  override async stop(): Promise<void> {
    this.raidChatStopped = true; this.raidOptions.raidChat.close();
    await super.stop();
  }
}
