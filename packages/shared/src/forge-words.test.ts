import { describe, expect, it } from 'vitest';
import { FORGE_CHAT_LIMITS, ForgeChatWishRequestSchema } from './forge-chat';
import { ForgeRunRequestSchema } from './forge';
import { FORGE_WISH_WORDS_MAX } from './forge-words';
import { RealmHeraldForgeCommandSchema } from './realm/herald';

/** One wish length from chat to the forge: a wish that fits in a Twitch message with `!forge ` is read whole. */
describe('the wish length', () => {
  const herald = (words: string) => RealmHeraldForgeCommandSchema.safeParse({ kingdomId: '123', personId: '456', messageId: 'm1', slot: 3, words, observedAt: 1 }).success;
  const box = (words: string) => ForgeChatWishRequestSchema.safeParse({ version: 1, kingdomId: '123', requestId: '6f1c2a0e-5b7d-4c3e-9a1f-2d4b6c8e0a12', words }).success;
  const run = (words: string) => ForgeRunRequestSchema.shape.words.safeParse(words).success;

  it('fits a Twitch chat message with its command prefix', () => {
    expect(`!forge ${'x'.repeat(FORGE_WISH_WORDS_MAX)}`.length).toBeLessThanOrEqual(500);
    expect(FORGE_CHAT_LIMITS.words).toBe(FORGE_WISH_WORDS_MAX);
  });

  it('is the same at the wish box, the Herald command and the Forge run', () => {
    for (const check of [herald, box, run]) {
      expect(check('x'.repeat(FORGE_WISH_WORDS_MAX))).toBe(true);
      expect(check('x'.repeat(FORGE_WISH_WORDS_MAX + 1))).toBe(false);
    }
  });
});
