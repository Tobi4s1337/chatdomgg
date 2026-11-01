import { describe, expect, it } from 'vitest';
import { ChatCommandEnvelopeSchema, parseChatCommand } from './chat-commands';

const base = { version: 1, origin: 'live', kingdomId: '202', messageId: 'event-1', at: 1000 };
const cleanup = { ...base, kind: 'cleanup', twitchId: '101', reason: 'delete', targetMessageId: 'chat-1' };

describe('chat command syntax and evidence', () => {
  it.each(['sus', 'drop', 'roll', 'hold', 'pull', 'pierfish', 'fish', 'future_game'])('parses registered or future syntax: %s', command => {
    expect(parseChatCommand(`  !${command.toUpperCase()}  one  `)).toEqual({ command, arg: 'one' });
  });
  it('bounds arguments and rejects control characters and non-command text', () => {
    expect(parseChatCommand('!roll')).toEqual({ command: 'roll', arg: null });
    expect(parseChatCommand(`!roll ${'x'.repeat(32)}`)?.arg).toHaveLength(32);
    for (const text of [`!roll ${'x'.repeat(33)}`, '!roll\nnow', '!roll \u200b', 'hello !roll', `!${'a'.repeat(33)}`, '!roll a\tb']) {
      expect(parseChatCommand(text), JSON.stringify(text)).toBeNull();
    }
  });
  it('requires strict, correctly targeted cleanup evidence', () => {
    expect(ChatCommandEnvelopeSchema.safeParse(cleanup).success).toBe(true);
    expect(ChatCommandEnvelopeSchema.safeParse({ ...cleanup, reason: 'clear', twitchId: null, targetMessageId: null }).success).toBe(true);
    expect(ChatCommandEnvelopeSchema.safeParse({ ...cleanup, reason: 'ban', targetMessageId: null }).success).toBe(true);
    for (const value of [
      { ...cleanup, twitchId: null }, { ...cleanup, targetMessageId: null },
      { ...cleanup, reason: 'ban' }, { ...cleanup, reason: 'timeout', twitchId: null, targetMessageId: null },
      { ...cleanup, extra: true },
    ]) expect(ChatCommandEnvelopeSchema.safeParse(value).success).toBe(false);
  });
});
