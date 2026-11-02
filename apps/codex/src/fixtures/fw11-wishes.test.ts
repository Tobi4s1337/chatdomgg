import { describe, expect, it } from 'vitest';
import { FORGE_CHAT_LIMITS, FORGE_MOTIFS } from '@chatdom/shared';
import { FW10_WISHES } from './fw10-wishes';
import { FW11_EXTRA_WISHES, FW11_WISHES } from './fw11-wishes';

describe('the fixed, lane-authored FW11 fifty', () => {
  it('keeps FW10\'s twenty unchanged and adds thirty distinct wishes', () => {
    expect(FW11_WISHES).toHaveLength(50);
    expect(FW11_WISHES.slice(0, 20)).toEqual(FW10_WISHES);
    expect(FW11_EXTRA_WISHES.map(wish => wish.id)).toEqual(Array.from({ length: 30 }, (_, i) => `fw11-${i + 21}`));
    expect(new Set(FW11_WISHES.map(wish => wish.id)).size).toBe(50);
    expect(new Set(FW11_WISHES.map(wish => wish.words.trim().toLowerCase())).size).toBe(50);
  });
  it('fits the wish box and covers every motif and the unsupported kinds', () => {
    expect(FW11_EXTRA_WISHES.every(wish => wish.words.trim().length > 0 && wish.words.length <= FORGE_CHAT_LIMITS.words)).toBe(true);
    const known = FW11_EXTRA_WISHES.filter(wish => wish.category === 'known');
    expect(new Set(known.map(wish => wish.expectedMotif))).toEqual(new Set(FORGE_MOTIFS));
    expect(new Set(FW11_EXTRA_WISHES.filter(wish => wish.category !== 'known').map(wish => wish.category)))
      .toEqual(new Set(['creature', 'object', 'painting', 'pun', 'emote', 'language', 'typo']));
  });
});
