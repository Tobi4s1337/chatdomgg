import { KingdomIdSchema } from '@chatdom/shared';
import type { DeliveryFrame } from '@chatdom/twitch';
import { describe, expect, it, vi } from 'vitest';
import { MemoryBindingStore } from '../source/bindings';
import { PresenceSource } from '../source/source';
import { ChatIngest } from './ingest';
import { planSubscriptions } from './subscriptions';

const kingdomId = KingdomIdSchema.parse('123'), now = 1_800_000_000_000;
function rig(readerId: string) {
  const plans = planSubscriptions({ broadcasterId: kingdomId, readerId, clientId: 'test-client' });
  const plan = plans.find(item => item.type === 'channel.chat.message')!;
  const source = new PresenceSource({ kingdomId, origin: 'simulated', slots: [], store: new MemoryBindingStore(), now: () => now, tickMs: 0 });
  const submit = vi.spyOn(source, 'submit').mockResolvedValue('applied');
  const speech = vi.fn(), command = vi.fn().mockResolvedValue(undefined);
  const ingest = new ChatIngest({ source, plans, conduitId: 'test-conduit', clientId: 'test-client', now: () => now,
    covered: () => true, onAuthorizationRevoked: () => {}, onSubscriptionRevoked: () => {},
    realm: { speech, command, observation: async () => {}, clear: () => {}, remove: () => {} } });
  const frame = (id: string, personId: string, text: string): DeliveryFrame => ({ kind: 'notification', meta: { messageId: id, at: now },
    subscription: { id: 'test-subscription', conduitId: 'test-conduit', status: 'enabled', type: plan.type, version: plan.version, condition: plan.condition },
    event: { broadcaster_user_id: kingdomId, chatter_user_id: personId, chatter_user_login: 'test_user', chatter_user_name: 'Test User',
      message_id: id, message: { text }, source_broadcaster_user_id: null } });
  return { ingest, submit, speech, command, frame };
}
describe('the crier is not a viewer', () => {
  it('ignores the designated separate bot before presence, speech or command submission', async () => {
    const r = rig('456');
    try {
      await r.ingest.handle(r.frame('welcome', '456', 'Welcome to the kingdom'));
      await r.ingest.handle(r.frame('bot-command', '456', '!roll 4'));
      expect(r.submit).not.toHaveBeenCalled(); expect(r.speech).not.toHaveBeenCalled(); expect(r.command).not.toHaveBeenCalled();
      expect(r.ingest.health().counters).toMatchObject({ ignoredBotChat: 2, chatSubmitted: 0, commands: 0 });
    } finally { r.ingest.dispose(); }
  });
  it('keeps the broadcaster when reading as themselves and preserves ordinary viewers', async () => {
    for (const [reader, person] of [['123', '123'], ['456', '789']]) {
      const r = rig(reader!);
      try {
        await r.ingest.handle(r.frame('human-command', person!, '!roll 4'));
        expect(r.submit).toHaveBeenCalledOnce(); expect(r.command).toHaveBeenCalledOnce();
        expect(r.ingest.health().counters.ignoredBotChat).toBe(0);
      } finally { r.ingest.dispose(); }
    }
  });
});
