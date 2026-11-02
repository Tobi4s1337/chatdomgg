import { describe, expect, it } from 'vitest';
import type { GatherChatEnvelope } from '@chatdom/shared';
import { campfireChatCommands, type ChatCleanupInput, type ChatCommandInput } from './commands';
import type { CampfireFire } from './fire';

const KINGDOM = '999000001', AT = Date.UTC(2026, 10, 2, 21);

function campfires(answer: 'counted' | 'ignored' = 'counted') {
  const calls: GatherChatEnvelope[] = [], fires = new Set<string>();
  const fire = { chat: async (envelope: GatherChatEnvelope) => { calls.push(envelope); return envelope.kind === 'command' ? answer : 'ignored'; } } as unknown as CampfireFire;
  return { calls, fires, registry: { fire: (id: string) => { fires.add(id); return fire; }, known: (id: string) => fires.has(id) ? fire : undefined } };
}
const sus = (overrides: Partial<ChatCommandInput> = {}): ChatCommandInput => ({ kind: 'command', origin: 'simulated', kingdomId: KINGDOM, messageId: 'm-1', at: AT,
  chatter: { twitchId: '5551234', login: 'viewer', displayName: 'Viewer' }, command: 'sus', arg: 'Mira', ...overrides });
const cleanup = (overrides: Partial<ChatCleanupInput> = {}): ChatCleanupInput => ({ kind: 'cleanup', origin: 'simulated', kingdomId: KINGDOM, messageId: 'e-1', at: AT,
  twitchId: '5551234', reason: 'timeout', targetMessageId: null, ...overrides });

describe('the Gallery through the realm chat commands', () => {
  it('owns `!sus` and hands each line to its kingdom\'s fire as the Gallery\'s envelope', async () => {
    const { calls, registry } = campfires(), handler = campfireChatCommands(registry);
    expect(handler.id).toBe('campfire');
    expect(handler.commands).toEqual(['sus']);
    expect(await handler.command(sus())).toBe('accepted');
    expect(calls).toEqual([{ kind: 'command', kingdomId: KINGDOM, messageId: 'm-1', at: AT,
      chatter: { twitchId: '5551234', login: 'viewer', displayName: 'Viewer' }, command: 'sus', arg: 'Mira' }]);
  });

  it('answers ignored for a line the fire did not count, a bare `!sus` and any other command', async () => {
    const { calls, registry } = campfires('ignored'), handler = campfireChatCommands(registry);
    expect(await handler.command(sus())).toBe('ignored');
    expect(await handler.command(sus({ arg: null }))).toBe('ignored');
    expect(await handler.command(sus({ command: 'drop', arg: '4' }))).toBe('ignored');
    expect(calls).toHaveLength(1);
  });

  it('takes back a banned, timed-out or deleted identity\'s suspicion, leaves a clear alone, and never wakes a cold fire', async () => {
    const { calls, registry } = campfires(), handler = campfireChatCommands(registry);
    expect(await handler.cleanup(cleanup())).toBe('ignored');
    expect(calls).toHaveLength(0);
    await handler.command(sus());
    for (const reason of ['ban', 'timeout'] as const) expect(await handler.cleanup(cleanup({ reason }))).toBe('accepted');
    expect(await handler.cleanup(cleanup({ reason: 'delete', targetMessageId: 'm-1' }))).toBe('accepted');
    expect(await handler.cleanup(cleanup({ reason: 'clear', twitchId: null }))).toBe('ignored');
    expect(calls.slice(1)).toEqual(Array.from({ length: 3 }, () => ({ kind: 'cleanup', kingdomId: KINGDOM, twitchId: '5551234', at: AT })));
  });
});
