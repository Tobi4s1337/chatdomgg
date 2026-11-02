import { CHAT_COMMAND_MAX_AGE_MS, KingdomIdSchema, PersonIdSchema, type ChatCommandEnvelope } from '@chatdom/shared';
import type { DeliveryFrame } from '@chatdom/twitch';
import { describe, expect, it, vi } from 'vitest';
import type { RealmDeliverySink } from '../realm-delivery/sink';
import { MemoryBindingStore } from '../source/bindings';
import { PresenceSource } from '../source/source';
import { chatCommand } from './commands';
import { ChatIngest } from './ingest';
import { planSubscriptions, type HeraldEventType } from './subscriptions';

const kingdomId = KingdomIdSchema.parse('123'), start = 1_800_000_000_000;
const raw = (text: string, messageId = 'chat-id') => ({ broadcaster_user_id: kingdomId, chatter_user_id: '789',
  chatter_user_login: 'simulated_chatter', chatter_user_name: 'SIMULATED Chatter', message_id: messageId,
  message: { text }, source_broadcaster_user_id: null });
function rig() {
  const clock = { now: start }, coverage = { value: true };
  const command = vi.fn<NonNullable<RealmDeliverySink['command']>>().mockResolvedValue(undefined);
  const speech = vi.fn();
  const source = new PresenceSource({ kingdomId, origin: 'simulated', slots: [], store: new MemoryBindingStore(), now: () => clock.now, tickMs: 0 });
  const plans = planSubscriptions({ broadcasterId: kingdomId, readerId: '456', clientId: 'SIMULATED' });
  const ingest = new ChatIngest({ source, conduitId: 'SIMULATED', clientId: 'SIMULATED', plans, now: () => clock.now,
    covered: () => coverage.value, onAuthorizationRevoked: () => {}, onSubscriptionRevoked: () => {},
    realm: { command, speech, observation: async () => {}, remove: () => {}, clear: () => {} } });
  const frame = (id: string, event: unknown, type: HeraldEventType = 'channel.chat.message', at = clock.now): DeliveryFrame => {
    const plan = plans.find(plan => plan.type === type)!;
    return { kind: 'notification', meta: { messageId: id, at }, subscription: { id: 'SIMULATED', conduitId: 'SIMULATED', status: 'enabled',
      type: plan.type, version: plan.version, condition: plan.condition }, event };
  };
  return { clock, coverage, command, speech, source, ingest, frame };
}

