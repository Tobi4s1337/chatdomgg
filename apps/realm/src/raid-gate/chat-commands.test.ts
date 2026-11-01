import { describe, expect, it, vi } from 'vitest';
import { CHAT_COMMAND_MAX_AGE_MS, ChatCommandEnvelopeSchema } from '@chatdom/shared';
import { CHAT_COMMAND_BODY_LIMIT, createChatCommandService, RealmChatCommandRegistry, type RealmChatCommandHandler } from './chat-commands';

const now = 1_800_000_000_000;
const command = (name = 'roll', overrides: Record<string, unknown> = {}) => ChatCommandEnvelopeSchema.parse({
  version: 1, kind: 'command', origin: 'live', kingdomId: '202', messageId: 'chat-1', at: now,
  chatter: { twitchId: '101', login: 'visitor', displayName: 'Visitor' }, command: name, arg: null, ...overrides,
});
const cleanup = ChatCommandEnvelopeSchema.parse({ version: 1, kind: 'cleanup', origin: 'live', kingdomId: '202',
  messageId: 'event-1', at: now, twitchId: '101', reason: 'ban', targetMessageId: null });
const handler = (id: string, commands: string[]): RealmChatCommandHandler => ({ id, commands,
  command: async () => 'accepted', cleanup: async () => 'accepted' });

describe('realm chat command registry', () => {
  it('routes disjoint commands, ignores unknown commands, and atomically rejects overlapping registration', async () => {
    const registry = new RealmChatCommandRegistry();
    const roll = vi.fn(async () => 'accepted' as const), fish = vi.fn(async () => 'duplicate' as const);
    const dispose = registry.register({ ...handler('game', ['roll', 'hold']), command: roll });
    registry.register({ ...handler('pier', ['fish']), command: fish });
    expect(() => registry.register(handler('bad', ['drop', 'roll']))).toThrow();
    expect(await registry.dispatch(command('drop'))).toBe('ignored');
    expect(await registry.dispatch(command('roll'))).toBe('accepted');
    expect(await registry.dispatch(command('fish'))).toBe('duplicate');
    expect(await registry.dispatch(command('future'))).toBe('ignored');
    expect(roll).toHaveBeenCalledTimes(1); expect(fish).toHaveBeenCalledTimes(1);
    dispose(); registry.register(handler('newgame', ['roll', 'hold']));
    dispose(); // A stale disposer cannot remove the new owner.
    expect(await registry.dispatch(command('roll'))).toBe('accepted');
  });
  it('fans cleanup out to all handlers, retries partial failures, and preserves duplicate outcomes', async () => {
    const registry = new RealmChatCommandRegistry();
    const first = vi.fn().mockResolvedValueOnce('accepted').mockResolvedValueOnce('duplicate');
    const second = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce('accepted');
    registry.register({ ...handler('one', ['roll']), cleanup: first });
    registry.register({ ...handler('two', ['fish']), cleanup: second });
    await expect(registry.dispatch(cleanup)).rejects.toThrow('Chat cleanup has not committed in every handler.');
    expect(await registry.dispatch(cleanup)).toBe('accepted');
    expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenLastCalledWith(cleanup); expect(second).toHaveBeenLastCalledWith(cleanup);
  });
});

describe('realm chat command ingress', () => {
  it('authenticates Herald, isolates origin and refuses malformed requests', async () => {
    const registry = new RealmChatCommandRegistry(), receive = vi.fn(async () => 'accepted' as const);
    registry.register({ ...handler('game', ['roll']), command: receive });
    const secret = 'h'.repeat(40), panel = 'p'.repeat(40);
    const service = createChatCommandService({ registry, origin: 'live', clock: () => now, credentials: { herald: secret, panel } });
    const send = (value: unknown, token = secret, url = 'http://realm.test/internal/realm/chat-commands') => service.handle(new Request(url, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(value),
    }));
    expect((await send(command(), panel)).status).toBe(401);
    expect((await send(command(), 'wrong')).status).toBe(401);
    expect((await send(command('roll', { origin: 'simulated' }))).status).toBe(403);
    expect((await send(command(), secret, 'http://realm.test/internal/realm/chat-commands?x=1')).status).toBe(400);
    expect((await send({ ...command(), text: 'ordinary chat' })).status).toBe(400);
    expect((await send(command('roll', { at: now + 5001 }))).status).toBe(400);
    expect((await send({ padding: 'x'.repeat(CHAT_COMMAND_BODY_LIMIT) })).status).toBe(413);
    const answer = await send(command());
    expect(answer.status).toBe(202); expect(await answer.json()).toEqual({ version: 1, status: 'accepted' });
    expect(receive).toHaveBeenCalledTimes(1);
    await service.close();
    expect((await send(command())).status).toBe(503);
  });
  it('lets a feature deduplicate a retried command after its acknowledgement is lost', async () => {
    const registry = new RealmChatCommandRegistry(), committed = new Set<string>();
    let moves = 0;
    registry.register({ ...handler('game', ['roll']), command: async input => {
      if (committed.has(input.messageId)) return 'duplicate';
      committed.add(input.messageId); moves++;
      throw new Error('acknowledgement lost');
    } });
    const secret = 'h'.repeat(40);
    const service = createChatCommandService({ registry, origin: 'live', clock: () => now, credentials: { herald: secret } });
    const send = () => service.handle(new Request('http://realm.test/internal/realm/chat-commands', {
      method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(command()),
    }));
    expect((await send()).status).toBe(503);
    expect(await (await send()).json()).toEqual({ version: 1, status: 'duplicate' });
    expect(moves).toBe(1);
    await service.close();
  });
  it('waits for an in-flight cleanup to commit when closing', async () => {
    const registry = new RealmChatCommandRegistry();
    let release!: () => void, started!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    registry.register({ ...handler('game', ['fish']), cleanup: async () => { started(); await barrier; return 'accepted'; } });
    const secret = 'h'.repeat(40);
    const service = createChatCommandService({ registry, origin: 'live', clock: () => now, credentials: { herald: secret } });
    const sending = service.handle(new Request('http://realm.test/internal/realm/chat-commands', {
      method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(cleanup),
    }));
    try {
      await entered;
      let closed = false;
      const closing = service.close().then(() => { closed = true; });
      await Promise.resolve(); await Promise.resolve();
      expect(closed).toBe(false);
      release();
      expect(await (await sending).json()).toEqual({ version: 1, status: 'accepted' });
      await closing;
      expect(closed).toBe(true);
    } finally { release(); await sending; await service.close(); }
  });
  it('ignores expired commands but delivers old moderation cleanup', async () => {
    const registry = new RealmChatCommandRegistry();
    const move = vi.fn(async () => 'accepted' as const), clean = vi.fn(async () => 'accepted' as const);
    registry.register({ ...handler('game', ['roll']), command: move, cleanup: clean });
    const secret = 'h'.repeat(40);
    const service = createChatCommandService({ registry, origin: 'live', clock: () => now, credentials: { herald: secret } });
    const send = (value: unknown) => service.handle(new Request('http://realm.test/internal/realm/chat-commands', {
      method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(value),
    }));
    expect(await (await send(command('roll', { at: now - CHAT_COMMAND_MAX_AGE_MS }))).json()).toEqual({ version: 1, status: 'ignored' });
    expect(await (await send({ ...cleanup, at: now - 100_000 })).json()).toEqual({ version: 1, status: 'accepted' });
    expect(move).not.toHaveBeenCalled(); expect(clean).toHaveBeenCalledTimes(1);
    await service.close();
  });
});
