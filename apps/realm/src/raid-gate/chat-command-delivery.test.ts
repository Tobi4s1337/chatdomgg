import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHAT_COMMAND_ROUTE, KingdomIdSchema, type ChatCommand, type ChatCommandCleanup } from '@chatdom/shared';
import type { DeliveryFrame } from '../../../../packages/twitch/src/index';
import { expect, it } from 'vitest';
import { ChatIngest } from '../../../herald/src/ingest/ingest';
import { planSubscriptions, type HeraldEventType } from '../../../herald/src/ingest/subscriptions';
import { RealmDelivery } from '../../../herald/src/realm-delivery/delivery';
import { MemoryBindingStore } from '../../../herald/src/source/bindings';
import { PresenceSource } from '../../../herald/src/source/source';
import { createChatCommandService, RealmChatCommandRegistry } from './chat-commands';

it('delivers witnessed generic chat commands from the restarted Herald outbox to registered realm handlers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-chat-e2e-'));
  const kingdomId = KingdomIdSchema.parse('123'), start = 1_800_000_000_000, clock = { now: start };
  const secret = 'simulated-command-secret-000000000000';
  const commands: ChatCommand[] = [], cleanups: Record<string, ChatCommandCleanup[]> = { gather: [], pier: [] };
  const registry = new RealmChatCommandRegistry();
  for (const [id, names] of [['gather', ['sus', 'drop', 'roll', 'hold', 'pull']], ['pier', ['fish']]] as const) {
    registry.register({ id, commands: names, command: async value => { commands.push(value); return 'accepted'; },
      cleanup: async value => { cleanups[id]!.push(value); return 'accepted'; } });
  }
  const service = createChatCommandService({ registry, origin: 'simulated', clock: () => clock.now, credentials: { herald: secret } });
  let online = false;
  const attempts: Array<{ path: string; status: number }> = [];
  const options = { url: 'http://127.0.0.1', secret, directory, origin: 'simulated' as const, now: () => clock.now, retryMs: 1000,
    fetch: (async (url, init) => {
      const request = new Request(String(url), init), path = new URL(request.url).pathname;
      const response = path !== CHAT_COMMAND_ROUTE ? Response.json({ status: 'accepted' }, { status: 202 })
        : online ? await service.handle(request) : Response.json({ status: 'unavailable' }, { status: 503 });
      if (path === CHAT_COMMAND_ROUTE) attempts.push({ path, status: response.status });
      return response;
    }) as typeof fetch };
  let sender = await RealmDelivery.open(options);
  const source = new PresenceSource({ kingdomId, origin: 'simulated', slots: [], store: new MemoryBindingStore(), now: () => clock.now, tickMs: 0 });
  const plans = planSubscriptions({ broadcasterId: kingdomId, readerId: '456', clientId: 'SIMULATED' });
  const ingest = new ChatIngest({ source, conduitId: 'SIMULATED', clientId: 'SIMULATED', plans, now: () => clock.now, covered: () => true,
    onAuthorizationRevoked: () => {}, onSubscriptionRevoked: () => {}, realm: sender });
  const frame = (id: string, event: unknown, type: HeraldEventType = 'channel.chat.message'): DeliveryFrame => {
    const plan = plans.find(item => item.type === type)!;
    return { kind: 'notification', meta: { messageId: id, at: clock.now }, subscription: { id: 'SIMULATED', conduitId: 'SIMULATED', status: 'enabled',
      type: plan.type, version: plan.version, condition: plan.condition }, event };
  };
  const raw = (name: string) => ({ broadcaster_user_id: kingdomId, chatter_user_id: '789', chatter_user_login: 'visitor',
    chatter_user_name: 'Visitor', message_id: `chat-${name}`, message: { text: `!${name} 4` }, source_broadcaster_user_id: null });
  try {
    const names = ['sus', 'drop', 'roll', 'hold', 'pull', 'fish', 'future-game'];
    for (const name of names) await ingest.handle(frame(`receipt-${name}`, raw(name)));
    await sender.flush();
    expect(sender.health()).toMatchObject({ commands: 7, pending: 7 });
    expect(commands).toEqual([]);
    expect((await readdir(directory)).filter(name => name.endsWith('.json'))).toHaveLength(7);
    ingest.dispose(); await sender.close();
    online = true; clock.now += 1000;
    sender = await RealmDelivery.open(options); await sender.flush();
    expect(sender.health()).toMatchObject({ commands: 0, pending: 0 });
    expect(commands).toEqual(names.slice(0, 6).map(name => ({ version: 1, kind: 'command', origin: 'simulated', kingdomId,
      messageId: `chat-${name}`, at: start, chatter: { twitchId: '789', login: 'visitor', displayName: 'Visitor' }, command: name, arg: '4' })));
    expect(attempts.filter(attempt => attempt.status === 202)).toHaveLength(7);
    expect((await readdir(directory)).filter(name => name.endsWith('.json'))).toEqual([]);
    // A fresh ingest uses the reopened durable sender for subsequent moderation evidence.
    const restarted = new ChatIngest({ source, conduitId: 'SIMULATED', clientId: 'SIMULATED', plans, now: () => clock.now, covered: () => true,
      onAuthorizationRevoked: () => {}, onSubscriptionRevoked: () => {}, realm: sender });
    try {
      await restarted.handle(frame('delete-receipt', { broadcaster_user_id: kingdomId, target_user_id: '789', message_id: 'chat-roll' }, 'channel.chat.message_delete'));
      await restarted.handle(frame('clear-receipt', { broadcaster_user_id: kingdomId, target_user_id: '789' }, 'channel.chat.clear_user_messages'));
      await sender.flush();
      for (const id of ['gather', 'pier']) expect(cleanups[id]).toEqual([
        { version: 1, kind: 'cleanup', origin: 'simulated', kingdomId, messageId: 'delete-receipt', at: clock.now, twitchId: '789', reason: 'delete', targetMessageId: 'chat-roll' },
        { version: 1, kind: 'cleanup', origin: 'simulated', kingdomId, messageId: 'clear-receipt', at: clock.now, twitchId: '789', reason: 'clear', targetMessageId: null },
      ]);
      expect(sender.health()).toMatchObject({ pending: 0, commandCleanups: 0 });
    } finally { restarted.dispose(); }
  } finally { ingest.dispose(); await sender.close(); await service.close(); await rm(directory, { recursive: true, force: true }); }
});