describe('generic command forwarding', () => {
  it('forwards six names including an unknown name with only bounded syntax and witnessed identity', async () => {
    const r = rig();
    vi.spyOn(r.source, 'submit').mockRejectedValue(new Error('SIMULATED presence unavailable'));
    try {
      for (const name of ['sus', 'drop', 'roll', 'hold', 'pull', 'future-game']) {
        await r.ingest.handle(r.frame(`receipt-${name}`, raw(`!${name.toUpperCase()} 4`, `chat-${name}`)));
      }
      expect(r.command.mock.calls.map(call => call[0])).toEqual(['sus', 'drop', 'roll', 'hold', 'pull', 'future-game'].map(command => ({
        version: 1, kind: 'command', origin: 'simulated', kingdomId, messageId: `chat-${command}`, at: start,
        chatter: { twitchId: '789', login: 'simulated_chatter', displayName: 'SIMULATED Chatter' }, command, arg: '4' })));
      // Presence failure cannot lose a syntactically valid command awaiting its own durable write.
      expect(r.source.health().counters.applied).toBe(0);
      expect(r.ingest.health().counters.commands).toBe(6);
      for (const text of ['ordinary private chat', '!drop ' + 'x'.repeat(33), '!roll\n2', '!!roll', '!9no']) {
        expect(chatCommand(raw(text), kingdomId, 'live', start)).toBeNull();
      }
      expect(chatCommand({ ...raw('!roll'), chatter_user_login: undefined }, kingdomId, 'live', start)).toBeNull();
      await r.ingest.handle(r.frame('private-forge', raw('!forge private copper dragon', 'forge')));
      await r.ingest.handle(r.frame('battle-strike', raw('!strike', 'strike')));
      expect(r.command).toHaveBeenCalledTimes(6);
      expect(JSON.stringify(r.command.mock.calls)).not.toContain('private copper dragon');
    } finally { r.ingest.dispose(); }
  });

  it('coalesces concurrent receipts and permits the same chat and receipt IDs after disk refusal', async () => {
    const r = rig();
    let fail!: (reason: Error) => void;
    r.command.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    try {
      const first = r.ingest.handle(r.frame('receipt', raw('!roll')))!;
      const duplicateReceipt = r.ingest.handle(r.frame('receipt', raw('!roll')))!;
      const duplicateChat = r.ingest.handle(r.frame('other-receipt', raw('!roll')))!;
      const rejected = Promise.allSettled([first, duplicateReceipt, duplicateChat]);
      await vi.waitFor(() => expect(r.command).toHaveBeenCalledOnce());
      fail(new Error('SIMULATED disk refused'));
      expect((await rejected).map(result => result.status)).toEqual(['rejected', 'rejected', 'rejected']);
      await r.ingest.handle(r.frame('receipt', raw('!roll')));
      await r.ingest.handle(r.frame('other-receipt', raw('!roll')));
      expect(r.command).toHaveBeenCalledTimes(2);
      expect(r.ingest.health().counters).toMatchObject({ commands: 1, commandRefused: 1 });
    } finally { r.ingest.dispose(); }
  });

  it('suppresses shared-chat, uncovered, future, stale and tombstoned commands while cleanup still forwards', async () => {
    const r = rig();
    try {
      await r.ingest.handle(r.frame('guest', { ...raw('!roll', 'guest'), source_broadcaster_user_id: '555' }));
      r.coverage.value = false;
      await r.ingest.handle(r.frame('uncovered', raw('!roll', 'uncovered')));
      await r.ingest.handle(r.frame('delete-receipt', { broadcaster_user_id: kingdomId, target_user_id: '789', message_id: 'deleted' }, 'channel.chat.message_delete'));
      r.coverage.value = true;
      await r.ingest.handle(r.frame('deleted-late', raw('!roll', 'deleted')));
      await r.ingest.handle(r.frame('future', raw('!roll', 'future'), 'channel.chat.message', start + 5001));
      r.clock.now += CHAT_COMMAND_MAX_AGE_MS;
      await r.ingest.handle(r.frame('stale', raw('!roll', 'stale'), 'channel.chat.message', start));
      await r.ingest.handle(r.frame('user-clear', { broadcaster_user_id: kingdomId, target_user_id: '789' }, 'channel.chat.clear_user_messages'));
      await r.ingest.handle(r.frame('room-clear', { broadcaster_user_id: kingdomId }, 'channel.chat.clear'));
      expect(r.command.mock.calls.map(call => call[0])).toEqual([
        { version: 1, kind: 'cleanup', origin: 'simulated', kingdomId, messageId: 'delete-receipt', at: start, twitchId: PersonIdSchema.parse('789'), reason: 'delete', targetMessageId: 'deleted' },
        { version: 1, kind: 'cleanup', origin: 'simulated', kingdomId, messageId: 'user-clear', at: r.clock.now, twitchId: PersonIdSchema.parse('789'), reason: 'clear', targetMessageId: null },
        { version: 1, kind: 'cleanup', origin: 'simulated', kingdomId, messageId: 'room-clear', at: r.clock.now, twitchId: null, reason: 'clear', targetMessageId: null },
      ] satisfies ChatCommandEnvelope[]);
      expect(r.ingest.health().counters).toMatchObject({ commands: 0, commandCleanups: 3, commandExpired: 1, sharedChatGuests: 1, notCovered: 1, future: 1, tombstoned: 1 });
    } finally { r.ingest.dispose(); }
  });
});
